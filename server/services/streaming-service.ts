import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { sanitizeFilename, safeJoin, validatePath } from '../utils/path-security';

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
    
    // Stop existing stream if running
    if (this.activeStreams.has(streamId)) {
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

    console.log(`Starting HLS stream for channel ${channel} with command:`, 'ffmpeg', ffmpegArgs.join(' '));
    console.log(`Stream path: ${streamPath}`);
    console.log(`Source URL: ${sourceUrl}`);

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Handle process events
    ffmpegProcess.on('error', (error) => {
      console.error(`FFmpeg error for channel ${channel}:`, error);
      this.activeStreams.delete(streamId);
    });

    ffmpegProcess.on('exit', (code, signal) => {
      console.log(`FFmpeg process for channel ${channel} exited with code ${code}, signal ${signal}`);
      this.activeStreams.delete(streamId);
    });

    // Log stderr for debugging
    ffmpegProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message.includes('error') || message.includes('Error')) {
        console.error(`FFmpeg stderr for channel ${channel}:`, message);
      } else if (message.includes('warning') || message.includes('Warning')) {
        console.warn(`FFmpeg warning for channel ${channel}:`, message);
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
            console.log(`Playlist ready with segments: ${playlistPath}`);
            return;
          }
        }
      } catch (error) {
        // Continue waiting if file isn't ready
      }
      
      // Wait 500ms before checking again
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.warn(`Playlist not ready after ${maxWait}ms: ${playlistPath}`);
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
          console.error(`Error cleaning up stream directory ${streamPath}:`, error);
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