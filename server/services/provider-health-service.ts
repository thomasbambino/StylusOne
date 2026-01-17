import { db } from '../db';
import { iptvProviders, iptvCredentials, providerHealthLogs } from '@shared/schema';
import { eq, desc, and, gte } from 'drizzle-orm';
import { decrypt } from '../utils/encryption';
import axios from 'axios';
import { loggers } from '../lib/logger';

/**
 * Service for monitoring IPTV provider health
 * Checks providers every 5 minutes and logs health status
 */

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTimeMs: number | null;
  errorMessage: string | null;
}

export class ProviderHealthService {
  private checkIntervalId: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly HEALTHY_THRESHOLD_MS = 5000; // < 5s = healthy
  private readonly DEGRADED_THRESHOLD_MS = 15000; // 5-15s = degraded, > 15s = unhealthy
  private readonly REQUEST_TIMEOUT_MS = 20000; // 20s timeout

  /**
   * Start the periodic health check interval
   */
  startHealthChecks(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
    }

    loggers.providerHealth.info('Starting health check service (5 minute interval)');

    // Run immediately on startup
    this.checkAllProviders().catch(err =>
      loggers.providerHealth.error('Initial check failed', { error: err })
    );

    // Then run every 5 minutes
    this.checkIntervalId = setInterval(async () => {
      try {
        await this.checkAllProviders();
      } catch (error) {
        loggers.providerHealth.error('Check cycle failed', { error });
      }
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop the health check interval
   */
  stopHealthChecks(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      loggers.providerHealth.info('Health check service stopped');
    }
  }

  /**
   * Check health of all active providers
   */
  private async checkAllProviders(): Promise<void> {
    const providers = await db.select()
      .from(iptvProviders)
      .where(eq(iptvProviders.isActive, true));

    loggers.providerHealth.debug(`Checking ${providers.length} providers...`);

    for (const provider of providers) {
      try {
        const result = await this.checkProviderHealth(provider.id);

        // Log status change
        const previousStatus = provider.healthStatus;
        if (previousStatus !== result.status) {
          loggers.providerHealth.info(`${provider.name}: ${previousStatus} -> ${result.status}`);
        }
      } catch (error) {
        loggers.providerHealth.error(`Failed to check ${provider.name}`, { error });
      }
    }
  }

  /**
   * Check health of a single provider
   */
  async checkProviderHealth(providerId: number): Promise<HealthCheckResult> {
    // Get provider info
    const [provider] = await db.select()
      .from(iptvProviders)
      .where(eq(iptvProviders.id, providerId));

    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    // Get one active credential for this provider
    const [credential] = await db.select()
      .from(iptvCredentials)
      .where(and(
        eq(iptvCredentials.providerId, providerId),
        eq(iptvCredentials.isActive, true)
      ))
      .limit(1);

    if (!credential) {
      // No credentials available - mark as unknown
      return this.logAndUpdateHealth(providerId, {
        status: 'unhealthy',
        responseTimeMs: null,
        errorMessage: 'No active credentials available'
      });
    }

    // Decrypt server URL and credentials
    let serverUrl: string;
    let username: string;
    let password: string;

    try {
      serverUrl = decrypt(provider.serverUrl);
      username = decrypt(credential.username);
      password = decrypt(credential.password);
    } catch (error) {
      return this.logAndUpdateHealth(providerId, {
        status: 'unhealthy',
        responseTimeMs: null,
        errorMessage: 'Failed to decrypt credentials'
      });
    }

    // Test authentication
    const startTime = Date.now();

    try {
      const url = `${serverUrl}/player_api.php?username=${username}&password=${password}`;
      const response = await axios.get(url, { timeout: this.REQUEST_TIMEOUT_MS });
      const responseTime = Date.now() - startTime;

      // Check if response is valid
      if (!response.data || !response.data.user_info) {
        return this.logAndUpdateHealth(providerId, {
          status: 'unhealthy',
          responseTimeMs: responseTime,
          errorMessage: 'Invalid authentication response'
        });
      }

      // Check user status
      const userStatus = response.data.user_info?.status;
      if (userStatus !== 'Active') {
        return this.logAndUpdateHealth(providerId, {
          status: 'unhealthy',
          responseTimeMs: responseTime,
          errorMessage: `User status: ${userStatus}`
        });
      }

      // Determine health based on response time
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (responseTime < this.HEALTHY_THRESHOLD_MS) {
        status = 'healthy';
      } else if (responseTime < this.DEGRADED_THRESHOLD_MS) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }

      return this.logAndUpdateHealth(providerId, {
        status,
        responseTimeMs: responseTime,
        errorMessage: null
      });

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      let errorMessage = 'Connection failed';

      if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused';
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        errorMessage = 'Connection timeout';
      } else if (error.response?.status) {
        errorMessage = `HTTP ${error.response.status}`;
      } else if (error.message) {
        errorMessage = error.message.substring(0, 100);
      }

      return this.logAndUpdateHealth(providerId, {
        status: 'unhealthy',
        responseTimeMs: responseTime < this.REQUEST_TIMEOUT_MS ? responseTime : null,
        errorMessage
      });
    }
  }

  /**
   * Log health result and update provider status
   */
  private async logAndUpdateHealth(
    providerId: number,
    result: HealthCheckResult
  ): Promise<HealthCheckResult> {
    const now = new Date();

    // Insert health log
    await db.insert(providerHealthLogs).values({
      providerId,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      errorMessage: result.errorMessage,
      checkedAt: now
    });

    // Update provider health status
    await db.update(iptvProviders)
      .set({
        healthStatus: result.status,
        lastHealthCheck: now,
        updatedAt: now
      })
      .where(eq(iptvProviders.id, providerId));

    return result;
  }

  /**
   * Get current health status for a provider
   */
  async getProviderHealthStatus(providerId: number): Promise<'healthy' | 'unhealthy' | 'degraded' | 'unknown'> {
    const [provider] = await db.select({ healthStatus: iptvProviders.healthStatus })
      .from(iptvProviders)
      .where(eq(iptvProviders.id, providerId));

    return (provider?.healthStatus as 'healthy' | 'unhealthy' | 'degraded' | 'unknown') || 'unknown';
  }

  /**
   * Get health history for a provider
   */
  async getHealthHistory(providerId: number, hours: number = 24): Promise<typeof providerHealthLogs.$inferSelect[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    return db.select()
      .from(providerHealthLogs)
      .where(and(
        eq(providerHealthLogs.providerId, providerId),
        gte(providerHealthLogs.checkedAt, since)
      ))
      .orderBy(desc(providerHealthLogs.checkedAt))
      .limit(500);
  }

  /**
   * Calculate uptime percentage for a provider
   */
  async getUptimePercentage(providerId: number, days: number = 1): Promise<number> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logs = await db.select()
      .from(providerHealthLogs)
      .where(and(
        eq(providerHealthLogs.providerId, providerId),
        gte(providerHealthLogs.checkedAt, since)
      ));

    if (logs.length === 0) return 100; // No data = assume healthy

    const healthyCount = logs.filter(log =>
      log.status === 'healthy' || log.status === 'degraded'
    ).length;

    return Math.round((healthyCount / logs.length) * 100);
  }

  /**
   * Get health summary for all providers
   */
  async getAllProvidersHealthSummary(): Promise<Array<{
    providerId: number;
    name: string;
    healthStatus: string;
    lastHealthCheck: Date | null;
    uptime24h: number;
    lastError: string | null;
  }>> {
    const providers = await db.select()
      .from(iptvProviders)
      .where(eq(iptvProviders.isActive, true));

    const results = await Promise.all(providers.map(async (provider) => {
      const uptime24h = await this.getUptimePercentage(provider.id, 1);

      // Get last error if unhealthy
      let lastError: string | null = null;
      if (provider.healthStatus === 'unhealthy') {
        const [lastLog] = await db.select()
          .from(providerHealthLogs)
          .where(and(
            eq(providerHealthLogs.providerId, provider.id),
            eq(providerHealthLogs.status, 'unhealthy')
          ))
          .orderBy(desc(providerHealthLogs.checkedAt))
          .limit(1);
        lastError = lastLog?.errorMessage || null;
      }

      return {
        providerId: provider.id,
        name: provider.name,
        healthStatus: provider.healthStatus || 'unknown',
        lastHealthCheck: provider.lastHealthCheck,
        uptime24h,
        lastError
      };
    }));

    return results;
  }

  /**
   * Clean up old health logs (keep last 30 days)
   */
  async cleanupOldLogs(): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await db.delete(providerHealthLogs)
      .where(gte(providerHealthLogs.checkedAt, thirtyDaysAgo));

    return 0; // Drizzle doesn't return count for deletes easily
  }
}

// Export singleton instance
export const providerHealthService = new ProviderHealthService();
