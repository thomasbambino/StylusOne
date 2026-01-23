import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync, rmSync, readFileSync, statSync } from 'fs';
import { sanitizeFilename, safeJoin, validatePath } from '../utils/path-security';
import { loggers } from '../lib/logger';

export class StreamingService {
  private activeStreams: Map<string, { process: ChildProcess; timestamp: number }> = new Map();
  private streamDir: string;

  constructor() {
    this.streamDir = join(process.cwd(), 'dist', 'public', 'streams');
    this.ensureStreamDirectory();
    this.cleanupOldStreams();
  }

  /**
   * Ensure the streams directory exists
   */
  private ensureStreamDirectory(): void {
    if (!existsSync(this.streamDir)) {
      mkdirSync(this.streamDir, { recursive: true });
    }
  }

  /**
   * Clean up old stream files and processes
   */
  private cleanupOldStreams(): void {
    // Clean up old processes
    this.activeStreams.forEach((stream, key) => {
      if (Date.now() - stream.timestamp > 300000) { // 5 minutes old
        this.stopStream(key);
      }
    });

    // Schedule regular cleanup
    setInterval(() => {
      this.cleanupOldStreams();
    }, 60000); // Clean every minute
  }

  /**
   * Start an HLS stream conversion from HD HomeRun
   */
  async startHLSStream(channel: string, sourceUrl: string): Promise<string> {
    const streamId = `channel_${channel.replace('.', '_')}`;
    const streamPath = join(this.streamDir, streamId);
    const playlistPath = join(streamPath, 'playlist.m3u8');

    // If stream is already running and playlist exists with valid content, reuse it
    if (this.activeStreams.has(streamId) && existsSync(playlistPath)) {
      const existing = this.activeStreams.get(streamId);
      try {
        // Verify the FFmpeg process is still alive
        const processAlive = existing?.process && existing.process.exitCode === null && !existing.process.killed;
        if (!processAlive) {
          loggers.stream.info('FFmpeg process dead, restarting stream', { channel });
          this.stopStream(streamId);
        } else {
          // Verify playlist was recently modified (FFmpeg is actively writing)
          const playlistStat = statSync(playlistPath);
          const playlistAge = Date.now() - playlistStat.mtimeMs;
          if (playlistAge > 30000) {
            // Playlist hasn't been updated in 30s - FFmpeg is likely hung
            loggers.stream.info('Playlist stale, restarting stream', { channel, ageSeconds: Math.round(playlistAge / 1000) });
            this.stopStream(streamId);
          } else {
            const content = readFileSync(playlistPath, 'utf8');
            // Check if playlist has valid segments (non-zero EXTINF)
            if (content.includes('.ts') && content.includes('#EXTINF:') && !content.includes('#EXTINF:0.0')) {
              loggers.stream.debug('Reusing existing HLS stream', { channel });
              existing!.timestamp = Date.now();
              return `/streams/${streamId}/playlist.m3u8`;
            }
          }
        }
      } catch {
        // Playlist not ready or stat failed, continue to start/restart
        if (existing) {
          this.stopStream(streamId);
        }
      }
    }

    // Stop existing stream if running but not valid
    if (this.activeStreams.has(streamId)) {
      loggers.stream.debug('Stopping stale stream', { channel });
      this.stopStream(streamId);
    }

    // Create stream directory
    if (!existsSync(streamPath)) {
      mkdirSync(streamPath, { recursive: true });
    }

    // Start ffmpeg process with better live streaming settings
    const ffmpegArgs = [
      '-i', sourceUrl,
      '-c:v', 'libx264',
      '-preset', 'veryfast',    // Back to veryfast for compatibility
      '-tune', 'zerolatency',
      '-crf', '22',             // Slightly better than 23, not as aggressive as 20
      '-maxrate', '3M',         // Moderate increase from 2M
      '-bufsize', '6M',         // Moderate buffer size
      '-g', '30',               // Back to 30 for compatibility
      '-keyint_min', '30',
      '-c:a', 'aac',
      '-ac', '2',
      '-ab', '160k',            // Moderate audio bitrate increase
      '-f', 'hls',
      '-hls_time', '6',         // Back to 6 seconds for stability
      '-hls_list_size', '10',
      '-hls_flags', 'delete_segments+program_date_time+independent_segments',
      '-hls_start_number_source', 'epoch',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', join(streamPath, 'segment_%d.ts'),
      '-loglevel', 'warning',
      join(streamPath, 'playlist.m3u8')
    ];

    loggers.stream.info('Starting HLS stream', { channel });
    loggers.stream.debug('FFmpeg args', { streamPath, sourceUrl });

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Handle process events
    ffmpegProcess.on('error', (error) => {
      loggers.stream.error('FFmpeg error', { channel, error });
      this.activeStreams.delete(streamId);
    });

    ffmpegProcess.on('exit', (code, signal) => {
      loggers.stream.debug('FFmpeg process exited', { channel, code, signal });
      this.activeStreams.delete(streamId);
    });

    // Log stderr for debugging - filter out expected warnings
    ffmpegProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      // Skip empty messages
      if (!message) return;

      // Expected warnings during normal operation - log at debug level
      const expectedWarnings = [
        'non monotonically increasing dts',
        'discarding packet',
        'Discarding packet',
        'trailer',
        'Application provided invalid',
        'Last message repeated',
        'deprecated pixel format'
      ];
      const isExpected = expectedWarnings.some(w => message.includes(w));

      if (message.includes('error') || message.includes('Error')) {
        // Real errors - but filter out expected "trailer" errors on shutdown
        if (!message.includes('trailer')) {
          loggers.stream.error('FFmpeg stderr', { channel, message });
        } else {
          loggers.stream.debug('FFmpeg trailer cleanup', { channel });
        }
      } else if (message.includes('warning') || message.includes('Warning')) {
        if (isExpected) {
          // Expected warnings during live streaming - debug only
          loggers.stream.debug('FFmpeg expected warning', { channel, message });
        } else {
          loggers.stream.warn('FFmpeg warning', { channel, message });
        }
      }
    });

    // Store the active stream
    this.activeStreams.set(streamId, {
      process: ffmpegProcess,
      timestamp: Date.now()
    });

    // Wait for the playlist to be created before returning
    await this.waitForPlaylist(join(streamPath, 'playlist.m3u8'));

    // Return the HLS playlist URL
    return `/streams/${streamId}/playlist.m3u8`;
  }

  /**
   * Wait for playlist to be created and have segments
   */
  private async waitForPlaylist(playlistPath: string, maxWait: number = 15000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      try {
        if (existsSync(playlistPath)) {
          const content = readFileSync(playlistPath, 'utf8');
          // Check if playlist has at least one segment
          if (content.includes('.ts') && content.includes('#EXTINF:')) {
            loggers.stream.debug('Playlist ready with segments', { playlistPath });
            return;
          }
        }
      } catch (error) {
        // Continue waiting if file isn't ready
      }
      
      // Wait 500ms before checking again
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    loggers.stream.warn('Playlist not ready after timeout', { playlistPath, maxWait });
  }

  /**
   * Stop a specific stream
   */
  stopStream(streamId: string): void {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      stream.process.kill('SIGTERM');
      this.activeStreams.delete(streamId);
      
      // Clean up stream files - sanitize streamId to prevent path traversal
      const sanitizedStreamId = sanitizeFilename(streamId);
      const streamPath = safeJoin(this.streamDir, sanitizedStreamId);
      if (existsSync(streamPath)) {
        try {
          rmSync(streamPath, { recursive: true, force: true });
        } catch (error) {
          loggers.stream.error('Error cleaning up stream directory', { streamPath, error });
        }
      }
    }
  }

  /**
   * Stop all active streams
   */
  stopAllStreams(): void {
    this.activeStreams.forEach((_, streamId) => {
      this.stopStream(streamId);
    });
  }

  /**
   * Get active stream count
   */
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  /**
   * Check if a stream is active
   */
  isStreamActive(streamId: string): boolean {
    return this.activeStreams.has(streamId);
  }
}

// Singleton instance
export const streamingService = new StreamingService();

// Cleanup on process exit
process.on('SIGTERM', () => {
  streamingService.stopAllStreams();
});

process.on('SIGINT', () => {
  streamingService.stopAllStreams();
});