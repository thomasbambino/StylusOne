import fetch from 'node-fetch';

/**
 * TMDB (The Movie Database) service for fetching TV show artwork
 * Used to enrich EPG data with program thumbnails
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
const MIN_REQUEST_INTERVAL = 100; // 100ms between requests (10 req/sec max)

export class TMDBService {
  private apiKey: string;
  private baseUrl = 'https://api.themoviedb.org/3';
  private imageBaseUrl = 'https://image.tmdb.org/t/p';

  constructor() {
    this.apiKey = process.env.TMDB_API_KEY || '';
    if (this.apiKey) {
      console.log('TMDB Service initialized');
    } else {
      console.log('TMDB Service: No API key configured - thumbnails will use fallback');
    }
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Rate-limited fetch
   */
  private async rateLimitedFetch(url: string): Promise<any> {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }

    lastRequestTime = Date.now();

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status}`);
    }
    return response.json();
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
   * Search for a TV show and get its backdrop/poster image
   * Returns the image URL or null if not found
   */
  async getShowImage(title: string): Promise<string | null> {
    if (!this.apiKey) return null;

    const cacheKey = this.getCacheKey(title);

    // Check cache first
    if (imageCache.has(cacheKey) && this.isCacheValid(cacheKey)) {
      return imageCache.get(cacheKey) || null;
    }

    try {
      const cleanedTitle = this.cleanTitle(title);
      if (!cleanedTitle || cleanedTitle.length < 2) {
        return null;
      }

      // Search for the TV show
      const searchUrl = `${this.baseUrl}/search/tv?api_key=${this.apiKey}&query=${encodeURIComponent(cleanedTitle)}&page=1`;
      const searchData = await this.rateLimitedFetch(searchUrl);

      if (!searchData.results || searchData.results.length === 0) {
        // Cache negative result
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

          // Get the best backdrop (prefer 16:9 aspect ratio)
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

      // Build the full image URL (w780 is a good size for thumbnails - 780px wide)
      const imageUrl = `${this.imageBaseUrl}/w780${imagePath}`;

      // Cache the result
      imageCache.set(cacheKey, imageUrl);
      cacheTimestamps.set(cacheKey, Date.now());

      return imageUrl;
    } catch (error) {
      console.error(`TMDB lookup failed for "${title}":`, error);
      // Cache negative result on error (but with shorter TTL)
      imageCache.set(cacheKey, null);
      cacheTimestamps.set(cacheKey, Date.now());
      return null;
    }
  }

  /**
   * Batch lookup for multiple titles (more efficient)
   * Returns a map of title -> image URL
   */
  async getShowImages(titles: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();

    // Deduplicate titles
    const uniqueTitles = [...new Set(titles.map(t => this.cleanTitle(t)))];

    for (const title of uniqueTitles) {
      if (!title) continue;
      const imageUrl = await this.getShowImage(title);
      results.set(title.toLowerCase(), imageUrl);
    }

    return results;
  }

  /**
   * Get cache stats for debugging
   */
  getCacheStats(): { size: number; hits: number } {
    return {
      size: imageCache.size,
      hits: Array.from(imageCache.values()).filter(v => v !== null).length
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
