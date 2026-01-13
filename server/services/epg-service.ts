import axios from 'axios';
import { IService } from './interfaces';
import * as xml2js from 'xml2js';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { tmdbService } from './tmdb-service';

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
      // Load HDHomeRun XMLTV data if available
      if (this.xmltvPath && fs.existsSync(this.xmltvPath)) {
        await this.loadXMLTVData();
      }

      // Load IPTV EPG data from Xtream Codes
      await this.loadIPTVEPGData();

      this.initialized = true;
      console.log(`EPG service initialized with ${this.programCache.size} channels`);
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
          // Clean title by removing superscript Unicode characters (ᴺᵉʷ, etc.) but detect them first
          const rawTitle = prog.title?.[0]?._ || prog.title?.[0] || 'Unknown';
          const hasSuperscriptNew = /[\u1D2C-\u1D6A\u02B0-\u02FF]+/.test(rawTitle);
          const cleanTitle = rawTitle
            .replace(/[\u1D2C-\u1D6A\u02B0-\u02FF]/g, '') // Remove superscript characters
            .trim();

          const program: EPGProgram = {
            channelId: prog.$.channel,
            channelName: prog.$.channel, // Will be mapped later
            title: cleanTitle,
            episodeTitle: prog['sub-title']?.[0]?._ || prog['sub-title']?.[0],
            description: prog.desc?.[0]?._ || prog.desc?.[0],
            startTime: this.parseXMLTVDate(prog.$.start),
            endTime: this.parseXMLTVDate(prog.$.stop),
            thumbnail: prog.icon?.[0]?.$.src,
            categories: prog.category?.map(c => c._ || c),
            isNew: hasSuperscriptNew,
            isLive: this.isCurrentTime(this.parseXMLTVDate(prog.$.start), this.parseXMLTVDate(prog.$.stop))
          };

          // Parse episode numbers if available
          const episodeNum = prog['episode-num']?.find((e: any) => e.$?.system === 'xmltv_ns');
          if (episodeNum) {
            const epText = episodeNum._ || episodeNum;
            const match = epText.match(/(\d+)\.(\d+)/);
            if (match) {
              program.season = parseInt(match[1]) + 1;
              program.episode = parseInt(match[2]) + 1;
            }
          }

          // Parse rating if available
          const ratingEl = prog.rating?.[0];
          if (ratingEl) {
            program.rating = ratingEl.value?.[0] || ratingEl._ || ratingEl;
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
    let matchMethod = 'none';

    // Try direct lookup first
    let programs = this.programCache.get(channelId) || [];
    if (programs.length > 0) matchMethod = 'direct';

    // If no programs found, try using channel mapping
    if (programs.length === 0) {
      const mappedChannelId = this.mapChannel(channelId);
      if (mappedChannelId) {
        programs = this.programCache.get(mappedChannelId) || [];
        if (programs.length > 0) matchMethod = `mapped:${mappedChannelId}`;
      }
    }

    // If still no programs, try fuzzy matching by channel name
    if (programs.length === 0) {
      const normalizedName = channelId.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [epgChannelId, channelPrograms] of this.programCache.entries()) {
        const normalizedEpgId = epgChannelId.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedEpgId.includes(normalizedName) || normalizedName.includes(normalizedEpgId)) {
          programs = channelPrograms;
          matchMethod = `fuzzy:${epgChannelId}`;
          break;
        }
      }
    }

    const currentProgram = programs.find(p =>
      p.startTime <= now && p.endTime > now
    ) || null;

    // Log EPG lookup result for debugging
    if (programs.length === 0) {
      console.log(`[EPG] No programs found for "${channelId}" (cache has ${this.programCache.size} channels)`);
    } else if (!currentProgram) {
      console.log(`[EPG] Found ${programs.length} programs for "${channelId}" via ${matchMethod}, but none current`);
    }

    return currentProgram;
  }

  /**
   * Get upcoming programs for a channel (includes currently playing program)
   * Returns immediately with cached TMDB thumbnails, queues missing ones for background fetch
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

    // Include currently playing program (endTime > now) plus upcoming programs (startTime < endTime)
    const upcomingPrograms = programs.filter(p =>
      p.endTime > now && p.startTime < endTime
    ).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    // Apply cached TMDB thumbnails only (no auto-queuing)
    if (tmdbService.isConfigured()) {
      for (const program of upcomingPrograms.slice(0, 10)) {
        if (!program.thumbnail) {
          const cached = tmdbService.getCachedImage(program.title);
          if (cached) {
            program.thumbnail = cached;
          }
        }
      }
    }

    return upcomingPrograms;
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

  /**
   * Load IPTV EPG data from Xtream Codes API
   */
  private async loadIPTVEPGData(): Promise<void> {
    try {
      const serverUrl = process.env.XTREAM_SERVER_URL;
      const username = process.env.XTREAM_USERNAME;
      const password = process.env.XTREAM_PASSWORD;

      if (!serverUrl || !username || !password) {
        console.log('IPTV credentials not configured, skipping IPTV EPG');
        return;
      }

      // Fetch IPTV EPG in XMLTV format using correct Xtream Codes API endpoint
      const epgUrl = `${serverUrl}/xmltv.php?username=${username}&password=${password}`;
      console.log(`Fetching IPTV EPG from: ${epgUrl}`);

      const response = await fetch(epgUrl);
      if (!response.ok) {
        console.error(`Failed to fetch IPTV EPG: ${response.status}`);
        return;
      }

      const xmlData = await response.text();
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlData);

      if (result.tv && result.tv.programme) {
        const programs: EPGProgram[] = [];

        for (const prog of result.tv.programme) {
          // Clean title by removing superscript Unicode characters (ᴺᵉʷ, etc.) but detect them first
          const rawTitle = prog.title?.[0]?._ || prog.title?.[0] || 'Unknown';
          const hasSuperscriptNew = /[\u1D2C-\u1D6A\u02B0-\u02FF]+/.test(rawTitle);
          const cleanTitle = rawTitle
            .replace(/[\u1D2C-\u1D6A\u02B0-\u02FF]/g, '') // Remove superscript characters
            .trim();

          const program: EPGProgram = {
            channelId: prog.$.channel,
            channelName: prog.$.channel,
            title: cleanTitle,
            episodeTitle: prog['sub-title']?.[0]?._ || prog['sub-title']?.[0],
            description: prog.desc?.[0]?._ || prog.desc?.[0],
            startTime: this.parseXMLTVDate(prog.$.start),
            endTime: this.parseXMLTVDate(prog.$.stop),
            thumbnail: prog.icon?.[0]?.$.src,
            categories: prog.category?.map(c => c._ || c),
            isNew: hasSuperscriptNew,
            isLive: this.isCurrentTime(this.parseXMLTVDate(prog.$.start), this.parseXMLTVDate(prog.$.stop))
          };

          // Parse episode numbers if available (xmltv_ns format: "season.episode.part")
          const episodeNum = prog['episode-num']?.find((e: any) => e.$?.system === 'xmltv_ns');
          if (episodeNum) {
            const epText = episodeNum._ || episodeNum;
            const match = epText.match(/(\d+)\.(\d+)/);
            if (match) {
              program.season = parseInt(match[1]) + 1; // xmltv_ns is 0-indexed
              program.episode = parseInt(match[2]) + 1;
            }
          }

          // Parse rating if available
          const ratingEl = prog.rating?.[0];
          if (ratingEl) {
            program.rating = ratingEl.value?.[0] || ratingEl._ || ratingEl;
          }

          programs.push(program);
        }

        // Group programs by channel
        const channelIds = new Set<string>();
        for (const program of programs) {
          channelIds.add(program.channelId);
          const channelPrograms = this.programCache.get(program.channelId) || [];
          channelPrograms.push(program);
          this.programCache.set(program.channelId, channelPrograms);
        }

        console.log(`Loaded ${programs.length} IPTV programs for ${channelIds.size} channels`);
        console.log(`Sample IPTV channel IDs:`, Array.from(channelIds).slice(0, 10).join(', '));
      }
    } catch (error) {
      console.error('Error loading IPTV EPG data:', error);
      // Don't throw - EPG is optional
    }
  }
}
