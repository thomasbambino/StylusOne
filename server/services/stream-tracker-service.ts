import crypto from 'crypto';
import { db } from '../db';
import { activeIptvStreams, iptvCredentials, iptvChannels, viewingHistory } from '@shared/schema';
import { eq, and, lt } from 'drizzle-orm';
import { getSharedEPGService } from './epg-singleton';

/**
 * Service for tracking active IPTV streams and enforcing concurrent stream limits
 */
export class StreamTrackerService {
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private staleStreamThreshold: number = 60000; // 60 seconds without heartbeat = stale

  /**
   * Start the cleanup interval for stale streams
   */
  startCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }

    // Run cleanup every 30 seconds
    this.cleanupIntervalId = setInterval(async () => {
      try {
        await this.cleanupStaleStreams();
      } catch (error) {
        console.error('Error cleaning up stale streams:', error);
      }
    }, 30000);

    console.log('Stream tracker cleanup interval started');
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Generate a unique session token
   */
  private generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Acquire a stream slot for a user
   * Returns session token if successful, null if no capacity
   */
  async acquireStream(
    userId: number,
    credentialId: number,
    streamId: string,
    ipAddress?: string,
    deviceType?: string
  ): Promise<string | null> {
    // Check credential capacity
    const [credential] = await db.select()
      .from(iptvCredentials)
      .where(eq(iptvCredentials.id, credentialId));

    if (!credential) {
      console.error(`Credential ${credentialId} not found`);
      return null;
    }

    // Count active streams for this credential
    const activeStreams = await db.select()
      .from(activeIptvStreams)
      .where(eq(activeIptvStreams.credentialId, credentialId));

    if (activeStreams.length >= credential.maxConnections) {
      console.log(`Credential ${credentialId} at max capacity (${credential.maxConnections})`);
      return null;
    }

    // Check if this user already has a stream for this channel on this credential
    const existingStream = activeStreams.find(
      s => s.userId === userId && s.streamId === streamId
    );

    if (existingStream) {
      // Update heartbeat and return existing token
      await this.heartbeat(existingStream.sessionToken);
      return existingStream.sessionToken;
    }

    // Create new stream entry
    const sessionToken = this.generateSessionToken();

    // Look up channel name and current program (same way as channel guides)
    let startProgramTitle: string | null = null;
    try {
      const [channel] = await db.select({ name: iptvChannels.name })
        .from(iptvChannels)
        .where(eq(iptvChannels.streamId, streamId))
        .limit(1);

      if (channel?.name) {
        const epgService = await getSharedEPGService();
        const program = epgService.getCurrentProgram(channel.name);
        if (program) {
          startProgramTitle = program.title;
          if (program.episodeTitle) {
            startProgramTitle += ` - ${program.episodeTitle}`;
          }
        }
      }
    } catch (e) {
      // EPG lookup failed, continue without program title
    }

    try {
      await db.insert(activeIptvStreams).values({
        credentialId,
        userId,
        streamId,
        sessionToken,
        ipAddress: ipAddress || null,
        deviceType: deviceType || null,
        startProgramTitle
      });

      console.log(`Stream acquired: user=${userId}, credential=${credentialId}, stream=${streamId}`);
      return sessionToken;
    } catch (error) {
      console.error('Error acquiring stream:', error);
      return null;
    }
  }

  /**
   * Acquire an M3U stream for a user (no credential/capacity limits)
   * Used for M3U provider streams that don't have connection limits
   * Returns session token
   */
  async acquireM3UStream(
    userId: number,
    streamId: string,
    ipAddress?: string,
    deviceType?: string
  ): Promise<string> {
    // Check if this user already has a stream for this M3U channel
    const existingStreams = await db.select()
      .from(activeIptvStreams)
      .where(and(
        eq(activeIptvStreams.userId, userId),
        eq(activeIptvStreams.streamId, streamId)
      ));

    if (existingStreams.length > 0) {
      // Update heartbeat and return existing token
      await this.heartbeat(existingStreams[0].sessionToken);
      return existingStreams[0].sessionToken;
    }

    // Create new stream entry
    const sessionToken = this.generateSessionToken();

    // Look up channel name and current program
    let startProgramTitle: string | null = null;
    try {
      const [channel] = await db.select({ name: iptvChannels.name })
        .from(iptvChannels)
        .where(eq(iptvChannels.streamId, streamId))
        .limit(1);

      if (channel?.name) {
        const epgService = await getSharedEPGService();
        const program = epgService.getCurrentProgram(channel.name);
        if (program) {
          startProgramTitle = program.title;
          if (program.episodeTitle) {
            startProgramTitle += ` - ${program.episodeTitle}`;
          }
        }
      }
    } catch (e) {
      // EPG lookup failed, continue without program title
    }

    await db.insert(activeIptvStreams).values({
      credentialId: null, // M3U streams have no credential
      userId,
      streamId,
      sessionToken,
      ipAddress: ipAddress || null,
      deviceType: deviceType || null,
      startProgramTitle
    });

    console.log(`M3U stream acquired: user=${userId}, stream=${streamId}`);
    return sessionToken;
  }

  /**
   * Save a stream to viewing history before deletion
   */
  private async saveToViewingHistory(stream: typeof activeIptvStreams.$inferSelect): Promise<void> {
    try {
      const endedAt = new Date();
      const startedAt = new Date(stream.startedAt);
      const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

      // Look up channel name from database
      let channelName: string | null = null;
      const [channel] = await db.select({ name: iptvChannels.name })
        .from(iptvChannels)
        .where(eq(iptvChannels.streamId, stream.streamId))
        .limit(1);

      if (channel) {
        channelName = channel.name;
      }

      // Use startProgramTitle from stream record (captured when stream started)
      const programTitle = stream.startProgramTitle || null;

      // Look up END program from EPG (same way as channel guides)
      let endProgramTitle: string | null = null;
      if (channelName) {
        try {
          const epgService = await getSharedEPGService();
          const program = epgService.getCurrentProgram(channelName);
          if (program) {
            endProgramTitle = program.title;
            if (program.episodeTitle) {
              endProgramTitle += ` - ${program.episodeTitle}`;
            }
          }
        } catch (e) {
          // EPG lookup failed, continue without end program
        }
      }

      // Log program info
      if (programTitle || endProgramTitle) {
        if (programTitle === endProgramTitle || !endProgramTitle) {
          console.log(`[EPG] Program: ${programTitle || endProgramTitle}`);
        } else {
          console.log(`[EPG] Started: ${programTitle || 'unknown'} → Ended: ${endProgramTitle}`);
        }
      }

      await db.insert(viewingHistory).values({
        userId: stream.userId,
        channelId: stream.streamId,
        channelName,
        programTitle,
        endProgramTitle: endProgramTitle !== programTitle ? endProgramTitle : null, // Only store if different
        credentialId: stream.credentialId,
        startedAt: stream.startedAt,
        endedAt,
        durationSeconds,
        ipAddress: stream.ipAddress,
        deviceType: stream.deviceType,
      });

      console.log(`Viewing history saved: user=${stream.userId}, channel=${stream.streamId}, duration=${durationSeconds}s`);
    } catch (error) {
      console.error('Error saving to viewing history:', error);
    }
  }

  /**
   * Release a stream slot
   */
  async releaseStream(sessionToken: string): Promise<boolean> {
    try {
      const result = await db.delete(activeIptvStreams)
        .where(eq(activeIptvStreams.sessionToken, sessionToken))
        .returning();

      if (result.length > 0) {
        // Save to viewing history
        await this.saveToViewingHistory(result[0]);
        console.log(`Stream released: token=${sessionToken.substring(0, 8)}...`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error releasing stream:', error);
      return false;
    }
  }

  /**
   * Send heartbeat to keep stream alive
   */
  async heartbeat(sessionToken: string): Promise<boolean> {
    try {
      const result = await db.update(activeIptvStreams)
        .set({ lastHeartbeat: new Date() })
        .where(eq(activeIptvStreams.sessionToken, sessionToken))
        .returning();

      return result.length > 0;
    } catch (error) {
      console.error('Error updating heartbeat:', error);
      return false;
    }
  }

  /**
   * Clean up stale streams (no heartbeat for threshold period)
   */
  async cleanupStaleStreams(): Promise<number> {
    const staleThreshold = new Date(Date.now() - this.staleStreamThreshold);

    try {
      const result = await db.delete(activeIptvStreams)
        .where(lt(activeIptvStreams.lastHeartbeat, staleThreshold))
        .returning();

      if (result.length > 0) {
        // Save each stale stream to viewing history
        for (const stream of result) {
          await this.saveToViewingHistory(stream);
        }
        console.log(`Cleaned up ${result.length} stale streams`);
      }

      return result.length;
    } catch (error) {
      console.error('Error cleaning up stale streams:', error);
      return 0;
    }
  }

  /**
   * Get active streams for a credential
   */
  async getActiveStreamsForCredential(credentialId: number): Promise<typeof activeIptvStreams.$inferSelect[]> {
    return db.select()
      .from(activeIptvStreams)
      .where(eq(activeIptvStreams.credentialId, credentialId));
  }

  /**
   * Get active streams for a user
   */
  async getActiveStreamsForUser(userId: number): Promise<typeof activeIptvStreams.$inferSelect[]> {
    return db.select()
      .from(activeIptvStreams)
      .where(eq(activeIptvStreams.userId, userId));
  }

  /**
   * Get stream by session token
   */
  async getStreamByToken(sessionToken: string): Promise<typeof activeIptvStreams.$inferSelect | null> {
    const [stream] = await db.select()
      .from(activeIptvStreams)
      .where(eq(activeIptvStreams.sessionToken, sessionToken));
    return stream || null;
  }

  /**
   * Release all streams for a user
   */
  async releaseAllUserStreams(userId: number): Promise<number> {
    try {
      const result = await db.delete(activeIptvStreams)
        .where(eq(activeIptvStreams.userId, userId))
        .returning();

      if (result.length > 0) {
        // Save each stream to viewing history
        for (const stream of result) {
          await this.saveToViewingHistory(stream);
        }
        console.log(`Released ${result.length} streams for user ${userId}`);
      }

      return result.length;
    } catch (error) {
      console.error('Error releasing user streams:', error);
      return 0;
    }
  }

  /**
   * Release all streams for a credential
   */
  async releaseAllCredentialStreams(credentialId: number): Promise<number> {
    try {
      const result = await db.delete(activeIptvStreams)
        .where(eq(activeIptvStreams.credentialId, credentialId))
        .returning();

      if (result.length > 0) {
        // Save each stream to viewing history
        for (const stream of result) {
          await this.saveToViewingHistory(stream);
        }
        console.log(`Released ${result.length} streams for credential ${credentialId}`);
      }

      return result.length;
    } catch (error) {
      console.error('Error releasing credential streams:', error);
      return 0;
    }
  }

  /**
   * Get capacity info for a credential
   */
  async getCredentialCapacity(credentialId: number): Promise<{ max: number; used: number; available: number } | null> {
    const [credential] = await db.select()
      .from(iptvCredentials)
      .where(eq(iptvCredentials.id, credentialId));

    if (!credential) {
      return null;
    }

    const activeStreams = await db.select()
      .from(activeIptvStreams)
      .where(eq(activeIptvStreams.credentialId, credentialId));

    return {
      max: credential.maxConnections,
      used: activeStreams.length,
      available: Math.max(0, credential.maxConnections - activeStreams.length)
    };
  }

  /**
   * Get all active streams with credential info
   */
  async getAllActiveStreams(): Promise<Array<typeof activeIptvStreams.$inferSelect & { credentialName?: string }>> {
    const streams = await db.select()
      .from(activeIptvStreams)
      .innerJoin(iptvCredentials, eq(activeIptvStreams.credentialId, iptvCredentials.id));

    return streams.map(s => ({
      ...s.active_iptv_streams,
      credentialName: s.iptv_credentials.name
    }));
  }
}

// Export singleton instance
export const streamTrackerService = new StreamTrackerService();
