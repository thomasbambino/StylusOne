import { IService } from './interfaces';
import * as xml2js from 'xml2js';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { tmdbService } from './tmdb-service';

// EPG cache directory and file
const EPG_CACHE_DIR = path.join(process.cwd(), 'data', 'epg-cache');
const EPG_CACHE_FILE = path.join(EPG_CACHE_DIR, 'epg_programs.json');

// Ensure cache directory exists
if (!fs.existsSync(EPG_CACHE_DIR)) {
  fs.mkdirSync(EPG_CACHE_DIR, { recursive: true });
}

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

// Serializable version for disk storage
interface SerializedEPGProgram {
  channelId: string;
  channelName: string;
  title: string;
  episodeTitle?: string;
  description?: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  season?: number;
  episode?: number;
  thumbnail?: string;
  rating?: string;
  isNew?: boolean;
  isLive?: boolean;
  categories?: string[];
}

interface EPGCacheData {
  lastFetch: string | null;
  lastCleanup: string | null;
  programs: { [channelId: string]: SerializedEPGProgram[] };
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
 * Stores 7 days of EPG data locally, rate-limits provider fetches
 */
export class EPGService implements IService {
  private initialized: boolean = false;
  private programCache: Map<string, EPGProgram[]> = new Map();
  private lastFetch: Date | null = null;
  private lastCleanup: Date | null = null;
  private xmltvPath: string;
  private refreshIntervalId: NodeJS.Timeout | null = null;

  // Configuration
  private readonly DAYS_TO_KEEP = 7;
  private readonly REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours between fetches
  private readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Cleanup every hour

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
      console.log('EPG Service: No local XMLTV file');
    }
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    try {
      // First, try to load from disk cache
      const loadedFromDisk = this.loadFromDisk();

      if (loadedFromDisk) {
        console.log(`[EPG] Loaded ${this.programCache.size} channels from disk cache`);
        this.initialized = true;

        // Check if we need to fetch fresh data
        const hoursSinceLastFetch = this.lastFetch
          ? (Date.now() - this.lastFetch.getTime()) / (1000 * 60 * 60)
          : Infinity;

        if (hoursSinceLastFetch > 6) {
          console.log(`[EPG] Cache is ${hoursSinceLastFetch.toFixed(1)} hours old, scheduling refresh`);
          // Fetch in background, don't block initialization
          setTimeout(() => this.fetchAndMergeEPGData(), 5000);
        }
      } else {
        // No disk cache, need to fetch
        console.log('[EPG] No disk cache found, fetching from provider...');

        // Load local XMLTV if available
        if (this.xmltvPath && fs.existsSync(this.xmltvPath)) {
          await this.loadXMLTVData();
        }

        // Fetch from IPTV provider
        await this.fetchAndMergeEPGData();
        this.initialized = true;
      }

      // Start background refresh interval
      this.startBackgroundRefresh();

      console.log(`[EPG] Service initialized with ${this.programCache.size} channels, ${this.getTotalProgramCount()} programs`);
    } catch (error) {
      console.error('[EPG] Failed to initialize:', error);
      this.initialized = false;
    }
  }

  /**
   * Start background refresh interval
   */
  private startBackgroundRefresh(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }

    // Refresh every 6 hours
    this.refreshIntervalId = setInterval(async () => {
      console.log('[EPG] Background refresh triggered');
      await this.fetchAndMergeEPGData();
    }, this.REFRESH_INTERVAL_MS);

    // Also run cleanup periodically
    setInterval(() => {
      this.cleanupOldPrograms();
    }, this.CLEANUP_INTERVAL_MS);

    console.log('[EPG] Background refresh scheduled every 6 hours');
  }

  /**
   * Get total program count across all channels
   */
  private getTotalProgramCount(): number {
    let count = 0;
    for (const programs of this.programCache.values()) {
      count += programs.length;
    }
    return count;
  }

  /**
   * Save cache to disk
   */
  private saveToDisk(): void {
    try {
      const cacheData: EPGCacheData = {
        lastFetch: this.lastFetch?.toISOString() || null,
        lastCleanup: this.lastCleanup?.toISOString() || null,
        programs: {}
      };

      // Convert Map to serializable object
      for (const [channelId, programs] of this.programCache.entries()) {
        cacheData.programs[channelId] = programs.map(p => ({
          ...p,
          startTime: p.startTime instanceof Date ? p.startTime.toISOString() : p.startTime,
          endTime: p.endTime instanceof Date ? p.endTime.toISOString() : p.endTime
        }));
      }

      fs.writeFileSync(EPG_CACHE_FILE, JSON.stringify(cacheData), 'utf-8');
      console.log(`[EPG] Saved ${this.programCache.size} channels, ${this.getTotalProgramCount()} programs to disk`);
    } catch (error) {
      console.error('[EPG] Error saving to disk:', error);
    }
  }

  /**
   * Load cache from disk
   */
  private loadFromDisk(): boolean {
    try {
      if (!fs.existsSync(EPG_CACHE_FILE)) {
        return false;
      }

      const data: EPGCacheData = JSON.parse(fs.readFileSync(EPG_CACHE_FILE, 'utf-8'));

      this.lastFetch = data.lastFetch ? new Date(data.lastFetch) : null;
      this.lastCleanup = data.lastCleanup ? new Date(data.lastCleanup) : null;

      // Convert serialized programs back to EPGProgram with Date objects
      this.programCache.clear();
      for (const [channelId, programs] of Object.entries(data.programs)) {
        const parsed = programs.map(p => ({
          ...p,
          startTime: new Date(p.startTime),
          endTime: new Date(p.endTime)
        }));
        this.programCache.set(channelId, parsed);
      }

      return true;
    } catch (error) {
      console.error('[EPG] Error loading from disk:', error);
      return false;
    }
  }

  /**
   * Fetch EPG data from provider and merge with existing cache
   */
  private async fetchAndMergeEPGData(): Promise<void> {
    try {
      const serverUrl = process.env.XTREAM_SERVER_URL;
      const username = process.env.XTREAM_USERNAME;
      const password = process.env.XTREAM_PASSWORD;

      if (!serverUrl || !username || !password) {
        console.log('[EPG] IPTV credentials not configured, skipping fetch');
        return;
      }

      const epgUrl = `${serverUrl}/xmltv.php?username=${username}&password=${password}`;
      console.log('[EPG] Fetching from provider (rate-limited)...');

      const response = await fetch(epgUrl, { timeout: 60000 });
      if (!response.ok) {
        console.error(`[EPG] Failed to fetch: ${response.status}`);
        return;
      }

      const xmlData = await response.text();
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlData);

      if (!result.tv || !result.tv.programme) {
        console.log('[EPG] No programs in response');
        return;
      }

      const now = new Date();
      const sevenDaysFromNow = new Date(now.getTime() + this.DAYS_TO_KEEP * 24 * 60 * 60 * 1000);
      let newProgramCount = 0;
      let mergedProgramCount = 0;

      // Parse new programs
      const newProgramsByChannel = new Map<string, EPGProgram[]>();

      for (const prog of result.tv.programme) {
        const startTime = this.parseXMLTVDate(prog.$.start);
        const endTime = this.parseXMLTVDate(prog.$.stop);

        // Only keep programs within our 7-day window
        if (endTime < now || startTime > sevenDaysFromNow) {
          continue;
        }

        const rawTitle = prog.title?.[0]?._ || prog.title?.[0] || 'Unknown';
        const hasSuperscriptNew = /[\u1D2C-\u1D6A\u02B0-\u02FF]+/.test(rawTitle);
        const cleanTitle = rawTitle.replace(/[\u1D2C-\u1D6A\u02B0-\u02FF]/g, '').trim();

        const program: EPGProgram = {
          channelId: prog.$.channel,
          channelName: prog.$.channel,
          title: cleanTitle,
          episodeTitle: prog['sub-title']?.[0]?._ || prog['sub-title']?.[0],
          description: prog.desc?.[0]?._ || prog.desc?.[0],
          startTime,
          endTime,
          thumbnail: prog.icon?.[0]?.$.src,
          categories: prog.category?.map((c: any) => c._ || c),
          isNew: hasSuperscriptNew,
          isLive: this.isCurrentTime(startTime, endTime)
        };

        // Parse episode numbers
        const episodeNum = prog['episode-num']?.find((e: any) => e.$?.system === 'xmltv_ns');
        if (episodeNum) {
          const epText = episodeNum._ || episodeNum;
          const match = epText.match(/(\d+)\.(\d+)/);
          if (match) {
            program.season = parseInt(match[1]) + 1;
            program.episode = parseInt(match[2]) + 1;
          }
        }

        // Parse rating
        const ratingEl = prog.rating?.[0];
        if (ratingEl) {
          program.rating = ratingEl.value?.[0] || ratingEl._ || ratingEl;
        }

        const channelPrograms = newProgramsByChannel.get(program.channelId) || [];
        channelPrograms.push(program);
        newProgramsByChannel.set(program.channelId, channelPrograms);
        newProgramCount++;
      }

      // Merge with existing cache - keep existing programs, add new ones
      for (const [channelId, newPrograms] of newProgramsByChannel.entries()) {
        const existingPrograms = this.programCache.get(channelId) || [];

        // Create a set of existing program keys (startTime + title) to avoid duplicates
        const existingKeys = new Set(
          existingPrograms.map(p => `${p.startTime.getTime()}-${p.title}`)
        );

        // Add new programs that don't already exist
        for (const newProgram of newPrograms) {
          const key = `${newProgram.startTime.getTime()}-${newProgram.title}`;
          if (!existingKeys.has(key)) {
            existingPrograms.push(newProgram);
            mergedProgramCount++;
          }
        }

        // Sort by start time
        existingPrograms.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

        this.programCache.set(channelId, existingPrograms);
      }

      this.lastFetch = new Date();

      // Clean up old programs
      this.cleanupOldPrograms();

      // Save to disk
      this.saveToDisk();

      console.log(`[EPG] Fetched ${newProgramCount} programs, merged ${mergedProgramCount} new, total: ${this.getTotalProgramCount()}`);
    } catch (error) {
      console.error('[EPG] Error fetching from provider:', error);
    }
  }

  /**
   * Remove programs that have already ended
   */
  private cleanupOldPrograms(): void {
    const now = new Date();
    let removedCount = 0;

    for (const [channelId, programs] of this.programCache.entries()) {
      const validPrograms = programs.filter(p => {
        const endTime = p.endTime instanceof Date ? p.endTime : new Date(p.endTime);
        return endTime > now;
      });

      removedCount += programs.length - validPrograms.length;
      this.programCache.set(channelId, validPrograms);
    }

    if (removedCount > 0) {
      this.lastCleanup = new Date();
      console.log(`[EPG] Cleaned up ${removedCount} expired programs`);
      this.saveToDisk();
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
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Load EPG data from XMLTV file (if available from Zap2it scraper)
   */
  private async loadXMLTVData(): Promise<void> {
    try {
      console.log(`[EPG] Loading XMLTV data from: ${this.xmltvPath}`);
      const xmlData = fs.readFileSync(this.xmltvPath, 'utf-8');
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlData);

      if (result.tv && result.tv.programme) {
        const now = new Date();
        let programCount = 0;

        for (const prog of result.tv.programme) {
          const rawTitle = prog.title?.[0]?._ || prog.title?.[0] || 'Unknown';
          const hasSuperscriptNew = /[\u1D2C-\u1D6A\u02B0-\u02FF]+/.test(rawTitle);
          const cleanTitle = rawTitle.replace(/[\u1D2C-\u1D6A\u02B0-\u02FF]/g, '').trim();

          const startTime = this.parseXMLTVDate(prog.$.start);
          const endTime = this.parseXMLTVDate(prog.$.stop);

          // Skip past programs
          if (endTime < now) continue;

          const program: EPGProgram = {
            channelId: prog.$.channel,
            channelName: prog.$.channel,
            title: cleanTitle,
            episodeTitle: prog['sub-title']?.[0]?._ || prog['sub-title']?.[0],
            description: prog.desc?.[0]?._ || prog.desc?.[0],
            startTime,
            endTime,
            thumbnail: prog.icon?.[0]?.$.src,
            categories: prog.category?.map((c: any) => c._ || c),
            isNew: hasSuperscriptNew,
            isLive: this.isCurrentTime(startTime, endTime)
          };

          const episodeNum = prog['episode-num']?.find((e: any) => e.$?.system === 'xmltv_ns');
          if (episodeNum) {
            const epText = episodeNum._ || episodeNum;
            const match = epText.match(/(\d+)\.(\d+)/);
            if (match) {
              program.season = parseInt(match[1]) + 1;
              program.episode = parseInt(match[2]) + 1;
            }
          }

          const ratingEl = prog.rating?.[0];
          if (ratingEl) {
            program.rating = ratingEl.value?.[0] || ratingEl._ || ratingEl;
          }

          const channelPrograms = this.programCache.get(program.channelId) || [];
          channelPrograms.push(program);
          this.programCache.set(program.channelId, channelPrograms);
          programCount++;
        }

        console.log(`[EPG] Loaded ${programCount} programs from local XMLTV`);
      }
    } catch (error) {
      console.error('[EPG] Error loading XMLTV data:', error);
    }
  }

  /**
   * Parse XMLTV date format (YYYYMMDDHHMMSS +ZZZZ)
   */
  private parseXMLTVDate(dateStr: string): Date {
    if (!dateStr) return new Date();

    // Format: 20240115120000 +0000
    const match = dateStr.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
    if (!match) return new Date();

    const [, year, month, day, hour, minute, second, tz] = match;
    let isoStr = `${year}-${month}-${day}T${hour}:${minute}:${second}`;

    if (tz) {
      const tzHours = tz.substring(0, 3);
      const tzMins = tz.substring(3);
      isoStr += `${tzHours}:${tzMins}`;
    } else {
      isoStr += 'Z';
    }

    return new Date(isoStr);
  }

  /**
   * Check if a time range includes the current time
   */
  private isCurrentTime(start: Date, end: Date): boolean {
    const now = new Date();
    return now >= start && now <= end;
  }

  /**
   * Refresh EPG data if stale
   */
  async refreshIfNeeded(): Promise<void> {
    // With the new architecture, we don't need to refresh on demand
    // Background refresh handles it automatically
  }

  /**
   * Get all available channel IDs from EPG data
   */
  getChannels(): string[] {
    return Array.from(this.programCache.keys());
  }

  /**
   * Get the current program for a channel
   */
  getCurrentProgram(channelId: string): EPGProgram | null {
    const programs = this.programCache.get(channelId);
    if (!programs || programs.length === 0) {
      // Try fuzzy match
      const normalizedInput = channelId.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [epgChannelId, channelPrograms] of this.programCache.entries()) {
        const normalizedEpg = epgChannelId.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedEpg.includes(normalizedInput) || normalizedInput.includes(normalizedEpg)) {
          const now = new Date();
          return channelPrograms.find(p => {
            const start = p.startTime instanceof Date ? p.startTime : new Date(p.startTime);
            const end = p.endTime instanceof Date ? p.endTime : new Date(p.endTime);
            return now >= start && now <= end;
          }) || null;
        }
      }
      return null;
    }

    const now = new Date();
    return programs.find(p => {
      const start = p.startTime instanceof Date ? p.startTime : new Date(p.startTime);
      const end = p.endTime instanceof Date ? p.endTime : new Date(p.endTime);
      return now >= start && now <= end;
    }) || null;
  }

  /**
   * Get upcoming programs for a channel (within specified hours)
   */
  getUpcomingPrograms(channelId: string, hours: number = 3): EPGProgram[] {
    let programs = this.programCache.get(channelId);

    // Try fuzzy match if exact match fails
    if (!programs || programs.length === 0) {
      const normalizedInput = channelId.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [epgChannelId, channelPrograms] of this.programCache.entries()) {
        const normalizedEpg = epgChannelId.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedEpg.includes(normalizedInput) || normalizedInput.includes(normalizedEpg)) {
          programs = channelPrograms;
          break;
        }
      }
    }

    if (!programs) return [];

    const now = new Date();
    const cutoff = new Date(now.getTime() + hours * 60 * 60 * 1000);

    return programs.filter(p => {
      const start = p.startTime instanceof Date ? p.startTime : new Date(p.startTime);
      return start >= now && start <= cutoff;
    }).sort((a, b) => {
      const aStart = a.startTime instanceof Date ? a.startTime : new Date(a.startTime);
      const bStart = b.startTime instanceof Date ? b.startTime : new Date(b.startTime);
      return aStart.getTime() - bStart.getTime();
    });
  }

  /**
   * Get cache stats for admin dashboard
   */
  getCacheStats(): {
    channels: number;
    programs: number;
    lastFetch: string | null;
    oldestProgram: string | null;
    newestProgram: string | null;
    cacheSizeBytes: number;
    nextRefresh: string | null;
    refreshIntervalHours: number;
    daysToKeep: number;
  } {
    let oldestProgram: Date | null = null;
    let newestProgram: Date | null = null;
    let totalPrograms = 0;

    for (const programs of this.programCache.values()) {
      totalPrograms += programs.length;
      for (const p of programs) {
        const end = p.endTime instanceof Date ? p.endTime : new Date(p.endTime);
        if (!oldestProgram || end < oldestProgram) oldestProgram = end;
        if (!newestProgram || end > newestProgram) newestProgram = end;
      }
    }

    // Get file size
    let cacheSizeBytes = 0;
    try {
      if (fs.existsSync(EPG_CACHE_FILE)) {
        const stats = fs.statSync(EPG_CACHE_FILE);
        cacheSizeBytes = stats.size;
      }
    } catch (e) {
      // Ignore errors
    }

    // Calculate next refresh time
    let nextRefresh: string | null = null;
    if (this.lastFetch) {
      const nextRefreshTime = new Date(this.lastFetch.getTime() + this.REFRESH_INTERVAL_MS);
      nextRefresh = nextRefreshTime.toISOString();
    }

    return {
      channels: this.programCache.size,
      programs: totalPrograms,
      lastFetch: this.lastFetch?.toISOString() || null,
      oldestProgram: oldestProgram?.toISOString() || null,
      newestProgram: newestProgram?.toISOString() || null,
      cacheSizeBytes,
      nextRefresh,
      refreshIntervalHours: this.REFRESH_INTERVAL_MS / (1000 * 60 * 60),
      daysToKeep: this.DAYS_TO_KEEP
    };
  }

  /**
   * Force a refresh of EPG data from provider
   */
  async forceRefresh(): Promise<void> {
    console.log('[EPG] Manual refresh triggered');
    await this.fetchAndMergeEPGData();
  }
}
