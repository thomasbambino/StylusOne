// Export interfaces
export * from './interfaces';

// Export service registry
export * from './service-registry';

// Export service implementations
export * from './amp-service';
export * from './service-checker';
export * from './email-service';
export * from './epub-service';

// Import services and service registry
import { serviceRegistry } from './service-registry';
import { ampService } from './amp-service';
import { serviceCheckerService } from './service-checker';
import { emailService } from './email-service';
import { epubService } from './epub-service';

/**
 * Initialize all services and register them with the service registry
 */
export async function initializeServices(): Promise<void> {
  // Register all services with the registry
  serviceRegistry.register('amp', ampService);
  serviceRegistry.register('service-checker', serviceCheckerService);
  serviceRegistry.register('email', emailService);
  serviceRegistry.register('epub', epubService);
  
  // Initialize all registered services
  await serviceRegistry.initializeAll();
  
  console.log('All services initialized');
}