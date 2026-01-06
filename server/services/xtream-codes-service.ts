import axios from 'axios';
import { IService } from './interfaces';
import { db } from '../db';
import { iptvCredentials, planIptvCredentials, activeIptvStreams, userSubscriptions, subscriptionPlans } from '@shared/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { decrypt, maskCredential } from '../utils/encryption';

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
  private cacheExpirationMs: number = 30000; // 30 second cache

  constructor(credentials: { serverUrl: string; username: string; password: string; credentialId?: number }) {
    this.serverUrl = credentials.serverUrl;
    this.username = credentials.username;
    this.password = credentials.password;
    this.credentialId = credentials.credentialId || null;
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
      for (const cat of this.categoriesCache) {
        if (cat.category_id && cat.category_name) {
          categoryNameMap.set(String(cat.category_id), cat.category_name);
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
  private userCacheExpiration: number = 30000; // 30 seconds

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
      const credentials = await db.select().from(iptvCredentials).where(eq(iptvCredentials.isActive, true));

      for (const cred of credentials) {
        try {
          const decrypted = this.decryptCredential(cred);
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
   */
  private decryptCredential(cred: typeof iptvCredentials.$inferSelect): DecryptedCredential {
    return {
      id: cred.id,
      name: cred.name,
      serverUrl: decrypt(cred.serverUrl),
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
      const decrypted = this.decryptCredential(cred);
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
   * Get merged channels from all credentials a user has access to
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

    // Sort by channel number/name
    mergedChannels.sort((a, b) => {
      const numA = parseInt(a.number) || 0;
      const numB = parseInt(b.number) || 0;
      if (numA !== numB) return numA - numB;
      return a.name.localeCompare(b.name);
    });

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
   * Get merged categories from all credentials a user has access to
   */
  async getMergedCategories(userId: number): Promise<XtreamCategory[]> {
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
   */
  async selectCredentialForStream(userId: number, streamId: string): Promise<number | null> {
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
}

// Export singleton manager instance (replaces old singleton service)
export const xtreamCodesManager = new XtreamCodesManager();

// Backward compatibility: alias for existing code
export const xtreamCodesService = xtreamCodesManager;

// Legacy class export for type compatibility
export class XtreamCodesService extends XtreamCodesManager {}
