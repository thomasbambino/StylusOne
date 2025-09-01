/**
 * Base service interface that provides lifecycle hooks for services
 * @packageDocumentation
 */
export interface IService {
  /**
   * Initialize the service with configuration
   */
  initialize(): Promise<void>;
  
  /**
   * Reinitialize the service with new configuration
   */
  reinitialize(...args: any[]): Promise<void>;
  
  /**
   * Check if the service is healthy
   */
  isHealthy(): Promise<boolean>;
}

/**
 * Interface for the service registry that manages all services
 */
export interface IServiceRegistry {
  /**
   * Register a service with the registry
   * @param name The unique name of the service
   * @param service The service instance
   */
  register(name: string, service: IService): void;
  
  /**
   * Get a service by name
   * @param name The name of the service
   * @returns The service instance
   */
  get<T extends IService>(name: string): T;
  
  /**
   * Initialize all registered services
   */
  initializeAll(): Promise<void>;
}