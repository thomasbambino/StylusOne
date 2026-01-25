import Hls, { ErrorData } from 'hls.js';
import { loggers } from './logger';

/**
 * HLS Error Recovery Manager
 *
 * Implements multi-stage error recovery with:
 * - Retry tracking with exponential backoff
 * - Cooldown reset after idle period
 * - swapAudioCodec() after consecutive media errors
 * - Discontinuity detection and nudge recovery
 */

interface ErrorRecoveryState {
  networkRetryCount: number;
  mediaRetryCount: number;
  lastErrorTime: number;
  consecutiveMediaErrors: number;
  lastDiscontinuity: number;
  audioCodecSwapped: boolean;
}

const COOLDOWN_RESET_MS = 30000; // Reset counters after 30s without errors
const MAX_NETWORK_RETRIES = 3;
const MAX_MEDIA_RETRIES = 5;
const RETRY_DELAYS = [1000, 2000, 3000]; // Exponential backoff delays
const CONSECUTIVE_MEDIA_ERROR_THRESHOLD = 3; // Try audio codec swap after this many

export class HlsErrorRecovery {
  private state: ErrorRecoveryState;
  private hls: Hls | null = null;
  private video: HTMLVideoElement | null = null;
  private onFatalError?: () => void;
  private onModeSwitch?: (mode: 'proxy') => void;

  constructor() {
    this.state = this.getInitialState();
  }

  private getInitialState(): ErrorRecoveryState {
    return {
      networkRetryCount: 0,
      mediaRetryCount: 0,
      lastErrorTime: 0,
      consecutiveMediaErrors: 0,
      lastDiscontinuity: -1,
      audioCodecSwapped: false,
    };
  }

  /**
   * Attach to an HLS instance and video element
   */
  attach(hls: Hls, video: HTMLVideoElement, options?: {
    onFatalError?: () => void;
    onModeSwitch?: (mode: 'proxy') => void;
  }) {
    this.hls = hls;
    this.video = video;
    this.onFatalError = options?.onFatalError;
    this.onModeSwitch = options?.onModeSwitch;
    this.state = this.getInitialState();

    // Listen for fragment changes to detect discontinuities
    hls.on(Hls.Events.FRAG_CHANGED, this.handleFragChanged.bind(this));
  }

  /**
   * Detach from current HLS instance
   */
  detach() {
    this.hls = null;
    this.video = null;
    this.state = this.getInitialState();
  }

  /**
   * Check if cooldown period has passed and reset counters if so
   */
  private checkCooldownReset(): void {
    const now = Date.now();
    if (this.state.lastErrorTime > 0 &&
        now - this.state.lastErrorTime > COOLDOWN_RESET_MS) {
      loggers.tv.debug('Error recovery cooldown reset', {
        idleMs: now - this.state.lastErrorTime
      });
      this.state.networkRetryCount = 0;
      this.state.mediaRetryCount = 0;
      this.state.consecutiveMediaErrors = 0;
      this.state.audioCodecSwapped = false;
    }
    this.state.lastErrorTime = now;
  }

  /**
   * Handle discontinuity detection via fragment changes
   */
  private handleFragChanged(_event: string, data: { frag: { cc: number } }) {
    if (!this.hls || !this.video) return;

    const currentCC = data.frag.cc;

    if (this.state.lastDiscontinuity >= 0 &&
        currentCC !== this.state.lastDiscontinuity) {
      // Discontinuity detected - nudge playback to resync A/V
      loggers.tv.debug('Discontinuity detected, nudging playback', {
        previousCC: this.state.lastDiscontinuity,
        currentCC
      });

      // Small nudge to force decoder resync
      const currentTime = this.video.currentTime;
      this.video.currentTime = currentTime + 0.01;
    }

    this.state.lastDiscontinuity = currentCC;
  }

  /**
   * Handle HLS error with multi-stage recovery
   * Returns true if recovery was attempted, false if giving up
   */
  handleError(data: ErrorData): boolean {
    if (!this.hls) return false;

    this.checkCooldownReset();

    if (!data.fatal) {
      // Non-fatal error - just log it
      loggers.tv.debug('Non-fatal HLS error', {
        type: data.type,
        details: data.details
      });
      return true;
    }

    loggers.tv.warn('Fatal HLS error', {
      type: data.type,
      details: data.details,
      networkRetries: this.state.networkRetryCount,
      mediaRetries: this.state.mediaRetryCount
    });

    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        return this.handleNetworkError(data);

      case Hls.ErrorTypes.MEDIA_ERROR:
        return this.handleMediaError(data);

      default:
        loggers.tv.error('Unrecoverable HLS error type', { type: data.type });
        this.onFatalError?.();
        return false;
    }
  }

  /**
   * Handle network errors with retry and mode fallback
   */
  private handleNetworkError(data: ErrorData): boolean {
    if (!this.hls) return false;

    this.state.networkRetryCount++;
    this.state.consecutiveMediaErrors = 0; // Reset media error counter

    if (this.state.networkRetryCount > MAX_NETWORK_RETRIES) {
      loggers.tv.warn('Max network retries exceeded, suggesting mode switch', {
        retries: this.state.networkRetryCount
      });

      // Suggest switching to proxy mode
      if (this.onModeSwitch) {
        this.onModeSwitch('proxy');
        return true;
      }

      // No mode switch handler - give up
      this.onFatalError?.();
      return false;
    }

    // Calculate delay with exponential backoff
    const delayIndex = Math.min(this.state.networkRetryCount - 1, RETRY_DELAYS.length - 1);
    const delay = RETRY_DELAYS[delayIndex];

    loggers.tv.debug('Network error recovery', {
      attempt: this.state.networkRetryCount,
      delayMs: delay,
      details: data.details
    });

    setTimeout(() => {
      if (this.hls) {
        this.hls.startLoad();
      }
    }, delay);

    return true;
  }

  /**
   * Handle media errors with codec swap fallback
   */
  private handleMediaError(data: ErrorData): boolean {
    if (!this.hls || !this.video) return false;

    this.state.mediaRetryCount++;
    this.state.consecutiveMediaErrors++;

    if (this.state.mediaRetryCount > MAX_MEDIA_RETRIES) {
      loggers.tv.error('Max media retries exceeded', {
        retries: this.state.mediaRetryCount
      });
      this.onFatalError?.();
      return false;
    }

    // Check for parsing errors - try seeking forward to skip corrupted segment
    if (data.details === 'fragParsingError' ||
        data.details === 'bufferAppendError') {
      loggers.tv.debug('Parsing error, seeking forward to skip corrupt segment');
      this.video.currentTime = this.video.currentTime + 1;
      this.hls.startLoad();
      return true;
    }

    // After multiple consecutive media errors, try swapping audio codec
    if (this.state.consecutiveMediaErrors >= CONSECUTIVE_MEDIA_ERROR_THRESHOLD &&
        !this.state.audioCodecSwapped) {
      loggers.tv.debug('Trying audio codec swap after consecutive errors', {
        consecutiveErrors: this.state.consecutiveMediaErrors
      });
      this.state.audioCodecSwapped = true;
      this.hls.swapAudioCodec();
      this.hls.recoverMediaError();
      return true;
    }

    // Standard media error recovery
    loggers.tv.debug('Media error recovery', {
      attempt: this.state.mediaRetryCount,
      details: data.details
    });
    this.hls.recoverMediaError();
    return true;
  }

  /**
   * Reset error state (e.g., when stream plays successfully)
   */
  resetOnSuccess(): void {
    if (this.state.networkRetryCount > 0 || this.state.mediaRetryCount > 0) {
      loggers.tv.debug('Resetting error recovery state after successful playback');
    }
    this.state.consecutiveMediaErrors = 0;
    // Don't reset retry counts here - let cooldown handle it
  }

  /**
   * Get current error state (for debugging)
   */
  getState(): ErrorRecoveryState {
    return { ...this.state };
  }
}

// Singleton instance for easy use
export const hlsErrorRecovery = new HlsErrorRecovery();
