/**
 * Cache management utilities for the application
 */

export const CACHE_VERSION = 'v2.0.0-20250903';

/**
 * Clear all caches for the application
 */
export async function clearAllCaches(): Promise<void> {
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(cacheName => {
        console.log(`[CacheHelper] Deleting cache: ${cacheName}`);
        return caches.delete(cacheName);
      })
    );
  }
}

/**
 * Unregister all service workers
 */
export async function unregisterServiceWorkers(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map(registration => {
        console.log('[CacheHelper] Unregistering service worker:', registration.scope);
        return registration.unregister();
      })
    );
  }
}

/**
 * Force a hard refresh of the application
 */
export async function forceRefresh(): Promise<void> {
  // Clear all caches
  await clearAllCaches();
  
  // Unregister service workers
  await unregisterServiceWorkers();
  
  // Clear session storage
  sessionStorage.clear();
  
  // Clear local storage (optional - be careful with this)
  // localStorage.clear();
  
  // Force reload, bypassing cache
  window.location.reload();
}

/**
 * Check if an update is available
 */
export async function checkForUpdates(): Promise<boolean> {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    
    // Check if there's a waiting worker
    return !!registration.waiting;
  }
  return false;
}

/**
 * Get current cache version
 */
export function getCurrentCacheVersion(): string {
  return CACHE_VERSION;
}

/**
 * Add keyboard shortcut for hard refresh
 * Ctrl+Shift+R (or Cmd+Shift+R on Mac)
 */
export function addHardRefreshShortcut(): void {
  document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
      e.preventDefault();
      console.log('[CacheHelper] Hard refresh triggered');
      await forceRefresh();
    }
  });
}