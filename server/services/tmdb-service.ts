import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { loggers } from '../lib/logger';

/**
 * TMDB (The Movie Database) service for fetching TV show and movie artwork
 * Uses a background worker with queue to avoid blocking requests
 * Searches both TV shows and movies using the multi-search endpoint
 *
 * Features:
 * - Similarity scoring to prevent false positive matches
 * - Disk persistence with 30-day expiry for unused entries
 * - Background worker for non-blocking thumbnail fetching
 */

interface TMDBMultiSearchResult {
  id: number;
  media_type: 'tv' | 'movie' | 'person';
  name?: string;
  title?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date?: string;
  release_date?: string;
}

interface TMDBImages {
  backdrops: Array<{ file_path: string; width: number; height: number }>;
  posters: Array<{ file_path: string; width: number; height: number }>;
}

interface CacheEntry {
  imageUrl: string | null;
  matchedTitle: string | null;
  lastUsed: number;  // Timestamp of last access
  createdAt: number; // Timestamp when cached
}

interface CacheData {
  version: number;
  entries: Record<string, CacheEntry>;
}

// Cache settings
const CACHE_DIR = path.join(process.cwd(), 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'tmdb-cache.json');
const CACHE_VERSION = 1;
const UNUSED_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days
const SAVE_DEBOUNCE = 30 * 1000; // Save to disk every 30 seconds max

// Similarity settings
const MIN_SIMILARITY_SCORE = 0.6; // Minimum 60% similarity required

// Rate limiting - TMDB allows ~50 req/sec, we use 20 req/sec to be safe
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 50; // 50ms between requests (20 req/sec max)

// Background worker settings
const WORKER_INTERVAL = 10 * 1000; // Run every 10 seconds
const MAX_QUEUE_SIZE = 500; // Max titles in queue
const TITLES_PER_RUN = 20; // Process 20 titles per worker run
const REQUEST_TIMEOUT = 5000; // 5 second timeout per request

// Callback to get titles for favorites (set by EPG service)
type GetFavoriteTitlesCallback = () => Promise<string[]>;

export class TMDBService {
  private apiKey: string;
  private baseUrl = 'https://api.themoviedb.org/3';
  private imageBaseUrl = 'https://image.tmdb.org/t/p';
  private queue: Set<string> = new Set();
  private workerTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private getFavoriteTitles: GetFavoriteTitlesCallback | null = null;

  // Disk-persisted cache
  private cache: Map<string, CacheEntry> = new Map();
  private saveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;

  constructor() {
    this.apiKey = process.env.TMDB_API_KEY || '';
    if (this.apiKey) {
      loggers.tmdb.info(`Service initialized with API key (${this.apiKey.substring(0, 4)}...)`);
    } else {
      loggers.tmdb.debug('No API key configured - thumbnails disabled');
    }

    // Load cache from disk
    this.loadCache();
  }

  /**
   * Load cache from disk
   */
  private loadCache(): void {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CacheData;

        if (data.version === CACHE_VERSION) {
          const now = Date.now();
          let loaded = 0;
          let expired = 0;

          for (const [key, entry] of Object.entries(data.entries)) {
            // Skip entries not used in the last 30 days
            if (now - entry.lastUsed > UNUSED_EXPIRY) {
              expired++;
              continue;
            }
            this.cache.set(key, entry);
            loaded++;
          }

          loggers.tmdb.info(`Loaded ${loaded} cached entries from disk (${expired} expired entries removed)`);
        } else {
          loggers.tmdb.debug('Cache version mismatch, starting fresh');
        }
      } else {
        loggers.tmdb.debug('No cache file found, starting fresh');
      }
    } catch (error) {
      loggers.tmdb.error('Error loading cache', { error });
    }
  }

  /**
   * Save cache to disk (debounced)
   */
  private scheduleSave(): void {
    this.isDirty = true;

    if (this.saveTimer) return;

    this.saveTimer = setTimeout(() => {
      this.saveCache();
      this.saveTimer = null;
    }, SAVE_DEBOUNCE);
  }

  /**
   * Actually save cache to disk
   */
  private saveCache(): void {
    if (!this.isDirty) return;

    try {
      // Ensure directory exists
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }

      const data: CacheData = {
        version: CACHE_VERSION,
        entries: Object.fromEntries(this.cache)
      };

      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
      this.isDirty = false;
      loggers.tmdb.debug(`Saved ${this.cache.size} entries to disk`);
    } catch (error) {
      loggers.tmdb.error('Error saving cache', { error });
    }
  }

  /**
   * Calculate similarity between two strings (0-1)
   * Uses a combination of techniques for better matching
   */
  private calculateSimilarity(search: string, result: string): number {
    const s1 = search.toLowerCase().trim();
    const s2 = result.toLowerCase().trim();

    // Exact match
    if (s1 === s2) return 1.0;

    // Check if one contains the other (common for subtitle variations)
    if (s2.startsWith(s1) || s1.startsWith(s2)) {
      const shorter = s1.length < s2.length ? s1 : s2;
      const longer = s1.length < s2.length ? s2 : s1;
      // Give high score if the shorter is most of the longer
      return shorter.length / longer.length;
    }

    // Levenshtein distance-based similarity
    const distance = this.levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    const levenshteinSimilarity = 1 - (distance / maxLength);

    // Word overlap similarity
    const words1 = new Set(s1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(s2.split(/\s+/).filter(w => w.length > 2));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0;

    // Weighted average (Levenshtein is more important for short titles)
    const avgLength = (s1.length + s2.length) / 2;
    const levenshteinWeight = avgLength < 15 ? 0.7 : 0.5;
    const jaccardWeight = 1 - levenshteinWeight;

    return (levenshteinSimilarity * levenshteinWeight) + (jaccardSimilarity * jaccardWeight);
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;

    // Create matrix
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    // Initialize first row and column
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    // Fill matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(
            dp[i - 1][j],     // deletion
            dp[i][j - 1],     // insertion
            dp[i - 1][j - 1]  // substitution
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Start worker after EPG is initialized
   */
  startAfterEPGReady(getFavoriteTitles?: GetFavoriteTitlesCallback): void {
    if (!this.apiKey) {
      loggers.tmdb.debug('Worker not starting - no API key');
      return;
    }
    if (this.workerTimer) {
      loggers.tmdb.debug('Worker already running');
      return;
    }
    if (getFavoriteTitles) {
      this.getFavoriteTitles = getFavoriteTitles;
    }
    loggers.tmdb.info('Starting background worker...');
    this.startWorker();
    setTimeout(() => this.refreshFavorites(), 5000);
  }

  /**
   * Refresh thumbnails for all favorites (called periodically)
   */
  private async refreshFavorites(): Promise<void> {
    if (!this.getFavoriteTitles) return;

    try {
      const titles = await this.getFavoriteTitles();
      if (titles.length > 0) {
        loggers.tmdb.debug(`Refreshing thumbnails for ${titles.length} favorite program titles`);
        this.queueTitles(titles);
      }
    } catch (error) {
      loggers.tmdb.error('Error refreshing favorites', { error });
    }
  }

  /**
   * Start the background worker
   */
  private startWorker(): void {
    if (this.workerTimer) return;

    let cycleCount = 0;
    this.workerTimer = setInterval(() => {
      cycleCount++;
      this.processQueue();
      if (cycleCount % 10 === 0) {
        this.refreshFavorites();
      }
      // Save cache periodically
      if (cycleCount % 30 === 0) {
        this.saveCache();
      }
    }, WORKER_INTERVAL);

    loggers.tmdb.info(`Background worker started (interval: ${WORKER_INTERVAL / 1000}s, batch: ${TITLES_PER_RUN} titles)`);
  }

  /**
   * Stop the background worker
   */
  stopWorker(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
      this.saveCache(); // Save on shutdown
      loggers.tmdb.info('Background worker stopped');
    }
  }

  /**
   * Process queued titles (called by worker)
   */
  private async processQueue(): Promise<void> {
    if (!this.apiKey || this.isProcessing || this.queue.size === 0) return;

    this.isProcessing = true;
    const titlesToProcess = Array.from(this.queue).slice(0, TITLES_PER_RUN);

    loggers.tmdb.debug(`Worker processing ${titlesToProcess.length} titles (${this.queue.size} in queue)`);

    for (const title of titlesToProcess) {
      try {
        this.queue.delete(title);

        const cacheKey = this.getCacheKey(title);
        if (this.cache.has(cacheKey)) {
          // Update last used time
          const entry = this.cache.get(cacheKey)!;
          entry.lastUsed = Date.now();
          this.scheduleSave();
          continue;
        }

        await this.fetchAndCacheImage(title);

      } catch (error) {
        loggers.tmdb.error(`Worker error processing "${title}"`, { error: error instanceof Error ? error.message : error });
      }
    }

    this.isProcessing = false;
  }

  /**
   * Queue a title for background processing
   */
  queueTitle(title: string): void {
    if (!this.apiKey) return;

    const cacheKey = this.getCacheKey(title);

    if (this.cache.has(cacheKey)) {
      // Update last used time
      const entry = this.cache.get(cacheKey)!;
      entry.lastUsed = Date.now();
      this.scheduleSave();
      return;
    }

    if (this.queue.size >= MAX_QUEUE_SIZE) {
      return;
    }

    this.queue.add(title);
  }

  /**
   * Queue multiple titles for background processing
   */
  queueTitles(titles: string[]): void {
    for (const title of titles) {
      this.queueTitle(title);
    }
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Get cached image URL (non-blocking, returns null if not cached)
   */
  getCachedImage(title: string): string | null {
    const cacheKey = this.getCacheKey(title);
    const entry = this.cache.get(cacheKey);

    if (entry) {
      // Update last used time
      entry.lastUsed = Date.now();
      this.scheduleSave();
      return entry.imageUrl;
    }

    return null;
  }

  /**
   * Rate-limited fetch with timeout
   */
  private async rateLimitedFetch(url: string): Promise<any> {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }

    lastRequestTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`TMDB API error: ${response.status}`);
      }
      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('TMDB request timed out');
      }
      throw error;
    }
  }

  /**
   * Clean up show title for better search results
   */
  private cleanTitle(title: string): string {
    return title
      .replace(/\s*\((?:New|Repeat|Live|HD|4K)\)\s*$/i, '')
      .replace(/\s*S\d+E\d+.*$/i, '')
      .replace(/\s*Season\s+\d+.*$/i, '')
      .replace(/\s*\(\d{4}\)\s*$/, '')
      .replace(/\s*:\s*\d{2}-\d{2}-\d{4}.*$/i, '') // Remove date suffixes like ": 01-14-2026"
      .replace(/[^\w\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Get cache key for a title
   */
  private getCacheKey(title: string): string {
    return this.cleanTitle(title).toLowerCase();
  }

  /**
   * Fetch image from TMDB and cache it (used by background worker)
   */
  private async fetchAndCacheImage(title: string): Promise<string | null> {
    const cacheKey = this.getCacheKey(title);
    const cleanedTitle = this.cleanTitle(title);

    if (title !== cleanedTitle) {
      loggers.tmdb.trace(`Title cleaned: "${title}" -> "${cleanedTitle}"`);
    }

    if (!cleanedTitle || cleanedTitle.length < 2) {
      loggers.tmdb.trace(`Skipping empty/short title: "${title}"`);
      this.cacheResult(cacheKey, null, null);
      return null;
    }

    try {
      const searchUrl = `${this.baseUrl}/search/multi?api_key=${this.apiKey}&query=${encodeURIComponent(cleanedTitle)}&page=1`;
      const searchData = await this.rateLimitedFetch(searchUrl);

      if (!searchData.results || searchData.results.length === 0) {
        loggers.tmdb.trace(`No results found for "${cleanedTitle}"`);
        this.cacheResult(cacheKey, null, null);
        return null;
      }

      // Filter to only TV and movie results
      const mediaResults = searchData.results.filter(
        (r: TMDBMultiSearchResult) => r.media_type === 'tv' || r.media_type === 'movie'
      );

      if (mediaResults.length === 0) {
        loggers.tmdb.trace(`No TV/movie results for "${cleanedTitle}" (got ${searchData.results.length} person results)`);
        this.cacheResult(cacheKey, null, null);
        return null;
      }

      // Find best match using similarity scoring
      let bestMatch: TMDBMultiSearchResult | null = null;
      let bestScore = 0;
      let bestName = '';

      for (const result of mediaResults) {
        const resultName = result.name || result.title || '';
        const similarity = this.calculateSimilarity(cleanedTitle, resultName);

        if (similarity > bestScore) {
          bestScore = similarity;
          bestMatch = result;
          bestName = resultName;
        }
      }

      // Check if best match meets minimum similarity threshold
      if (!bestMatch || bestScore < MIN_SIMILARITY_SCORE) {
        const topResult = mediaResults[0];
        const topName = topResult.name || topResult.title || '';
        loggers.tmdb.trace(`Rejected match for "${cleanedTitle}" -> "${topName}" (similarity: ${(bestScore * 100).toFixed(0)}% < ${MIN_SIMILARITY_SCORE * 100}% required)`);
        this.cacheResult(cacheKey, null, null);
        return null;
      }

      const mediaType = bestMatch.media_type;

      // Prefer backdrop over poster
      let imagePath = bestMatch.backdrop_path || bestMatch.poster_path;

      if (!imagePath) {
        const imagesUrl = `${this.baseUrl}/${mediaType}/${bestMatch.id}/images?api_key=${this.apiKey}`;
        try {
          const imagesData: TMDBImages = await this.rateLimitedFetch(imagesUrl);

          if (imagesData.backdrops && imagesData.backdrops.length > 0) {
            imagePath = imagesData.backdrops[0].file_path;
          } else if (imagesData.posters && imagesData.posters.length > 0) {
            imagePath = imagesData.posters[0].file_path;
          }
        } catch (e) {
          // Ignore errors fetching additional images
        }
      }

      if (!imagePath) {
        loggers.tmdb.trace(`No image found for "${cleanedTitle}" (matched: ${bestName})`);
        this.cacheResult(cacheKey, null, bestName);
        return null;
      }

      const imageUrl = `${this.imageBaseUrl}/w780${imagePath}`;

      this.cacheResult(cacheKey, imageUrl, bestName);
      loggers.tmdb.trace(`Found ${mediaType} thumbnail for "${cleanedTitle}" -> ${bestName} (${(bestScore * 100).toFixed(0)}% match)`);

      return imageUrl;
    } catch (error) {
      this.cacheResult(cacheKey, null, null);
      throw error;
    }
  }

  /**
   * Store result in cache
   */
  private cacheResult(key: string, imageUrl: string | null, matchedTitle: string | null): void {
    const now = Date.now();
    this.cache.set(key, {
      imageUrl,
      matchedTitle,
      lastUsed: now,
      createdAt: now
    });
    this.scheduleSave();
  }

  /**
   * Search for a TV show or movie and get its backdrop/poster image
   */
  async getShowImage(title: string): Promise<string | null> {
    if (!this.apiKey) return null;

    const cacheKey = this.getCacheKey(title);
    const entry = this.cache.get(cacheKey);

    if (entry) {
      entry.lastUsed = Date.now();
      this.scheduleSave();
      return entry.imageUrl;
    }

    this.queueTitle(title);
    return null;
  }

  /**
   * Get cache stats for debugging
   */
  getCacheStats(): { size: number; hits: number; queueSize: number; cacheFile: string } {
    return {
      size: this.cache.size,
      hits: Array.from(this.cache.values()).filter(v => v.imageUrl !== null).length,
      queueSize: this.queue.size,
      cacheFile: CACHE_FILE
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    this.isDirty = true;
    this.saveCache();
  }

  /**
   * Debug: Search TMDB directly and return full results (for testing)
   */
  async debugSearch(title: string): Promise<{
    originalTitle: string;
    cleanedTitle: string;
    cacheKey: string;
    cachedResult: CacheEntry | undefined;
    searchResults: any[];
    bestMatch: { name: string; similarity: number } | null;
    finalImage: string | null;
    error?: string;
  }> {
    const cacheKey = this.getCacheKey(title);
    const cleanedTitle = this.cleanTitle(title);
    const cachedResult = this.cache.get(cacheKey);

    if (!this.apiKey) {
      return {
        originalTitle: title,
        cleanedTitle,
        cacheKey,
        cachedResult,
        searchResults: [],
        bestMatch: null,
        finalImage: null,
        error: "No TMDB API key configured"
      };
    }

    try {
      const searchUrl = `${this.baseUrl}/search/multi?api_key=${this.apiKey}&query=${encodeURIComponent(cleanedTitle)}&page=1`;
      const searchData = await this.rateLimitedFetch(searchUrl);

      const results = (searchData.results || []).map((r: any) => ({
        id: r.id,
        media_type: r.media_type,
        name: r.name || r.title,
        backdrop_path: r.backdrop_path,
        poster_path: r.poster_path,
        similarity: this.calculateSimilarity(cleanedTitle, r.name || r.title || '')
      }));

      // Find best match
      const mediaResults = results.filter((r: any) => r.media_type === 'tv' || r.media_type === 'movie');
      let bestMatch: { name: string; similarity: number } | null = null;
      let finalImage: string | null = null;

      if (mediaResults.length > 0) {
        // Sort by similarity
        mediaResults.sort((a: any, b: any) => b.similarity - a.similarity);
        const best = mediaResults[0];
        bestMatch = { name: best.name, similarity: best.similarity };

        if (best.similarity >= MIN_SIMILARITY_SCORE) {
          const imagePath = best.backdrop_path || best.poster_path;
          if (imagePath) {
            finalImage = `${this.imageBaseUrl}/w780${imagePath}`;
          }
        }
      }

      return {
        originalTitle: title,
        cleanedTitle,
        cacheKey,
        cachedResult,
        searchResults: results,
        bestMatch,
        finalImage
      };
    } catch (error) {
      return {
        originalTitle: title,
        cleanedTitle,
        cacheKey,
        cachedResult,
        searchResults: [],
        bestMatch: null,
        finalImage: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

// Export singleton instance
export const tmdbService = new TMDBService();
