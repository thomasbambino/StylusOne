import axios from 'axios';
import { IService } from './interfaces';
import * as xml2js from 'xml2js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for TV program/episode information
 */
export interface EPGProgram {
  channelId: string;
  channelName: string;
  title: string;
  episodeTitle?: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  season?: number;
  episode?: number;
  thumbnail?: string;
  rating?: string;
  isNew?: boolean;
  isLive?: boolean;
  categories?: string[];
}

/**
 * Interface for channel mapping between HDHomeRun and EPG data
 */
export interface ChannelMapping {
  hdhrChannelNumber: string;
  hdhrChannelName: string;
  epgChannelId?: string;
  tvMazeShowId?: number;
}

/**
 * EPG (Electronic Program Guide) Service
 * Fetches and manages TV guide data from various sources
 */
export class EPGService implements IService {
  private initialized: boolean = false;
  private programCache: Map<string, EPGProgram[]> = new Map();
  private lastFetch: Date | null = null;
  private xmltvPath: string;

  constructor() {
    // Only use real data sources - EPGShare, then fallback to no data
    const epgSharePath = path.join(process.cwd(), 'data', 'epgshare_guide.xmltv');
    const fallbackPath = path.join(process.cwd(), 'data', 'xmlguide.xmltv');
    
    if (fs.existsSync(epgSharePath)) {
      this.xmltvPath = epgSharePath;
      console.log(`EPG Service using real data from: ${this.xmltvPath}`);
    } else if (fs.existsSync(fallbackPath)) {
      this.xmltvPath = fallbackPath;
      console.log(`EPG Service using fallback data from: ${this.xmltvPath}`);
    } else {
      this.xmltvPath = '';
      console.log('EPG Service: No real data available - channels will show blank');
    }
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    try {
      // Only load real XMLTV data if available
      if (this.xmltvPath && fs.existsSync(this.xmltvPath)) {
        await this.loadXMLTVData();
        this.initialized = true;
        console.log('EPG service initialized with real XMLTV data');
      } else {
        // No real data available - initialize with empty cache
        this.programCache.clear();
        this.initialized = true;
        console.log('EPG service initialized with no data - channels will show blank');
      }
    } catch (error) {
      console.error('Failed to initialize EPG service:', error);
      this.initialized = false;
    }
  }

  /**
   * Reinitialize the service
   */
  async reinitialize(): Promise<void> {
    this.programCache.clear();
    this.lastFetch = null;
    await this.initialize();
  }

  /**
   * Check if the service is healthy
   */
  async isHealthy(): Promise<boolean> {
    return this.initialized;
  }

  /**
   * Load EPG data from XMLTV file (if available from Zap2it scraper)
   */
  private async loadXMLTVData(): Promise<void> {
    try {
      console.log(`Loading XMLTV data from: ${this.xmltvPath}`);
      const xmlData = fs.readFileSync(this.xmltvPath, 'utf-8');
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlData);
      
      if (result.tv && result.tv.programme) {
        const programs: EPGProgram[] = [];
        
        for (const prog of result.tv.programme) {
          const program: EPGProgram = {
            channelId: prog.$.channel,
            channelName: prog.$.channel, // Will be mapped later
            title: prog.title?.[0]?._ || prog.title?.[0] || 'Unknown',
            episodeTitle: prog['sub-title']?.[0]?._ || prog['sub-title']?.[0],
            description: prog.desc?.[0]?._ || prog.desc?.[0],
            startTime: this.parseXMLTVDate(prog.$.start),
            endTime: this.parseXMLTVDate(prog.$.stop),
            thumbnail: prog.icon?.[0]?.$.src,
            categories: prog.category?.map(c => c._ || c),
            isLive: this.isCurrentTime(this.parseXMLTVDate(prog.$.start), this.parseXMLTVDate(prog.$.stop))
          };

          // Parse episode numbers if available
          const episodeNum = prog['episode-num']?.find(e => e.$.system === 'xmltv_ns');
          if (episodeNum) {
            const match = episodeNum._.match(/(\d+)\.(\d+)/);
            if (match) {
              program.season = parseInt(match[1]) + 1;
              program.episode = parseInt(match[2]) + 1;
            }
          }

          programs.push(program);
        }

        // Group programs by channel
        for (const program of programs) {
          const channelPrograms = this.programCache.get(program.channelId) || [];
          channelPrograms.push(program);
          this.programCache.set(program.channelId, channelPrograms);
        }

        this.lastFetch = new Date();
        console.log(`Loaded ${programs.length} programs from XMLTV for ${this.programCache.size} channels`);
      }
    } catch (error) {
      console.error('Error loading XMLTV data:', error);
      throw error;
    }
  }

  /**
   * Check if a program is currently airing
   */
  private isCurrentTime(startTime: Date, endTime: Date): boolean {
    const now = new Date();
    return startTime <= now && now < endTime;
  }

  /**
   * Parse XMLTV date format (YYYYMMDDHHmmss +HHMM)
   */
  private parseXMLTVDate(dateStr: string): Date {
    const year = dateStr.substr(0, 4);
    const month = dateStr.substr(4, 2);
    const day = dateStr.substr(6, 2);
    const hour = dateStr.substr(8, 2);
    const minute = dateStr.substr(10, 2);
    const second = dateStr.substr(12, 2);
    
    // Extract timezone offset (e.g., " -0400")
    const timezonePart = dateStr.substr(14).trim();
    let timezoneOffset = '';
    
    if (timezonePart.match(/^[+-]\d{4}$/)) {
      // Convert "+0000" or "-0400" to "+00:00" or "-04:00" format
      const sign = timezonePart.substr(0, 1);
      const hours = timezonePart.substr(1, 2);
      const minutes = timezonePart.substr(3, 2);
      timezoneOffset = `${sign}${hours}:${minutes}`;
    } else {
      // Default to UTC if no timezone specified
      timezoneOffset = '+00:00';
    }
    
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${timezoneOffset}`);
  }


  /**
   * Get current program for a channel
   */
  getCurrentProgram(channelId: string): EPGProgram | null {
    const now = new Date();
    
    // Try direct lookup first
    let programs = this.programCache.get(channelId) || [];
    
    // If no programs found, try using channel mapping
    if (programs.length === 0) {
      const mappedChannelId = this.mapChannel(channelId);
      if (mappedChannelId) {
        programs = this.programCache.get(mappedChannelId) || [];
      }
    }
    
    return programs.find(p => 
      p.startTime <= now && p.endTime > now
    ) || null;
  }

  /**
   * Get upcoming programs for a channel
   */
  getUpcomingPrograms(channelId: string, hours: number = 3): EPGProgram[] {
    const now = new Date();
    const endTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
    
    // Try direct lookup first
    let programs = this.programCache.get(channelId) || [];
    
    // If no programs found, try using channel mapping
    if (programs.length === 0) {
      const mappedChannelId = this.mapChannel(channelId);
      if (mappedChannelId) {
        programs = this.programCache.get(mappedChannelId) || [];
      }
    }
    
    return programs.filter(p => 
      p.startTime >= now && p.startTime < endTime
    ).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }

  /**
   * Map HDHomeRun channel to EPG channel ID
   */
  mapChannel(hdhrChannelName: string): string | null {
    // Map HDHomeRun channel names to San Diego OTA channel IDs
    const channelMap: Record<string, string> = {
      // Major San Diego broadcast networks  
      'KGTV-HD': '10.1',  // ABC San Diego
      'KGTV': '10.1',     // ABC San Diego
      'KFMB-HD': '8.1',   // CBS San Diego  
      'KFMB': '8.1',      // CBS San Diego
      'KNSD-DT': '39.1',  // NBC San Diego
      'KNSD': '39.1',     // NBC San Diego
      'KSWB-HD': '69.1',  // FOX San Diego
      'KSWB': '69.1',     // FOX San Diego
      'KUSI-HD': '51.1',  // KUSI Independent
      'KUSI': '51.1',     // KUSI Independent
      
      // PBS San Diego
      'KPBSHD': '15.1',   // PBS San Diego
      'KPBS': '15.1',     // PBS San Diego
      'KPBS-HD': '15.1',  // PBS San Diego
      'KPBS2': '15.2',    // PBS Kids
      'PBSKIDS': '15.2',  // PBS Kids
      'CREATE': '15.3',   // Create TV
      
      // Digital subchannels and cable networks
      'ION': '7.1',       // ION Television
      'QVC': '7.2',       // QVC Shopping
      'HSN': '7.3',       // HSN Shopping
      'Grit': '69.2',     // Grit TV
      'Laff': '69.3',     // Laff TV
      'Bounce': '39.2',   // Bounce TV
      'CourtTV': '39.3',  // Court TV
      'Court TV': '39.3', // Court TV (alt name)
      'TrueReal': '39.4', // TrueReal
      'AntennaTV': '8.2', // Antenna TV
      'Antenna': '8.2',   // Antenna TV (alt name)
      'Rewind': '8.2',    // Map to Antenna TV
      'Decades': '8.3',   // Decades
      'Mystery': '39.3',  // Map to Court TV
    };

    return channelMap[hdhrChannelName] || null;
  }

  /**
   * Get all available channels from EPG data
   */
  getChannels(): string[] {
    return Array.from(this.programCache.keys());
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return true; // Always configured, uses free APIs or local files
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Refresh EPG data if stale
   */
  async refreshIfNeeded(): Promise<void> {
    if (!this.lastFetch || 
        new Date().getTime() - this.lastFetch.getTime() > 6 * 60 * 60 * 1000) { // 6 hours
      await this.reinitialize();
    }
  }
}