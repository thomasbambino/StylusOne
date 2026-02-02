import { loggers } from '../lib/logger';

/**
 * Viewer Tracker Service
 *
 * Tracks active viewers per channel for intelligent streaming mode selection.
 * Uses heartbeat-based detection with automatic stale viewer cleanup.
 */

export type StreamMode = 'direct' | 'proxy' | 'transcode';

interface ViewerInfo {
  sessionId: string;
  lastHeartbeat: number;
  userId?: number;
  userAgent?: string;
}

interface ChannelState {
  viewers: Map<string, ViewerInfo>;  // sessionId -> ViewerInfo
  currentMode: StreamMode;
  modeLockedUntil: number;  // Hysteresis: don't change mode until this timestamp
  sourceUrl?: string;
}

// Configuration
const HEARTBEAT_TIMEOUT_MS = 60000;  // Remove viewer after 60s without heartbeat
const MODE_HYSTERESIS_MS = 30000;    // Don't change mode for 30s after last change
const CLEANUP_INTERVAL_MS = 30000;   // Run cleanup every 30s

// Mode thresholds
const PROXY_THRESHOLD = 2;     // 2+ viewers -> proxy mode
const TRANSCODE_THRESHOLD = 4; // 4+ viewers -> transcode mode

export class ViewerTracker {
  private channels: Map<string, ChannelState> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupLoop();
  }

  /**
   * Start periodic cleanup of stale viewers
   */
  private startCleanupLoop(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleViewers();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop the cleanup loop (for graceful shutdown)
   */
  stopCleanupLoop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Record a heartbeat from a viewer
   * Returns the current viewer count and recommended mode
   */
  heartbeat(
    channelId: string,
    sessionId: string,
    options?: {
      userId?: number;
      userAgent?: string;
      sourceUrl?: string;
    }
  ): { viewerCount: number; mode: StreamMode; isNewViewer: boolean } {
    const now = Date.now();
    let channel = this.channels.get(channelId);
    let isNewViewer = false;

    // Create channel state if doesn't exist
    if (!channel) {
      channel = {
        viewers: new Map(),
        currentMode: 'direct',
        modeLockedUntil: 0,
        sourceUrl: options?.sourceUrl
      };
      this.channels.set(channelId, channel);
    }

    // Update source URL if provided
    if (options?.sourceUrl) {
      channel.sourceUrl = options.sourceUrl;
    }

    // Check if this is a new viewer
    isNewViewer = !channel.viewers.has(sessionId);

    // Update viewer info
    channel.viewers.set(sessionId, {
      sessionId,
      lastHeartbeat: now,
      userId: options?.userId,
      userAgent: options?.userAgent
    });

    const viewerCount = channel.viewers.size;

    // Calculate recommended mode based on viewer count and channel type
    const recommendedMode = this.calculateMode(viewerCount, channelId);

    // Apply hysteresis - only change mode if not locked
    if (now >= channel.modeLockedUntil && channel.currentMode !== recommendedMode) {
      const oldMode = channel.currentMode;
      channel.currentMode = recommendedMode;
      channel.modeLockedUntil = now + MODE_HYSTERESIS_MS;

      loggers.stream.info('Stream mode changed', {
        channelId,
        oldMode,
        newMode: recommendedMode,
        viewerCount
      });
    }

    if (isNewViewer) {
      loggers.stream.debug('Viewer joined channel', {
        channelId,
        sessionId: sessionId.substring(0, 8) + '...',
        viewerCount,
        mode: channel.currentMode
      });
    }

    return {
      viewerCount,
      mode: channel.currentMode,
      isNewViewer
    };
  }

  /**
   * Remove a viewer from a channel
   */
  removeViewer(channelId: string, sessionId: string): { viewerCount: number; mode: StreamMode } | null {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return null;
    }

    const hadViewer = channel.viewers.has(sessionId);
    channel.viewers.delete(sessionId);

    const viewerCount = channel.viewers.size;

    if (hadViewer) {
      loggers.stream.debug('Viewer left channel', {
        channelId,
        sessionId: sessionId.substring(0, 8) + '...',
        viewerCount
      });
    }

    // If no viewers left, clean up channel
    if (viewerCount === 0) {
      this.channels.delete(channelId);
      loggers.stream.debug('Channel closed - no viewers', { channelId });
      return { viewerCount: 0, mode: 'direct' };
    }

    // Consider mode demotion
    const now = Date.now();
    const recommendedMode = this.calculateMode(viewerCount, channelId);

    if (now >= channel.modeLockedUntil && channel.currentMode !== recommendedMode) {
      const oldMode = channel.currentMode;
      channel.currentMode = recommendedMode;
      channel.modeLockedUntil = now + MODE_HYSTERESIS_MS;

      loggers.stream.info('Stream mode demoted', {
        channelId,
        oldMode,
        newMode: recommendedMode,
        viewerCount
      });
    }

    return {
      viewerCount,
      mode: channel.currentMode
    };
  }

  /**
   * Get the current state of a channel
   */
  getChannelState(channelId: string): {
    viewerCount: number;
    mode: StreamMode;
    viewers: ViewerInfo[];
    sourceUrl?: string;
  } | null {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return null;
    }

    return {
      viewerCount: channel.viewers.size,
      mode: channel.currentMode,
      viewers: Array.from(channel.viewers.values()),
      sourceUrl: channel.sourceUrl
    };
  }

  /**
   * Get viewer count for a channel
   */
  getViewerCount(channelId: string): number {
    const channel = this.channels.get(channelId);
    return channel?.viewers.size ?? 0;
  }

  /**
   * Get current mode for a channel
   */
  getMode(channelId: string): StreamMode {
    const channel = this.channels.get(channelId);
    return channel?.currentMode ?? 'direct';
  }

  /**
   * Calculate the recommended mode based on viewer count
   * M3U and HDHomeRun streams always stay in direct mode (no viewer limits)
   * Only Xtream streams use the mini-CDN mode switching
   */
  private calculateMode(viewerCount: number, channelId: string): StreamMode {
    // M3U streams (m3u_p{providerId}_{n}) and HDHomeRun streams don't have viewer limits
    // Only Xtream streams need mode switching for mini-CDN
    const isM3uStream = channelId.startsWith('m3u_');
    const isHdHomeRunStream = channelId.startsWith('hdhomerun_');

    if (isM3uStream || isHdHomeRunStream) {
      return 'direct';
    }

    if (viewerCount >= TRANSCODE_THRESHOLD) {
      return 'transcode';
    }
    if (viewerCount >= PROXY_THRESHOLD) {
      return 'proxy';
    }
    return 'direct';
  }

  /**
   * Clean up stale viewers (no heartbeat in HEARTBEAT_TIMEOUT_MS)
   */
  private cleanupStaleViewers(): void {
    const now = Date.now();
    const staleThreshold = now - HEARTBEAT_TIMEOUT_MS;
    let totalRemoved = 0;

    for (const [channelId, channel] of this.channels.entries()) {
      const staleViewers: string[] = [];

      for (const [sessionId, viewer] of channel.viewers.entries()) {
        if (viewer.lastHeartbeat < staleThreshold) {
          staleViewers.push(sessionId);
        }
      }

      for (const sessionId of staleViewers) {
        channel.viewers.delete(sessionId);
        totalRemoved++;
        loggers.stream.debug('Removed stale viewer', {
          channelId,
          sessionId: sessionId.substring(0, 8) + '...',
          lastHeartbeat: new Date(channel.viewers.get(sessionId)?.lastHeartbeat ?? 0).toISOString()
        });
      }

      // Clean up empty channels
      if (channel.viewers.size === 0) {
        this.channels.delete(channelId);
        loggers.stream.debug('Channel closed after stale cleanup', { channelId });
      }
    }

    if (totalRemoved > 0) {
      loggers.stream.debug('Stale viewer cleanup complete', {
        removed: totalRemoved,
        activeChannels: this.channels.size
      });
    }
  }

  /**
   * Get global stats
   */
  getStats(): {
    totalChannels: number;
    totalViewers: number;
    channelStats: Array<{ channelId: string; viewerCount: number; mode: StreamMode }>;
  } {
    let totalViewers = 0;
    const channelStats: Array<{ channelId: string; viewerCount: number; mode: StreamMode }> = [];

    for (const [channelId, channel] of this.channels.entries()) {
      const viewerCount = channel.viewers.size;
      totalViewers += viewerCount;
      channelStats.push({
        channelId,
        viewerCount,
        mode: channel.currentMode
      });
    }

    return {
      totalChannels: this.channels.size,
      totalViewers,
      channelStats
    };
  }
}

// Singleton instance
export const viewerTracker = new ViewerTracker();

// Cleanup on process exit
process.on('SIGTERM', () => {
  viewerTracker.stopCleanupLoop();
});

process.on('SIGINT', () => {
  viewerTracker.stopCleanupLoop();
});
