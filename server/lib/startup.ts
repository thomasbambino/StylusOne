import { StartupDisplay, measureDuration, formatDuration } from './startup-display';
import { sql } from 'drizzle-orm';
import type { ServiceInfo, ServiceCategory } from '../../shared/lib/logger/types';

// Lazy import db to avoid throwing at import time if DATABASE_URL not set
let db: any = null;
async function getDb() {
  if (!db && process.env.DATABASE_URL) {
    const { db: dbModule } = await import('../db');
    db = dbModule;
  }
  return db;
}

// Services will be lazily imported to avoid db.ts throwing at import time
let serviceRegistry: any = null;
let ampService: any = null;
let serviceCheckerService: any = null;
let emailService: any = null;
let epubService: any = null;
let xtreamCodesService: any = null;
let streamTrackerService: any = null;
let providerHealthService: any = null;
let getSharedEPGService: any = null;
let tautulliService: any = null;
let stripeService: any = null;
let hdHomeRunService: any = null;

async function loadServices() {
  if (serviceRegistry) return; // Already loaded

  try {
    const registryModule = await import('../services/service-registry');
    serviceRegistry = registryModule.serviceRegistry;

    const ampModule = await import('../services/amp-service');
    ampService = ampModule.ampService;

    const checkerModule = await import('../services/service-checker');
    serviceCheckerService = checkerModule.serviceCheckerService;

    const emailModule = await import('../services/email-service');
    emailService = emailModule.emailService;

    const epubModule = await import('../services/epub-service');
    epubService = epubModule.epubService;

    const xtreamModule = await import('../services/xtream-codes-service');
    xtreamCodesService = xtreamModule.xtreamCodesService;

    const streamModule = await import('../services/stream-tracker-service');
    streamTrackerService = streamModule.streamTrackerService;

    const healthModule = await import('../services/provider-health-service');
    providerHealthService = healthModule.providerHealthService;

    const epgModule = await import('../services/epg-singleton');
    getSharedEPGService = epgModule.getSharedEPGService;
  } catch (error) {
    // Silent fail - services will be initialized during startup display
  }

  // Try to import optional services
  try {
    const tautulliModule = await import('../services/tautulli-service');
    tautulliService = tautulliModule.tautulliService;
  } catch {}

  try {
    const stripeModule = await import('../services/stripe-service');
    stripeService = stripeModule.stripeService;
  } catch {}

  try {
    const hdHomeRunModule = await import('../services/hdhomerun-service');
    hdHomeRunService = (hdHomeRunModule as any).hdHomeRunService || (hdHomeRunModule as any).HDHomeRunService;
  } catch {}
}

const display = new StartupDisplay();

/**
 * Test database connection
 */
async function testDatabaseConnection(): Promise<ServiceInfo> {
  // Check if DATABASE_URL is configured
  if (!process.env.DATABASE_URL) {
    return {
      name: 'Database',
      status: 'failed',
      error: 'DATABASE_URL not set',
    };
  }

  try {
    const database = await getDb();
    if (!database) {
      return {
        name: 'Database',
        status: 'failed',
        error: 'Failed to initialize database',
      };
    }

    const { duration } = await measureDuration(async () => {
      await database.execute(sql`SELECT 1`);
    });
    return {
      name: 'Database',
      status: 'success',
      message: `connected (${formatDuration(duration)})`,
      duration,
    };
  } catch (error) {
    return {
      name: 'Database',
      status: 'failed',
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

/**
 * Check Firebase Admin configuration
 */
function checkFirebaseAdmin(): ServiceInfo {
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (projectId) {
    return {
      name: 'Firebase Admin',
      status: 'success',
      message: `project: ${projectId}`,
    };
  }
  return {
    name: 'Firebase Admin',
    status: 'skipped',
    message: 'not configured',
  };
}

/**
 * Check Google OAuth configuration
 */
function checkGoogleOAuth(): ServiceInfo {
  const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (clientId && clientSecret) {
    return {
      name: 'Google OAuth',
      status: 'success',
      message: 'configured',
    };
  }
  return {
    name: 'Google OAuth',
    status: 'skipped',
    message: 'not configured',
  };
}

/**
 * Check Plex configuration
 */
function checkPlex(): ServiceInfo {
  const token = process.env.PLEX_TOKEN;
  if (token) {
    return {
      name: 'Plex',
      status: 'success',
      message: 'token configured',
    };
  }
  return {
    name: 'Plex',
    status: 'skipped',
    message: 'not configured (PLEX_TOKEN)',
  };
}

/**
 * Check Tautulli service
 */
async function checkTautulli(): Promise<ServiceInfo> {
  const url = process.env.TAUTULLI_URL;
  const apiKey = process.env.TAUTULLI_API_KEY;

  if (!url || !apiKey) {
    return {
      name: 'Tautulli',
      status: 'skipped',
      message: 'not configured',
    };
  }

  if (tautulliService) {
    try {
      const healthy = await tautulliService.isHealthy();
      if (healthy) {
        return {
          name: 'Tautulli',
          status: 'success',
          message: 'connected',
        };
      }
    } catch {}
  }

  return {
    name: 'Tautulli',
    status: 'failed',
    error: 'connection failed',
  };
}

/**
 * Check TMDB configuration
 */
function checkTMDB(): ServiceInfo {
  const apiKey = process.env.TMDB_API_KEY;
  if (apiKey) {
    return {
      name: 'TMDB',
      status: 'success',
      message: 'API key configured',
    };
  }
  return {
    name: 'TMDB',
    status: 'skipped',
    message: 'not configured',
  };
}

/**
 * Check Stripe configuration
 */
function checkStripe(): ServiceInfo {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (secretKey) {
    const isLive = secretKey.startsWith('sk_live');
    return {
      name: 'Stripe',
      status: 'success',
      message: isLive ? 'live mode' : 'test mode',
    };
  }
  return {
    name: 'Stripe',
    status: 'skipped',
    message: 'not configured',
  };
}

/**
 * Check email service configuration
 */
function checkEmail(): ServiceInfo {
  const mailgunDomain = process.env.MAILGUN_DOMAIN;
  const mailgunKey = process.env.MAILGUN_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;

  if (mailgunDomain && mailgunKey) {
    return {
      name: 'Mailgun',
      status: 'success',
      message: `domain: ${mailgunDomain}`,
    };
  }

  if (sendgridKey) {
    return {
      name: 'SendGrid',
      status: 'success',
      message: 'configured',
    };
  }

  return {
    name: 'Email',
    status: 'skipped',
    message: 'not configured',
  };
}

/**
 * Check HD HomeRun configuration
 */
async function checkHDHomeRun(): Promise<ServiceInfo> {
  const url = process.env.HDHOMERUN_URL;

  if (!url) {
    return {
      name: 'HD HomeRun',
      status: 'skipped',
      message: 'not configured',
    };
  }

  if (hdHomeRunService) {
    try {
      const healthy = await hdHomeRunService.isHealthy();
      if (healthy) {
        const info = await hdHomeRunService.getDeviceInfo?.();
        const tuners = info?.TunerCount || 'unknown';
        return {
          name: 'HD HomeRun',
          status: 'success',
          message: `${tuners} tuners`,
        };
      }
    } catch {}
  }

  // Try a simple fetch to discover.json
  try {
    const response = await fetch(`${url}/discover.json`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const data = await response.json();
      return {
        name: 'HD HomeRun',
        status: 'success',
        message: `${data.ModelNumber || 'connected'} (${data.TunerCount || '?'} tuners)`,
      };
    }
  } catch {}

  return {
    name: 'HD HomeRun',
    status: 'failed',
    error: 'connection failed',
  };
}

/**
 * Initialize a single service with timing
 */
async function initializeServiceWithTracking(
  name: string,
  service: any,
  displayName: string,
  category: ServiceCategory
): Promise<void> {
  try {
    const { duration } = await measureDuration(async () => {
      await service.initialize();
    });

    // Check if service has isHealthy method
    let message = `initialized (${formatDuration(duration)})`;
    if (typeof service.isHealthy === 'function') {
      try {
        const healthy = await service.isHealthy();
        if (!healthy) {
          message = 'degraded mode';
        }
      } catch {}
    }

    display.addService(category, {
      name: displayName,
      status: 'success',
      message,
      duration,
    });
  } catch (error) {
    display.addService(category, {
      name: displayName,
      status: 'failed',
      error: error instanceof Error ? error.message : 'initialization failed',
    });
  }
}

/**
 * Check Xtream Codes providers from database
 */
async function checkXtreamCodes(): Promise<ServiceInfo> {
  try {
    const database = await getDb();
    if (!database) {
      return {
        name: 'Xtream Codes',
        status: 'skipped',
        message: 'database unavailable',
      };
    }

    // Check if there are any IPTV providers configured
    const { iptvProviders } = await import('../../shared/schema');
    const providers = await database.select().from(iptvProviders);
    if (providers.length > 0) {
      return {
        name: 'Xtream Codes',
        status: 'success',
        message: `${providers.length} provider${providers.length > 1 ? 's' : ''} configured`,
      };
    }
    return {
      name: 'Xtream Codes',
      status: 'skipped',
      message: 'no providers',
    };
  } catch {
    return {
      name: 'Xtream Codes',
      status: 'skipped',
      message: 'not available',
    };
  }
}

/**
 * Check AMP service
 */
async function checkAMP(): Promise<ServiceInfo> {
  const url = process.env.AMP_API_URL;
  const username = process.env.AMP_API_USERNAME;
  const password = process.env.AMP_API_PASSWORD;

  if (!url || !username || !password) {
    return {
      name: 'AMP',
      status: 'skipped',
      message: 'not configured',
    };
  }

  if (!ampService) {
    return {
      name: 'AMP',
      status: 'skipped',
      message: 'service unavailable',
    };
  }

  try {
    await ampService.initialize();
    const healthy = await ampService.isHealthy();
    if (healthy) {
      // Try to get instance count
      try {
        const instances = await ampService.getInstances?.();
        if (instances && instances.length > 0) {
          return {
            name: 'AMP',
            status: 'success',
            message: `connected (${instances.length} instances)`,
          };
        }
      } catch {}
      return {
        name: 'AMP',
        status: 'success',
        message: 'connected',
      };
    }
    return {
      name: 'AMP',
      status: 'failed',
      error: 'authentication failed',
    };
  } catch (error) {
    return {
      name: 'AMP',
      status: 'failed',
      error: error instanceof Error ? error.message : 'connection failed',
    };
  }
}

/**
 * Main startup initialization function
 */
export async function initializeWithDisplay(): Promise<void> {
  // Load services first (lazy loading to avoid db.ts throw at import time)
  await loadServices();

  // ==================== INFRASTRUCTURE ====================
  // Test database
  const dbStatus = await testDatabaseConnection();
  display.addService('Infrastructure', dbStatus);

  // Session store uses the same database
  if (dbStatus.status === 'success') {
    display.addService('Infrastructure', {
      name: 'Session Store',
      status: 'success',
      message: 'PostgreSQL pool ready',
    });
  } else {
    display.addService('Infrastructure', {
      name: 'Session Store',
      status: 'failed',
      error: 'database unavailable',
    });
  }

  // ==================== AUTHENTICATION ====================
  display.addService('Authentication', checkFirebaseAdmin());
  display.addService('Authentication', checkGoogleOAuth());

  // ==================== MEDIA SERVICES ====================
  display.addService('Media Services', checkPlex());
  display.addService('Media Services', await checkTautulli());
  display.addService('Media Services', checkTMDB());

  // ==================== PAYMENT & EMAIL ====================
  display.addService('Payment & Email', checkStripe());
  display.addService('Payment & Email', checkEmail());

  // ==================== LIVE TV & IPTV ====================
  display.addService('Live TV & IPTV', await checkHDHomeRun());
  display.addService('Live TV & IPTV', await checkXtreamCodes());

  // EPG Service - starts async
  display.addService('Live TV & IPTV', {
    name: 'EPG Service',
    status: 'pending',
    message: 'building cache...',
  });

  // ==================== GAME SERVERS ====================
  display.addService('Game Servers', await checkAMP());

  // ==================== BACKGROUND TASKS ====================
  display.addBackgroundTask('Stream Tracker', 'cleanup every 30s');
  display.addBackgroundTask('Provider Health', 'monitoring every 5m');
  display.addBackgroundTask('Service Checker', 'checking every 15s');
  display.addBackgroundTask('EPG Cache', 'refresh every 6h');

  // Register and initialize remaining services (only if services loaded successfully)
  if (serviceRegistry) {
    if (serviceCheckerService) serviceRegistry.register('service-checker', serviceCheckerService);
    if (emailService) serviceRegistry.register('email', emailService);
    if (epubService) serviceRegistry.register('epub', epubService);
    if (xtreamCodesService) serviceRegistry.register('xtream-codes', xtreamCodesService);

    // Initialize remaining services silently (they've been partially checked already)
    const servicesMap = (serviceRegistry as any).services;
    if (servicesMap) {
      const entries = Array.from(servicesMap.entries()) as [string, any][];
      for (const [name, service] of entries) {
        try {
          await service.initialize();
        } catch {}
      }
    }
  }

  // Start background services (if available)
  if (streamTrackerService) {
    streamTrackerService.startCleanupInterval();
  }
  if (providerHealthService) {
    providerHealthService.startHealthChecks();
  }

  // Initialize EPG service asynchronously
  if (getSharedEPGService) {
    getSharedEPGService().then(() => {
      // EPG initialized successfully
    }).catch(() => {
      // EPG failed
    });
  }
}

/**
 * Add server status and render the display
 */
export function finalizeStartup(port: number, routeCount?: number): void {
  display.addServerInfo({
    name: 'Express',
    status: 'success',
    message: 'ready',
  });

  if (routeCount) {
    display.addServerInfo({
      name: 'Routes',
      status: 'success',
      message: `${routeCount} endpoints registered`,
    });
  } else {
    display.addServerInfo({
      name: 'Routes',
      status: 'success',
      message: 'registered',
    });
  }

  display.addServerInfo({
    name: 'Static Assets',
    status: 'success',
    message: process.env.NODE_ENV === 'production' ? 'serving from /dist' : 'Vite dev server',
  });

  display.addServerInfo({
    name: 'Listening',
    status: 'success',
    message: `http://localhost:${port}`,
  });

  // Render the display
  display.render();
}

/**
 * Get the startup display instance for additional modifications
 */
export function getStartupDisplay(): StartupDisplay {
  return display;
}
