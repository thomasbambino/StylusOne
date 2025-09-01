import { IService } from './interfaces';
import { Service, GameServer } from "@shared/schema";
import { storage } from "../storage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { services, gameServers } from "@shared/schema";
import axios from 'axios';
import { ampService } from './amp-service';

/**
 * Service for checking the status of services and game servers
 */
export class ServiceCheckerService implements IService {
  private batchSize: number = 5;
  private gameServerInterval: number = 30000; // 30 seconds
  private serviceCheckInterval: number = 15000; // 15 seconds
  private initialized: boolean = false;
  private intervalIds: NodeJS.Timeout[] = [];

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.warn('Service checker already initialized, skipping');
      return;
    }

    console.log('Starting service checker...');
    
    // Initial check
    try {
      const allServices = await db.select().from(services);
      const allGameServers = await db.select().from(gameServers);
      console.log(`Found ${allServices.length} services and ${allGameServers.length} game servers to check`);
      await this.checkServicesWithRateLimit(allServices, allGameServers);
    } catch (error) {
      console.error('Error in initial service check:', error);
    }

    // Check game server metrics periodically
    const metricsIntervalId = setInterval(async () => {
      try {
        const allGameServers = await db.select().from(gameServers);
        await this.updateGameServerMetrics(allGameServers);
      } catch (error) {
        console.error('Error updating game server metrics:', error);
      }
    }, this.gameServerInterval);
    
    this.intervalIds.push(metricsIntervalId);

    // Check services and server status periodically
    const serviceIntervalId = setInterval(async () => {
      try {
        const allServices = await db.select().from(services);
        const allGameServers = await db.select().from(gameServers);
        await this.checkServicesWithRateLimit(allServices, allGameServers);
      } catch (error) {
        console.error('Error checking services:', error);
      }
    }, this.serviceCheckInterval);
    
    this.intervalIds.push(serviceIntervalId);
    
    this.initialized = true;
    console.log('Service checker initialized successfully');
  }

  /**
   * Reinitialize the service with new configuration
   */
  async reinitialize(options?: { 
    batchSize?: number, 
    gameServerInterval?: number, 
    serviceCheckInterval?: number 
  }): Promise<void> {
    // Clear existing intervals
    this.intervalIds.forEach(id => clearInterval(id));
    this.intervalIds = [];
    
    // Update configuration
    if (options) {
      if (options.batchSize) this.batchSize = options.batchSize;
      if (options.gameServerInterval) this.gameServerInterval = options.gameServerInterval;
      if (options.serviceCheckInterval) this.serviceCheckInterval = options.serviceCheckInterval;
    }
    
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Check if the service is healthy
   */
  async isHealthy(): Promise<boolean> {
    return this.initialized;
  }

  /**
   * Check HTTP service status
   */
  private async checkHttpService(url: string): Promise<{ status: boolean; error?: string }> {
    try {
      // Set a reasonable timeout (5 seconds)
      const response = await axios.get(url, { 
        timeout: 5000,
        validateStatus: () => true // Don't throw for any status code
      });
      
      return { status: response.status >= 200 && response.status < 400 };
    } catch (error) {
      console.error(`Error checking HTTP service at ${url}:`, error);
      
      let errorMessage = 'Connection failed';
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          errorMessage = 'Connection refused';
        } else if (error.code === 'ETIMEDOUT') {
          errorMessage = 'Connection timed out';
        } else if (error.message) {
          errorMessage = error.message;
        }
      }
      
      return { 
        status: false,
        error: errorMessage
      };
    }
  }

  /**
   * Update service status
   */
  private async updateServiceStatus(service: Service): Promise<void> {
    try {
      if (service.hidden) {
        return;
      }

      const now = new Date();
      let shouldUpdate = false;
      let statusChanged = false;
      
      // Only check status if it's time to do so based on refresh interval
      if (!service.lastChecked || 
          now.getTime() - (service.lastChecked instanceof Date ? service.lastChecked.getTime() : 0) >= (service.refreshInterval || 30) * 1000) {
        
        const result = await this.checkHttpService(service.url);
        
        // Check if status changed
        if (service.status !== result.status || service.error !== result.error) {
          statusChanged = true;
        }
        
        // Only update if status changed or it's been more than 5 minutes
        if (statusChanged || 
            !service.lastChecked || 
            now.getTime() - (service.lastChecked instanceof Date ? service.lastChecked.getTime() : 0) >= 5 * 60 * 1000) {
          shouldUpdate = true;
        }
        
        if (shouldUpdate) {
          await storage.updateService({
            id: service.id,
            status: result.status,
            lastChecked: now,
            error: result.error
          });
        }
      }
    } catch (error) {
      console.error(`Error updating service status for ${service.name}:`, error);
    }
  }

  /**
   * Update game server metrics
   */
  private async updateGameServerMetrics(gameServers: GameServer[]): Promise<void> {
    try {
      // Get all AMP instances
      const ampInstances = await ampService.getInstances();
      
      if (!ampInstances || ampInstances.length === 0) {
        console.warn('No AMP instances found when updating metrics');
        return;
      }
      
      for (const server of gameServers) {
        if (server.hidden) continue;
        
        // Find matching AMP instance
        const instance = ampInstances.find(i => i.InstanceID === server.instanceId);
        if (!instance) {
          console.warn(`No matching AMP instance found for server ${server.name} (${server.instanceId})`);
          continue;
        }
        
        // Check if the instance is running
        if (!instance.Running) {
          // Update status to offline if it's changed
          if (server.status !== false) {
            await storage.updateGameServer({
              id: server.id,
              status: false,
              playerCount: 0
            });
          }
          continue;
        }
        
        try {
          // Get metrics for the instance
          const metrics = await ampService.getMetrics(server.instanceId);
          
          // Check if we need to update status or player count
          const statusChanged = server.status !== instance.Running;
          const playerCountChanged = server.playerCount !== metrics.activePlayers;
          const maxPlayersChanged = server.maxPlayers !== metrics.maxPlayers;
          
          if (statusChanged || playerCountChanged || maxPlayersChanged) {
            await storage.updateGameServer({
              id: server.id,
              status: instance.Running,
              playerCount: metrics.activePlayers,
              maxPlayers: metrics.maxPlayers
            });
          }
        } catch (error) {
          console.error(`Error getting metrics for server ${server.name}:`, error);
          
          // If we encounter an error, mark the server as offline
          if (server.status !== false) {
            await storage.updateGameServer({
              id: server.id,
              status: false
            });
          }
        }
      }
    } catch (error) {
      console.error('Error updating game server metrics:', error);
    }
  }

  /**
   * Check services with rate limiting
   */
  private async checkServicesWithRateLimit(services: Service[], gameServers: GameServer[]): Promise<void> {
    // First check game servers as they need more frequent updates
    for (const server of gameServers) {
      if (!server.hidden && (!server.lastStatusCheck || 
          Date.now() - (server.lastStatusCheck instanceof Date ? server.lastStatusCheck.getTime() : 0) >= (server.refreshInterval || 30) * 1000)) {  // Status check interval
        try {
          await storage.updateGameServer({
            id: server.id,
            lastStatusCheck: new Date()
          });
        } catch (error) {
          console.error(`Error updating game server ${server.name}:`, error);
        }
      }
    }

    // Then check other services
    for (let i = 0; i < services.length; i += this.batchSize) {
      const batch = services.slice(i, i + this.batchSize);
      await Promise.all(batch.map(service => this.updateServiceStatus(service)));
      if (i + this.batchSize < services.length) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between batches
      }
    }
  }
}

// Export a singleton instance
export const serviceCheckerService = new ServiceCheckerService();