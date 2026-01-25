import { buildApiUrl, isNativePlatform } from './capacitor';
import { loggers } from './logger';

/**
 * Stream Decision Tree
 *
 * Determines the optimal playback mode for a stream based on:
 * - Codec compatibility (via server-side ffprobe)
 * - Platform capabilities
 * - CORS restrictions
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
