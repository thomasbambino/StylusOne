import { db } from '../db';
import { channelMappings, iptvChannels, iptvProviders } from '@shared/schema';
import { eq, and, ne, asc, like, or, sql, inArray } from 'drizzle-orm';

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
        // Note: We intentionally allow disabled channels as backups
        // They may be hidden from users but still work for failover
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
   * Auto-suggest backup channels based on smart matching
   * Uses call signs, brand names, cities, and string similarity
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
      .limit(1000); // Get a larger set to filter

    // Calculate smart match scores
    const suggestions = candidates
      .map(c => ({
        channel: c,
        confidence: this.calculateSmartScore(primaryChannel.name, c.name)
      }))
      .filter(s => s.confidence >= 30) // Show matches with good relevance
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
   * Extract key elements from channel name for smart matching
   */
  private extractChannelElements(name: string): {
    callSign: string | null;      // e.g., KGTV, KSWB, KNSD
    brand: string | null;         // e.g., ABC, FOX, ESPN, CNN
    city: string | null;          // e.g., San Diego, Los Angeles
    cleanName: string;            // Cleaned full name
  } {
    const upperName = name.toUpperCase();
    const lowerName = name.toLowerCase();

    // Extract US TV call signs (4 letters starting with K or W)
    const callSignMatch = upperName.match(/\b([KW][A-Z]{2,3})\b/);
    const callSign = callSignMatch ? callSignMatch[1] : null;

    // Common channel brands
    const brands = [
      'ABC', 'NBC', 'CBS', 'FOX', 'PBS', 'CW', 'ESPN', 'CNN', 'MSNBC', 'CNBC',
      'AMC', 'TNT', 'TBS', 'USA', 'FX', 'SYFY', 'BRAVO', 'HGTV', 'FOOD', 'TLC',
      'DISCOVERY', 'HISTORY', 'LIFETIME', 'HALLMARK', 'BET', 'CMT', 'VH1', 'MTV',
      'NICKELODEON', 'NICK', 'CARTOON', 'DISNEY', 'FREEFORM', 'ANIMAL PLANET',
      'NATGEO', 'NATIONAL GEOGRAPHIC', 'TRAVEL', 'COMEDY CENTRAL', 'PARAMOUNT',
      'SHOWTIME', 'HBO', 'STARZ', 'CINEMAX', 'ENCORE', 'TMC', 'EPIX', 'MGM',
      'OXYGEN', 'WE', 'OWN', 'REELZ', 'SUNDANCE', 'IFC', 'TCM', 'FXX', 'FXM',
      'TELEMUNDO', 'UNIVISION', 'GALAVISION', 'BOOMERANG', 'TOON', 'ALTITUDE',
      'ROOT SPORTS', 'BALLY', 'MSG', 'NESN', 'YES', 'SNY', 'MASN', 'NBCSN',
      'FS1', 'FS2', 'NFL', 'NBA', 'MLB', 'NHL', 'BIG TEN', 'SEC', 'ACC', 'PAC',
      'AMERICAN HEROES', 'AHC', 'COOKING', 'DIY', 'DESTINATION', 'INVESTIGATION',
      'ID', 'SCIENCE', 'WEATHER', 'NEWSMAX', 'OAN', 'NEWSNATION', 'CSPAN', 'C-SPAN'
    ];

    let brand: string | null = null;
    for (const b of brands) {
      if (upperName.includes(b)) {
        brand = b;
        break;
      }
    }

    // Common cities
    const cities = [
      'SAN DIEGO', 'LOS ANGELES', 'NEW YORK', 'CHICAGO', 'HOUSTON', 'PHOENIX',
      'PHILADELPHIA', 'SAN ANTONIO', 'DALLAS', 'SAN JOSE', 'AUSTIN', 'JACKSONVILLE',
      'FORT WORTH', 'COLUMBUS', 'CHARLOTTE', 'SAN FRANCISCO', 'INDIANAPOLIS',
      'SEATTLE', 'DENVER', 'WASHINGTON', 'BOSTON', 'NASHVILLE', 'BALTIMORE',
      'OKLAHOMA', 'PORTLAND', 'LAS VEGAS', 'MILWAUKEE', 'ALBUQUERQUE', 'TUCSON',
      'FRESNO', 'SACRAMENTO', 'MESA', 'ATLANTA', 'KANSAS CITY', 'COLORADO SPRINGS',
      'MIAMI', 'RALEIGH', 'OMAHA', 'LONG BEACH', 'VIRGINIA BEACH', 'OAKLAND',
      'MINNEAPOLIS', 'TULSA', 'ARLINGTON', 'TAMPA', 'NEW ORLEANS', 'WICHITA',
      'CLEVELAND', 'BAKERSFIELD', 'AURORA', 'ANAHEIM', 'HONOLULU', 'SANTA ANA',
      'RIVERSIDE', 'CORPUS CHRISTI', 'LEXINGTON', 'STOCKTON', 'ST LOUIS', 'PITTSBURGH',
      'CINCINNATI', 'ANCHORAGE', 'HENDERSON', 'GREENSBORO', 'PLANO', 'NEWARK',
      'LINCOLN', 'BUFFALO', 'JERSEY CITY', 'CHULA VISTA', 'FORT WAYNE', 'ORLANDO',
      'ST PAUL', 'CHANDLER', 'LAREDO', 'NORFOLK', 'DURHAM', 'MADISON', 'LUBBOCK',
      'IRVINE', 'WINSTON SALEM', 'GLENDALE', 'GARLAND', 'HIALEAH', 'RENO',
      'CHESAPEAKE', 'GILBERT', 'BATON ROUGE', 'IRVING', 'SCOTTSDALE', 'NORTH LAS VEGAS',
      'FREMONT', 'BOISE', 'RICHMOND', 'SAN BERNARDINO', 'BIRMINGHAM', 'SPOKANE',
      'ROCHESTER', 'DES MOINES', 'MODESTO', 'FAYETTEVILLE', 'TACOMA', 'OXNARD',
      'FONTANA', 'MORENO VALLEY', 'HUNTINGTON BEACH', 'GLENDALE', 'YONKERS',
      'AKRON', 'MONTGOMERY', 'LITTLE ROCK', 'AMARILLO', 'AUGUSTA', 'SALT LAKE',
      'DETROIT', 'LA', 'NYC', 'NY', 'SF', 'DC', 'PHILLY', 'SANDIEGO', 'LOSANGELES'
    ];

    let city: string | null = null;
    for (const c of cities) {
      if (upperName.includes(c)) {
        city = c;
        break;
      }
    }

    // Clean name: remove prefixes, quality markers, special chars
    const cleanName = lowerName
      .replace(/^(us|uk|usa|ca|can|au|aus|prime|sling)[\s:\-\|\.]+/gi, '')
      .replace(/\s*(hd|sd|4k|fhd|uhd|hevc|h\.?265|1080p?|720p?|540p?|raw|ʳᵃʷ|⁶⁰ᶠᵖˢ)\s*/gi, '')
      .replace(/\s*\[[^\]]*\]\s*/g, '') // Remove [brackets]
      .replace(/\s*\([^)]*\)\s*/g, '')  // Remove (parens)
      .replace(/\s+(east|west|pacific|mountain|central|atlantic|backup)\s*$/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return { callSign, brand, city, cleanName };
  }

  /**
   * Calculate smart match score between two channel names
   */
  private calculateSmartScore(primary: string, candidate: string): number {
    const p = this.extractChannelElements(primary);
    const c = this.extractChannelElements(candidate);

    let score = 0;

    // US/Sling prefix bonus - STRONG priority (50 points)
    // Match various formats: "US:", "US ", "USA:", "Sling:", etc.
    const candidateUpper = candidate.toUpperCase();
    const isPriorityChannel = /^(US|USA|SLING)[\s:\-\|\.]/i.test(candidate);
    if (isPriorityChannel) {
      score += 50;
    }

    // Call sign match (very strong signal) - 30 points
    if (p.callSign && c.callSign && p.callSign === c.callSign) {
      score += 30;
    }

    // Brand match (strong signal) - 25 points
    if (p.brand && c.brand && p.brand === c.brand) {
      score += 25;
    }

    // City match (good signal) - 10 points
    if (p.city && c.city && p.city === c.city) {
      score += 10;
    }

    // Clean name similarity - up to 10 points
    const levenshteinSim = this.calculateSimilarity(p.cleanName, c.cleanName);
    score += levenshteinSim * 10;

    // Substring bonus: if one clean name contains the other
    if (p.cleanName.length >= 3 && c.cleanName.length >= 3) {
      if (c.cleanName.includes(p.cleanName) || p.cleanName.includes(c.cleanName)) {
        score += 10;
      }
    }

    // Normalize to 0-100
    return Math.min(100, Math.round(score));
  }

  /**
   * Auto-suggest backup channels from a specific target provider
   * Uses smart matching: call signs, brand names, cities, and string similarity
   * Explicitly searches for US channels first to ensure they appear at the top
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

    // Extract elements from primary channel for matching
    const primaryElements = this.extractChannelElements(primaryChannel.name);
    console.log(`[Channel Mapping] Primary: "${primaryChannel.name}" -> callSign: ${primaryElements.callSign}, brand: ${primaryElements.brand}, city: ${primaryElements.city}`);

    // Build search terms from the primary channel
    const searchTerms: string[] = [];
    if (primaryElements.brand) searchTerms.push(primaryElements.brand);
    if (primaryElements.callSign) searchTerms.push(primaryElements.callSign);
    if (primaryElements.city) searchTerms.push(primaryElements.city);
    // Also add the cleaned name words
    const nameWords = primaryElements.cleanName.split(' ').filter(w => w.length >= 3);
    searchTerms.push(...nameWords.slice(0, 3));

    console.log(`[Channel Mapping] Search terms: ${searchTerms.join(', ')}`);

    // First, explicitly search for US/Sling channels matching our search terms
    let priorityChannels: Array<{ id: number; name: string; logo: string | null; providerId: number; providerName: string }> = [];

    for (const term of searchTerms) {
      if (term.length < 2) continue;
      const pattern = `%${term}%`;
      const matches = await db.select({
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
          eq(iptvProviders.isActive, true),
          sql`(${iptvChannels.name} ILIKE 'US:%' OR ${iptvChannels.name} ILIKE 'US %' OR ${iptvChannels.name} ILIKE 'USA:%' OR ${iptvChannels.name} ILIKE 'USA %' OR ${iptvChannels.name} ILIKE 'Sling:%' OR ${iptvChannels.name} ILIKE 'Sling %')`,
          sql`${iptvChannels.name} ILIKE ${pattern}`
        ))
        .limit(50);

      priorityChannels.push(...matches);
    }

    // Deduplicate priority channels
    const priorityChannelMap = new Map(priorityChannels.map(c => [c.id, c]));
    priorityChannels = Array.from(priorityChannelMap.values());
    console.log(`[Channel Mapping] Found ${priorityChannels.length} US/Sling channels matching search terms`);

    // Then get general candidates (any channels from the provider)
    const generalCandidates = await db.select({
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
        eq(iptvProviders.isActive, true)
      ))
      .limit(3000);

    // Combine: Priority channels first (they won't be in general if limit was hit), then general
    const allCandidatesMap = new Map<number, typeof generalCandidates[0]>();
    // Add priority (US/Sling) channels first
    for (const c of priorityChannels) {
      allCandidatesMap.set(c.id, c);
    }
    // Add general candidates
    for (const c of generalCandidates) {
      if (!allCandidatesMap.has(c.id)) {
        allCandidatesMap.set(c.id, c);
      }
    }
    const allCandidates = Array.from(allCandidatesMap.values());

    // Calculate smart match scores
    const suggestions = allCandidates
      .map(c => ({
        channel: c,
        confidence: this.calculateSmartScore(primaryChannel.name, c.name)
      }))
      .filter(s => s.confidence >= 5)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    // Debug: log top 5 suggestions
    suggestions.slice(0, 5).forEach((s, i) => {
      const candidateElements = this.extractChannelElements(s.channel.name);
      const isPriority = /^(US|USA|SLING)[\s:\-\|\.]/i.test(s.channel.name);
      console.log(`[Channel Mapping] #${i+1} (${s.confidence}%): "${s.channel.name}" -> Priority: ${isPriority}, brand: ${candidateElements.brand}`);
    });

    return suggestions;
  }

  /**
   * Get auto-mapping suggestions for multiple channels
   * Returns the best US/Sling match for each channel (if confidence >= threshold)
   */
  async getAutoMappingSuggestions(
    primaryChannelIds: number[],
    targetProviderId: number,
    minConfidence: number = 60
  ): Promise<Array<{
    primaryChannelId: number;
    primaryChannelName: string;
    suggestedBackup: {
      id: number;
      name: string;
      confidence: number;
      isPriority: boolean; // US/Sling channel
    } | null;
    existingMapping: boolean;
  }>> {
    const results: Array<{
      primaryChannelId: number;
      primaryChannelName: string;
      suggestedBackup: {
        id: number;
        name: string;
        confidence: number;
        isPriority: boolean;
      } | null;
      existingMapping: boolean;
    }> = [];

    // Get existing mappings for these channels to this provider
    const existingMappings = await db.select({
      primaryChannelId: channelMappings.primaryChannelId,
      backupChannelId: channelMappings.backupChannelId,
    })
      .from(channelMappings)
      .innerJoin(iptvChannels, eq(channelMappings.backupChannelId, iptvChannels.id))
      .where(and(
        inArray(channelMappings.primaryChannelId, primaryChannelIds),
        eq(iptvChannels.providerId, targetProviderId)
      ));

    const mappedChannelIds = new Set(existingMappings.map(m => m.primaryChannelId));

    // Get primary channel info
    const primaryChannels = await db.select({
      id: iptvChannels.id,
      name: iptvChannels.name,
    })
      .from(iptvChannels)
      .where(inArray(iptvChannels.id, primaryChannelIds));

    const channelMap = new Map(primaryChannels.map(c => [c.id, c.name]));

    for (const channelId of primaryChannelIds) {
      const channelName = channelMap.get(channelId) || 'Unknown';
      const hasMapping = mappedChannelIds.has(channelId);

      if (hasMapping) {
        results.push({
          primaryChannelId: channelId,
          primaryChannelName: channelName,
          suggestedBackup: null,
          existingMapping: true,
        });
        continue;
      }

      // Get suggestions for this channel
      const suggestions = await this.suggestMappingsForProvider(channelId, targetProviderId, 1);

      if (suggestions.length > 0 && suggestions[0].confidence >= minConfidence) {
        const best = suggestions[0];
        const isPriority = /^(US|USA|SLING)[\s:\-\|\.]/i.test(best.channel.name);
        results.push({
          primaryChannelId: channelId,
          primaryChannelName: channelName,
          suggestedBackup: {
            id: best.channel.id,
            name: best.channel.name,
            confidence: best.confidence,
            isPriority,
          },
          existingMapping: false,
        });
      } else {
        results.push({
          primaryChannelId: channelId,
          primaryChannelName: channelName,
          suggestedBackup: null,
          existingMapping: false,
        });
      }
    }

    return results;
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
    const channelIdsArray = [
      ...allMappings.map(m => m.primaryChannelId),
      ...allMappings.map(m => m.backupChannelId)
    ];

    // Handle empty array case
    if (channelIdsArray.length === 0) {
      return {
        totalMappings: 0,
        activeMappings: 0,
        channelsWithBackups: 0,
        providersInvolved: 0
      };
    }

    const channels = await db.select({ providerId: iptvChannels.providerId })
      .from(iptvChannels)
      .where(inArray(iptvChannels.id, channelIdsArray));

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
