import type { LogLevel } from './types';

/**
 * Get the minimum log level based on environment.
 * Production: info and above (hides debug/trace)
 * Development: debug and above (shows most logs)
 */
export function getMinLogLevel(): LogLevel {
  const env = typeof process !== 'undefined' ? process.env.NODE_ENV : 'development';
  return env === 'production' ? 'info' : 'debug';
}

/**
 * Check if we're in production environment
 */
export function isProduction(): boolean {
  const env = typeof process !== 'undefined' ? process.env.NODE_ENV : 'development';
  return env === 'production';
}

/**
 * Format timestamp for human-readable logs.
 * Returns time in 24-hour format: "14:30:45"
 */
export function formatTimestamp(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * ANSI color codes for terminal output
 */
export const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Status colors
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',

  // Background colors
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
} as const;

/**
 * Status symbols for startup display
 */
export const STATUS_SYMBOLS = {
  success: '\u2713',  // ✓
  failed: '\u2717',   // ✗
  pending: '\u27F3',  // ⟳
  skipped: '-',
  bullet: '\u2022',   // •
} as const;

/**
 * Box drawing characters for startup display
 */
export const BOX = {
  topLeft: '\u2554',     // ╔
  topRight: '\u2557',    // ╗
  bottomLeft: '\u255A',  // ╚
  bottomRight: '\u255D', // ╝
  horizontal: '\u2550',  // ═
  vertical: '\u2551',    // ║
  leftT: '\u2560',       // ╠
  rightT: '\u2563',      // ╣
} as const;
