import { buildApiUrl, isNativePlatform } from './capacitor';
import { CapacitorHttp } from '@capacitor/core';
import { loggers } from './logger';

/**
 * Stream Decision Tree
 *
 * Determines the optimal playback mode for a stream based on:
 * - Codec compatibility (via server-side ffprobe)
 * - Platform capabilities
 * - CORS restrictions
 * - Viewer count (for mini-CDN optimization)
 */

export interface ProbeResult {
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  duration: number | null;
  isLive: boolean;
  compatible: boolean;
  needsRemux: boolean;
  needsTranscode: boolean;
  recommendation: 'direct' | 'proxy' | 'remux' | 'transcode';
  reason: string;
  probeTimeMs: number;
}

export type StreamMode = 'direct' | 'proxy' | 'transcode';

export interface StreamDecision {
  mode: StreamMode;
  streamUrl: string;
  reason: string;
  probeResult?: ProbeResult;
}

// Client-side probe cache (supplements server-side cache)
const clientProbeCache = new Map<string, { result: ProbeResult; timestamp: number }>();
const CLIENT_CACHE_TTL = 60000; // 1 minute client-side cache

/**
 * Probe a stream URL to determine codec compatibility
 */
async function probeStreamUrl(url: string): Promise<ProbeResult | null> {
  // Check client-side cache first
  const cached = clientProbeCache.get(url);
  if (cached && Date.now() - cached.timestamp < CLIENT_CACHE_TTL) {
    loggers.tv.debug('Stream probe client cache hit');
    return cached.result;
  }

  try {
    const probeUrl = buildApiUrl(`/api/stream/probe?url=${encodeURIComponent(url)}`);
    const response = await fetch(probeUrl, { credentials: 'include' });

    if (!response.ok) {
      loggers.tv.warn('Probe request failed', { status: response.status });
      return null;
    }

    const result: ProbeResult = await response.json();

    // Cache the result client-side
    clientProbeCache.set(url, { result, timestamp: Date.now() });

    return result;
  } catch (error) {
    loggers.tv.warn('Probe request error', { error });
    return null;
  }
}

/**
 * Get the proxy URL for a stream
 */
function getProxyUrl(originalUrl: string, streamId: string): string {
  // Use the IPTV proxy endpoint
  return buildApiUrl(`/api/iptv/stream/${streamId}.m3u8`);
}

/**
 * Get the transcode URL for a stream
 */
function getTranscodeUrl(originalUrl: string, streamId: string): string {
  // The streaming service handles transcoding
  return buildApiUrl(`/streams/channel_${streamId.replace('.', '_')}/playlist.m3u8`);
}

/**
 * Determine the optimal playback mode for a stream
 *
 * Decision tree:
 * 1. Native apps (iOS/Android) - often can play more formats directly
 * 2. Probe the stream to check codec compatibility
 * 3. If compatible - try direct, fall back to proxy if CORS issues
 * 4. If needs remux - use proxy (server handles remux)
 * 5. If needs transcode - use transcode endpoint
 */
export async function decideStreamMode(
  streamUrl: string,
  streamId: string,
  options?: {
    skipProbe?: boolean;
    forcedMode?: StreamMode;
    isIptvStream?: boolean;
  }
): Promise<StreamDecision> {
  const { skipProbe = false, forcedMode, isIptvStream = false } = options || {};

  // If mode is forced, use it directly
  if (forcedMode) {
    loggers.tv.debug('Using forced stream mode', { mode: forcedMode });
    return {
      mode: forcedMode,
      streamUrl: forcedMode === 'direct' ? streamUrl :
                 forcedMode === 'proxy' ? getProxyUrl(streamUrl, streamId) :
                 getTranscodeUrl(streamUrl, streamId),
      reason: 'Forced mode'
    };
  }

  // Native apps have broader codec support and no CORS issues
  if (isNativePlatform()) {
    loggers.tv.debug('Native platform - using direct mode');
    return {
      mode: 'direct',
      streamUrl: isIptvStream ? getProxyUrl(streamUrl, streamId) : streamUrl,
      reason: 'Native platform with broad codec support'
    };
  }

  // IPTV streams always go through proxy for CORS and auth handling
  if (isIptvStream) {
    // Check if we should transcode (for browser M3U streams)
    if (!skipProbe) {
      const probeResult = await probeStreamUrl(streamUrl);

      if (probeResult) {
        loggers.tv.debug('Probe result for IPTV stream', {
          recommendation: probeResult.recommendation,
          videoCodec: probeResult.videoCodec,
          audioCodec: probeResult.audioCodec
        });

        if (probeResult.needsTranscode) {
          return {
            mode: 'transcode',
            streamUrl: getTranscodeUrl(streamUrl, streamId),
            reason: probeResult.reason,
            probeResult
          };
        }
      }
    }

    // Default to proxy for IPTV (handles CORS, auth, and light remux if needed)
    return {
      mode: 'proxy',
      streamUrl: getProxyUrl(streamUrl, streamId),
      reason: 'IPTV stream - using proxy for CORS/auth handling'
    };
  }

  // For non-IPTV streams (e.g., HDHomeRun), probe and decide
  if (!skipProbe) {
    const probeResult = await probeStreamUrl(streamUrl);

    if (probeResult) {
      loggers.tv.debug('Probe result', {
        recommendation: probeResult.recommendation,
        compatible: probeResult.compatible
      });

      switch (probeResult.recommendation) {
        case 'direct':
          return {
            mode: 'direct',
            streamUrl: streamUrl,
            reason: probeResult.reason,
            probeResult
          };

        case 'proxy':
        case 'remux':
          return {
            mode: 'proxy',
            streamUrl: getProxyUrl(streamUrl, streamId),
            reason: probeResult.reason,
            probeResult
          };

        case 'transcode':
          return {
            mode: 'transcode',
            streamUrl: getTranscodeUrl(streamUrl, streamId),
            reason: probeResult.reason,
            probeResult
          };
      }
    }
  }

  // Default: try direct for non-IPTV streams (HDHomeRun is usually compatible)
  loggers.tv.debug('Using default direct mode');
  return {
    mode: 'direct',
    streamUrl: streamUrl,
    reason: 'Default - probe skipped or failed'
  };
}

/**
 * Clear the client-side probe cache
 */
export function clearClientProbeCache(): void {
  clientProbeCache.clear();
}

/**
 * Check if a stream URL looks like it needs special handling
 */
export function streamNeedsProxy(url: string): boolean {
  // External URLs typically need proxy for CORS
  try {
    const parsed = new URL(url);
    const currentOrigin = window.location.origin;

    // Different origin = likely needs proxy
    if (parsed.origin !== currentOrigin) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ============================================================================
// VIEWER TRACKING (Mini-CDN)
// ============================================================================

export interface HeartbeatResponse {
  viewerCount: number;
  mode: StreamMode;
  isNewViewer: boolean;
}

// Generate a unique session ID for this browser tab
let sessionId: string | null = null;
function getSessionId(): string {
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
  return sessionId;
}

// Track active heartbeat intervals
const activeHeartbeats = new Map<string, NodeJS.Timeout>();

/**
 * Send heartbeat to server and get current viewer count/mode
 */
export async function sendHeartbeat(
  channelId: string,
  sourceUrl?: string
): Promise<HeartbeatResponse | null> {
  try {
    const url = buildApiUrl('/api/stream/heartbeat');
    const body = {
      channelId,
      sessionId: getSessionId(),
      sourceUrl
    };

    let result: HeartbeatResponse;

    // Use CapacitorHttp on native for proper cookie handling
    if (isNativePlatform()) {
      const response = await CapacitorHttp.request({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: body,
        responseType: 'json'
      });

      if (response.status !== 200) {
        loggers.tv.warn('Heartbeat failed', { status: response.status });
        return null;
      }

      result = response.data;
    } else {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        loggers.tv.warn('Heartbeat failed', { status: response.status });
        return null;
      }

      result = await response.json();
    }

    loggers.tv.debug('Heartbeat response', {
      channelId,
      viewerCount: result.viewerCount,
      mode: result.mode
    });

    return result;
  } catch (error) {
    loggers.tv.warn('Heartbeat error', { error });
    return null;
  }
}

/**
 * Notify server that viewer is leaving the channel
 */
export async function leaveChannel(channelId: string): Promise<void> {
  // Stop heartbeat
  stopHeartbeat(channelId);

  try {
    const url = buildApiUrl('/api/stream/leave');
    const body = {
      channelId,
      sessionId: getSessionId()
    };

    // Use CapacitorHttp on native for proper cookie handling
    if (isNativePlatform()) {
      await CapacitorHttp.request({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: body,
        responseType: 'json'
      });
    } else {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
    }
    loggers.tv.debug('Left channel', { channelId });
  } catch (error) {
    loggers.tv.warn('Leave channel error', { error });
  }
}

/**
 * Start periodic heartbeat for a channel
 */
export function startHeartbeat(
  channelId: string,
  sourceUrl?: string,
  onModeChange?: (mode: StreamMode, viewerCount: number) => void
): void {
  // Stop existing heartbeat for this channel
  stopHeartbeat(channelId);

  // Send initial heartbeat
  sendHeartbeat(channelId, sourceUrl).then(result => {
    if (result && onModeChange) {
      onModeChange(result.mode, result.viewerCount);
    }
  });

  // Start periodic heartbeat every 30 seconds
  const interval = setInterval(async () => {
    const result = await sendHeartbeat(channelId, sourceUrl);
    if (result && onModeChange) {
      onModeChange(result.mode, result.viewerCount);
    }
  }, 30000);

  activeHeartbeats.set(channelId, interval);
  loggers.tv.debug('Started heartbeat', { channelId });
}

/**
 * Stop heartbeat for a channel
 */
export function stopHeartbeat(channelId: string): void {
  const interval = activeHeartbeats.get(channelId);
  if (interval) {
    clearInterval(interval);
    activeHeartbeats.delete(channelId);
    loggers.tv.debug('Stopped heartbeat', { channelId });
  }
}

/**
 * Stop all active heartbeats (e.g., on page unload)
 */
export function stopAllHeartbeats(): void {
  for (const [channelId, interval] of activeHeartbeats.entries()) {
    clearInterval(interval);
    loggers.tv.debug('Stopped heartbeat', { channelId });
  }
  activeHeartbeats.clear();
}

/**
 * Get channel status (viewer count, mode)
 */
export async function getChannelStatus(channelId: string): Promise<{
  viewerCount: number;
  mode: StreamMode;
} | null> {
  try {
    const url = buildApiUrl(`/api/stream/${encodeURIComponent(channelId)}/status`);
    const response = await fetch(url, { credentials: 'include' });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    loggers.tv.warn('Get channel status error', { error });
    return null;
  }
}

// Clean up on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    stopAllHeartbeats();
  });
}
