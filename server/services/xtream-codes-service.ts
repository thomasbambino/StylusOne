import axios from 'axios';
import { IService } from './interfaces';

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
 * Xtream Codes API Service for IPTV functionality
 */
export class XtreamCodesService implements IService {
  private serverUrl: string;
  private username: string;
  private password: string;
  private initialized: boolean = false;
  private authInfo: any = null;

  // Cache storage
  private categoriesCache: XtreamCategory[] | null = null;
  private channelsCache: IPTVChannel[] | null = null;
  private cacheTimestamp: number = 0;
  private cacheExpirationMs: number = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.serverUrl = process.env.XTREAM_SERVER_URL || '';
    this.username = process.env.XTREAM_USERNAME || '';
    this.password = process.env.XTREAM_PASSWORD || '';
  }

  /**
   * Initialize the service by testing authentication and preloading data
   */
  async initialize(): Promise<void> {
    if (!this.serverUrl || !this.username || !this.password) {
      console.log('Xtream Codes credentials not configured, skipping initialization');
      this.initialized = false;
      return;
    }

    try {
      // Test authentication by getting user info
      this.authInfo = await this.authenticate();
      this.initialized = true;
      console.log('Xtream Codes service initialized successfully');
      console.log(`Server: ${this.serverUrl}`);
      console.log(`User: ${this.username}`);
      console.log(`Status: ${this.authInfo.user_info.status}`);
      console.log(`Expires: ${new Date(this.authInfo.user_info.exp_date * 1000).toLocaleString()}`);

      // Preload categories and channels into cache
      console.log('Preloading Xtream Codes data into cache...');
      await this.refreshCache();
      console.log(`Cached ${this.categoriesCache?.length || 0} categories and ${this.channelsCache?.length || 0} channels`);
    } catch (error) {
      console.error('Failed to initialize Xtream Codes service:', error);
      this.initialized = false;
    }
  }

  /**
   * Reinitialize the service and clear cache
   */
  async reinitialize(): Promise<void> {
    this.initialized = false;
    this.authInfo = null;
    this.categoriesCache = null;
    this.channelsCache = null;
    this.cacheTimestamp = 0;
    await this.initialize();
  }

  /**
   * Manually refresh the cache (useful for admin/maintenance)
   */
  async forceRefreshCache(): Promise<void> {
    if (!this.isConfigured() || !this.initialized) {
      throw new Error('Service not initialized');
    }
    await this.refreshCache();
  }

  /**
   * Check if the service is healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.isConfigured() || !this.initialized) {
      return false;
    }

    try {
      const info = await this.authenticate();
      return info.user_info.status === 'Active';
    } catch (error) {
      console.error('Xtream Codes health check failed:', error);
      return false;
    }
  }

  /**
   * Authenticate and get user info
   */
  private async authenticate(): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error('Xtream Codes credentials not configured');
    }

    try {
      const url = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}`;
      const response = await axios.get(url, { timeout: 10000 });

      if (!response.data || !response.data.user_info) {
        throw new Error('Invalid authentication response');
      }

      return response.data;
    } catch (error) {
      console.error('Error authenticating with Xtream Codes:', error);
      throw new Error('Failed to authenticate with Xtream Codes server');
    }
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

      // Fetch all live streams (without category filter for full cache)
      const streamsUrl = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}&action=get_live_streams`;
      const streamsResponse = await axios.get(streamsUrl, { timeout: 15000 });
      const streams: XtreamChannel[] = streamsResponse.data || [];

      // Convert to IPTVChannel format
      this.channelsCache = streams.map(stream => ({
        id: stream.stream_id.toString(),
        number: stream.num ? stream.num.toString() : stream.stream_id.toString(),
        name: stream.name,
        streamUrl: this.getHLSStreamUrl(stream.stream_id.toString()), // Use HLS for web playback
        logo: stream.stream_icon || '',
        epgId: stream.epg_channel_id || '',
        categoryName: stream.category_name || 'Unknown',
        categoryId: stream.category_id || '',
        hasArchive: stream.tv_archive === 1,
        archiveDays: stream.tv_archive_duration || 0
      }));

      this.cacheTimestamp = Date.now();
    } catch (error) {
      console.error('Error refreshing Xtream Codes cache:', error);
      throw error;
    }
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
   * Get live stream categories (from cache)
   */
  async getCategories(): Promise<XtreamCategory[]> {
    if (!this.isConfigured()) {
      throw new Error('Xtream Codes credentials not configured');
    }

    // Return from cache if valid
    if (this.isCacheValid() && this.categoriesCache) {
      return this.categoriesCache;
    }

    // Refresh cache if expired or empty
    try {
      await this.refreshCache();
      return this.categoriesCache || [];
    } catch (error) {
      console.error('Error fetching Xtream Codes categories:', error);
      // Return stale cache if available, otherwise throw
      if (this.categoriesCache) {
        console.warn('Returning stale cache due to refresh error');
        return this.categoriesCache;
      }
      throw new Error('Failed to fetch categories');
    }
  }

  /**
   * Get all live streams (channels)
   */
  async getLiveStreams(categoryId?: string): Promise<XtreamChannel[]> {
    if (!this.isConfigured()) {
      throw new Error('Xtream Codes credentials not configured');
    }

    try {
      let url = `${this.serverUrl}/player_api.php?username=${this.username}&password=${this.password}&action=get_live_streams`;

      if (categoryId) {
        url += `&category_id=${categoryId}`;
      }

      const response = await axios.get(url, { timeout: 15000 });
      return response.data || [];
    } catch (error) {
      console.error('Error fetching Xtream Codes live streams:', error);
      throw new Error('Failed to fetch live streams');
    }
  }

  /**
   * Get formatted channels for our app (from cache)
   */
  async getChannels(categoryId?: string): Promise<IPTVChannel[]> {
    if (!this.isConfigured()) {
      throw new Error('Xtream Codes credentials not configured');
    }

    // Refresh cache if not valid
    if (!this.isCacheValid()) {
      try {
        await this.refreshCache();
      } catch (error) {
        console.error('Error refreshing cache:', error);
        // Continue with stale cache if available
      }
    }

    // Return from cache
    if (!this.channelsCache) {
      return [];
    }

    // Filter by category if specified
    if (categoryId) {
      return this.channelsCache.filter(ch => ch.categoryId === categoryId);
    }

    return this.channelsCache;
  }

  /**
   * Get EPG data for a specific channel
   */
  async getEPG(streamId: string, limit?: number): Promise<XtreamEPGListing[]> {
    if (!this.isConfigured()) {
      throw new Error('Xtream Codes credentials not configured');
    }

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
    if (!this.isConfigured()) {
      throw new Error('Xtream Codes credentials not configured');
    }

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
   * Get M3U playlist URL
   */
  getM3UUrl(): string {
    if (!this.isConfigured()) {
      throw new Error('Xtream Codes credentials not configured');
    }
    return `${this.serverUrl}/get.php?username=${this.username}&password=${this.password}&type=m3u_plus&output=ts`;
  }

  /**
   * Get XMLTV EPG URL
   */
  getXMLTVUrl(): string {
    if (!this.isConfigured()) {
      throw new Error('Xtream Codes credentials not configured');
    }
    return `${this.serverUrl}/xmltv.php?username=${this.username}&password=${this.password}`;
  }

  /**
   * Get stream URL for a specific channel
   */
  getStreamUrl(streamId: string, extension: string = 'ts'): string {
    if (!this.isConfigured()) {
      throw new Error('Xtream Codes credentials not configured');
    }
    return `${this.serverUrl}/live/${this.username}/${this.password}/${streamId}.${extension}`;
  }

  /**
   * Get HLS stream URL for a specific channel (for web player)
   */
  getHLSStreamUrl(streamId: string): string {
    if (!this.isConfigured()) {
      throw new Error('Xtream Codes credentials not configured');
    }
    return `${this.serverUrl}/live/${this.username}/${this.password}/${streamId}.m3u8`;
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return !!(this.serverUrl && this.username && this.password);
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get authentication info (if initialized)
   */
  getAuthInfo(): any {
    return this.authInfo;
  }
}

// Export singleton instance
export const xtreamCodesService = new XtreamCodesService();
