// Export interfaces
export * from './interfaces';

// Export service registry
export * from './service-registry';

// Export service implementations
export * from './amp-service';
export * from './service-checker';
export * from './email-service';
export * from './epub-service';
export * from './xtream-codes-service';
export * from './stream-tracker-service';

// Import services and service registry
import { serviceRegistry } from './service-registry';
import { ampService } from './amp-service';
import { serviceCheckerService } from './service-checker';
import { emailService } from './email-service';
import { epubService } from './epub-service';
import { xtreamCodesService } from './xtream-codes-service';
import { streamTrackerService } from './stream-tracker-service';
import { getSharedEPGService } from './epg-singleton';

/**
 * Initialize all services and register them with the service registry
 */
export async function initializeServices(): Promise<void> {
  // Register all services with the registry
  serviceRegistry.register('amp', ampService);
  serviceRegistry.register('service-checker', serviceCheckerService);
  serviceRegistry.register('email', emailService);
  serviceRegistry.register('epub', epubService);
  serviceRegistry.register('xtream-codes', xtreamCodesService);

  // Initialize all registered services
  await serviceRegistry.initializeAll();

  // Start stream tracker cleanup interval
  streamTrackerService.startCleanupInterval();

  // Initialize EPG service on startup to build 7-day cache
  console.log('[EPG] Initializing EPG service on startup...');
  getSharedEPGService().then(() => {
    console.log('[EPG] EPG service initialized and caching started');
  }).catch((err) => {
    console.error('[EPG] Failed to initialize EPG service:', err);
  });

  console.log('All services initialized');
}