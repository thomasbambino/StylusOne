/**
 * EPG (Electronic Program Guide) Cache
 * Stores EPG data in IndexedDB for offline access and faster loading
 */

const DB_NAME = 'epg-cache';
const DB_VERSION = 1;
const STORE_NAME = 'programs';

interface CachedEPGData {
  channelId: string;
  programs: any[];
  cachedAt: number;
  expiresAt: number; // Latest program end time
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open or create the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[EPG Cache] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'channelId' });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };
  });

  return dbPromise;
}

/**
 * Get cached EPG data for a channel
 */
export async function getCachedEPG(channelId: string): Promise<any[] | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(channelId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const data = request.result as CachedEPGData | undefined;
        if (!data) {
          resolve(null);
          return;
        }

        // Check if cache is still valid (has future programs)
        const now = Date.now();
        if (data.expiresAt <= now) {
          // Cache expired, delete it
          deleteFromCache(channelId);
          resolve(null);
          return;
        }

        // Filter out expired programs
        const validPrograms = data.programs.filter((p: any) => {
          const endTime = new Date(p.endTime).getTime();
          return endTime > now;
        });

        resolve(validPrograms.length > 0 ? validPrograms : null);
      };
    });
  } catch (error) {
    console.error('[EPG Cache] Error getting cached data:', error);
    return null;
  }
}

/**
 * Cache EPG data for a channel
 */
export async function cacheEPG(channelId: string, programs: any[]): Promise<void> {
  if (!programs || programs.length === 0) return;

  try {
    const db = await openDB();

    // Find the latest program end time
    let latestEndTime = 0;
    for (const program of programs) {
      const endTime = new Date(program.endTime).getTime();
      if (endTime > latestEndTime) {
        latestEndTime = endTime;
      }
    }

    const data: CachedEPGData = {
      channelId,
      programs,
      cachedAt: Date.now(),
      expiresAt: latestEndTime
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(data);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('[EPG Cache] Error caching data:', error);
  }
}

/**
 * Delete cached data for a channel
 */
async function deleteFromCache(channelId: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(channelId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('[EPG Cache] Error deleting from cache:', error);
  }
}

/**
 * Clear all expired entries from cache
 */
export async function cleanupExpiredCache(): Promise<number> {
  try {
    const db = await openDB();
    const now = Date.now();
    let deletedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('expiresAt');
      const range = IDBKeyRange.upperBound(now);
      const request = index.openCursor(range);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          if (deletedCount > 0) {
            console.log(`[EPG Cache] Cleaned up ${deletedCount} expired entries`);
          }
          resolve(deletedCount);
        }
      };
    });
  } catch (error) {
    console.error('[EPG Cache] Error cleaning up cache:', error);
    return 0;
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{ channels: number; totalPrograms: number; cacheSize: string }> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entries = request.result as CachedEPGData[];
        let totalPrograms = 0;
        let totalSize = 0;

        for (const entry of entries) {
          totalPrograms += entry.programs.length;
          totalSize += JSON.stringify(entry).length;
        }

        const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);

        resolve({
          channels: entries.length,
          totalPrograms,
          cacheSize: `${sizeInMB} MB`
        });
      };
    });
  } catch (error) {
    console.error('[EPG Cache] Error getting stats:', error);
    return { channels: 0, totalPrograms: 0, cacheSize: '0 MB' };
  }
}

/**
 * Prefetch EPG data for multiple channels
 */
export async function prefetchEPG(
  channelIds: string[],
  fetchFn: (channelId: string) => Promise<any[]>
): Promise<void> {
  console.log(`[EPG Cache] Prefetching ${channelIds.length} channels...`);

  // Process in batches of 5 to avoid overwhelming the server
  const batchSize = 5;
  for (let i = 0; i < channelIds.length; i += batchSize) {
    const batch = channelIds.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (channelId) => {
        try {
          // Check if already cached
          const cached = await getCachedEPG(channelId);
          if (cached && cached.length > 0) {
            return; // Already cached
          }

          const programs = await fetchFn(channelId);
          if (programs && programs.length > 0) {
            await cacheEPG(channelId, programs);
          }
        } catch (error) {
          console.error(`[EPG Cache] Failed to prefetch ${channelId}:`, error);
        }
      })
    );
  }

  console.log('[EPG Cache] Prefetch complete');
}

// Clean up expired cache on module load
cleanupExpiredCache();
