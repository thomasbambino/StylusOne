import axios from 'axios';
import { IService } from './interfaces';

/**
 * Interface for HD HomeRun device information
 */
export interface HDHomeRunDevice {
  DeviceID: string;
  LocalIP: string;
  BaseURL: string;
  LineupURL: string;
  FriendlyName: string;
  ModelNumber: string;
  FirmwareName: string;
  FirmwareVersion: string;
  DeviceAuth: string;
  TunerCount: number;
}

/**
 * Interface for HD HomeRun channel lineup
 */
export interface HDHomeRunChannel {
  GuideNumber: string;
  GuideName: string;
  URL: string;
  HD: boolean;
  Favorite: boolean;
  DRM: boolean;
}

/**
 * Interface for HD HomeRun tuner status
 */
export interface HDHomeRunTuner {
  Resource: string;
  InUse: boolean;
  VctNumber: string;
  VctName: string;
  Frequency: number;
  SignalStrengthPercent: number;
  SignalQualityPercent: number;
  SymbolQualityPercent: number;
  NetworkRate: number;
  TargetIP: string;
}

/**
 * HD HomeRun service for Live TV functionality
 */
export class HDHomeRunService implements IService {
  private baseUrl: string;
  private initialized: boolean = false;

  constructor() {
    this.baseUrl = process.env.HDHOMERUN_URL || '';
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (!this.baseUrl) {
      console.log('HD HomeRun URL not configured, skipping initialization');
      this.initialized = false;
      return;
    }

    try {
      // Test connection by getting device info
      await this.getDeviceInfo();
      this.initialized = true;
      console.log('HD HomeRun service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize HD HomeRun service:', error);
      this.initialized = false;
    }
  }

  /**
   * Reinitialize the service
   */
  async reinitialize(): Promise<void> {
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Check if the service is healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.baseUrl || !this.initialized) {
      return false;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/discover.json`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      console.error('HD HomeRun health check failed:', error);
      return false;
    }
  }

  /**
   * Get device information
   */
  async getDeviceInfo(): Promise<HDHomeRunDevice> {
    if (!this.baseUrl) {
      throw new Error('HD HomeRun URL not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/discover.json`, {
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching HD HomeRun device info:', error);
      throw new Error('Failed to fetch device information');
    }
  }

  /**
   * Get channel lineup
   */
  async getChannelLineup(): Promise<HDHomeRunChannel[]> {
    if (!this.baseUrl) {
      throw new Error('HD HomeRun URL not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/lineup.json`, {
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching HD HomeRun channel lineup:', error);
      throw new Error('Failed to fetch channel lineup');
    }
  }

  /**
   * Get tuner status
   */
  async getTunerStatus(): Promise<HDHomeRunTuner[]> {
    if (!this.baseUrl) {
      throw new Error('HD HomeRun URL not configured');
    }

    try {
      const deviceInfo = await this.getDeviceInfo();
      const tuners: HDHomeRunTuner[] = [];

      // Get status for each tuner using the correct HD HomeRun API
      for (let i = 0; i < deviceInfo.TunerCount; i++) {
        try {
          // HD HomeRun uses /status.json?tuner=N format
          const statusUrl = `${this.baseUrl}/status.json?tuner=${i}`;
          const response = await axios.get(statusUrl, {
            timeout: 5000
          });
          
          // Parse the HD HomeRun status response - it returns an array of all tuners
          const allTuners = response.data;
          const tunerData = allTuners.find(t => t.Resource === `tuner${i}`) || { Resource: `tuner${i}` };
          
          tuners.push({
            Resource: `tuner${i}`,
            InUse: !!(tunerData.VctNumber || tunerData.VctName || tunerData.Frequency > 0 || tunerData.TargetIP),
            VctNumber: tunerData.VctNumber || '',
            VctName: tunerData.VctName || '',
            Frequency: parseInt(tunerData.Frequency) || 0,
            SignalStrengthPercent: parseInt(tunerData.SignalStrengthPercent) || 0,
            SignalQualityPercent: parseInt(tunerData.SignalQualityPercent) || 0,
            SymbolQualityPercent: parseInt(tunerData.SymbolQualityPercent) || 0,
            NetworkRate: parseInt(tunerData.NetworkRate) || 0,
            TargetIP: tunerData.TargetIP || ''
          });
        } catch (error) {
          // If tuner status fails, add placeholder
          tuners.push({
            Resource: `tuner${i}`,
            InUse: false,
            VctNumber: '',
            VctName: '',
            Frequency: 0,
            SignalStrengthPercent: 0,
            SignalQualityPercent: 0,
            SymbolQualityPercent: 0,
            NetworkRate: 0,
            TargetIP: ''
          });
        }
      }

      return tuners;
    } catch (error) {
      console.error('Error fetching HD HomeRun tuner status:', error);
      throw new Error('Failed to fetch tuner status');
    }
  }

  /**
   * Get stream URL for a channel
   */
  getChannelStreamUrl(channel: string): string {
    if (!this.baseUrl) {
      throw new Error('HD HomeRun URL not configured');
    }

    // HDHomeRun streams are on port 5004
    const url = new URL(this.baseUrl);
    url.port = '5004';
    return `${url.origin}/auto/v${channel}`;
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}