import { EPGService } from './epg-service';

// Single shared EPG service instance
let epgServiceInstance: EPGService | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Get the shared EPG service instance
 * This ensures only one EPG service exists across the entire application
 */
export async function getSharedEPGService(): Promise<EPGService> {
  if (!epgServiceInstance) {
    console.log('[EPG-Singleton] Creating shared EPG service instance');
    epgServiceInstance = new EPGService();
    initPromise = epgServiceInstance.initialize();
  }

  if (initPromise) {
    await initPromise;
    initPromise = null; // Clear after first await
  }

  return epgServiceInstance;
}

/**
 * Get EPG service synchronously (may not be initialized yet)
 * Use this only when you need non-blocking access
 */
export function getEPGServiceSync(): EPGService | null {
  return epgServiceInstance;
}
