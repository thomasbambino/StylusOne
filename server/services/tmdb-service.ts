import fetch from 'node-fetch';

/**
 * TMDB (The Movie Database) service for fetching TV show and movie artwork
 * Uses a background worker with queue to avoid blocking requests
 * Searches both TV shows and movies using the multi-search endpoint
 */

interface TMDBMultiSearchResult {
  id: number;
  media_type: 'tv' | 'movie' | 'person';
  // TV shows use 'name', movies use 'title'
  name?: string;
  title?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  // TV shows use 'first_air_date', movies use 'release_date'
  first_air_date?: string;
  release_date?: string;
}

interface TMDBImages {
  backdrops: Array<{ file_path: string; width: number; height: number }>;
  posters: Array<{ file_path: string; width: number; height: number }>;
}

// In-memory cache for TV show and movie lookups (title -> image URL)
const imageCache = new Map<string, string | null>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const cacheTimestamps = new Map<string, number>();

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
  private queue: Set<string> = new Set(); // Unique titles to process
  private workerTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private getFavoriteTitles: GetFavoriteTitlesCallback | null = null;

  constructor() {
    this.apiKey = process.env.TMDB_API_KEY || '';
    if (this.apiKey) {
      console.log(`[TMDB] Service initialized with API key (${this.apiKey.substring(0, 4)}...)`);
    } else {
      console.log('[TMDB] No API key configured - thumbnails disabled');
    }
  }

  /**
   * Start worker after EPG is initialized
   * @param getFavoriteTitles - Callback to get program titles for all favorites
   */
  startAfterEPGReady(getFavoriteTitles?: GetFavoriteTitlesCallback): void {
    if (!this.apiKey) {
      console.log('[TMDB] Worker not starting - no API key');
      return;
    }
    if (this.workerTimer) {
      console.log('[TMDB] Worker already running');
      return;
    }
    if (getFavoriteTitles) {
      this.getFavoriteTitles = getFavoriteTitles;
    }
    console.log('[TMDB] Starting background worker...');
    this.startWorker();
    // Run immediately on startup to preload cache
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
        console.log(`[TMDB] Refreshing thumbnails for ${titles.length} favorite program titles`);
        this.queueTitles(titles);
      }
    } catch (error) {
      console.error('[TMDB] Error refreshing favorites:', error);
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
      // Process queue every cycle
      this.processQueue();
      // Refresh favorites every 10 cycles (5 minutes)
      if (cycleCount % 10 === 0) {
        this.refreshFavorites();
      }
    }, WORKER_INTERVAL);

    console.log(`[TMDB] Background worker started (interval: ${WORKER_INTERVAL / 1000}s, batch: ${TITLES_PER_RUN} titles)`);
  }

  /**
   * Stop the background worker
   */
  stopWorker(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
      console.log('TMDB background worker stopped');
    }
  }

  /**
   * Process queued titles (called by worker)
   */
  private async processQueue(): Promise<void> {
    if (!this.apiKey || this.isProcessing || this.queue.size === 0) return;

    this.isProcessing = true;
    const titlesToProcess = Array.from(this.queue).slice(0, TITLES_PER_RUN);

    console.log(`[TMDB Worker] Processing ${titlesToProcess.length} titles (${this.queue.size} in queue)`);

    for (const title of titlesToProcess) {
      try {
        // Remove from queue before processing
        this.queue.delete(title);

        // Skip if already cached
        const cacheKey = this.getCacheKey(title);
        if (imageCache.has(cacheKey) && this.isCacheValid(cacheKey)) {
          continue;
        }

        // Fetch from TMDB
        await this.fetchAndCacheImage(title);

      } catch (error) {
        // Log but don't stop processing
        console.error(`[TMDB Worker] Error processing "${title}":`, error instanceof Error ? error.message : error);
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

    // Skip if already cached
    if (imageCache.has(cacheKey) && this.isCacheValid(cacheKey)) {
      return;
    }

    // Skip if queue is full
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
    if (imageCache.has(cacheKey) && this.isCacheValid(cacheKey)) {
      return imageCache.get(cacheKey) || null;
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

    // Create abort controller for timeout
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
      // Remove common suffixes
      .replace(/\s*\((?:New|Repeat|Live|HD|4K)\)\s*$/i, '')
      // Remove episode info like "S01E01" or "Season 1"
      .replace(/\s*S\d+E\d+.*$/i, '')
      .replace(/\s*Season\s+\d+.*$/i, '')
      // Remove year suffixes like "(2024)"
      .replace(/\s*\(\d{4}\)\s*$/, '')
      // Remove special characters that might interfere
      .replace(/[^\w\s'-]/g, ' ')
      // Normalize whitespace
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
   * Check if cached value is still valid
   */
  private isCacheValid(key: string): boolean {
    const timestamp = cacheTimestamps.get(key);
    if (!timestamp) return false;
    return Date.now() - timestamp < CACHE_TTL;
  }

  /**
   * Fetch image from TMDB and cache it (used by background worker)
   * Searches both TV shows and movies using the multi-search endpoint
   */
  private async fetchAndCacheImage(title: string): Promise<string | null> {
    const cacheKey = this.getCacheKey(title);
    const cleanedTitle = this.cleanTitle(title);

    // Debug: log title cleaning
    if (title !== cleanedTitle) {
      console.log(`[TMDB] Title cleaned: "${title}" -> "${cleanedTitle}"`);
    }

    if (!cleanedTitle || cleanedTitle.length < 2) {
      console.log(`[TMDB] Skipping empty/short title: "${title}"`);
      imageCache.set(cacheKey, null);
      cacheTimestamps.set(cacheKey, Date.now());
      return null;
    }

    try {
      // Search for both TV shows and movies using multi-search
      const searchUrl = `${this.baseUrl}/search/multi?api_key=${this.apiKey}&query=${encodeURIComponent(cleanedTitle)}&page=1`;
      const searchData = await this.rateLimitedFetch(searchUrl);

      if (!searchData.results || searchData.results.length === 0) {
        console.log(`[TMDB] No results found for "${cleanedTitle}"`);
        imageCache.set(cacheKey, null);
        cacheTimestamps.set(cacheKey, Date.now());
        return null;
      }

      // Filter to only TV and movie results (exclude person results)
      const mediaResults = searchData.results.filter(
        (r: TMDBMultiSearchResult) => r.media_type === 'tv' || r.media_type === 'movie'
      );

      if (mediaResults.length === 0) {
        console.log(`[TMDB] No TV/movie results for "${cleanedTitle}" (got ${searchData.results.length} person results)`);
        imageCache.set(cacheKey, null);
        cacheTimestamps.set(cacheKey, Date.now());
        return null;
      }

      // Get the first (best) match
      const result: TMDBMultiSearchResult = mediaResults[0];
      const mediaType = result.media_type;
      const displayName = result.name || result.title || cleanedTitle;

      // Prefer backdrop (16:9 landscape) over poster (2:3 portrait)
      let imagePath = result.backdrop_path || result.poster_path;

      if (!imagePath) {
        // Try to get images from the media's details
        const imagesUrl = `${this.baseUrl}/${mediaType}/${result.id}/images?api_key=${this.apiKey}`;
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
        console.log(`[TMDB] No image found for "${cleanedTitle}" (matched: ${displayName})`);
        imageCache.set(cacheKey, null);
        cacheTimestamps.set(cacheKey, Date.now());
        return null;
      }

      // Build the full image URL (w780 is a good size for thumbnails)
      const imageUrl = `${this.imageBaseUrl}/w780${imagePath}`;

      // Cache the result
      imageCache.set(cacheKey, imageUrl);
      cacheTimestamps.set(cacheKey, Date.now());

      console.log(`[TMDB] Found ${mediaType} thumbnail for "${cleanedTitle}" -> ${displayName}`);

      return imageUrl;
    } catch (error) {
      // Cache negative result on error
      imageCache.set(cacheKey, null);
      cacheTimestamps.set(cacheKey, Date.now());
      throw error;
    }
  }

  /**
   * Search for a TV show or movie and get its backdrop/poster image
   * Returns cached result or null (use queueTitle for background fetch)
   */
  async getShowImage(title: string): Promise<string | null> {
    if (!this.apiKey) return null;

    const cacheKey = this.getCacheKey(title);

    // Check cache first
    if (imageCache.has(cacheKey) && this.isCacheValid(cacheKey)) {
      return imageCache.get(cacheKey) || null;
    }

    // Queue for background processing and return null for now
    this.queueTitle(title);
    return null;
  }

  /**
   * Get cache stats for debugging
   */
  getCacheStats(): { size: number; hits: number; queueSize: number } {
    return {
      size: imageCache.size,
      hits: Array.from(imageCache.values()).filter(v => v !== null).length,
      queueSize: this.queue.size
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    imageCache.clear();
    cacheTimestamps.clear();
  }

  /**
   * Debug: Search TMDB directly and return full results (for testing)
   */
  async debugSearch(title: string): Promise<{
    originalTitle: string;
    cleanedTitle: string;
    cacheKey: string;
    cachedResult: string | null | undefined;
    searchResults: any[];
    finalImage: string | null;
    error?: string;
  }> {
    const cacheKey = this.getCacheKey(title);
    const cleanedTitle = this.cleanTitle(title);
    const cachedResult = imageCache.has(cacheKey) ? imageCache.get(cacheKey) : undefined;

    if (!this.apiKey) {
      return {
        originalTitle: title,
        cleanedTitle,
        cacheKey,
        cachedResult,
        searchResults: [],
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
        poster_path: r.poster_path
      }));

      // Get final image using normal logic
      const mediaResults = results.filter((r: any) => r.media_type === 'tv' || r.media_type === 'movie');
      let finalImage: string | null = null;

      if (mediaResults.length > 0) {
        const best = mediaResults[0];
        const imagePath = best.backdrop_path || best.poster_path;
        if (imagePath) {
          finalImage = `${this.imageBaseUrl}/w780${imagePath}`;
        }
      }

      return {
        originalTitle: title,
        cleanedTitle,
        cacheKey,
        cachedResult,
        searchResults: results,
        finalImage
      };
    } catch (error) {
      return {
        originalTitle: title,
        cleanedTitle,
        cacheKey,
        cachedResult,
        searchResults: [],
        finalImage: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

// Export singleton instance
export const tmdbService = new TMDBService();
