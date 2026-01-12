import { isNativePlatform } from './capacitor';
import { CapacitorHttp } from '@capacitor/core';

const DB_NAME = 'ImageCache';
const STORE_NAME = 'images';
const DB_VERSION = 1;
const MAX_CACHE_SIZE = 500; // Maximum number of images to cache
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedImage {
  url: string;
  blob: Blob;
  timestamp: number;
}

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB for image caching
 */
async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[ImageCache] Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'url' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * Get cached image blob URL
 */
export async function getCachedImage(url: string): Promise<string | null> {
  if (!url) return null;

  try {
    const database = await initDB();
    return new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onsuccess = () => {
        const cached = request.result as CachedImage | undefined;
        if (cached) {
          // Check if expired
          if (Date.now() - cached.timestamp > CACHE_EXPIRY) {
            // Expired, delete and return null
            deleteFromCache(url);
            resolve(null);
          } else {
            // Return blob URL
            const blobUrl = URL.createObjectURL(cached.blob);
            resolve(blobUrl);
          }
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        resolve(null);
      };
    });
  } catch (error) {
    console.error('[ImageCache] Error getting cached image:', error);
    return null;
  }
}

/**
 * Cache an image from URL
 */
export async function cacheImage(url: string): Promise<string | null> {
  if (!url) return null;

  try {
    // First check if already cached
    const cached = await getCachedImage(url);
    if (cached) return cached;

    let blob: Blob;

    // Use Capacitor HTTP for native apps to bypass CORS
    if (isNativePlatform()) {
      console.log('[ImageCache] Using CapacitorHttp for:', url);
      const response = await CapacitorHttp.get({
        url,
        responseType: 'blob', // Returns base64-encoded data
      });

      if (response.status !== 200) {
        console.warn('[ImageCache] HTTP error:', response.status, url);
        return null;
      }

      // CapacitorHttp returns blob as base64 string
      const base64Data = response.data as string;
      const contentType = response.headers?.['Content-Type'] || response.headers?.['content-type'] || 'image/png';

      // Convert base64 to Blob
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      blob = new Blob([byteArray], { type: contentType });
    } else {
      // Use fetch for web
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) return null;
      blob = await response.blob();
    }

    // Store in IndexedDB
    const database = await initDB();
    return new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const cachedImage: CachedImage = {
        url,
        blob,
        timestamp: Date.now(),
      };

      const request = store.put(cachedImage);

      request.onsuccess = () => {
        const blobUrl = URL.createObjectURL(blob);
        console.log('[ImageCache] Cached:', url);
        resolve(blobUrl);

        // Clean up old entries if needed
        cleanupOldEntries();
      };

      request.onerror = () => {
        resolve(null);
      };
    });
  } catch (error) {
    // CORS or network error - return original URL
    console.warn('[ImageCache] Failed to cache image:', url, error);
    return null;
  }
}

/**
 * Delete image from cache
 */
async function deleteFromCache(url: string): Promise<void> {
  try {
    const database = await initDB();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(url);
  } catch (error) {
    console.error('[ImageCache] Error deleting from cache:', error);
  }
}

/**
 * Clean up old entries if cache is too large
 */
async function cleanupOldEntries(): Promise<void> {
  try {
    const database = await initDB();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    const countRequest = store.count();
    countRequest.onsuccess = () => {
      const count = countRequest.result;
      if (count > MAX_CACHE_SIZE) {
        // Delete oldest entries
        const deleteCount = count - MAX_CACHE_SIZE + 50; // Delete 50 extra for buffer
        let deleted = 0;

        const cursorRequest = index.openCursor();
        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor && deleted < deleteCount) {
            cursor.delete();
            deleted++;
            cursor.continue();
          }
        };
      }
    };
  } catch (error) {
    console.error('[ImageCache] Error cleaning up cache:', error);
  }
}

/**
 * Clear all cached images
 */
export async function clearImageCache(): Promise<void> {
  try {
    const database = await initDB();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    console.log('[ImageCache] Cache cleared');
  } catch (error) {
    console.error('[ImageCache] Error clearing cache:', error);
  }
}

/**
 * Preload and cache multiple images
 */
export async function preloadImages(urls: string[]): Promise<void> {
  if (!isNativePlatform()) return; // Only preload on native

  const validUrls = urls.filter(url => url && url.startsWith('http'));
  console.log(`[ImageCache] Preloading ${validUrls.length} images`);

  // Process in batches to avoid overwhelming the network
  const batchSize = 10;
  for (let i = 0; i < validUrls.length; i += batchSize) {
    const batch = validUrls.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(url => cacheImage(url)));
  }
}
