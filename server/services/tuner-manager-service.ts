import { EventEmitter } from 'events';

export interface TunerSession {
  id: string;
  userId: string;
  channelNumber: string;
  tunerId: number;
  startTime: Date;
  lastHeartbeat: Date;
  streamUrl: string;
  priority: number;
}

export interface TunerInfo {
  id: number;
  inUse: boolean;
  channelNumber?: string;
  sessionIds: string[];
  lastActivity: Date;
  failureCount: number;
  status: 'available' | 'busy' | 'failed' | 'maintenance';
}

export interface QueuedRequest {
  id: string;
  userId: string;
  channelNumber: string;
  timestamp: Date;
  priority: number;
  resolve: (session: TunerSession) => void;
  reject: (error: Error) => void;
}

export interface TunerConfig {
  maxTuners: number;
  heartbeatInterval: number;
  sessionTimeout: number;
  queueTimeout: number;
  maxFailures: number;
  priorities: {
    admin: number;
    premium: number;
    standard: number;
  };
}

export class TunerManagerService extends EventEmitter {
  private tuners: Map<number, TunerInfo> = new Map();
  private sessions: Map<string, TunerSession> = new Map();
  private channelToTuner: Map<string, number> = new Map();
  private requestQueue: QueuedRequest[] = [];
  private config: TunerConfig;
  private heartbeatTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<TunerConfig> = {}) {
    super();
    
    this.config = {
      maxTuners: 4, // Default for HDHomeRun PRIME/EXTEND
      heartbeatInterval: 30000, // 30 seconds
      sessionTimeout: 90000, // 1.5 minutes (more aggressive cleanup)
      queueTimeout: 300000, // 5 minutes
      maxFailures: 3,
      priorities: {
        admin: 100,
        premium: 50,
        standard: 10
      },
      ...config
    };

    this.initializeTuners();
    this.startHeartbeatMonitor();
    this.startCleanupMonitor();
  }

  private initializeTuners(): void {
    for (let i = 0; i < this.config.maxTuners; i++) {
      this.tuners.set(i, {
        id: i,
        inUse: false,
        sessionIds: [],
        lastActivity: new Date(),
        failureCount: 0,
        status: 'available'
      });
    }
  }

  private startHeartbeatMonitor(): void {
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
    }, this.config.heartbeatInterval);
  }

  private startCleanupMonitor(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleSessions();
      this.processQueue();
    }, 10000); // Check every 10 seconds
  }

  private checkHeartbeats(): void {
    const now = new Date();
    const timeoutThreshold = now.getTime() - this.config.sessionTimeout;

    for (const [sessionId, session] of this.sessions) {
      if (session.lastHeartbeat.getTime() < timeoutThreshold) {
        console.log(`Session ${sessionId} timed out, releasing tuner`);
        this.releaseSession(sessionId);
      }
    }
  }

  private cleanupStaleSessions(): void {
    // Remove expired queue requests
    const now = new Date();
    this.requestQueue = this.requestQueue.filter(request => {
      if (now.getTime() - request.timestamp.getTime() > this.config.queueTimeout) {
        request.reject(new Error('Request timed out in queue'));
        return false;
      }
      return true;
    });

    // Reset failed tuners after cooldown period
    for (const [tunerId, tuner] of this.tuners) {
      if (tuner.status === 'failed' && 
          now.getTime() - tuner.lastActivity.getTime() > 60000) { // 1 minute cooldown
        tuner.status = 'available';
        tuner.failureCount = 0;
        console.log(`Reset failed tuner ${tunerId}`);
      }
    }
  }

  async requestStream(
    userId: string, 
    channelNumber: string, 
    userType: 'admin' | 'premium' | 'standard' = 'standard'
  ): Promise<TunerSession> {
    return new Promise((resolve, reject) => {
      const priority = this.config.priorities[userType];
      
      // Check if channel is already being streamed (share tuner)
      const existingTunerId = this.channelToTuner.get(channelNumber);
      if (existingTunerId !== undefined) {
        const tuner = this.tuners.get(existingTunerId);
        if (tuner && tuner.status === 'busy') {
          // Get the existing stream URL from any session using this tuner
          const existingSessions = Array.from(this.sessions.values())
            .filter(s => s.tunerId === existingTunerId && s.channelNumber === channelNumber);
          const existingStreamUrl = existingSessions.length > 0 ? existingSessions[0].streamUrl : undefined;
          
          const session = this.createSession(userId, channelNumber, existingTunerId, priority, existingStreamUrl);
          tuner.sessionIds.push(session.id);
          resolve(session);
          return;
        }
      }

      // Find available tuner
      const availableTuner = this.findAvailableTuner();
      if (availableTuner) {
        this.assignTuner(availableTuner, userId, channelNumber, priority)
          .then(resolve)
          .catch(reject);
        return;
      }

      // No tuners available, add to queue
      const queuedRequest: QueuedRequest = {
        id: this.generateId(),
        userId,
        channelNumber,
        timestamp: new Date(),
        priority,
        resolve,
        reject
      };

      this.addToQueue(queuedRequest);
    });
  }

  private findAvailableTuner(): TunerInfo | null {
    for (const tuner of this.tuners.values()) {
      if (tuner.status === 'available') {
        return tuner;
      }
    }
    return null;
  }

  private async assignTuner(
    tuner: TunerInfo, 
    userId: string, 
    channelNumber: string, 
    priority: number
  ): Promise<TunerSession> {
    try {
      // Generate HLS stream URL directly
      const streamUrl = await this.generateStreamUrl(channelNumber);
      
      const session = this.createSession(userId, channelNumber, tuner.id, priority, streamUrl);
      
      tuner.inUse = true;
      tuner.channelNumber = channelNumber;
      tuner.sessionIds = [session.id];
      tuner.lastActivity = new Date();
      tuner.status = 'busy';
      
      this.channelToTuner.set(channelNumber, tuner.id);
      
      this.emit('tunerAssigned', { tunerId: tuner.id, channelNumber, sessionId: session.id });
      
      return session;
    } catch (error) {
      tuner.failureCount++;
      if (tuner.failureCount >= this.config.maxFailures) {
        tuner.status = 'failed';
        console.error(`Tuner ${tuner.id} marked as failed after ${tuner.failureCount} failures`);
      }
      throw error;
    }
  }

  private createSession(userId: string, channelNumber: string, tunerId: number, priority: number, streamUrl?: string): TunerSession {
    const session: TunerSession = {
      id: this.generateId(),
      userId,
      channelNumber,
      tunerId,
      startTime: new Date(),
      lastHeartbeat: new Date(),
      streamUrl: streamUrl || `/streams/channel_${channelNumber.replace('.', '_')}/playlist.m3u8`,
      priority
    };

    this.sessions.set(session.id, session);
    return session;
  }

  private addToQueue(request: QueuedRequest): void {
    // Insert in priority order (higher priority first)
    let insertIndex = this.requestQueue.findIndex(r => r.priority < request.priority);
    if (insertIndex === -1) insertIndex = this.requestQueue.length;
    
    this.requestQueue.splice(insertIndex, 0, request);
    
    this.emit('queueUpdated', { 
      queueLength: this.requestQueue.length, 
      position: insertIndex + 1 
    });
  }

  private processQueue(): void {
    if (this.requestQueue.length === 0) return;

    const availableTuner = this.findAvailableTuner();
    if (!availableTuner) return;

    const nextRequest = this.requestQueue.shift()!;
    
    this.assignTuner(availableTuner, nextRequest.userId, nextRequest.channelNumber, nextRequest.priority)
      .then(session => {
        nextRequest.resolve(session);
        this.emit('queueProcessed', { sessionId: session.id });
      })
      .catch(error => {
        nextRequest.reject(error);
      });
  }

  updateHeartbeat(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.lastHeartbeat = new Date();
    
    const tuner = this.tuners.get(session.tunerId);
    if (tuner) {
      tuner.lastActivity = new Date();
    }

    return true;
  }

  releaseSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const tuner = this.tuners.get(session.tunerId);
    if (tuner) {
      // Remove session from tuner
      tuner.sessionIds = tuner.sessionIds.filter(id => id !== sessionId);
      
      // If no more sessions using this tuner, release it
      if (tuner.sessionIds.length === 0) {
        tuner.inUse = false;
        tuner.channelNumber = undefined;
        tuner.status = 'available';
        tuner.lastActivity = new Date();
        
        if (session.channelNumber) {
          this.channelToTuner.delete(session.channelNumber);
        }
        
        this.emit('tunerReleased', { tunerId: tuner.id, channelNumber: session.channelNumber });
        
        // Stop the actual stream when tuner is released
        if (session.channelNumber) {
          this.stopChannelStream(session.channelNumber);
        }
      }
    }

    this.sessions.delete(sessionId);
    this.emit('sessionReleased', { sessionId });
    
    // Process queue in case tuner became available
    setTimeout(() => this.processQueue(), 100);
    
    return true;
  }

  getStatus() {
    return {
      tuners: Array.from(this.tuners.values()),
      activeSessions: Array.from(this.sessions.values()),
      queueLength: this.requestQueue.length,
      channelMapping: Object.fromEntries(this.channelToTuner)
    };
  }

  getSession(sessionId: string): TunerSession | undefined {
    return this.sessions.get(sessionId);
  }

  getUserSessions(userId: string): TunerSession[] {
    return Array.from(this.sessions.values()).filter(session => session.userId === userId);
  }

  private async generateStreamUrl(channelNumber: string): Promise<string> {
    try {
      const { HDHomeRunService } = await import('./hdhomerun-service');
      const hdhrService = new HDHomeRunService();
      
      if (!hdhrService.isConfigured()) {
        throw new Error('HDHomeRun service not configured');
      }
      
      // Get the raw stream URL from HDHomeRun
      const sourceUrl = hdhrService.getChannelStreamUrl(channelNumber);
      console.log(`HD HomeRun stream request for channel ${channelNumber}, source URL: ${sourceUrl}`);
      
      // Import streaming service
      const { streamingService } = await import('./streaming-service');
      
      // Start HLS conversion
      console.log(`Starting HLS stream conversion for channel ${channelNumber}`);
      const streamUrl = await streamingService.startHLSStream(channelNumber, sourceUrl);
      
      return streamUrl;
    } catch (error) {
      console.error(`Error generating stream URL for channel ${channelNumber}:`, error);
      // Fallback to default pattern
      return `/streams/channel_${channelNumber.replace('.', '_')}/playlist.m3u8`;
    }
  }

  private async stopChannelStream(channelNumber: string): Promise<void> {
    try {
      const { streamingService } = await import('./streaming-service');
      const streamId = `channel_${channelNumber.replace('.', '_')}`;
      console.log(`Stopping FFmpeg stream for channel ${channelNumber} (streamId: ${streamId})`);
      streamingService.stopStream(streamId);
    } catch (error) {
      console.error(`Error stopping stream for channel ${channelNumber}:`, error);
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    // Reject all queued requests
    this.requestQueue.forEach(request => {
      request.reject(new Error('Service shutting down'));
    });
    
    this.removeAllListeners();
  }
}

// Singleton instance
export const tunerManager = new TunerManagerService();