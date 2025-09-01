import { IService, IServiceRegistry } from './interfaces';

/**
 * Service registry implementation that manages all services
 */
export class ServiceRegistry implements IServiceRegistry {
  private services: Map<string, IService> = new Map();

  /**
   * Register a service with the registry
   * @param name The unique name of the service
   * @param service The service instance
   */
  register(name: string, service: IService): void {
    if (this.services.has(name)) {
      console.warn(`Service with name "${name}" is already registered. It will be overwritten.`);
    }
    this.services.set(name, service);
  }

  /**
   * Get a service by name
   * @param name The name of the service
   * @returns The service instance
   */
  get<T extends IService>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service "${name}" not found in registry`);
    }
    return service as T;
  }

  /**
   * Initialize all registered services
   */
  async initializeAll(): Promise<void> {
    for (const [name, service] of this.services.entries()) {
      try {
        console.log(`Initializing service: ${name}`);
        await service.initialize();
      } catch (error) {
        console.error(`Failed to initialize service "${name}":`, error);
      }
    }
  }

  /**
   * Get a list of all registered service names
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }
}

// Create and export a singleton instance
export const serviceRegistry = new ServiceRegistry();