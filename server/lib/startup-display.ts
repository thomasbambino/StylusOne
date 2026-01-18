import type { ServiceInfo, ServiceCategory, ServiceStatus } from '../../shared/lib/logger/types';
import { COLORS, STATUS_SYMBOLS, BOX } from '../../shared/lib/logger/constants';

const BOX_WIDTH = 70;

interface BackgroundTask {
  name: string;
  description: string;
}

interface CategoryServices {
  category: ServiceCategory;
  services: ServiceInfo[];
}

/**
 * StartupDisplay - Renders a pretty box display of all services starting up.
 *
 * Usage:
 *   const display = new StartupDisplay();
 *   display.addService('Infrastructure', { name: 'Database', status: 'success', message: 'connected (12ms)' });
 *   display.addBackgroundTask('Stream Tracker', 'cleanup every 30s');
 *   display.render();
 */
// App version - increment with each deployment
const APP_VERSION = '1.5.11';

export class StartupDisplay {
  private categories: Map<ServiceCategory, ServiceInfo[]> = new Map();
  private backgroundTasks: BackgroundTask[] = [];
  private serverInfo: ServiceInfo[] = [];
  private version: string = APP_VERSION;
  private appName: string;

  constructor(version?: string) {
    if (version) {
      this.version = version;
    }
    // Read app name from environment, default to "Stylus One"
    this.appName = process.env.APP_NAME || 'Stylus One';
  }

  /**
   * Add a service to a category
   */
  addService(category: ServiceCategory, service: ServiceInfo): void {
    if (!this.categories.has(category)) {
      this.categories.set(category, []);
    }
    this.categories.get(category)!.push(service);
  }

  /**
   * Add a background task (no status, just bullet point)
   */
  addBackgroundTask(name: string, description: string): void {
    this.backgroundTasks.push({ name, description });
  }

  /**
   * Add server-related info (Express, Routes, Listening)
   */
  addServerInfo(service: ServiceInfo): void {
    this.serverInfo.push(service);
  }

  /**
   * Get status symbol with color
   */
  private getStatusSymbol(status: ServiceStatus): string {
    switch (status) {
      case 'success':
        return `${COLORS.green}${STATUS_SYMBOLS.success}${COLORS.reset}`;
      case 'failed':
        return `${COLORS.red}${STATUS_SYMBOLS.failed}${COLORS.reset}`;
      case 'pending':
        return `${COLORS.yellow}${STATUS_SYMBOLS.pending}${COLORS.reset}`;
      case 'skipped':
        return `${COLORS.gray}${STATUS_SYMBOLS.skipped}${COLORS.reset}`;
      default:
        return STATUS_SYMBOLS.skipped;
    }
  }

  /**
   * Pad a line to fit in the box
   */
  private padLine(content: string, leftPad: number = 2): string {
    // Remove ANSI codes to calculate actual visible length
    const visibleLength = content.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = BOX_WIDTH - visibleLength - leftPad - 1; // -1 for right border
    return `${BOX.vertical}${' '.repeat(leftPad)}${content}${' '.repeat(Math.max(0, padding))}${BOX.vertical}`;
  }

  /**
   * Create a horizontal divider
   */
  private divider(): string {
    return `${BOX.leftT}${BOX.horizontal.repeat(BOX_WIDTH - 2)}${BOX.rightT}`;
  }

  /**
   * Create top border
   */
  private topBorder(): string {
    return `${BOX.topLeft}${BOX.horizontal.repeat(BOX_WIDTH - 2)}${BOX.topRight}`;
  }

  /**
   * Create bottom border
   */
  private bottomBorder(): string {
    return `${BOX.bottomLeft}${BOX.horizontal.repeat(BOX_WIDTH - 2)}${BOX.bottomRight}`;
  }

  /**
   * Center text within the box
   */
  private centerText(text: string): string {
    const visibleLength = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    const totalPadding = BOX_WIDTH - visibleLength - 2;
    const leftPad = Math.floor(totalPadding / 2);
    const rightPad = totalPadding - leftPad;
    return `${BOX.vertical}${' '.repeat(leftPad)}${text}${' '.repeat(rightPad)}${BOX.vertical}`;
  }

  /**
   * Format a service line
   */
  private formatServiceLine(service: ServiceInfo): string {
    const symbol = this.getStatusSymbol(service.status);
    const name = service.name.padEnd(18);
    const message = service.message || '';

    // Color the message based on status
    let coloredMessage = message;
    if (service.status === 'failed' && service.error) {
      coloredMessage = `${COLORS.red}${service.error}${COLORS.reset}`;
    } else if (service.status === 'pending') {
      coloredMessage = `${COLORS.yellow}${message}${COLORS.reset}`;
    } else if (service.status === 'skipped') {
      coloredMessage = `${COLORS.gray}${message}${COLORS.reset}`;
    }

    return `${symbol} ${name} ${coloredMessage}`;
  }

  /**
   * Format a background task line
   */
  private formatTaskLine(task: BackgroundTask): string {
    const bullet = `${COLORS.cyan}${STATUS_SYMBOLS.bullet}${COLORS.reset}`;
    const name = task.name.padEnd(18);
    return `${bullet} ${name} ${COLORS.gray}${task.description}${COLORS.reset}`;
  }

  /**
   * Render the complete startup display
   */
  render(): void {
    const lines: string[] = [];

    // Top border
    lines.push(this.topBorder());

    // Title
    const title = `${COLORS.bright}${this.appName} Dashboard v${this.version}${COLORS.reset}`;
    lines.push(this.centerText(title));

    // Define category order
    const categoryOrder: ServiceCategory[] = [
      'Infrastructure',
      'Authentication',
      'Media Services',
      'Payment & Email',
      'Live TV & IPTV',
      'Game Servers',
    ];

    // Render each category
    for (const category of categoryOrder) {
      const services = this.categories.get(category);
      if (!services || services.length === 0) continue;

      lines.push(this.divider());
      lines.push(this.padLine(`${COLORS.bright}${category.toUpperCase()}${COLORS.reset}`));

      for (const service of services) {
        lines.push(this.padLine(this.formatServiceLine(service)));
      }
    }

    // Background Tasks
    if (this.backgroundTasks.length > 0) {
      lines.push(this.divider());
      lines.push(this.padLine(`${COLORS.bright}BACKGROUND TASKS${COLORS.reset}`));
      for (const task of this.backgroundTasks) {
        lines.push(this.padLine(this.formatTaskLine(task)));
      }
    }

    // Server info
    if (this.serverInfo.length > 0) {
      lines.push(this.divider());
      lines.push(this.padLine(`${COLORS.bright}SERVER${COLORS.reset}`));
      for (const service of this.serverInfo) {
        lines.push(this.padLine(this.formatServiceLine(service)));
      }
    }

    // Bottom border
    lines.push(this.bottomBorder());

    // Print to console
    console.log('\n' + lines.join('\n') + '\n');
  }

  /**
   * Check if any services failed
   */
  hasFailures(): boolean {
    for (const services of Array.from(this.categories.values())) {
      if (services.some(s => s.status === 'failed')) {
        return true;
      }
    }
    return this.serverInfo.some(s => s.status === 'failed');
  }

  /**
   * Get count of successful services
   */
  getSuccessCount(): number {
    let count = 0;
    for (const services of Array.from(this.categories.values())) {
      count += services.filter(s => s.status === 'success').length;
    }
    count += this.serverInfo.filter(s => s.status === 'success').length;
    return count;
  }

  /**
   * Get count of failed services
   */
  getFailureCount(): number {
    let count = 0;
    for (const services of Array.from(this.categories.values())) {
      count += services.filter(s => s.status === 'failed').length;
    }
    count += this.serverInfo.filter(s => s.status === 'failed').length;
    return count;
  }
}

/**
 * Helper to measure async operation duration
 */
export async function measureDuration<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
