import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { loggers } from '../lib/logger';
import { APP_VERSION } from '../lib/startup-display';

const router = Router();

// Lazy imports to avoid initialization issues
let tautulliService: any = null;
let ampService: any = null;
let hdHomeRunService: any = null;

async function loadServices() {
  try {
    const tautulliModule = await import('../services/tautulli-service');
    tautulliService = tautulliModule.tautulliService;
  } catch {}

  try {
    const ampModule = await import('../services/amp-service');
    ampService = ampModule.ampService;
  } catch {}

  try {
    const hdHomeRunModule = await import('../services/hdhomerun-service');
    hdHomeRunService = (hdHomeRunModule as any).hdHomeRunService || (hdHomeRunModule as any).HDHomeRunService;
  } catch {}
}

// Load services on module init
loadServices();

// Cache system status for 30 seconds
let cachedStatus: any = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30000;

/**
 * Service status types
 */
type ServiceStatus = 'success' | 'failed' | 'pending' | 'skipped';

interface ServiceInfo {
  name: string;
  status: ServiceStatus;
  message?: string;
  error?: string;
}

interface CategoryInfo {
  name: string;
  services: ServiceInfo[];
}

interface BackgroundTask {
  name: string;
  description: string;
}

interface SystemStatusResponse {
  categories: CategoryInfo[];
  backgroundTasks: BackgroundTask[];
  version: string;
  appName: string;
  lastUpdated: string;
}

/**
 * Middleware to check if user is admin or superadmin
 */
function requireAdmin(req: any, res: any, next: any) {
  if (!req.user || (req.user!.role !== 'admin' && req.user!.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Get app version from startup-display
 */
function getAppVersion(): string {
  return APP_VERSION;
}

/**
 * Get app name from environment
 */
function getAppName(): string {
  return process.env.APP_NAME || 'Stylus One';
}

// ==================== Service Check Functions ====================

async function checkDatabase(): Promise<ServiceInfo> {
  if (!process.env.DATABASE_URL) {
    return { name: 'Database', status: 'failed', error: 'DATABASE_URL not set' };
  }

  try {
    const { db } = await import('../db');
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const duration = Date.now() - start;
    return { name: 'Database', status: 'success', message: `connected (${duration}ms)` };
  } catch (error) {
    return { name: 'Database', status: 'failed', error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

function checkSessionStore(dbStatus: ServiceInfo): ServiceInfo {
  if (dbStatus.status === 'success') {
    return { name: 'Session Store', status: 'success', message: 'PostgreSQL pool ready' };
  }
  return { name: 'Session Store', status: 'failed', error: 'database unavailable' };
}

function checkFirebaseAdmin(): ServiceInfo {
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (projectId) {
    return { name: 'Firebase Admin', status: 'success', message: `project: ${projectId}` };
  }
  return { name: 'Firebase Admin', status: 'skipped', message: 'not configured' };
}

function checkGoogleOAuth(): ServiceInfo {
  const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (clientId && clientSecret) {
    return { name: 'Google OAuth', status: 'success', message: 'configured' };
  }
  return { name: 'Google OAuth', status: 'skipped', message: 'not configured' };
}

function checkPlex(): ServiceInfo {
  const token = process.env.PLEX_TOKEN;
  if (token) {
    return { name: 'Plex', status: 'success', message: 'token configured' };
  }
  return { name: 'Plex', status: 'skipped', message: 'not configured (PLEX_TOKEN)' };
}

async function checkTautulli(): Promise<ServiceInfo> {
  const url = process.env.TAUTULLI_URL;
  const apiKey = process.env.TAUTULLI_API_KEY;

  if (!url || !apiKey) {
    return { name: 'Tautulli', status: 'skipped', message: 'not configured' };
  }

  if (tautulliService) {
    try {
      await tautulliService.initialize();
      const healthy = await tautulliService.isHealthy();
      if (healthy) {
        const serverInfo = await tautulliService.getServerInfo?.();
        const version = serverInfo?.tautulli_version ? `v${serverInfo.tautulli_version}` : 'connected';
        return { name: 'Tautulli', status: 'success', message: version };
      }
    } catch {}
  }

  return { name: 'Tautulli', status: 'failed', error: 'connection failed' };
}

function checkTMDB(): ServiceInfo {
  const apiKey = process.env.TMDB_API_KEY;
  if (apiKey) {
    return { name: 'TMDB', status: 'success', message: 'API key configured' };
  }
  return { name: 'TMDB', status: 'skipped', message: 'not configured' };
}

function checkStripe(): ServiceInfo {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (secretKey) {
    const isLive = secretKey.startsWith('sk_live');
    return { name: 'Stripe', status: 'success', message: isLive ? 'live mode' : 'test mode' };
  }
  return { name: 'Stripe', status: 'skipped', message: 'not configured' };
}

function checkEmail(): ServiceInfo {
  const mailgunDomain = process.env.MAILGUN_DOMAIN;
  const mailgunKey = process.env.MAILGUN_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;

  if (mailgunDomain && mailgunKey) {
    return { name: 'Mailgun', status: 'success', message: `domain: ${mailgunDomain}` };
  }

  if (sendgridKey) {
    return { name: 'SendGrid', status: 'success', message: 'configured' };
  }

  return { name: 'Email', status: 'skipped', message: 'not configured' };
}

async function checkHDHomeRun(): Promise<ServiceInfo> {
  const url = process.env.HDHOMERUN_URL;

  if (!url) {
    return { name: 'HD HomeRun', status: 'skipped', message: 'not configured' };
  }

  if (hdHomeRunService) {
    try {
      const healthy = await hdHomeRunService.isHealthy();
      if (healthy) {
        const info = await hdHomeRunService.getDeviceInfo?.();
        const tuners = info?.TunerCount || 'unknown';
        return { name: 'HD HomeRun', status: 'success', message: `${tuners} tuners` };
      }
    } catch {}
  }

  // Try a simple fetch to discover.json
  try {
    const response = await fetch(`${url}/discover.json`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const data = await response.json() as any;
      return { name: 'HD HomeRun', status: 'success', message: `${data.ModelNumber || 'connected'} (${data.TunerCount || '?'} tuners)` };
    }
  } catch {}

  return { name: 'HD HomeRun', status: 'failed', error: 'connection failed' };
}

async function checkXtreamCodes(): Promise<ServiceInfo> {
  try {
    const { db } = await import('../db');
    const { iptvProviders } = await import('@shared/schema');
    const providers = await db.select().from(iptvProviders);
    if (providers.length > 0) {
      return { name: 'Xtream Codes', status: 'success', message: `${providers.length} provider${providers.length > 1 ? 's' : ''} configured` };
    }
    return { name: 'Xtream Codes', status: 'skipped', message: 'no providers' };
  } catch {
    return { name: 'Xtream Codes', status: 'skipped', message: 'not available' };
  }
}

async function checkEPG(): Promise<ServiceInfo> {
  try {
    const { getSharedEPGService } = await import('../services/epg-singleton');
    const epgService = await getSharedEPGService();
    if (epgService) {
      // EPG service is available
      return { name: 'EPG Service', status: 'success', message: 'cache ready' };
    }
    return { name: 'EPG Service', status: 'pending', message: 'building cache...' };
  } catch {
    return { name: 'EPG Service', status: 'skipped', message: 'not available' };
  }
}

async function checkAMP(): Promise<ServiceInfo> {
  const url = process.env.AMP_API_URL;
  const username = process.env.AMP_API_USERNAME;
  const password = process.env.AMP_API_PASSWORD;

  if (!url || !username || !password) {
    return { name: 'AMP', status: 'skipped', message: 'not configured' };
  }

  if (!ampService) {
    return { name: 'AMP', status: 'skipped', message: 'service unavailable' };
  }

  try {
    await ampService.initialize();
    const healthy = await ampService.isHealthy();
    if (healthy) {
      try {
        const instances = await ampService.getInstances?.();
        if (instances && instances.length > 0) {
          return { name: 'AMP', status: 'success', message: `connected (${instances.length} instances)` };
        }
      } catch {}
      return { name: 'AMP', status: 'success', message: 'connected' };
    }
    return { name: 'AMP', status: 'failed', error: 'authentication failed' };
  } catch (error) {
    return { name: 'AMP', status: 'failed', error: error instanceof Error ? error.message : 'connection failed' };
  }
}

// ==================== Main Status Endpoint ====================

/**
 * GET /api/admin/system/status
 * Get comprehensive system status for all services
 */
router.get('/status', requireAdmin, async (req, res) => {
  try {
    // Check cache
    const now = Date.now();
    if (cachedStatus && now - cacheTimestamp < CACHE_DURATION) {
      return res.json(cachedStatus);
    }

    // Infrastructure
    const dbStatus = await checkDatabase();
    const sessionStoreStatus = checkSessionStore(dbStatus);

    // Authentication
    const firebaseStatus = checkFirebaseAdmin();
    const googleOAuthStatus = checkGoogleOAuth();

    // Media Services
    const plexStatus = checkPlex();
    const tautulliStatus = await checkTautulli();
    const tmdbStatus = checkTMDB();

    // Payment & Email
    const stripeStatus = checkStripe();
    const emailStatus = checkEmail();

    // Live TV & IPTV
    const hdHomeRunStatus = await checkHDHomeRun();
    const xtreamCodesStatus = await checkXtreamCodes();
    const epgStatus = await checkEPG();

    // Game Servers
    const ampStatus = await checkAMP();

    const response: SystemStatusResponse = {
      categories: [
        {
          name: 'Infrastructure',
          services: [dbStatus, sessionStoreStatus],
        },
        {
          name: 'Authentication',
          services: [firebaseStatus, googleOAuthStatus],
        },
        {
          name: 'Media Services',
          services: [plexStatus, tautulliStatus, tmdbStatus],
        },
        {
          name: 'Payment & Email',
          services: [stripeStatus, emailStatus],
        },
        {
          name: 'Live TV & IPTV',
          services: [hdHomeRunStatus, xtreamCodesStatus, epgStatus],
        },
        {
          name: 'Game Servers',
          services: [ampStatus],
        },
      ],
      backgroundTasks: [
        { name: 'Stream Tracker', description: 'cleanup every 30s' },
        { name: 'Provider Health', description: 'monitoring every 5m' },
        { name: 'Service Checker', description: 'checking every 15s' },
        { name: 'EPG Cache', description: 'refresh every 6h' },
      ],
      version: getAppVersion(),
      appName: getAppName(),
      lastUpdated: new Date().toISOString(),
    };

    // Cache the response
    cachedStatus = response;
    cacheTimestamp = now;

    res.json(response);
  } catch (error) {
    loggers.admin.error('Error fetching system status', { error });
    res.status(500).json({ error: 'Failed to fetch system status' });
  }
});

/**
 * POST /api/admin/system/refresh
 * Force refresh system status (clears cache)
 */
router.post('/refresh', requireAdmin, async (req, res) => {
  try {
    // Clear cache
    cachedStatus = null;
    cacheTimestamp = 0;

    res.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    loggers.admin.error('Error refreshing system status', { error });
    res.status(500).json({ error: 'Failed to refresh system status' });
  }
});

export default router;
