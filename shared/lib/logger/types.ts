/**
 * Log levels supported by the logging system.
 * Ordered from most verbose (trace) to least verbose (fatal).
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Numeric values for log levels, used for filtering.
 */
export const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Module identifiers for consistent log prefixes.
 * Each module gets its own child logger with automatic prefixing.
 */
export type LogModule =
  // Infrastructure
  | 'Database'
  | 'Session'
  | 'Express'
  | 'Vite'
  | 'Static'
  // Authentication
  | 'Auth'
  | 'Firebase'
  | 'OAuth'
  // Media Services
  | 'Plex'
  | 'Tautulli'
  | 'TMDB'
  // Payment & Email
  | 'Stripe'
  | 'Mailgun'
  | 'SendGrid'
  | 'Email'
  // Live TV & IPTV
  | 'EPG'
  | 'HDHomeRun'
  | 'IPTV'
  | 'XtreamCodes'
  | 'Stream'
  | 'ProviderHealth'
  // Game Servers
  | 'AMP'
  | 'Game'
  // Client-specific
  | 'TV'
  | 'AirPlay'
  | 'QueryClient'
  | 'Cache'
  | 'ImageCache'
  | 'MediaSession'
  // Admin & Routes
  | 'Admin'
  | 'API'
  | 'Webhook'
  | 'Book'
  | 'Referral'
  | 'Subscription'
  | 'Service'
  | 'Storage';

/**
 * Logger interface that both server (Pino) and client (browser) loggers implement.
 */
export interface Logger {
  trace(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  fatal(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

/**
 * Service status for startup display
 */
export type ServiceStatus = 'success' | 'failed' | 'pending' | 'skipped';

/**
 * Service information for startup tracking
 */
export interface ServiceInfo {
  name: string;
  status: ServiceStatus;
  message?: string;
  duration?: number;
  error?: string;
}

/**
 * Service category for grouping in startup display
 */
export type ServiceCategory =
  | 'Infrastructure'
  | 'Authentication'
  | 'Media Services'
  | 'Payment & Email'
  | 'Live TV & IPTV'
  | 'Game Servers'
  | 'Background Tasks'
  | 'Server';
