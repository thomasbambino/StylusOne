import { IService } from './interfaces';
import * as xml2js from 'xml2js';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { tmdbService } from './tmdb-service';
import { db } from '../db';
import { iptvProviders } from '@shared/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { loggers } from '../lib/logger';

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
  channelNameMapping?: { [normalizedName: string]: string }; // Maps normalized channel names to EPG IDs
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
  private channelNameToId: Map<string, string> = new Map(); // Maps normalized channel names to EPG channel IDs
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
      loggers.epg.info(`Using real data from: ${this.xmltvPath}`);
    } else if (fs.existsSync(fallbackPath)) {
      this.xmltvPath = fallbackPath;
      loggers.epg.info(`Using fallback data from: ${this.xmltvPath}`);
    } else {
      this.xmltvPath = '';
      loggers.epg.info('No local XMLTV file');
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
        const hoursSinceLastFetch = this.lastFetch
          ? (Date.now() - this.lastFetch.getTime()) / (1000 * 60 * 60)
          : Infinity;
        loggers.epg.info(`Loaded ${this.programCache.size} channels from disk cache (${hoursSinceLastFetch.toFixed(1)} hours old)`);

        // If no channel name mappings were loaded from cache (old cache format), build from local file
        if (this.channelNameToId.size === 0) {
          loggers.epg.info('No channel name mappings in cache, building from local XMLTV...');
          await this.buildChannelNameMapping();
        }

        this.initialized = true;

        // If we have lots of channels but few name mappings, trigger a refresh to rebuild mappings
        // This handles upgrading from old cache format that didn't save mappings
        if (this.programCache.size > 100 && this.channelNameToId.size < 100) {
          loggers.epg.info(`Too few channel name mappings (${this.channelNameToId.size}) for ${this.programCache.size} channels - triggering refresh to rebuild`);
          // Don't await - let it run in background
          this.fetchAndMergeEPGData().catch(err => loggers.epg.error('Background refresh error', { error: err }));
        }
      } else {
        // No disk cache, need to fetch
        loggers.epg.info('No disk cache found, fetching from provider...');

        // Load local XMLTV if available
        if (this.xmltvPath && fs.existsSync(this.xmltvPath)) {
          await this.loadXMLTVData();
        }

        // Fetch from IPTV provider
        await this.fetchAndMergeEPGData();
        this.initialized = true;
      }

      // Start background refresh interval (checks if 6 hours have passed)
      this.startBackgroundRefresh();

      // Start TMDB worker and queue program titles for thumbnail fetching
      if (tmdbService.isConfigured()) {
        tmdbService.startAfterEPGReady();
        this.queueTitlesForTMDB();
      }

      loggers.epg.info(`Service initialized with ${this.programCache.size} channels, ${this.getTotalProgramCount()} programs`);
    } catch (error) {
      loggers.epg.error('Failed to initialize', { error });
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

    // Check every hour if we need to refresh (only if 6+ hours since last fetch)
    this.refreshIntervalId = setInterval(async () => {
      const hoursSinceLastFetch = this.lastFetch
        ? (Date.now() - this.lastFetch.getTime()) / (1000 * 60 * 60)
        : Infinity;

      if (hoursSinceLastFetch >= 6) {
        loggers.epg.info(`Background refresh triggered (${hoursSinceLastFetch.toFixed(1)} hours since last fetch)`);
        await this.fetchAndMergeEPGData();
      }
    }, this.CLEANUP_INTERVAL_MS); // Check every hour

    // Also run cleanup periodically
    setInterval(() => {
      this.cleanupOldPrograms();
    }, this.CLEANUP_INTERVAL_MS);

    loggers.epg.debug('Background refresh will run when 6+ hours have passed since last fetch');
  }

  /**
   * Build channel name to ID mapping from local XMLTV file or provider fetch
   */
  private async buildChannelNameMapping(): Promise<void> {
    try {
      // Try local XMLTV file first
      const xmltvPath = this.xmltvPath || path.join(process.cwd(), 'data', 'epgshare_guide.xmltv');

      if (!fs.existsSync(xmltvPath)) {
        loggers.epg.debug('No local XMLTV file for channel name mapping');
        return;
      }

      const xmlData = fs.readFileSync(xmltvPath, 'utf-8');
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlData);

      if (!result.tv?.channel) {
        loggers.epg.debug('No channel data in XMLTV file');
        return;
      }

      this.channelNameToId.clear();

      for (const channel of result.tv.channel) {
        const channelId = channel.$.id;
        const displayNames = channel['display-name'];
        if (displayNames && Array.isArray(displayNames)) {
          for (const name of displayNames) {
            const displayName = name._ || name;
            if (displayName && typeof displayName === 'string') {
              // Normalize: lowercase, remove special chars, trim
              const normalized = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (normalized.length > 2) {
                this.channelNameToId.set(normalized, channelId);
              }
            }
          }
        }
      }

      loggers.epg.info(`Built channel name mapping: ${this.channelNameToId.size} entries`);
    } catch (error) {
      loggers.epg.error('Error building channel name mapping', { error });
    }
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
        programs: {},
        channelNameMapping: {}
      };

      // Convert Map to serializable object
      for (const [channelId, programs] of this.programCache.entries()) {
        cacheData.programs[channelId] = programs.map(p => ({
          ...p,
          startTime: p.startTime instanceof Date ? p.startTime.toISOString() : p.startTime,
          endTime: p.endTime instanceof Date ? p.endTime.toISOString() : p.endTime
        }));
      }

      // Save channel name mapping
      for (const [name, id] of this.channelNameToId.entries()) {
        cacheData.channelNameMapping![name] = id;
      }

      fs.writeFileSync(EPG_CACHE_FILE, JSON.stringify(cacheData), 'utf-8');
      loggers.epg.info(`Saved ${this.programCache.size} channels, ${this.getTotalProgramCount()} programs, ${this.channelNameToId.size} name mappings to disk`);
    } catch (error) {
      loggers.epg.error('Error saving to disk', { error });
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

      // Load channel name mapping from disk cache
      this.channelNameToId.clear();
      if (data.channelNameMapping) {
        for (const [name, id] of Object.entries(data.channelNameMapping)) {
          this.channelNameToId.set(name, id);
        }
        loggers.epg.debug(`Loaded ${this.channelNameToId.size} channel name mappings from disk`);
      }

      return true;
    } catch (error) {
      loggers.epg.error('Error loading from disk', { error });
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
        loggers.epg.debug('IPTV credentials not configured, skipping fetch');
        return;
      }

      const epgUrl = `${serverUrl}/xmltv.php?username=${username}&password=${password}`;
      loggers.epg.info('Fetching from provider (rate-limited)...');

      const response = await fetch(epgUrl, { timeout: 60000 });
      if (!response.ok) {
        loggers.epg.error(`Failed to fetch: ${response.status}`);
        return;
      }

      const xmlData = await response.text();
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlData);

      if (!result.tv || !result.tv.programme) {
        loggers.epg.warn('No programs in response');
        return;
      }

      // Parse channel elements to build name->ID mapping
      if (result.tv.channel) {
        for (const channel of result.tv.channel) {
          const channelId = channel.$.id;
          const displayNames = channel['display-name'];
          if (displayNames && Array.isArray(displayNames)) {
            for (const name of displayNames) {
              const displayName = name._ || name;
              if (displayName && typeof displayName === 'string') {
                // Normalize: lowercase, remove special chars, trim
                const normalized = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (normalized.length > 2) {
                  this.channelNameToId.set(normalized, channelId);
                }
              }
            }
          }
        }
        loggers.epg.info(`Built channel name mapping: ${this.channelNameToId.size} entries`);
      }

      const now = new Date();
      let newProgramCount = 0;
      let mergedProgramCount = 0;

      // Parse new programs
      const newProgramsByChannel = new Map<string, EPGProgram[]>();

      for (const prog of result.tv.programme) {
        const startTime = this.parseXMLTVDate(prog.$.start);
        const endTime = this.parseXMLTVDate(prog.$.stop);

        // Only filter out programs that have already ended - keep ALL future programs
        if (endTime < now) {
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

      // Queue program titles for TMDB thumbnail fetching
      this.queueTitlesForTMDB();

      loggers.epg.info(`Fetched ${newProgramCount} programs, merged ${mergedProgramCount} new, total: ${this.getTotalProgramCount()}`);
    } catch (error) {
      loggers.epg.error('Error fetching from provider', { error });
    }

    // Also fetch from M3U providers with XMLTV URLs
    await this.fetchM3UProvidersXMLTV();
  }

  /**
   * Fetch XMLTV data from M3U providers that have xmltvUrl configured
   */
  private async fetchM3UProvidersXMLTV(): Promise<void> {
    try {
      // Find all active M3U providers with XMLTV URLs
      const m3uProviders = await db
        .select({
          id: iptvProviders.id,
          name: iptvProviders.name,
          xmltvUrl: iptvProviders.xmltvUrl,
        })
        .from(iptvProviders)
        .where(
          and(
            eq(iptvProviders.providerType, 'm3u'),
            eq(iptvProviders.isActive, true),
            isNotNull(iptvProviders.xmltvUrl)
          )
        );

      if (m3uProviders.length === 0) {
        loggers.epg.debug('No M3U providers with XMLTV URLs found');
        return;
      }

      loggers.epg.info(`Found ${m3uProviders.length} M3U providers with XMLTV URLs`);

      for (const provider of m3uProviders) {
        if (!provider.xmltvUrl) continue;

        try {
          loggers.epg.info(`Fetching XMLTV from M3U provider "${provider.name}": ${provider.xmltvUrl}`);

          const response = await fetch(provider.xmltvUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; IPTV/1.0)',
            },
            timeout: 60000
          });

          if (!response.ok) {
            loggers.epg.error(`Failed to fetch XMLTV from ${provider.name}: ${response.status}`);
            continue;
          }

          const xmlData = await response.text();
          loggers.epg.debug(`Received ${xmlData.length} bytes from ${provider.name}`);

          const parser = new xml2js.Parser();
          const result = await parser.parseStringPromise(xmlData);

          if (!result.tv) {
            loggers.epg.warn(`No TV data in XMLTV from ${provider.name}`);
            continue;
          }

          // Parse channel elements to build name->ID mapping
          if (result.tv.channel) {
            for (const channel of result.tv.channel) {
              const channelId = channel.$.id;
              const displayNames = channel['display-name'];
              if (displayNames && Array.isArray(displayNames)) {
                for (const name of displayNames) {
                  const displayName = name._ || name;
                  if (displayName && typeof displayName === 'string') {
                    const normalized = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (normalized.length > 2) {
                      this.channelNameToId.set(normalized, channelId);
                    }
                  }
                }
              }
            }
          }

          // Parse programs
          if (result.tv.programme) {
            const now = new Date();
            let programCount = 0;

            for (const prog of result.tv.programme) {
              const startTime = this.parseXMLTVDate(prog.$.start);
              const endTime = this.parseXMLTVDate(prog.$.stop);

              // Skip expired programs
              if (endTime < now) continue;

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

              // Merge into cache
              const existingPrograms = this.programCache.get(program.channelId) || [];
              const existingKeys = new Set(
                existingPrograms.map(p => `${p.startTime.getTime()}-${p.title}`)
              );
              const key = `${program.startTime.getTime()}-${program.title}`;

              if (!existingKeys.has(key)) {
                existingPrograms.push(program);
                existingPrograms.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
                this.programCache.set(program.channelId, existingPrograms);
                programCount++;
              }
            }

            loggers.epg.info(`Added ${programCount} programs from M3U provider "${provider.name}"`);
          }
        } catch (error) {
          loggers.epg.error(`Error fetching XMLTV from ${provider.name}`, { error });
        }
      }

      // Save updated cache to disk
      this.saveToDisk();

      loggers.epg.info(`M3U provider XMLTV fetch complete. Total channels: ${this.programCache.size}, name mappings: ${this.channelNameToId.size}`);
    } catch (error) {
      loggers.epg.error('Error fetching M3U provider XMLTV', { error });
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
      loggers.epg.debug(`Cleaned up ${removedCount} expired programs`);
      this.saveToDisk();
    }
  }

  /**
   * Queue all unique program titles for TMDB thumbnail fetching
   * Collects titles from the next 2 hours across all channels
   */
  private queueTitlesForTMDB(): void {
    if (!tmdbService.isConfigured()) return;

    const now = new Date();
    const cutoff = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours
    const uniqueTitles = new Set<string>();

    for (const [, programs] of this.programCache.entries()) {
      for (const program of programs) {
        const start = program.startTime instanceof Date ? program.startTime : new Date(program.startTime);
        const end = program.endTime instanceof Date ? program.endTime : new Date(program.endTime);

        // Include currently airing and upcoming programs within 2 hours
        if (end > now && start <= cutoff) {
          uniqueTitles.add(program.title);
        }
      }
    }

    if (uniqueTitles.size > 0) {
      loggers.epg.debug(`Queuing ${uniqueTitles.size} unique titles for TMDB thumbnail fetch`);
      tmdbService.queueTitles(Array.from(uniqueTitles));
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
      loggers.epg.info(`Loading XMLTV data from: ${this.xmltvPath}`);
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

        loggers.epg.info(`Loaded ${programCount} programs from local XMLTV`);
      }
    } catch (error) {
      loggers.epg.error('Error loading XMLTV data', { error });
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
      const end = p.endTime instanceof Date ? p.endTime : new Date(p.endTime);
      // Include currently airing programs (end > now) and programs starting within cutoff
      return end > now && start <= cutoff;
    }).sort((a, b) => {
      const aStart = a.startTime instanceof Date ? a.startTime : new Date(a.startTime);
      const bStart = b.startTime instanceof Date ? b.startTime : new Date(b.startTime);
      return aStart.getTime() - bStart.getTime();
    });
  }

  /**
   * Get upcoming programs by channel name (fallback when ID lookup fails)
   */
  getUpcomingProgramsByName(channelName: string, hours: number = 3): EPGProgram[] {
    // Normalize the channel name for matching
    const normalized = channelName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Try exact match in name->ID mapping
    let epgChannelId = this.channelNameToId.get(normalized);
    let matchType = epgChannelId ? 'exact-name' : '';

    // Try partial matches if exact fails
    if (!epgChannelId) {
      // Try finding a key that contains our name or vice versa
      for (const [mappedName, id] of this.channelNameToId.entries()) {
        if (mappedName.includes(normalized) || normalized.includes(mappedName)) {
          epgChannelId = id;
          matchType = 'partial-name';
          break;
        }
      }
    }

    // If still no match, try matching against all cached channel IDs
    if (!epgChannelId) {
      for (const cachedChannelId of this.programCache.keys()) {
        const normalizedCached = cachedChannelId.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedCached.includes(normalized) || normalized.includes(normalizedCached)) {
          epgChannelId = cachedChannelId;
          matchType = 'cache-id';
          break;
        }
      }
    }

    if (!epgChannelId) {
      // Log first few failures for debugging
      loggers.epg.debug(`No match for name "${channelName}" (normalized: ${normalized}, mapping size: ${this.channelNameToId.size})`);
      return [];
    }

    const programs = this.getUpcomingPrograms(epgChannelId, hours);
    if (programs.length > 0) {
      loggers.epg.trace(`Found ${programs.length} programs for "${channelName}" -> ${epgChannelId} (${matchType})`);
    }
    return programs;
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
    dataRangeDays: number;
  } {
    let oldestStart: Date | null = null;
    let newestEnd: Date | null = null;
    let totalPrograms = 0;

    for (const programs of this.programCache.values()) {
      totalPrograms += programs.length;
      for (const p of programs) {
        const start = p.startTime instanceof Date ? p.startTime : new Date(p.startTime);
        const end = p.endTime instanceof Date ? p.endTime : new Date(p.endTime);
        if (!oldestStart || start < oldestStart) oldestStart = start;
        if (!newestEnd || end > newestEnd) newestEnd = end;
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

    // Calculate actual data range in days
    let dataRangeDays = 0;
    if (oldestStart && newestEnd) {
      dataRangeDays = Math.ceil((newestEnd.getTime() - oldestStart.getTime()) / (1000 * 60 * 60 * 24));
    }

    return {
      channels: this.programCache.size,
      programs: totalPrograms,
      lastFetch: this.lastFetch?.toISOString() || null,
      oldestProgram: oldestStart?.toISOString() || null,
      newestProgram: newestEnd?.toISOString() || null,
      cacheSizeBytes,
      nextRefresh,
      refreshIntervalHours: this.REFRESH_INTERVAL_MS / (1000 * 60 * 60),
      dataRangeDays
    };
  }

  /**
   * Force a refresh of EPG data from provider
   */
  async forceRefresh(): Promise<void> {
    loggers.epg.info('Manual refresh triggered');
    await this.fetchAndMergeEPGData();
  }

  /**
   * Get EPG data summary for admin viewing
   */
  getDataSummary(): Array<{ channelId: string; programCount: number; currentProgram: string | null; nextProgram: string | null }> {
    const summary: Array<{ channelId: string; programCount: number; currentProgram: string | null; nextProgram: string | null }> = [];
    const now = new Date();

    for (const [channelId, programs] of this.programCache.entries()) {
      const currentProgram = programs.find(p => {
        const start = p.startTime instanceof Date ? p.startTime : new Date(p.startTime);
        const end = p.endTime instanceof Date ? p.endTime : new Date(p.endTime);
        return now >= start && now <= end;
      });

      const futurePrograms = programs.filter(p => {
        const start = p.startTime instanceof Date ? p.startTime : new Date(p.startTime);
        return start > now;
      }).sort((a, b) => {
        const aStart = a.startTime instanceof Date ? a.startTime : new Date(a.startTime);
        const bStart = b.startTime instanceof Date ? b.startTime : new Date(b.startTime);
        return aStart.getTime() - bStart.getTime();
      });

      summary.push({
        channelId,
        programCount: programs.length,
        currentProgram: currentProgram?.title || null,
        nextProgram: futurePrograms[0]?.title || null
      });
    }

    return summary.sort((a, b) => a.channelId.localeCompare(b.channelId));
  }

  /**
   * Get all programs for a specific channel (for admin viewing)
   */
  getChannelPrograms(channelId: string, limit: number = 50): EPGProgram[] {
    const programs = this.programCache.get(channelId) || [];
    return programs
      .sort((a, b) => {
        const aStart = a.startTime instanceof Date ? a.startTime : new Date(a.startTime);
        const bStart = b.startTime instanceof Date ? b.startTime : new Date(b.startTime);
        return aStart.getTime() - bStart.getTime();
      })
      .slice(0, limit);
  }
}
