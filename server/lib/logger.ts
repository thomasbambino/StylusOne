import type { Logger, LogModule, LogLevel } from '../../shared/lib/logger/types';
import { LOG_LEVELS } from '../../shared/lib/logger/types';
import { getMinLogLevel, isProduction, COLORS } from '../../shared/lib/logger/constants';

const isDev = !isProduction();
const minLevel = LOG_LEVELS[getMinLogLevel()];

/**
 * Format timestamp for human-readable logs.
 * Returns time in 24-hour format: "14:30:45"
 */
function formatTimestamp(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Server-side logger implementation.
 * Uses console methods with structured formatting.
 */
class ServerLogger implements Logger {
  private module: LogModule;

  constructor(module: LogModule) {
    this.module = module;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= minLevel;
  }

  private formatMessage(level: LogLevel): string {
    const time = formatTimestamp();
    const levelUpper = level.toUpperCase().padEnd(5);

    if (isDev) {
      // Colorized output for development
      const levelColors: Record<string, string> = {
        trace: COLORS.gray,
        debug: COLORS.cyan,
        info: COLORS.green,
        warn: COLORS.yellow,
        error: COLORS.red,
        fatal: COLORS.red + COLORS.bright,
      };
      const levelColor = levelColors[level] || COLORS.white;
      return `${COLORS.gray}${time}${COLORS.reset} ${levelColor}[${levelUpper}]${COLORS.reset} ${COLORS.blue}[${this.module}]${COLORS.reset}`;
    } else {
      // Plain output for production (JSON-friendly)
      return `${time} [${levelUpper}] [${this.module}]`;
    }
  }

  trace(msg: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('trace')) {
      if (data) {
        console.debug(this.formatMessage('trace'), msg, data);
      } else {
        console.debug(this.formatMessage('trace'), msg);
      }
    }
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      if (data) {
        console.debug(this.formatMessage('debug'), msg, data);
      } else {
        console.debug(this.formatMessage('debug'), msg);
      }
    }
  }

  info(msg: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      if (data) {
        console.log(this.formatMessage('info'), msg, data);
      } else {
        console.log(this.formatMessage('info'), msg);
      }
    }
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      if (data) {
        console.warn(this.formatMessage('warn'), msg, data);
      } else {
        console.warn(this.formatMessage('warn'), msg);
      }
    }
  }

  error(msg: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      if (data) {
        console.error(this.formatMessage('error'), msg, data);
      } else {
        console.error(this.formatMessage('error'), msg);
      }
    }
  }

  fatal(msg: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('fatal')) {
      if (data) {
        console.error(this.formatMessage('fatal'), msg, data);
      } else {
        console.error(this.formatMessage('fatal'), msg);
      }
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ServerLogger(this.module);
  }
}

/**
 * Create a child logger for a specific module.
 * The module name will be included in all log messages.
 */
export function createLogger(module: LogModule): Logger {
  return new ServerLogger(module);
}

/**
 * Default logger for general server use
 */
export const logger = createLogger('Express');

/**
 * Pre-created loggers for common server modules.
 * Import and use: `import { loggers } from './lib/logger'; loggers.epg.info('message');`
 */
export const loggers = {
  // Infrastructure
  database: createLogger('Database'),
  session: createLogger('Session'),
  express: createLogger('Express'),
  vite: createLogger('Vite'),
  static: createLogger('Static'),
  api: createLogger('API'),

  // Authentication
  auth: createLogger('Auth'),
  firebase: createLogger('Firebase'),
  oauth: createLogger('OAuth'),

  // Media Services
  plex: createLogger('Plex'),
  tautulli: createLogger('Tautulli'),
  tmdb: createLogger('TMDB'),

  // Payment & Email
  stripe: createLogger('Stripe'),
  mailgun: createLogger('Mailgun'),
  sendgrid: createLogger('SendGrid'),
  email: createLogger('Email'),

  // Live TV & IPTV
  epg: createLogger('EPG'),
  hdHomeRun: createLogger('HDHomeRun'),
  iptv: createLogger('IPTV'),
  xtreamCodes: createLogger('XtreamCodes'),
  stream: createLogger('Stream'),
  providerHealth: createLogger('ProviderHealth'),

  // Game Servers
  amp: createLogger('AMP'),
  game: createLogger('Game'),

  // Admin & Routes
  admin: createLogger('Admin'),
  adminIptv: createLogger('AdminIPTV'),
  analytics: createLogger('Analytics'),
  webhook: createLogger('Webhook'),
  book: createLogger('Book'),
  referral: createLogger('Referral'),
  subscription: createLogger('Subscription'),
  service: createLogger('Service'),
  storage: createLogger('Storage'),
} as const;

/**
 * Type for accessing loggers by key
 */
export type Loggers = typeof loggers;
