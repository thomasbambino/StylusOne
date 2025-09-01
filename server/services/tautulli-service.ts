import axios from 'axios';
import { IService } from './interfaces';

/**
 * Tautulli service for monitoring Plex server activity
 */
export class TautulliService implements IService {
  private baseUrl: string;
  private apiKey: string;
  private initialized: boolean = false;

  constructor() {
    this.baseUrl = process.env.TAUTULLI_URL || '';
    this.apiKey = process.env.TAUTULLI_API_KEY || '';
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.baseUrl && this.apiKey) {
      try {
        // Test API connection
        const response = await axios.get(`${this.baseUrl}/api/v2`, {
          params: {
            apikey: this.apiKey,
            cmd: 'get_server_info'
          },
          timeout: 10000
        });
        
        if (response.data.response.result === 'success') {
          this.initialized = true;
          console.log('Tautulli Service initialized successfully');
        } else {
          throw new Error('API test failed');
        }
      } catch (error) {
        console.error('Failed to initialize Tautulli Service:', error);
        console.log('Tautulli Service will continue without connection - functionality will be limited');
      }
    } else {
      console.warn('Tautulli Service not fully configured - missing URL or API key');
    }
  }

  /**
   * Check if service is healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.initialized) return false;
    
    try {
      const response = await axios.get(`${this.baseUrl}/api/v2`, {
        params: {
          apikey: this.apiKey,
          cmd: 'get_server_info'
        },
        timeout: 5000
      });
      return response.data.response.result === 'success';
    } catch (error) {
      return false;
    }
  }

  /**
   * Make API call to Tautulli
   */
  private async makeAPICall(command: string, params: any = {}): Promise<any> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Tautulli not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/api/v2`, {
        params: {
          apikey: this.apiKey,
          cmd: command,
          ...params
        },
        timeout: 10000
      });

      if (response.data.response.result === 'success') {
        return response.data.response.data;
      } else {
        throw new Error(`API call failed: ${response.data.response.message}`);
      }
    } catch (error) {
      console.error(`Tautulli API call failed for command ${command}:`, error);
      throw error;
    }
  }

  /**
   * Get current activity
   */
  async getActivity(): Promise<any> {
    try {
      const result = await this.makeAPICall('get_activity');
      return { response: { data: result || { sessions: [] } } };
    } catch (error) {
      console.error('Failed to get Tautulli activity:', error);
      return { response: { data: { sessions: [] } } };
    }
  }

  /**
   * Get users
   */
  async getUsers(): Promise<any> {
    try {
      const result = await this.makeAPICall('get_users');
      return { response: { data: result || [] } };
    } catch (error) {
      console.error('Failed to get Tautulli users:', error);
      return { response: { data: [] } };
    }
  }

  /**
   * Get home stats
   */
  async getHomeStats(stat_type: string, time_range?: number): Promise<any> {
    try {
      const params: any = { stat_type };
      if (time_range) params.time_range = time_range;
      return await this.makeAPICall('get_home_stats', params);
    } catch (error) {
      console.error('Failed to get Tautulli home stats:', error);
      return [];
    }
  }

  /**
   * Get libraries
   */
  async getLibraries(): Promise<any> {
    try {
      const result = await this.makeAPICall('get_libraries');
      return { response: { data: result || [] } };
    } catch (error) {
      console.error('Failed to get Tautulli libraries:', error);
      return { response: { data: [] } };
    }
  }

  /**
   * Get library media info
   */
  async getLibraryMediaInfo(section_id: string, start?: number, length?: number): Promise<any> {
    try {
      const params: any = { section_id };
      if (start !== undefined) params.start = start;
      if (length !== undefined) params.length = length;
      return await this.makeAPICall('get_library_media_info', params);
    } catch (error) {
      console.error('Failed to get Tautulli library media info:', error);
      return { data: [] };
    }
  }

  /**
   * Get history
   */
  async getHistory(user?: string, start?: number, length?: number): Promise<any> {
    try {
      const params: any = {};
      if (user) params.user = user;
      if (start !== undefined) params.start = start;
      if (length !== undefined) params.length = length;
      const result = await this.makeAPICall('get_history', params);
      return { response: { data: result || { data: [] } } };
    } catch (error) {
      console.error('Failed to get Tautulli history:', error);
      return { response: { data: { data: [] } } };
    }
  }

  /**
   * Get logs
   */
  async getLogs(params?: any): Promise<any> {
    try {
      const result = await this.makeAPICall('get_logs', params);
      return { response: { data: result } };
    } catch (error) {
      console.error('Failed to get Tautulli logs:', error);
      return { response: { data: { data: [] } } };
    }
  }

  async getRecentlyAdded(count: number = 10): Promise<any> {
    try {
      const result = await this.makeAPICall('get_recently_added', { count });
      return { response: { data: result || { recently_added: [] } } };
    } catch (error) {
      console.error('Failed to get recently added:', error);
      return { response: { data: { recently_added: [] } } };
    }
  }

  async getPlaysByDate(timeRange?: number): Promise<any> {
    try {
      const result = await this.makeAPICall('get_plays_by_date', { 
        time_range: timeRange || 30 
      });
      return { response: { data: result || { series: [] } } };
    } catch (error) {
      console.error('Failed to get plays by date:', error);
      return { response: { data: { series: [] } } };
    }
  }

  async testConnection(): Promise<boolean> {
    return await this.isHealthy();
  }

  async getServerInfo(): Promise<any> {
    try {
      const result = await this.makeAPICall('get_server_info');
      return result;
    } catch (error) {
      console.error('Failed to get server info:', error);
      return null;
    }
  }
}

// Export singleton instance
export const tautulliService = new TautulliService();