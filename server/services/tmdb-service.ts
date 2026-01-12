import fetch from 'node-fetch';

/**
 * TMDB (The Movie Database) service for fetching TV show artwork
 * Uses a background worker with queue to avoid blocking requests
 */

interface TMDBSearchResult {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date?: string;
}

interface TMDBShowImages {
  backdrops: Array<{ file_path: string; width: number; height: number }>;
  posters: Array<{ file_path: string; width: number; height: number }>;
}

// In-memory cache for show lookups (title -> image URL)
const imageCache = new Map<string, string | null>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const cacheTimestamps = new Map<string, number>();

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 250; // 250ms between requests (4 req/sec max)

// Background worker settings
const WORKER_INTERVAL = 30 * 1000; // Run every 30 seconds
const MAX_QUEUE_SIZE = 100; // Max titles in queue
const TITLES_PER_RUN = 5; // Process 5 titles per worker run
const REQUEST_TIMEOUT = 5000; // 5 second timeout per request

export class TMDBService {
  private apiKey: string;
  private baseUrl = 'https://api.themoviedb.org/3';
  private imageBaseUrl = 'https://image.tmdb.org/t/p';
  private queue: Set<string> = new Set(); // Unique titles to process
  private workerTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    this.apiKey = process.env.TMDB_API_KEY || '';
    if (this.apiKey) {
      console.log('TMDB Service initialized with background worker');
      this.startWorker();
    } else {
      console.log('TMDB Service: No API key configured - thumbnails will use fallback');
    }
  }

  /**
   * Start the background worker
   */
  private startWorker(): void {
    if (this.workerTimer) return;

    this.workerTimer = setInterval(() => {
      this.processQueue();
    }, WORKER_INTERVAL);

    console.log(`TMDB background worker started (runs every ${WORKER_INTERVAL / 1000}s)`);
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
   */
  private async fetchAndCacheImage(title: string): Promise<string | null> {
    const cacheKey = this.getCacheKey(title);
    const cleanedTitle = this.cleanTitle(title);

    if (!cleanedTitle || cleanedTitle.length < 2) {
      imageCache.set(cacheKey, null);
      cacheTimestamps.set(cacheKey, Date.now());
      return null;
    }

    try {
      // Search for the TV show
      const searchUrl = `${this.baseUrl}/search/tv?api_key=${this.apiKey}&query=${encodeURIComponent(cleanedTitle)}&page=1`;
      const searchData = await this.rateLimitedFetch(searchUrl);

      if (!searchData.results || searchData.results.length === 0) {
        imageCache.set(cacheKey, null);
        cacheTimestamps.set(cacheKey, Date.now());
        return null;
      }

      // Get the first (best) match
      const show: TMDBSearchResult = searchData.results[0];

      // Prefer backdrop (16:9 landscape) over poster (2:3 portrait)
      let imagePath = show.backdrop_path || show.poster_path;

      if (!imagePath) {
        // Try to get images from the show's details
        const imagesUrl = `${this.baseUrl}/tv/${show.id}/images?api_key=${this.apiKey}`;
        try {
          const imagesData: TMDBShowImages = await this.rateLimitedFetch(imagesUrl);

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
        imageCache.set(cacheKey, null);
        cacheTimestamps.set(cacheKey, Date.now());
        return null;
      }

      // Build the full image URL (w780 is a good size for thumbnails)
      const imageUrl = `${this.imageBaseUrl}/w780${imagePath}`;

      // Cache the result
      imageCache.set(cacheKey, imageUrl);
      cacheTimestamps.set(cacheKey, Date.now());

      return imageUrl;
    } catch (error) {
      // Cache negative result on error
      imageCache.set(cacheKey, null);
      cacheTimestamps.set(cacheKey, Date.now());
      throw error;
    }
  }

  /**
   * Search for a TV show and get its backdrop/poster image
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
}

// Export singleton instance
export const tmdbService = new TMDBService();
