import { spawn } from 'child_process';
import { loggers } from '../lib/logger';

/**
 * Stream Probe Service
 *
 * Uses ffprobe to detect stream codecs and determine browser compatibility.
 * Includes in-memory caching with 5-minute TTL.
 */

// Browser-compatible codecs
const BROWSER_VIDEO_CODECS = ['h264', 'avc', 'avc1', 'vp8', 'vp9'];
const BROWSER_AUDIO_CODECS = ['aac', 'mp3', 'opus', 'vorbis', 'mp4a'];
const BROWSER_CONTAINERS = ['mpegts', 'mp4', 'webm', 'mov'];

// Containers that need remux even if codecs are compatible
const REMUX_REQUIRED_CONTAINERS = ['matroska', 'mkv', 'avi', 'wmv'];

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

interface CacheEntry {
  result: ProbeResult;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const probeCache = new Map<string, CacheEntry>();

/**
 * Generate a cache key from URL (normalize to avoid duplicates)
 */
function getCacheKey(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove volatile query params that don't affect stream content
    parsed.searchParams.delete('token');
    parsed.searchParams.delete('t');
    parsed.searchParams.delete('_');
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Check if cached result is still valid
 */
function getCachedResult(url: string): ProbeResult | null {
  const key = getCacheKey(url);
  const cached = probeCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    loggers.stream.debug('Probe cache hit', { url: key.substring(0, 50) });
    return cached.result;
  }

  if (cached) {
    probeCache.delete(key);
  }

  return null;
}

/**
 * Store result in cache
 */
function cacheResult(url: string, result: ProbeResult): void {
  const key = getCacheKey(url);
  probeCache.set(key, {
    result,
    timestamp: Date.now()
  });

  // Clean up old entries periodically
  if (probeCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of probeCache.entries()) {
      if (now - v.timestamp > CACHE_TTL_MS) {
        probeCache.delete(k);
      }
    }
  }
}

/**
 * Check if video codec is browser-compatible
 */
function isVideoCompatible(codec: string | null): boolean {
  if (!codec) return true; // No video is fine
  const lowerCodec = codec.toLowerCase();
  return BROWSER_VIDEO_CODECS.some(c => lowerCodec.includes(c));
}

/**
 * Check if audio codec is browser-compatible
 */
function isAudioCompatible(codec: string | null): boolean {
  if (!codec) return true; // No audio is fine
  const lowerCodec = codec.toLowerCase();
  return BROWSER_AUDIO_CODECS.some(c => lowerCodec.includes(c));
}

/**
 * Check if container needs remux
 */
function containerNeedsRemux(container: string | null): boolean {
  if (!container) return false;
  const lowerContainer = container.toLowerCase();
  return REMUX_REQUIRED_CONTAINERS.some(c => lowerContainer.includes(c));
}

/**
 * Run ffprobe on a stream URL
 */
async function runFfprobe(url: string, timeoutMs: number = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-probesize', '2000000', // 2MB - faster probing
      '-analyzeduration', '3000000', // 3 seconds
      url
    ];

    const proc = spawn('ffprobe', args, {
      timeout: timeoutMs
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('ffprobe timeout'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && stdout) {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error('Failed to parse ffprobe output'));
        }
      } else {
        reject(new Error(`ffprobe failed with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Probe a stream URL and determine playback compatibility
 */
export async function probeStream(url: string): Promise<ProbeResult> {
  const startTime = Date.now();

  // Check cache first
  const cached = getCachedResult(url);
  if (cached) {
    return { ...cached, probeTimeMs: 0 }; // Cached results are instant
  }

  loggers.stream.debug('Probing stream', { url: url.substring(0, 80) });

  try {
    const probeData = await runFfprobe(url);

    // Extract stream info
    const videoStream = probeData.streams?.find((s: any) => s.codec_type === 'video');
    const audioStream = probeData.streams?.find((s: any) => s.codec_type === 'audio');
    const format = probeData.format;

    const videoCodec = videoStream?.codec_name || null;
    const audioCodec = audioStream?.codec_name || null;
    const container = format?.format_name || null;
    const width = videoStream?.width || null;
    const height = videoStream?.height || null;
    const bitrate = format?.bit_rate ? parseInt(format.bit_rate) : null;
    const duration = format?.duration ? parseFloat(format.duration) : null;
    const isLive = !duration || duration <= 0;

    // Determine compatibility
    const videoOk = isVideoCompatible(videoCodec);
    const audioOk = isAudioCompatible(audioCodec);
    const needsRemux = containerNeedsRemux(container);
    const needsTranscode = !videoOk || !audioOk;
    const compatible = videoOk && audioOk && !needsRemux;

    // Determine recommendation
    let recommendation: ProbeResult['recommendation'];
    let reason: string;

    if (compatible) {
      recommendation = 'direct';
      reason = 'All codecs browser-compatible';
    } else if (needsTranscode) {
      recommendation = 'transcode';
      const issues = [];
      if (!videoOk) issues.push(`video codec ${videoCodec}`);
      if (!audioOk) issues.push(`audio codec ${audioCodec}`);
      reason = `Incompatible: ${issues.join(', ')}`;
    } else if (needsRemux) {
      recommendation = 'remux';
      reason = `Container ${container} needs remux to mpegts`;
    } else {
      recommendation = 'proxy';
      reason = 'Compatible but may have CORS issues';
    }

    const result: ProbeResult = {
      videoCodec,
      audioCodec,
      container,
      width,
      height,
      bitrate,
      duration,
      isLive,
      compatible,
      needsRemux,
      needsTranscode,
      recommendation,
      reason,
      probeTimeMs: Date.now() - startTime
    };

    // Cache the result
    cacheResult(url, result);

    loggers.stream.debug('Probe complete', {
      videoCodec,
      audioCodec,
      recommendation,
      timeMs: result.probeTimeMs
    });

    return result;

  } catch (error) {
    loggers.stream.warn('Probe failed, defaulting to proxy', { error });

    // On probe failure, return a safe default (proxy mode)
    const result: ProbeResult = {
      videoCodec: null,
      audioCodec: null,
      container: null,
      width: null,
      height: null,
      bitrate: null,
      duration: null,
      isLive: true,
      compatible: false,
      needsRemux: false,
      needsTranscode: false,
      recommendation: 'proxy',
      reason: `Probe failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      probeTimeMs: Date.now() - startTime
    };

    // Don't cache failures - might be transient
    return result;
  }
}

/**
 * Clear probe cache (useful for testing or manual refresh)
 */
export function clearProbeCache(): void {
  probeCache.clear();
  loggers.stream.debug('Probe cache cleared');
}

/**
 * Get probe cache stats
 */
export function getProbeCacheStats(): { size: number; keys: string[] } {
  return {
    size: probeCache.size,
    keys: Array.from(probeCache.keys()).map(k => k.substring(0, 50) + '...')
  };
}
