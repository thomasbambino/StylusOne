import { db } from '../db';
import { channelMappings, iptvChannels, iptvProviders } from '@shared/schema';
import { eq, and, ne, asc, like, or, sql } from 'drizzle-orm';

/**
 * Service for managing cross-provider channel mappings
 * Used for automatic failover when a provider goes down
 */

export interface ChannelMappingWithInfo {
  id: number;
  primaryChannelId: number;
  backupChannelId: number;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  primaryChannel: {
    id: number;
    name: string;
    logo: string | null;
    streamId: string;
    providerId: number;
    providerName: string;
  };
  backupChannel: {
    id: number;
    name: string;
    logo: string | null;
    streamId: string;
    providerId: number;
    providerName: string;
  };
}

export interface BackupChannelInfo {
  mappingId: number;
  channelId: number;
  streamId: string;
  name: string;
  providerId: number;
  providerName: string;
  priority: number;
  providerHealthStatus: string;
}

export class ChannelMappingService {
  /**
   * Get all backup channels for a primary channel, ordered by priority
   */
  async getBackupChannels(primaryChannelId: number): Promise<BackupChannelInfo[]> {
    const mappings = await db.select({
      mappingId: channelMappings.id,
      channelId: iptvChannels.id,
      streamId: iptvChannels.streamId,
      name: iptvChannels.name,
      providerId: iptvChannels.providerId,
      providerName: iptvProviders.name,
      priority: channelMappings.priority,
      providerHealthStatus: iptvProviders.healthStatus,
    })
      .from(channelMappings)
      .innerJoin(iptvChannels, eq(channelMappings.backupChannelId, iptvChannels.id))
      .innerJoin(iptvProviders, eq(iptvChannels.providerId, iptvProviders.id))
      .where(and(
        eq(channelMappings.primaryChannelId, primaryChannelId),
        eq(channelMappings.isActive, true),
        eq(iptvChannels.isEnabled, true),
        eq(iptvProviders.isActive, true)
      ))
      .orderBy(asc(channelMappings.priority));

    return mappings;
  }

  /**
   * Get backup channels by primary channel's streamId and optionally providerId
   * This is the main method used during streaming for failover
   * If providerId is 0 or undefined, searches across all providers
   */
  async getBackupsByStreamId(streamId: string, providerId?: number): Promise<BackupChannelInfo[]> {
    // Find the primary channel - either by streamId+providerId or just streamId
    let primaryChannel;

    if (providerId && providerId > 0) {
      [primaryChannel] = await db.select()
        .from(iptvChannels)
        .where(and(
          eq(iptvChannels.streamId, streamId),
          eq(iptvChannels.providerId, providerId)
        ));
    } else {
      // Search by streamId across all providers
      [primaryChannel] = await db.select()
        .from(iptvChannels)
        .where(eq(iptvChannels.streamId, streamId));
    }

    if (!primaryChannel) {
      return [];
    }

    return this.getBackupChannels(primaryChannel.id);
  }

  /**
   * Create a channel mapping
   */
  async createMapping(
    primaryChannelId: number,
    backupChannelId: number,
    priority?: number
  ): Promise<typeof channelMappings.$inferSelect> {
    // Validate channels exist and are from different providers
    const [primaryChannel] = await db.select()
      .from(iptvChannels)
      .where(eq(iptvChannels.id, primaryChannelId));

    const [backupChannel] = await db.select()
      .from(iptvChannels)
      .where(eq(iptvChannels.id, backupChannelId));

    if (!primaryChannel || !backupChannel) {
      throw new Error('Primary or backup channel not found');
    }

    if (primaryChannel.providerId === backupChannel.providerId) {
      throw new Error('Primary and backup channels must be from different providers');
    }

    if (primaryChannelId === backupChannelId) {
      throw new Error('Cannot map a channel to itself');
    }

    // If no priority specified, find next available
    if (priority === undefined) {
      const existingMappings = await db.select()
        .from(channelMappings)
        .where(eq(channelMappings.primaryChannelId, primaryChannelId));

      priority = existingMappings.length + 1;
    }

    const now = new Date();
    const [mapping] = await db.insert(channelMappings)
      .values({
        primaryChannelId,
        backupChannelId,
        priority,
        isActive: true,
        createdAt: now,
        updatedAt: now
      })
      .returning();

    return mapping;
  }

  /**
   * Update a mapping's priority or active status
   */
  async updateMapping(
    mappingId: number,
    data: { priority?: number; isActive?: boolean }
  ): Promise<void> {
    await db.update(channelMappings)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(eq(channelMappings.id, mappingId));
  }

  /**
   * Delete a channel mapping
   */
  async deleteMapping(mappingId: number): Promise<void> {
    await db.delete(channelMappings)
      .where(eq(channelMappings.id, mappingId));
  }

  /**
   * Get all mappings with full channel info
   */
  async getAllMappings(): Promise<ChannelMappingWithInfo[]> {
    // Use aliases for the two channel joins
    const primaryChannelAlias = db.select({
      id: iptvChannels.id,
      name: iptvChannels.name,
      logo: iptvChannels.logo,
      streamId: iptvChannels.streamId,
      providerId: iptvChannels.providerId,
    }).from(iptvChannels).as('primary_channel');

    const results = await db.select({
      id: channelMappings.id,
      primaryChannelId: channelMappings.primaryChannelId,
      backupChannelId: channelMappings.backupChannelId,
      priority: channelMappings.priority,
      isActive: channelMappings.isActive,
      createdAt: channelMappings.createdAt,
      updatedAt: channelMappings.updatedAt,
    })
      .from(channelMappings)
      .orderBy(asc(channelMappings.primaryChannelId), asc(channelMappings.priority));

    // Fetch channel details separately for better query efficiency
    const mappingsWithInfo: ChannelMappingWithInfo[] = [];

    for (const mapping of results) {
      const [primaryChannel] = await db.select({
        id: iptvChannels.id,
        name: iptvChannels.name,
        logo: iptvChannels.logo,
        streamId: iptvChannels.streamId,
        providerId: iptvChannels.providerId,
        providerName: iptvProviders.name,
      })
        .from(iptvChannels)
        .innerJoin(iptvProviders, eq(iptvChannels.providerId, iptvProviders.id))
        .where(eq(iptvChannels.id, mapping.primaryChannelId));

      const [backupChannel] = await db.select({
        id: iptvChannels.id,
        name: iptvChannels.name,
        logo: iptvChannels.logo,
        streamId: iptvChannels.streamId,
        providerId: iptvChannels.providerId,
        providerName: iptvProviders.name,
      })
        .from(iptvChannels)
        .innerJoin(iptvProviders, eq(iptvChannels.providerId, iptvProviders.id))
        .where(eq(iptvChannels.id, mapping.backupChannelId));

      if (primaryChannel && backupChannel) {
        mappingsWithInfo.push({
          ...mapping,
          primaryChannel,
          backupChannel
        });
      }
    }

    return mappingsWithInfo;
  }

  /**
   * Get mappings for a specific primary channel
   */
  async getMappingsForChannel(primaryChannelId: number): Promise<ChannelMappingWithInfo[]> {
    const allMappings = await this.getAllMappings();
    return allMappings.filter(m => m.primaryChannelId === primaryChannelId);
  }

  /**
   * Search for potential backup channels from other providers
   */
  async searchBackupCandidates(
    primaryChannelId: number,
    query: string,
    limit: number = 20
  ): Promise<Array<{
    id: number;
    name: string;
    logo: string | null;
    streamId: string;
    providerId: number;
    providerName: string;
    alreadyMapped: boolean;
  }>> {
    // Get the primary channel to exclude its provider
    const [primaryChannel] = await db.select()
      .from(iptvChannels)
      .where(eq(iptvChannels.id, primaryChannelId));

    if (!primaryChannel) {
      throw new Error('Primary channel not found');
    }

    // Get existing mappings for this channel
    const existingMappings = await db.select({ backupChannelId: channelMappings.backupChannelId })
      .from(channelMappings)
      .where(eq(channelMappings.primaryChannelId, primaryChannelId));

    const mappedIds = new Set(existingMappings.map(m => m.backupChannelId));

    // Search for channels from OTHER providers matching the query
    const searchPattern = `%${query}%`;

    const candidates = await db.select({
      id: iptvChannels.id,
      name: iptvChannels.name,
      logo: iptvChannels.logo,
      streamId: iptvChannels.streamId,
      providerId: iptvChannels.providerId,
      providerName: iptvProviders.name,
    })
      .from(iptvChannels)
      .innerJoin(iptvProviders, eq(iptvChannels.providerId, iptvProviders.id))
      .where(and(
        ne(iptvChannels.providerId, primaryChannel.providerId),
        eq(iptvChannels.isEnabled, true),
        eq(iptvProviders.isActive, true),
        like(iptvChannels.name, searchPattern)
      ))
      .limit(limit);

    return candidates.map(c => ({
      ...c,
      alreadyMapped: mappedIds.has(c.id)
    }));
  }

  /**
   * Auto-suggest backup channels based on name similarity
   */
  async suggestMappings(
    primaryChannelId: number,
    limit: number = 5
  ): Promise<Array<{
    channel: {
      id: number;
      name: string;
      logo: string | null;
      providerId: number;
      providerName: string;
    };
    confidence: number; // 0-100
  }>> {
    const [primaryChannel] = await db.select()
      .from(iptvChannels)
      .where(eq(iptvChannels.id, primaryChannelId));

    if (!primaryChannel) {
      return [];
    }

    // Clean the name for matching
    const cleanName = primaryChannel.name
      .toLowerCase()
      .replace(/\s*(hd|sd|4k|fhd|uhd)\s*/gi, '')
      .replace(/[^a-z0-9]/g, '');

    // Search for similar channels from other providers
    const candidates = await db.select({
      id: iptvChannels.id,
      name: iptvChannels.name,
      logo: iptvChannels.logo,
      providerId: iptvChannels.providerId,
      providerName: iptvProviders.name,
    })
      .from(iptvChannels)
      .innerJoin(iptvProviders, eq(iptvChannels.providerId, iptvProviders.id))
      .where(and(
        ne(iptvChannels.providerId, primaryChannel.providerId),
        eq(iptvChannels.isEnabled, true),
        eq(iptvProviders.isActive, true)
      ))
      .limit(500); // Get a larger set to filter

    // Calculate similarity scores
    const suggestions = candidates
      .map(c => {
        const candidateClean = c.name
          .toLowerCase()
          .replace(/\s*(hd|sd|4k|fhd|uhd)\s*/gi, '')
          .replace(/[^a-z0-9]/g, '');

        // Simple similarity: percentage of matching characters
        const similarity = this.calculateSimilarity(cleanName, candidateClean);

        return {
          channel: c,
          confidence: Math.round(similarity * 100)
        };
      })
      .filter(s => s.confidence >= 40) // Show more matches with lower threshold
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    return suggestions;
  }

  /**
   * Calculate string similarity (Levenshtein-based)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;

    // Check if one contains the other
    if (str1.includes(str2) || str2.includes(str1)) {
      const longer = Math.max(str1.length, str2.length);
      const shorter = Math.min(str1.length, str2.length);
      return shorter / longer;
    }

    // Levenshtein distance
    const matrix: number[][] = [];

    for (let i = 0; i <= str1.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[str1.length][str2.length];
    const maxLength = Math.max(str1.length, str2.length);
    return 1 - distance / maxLength;
  }

  /**
   * Clean channel name for matching - removes common prefixes, suffixes, quality markers
   */
  private cleanChannelName(name: string): string {
    return name
      .toLowerCase()
      // Remove country/region prefixes like "US:", "UK:", "USA -", etc.
      .replace(/^(us|uk|usa|ca|can|au|aus|nz|ie|mx|es|fr|de|it|br|pt)[\s:\-\.]+/gi, '')
      // Remove quality markers
      .replace(/\s*(hd|sd|4k|fhd|uhd|hevc|h\.?265|1080p?|720p?|540p?)\s*/gi, '')
      // Remove parenthetical content like (East), (West), (Pacific), etc.
      .replace(/\s*\([^)]*\)\s*/g, '')
      // Remove common suffixes
      .replace(/\s+(east|west|pacific|mountain|central|atlantic)\s*$/gi, '')
      // Keep only alphanumeric
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Auto-suggest backup channels from a specific target provider
   */
  async suggestMappingsForProvider(
    primaryChannelId: number,
    targetProviderId: number,
    limit: number = 15
  ): Promise<Array<{
    channel: {
      id: number;
      name: string;
      logo: string | null;
      providerId: number;
      providerName: string;
    };
    confidence: number; // 0-100
  }>> {
    const [primaryChannel] = await db.select()
      .from(iptvChannels)
      .where(eq(iptvChannels.id, primaryChannelId));

    if (!primaryChannel) {
      return [];
    }

    // Clean the name for matching
    const cleanName = this.cleanChannelName(primaryChannel.name);

    // Search for similar channels from the target provider only
    const candidates = await db.select({
      id: iptvChannels.id,
      name: iptvChannels.name,
      logo: iptvChannels.logo,
      providerId: iptvChannels.providerId,
      providerName: iptvProviders.name,
    })
      .from(iptvChannels)
      .innerJoin(iptvProviders, eq(iptvChannels.providerId, iptvProviders.id))
      .where(and(
        eq(iptvChannels.providerId, targetProviderId),
        eq(iptvChannels.isEnabled, true),
        eq(iptvProviders.isActive, true)
      ))
      .limit(1000); // Get a larger set to filter

    // Calculate similarity scores
    const suggestions = candidates
      .map(c => {
        const candidateClean = this.cleanChannelName(c.name);

        // Calculate Levenshtein similarity
        const levenshteinSim = this.calculateSimilarity(cleanName, candidateClean);

        // Also check if one contains the other (for partial matches)
        let containsBonus = 0;
        if (cleanName.length >= 2 && candidateClean.length >= 2) {
          if (candidateClean.includes(cleanName) || cleanName.includes(candidateClean)) {
            containsBonus = 0.3; // 30% bonus for substring match
          }
        }

        const finalScore = Math.min(1, levenshteinSim + containsBonus);

        return {
          channel: c,
          confidence: Math.round(finalScore * 100)
        };
      })
      .filter(s => s.confidence >= 10) // Low threshold - show more options
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    return suggestions;
  }

  /**
   * Bulk create mappings (for initial setup)
   */
  async bulkCreateMappings(
    mappings: Array<{ primaryChannelId: number; backupChannelId: number; priority?: number }>
  ): Promise<number> {
    let created = 0;

    for (const mapping of mappings) {
      try {
        await this.createMapping(
          mapping.primaryChannelId,
          mapping.backupChannelId,
          mapping.priority
        );
        created++;
      } catch (error) {
        // Skip duplicates or invalid mappings
        console.warn(`Failed to create mapping:`, error);
      }
    }

    return created;
  }

  /**
   * Get mapping statistics
   */
  async getMappingStats(): Promise<{
    totalMappings: number;
    activeMappings: number;
    channelsWithBackups: number;
    providersInvolved: number;
  }> {
    const allMappings = await db.select()
      .from(channelMappings);

    const activeMappings = allMappings.filter(m => m.isActive);

    const primaryChannelIds = new Set(allMappings.map(m => m.primaryChannelId));

    // Get providers involved
    const channelIds = new Set([
      ...allMappings.map(m => m.primaryChannelId),
      ...allMappings.map(m => m.backupChannelId)
    ]);

    const channels = await db.select({ providerId: iptvChannels.providerId })
      .from(iptvChannels)
      .where(sql`${iptvChannels.id} IN (${Array.from(channelIds).join(',')})`);

    const providerIds = new Set(channels.map(c => c.providerId));

    return {
      totalMappings: allMappings.length,
      activeMappings: activeMappings.length,
      channelsWithBackups: primaryChannelIds.size,
      providersInvolved: providerIds.size
    };
  }
}

// Export singleton instance
export const channelMappingService = new ChannelMappingService();
