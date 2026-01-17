import { Preferences } from '@capacitor/preferences';
import { isNativePlatform } from './capacitor';
import { loggers } from './logger';

interface CachedData<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// Cache expiration times (in milliseconds)
const CACHE_DURATIONS = {
  settings: 24 * 60 * 60 * 1000,      // 24 hours
  user: 30 * 60 * 1000,                // 30 minutes
  channels: 60 * 60 * 1000,            // 1 hour
  favorites: 5 * 60 * 1000,            // 5 minutes
  default: 30 * 60 * 1000,             // 30 minutes
};

type CacheKey = keyof typeof CACHE_DURATIONS | string;

/**
 * Native storage service using Capacitor Preferences
 * Provides persistent caching for mobile apps
 */
export const nativeStorage = {
  /**
   * Store data with optional expiration
   */
  async set<T>(key: string, value: T, expiresIn?: number): Promise<void> {
    if (!isNativePlatform()) {
      // Fallback to localStorage for web
      try {
        const duration = expiresIn || CACHE_DURATIONS.default;
        const cached: CachedData<T> = {
          data: value,
          timestamp: Date.now(),
          expiresAt: Date.now() + duration,
        };
        localStorage.setItem(`cache_${key}`, JSON.stringify(cached));
      } catch (e) {
        loggers.nativeStorage.warn('localStorage error', { error: e });
      }
      return;
    }

    try {
      const duration = expiresIn || CACHE_DURATIONS.default;
      const cached: CachedData<T> = {
        data: value,
        timestamp: Date.now(),
        expiresAt: Date.now() + duration,
      };
      await Preferences.set({
        key: `cache_${key}`,
        value: JSON.stringify(cached),
      });
      loggers.nativeStorage.debug('Cached', { key });
    } catch (error) {
      loggers.nativeStorage.error('Error caching', { key, error });
    }
  },

  /**
   * Get cached data if not expired
   */
  async get<T>(key: string): Promise<T | null> {
    if (!isNativePlatform()) {
      // Fallback to localStorage for web
      try {
        const stored = localStorage.getItem(`cache_${key}`);
        if (!stored) return null;

        const cached: CachedData<T> = JSON.parse(stored);
        if (Date.now() > cached.expiresAt) {
          localStorage.removeItem(`cache_${key}`);
          return null;
        }
        return cached.data;
      } catch (e) {
        return null;
      }
    }

    try {
      const { value } = await Preferences.get({ key: `cache_${key}` });
      if (!value) return null;

      const cached: CachedData<T> = JSON.parse(value);

      // Check if expired
      if (Date.now() > cached.expiresAt) {
        await this.remove(key);
        loggers.nativeStorage.debug('Cache expired', { key });
        return null;
      }

      loggers.nativeStorage.debug('Cache hit', { key });
      return cached.data;
    } catch (error) {
      loggers.nativeStorage.error('Error reading', { key, error });
      return null;
    }
  },

  /**
   * Remove cached data
   */
  async remove(key: string): Promise<void> {
    if (!isNativePlatform()) {
      localStorage.removeItem(`cache_${key}`);
      return;
    }

    try {
      await Preferences.remove({ key: `cache_${key}` });
    } catch (error) {
      loggers.nativeStorage.error('Error removing', { key, error });
    }
  },

  /**
   * Clear all cached data
   */
  async clear(): Promise<void> {
    if (!isNativePlatform()) {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('cache_'));
      keys.forEach(k => localStorage.removeItem(k));
      return;
    }

    try {
      const { keys } = await Preferences.keys();
      const cacheKeys = keys.filter(k => k.startsWith('cache_'));
      for (const key of cacheKeys) {
        await Preferences.remove({ key });
      }
      loggers.nativeStorage.info('Cleared all cache');
    } catch (error) {
      loggers.nativeStorage.error('Error clearing cache', { error });
    }
  },

  /**
   * Get cache duration for a specific key type
   */
  getCacheDuration(key: CacheKey): number {
    return CACHE_DURATIONS[key as keyof typeof CACHE_DURATIONS] || CACHE_DURATIONS.default;
  },
};

/**
 * Cache wrapper for React Query - fetch with cache fallback
 * Returns cached data immediately, then fetches fresh data
 */
export async function fetchWithCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  cacheKey?: CacheKey
): Promise<T> {
  const duration = nativeStorage.getCacheDuration(cacheKey || key);

  try {
    // Try to fetch fresh data
    const data = await fetchFn();

    // Cache the successful response
    await nativeStorage.set(key, data, duration);

    return data;
  } catch (error) {
    // On error, try to return cached data
    const cached = await nativeStorage.get<T>(key);
    if (cached) {
      loggers.nativeStorage.debug('Using cached data due to fetch error', { key });
      return cached;
    }
    throw error;
  }
}

/**
 * Get initial data from cache for React Query
 */
export async function getInitialCachedData<T>(key: string): Promise<T | undefined> {
  const cached = await nativeStorage.get<T>(key);
  return cached || undefined;
}
