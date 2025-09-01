import { Service, GameServer } from "@shared/schema";
import { storage } from "./storage";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { services, gameServers } from "@shared/schema";

// Cache to store the last known status of each service
const statusCache = new Map<number, { status: boolean; lastCheck: number; consecutiveFailures: number }>();

// Simplified HTTP service check that only reports status (no response time tracking)
async function checkHttpService(url: string): Promise<{ status: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // Reduced to 5 second timeout

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ServiceHealthChecker/1.0'
      }
    });

    clearTimeout(timeout);
    return {
      status: response.ok
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`Service check failed for URL ${url}:`, errorMessage);

    // Simple error categorization
    const isNetworkError = errorMessage.includes('fetch failed') || 
                          errorMessage.includes('network') ||
                          errorMessage.includes('ECONNREFUSED') ||
                          errorMessage.includes('ETIMEDOUT');

    return {
      status: false,
      error: isNetworkError ? 'network_error' : 'service_error'
    };
  }
}

async function updateServiceStatus(service: Service) {
  // Reduced logging - only log actual status updates
  // console.log(`Checking service ${service.name} (${service.url})`);

  // Get cached status
  const cachedStatus = statusCache.get(service.id) || { 
    status: false, 
    lastCheck: 0,
    consecutiveFailures: 0 
  };

  const now = Date.now();

  // Skip check if service was checked recently based on its refreshInterval
  if (service.refreshInterval && 
      (now - cachedStatus.lastCheck) < (service.refreshInterval * 1000)) {
    return;
  }

  // Perform the service check
  const { status, error } = await checkHttpService(service.url);
  // Only log errors or status changes, not successful checks
  if (error || status !== cachedStatus.status) {
    console.log(`Service ${service.name} status check:`, { status, error });
  }

  // Update consecutive failures count
  if (!status) {
    cachedStatus.consecutiveFailures++;
  } else {
    cachedStatus.consecutiveFailures = 0;
  }

  // Only consider a service truly offline after 2 consecutive failures
  // This helps prevent false offline notifications due to temporary issues
  const isOffline = !status && cachedStatus.consecutiveFailures >= 2;
  const currentStatus = !isOffline; // If not offline, then it's online

  // Only update database if status has significantly changed
  const hasStatusChanged = cachedStatus.status !== currentStatus;

  if (hasStatusChanged) {
    try {
      // Update service status in database
      await db
        .update(services)
        .set({ 
          status: currentStatus, 
          lastChecked: new Date().toISOString(),
          lastError: error ? `${error} at ${new Date().toISOString()}` : null
        })
        .where(eq(services.id, service.id));

      console.log(`Service status updated in database for ${service.name}`);
    } catch (error) {
      console.error('Error updating service status:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          serviceId: service.id,
          serviceName: service.name,
          status: currentStatus
        });
      }
    }
  } else {
    // Only update lastChecked if significant time has passed (every 5 minutes)
    // or if there's a new error to report
    const fiveMinutesAgo = new Date();
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
    
    const shouldUpdateTimestamp = 
      !service.lastChecked || 
      new Date(service.lastChecked) < fiveMinutesAgo || 
      (error && (!service.lastError || !service.lastError.includes(error)));
    
    if (shouldUpdateTimestamp) {
      try {
        await db
          .update(services)
          .set({ 
            lastChecked: new Date().toISOString(),
            lastError: error ? `${error} at ${new Date().toISOString()}` : null
          })
          .where(eq(services.id, service.id));
      } catch (error) {
        console.error('Error updating lastChecked timestamp:', error);
      }
    }
  }

  // Update cache
  statusCache.set(service.id, {
    status: currentStatus,
    lastCheck: now,
    consecutiveFailures: cachedStatus.consecutiveFailures
  });
}

async function updateGameServerMetrics(gameServers: GameServer[]) {
  for (const server of gameServers) {
    if (!server.hidden) {
      try {
        // Only update metrics if the last update was more than 30 seconds ago
        // This reduces database operations even if the function is called more frequently
        const thirtySecondsAgo = new Date(Date.now() - 30000);
        
        if (!server.lastStatusCheck || new Date(server.lastStatusCheck) < thirtySecondsAgo) {
          await storage.updateGameServer({
            id: server.id,
            lastStatusCheck: new Date()
          });
          // Reduced logging - only for debugging
          // console.log(`Updated metrics for game server ${server.name}`);
        }
        // Removed skipping log message to reduce console clutter
      } catch (error) {
        console.error(`Error updating game server ${server.name} metrics:`, error);
      }
    }
  }
}

async function checkServicesWithRateLimit(services: Service[], gameServers: GameServer[], batchSize: number = 5) { // Increased batch size from 3 to 5
  // First check game servers as they need more frequent updates
  for (const server of gameServers) {
    if (!server.hidden && (!server.lastStatusCheck || 
        Date.now() - server.lastStatusCheck.getTime() >= (server.refreshInterval || 30) * 1000)) {  // Status check interval
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
  for (let i = 0; i < services.length; i += batchSize) {
    const batch = services.slice(i, i + batchSize);
    await Promise.all(batch.map(updateServiceStatus));
    if (i + batchSize < services.length) {
      await new Promise(resolve => setTimeout(resolve, 500)); // Reduced from 1000ms to 500ms delay between batches
    }
  }
}

export async function startServiceChecker() {
  console.log('Starting service checker...');

  // Initial check
  try {
    const allServices = await db.select().from(services);
    const allGameServers = await db.select().from(gameServers);
    console.log(`Found ${allServices.length} services and ${allGameServers.length} game servers to check`);
    await checkServicesWithRateLimit(allServices, allGameServers);
  } catch (error) {
    console.error('Error in initial service check:', error);
  }

  // Check game server metrics every 30 seconds (increased from 10)
  setInterval(async () => {
    try {
      const allGameServers = await db.select().from(gameServers);
      await updateGameServerMetrics(allGameServers);
    } catch (error) {
      console.error('Error updating game server metrics:', error);
    }
  }, 30000); // Increased from 10000 to 30000 for less frequent updates

  // Check services and server status
  setInterval(async () => {
    try {
      const allServices = await db.select().from(services);
      const allGameServers = await db.select().from(gameServers);
      await checkServicesWithRateLimit(allServices, allGameServers);
    } catch (error) {
      console.error('Error checking services:', error);
    }
  }, 15000); // Increased from 3000 to 15000 for less frequent checks
}