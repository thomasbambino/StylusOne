import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { IService } from './interfaces';
import { db } from '../db';
import { iptvCredentials, planIptvCredentials, activeIptvStreams, userSubscriptions, subscriptionPlans, iptvChannels, planPackages, packageChannels, channelPackages, iptvProviders } from '@shared/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { decrypt, maskCredential } from '../utils/encryption';

// Cache directory for IPTV data
const CACHE_DIR = path.join(process.cwd(), 'data', 'iptv-cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Interface for Xtream Codes authentication
 */
export interface XtreamAuth {
  username: string;
  password: string;
  serverUrl: string;
}

/**
 * Interface for Xtream Codes channel (Live Stream)
 */
export interface XtreamChannel {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  epg_channel_id: string;
  added: string;
  category_name: string;
  category_id: string;
  custom_sid: string;
  tv_archive: number;
  direct_source: string;
  tv_archive_duration: number;
}

/**
 * Interface for channel formatted for our app
 */
export interface IPTVChannel {
  id: string;
  number: string;
  name: string;
  streamUrl: string;
  logo: string;
  epgId: string;
  categoryName: string;
  categoryId: string;
  hasArchive: boolean;
  archiveDays: number;
  credentialId?: number; // Track which credential this channel belongs to
}

/**
 * Interface for Xtream Codes category
 */
export interface XtreamCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

/**
 * Interface for EPG listing
 */
export interface XtreamEPGListing {
  id: string;
  epg_id: string;
  title: string;
  lang: string;
  start: string;
  end: string;
  description: string;
  channel_id: string;
  start_timestamp: number;
  stop_timestamp: number;
  now_playing: number;
  has_archive: number;
}

/**
 * Decrypted credential data
 */
export interface DecryptedCredential {
  id: number;
  name: string;
  serverUrl: string;
  username: string;
  password: string;
  maxConnections: number;
  isActive: boolean;
}

/**
 * Xtream Codes Client - handles API calls for a single IPTV credential
 */
export class XtreamCodesClient {
  private serverUrl: string;
  private username: string;
  private password: string;
  private credentialId: number | null;
  private authInfo: any = null;

  // Cache storage
  private categoriesCache: XtreamCategory[] | null = null;
  private channelsCache: IPTVChannel[] | null = null;
  private cacheTimestamp: number = 0;
  private cacheExpirationMs: number = 1800000; // 30 minute cache (was 30 seconds - caused rate limiting)

  constructor(credentials: { serverUrl: string; username: string; password: string; credentialId?: number }) {
    this.serverUrl = credentials.serverUrl;
    this.username = credentials.username;
    this.password = credentials.password;
    this.credentialId = credentials.credentialId || null;

    // Try to load from disk cache on startup
    this.loadFromDisk();
  }

  /**
   * Get cache file path for this credential
   */
  private getCacheFilePath(): string {
    const safeUsername = this.username.replace(/[^a-zA-Z0-9]/g, '_');
    return path.join(CACHE_DIR, `${safeUsername}_channels.json`);
  }

  /**
   * Save cache to disk
   */
  private saveToDisk(): void {
    try {
      const cacheData = {
        categories: this.categoriesCache,
        channels: this.channelsCache,
        timestamp: this.cacheTimestamp
      };
      fs.writeFileSync(this.getCacheFilePath(), JSON.stringify(cacheData), 'utf-8');
      console.log(`[IPTV Cache] Saved ${this.channelsCache?.length || 0} channels to disk`);
    } catch (error) {
      console.error('[IPTV Cache] Error saving to disk:', error);
    }
  }

  /**
   * Load cache from disk
   */
  private loadFromDisk(): boolean {
    try {
      const filePath = this.getCacheFilePath();
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Check if disk cache is still valid (within expiration)
      if (data.timestamp && (Date.now() - data.timestamp) < this.cacheExpirationMs) {
        this.categoriesCache = data.categories;
        this.channelsCache = data.channels;
        this.cacheTimestamp = data.timestamp;
        console.log(`[IPTV Cache] Loaded ${this.channelsCache?.length || 0} channels from disk`);
        return true;
      }

      console.log('[IPTV Cache] Disk cache expired, will refresh from provider');
      return false;
    } catch (error) {
      console.error('[IPTV Cache] Error loading from disk:', error);
      return false;
    }
  }

  /**
   * Get the credential ID for this client
   */
  getCredentialId(): number | null {
    return this.credentialId;
  }

  /**
   * Test authentication and get user info
   */
  async authenticate(): Promise<any> {
    try {
      const url = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}`;
      const response = await axios.get(url, { timeout: 10000 });

      if (!response.data || !response.data.user_info) {
        throw new Error('Invalid authentication response');
      }

      this.authInfo = response.data;
      return response.data;
    } catch (error) {
      console.error('Error authenticating with Xtream Codes:', error);
      throw new Error('Failed to authenticate with Xtream Codes server');
    }
  }

  /**
   * Check if connection is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const info = await this.authenticate();
      return info.user_info.status === 'Active';
    } catch (error) {
      return false;
    }
  }

  /**
   * Get live stream categories
   */
  async getCategories(): Promise<XtreamCategory[]> {
    // Return from cache if valid
    if (this.isCacheValid() && this.categoriesCache) {
      return this.categoriesCache;
    }

    try {
      await this.refreshCache();
      return this.categoriesCache || [];
    } catch (error) {
      console.error('Error fetching categories:', error);
      if (this.categoriesCache) {
        return this.categoriesCache;
      }
      throw new Error('Failed to fetch categories');
    }
  }

  /**
   * Get formatted channels
   */
  async getChannels(categoryId?: string): Promise<IPTVChannel[]> {
    if (!this.isCacheValid()) {
      try {
        await this.refreshCache();
      } catch (error) {
        console.error('Error refreshing cache:', error);
      }
    }

    if (!this.channelsCache) {
      return [];
    }

    if (categoryId) {
      return this.channelsCache.filter(ch => ch.categoryId === categoryId);
    }

    return this.channelsCache;
  }

  /**
   * Get EPG data for a specific channel
   */
  async getEPG(streamId: string, limit?: number): Promise<XtreamEPGListing[]> {
    try {
      let url = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}&action=get_simple_data_table&stream_id=${streamId}`;

      if (limit) {
        url += `&limit=${limit}`;
      }

      const response = await axios.get(url, { timeout: 10000 });
      return response.data.epg_listings || [];
    } catch (error) {
      console.error(`Error fetching EPG for stream ${streamId}:`, error);
      throw new Error('Failed to fetch EPG data');
    }
  }

  /**
   * Get short EPG (current and next program) for a channel
   */
  async getShortEPG(streamId: string): Promise<{ now?: XtreamEPGListing; next?: XtreamEPGListing }> {
    try {
      const url = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}&action=get_short_epg&stream_id=${streamId}&limit=2`;
      const response = await axios.get(url, { timeout: 10000 });

      const listings = response.data.epg_listings || [];
      return {
        now: listings[0],
        next: listings[1]
      };
    } catch (error) {
      console.error(`Error fetching short EPG for stream ${streamId}:`, error);
      return {};
    }
  }

  /**
   * Get raw live streams from the Xtream API
   * Used for syncing channel data to database
   */
  async getRawLiveStreams(): Promise<XtreamChannel[]> {
    try {
      const streamsUrl = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}&action=get_live_streams`;
      const response = await axios.get(streamsUrl, { timeout: 30000 });
      return response.data || [];
    } catch (error) {
      console.error('Error fetching raw live streams:', error);
      throw new Error('Failed to fetch live streams from provider');
    }
  }

  /**
   * Get stream URL for a specific channel
   */
  getStreamUrl(streamId: string, extension: string = 'ts'): string {
    return `${this.serverUrl}/live/${this.username}/${this.password}/${streamId}.${extension}`;
  }

  /**
   * Get HLS stream URL for a specific channel (for web player)
   */
  getHLSStreamUrl(streamId: string): string {
    return `${this.serverUrl}/live/${this.username}/${this.password}/${streamId}.m3u8`;
  }

  /**
   * Get M3U playlist URL
   */
  getM3UUrl(): string {
    return `${this.serverUrl}/get.php?username=${this.username}&password=${this.password}&type=m3u_plus&output=ts`;
  }

  /**
   * Get XMLTV EPG URL
   */
  getXMLTVUrl(): string {
    return `${this.serverUrl}/xmltv.php?username=${this.username}&password=${this.password}`;
  }

  /**
   * Get server URL for proxy purposes
   */
  getServerUrl(): string {
    return this.serverUrl;
  }

  /**
   * Get username for proxy purposes
   */
  getUsername(): string {
    return this.username;
  }

  /**
   * Get password for proxy purposes
   */
  getPassword(): string {
    return this.password;
  }

  /**
   * Get auth info
   */
  getAuthInfo(): any {
    return this.authInfo;
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(): boolean {
    return this.channelsCache !== null &&
           this.categoriesCache !== null &&
           (Date.now() - this.cacheTimestamp) < this.cacheExpirationMs;
  }

  /**
   * Refresh the cache by fetching categories and channels
   */
  private async refreshCache(): Promise<void> {
    try {
      // Fetch categories
      const categoriesUrl = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}&action=get_live_categories`;
      const categoriesResponse = await axios.get(categoriesUrl, { timeout: 10000 });
      this.categoriesCache = categoriesResponse.data || [];

      // Build category ID to name lookup map (convert to string to handle API returning numbers)
      const categoryNameMap = new Map<string, string>();
      if (this.categoriesCache) {
        for (const cat of this.categoriesCache) {
          if (cat.category_id && cat.category_name) {
            categoryNameMap.set(String(cat.category_id), cat.category_name);
          }
        }
      }

      // Fetch all live streams
      const streamsUrl = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}&action=get_live_streams`;
      const streamsResponse = await axios.get(streamsUrl, { timeout: 15000 });
      const streams: XtreamChannel[] = streamsResponse.data || [];

      // Convert to IPTVChannel format with credentialId
      // Look up category name from the categories cache since get_live_streams doesn't include it
      this.channelsCache = streams.map(stream => {
        const categoryId = stream.category_id?.toString() || '';
        const categoryName = categoryNameMap.get(categoryId) || stream.category_name || 'Unknown';
        return {
          id: stream.stream_id.toString(),
          number: stream.num ? stream.num.toString() : stream.stream_id.toString(),
          name: stream.name,
          streamUrl: `/api/iptv/stream/${stream.stream_id}.m3u8`,
          logo: stream.stream_icon || '',
          epgId: stream.epg_channel_id || '',
          categoryName,
          categoryId,
          hasArchive: stream.tv_archive === 1,
          archiveDays: stream.tv_archive_duration || 0,
          credentialId: this.credentialId || undefined
        };
      });

      this.cacheTimestamp = Date.now();

      // Save to disk for persistence across restarts
      this.saveToDisk();
    } catch (error) {
      console.error('Error refreshing Xtream Codes cache:', error);
      throw error;
    }
  }
}

/**
 * Xtream Codes Manager - manages multiple IPTV credentials and user access
 */
export class XtreamCodesManager implements IService {
  private clients: Map<number, XtreamCodesClient> = new Map();
  private envClient: XtreamCodesClient | null = null;
  private initialized: boolean = false;

  // Cache for user channels (merged from all credentials)
  private userChannelCache: Map<number, { channels: IPTVChannel[]; timestamp: number }> = new Map();
  private userCacheExpiration: number = 1800000; // 30 minutes (was 30 seconds - caused rate limiting)

  constructor() {
    // Check for environment variable fallback
    const serverUrl = process.env.XTREAM_SERVER_URL || '';
    const username = process.env.XTREAM_USERNAME || '';
    const password = process.env.XTREAM_PASSWORD || '';

    if (serverUrl && username && password) {
      this.envClient = new XtreamCodesClient({ serverUrl, username, password });
    }
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    // Initialize env client if available
    if (this.envClient) {
      try {
        await this.envClient.authenticate();
        console.log('Xtream Codes service initialized with environment credentials');
      } catch (error) {
        console.error('Failed to initialize env client:', error);
      }
    }

    // Load active credentials from database
    await this.loadCredentialsFromDatabase();

    this.initialized = true;
    console.log(`Xtream Codes Manager initialized with ${this.clients.size} database credentials`);
  }

  /**
   * Load active credentials from database
   */
  private async loadCredentialsFromDatabase(): Promise<void> {
    try {
      // Import iptvProviders dynamically to avoid circular dependency
      const { iptvProviders } = await import('@shared/schema');

      const credentials = await db.select().from(iptvCredentials).where(eq(iptvCredentials.isActive, true));

      // Load all providers for efficiency
      const providers = await db.select().from(iptvProviders);
      const providerMap = new Map(providers.map(p => [p.id, decrypt(p.serverUrl)]));

      for (const cred of credentials) {
        try {
          // Get server URL from provider if available, otherwise from credential
          const providerServerUrl = cred.providerId ? providerMap.get(cred.providerId) : undefined;
          const decrypted = this.decryptCredential(cred, providerServerUrl);

          const client = new XtreamCodesClient({
            serverUrl: decrypted.serverUrl,
            username: decrypted.username,
            password: decrypted.password,
            credentialId: cred.id
          });

          this.clients.set(cred.id, client);
          console.log(`Loaded IPTV credential: ${cred.name} (ID: ${cred.id})`);
        } catch (error) {
          console.error(`Failed to load credential ${cred.name}:`, error);
        }
      }
    } catch (error) {
      console.error('Error loading credentials from database:', error);
    }
  }

  /**
   * Decrypt a credential from the database
   * For new provider-based credentials, serverUrl comes from provider
   * For legacy credentials, serverUrl is stored directly on credential
   */
  private decryptCredential(cred: typeof iptvCredentials.$inferSelect, providerServerUrl?: string): DecryptedCredential {
    // Use provider serverUrl if provided, otherwise fall back to credential's serverUrl
    let serverUrl: string;
    if (providerServerUrl) {
      serverUrl = providerServerUrl;
    } else if (cred.serverUrl) {
      serverUrl = decrypt(cred.serverUrl);
    } else {
      throw new Error(`Credential ${cred.id} has no server URL`);
    }

    return {
      id: cred.id,
      name: cred.name,
      serverUrl,
      username: decrypt(cred.username),
      password: decrypt(cred.password),
      maxConnections: cred.maxConnections,
      isActive: cred.isActive
    };
  }

  /**
   * Get or create client for a specific credential ID
   */
  async getClient(credentialId: number): Promise<XtreamCodesClient | null> {
    if (this.clients.has(credentialId)) {
      return this.clients.get(credentialId)!;
    }

    // Try to load from database
    const [cred] = await db.select().from(iptvCredentials).where(eq(iptvCredentials.id, credentialId));
    if (!cred || !cred.isActive) {
      return null;
    }

    try {
      // Get provider's server URL if this credential is linked to a provider
      let providerServerUrl: string | undefined;
      if (cred.providerId) {
        const { iptvProviders } = await import('@shared/schema');
        const [provider] = await db.select().from(iptvProviders).where(eq(iptvProviders.id, cred.providerId));
        if (provider) {
          providerServerUrl = decrypt(provider.serverUrl);
        }
      }

      const decrypted = this.decryptCredential(cred, providerServerUrl);
      const client = new XtreamCodesClient({
        serverUrl: decrypted.serverUrl,
        username: decrypted.username,
        password: decrypted.password,
        credentialId: cred.id
      });

      this.clients.set(cred.id, client);
      return client;
    } catch (error) {
      console.error(`Failed to create client for credential ${credentialId}:`, error);
      return null;
    }
  }

  /**
   * Get all clients that a user has access to based on their subscriptions
   */
  async getClientsForUser(userId: number): Promise<XtreamCodesClient[]> {
    const clients: XtreamCodesClient[] = [];

    // Get user's active subscriptions
    const subscriptions = await db.select()
      .from(userSubscriptions)
      .innerJoin(subscriptionPlans, eq(userSubscriptions.plan_id, subscriptionPlans.id))
      .where(and(
        eq(userSubscriptions.user_id, userId),
        eq(userSubscriptions.status, 'active')
      ));

    if (subscriptions.length === 0) {
      // Fallback to env client if no subscriptions but user has access
      if (this.envClient) {
        return [this.envClient];
      }
      return [];
    }

    // Get credentials assigned to user's plans
    const planIds = subscriptions.map(s => s.userSubscriptions.plan_id);
    const planCredentials = await db.select()
      .from(planIptvCredentials)
      .innerJoin(iptvCredentials, eq(planIptvCredentials.credentialId, iptvCredentials.id))
      .where(and(
        inArray(planIptvCredentials.planId, planIds),
        eq(iptvCredentials.isActive, true)
      ))
      .orderBy(planIptvCredentials.priority);

    // Collect unique credential IDs
    const seenCredentialIds = new Set<number>();
    for (const pc of planCredentials) {
      if (!seenCredentialIds.has(pc.iptv_credentials.id)) {
        seenCredentialIds.add(pc.iptv_credentials.id);
        const client = await this.getClient(pc.iptv_credentials.id);
        if (client) {
          clients.push(client);
        }
      }
    }

    // If no database credentials, fallback to env client
    if (clients.length === 0 && this.envClient) {
      console.log(`[IPTV] User ${userId} has no plan credentials, falling back to ENV`);
      return [this.envClient];
    }

    console.log(`[IPTV] User ${userId} has ${clients.length} plan credential(s)`);
    return clients;
  }

  /**
   * Get channels from user's subscription packages (new package-based system)
   * Returns channels from: user subscriptions → plans → packages → channels
   */
  async getChannelsFromPackages(userId: number): Promise<IPTVChannel[]> {
    // Get user's active subscriptions
    const subscriptions = await db.select()
      .from(userSubscriptions)
      .innerJoin(subscriptionPlans, eq(userSubscriptions.plan_id, subscriptionPlans.id))
      .where(and(
        eq(userSubscriptions.user_id, userId),
        eq(userSubscriptions.status, 'active')
      ));

    if (subscriptions.length === 0) {
      return [];
    }

    // Get plan IDs
    const planIds = subscriptions.map(s => s.userSubscriptions.plan_id);

    // Get packages assigned to those plans
    const assignedPackages = await db.select()
      .from(planPackages)
      .innerJoin(channelPackages, eq(planPackages.packageId, channelPackages.id))
      .where(and(
        inArray(planPackages.planId, planIds),
        eq(channelPackages.isActive, true)
      ));

    if (assignedPackages.length === 0) {
      return [];
    }

    // Get unique package IDs
    const packageIds = Array.from(new Set(assignedPackages.map(p => p.channel_packages.id)));

    // Get all channels from those packages (only enabled channels)
    const packChannels = await db.select({
      channel: iptvChannels,
      sortOrder: packageChannels.sortOrder,
    })
      .from(packageChannels)
      .innerJoin(iptvChannels, eq(packageChannels.channelId, iptvChannels.id))
      .where(and(
        inArray(packageChannels.packageId, packageIds),
        eq(iptvChannels.isEnabled, true)
      ));

    if (packChannels.length === 0) {
      return [];
    }

    // Group channels by provider to batch credential lookups
    const providerIds = Array.from(new Set(packChannels.map(pc => pc.channel.providerId)));

    // Get provider info and credentials for Xtream providers
    const providerInfo = new Map<number, { type: string; hasCredentials: boolean }>();

    for (const providerId of providerIds) {
      // Get provider with decrypted server URL
      const [provider] = await db.select().from(iptvProviders).where(eq(iptvProviders.id, providerId));
      if (!provider) continue;

      // M3U providers don't need credentials
      if (provider.providerType === 'm3u') {
        providerInfo.set(providerId, { type: 'm3u', hasCredentials: true }); // M3U uses directStreamUrl on channel
        continue;
      }

      // For Xtream providers, check for active credential
      const [credential] = await db.select()
        .from(iptvCredentials)
        .where(and(
          eq(iptvCredentials.providerId, providerId),
          eq(iptvCredentials.isActive, true)
        ))
        .limit(1);

      if (credential) {
        try {
          // Validate we can decrypt (don't actually need to store for proxy URL)
          decrypt(provider.serverUrl!);
          providerInfo.set(providerId, { type: 'xtream', hasCredentials: true });
        } catch (error) {
          console.error(`[IPTV] Failed to decrypt credentials for provider ${providerId}:`, error);
        }
      }
    }

    // Convert database channels to IPTVChannel format
    const channelMap = new Map<string, IPTVChannel>();

    for (const { channel, sortOrder } of packChannels) {
      const info = providerInfo.get(channel.providerId);
      if (!info || !info.hasCredentials) continue; // Skip if provider not accessible

      // Build proxy stream URL (same format as legacy channels)
      const streamUrl = `/api/iptv/stream/${channel.streamId}.m3u8`;

      // Use channel name for deduplication (same channel in multiple packages)
      const key = channel.name.toLowerCase().trim();
      if (!channelMap.has(key)) {
        // Use epgChannelId if available (new column), fallback to empty string
        // The column might not exist yet if migration hasn't run
        const epgChannelId = (channel as any).epgChannelId;
        channelMap.set(key, {
          id: channel.streamId,
          number: String(sortOrder || channel.id),
          name: channel.name,
          streamUrl,
          logo: channel.logo || '',
          epgId: epgChannelId || '', // Use XMLTV channel ID for EPG lookup
          categoryName: channel.categoryName || 'Uncategorized',
          categoryId: channel.categoryId || '',
          hasArchive: false, // Package channels don't track archive status yet
          archiveDays: 0,
        });
      }
    }

    const channels = Array.from(channelMap.values());

    // Sort alphabetically by name
    channels.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`[IPTV] User ${userId} has ${channels.length} channels from packages`);
    return channels;
  }

  /**
   * Get merged channels from all credentials a user has access to
   * Prioritizes package-based channels, falls back to direct credential channels
   */
  async getMergedChannels(userId: number, categoryId?: string): Promise<IPTVChannel[]> {
    // Check cache first
    const cached = this.userChannelCache.get(userId);
    if (cached && (Date.now() - cached.timestamp) < this.userCacheExpiration) {
      if (categoryId) {
        return cached.channels.filter(ch => ch.categoryId === categoryId);
      }
      return cached.channels;
    }

    // First, try to get channels from packages (new system)
    const packageChannels = await this.getChannelsFromPackages(userId);

    if (packageChannels.length > 0) {
      // User has package-based channels, use those
      console.log(`[IPTV] Using package-based channels for user ${userId}`);

      // Cache the result
      this.userChannelCache.set(userId, {
        channels: packageChannels,
        timestamp: Date.now()
      });

      if (categoryId) {
        return packageChannels.filter(ch => ch.categoryId === categoryId);
      }

      return packageChannels;
    }

    // Fall back to legacy credential-based channels
    console.log(`[IPTV] Falling back to legacy credentials for user ${userId}`);

    const clients = await this.getClientsForUser(userId);
    if (clients.length === 0) {
      return [];
    }

    // Fetch channels from all clients in parallel
    const channelArrays = await Promise.all(
      clients.map(client => client.getChannels().catch(() => []))
    );

    // Merge and deduplicate channels
    const channelMap = new Map<string, IPTVChannel>();
    for (const channels of channelArrays) {
      for (const channel of channels) {
        // Use channel name as the deduplication key
        // Keep the first occurrence (from higher priority credential)
        const key = channel.name.toLowerCase().trim();
        if (!channelMap.has(key)) {
          channelMap.set(key, channel);
        }
      }
    }

    const mergedChannels = Array.from(channelMap.values());

    // Sort alphabetically by name
    mergedChannels.sort((a, b) => a.name.localeCompare(b.name));

    // Cache the result
    this.userChannelCache.set(userId, {
      channels: mergedChannels,
      timestamp: Date.now()
    });

    if (categoryId) {
      return mergedChannels.filter(ch => ch.categoryId === categoryId);
    }

    return mergedChannels;
  }

  /**
   * Get categories from user's subscription packages
   */
  async getCategoriesFromPackages(userId: number): Promise<XtreamCategory[]> {
    // Get channels from packages first
    const channels = await this.getChannelsFromPackages(userId);

    if (channels.length === 0) {
      return [];
    }

    // Extract unique categories from channels
    const categoryMap = new Map<string, XtreamCategory>();
    for (const channel of channels) {
      if (channel.categoryName && channel.categoryId) {
        const key = channel.categoryName.toLowerCase().trim();
        if (!categoryMap.has(key)) {
          categoryMap.set(key, {
            category_id: channel.categoryId,
            category_name: channel.categoryName,
            parent_id: 0
          });
        }
      }
    }

    return Array.from(categoryMap.values()).sort((a, b) =>
      a.category_name.localeCompare(b.category_name)
    );
  }

  /**
   * Get merged categories from all credentials a user has access to
   * Prioritizes package-based categories, falls back to direct credentials
   */
  async getMergedCategories(userId: number): Promise<XtreamCategory[]> {
    // First, try to get categories from packages (new system)
    const packageCategories = await this.getCategoriesFromPackages(userId);

    if (packageCategories.length > 0) {
      return packageCategories;
    }

    // Fall back to legacy credential-based categories
    const clients = await this.getClientsForUser(userId);
    if (clients.length === 0) {
      return [];
    }

    // Fetch categories from all clients in parallel
    const categoryArrays = await Promise.all(
      clients.map(client => client.getCategories().catch(() => []))
    );

    // Merge and deduplicate categories
    const categoryMap = new Map<string, XtreamCategory>();
    for (const categories of categoryArrays) {
      for (const category of categories) {
        const key = category.category_name.toLowerCase().trim();
        if (!categoryMap.has(key)) {
          categoryMap.set(key, category);
        }
      }
    }

    return Array.from(categoryMap.values()).sort((a, b) =>
      a.category_name.localeCompare(b.category_name)
    );
  }

  /**
   * Select a credential for streaming a channel (checks capacity)
   * Returns credential ID if available, null if no capacity
   * Supports both package-based and direct credential channels
   */
  async selectCredentialForStream(userId: number, streamId: string): Promise<number | null> {
    console.log(`[IPTV] selectCredentialForStream called for user ${userId}, stream ${streamId}`);

    // First, check if user already has an active stream for this exact streamId
    // This prevents the case where acquire creates a session, then the stream request
    // fails because it sees its own session as using capacity
    const [existingStream] = await db.select()
      .from(activeIptvStreams)
      .where(and(
        eq(activeIptvStreams.userId, userId),
        eq(activeIptvStreams.streamId, streamId)
      ))
      .limit(1);

    if (existingStream) {
      console.log(`[IPTV] User ${userId} already has active stream ${streamId} on credential ${existingStream.credentialId}`);
      return existingStream.credentialId;
    }

    // Next, check if this is a package-based channel
    const packageChannelCredential = await this.selectPackageChannelCredential(userId, streamId);
    if (packageChannelCredential !== null) {
      console.log(`[IPTV] Found package credential ${packageChannelCredential} for stream ${streamId}`);
      return packageChannelCredential;
    }

    console.log(`[IPTV] No package credential found, falling back to legacy for stream ${streamId}`);

    // Fall back to legacy credential-based selection
    const clients = await this.getClientsForUser(userId);
    if (clients.length === 0) {
      // Use env client fallback (no stream tracking)
      console.log(`[IPTV] User ${userId} using ENV CLIENT (no plan credentials)`);
      return this.envClient ? -1 : null;
    }

    // Check each credential for the channel and available capacity
    for (const client of clients) {
      const credentialId = client.getCredentialId();
      if (!credentialId) continue;

      // Check if this credential has the channel
      const channels = await client.getChannels();
      const hasChannel = channels.some(ch => ch.id === streamId);
      if (!hasChannel) continue;

      // Check capacity
      const [cred] = await db.select().from(iptvCredentials).where(eq(iptvCredentials.id, credentialId));
      if (!cred) continue;

      const activeStreams = await db.select()
        .from(activeIptvStreams)
        .where(eq(activeIptvStreams.credentialId, credentialId));

      if (activeStreams.length < cred.maxConnections) {
        console.log(`[IPTV] User ${userId} using PLAN CREDENTIAL ${credentialId} (${cred.name}) for stream ${streamId}`);
        return credentialId;
      }
    }

    console.log(`[IPTV] User ${userId} NO CAPACITY for stream ${streamId}`);
    return null; // No capacity available
  }

  /**
   * Select a credential for a package-based channel
   * Returns credential ID if found and has capacity, null otherwise
   */
  private async selectPackageChannelCredential(userId: number, streamId: string): Promise<number | null> {
    console.log(`[IPTV-PKG] Checking package credential for user ${userId}, stream ${streamId}`);

    // Get user's active subscriptions
    const subscriptions = await db.select()
      .from(userSubscriptions)
      .innerJoin(subscriptionPlans, eq(userSubscriptions.plan_id, subscriptionPlans.id))
      .where(and(
        eq(userSubscriptions.user_id, userId),
        eq(userSubscriptions.status, 'active')
      ));

    if (subscriptions.length === 0) {
      console.log(`[IPTV-PKG] User ${userId} has no active subscriptions`);
      return null;
    }

    const planIds = subscriptions.map(s => s.userSubscriptions.plan_id);
    console.log(`[IPTV-PKG] User ${userId} has plans: ${planIds.join(', ')}`);

    // Get packages assigned to those plans
    const assignedPackages = await db.select()
      .from(planPackages)
      .innerJoin(channelPackages, eq(planPackages.packageId, channelPackages.id))
      .where(and(
        inArray(planPackages.planId, planIds),
        eq(channelPackages.isActive, true)
      ));

    if (assignedPackages.length === 0) {
      console.log(`[IPTV-PKG] No packages assigned to user ${userId}'s plans`);
      return null;
    }

    const packageIds = Array.from(new Set(assignedPackages.map(p => p.channel_packages.id)));
    console.log(`[IPTV-PKG] User ${userId} has packages: ${packageIds.join(', ')}`);

    // Check if streamId exists in user's packages
    const [channelInPackage] = await db.select({
      channel: iptvChannels,
    })
      .from(packageChannels)
      .innerJoin(iptvChannels, eq(packageChannels.channelId, iptvChannels.id))
      .where(and(
        inArray(packageChannels.packageId, packageIds),
        eq(iptvChannels.streamId, streamId),
        eq(iptvChannels.isEnabled, true)
      ))
      .limit(1);

    if (!channelInPackage) {
      console.log(`[IPTV-PKG] Channel ${streamId} not found in user ${userId}'s packages (or not enabled)`);
      return null; // Channel not found in user's packages
    }

    console.log(`[IPTV-PKG] Found channel ${streamId} in package, provider: ${channelInPackage.channel.providerId}`);


    const providerId = channelInPackage.channel.providerId;

    // Get all active credentials for this provider, ordered by priority
    const providerCredentials = await db.select()
      .from(iptvCredentials)
      .where(and(
        eq(iptvCredentials.providerId, providerId),
        eq(iptvCredentials.isActive, true)
      ));

    if (providerCredentials.length === 0) {
      console.log(`[IPTV] No active credentials for provider ${providerId}`);
      return null;
    }

    // Find a credential with available capacity
    const allStreamsInfo: { credId: number; name: string; streams: Array<{ userId: number; streamId: string; age: number }> }[] = [];

    for (const cred of providerCredentials) {
      const activeStreams = await db.select()
        .from(activeIptvStreams)
        .where(eq(activeIptvStreams.credentialId, cred.id));

      // Track for debug output
      const streamInfo = activeStreams.map(s => ({
        userId: s.userId,
        streamId: s.streamId,
        age: Math.round((Date.now() - new Date(s.lastHeartbeat).getTime()) / 1000)
      }));
      allStreamsInfo.push({ credId: cred.id, name: cred.name, streams: streamInfo });

      console.log(`[IPTV-PKG] Credential ${cred.id} (${cred.name}): ${activeStreams.length}/${cred.maxConnections} streams active`);

      if (activeStreams.length < cred.maxConnections) {
        console.log(`[IPTV] User ${userId} using PACKAGE CREDENTIAL ${cred.id} (${cred.name}) for stream ${streamId}`);
        return cred.id;
      }
    }

    // Log detailed info about what's blocking capacity
    console.log(`[IPTV] User ${userId} NO CAPACITY for package stream ${streamId} (provider ${providerId})`);
    console.log(`[IPTV] Active streams blocking capacity:`);
    for (const info of allStreamsInfo) {
      console.log(`  Credential ${info.credId} (${info.name}): ${info.streams.length} streams`);
      for (const s of info.streams) {
        console.log(`    - User ${s.userId}, stream ${s.streamId}, last heartbeat ${s.age}s ago`);
      }
    }
    return null;
  }

  /**
   * Get a client for a stream (finds the right credential)
   */
  async getClientForStream(userId: number, streamId: string): Promise<XtreamCodesClient | null> {
    const credentialId = await this.selectCredentialForStream(userId, streamId);

    if (credentialId === null) {
      return null;
    }

    // Use env client fallback
    if (credentialId === -1) {
      return this.envClient;
    }

    return this.getClient(credentialId);
  }

  /**
   * Get a client for a backup stream (for failover - doesn't check user access)
   * This method finds ANY available credential for the channel's provider
   * Used when failing over to a backup channel from a different provider
   */
  async getClientForBackupStream(streamId: string): Promise<XtreamCodesClient | null> {
    console.log(`[IPTV-Backup] Looking for credential for backup stream ${streamId}`);

    // Look up the channel in the database to find its provider
    const [channel] = await db.select()
      .from(iptvChannels)
      .where(eq(iptvChannels.streamId, streamId))
      .limit(1);

    if (!channel) {
      console.log(`[IPTV-Backup] Channel ${streamId} not found in database`);
      return null;
    }

    const providerId = channel.providerId;
    console.log(`[IPTV-Backup] Channel ${streamId} belongs to provider ${providerId}`);

    // Get any active credential for this provider
    const providerCredentials = await db.select()
      .from(iptvCredentials)
      .where(and(
        eq(iptvCredentials.providerId, providerId),
        eq(iptvCredentials.isActive, true)
      ));

    if (providerCredentials.length === 0) {
      console.log(`[IPTV-Backup] No active credentials for provider ${providerId}`);
      return null;
    }

    // Find a credential with available capacity
    for (const cred of providerCredentials) {
      const activeStreams = await db.select()
        .from(activeIptvStreams)
        .where(eq(activeIptvStreams.credentialId, cred.id));

      console.log(`[IPTV-Backup] Credential ${cred.id} (${cred.name}): ${activeStreams.length}/${cred.maxConnections} streams`);

      if (activeStreams.length < cred.maxConnections) {
        console.log(`[IPTV-Backup] Using credential ${cred.id} (${cred.name}) for backup stream ${streamId}`);
        return this.getClient(cred.id);
      }
    }

    // If all credentials are at capacity, use the first one anyway for backup (best effort)
    console.log(`[IPTV-Backup] All credentials at capacity, using first available for backup`);
    return this.getClient(providerCredentials[0].id);
  }

  /**
   * Clear user channel cache
   */
  clearUserCache(userId: number): void {
    this.userChannelCache.delete(userId);
  }

  /**
   * Reload a specific credential (after update)
   */
  async reloadCredential(credentialId: number): Promise<void> {
    // Remove existing client
    this.clients.delete(credentialId);

    // Reload from database
    const [cred] = await db.select().from(iptvCredentials).where(eq(iptvCredentials.id, credentialId));
    if (cred && cred.isActive) {
      try {
        const decrypted = this.decryptCredential(cred);
        const client = new XtreamCodesClient({
          serverUrl: decrypted.serverUrl,
          username: decrypted.username,
          password: decrypted.password,
          credentialId: cred.id
        });
        this.clients.set(cred.id, client);
      } catch (error) {
        console.error(`Failed to reload credential ${credentialId}:`, error);
      }
    }

    // Clear all user caches since credentials changed
    this.userChannelCache.clear();
  }

  /**
   * Remove a credential from the manager
   */
  removeCredential(credentialId: number): void {
    this.clients.delete(credentialId);
    this.userChannelCache.clear();
  }

  /**
   * Check if service is healthy
   */
  async isHealthy(): Promise<boolean> {
    // Check env client
    if (this.envClient) {
      const healthy = await this.envClient.isHealthy();
      if (healthy) return true;
    }

    // Check at least one database credential
    for (const client of Array.from(this.clients.values())) {
      const healthy = await client.isHealthy();
      if (healthy) return true;
    }

    return false;
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if any credentials are configured
   */
  isConfigured(): boolean {
    return this.envClient !== null || this.clients.size > 0;
  }

  /**
   * Get env client (for backward compatibility)
   */
  getEnvClient(): XtreamCodesClient | null {
    return this.envClient;
  }

  // =====================================================
  // Backward compatibility methods (delegate to env client or first available)
  // =====================================================

  /**
   * Get default client (env client or first database client)
   */
  private getDefaultClient(): XtreamCodesClient | null {
    if (this.envClient) return this.envClient;
    const firstClient = this.clients.values().next().value;
    return firstClient || null;
  }

  async reinitialize(): Promise<void> {
    this.clients.clear();
    this.userChannelCache.clear();
    this.initialized = false;
    await this.initialize();
  }

  async forceRefreshCache(): Promise<void> {
    this.userChannelCache.clear();
    // Force refresh all clients
    for (const client of Array.from(this.clients.values())) {
      try {
        await client.getChannels();
      } catch (error) {
        console.error('Error refreshing client cache:', error);
      }
    }
    if (this.envClient) {
      try {
        await this.envClient.getChannels();
      } catch (error) {
        console.error('Error refreshing env client cache:', error);
      }
    }
  }

  // Legacy methods for backward compatibility with existing code
  async getCategories(): Promise<XtreamCategory[]> {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getCategories();
  }

  async getChannels(categoryId?: string): Promise<IPTVChannel[]> {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getChannels(categoryId);
  }

  async getEPG(streamId: string, limit?: number): Promise<XtreamEPGListing[]> {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getEPG(streamId, limit);
  }

  async getShortEPG(streamId: string): Promise<{ now?: XtreamEPGListing; next?: XtreamEPGListing }> {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getShortEPG(streamId);
  }

  getStreamUrl(streamId: string, extension: string = 'ts'): string {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getStreamUrl(streamId, extension);
  }

  getHLSStreamUrl(streamId: string): string {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getHLSStreamUrl(streamId);
  }

  getM3UUrl(): string {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getM3UUrl();
  }

  getXMLTVUrl(): string {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getXMLTVUrl();
  }

  getServerUrl(): string {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getServerUrl();
  }

  getUsername(): string {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getUsername();
  }

  getPassword(): string {
    const client = this.getDefaultClient();
    if (!client) throw new Error('No IPTV credentials configured');
    return client.getPassword();
  }

  getAuthInfo(): any {
    const client = this.getDefaultClient();
    if (!client) return null;
    return client.getAuthInfo();
  }

  /**
   * Get all event/PPV channels from the database
   * BYPASSES: isEnabled flag and channel package restrictions
   * These are temporary channels that can't be manually managed
   */
  async getEventChannels(): Promise<{
    id: number;
    streamId: string;
    name: string;
    logo: string | null;
    providerId: number;
  }[]> {
    // Query all channels that match the event/PPV naming pattern
    // Pattern: "XX (Network XXX) | ..." (e.g., "US (Paramount 050) | ...")
    const channels = await db.select({
      id: iptvChannels.id,
      streamId: iptvChannels.streamId,
      name: iptvChannels.name,
      logo: iptvChannels.logo,
      providerId: iptvChannels.providerId,
    })
      .from(iptvChannels);

    // Filter in JavaScript since SQL regex varies by database
    // Pattern must match: XX (Network XXX) | ...
    const eventPattern = /^[A-Z]{2}\s*\([^)]+\s+\d+\)\s*\|/;
    return channels.filter(ch => eventPattern.test(ch.name));
  }
}

// Export singleton manager instance (replaces old singleton service)
export const xtreamCodesManager = new XtreamCodesManager();

// Backward compatibility: alias for existing code
export const xtreamCodesService = xtreamCodesManager;

// Legacy class export for type compatibility
export class XtreamCodesService extends XtreamCodesManager {}
