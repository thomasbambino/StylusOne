import type { Logger, LogModule, LogLevel } from '@shared/lib/logger/types';
import { LOG_LEVELS } from '@shared/lib/logger/types';

/**
 * Get the minimum log level based on environment.
 * Production: info and above
 * Development: debug and above
 */
function getMinLogLevel(): LogLevel {
  const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
  return isDev ? 'debug' : 'info';
}

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
 * Browser-compatible logger implementation.
 * Provides the same interface as the server Pino logger.
 */
class BrowserLogger implements Logger {
  private module: LogModule;
  private minLevel: number;

  constructor(module: LogModule) {
    this.module = module;
    this.minLevel = LOG_LEVELS[getMinLogLevel()];
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.minLevel;
  }

  private formatMessage(level: LogLevel): string {
    const time = formatTimestamp();
    const levelUpper = level.toUpperCase().padEnd(5);
    return `${time} [${levelUpper}] [${this.module}]`;
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
    // For browser, child just returns a new logger with same module
    // (We don't support nested bindings in the simple browser impl)
    return new BrowserLogger(this.module);
  }
}

/**
 * Create a logger for a specific module.
 */
export function createLogger(module: LogModule): Logger {
  return new BrowserLogger(module);
}

/**
 * Pre-created loggers for common client modules.
 * Import and use: `import { loggers } from '@/lib/logger'; loggers.tv.info('message');`
 */
export const loggers = {
  // UI Components
  tv: createLogger('TV'),
  airPlay: createLogger('AirPlay'),
  mediaSession: createLogger('MediaSession'),

  // Data & Caching
  epg: createLogger('EPG'),
  cache: createLogger('Cache'),
  imageCache: createLogger('ImageCache'),
  queryClient: createLogger('QueryClient'),
  plexCache: createLogger('PlexCache'),

  // Authentication
  auth: createLogger('Auth'),
  firebase: createLogger('Firebase'),
  oauth: createLogger('OAuth'),

  // API & Network
  api: createLogger('API'),
  stream: createLogger('Stream'),

  // Game Servers
  game: createLogger('Game'),

  // Mobile/Native
  capacitor: createLogger('Capacitor'),
  nativeVideo: createLogger('NativeVideo'),
  nativeStorage: createLogger('NativeStorage'),
  nativeTabBar: createLogger('NativeTabBar'),

  // Features
  reminders: createLogger('Reminders'),
  subscription: createLogger('Subscription'),
  stripe: createLogger('Stripe'),
  books: createLogger('Books'),
  iptv: createLogger('IPTV'),
  serverShare: createLogger('ServerShare'),

  // Admin
  admin: createLogger('Admin'),
} as const;

/**
 * Type for accessing loggers by key
 */
export type Loggers = typeof loggers;
