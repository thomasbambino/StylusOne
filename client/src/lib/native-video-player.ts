import { Capacitor } from '@capacitor/core';
import { CapacitorVideoPlayer } from 'capacitor-video-player';
import { loggers } from './logger';

export interface NativePlayerOptions {
  url: string;
  title?: string;
  subtitle?: string;
  onExit?: (currentTime: number) => void;
  onEnded?: () => void;
  onReady?: () => void;
  onError?: (error: string) => void;
}

class NativeVideoPlayerService {
  private isPlaying = false;
  private currentOptions: NativePlayerOptions | null = null;
  private exitListener: any = null;
  private endedListener: any = null;
  private readyListener: any = null;

  /**
   * Check if native player should be used
   * Only use on iOS native app (not web)
   */
  shouldUseNativePlayer(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  }

  /**
   * Play a video using native AVPlayer
   */
  async play(options: NativePlayerOptions): Promise<boolean> {
    if (!this.shouldUseNativePlayer()) {
      loggers.nativeVideo.debug('Native player not available on this platform');
      return false;
    }

    try {
      // Stop any existing playback
      await this.stop();

      this.currentOptions = options;

      loggers.nativeVideo.info('Starting native video player', { url: options.url });

      // Set up event listeners
      this.setupListeners();

      // Initialize and play the video
      const result = await CapacitorVideoPlayer.initPlayer({
        mode: 'fullscreen',
        url: options.url,
        playerId: 'stylusPlayer',
        showControls: true,
        displayMode: 'landscape',
        pipEnabled: true,
        bkmodeEnabled: true, // Background mode / AirPlay
        exitOnEnd: false,
        loopOnEnd: false,
        title: options.title || 'Live TV',
        smallTitle: options.subtitle || '',
      });

      if (result.result) {
        this.isPlaying = true;
        loggers.nativeVideo.info('Native player started successfully');
        options.onReady?.();
        return true;
      } else {
        loggers.nativeVideo.error('Failed to start native player', { message: result.message });
        options.onError?.(result.message || 'Failed to start player');
        return false;
      }
    } catch (error) {
      loggers.nativeVideo.error('Native player error', { error });
      options.onError?.(String(error));
      return false;
    }
  }

  /**
   * Stop the native player
   */
  async stop(): Promise<void> {
    if (!this.shouldUseNativePlayer()) return;

    try {
      this.removeListeners();
      await CapacitorVideoPlayer.stopAllPlayers();
      this.isPlaying = false;
      this.currentOptions = null;
      loggers.nativeVideo.debug('Native player stopped');
    } catch (error) {
      loggers.nativeVideo.error('Error stopping native player', { error });
    }
  }

  /**
   * Exit the fullscreen player
   */
  async exit(): Promise<void> {
    if (!this.shouldUseNativePlayer()) return;

    try {
      await CapacitorVideoPlayer.exitPlayer();
      this.isPlaying = false;
      loggers.nativeVideo.debug('Native player exited');
    } catch (error) {
      loggers.nativeVideo.error('Error exiting native player', { error });
    }
  }

  /**
   * Pause playback
   */
  async pause(): Promise<void> {
    if (!this.shouldUseNativePlayer() || !this.isPlaying) return;

    try {
      await CapacitorVideoPlayer.pause({ playerId: 'stylusPlayer' });
    } catch (error) {
      loggers.nativeVideo.error('Error pausing', { error });
    }
  }

  /**
   * Resume playback
   */
  async resume(): Promise<void> {
    if (!this.shouldUseNativePlayer() || !this.isPlaying) return;

    try {
      await CapacitorVideoPlayer.play({ playerId: 'stylusPlayer' });
    } catch (error) {
      loggers.nativeVideo.error('Error resuming', { error });
    }
  }

  /**
   * Check if currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  private setupListeners(): void {
    // Listen for player exit (user dismisses fullscreen)
    this.exitListener = CapacitorVideoPlayer.addListener('jeepCapVideoPlayerExit', (info: any) => {
      loggers.nativeVideo.debug('Player exit event', { info });
      this.isPlaying = false;
      this.currentOptions?.onExit?.(info.currentTime || 0);
    });

    // Listen for video ended
    this.endedListener = CapacitorVideoPlayer.addListener('jeepCapVideoPlayerEnded', (info: any) => {
      loggers.nativeVideo.debug('Player ended event', { info });
      this.currentOptions?.onEnded?.();
    });

    // Listen for player ready
    this.readyListener = CapacitorVideoPlayer.addListener('jeepCapVideoPlayerReady', (info: any) => {
      loggers.nativeVideo.debug('Player ready event', { info });
    });
  }

  private removeListeners(): void {
    if (this.exitListener) {
      this.exitListener.remove();
      this.exitListener = null;
    }
    if (this.endedListener) {
      this.endedListener.remove();
      this.endedListener = null;
    }
    if (this.readyListener) {
      this.readyListener.remove();
      this.readyListener = null;
    }
  }
}

// Export singleton instance
export const nativeVideoPlayer = new NativeVideoPlayerService();
