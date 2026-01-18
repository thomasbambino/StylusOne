import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { loggers } from '../lib/logger';
import {
  iptvProviders,
  iptvCredentials,
  iptvChannels,
  channelPackages,
  packageChannels,
  planPackages,
  planIptvCredentials,
  activeIptvStreams,
  subscriptionPlans,
  channelMappings,
  providerHealthLogs
} from '@shared/schema';
import { eq, desc, and, sql, inArray, isNull, asc, gte } from 'drizzle-orm';
import { encrypt, decrypt, maskCredential } from '../utils/encryption';
import { xtreamCodesManager, xtreamCodesService, XtreamCodesClient } from '../services/xtream-codes-service';
import { streamTrackerService } from '../services/stream-tracker-service';
import { providerHealthService } from '../services/provider-health-service';
import { channelMappingService } from '../services/channel-mapping-service';
import { m3uParserService } from '../services/m3u-parser-service';
import { HDHomeRunService } from '../services/hdhomerun-service';

const router = Router();

/**
 * Convert local/internal logo URLs to use the proxy endpoint
 */
function convertLogoToProxy(logoUrl: string | null): string | null {
  if (!logoUrl) return null;

  try {
    const url = new URL(logoUrl);
    const isLocalUrl = url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.startsWith('192.168.') ||
      url.hostname.startsWith('10.') ||
      url.hostname.startsWith('172.16.') ||
      url.hostname.startsWith('172.17.') ||
      url.hostname.startsWith('172.18.') ||
      url.hostname.startsWith('172.19.') ||
      url.hostname.startsWith('172.2') ||
      url.hostname.startsWith('172.30.') ||
      url.hostname.startsWith('172.31.');

    if (isLocalUrl) {
      return `/api/iptv/logo-proxy?url=${encodeURIComponent(logoUrl)}`;
    }
  } catch (e) {
    // Invalid URL, return as-is
  }
  return logoUrl;
}

// Debug logging for all requests to this router
router.use((req, res, next) => {
  loggers.adminIptv.debug(`${req.method} ${req.path}`, { fullUrl: req.originalUrl });
  next();
});

// Debug test endpoint - no auth required
router.get('/debug-test', (req, res) => {
  loggers.adminIptv.debug('Debug test endpoint hit');
  res.json({ success: true, message: 'Admin IPTV router is working', timestamp: new Date().toISOString() });
});

// Validation schemas
const createCredentialSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  serverUrl: z.string().url('Invalid server URL'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  maxConnections: z.number().int().min(1).max(10).default(1),
  notes: z.string().optional(),
  isActive: z.boolean().default(true),
});

const updateCredentialSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  serverUrl: z.string().url('Invalid server URL').optional(),
  username: z.string().min(1, 'Username is required').optional(),
  password: z.string().optional(), // Empty means no change
  maxConnections: z.number().int().min(1).max(10).optional(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const assignCredentialSchema = z.object({
  credentialId: z.number().int().positive(),
  priority: z.number().int().min(0).default(0),
});

// Provider validation schemas
const createProviderSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  providerType: z.enum(['xtream', 'm3u', 'hdhomerun']).default('xtream'),
  serverUrl: z.string().url('Invalid server URL').optional(), // Required for xtream and hdhomerun
  m3uUrl: z.string().url('Invalid M3U URL').optional(), // Required for m3u
  xmltvUrl: z.union([z.string().url('Invalid XMLTV URL'), z.literal('')]).optional(), // Optional, allow empty string
  notes: z.string().optional(),
  isActive: z.boolean().default(true),
}).refine(
  (data) => {
    if (data.providerType === 'xtream') {
      return !!data.serverUrl;
    }
    if (data.providerType === 'm3u') {
      return !!data.m3uUrl;
    }
    if (data.providerType === 'hdhomerun') {
      return !!data.serverUrl; // HDHomeRun uses serverUrl for device URL
    }
    return true;
  },
  { message: 'Xtream/HDHomeRun providers require serverUrl, M3U providers require m3uUrl' }
);

const updateProviderSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  serverUrl: z.string().url('Invalid server URL').optional(),
  m3uUrl: z.string().url('Invalid M3U URL').optional(),
  xmltvUrl: z.union([z.string().url('Invalid XMLTV URL'), z.literal('')]).optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// Provider credential schema (for adding credentials to a provider)
const createProviderCredentialSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  maxConnections: z.number().int().min(1).max(100).default(1),
  notes: z.string().optional(),
  isActive: z.boolean().default(true),
});

// Channel package validation schemas
const createPackageSchema = z.object({
  providerId: z.number().int().positive(),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

const updatePackageSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// Channel update schema
const updateChannelSchema = z.object({
  isEnabled: z.boolean().optional(),
  quality: z.enum(['4k', 'hd', 'sd', 'unknown']).optional(),
  customLogo: z.string().url().nullable().optional(), // Custom logo URL (null to remove)
});

const bulkUpdateChannelsSchema = z.object({
  channelIds: z.array(z.number().int().positive()),
  isEnabled: z.boolean(),
});

/**
 * Middleware to check if user is super admin
 */
function requireSuperAdmin(req: any, res: any, next: any) {
  loggers.adminIptv.trace('Checking superadmin access', { username: req.user?.username, role: req.user?.role });
  if (!req.user || req.user!.role !== 'superadmin') {
    loggers.adminIptv.warn('Access denied', { username: req.user?.username, role: req.user?.role });
    return res.status(403).json({ error: 'Super admin access required' });
  }
  loggers.adminIptv.trace('Access granted', { username: req.user?.username });
  next();
}

// ============================================
// Provider Management Endpoints
// ============================================

/**
 * GET /api/admin/iptv-providers
 * List all IPTV providers with stats
 */
router.get('/iptv-providers', requireSuperAdmin, async (req, res) => {
  try {
    const providers = await db
      .select()
      .from(iptvProviders)
      .orderBy(desc(iptvProviders.createdAt));

    // Get stats for each provider
    const providersWithStats = await Promise.all(
      providers.map(async (provider) => {
        // Count credentials for this provider
        const [credentialCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(iptvCredentials)
          .where(eq(iptvCredentials.providerId, provider.id));

        // Count channels for this provider
        const [channelCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(iptvChannels)
          .where(eq(iptvChannels.providerId, provider.id));

        // Count enabled channels
        const [enabledCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(iptvChannels)
          .where(and(
            eq(iptvChannels.providerId, provider.id),
            eq(iptvChannels.isEnabled, true)
          ));

        // Calculate total max connections from all credentials
        const [totalConnections] = await db
          .select({ sum: sql<number>`COALESCE(SUM(max_connections), 0)::int` })
          .from(iptvCredentials)
          .where(and(
            eq(iptvCredentials.providerId, provider.id),
            eq(iptvCredentials.isActive, true)
          ));

        return {
          id: provider.id,
          name: provider.name,
          providerType: provider.providerType || 'xtream',
          serverUrl: provider.serverUrl ? maskCredential(decrypt(provider.serverUrl)) : null,
          m3uUrl: provider.m3uUrl || null,
          xmltvUrl: provider.xmltvUrl || null,
          isActive: provider.isActive,
          notes: provider.notes,
          lastChannelSync: provider.lastChannelSync,
          credentialCount: Number(credentialCount?.count) || 0,
          channelCount: Number(channelCount?.count) || 0,
          enabledChannelCount: Number(enabledCount?.count) || 0,
          totalMaxConnections: Number(totalConnections?.sum) || 0,
          createdAt: provider.createdAt,
          updatedAt: provider.updatedAt,
        };
      })
    );

    res.json(providersWithStats);
  } catch (error) {
    loggers.adminIptv.error('Error fetching IPTV providers', { error });
    res.status(500).json({ error: 'Failed to fetch IPTV providers' });
  }
});

/**
 * GET /api/admin/iptv-providers/:id
 * Get a single provider with full details
 */
router.get('/iptv-providers/:id', requireSuperAdmin, async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: 'Invalid provider ID' });
    }

    const [provider] = await db
      .select()
      .from(iptvProviders)
      .where(eq(iptvProviders.id, providerId));

    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    // Return with decrypted URLs (for edit form)
    res.json({
      id: provider.id,
      name: provider.name,
      providerType: provider.providerType,
      serverUrl: provider.serverUrl ? decrypt(provider.serverUrl) : null,
      m3uUrl: provider.m3uUrl || null,
      xmltvUrl: provider.xmltvUrl || null,
      isActive: provider.isActive,
      notes: provider.notes,
      lastChannelSync: provider.lastChannelSync,
      healthStatus: provider.healthStatus,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    });
  } catch (error) {
    loggers.adminIptv.error('Error fetching IPTV provider', { error });
    res.status(500).json({ error: 'Failed to fetch IPTV provider' });
  }
});

/**
 * POST /api/admin/iptv-providers
 * Create a new IPTV provider (supports both Xtream and M3U types)
 */
router.post('/iptv-providers', requireSuperAdmin, async (req, res) => {
  try {
    const validatedData = createProviderSchema.parse(req.body);

    const [newProvider] = await db
      .insert(iptvProviders)
      .values({
        name: validatedData.name,
        providerType: validatedData.providerType,
        serverUrl: validatedData.serverUrl ? encrypt(validatedData.serverUrl) : null,
        m3uUrl: validatedData.m3uUrl || null,
        xmltvUrl: validatedData.xmltvUrl && validatedData.xmltvUrl.length > 0 ? validatedData.xmltvUrl : null,
        notes: validatedData.notes || null,
        isActive: validatedData.isActive,
      })
      .returning();

    res.status(201).json({
      id: newProvider.id,
      name: newProvider.name,
      providerType: newProvider.providerType,
      isActive: newProvider.isActive,
      notes: newProvider.notes,
      createdAt: newProvider.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Extract first error message for display
      const firstError = error.errors[0];
      const errorMessage = firstError?.message || 'Validation failed';
      return res.status(400).json({ error: errorMessage });
    }
    loggers.adminIptv.error('Error creating IPTV provider', { error });
    res.status(500).json({ error: 'Failed to create IPTV provider' });
  }
});

/**
 * PUT /api/admin/iptv-providers/:id
 * Update an IPTV provider
 */
router.put('/iptv-providers/:id', requireSuperAdmin, async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: 'Invalid provider ID' });
    }

    const validatedData = updateProviderSchema.parse(req.body);

    const updateData: any = { updatedAt: new Date() };

    if (validatedData.name !== undefined) {
      updateData.name = validatedData.name;
    }
    if (validatedData.serverUrl !== undefined) {
      updateData.serverUrl = encrypt(validatedData.serverUrl);
    }
    if (validatedData.m3uUrl !== undefined) {
      updateData.m3uUrl = validatedData.m3uUrl;
    }
    if (validatedData.xmltvUrl !== undefined) {
      updateData.xmltvUrl = validatedData.xmltvUrl;
    }
    if (validatedData.notes !== undefined) {
      updateData.notes = validatedData.notes;
    }
    if (validatedData.isActive !== undefined) {
      updateData.isActive = validatedData.isActive;
    }

    const [updatedProvider] = await db
      .update(iptvProviders)
      .set(updateData)
      .where(eq(iptvProviders.id, providerId))
      .returning();

    if (!updatedProvider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    res.json({
      id: updatedProvider.id,
      name: updatedProvider.name,
      isActive: updatedProvider.isActive,
      notes: updatedProvider.notes,
      updatedAt: updatedProvider.updatedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error updating IPTV provider', { error });
    res.status(500).json({ error: 'Failed to update IPTV provider' });
  }
});

/**
 * DELETE /api/admin/iptv-providers/:id
 * Delete an IPTV provider (cascades to credentials, channels, packages)
 */
router.delete('/iptv-providers/:id', requireSuperAdmin, async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: 'Invalid provider ID' });
    }

    // Get all credentials for this provider to release streams
    const credentials = await db
      .select({ id: iptvCredentials.id })
      .from(iptvCredentials)
      .where(eq(iptvCredentials.providerId, providerId));

    // Release streams for all credentials
    for (const cred of credentials) {
      await streamTrackerService.releaseAllCredentialStreams(cred.id);
      xtreamCodesManager.removeCredential(cred.id);
    }

    // Delete provider (cascade will handle credentials, channels, packages)
    const result = await db
      .delete(iptvProviders)
      .where(eq(iptvProviders.id, providerId))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    res.json({ success: true });
  } catch (error) {
    loggers.adminIptv.error('Error deleting IPTV provider', { error });
    res.status(500).json({ error: 'Failed to delete IPTV provider' });
  }
});

/**
 * GET /api/admin/iptv-providers/:id/credentials
 * Get all credentials for a provider
 */
router.get('/iptv-providers/:id/credentials', requireSuperAdmin, async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: 'Invalid provider ID' });
    }

    const credentials = await db
      .select()
      .from(iptvCredentials)
      .where(eq(iptvCredentials.providerId, providerId))
      .orderBy(desc(iptvCredentials.createdAt));

    // Mask sensitive data and add active stream count
    const credentialsWithStats = await Promise.all(
      credentials.map(async (cred) => {
        const activeStreams = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(activeIptvStreams)
          .where(eq(activeIptvStreams.credentialId, cred.id));

        return {
          id: cred.id,
          providerId: cred.providerId,
          name: cred.name,
          username: maskCredential(decrypt(cred.username)),
          maxConnections: cred.maxConnections,
          isActive: cred.isActive,
          notes: cred.notes,
          healthStatus: cred.healthStatus,
          lastHealthCheck: cred.lastHealthCheck,
          activeStreams: Number(activeStreams[0]?.count) || 0,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
        };
      })
    );

    res.json(credentialsWithStats);
  } catch (error) {
    loggers.adminIptv.error('Error fetching provider credentials', { error });
    res.status(500).json({ error: 'Failed to fetch provider credentials' });
  }
});

/**
 * POST /api/admin/iptv-providers/:id/credentials
 * Add a credential to a provider
 */
router.post('/iptv-providers/:id/credentials', requireSuperAdmin, async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: 'Invalid provider ID' });
    }

    // Check if provider exists
    const [provider] = await db
      .select()
      .from(iptvProviders)
      .where(eq(iptvProviders.id, providerId));

    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    const validatedData = createProviderCredentialSchema.parse(req.body);

    // Create credential with providerId
    const [newCredential] = await db
      .insert(iptvCredentials)
      .values({
        providerId,
        name: validatedData.name,
        serverUrl: null, // Deprecated - server URL is now on provider
        username: encrypt(validatedData.username),
        password: encrypt(validatedData.password),
        maxConnections: validatedData.maxConnections,
        notes: validatedData.notes || null,
        isActive: validatedData.isActive,
        healthStatus: 'unknown',
      })
      .returning();

    // Reload credential in manager
    await xtreamCodesManager.reloadCredential(newCredential.id);

    res.status(201).json({
      id: newCredential.id,
      providerId: newCredential.providerId,
      name: newCredential.name,
      maxConnections: newCredential.maxConnections,
      isActive: newCredential.isActive,
      notes: newCredential.notes,
      healthStatus: newCredential.healthStatus,
      createdAt: newCredential.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error adding credential to provider', { error });
    res.status(500).json({ error: 'Failed to add credential to provider' });
  }
});

/**
 * POST /api/admin/iptv-providers/:id/sync
 * Sync channels from provider (supports both Xtream and M3U types)
 */
router.post('/iptv-providers/:id/sync', requireSuperAdmin, async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: 'Invalid provider ID' });
    }

    // Get provider
    const [provider] = await db
      .select()
      .from(iptvProviders)
      .where(eq(iptvProviders.id, providerId));

    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    let insertCount = 0;
    let updateCount = 0;
    let withEpgCount = 0;
    let totalChannels = 0;

    // Handle HDHomeRun providers
    if (provider.providerType === 'hdhomerun') {
      if (!provider.serverUrl) {
        return res.status(400).json({ error: 'HDHomeRun device URL not configured for this provider' });
      }

      const deviceUrl = decrypt(provider.serverUrl);
      loggers.adminIptv.info('Syncing HDHomeRun provider', { providerId, deviceUrl });

      // Create HDHomeRun service instance for this device
      const hdhrService = new HDHomeRunService();

      try {
        // Verify device is accessible
        await hdhrService.getDeviceInfoFromUrl(deviceUrl);
      } catch (err) {
        return res.status(400).json({ error: 'Failed to connect to HDHomeRun device. Check the device URL.' });
      }

      // Get channels from HDHomeRun device
      const channels = await hdhrService.getChannelsForProvider(deviceUrl);
      totalChannels = channels.length;

      // Log first 5 channels
      loggers.adminIptv.debug('First 5 HDHomeRun channels from device', {
        providerId,
        channels: channels.slice(0, 5).map((ch, i) => ({
          index: i + 1,
          name: ch.name,
          streamId: ch.streamId,
          epgId: ch.epgChannelId
        }))
      });

      // Upsert channels
      for (const channel of channels) {
        // HDHomeRun channels typically have EPG via OTA guide data
        withEpgCount++;

        // Check if channel exists
        const [existing] = await db
          .select({ id: iptvChannels.id })
          .from(iptvChannels)
          .where(and(
            eq(iptvChannels.providerId, providerId),
            eq(iptvChannels.streamId, channel.streamId)
          ));

        if (existing) {
          // Update existing channel (don't change isEnabled)
          await db
            .update(iptvChannels)
            .set({
              name: channel.name,
              categoryName: channel.categoryName,
              epgChannelId: channel.epgChannelId,
              directStreamUrl: channel.directStreamUrl,
              quality: channel.quality,
              hasEPG: true,
              lastSeen: new Date(),
            })
            .where(eq(iptvChannels.id, existing.id));
          updateCount++;
        } else {
          // Insert new channel (disabled by default)
          await db
            .insert(iptvChannels)
            .values({
              providerId,
              streamId: channel.streamId,
              name: channel.name,
              categoryName: channel.categoryName,
              epgChannelId: channel.epgChannelId,
              directStreamUrl: channel.directStreamUrl,
              isEnabled: false,
              quality: channel.quality,
              hasEPG: true,
              lastSeen: new Date(),
            });
          insertCount++;
        }
      }
    }
    // Handle M3U providers
    else if (provider.providerType === 'm3u') {
      if (!provider.m3uUrl) {
        return res.status(400).json({ error: 'M3U URL not configured for this provider' });
      }

      loggers.adminIptv.info('Syncing M3U provider', { providerId, m3uUrl: provider.m3uUrl });

      // Fetch and parse M3U
      const m3uResult = await m3uParserService.fetchAndParseM3U(provider.m3uUrl);
      totalChannels = m3uResult.totalCount;

      // Optionally fetch XMLTV for EPG data
      let epgMap = new Map<string, { name: string; icon?: string }>();
      if (provider.xmltvUrl) {
        try {
          epgMap = await m3uParserService.fetchXMLTV(provider.xmltvUrl);
        } catch (err) {
          loggers.adminIptv.error('Failed to fetch XMLTV for provider', { providerId, error: err });
        }
      }

      // Log first 5 channels
      loggers.adminIptv.debug('First 5 M3U channels from provider', {
        providerId,
        channels: m3uResult.channels.slice(0, 5).map((ch, i) => ({
          index: i + 1,
          name: ch.name,
          streamId: ch.streamId,
          epgId: ch.epgId || null
        }))
      });

      // Upsert channels
      for (const channel of m3uResult.channels) {
        const hasEpg = !!(channel.epgId && epgMap.has(channel.epgId));
        if (channel.epgId) withEpgCount++;

        // Check if channel exists
        const [existing] = await db
          .select({ id: iptvChannels.id })
          .from(iptvChannels)
          .where(and(
            eq(iptvChannels.providerId, providerId),
            eq(iptvChannels.streamId, channel.streamId)
          ));

        if (existing) {
          // Update existing channel (don't change isEnabled)
          await db
            .update(iptvChannels)
            .set({
              name: channel.name,
              logo: channel.logo || null,
              categoryId: channel.groupTitle || null,
              categoryName: channel.groupTitle || null,
              epgChannelId: channel.epgId || null,
              directStreamUrl: channel.streamUrl, // Store direct URL for M3U
              hasEPG: hasEpg,
              lastSeen: new Date(),
            })
            .where(eq(iptvChannels.id, existing.id));
          updateCount++;
        } else {
          // Insert new channel (disabled by default)
          await db
            .insert(iptvChannels)
            .values({
              providerId,
              streamId: channel.streamId,
              name: channel.name,
              logo: channel.logo || null,
              categoryId: channel.groupTitle || null,
              categoryName: channel.groupTitle || null,
              epgChannelId: channel.epgId || null,
              directStreamUrl: channel.streamUrl, // Store direct URL for M3U
              isEnabled: false,
              quality: 'unknown',
              hasEPG: hasEpg,
              lastSeen: new Date(),
            });
          insertCount++;
        }
      }
    } else {
      // Handle Xtream providers (original logic)
      // Get first active credential for this provider
      const [credential] = await db
        .select()
        .from(iptvCredentials)
        .where(and(
          eq(iptvCredentials.providerId, providerId),
          eq(iptvCredentials.isActive, true)
        ))
        .limit(1);

      if (!credential) {
        return res.status(400).json({ error: 'No active credentials found for this provider' });
      }

      if (!provider.serverUrl) {
        return res.status(400).json({ error: 'Server URL not configured for this provider' });
      }

      // Create client to fetch channels
      const client = new XtreamCodesClient({
        serverUrl: decrypt(provider.serverUrl),
        username: decrypt(credential.username),
        password: decrypt(credential.password),
        credentialId: credential.id,
      });

      // Fetch live streams (channels)
      const liveStreams = await client.getRawLiveStreams();

      if (!Array.isArray(liveStreams)) {
        return res.status(400).json({ error: 'Failed to fetch channels from provider' });
      }

      totalChannels = liveStreams.length;

      // Log first 5 streams
      loggers.adminIptv.debug('First 5 streams from provider', {
        providerId,
        streams: liveStreams.slice(0, 5).map((s: any, i: number) => ({
          index: i + 1,
          name: s.name,
          streamId: s.stream_id,
          epgChannelId: s.epg_channel_id || null
        }))
      });

      for (const stream of liveStreams) {
        if (stream.epg_channel_id) withEpgCount++;
        const streamId = String(stream.stream_id);

        // Check if channel exists
        const [existing] = await db
          .select({ id: iptvChannels.id })
          .from(iptvChannels)
          .where(and(
            eq(iptvChannels.providerId, providerId),
            eq(iptvChannels.streamId, streamId)
          ));

        if (existing) {
          // Update existing channel
          await db
            .update(iptvChannels)
            .set({
              name: stream.name || `Channel ${streamId}`,
              logo: stream.stream_icon || null,
              categoryId: stream.category_id ? String(stream.category_id) : null,
              categoryName: stream.category_name || null,
              epgChannelId: stream.epg_channel_id || null,
              hasEPG: stream.epg_channel_id ? true : false,
              lastSeen: new Date(),
            })
            .where(eq(iptvChannels.id, existing.id));
          updateCount++;
        } else {
          // Insert new channel
          await db
            .insert(iptvChannels)
            .values({
              providerId,
              streamId,
              name: stream.name || `Channel ${streamId}`,
              logo: stream.stream_icon || null,
              categoryId: stream.category_id ? String(stream.category_id) : null,
              categoryName: stream.category_name || null,
              epgChannelId: stream.epg_channel_id || null,
              isEnabled: false,
              quality: 'unknown',
              hasEPG: stream.epg_channel_id ? true : false,
              lastSeen: new Date(),
            });
          insertCount++;
        }
      }
    }

    // Update provider's last sync time
    await db
      .update(iptvProviders)
      .set({ lastChannelSync: new Date(), updatedAt: new Date() })
      .where(eq(iptvProviders.id, providerId));

    loggers.adminIptv.info('Channel sync completed', { providerId, totalChannels, channelsWithEpg: withEpgCount });

    res.json({
      success: true,
      totalChannels,
      newChannels: insertCount,
      updatedChannels: updateCount,
      channelsWithEpg: withEpgCount,
    });
  } catch (error) {
    loggers.adminIptv.error('Error syncing channels from provider', { error });
    res.status(500).json({ error: 'Failed to sync channels from provider' });
  }
});

// ============================================
// Channel Management Endpoints
// ============================================

/**
 * GET /api/admin/iptv-channels
 * Get channels for a provider with filtering
 */
router.get('/iptv-channels', requireSuperAdmin, async (req, res) => {
  try {
    const providerId = parseInt(req.query.providerId as string);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: 'Provider ID is required' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;
    const search = (req.query.search as string) || '';
    const category = (req.query.category as string) || '';
    const enabled = req.query.enabled as string;

    // Build where conditions
    const conditions = [eq(iptvChannels.providerId, providerId)];

    if (search) {
      conditions.push(sql`LOWER(${iptvChannels.name}) LIKE ${`%${search.toLowerCase()}%`}`);
    }

    if (category) {
      conditions.push(eq(iptvChannels.categoryName, category));
    }

    if (enabled === 'true') {
      conditions.push(eq(iptvChannels.isEnabled, true));
    } else if (enabled === 'false') {
      conditions.push(eq(iptvChannels.isEnabled, false));
    }

    // Get total count
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(iptvChannels)
      .where(and(...conditions));

    // Get channels
    const channels = await db
      .select()
      .from(iptvChannels)
      .where(and(...conditions))
      .orderBy(iptvChannels.name)
      .limit(limit)
      .offset(offset);

    // Convert local logo URLs to proxy URLs
    const channelsWithProxiedLogos = channels.map(ch => ({
      ...ch,
      logo: convertLogoToProxy(ch.logo),
    }));

    res.json({
      channels: channelsWithProxiedLogos,
      pagination: {
        page,
        limit,
        total: Number(totalResult?.count) || 0,
        totalPages: Math.ceil((Number(totalResult?.count) || 0) / limit),
      },
    });
  } catch (error) {
    loggers.adminIptv.error('Error fetching channels', { error });
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

/**
 * GET /api/admin/iptv-channels/categories
 * Get categories with counts for a provider
 */
router.get('/iptv-channels/categories', requireSuperAdmin, async (req, res) => {
  try {
    const providerId = parseInt(req.query.providerId as string);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: 'Provider ID is required' });
    }

    const categories = await db
      .select({
        categoryName: iptvChannels.categoryName,
        count: sql<number>`count(*)::int`,
        enabledCount: sql<number>`SUM(CASE WHEN ${iptvChannels.isEnabled} THEN 1 ELSE 0 END)::int`,
      })
      .from(iptvChannels)
      .where(eq(iptvChannels.providerId, providerId))
      .groupBy(iptvChannels.categoryName)
      .orderBy(iptvChannels.categoryName);

    res.json(categories);
  } catch (error) {
    loggers.adminIptv.error('Error fetching categories', { error });
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * PUT /api/admin/iptv-channels/bulk
 * Bulk update channels (enable/disable)
 * NOTE: This route MUST be defined BEFORE /iptv-channels/:id to avoid "bulk" being matched as an ID
 */
router.put('/iptv-channels/bulk', requireSuperAdmin, async (req, res) => {
  try {
    loggers.adminIptv.debug('Bulk update request', { body: req.body });
    const validatedData = bulkUpdateChannelsSchema.parse(req.body);
    loggers.adminIptv.debug('Bulk update validated', { channelCount: validatedData.channelIds.length, isEnabled: validatedData.isEnabled });

    if (validatedData.channelIds.length === 0) {
      return res.status(400).json({ error: 'No channels selected' });
    }

    const result = await db
      .update(iptvChannels)
      .set({ isEnabled: validatedData.isEnabled })
      .where(inArray(iptvChannels.id, validatedData.channelIds))
      .returning({ id: iptvChannels.id });

    loggers.adminIptv.info('Bulk updated channels', { updatedCount: result.length });
    res.json({ success: true, updated: result.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      loggers.adminIptv.warn('Bulk update validation error', { errors: error.errors });
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error bulk updating channels', { error });
    res.status(500).json({ error: 'Failed to bulk update channels' });
  }
});

/**
 * PUT /api/admin/iptv-channels/bulk-category
 * Bulk enable/disable all channels in a category
 * NOTE: This route MUST be defined BEFORE /iptv-channels/:id to avoid "bulk-category" being matched as an ID
 */
router.put('/iptv-channels/bulk-category', requireSuperAdmin, async (req, res) => {
  try {
    const { providerId, categoryName, isEnabled } = z.object({
      providerId: z.number().int().positive(),
      categoryName: z.string(),
      isEnabled: z.boolean(),
    }).parse(req.body);

    const result = await db
      .update(iptvChannels)
      .set({ isEnabled })
      .where(and(
        eq(iptvChannels.providerId, providerId),
        eq(iptvChannels.categoryName, categoryName)
      ))
      .returning({ id: iptvChannels.id });

    res.json({ success: true, updated: result.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error bulk updating category', { error });
    res.status(500).json({ error: 'Failed to bulk update category' });
  }
});

/**
 * PUT /api/admin/iptv-channels/:id
 * Update a single channel
 */
router.put('/iptv-channels/:id', requireSuperAdmin, async (req, res) => {
  try {
    const channelId = parseInt(req.params.id);
    if (isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const validatedData = updateChannelSchema.parse(req.body);

    const updateData: any = {};
    if (validatedData.isEnabled !== undefined) {
      updateData.isEnabled = validatedData.isEnabled;
    }
    if (validatedData.quality !== undefined) {
      updateData.quality = validatedData.quality;
    }
    // Handle customLogo - can be a URL string or null to remove
    if ('customLogo' in validatedData) {
      updateData.customLogo = validatedData.customLogo;
    }

    const [updated] = await db
      .update(iptvChannels)
      .set(updateData)
      .where(eq(iptvChannels.id, channelId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error updating channel', { error });
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

// ============================================
// Channel Package Management Endpoints
// ============================================

/**
 * GET /api/admin/channel-packages
 * List all channel packages
 */
router.get('/channel-packages', requireSuperAdmin, async (req, res) => {
  try {
    const packages = await db
      .select()
      .from(channelPackages)
      .orderBy(desc(channelPackages.createdAt));

    const packagesWithStats = await Promise.all(
      packages.map(async (pkg) => {
        // Count channels in package
        const [channelCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(packageChannels)
          .where(eq(packageChannels.packageId, pkg.id));

        // Get provider name
        const [provider] = await db
          .select({ name: iptvProviders.name })
          .from(iptvProviders)
          .where(eq(iptvProviders.id, pkg.providerId));

        return {
          ...pkg,
          channelCount: Number(channelCount?.count) || 0,
          providerName: provider?.name || 'Unknown',
        };
      })
    );

    res.json(packagesWithStats);
  } catch (error) {
    loggers.adminIptv.error('Error fetching channel packages', { error });
    res.status(500).json({ error: 'Failed to fetch channel packages' });
  }
});

/**
 * GET /api/admin/channel-packages/:id
 * Get a single package with its channels
 */
router.get('/channel-packages/:id', requireSuperAdmin, async (req, res) => {
  try {
    const packageId = parseInt(req.params.id);
    if (isNaN(packageId)) {
      return res.status(400).json({ error: 'Invalid package ID' });
    }

    const [pkg] = await db
      .select()
      .from(channelPackages)
      .where(eq(channelPackages.id, packageId));

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Get channels in this package
    const channels = await db
      .select({
        id: iptvChannels.id,
        streamId: iptvChannels.streamId,
        name: iptvChannels.name,
        logo: iptvChannels.logo,
        categoryName: iptvChannels.categoryName,
        quality: iptvChannels.quality,
        isEnabled: iptvChannels.isEnabled,
        sortOrder: packageChannels.sortOrder,
      })
      .from(packageChannels)
      .innerJoin(iptvChannels, eq(packageChannels.channelId, iptvChannels.id))
      .where(eq(packageChannels.packageId, packageId))
      .orderBy(packageChannels.sortOrder, iptvChannels.name);

    // Convert local logo URLs to proxy URLs
    const channelsWithProxiedLogos = channels.map(ch => ({
      ...ch,
      logo: convertLogoToProxy(ch.logo),
    }));

    res.json({
      ...pkg,
      channels: channelsWithProxiedLogos,
    });
  } catch (error) {
    loggers.adminIptv.error('Error fetching channel package', { error });
    res.status(500).json({ error: 'Failed to fetch channel package' });
  }
});

/**
 * POST /api/admin/channel-packages
 * Create a new channel package
 */
router.post('/channel-packages', requireSuperAdmin, async (req, res) => {
  try {
    const validatedData = createPackageSchema.parse(req.body);

    // Verify provider exists
    const [provider] = await db
      .select()
      .from(iptvProviders)
      .where(eq(iptvProviders.id, validatedData.providerId));

    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    const [newPackage] = await db
      .insert(channelPackages)
      .values({
        providerId: validatedData.providerId,
        name: validatedData.name,
        description: validatedData.description || null,
        isActive: validatedData.isActive,
      })
      .returning();

    res.status(201).json(newPackage);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error creating channel package', { error });
    res.status(500).json({ error: 'Failed to create channel package' });
  }
});

/**
 * PUT /api/admin/channel-packages/:id
 * Update a channel package
 * Also supports POST for Cloudflare compatibility
 */
router.put('/channel-packages/:id', requireSuperAdmin, async (req, res) => {
  loggers.adminIptv.debug('PUT /channel-packages/:id called', { id: req.params.id, body: req.body });
  handleUpdatePackage(req, res);
});

router.post('/channel-packages/:id/update', requireSuperAdmin, async (req, res) => {
  loggers.adminIptv.debug('POST /channel-packages/:id/update called', { id: req.params.id, body: req.body });
  handleUpdatePackage(req, res);
});

async function handleUpdatePackage(req: any, res: any) {
  try {
    const packageId = parseInt(req.params.id);
    if (isNaN(packageId)) {
      return res.status(400).json({ error: 'Invalid package ID' });
    }

    const validatedData = updatePackageSchema.parse(req.body);

    const updateData: any = { updatedAt: new Date() };
    if (validatedData.name !== undefined) {
      updateData.name = validatedData.name;
    }
    if (validatedData.description !== undefined) {
      updateData.description = validatedData.description;
    }
    if (validatedData.isActive !== undefined) {
      updateData.isActive = validatedData.isActive;
    }

    const [updated] = await db
      .update(channelPackages)
      .set(updateData)
      .where(eq(channelPackages.id, packageId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Package not found' });
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error updating channel package', { error });
    res.status(500).json({ error: 'Failed to update channel package' });
  }
}

/**
 * DELETE /api/admin/channel-packages/:id
 * Delete a channel package
 */
router.delete('/channel-packages/:id', requireSuperAdmin, async (req, res) => {
  try {
    const packageId = parseInt(req.params.id);
    if (isNaN(packageId)) {
      return res.status(400).json({ error: 'Invalid package ID' });
    }

    const result = await db
      .delete(channelPackages)
      .where(eq(channelPackages.id, packageId))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Package not found' });
    }

    res.json({ success: true });
  } catch (error) {
    loggers.adminIptv.error('Error deleting channel package', { error });
    res.status(500).json({ error: 'Failed to delete channel package' });
  }
});

/**
 * POST /api/admin/channel-packages/:id/channels
 * Add channels to a package
 */
router.post('/channel-packages/:id/channels', requireSuperAdmin, async (req, res) => {
  try {
    const packageId = parseInt(req.params.id);
    if (isNaN(packageId)) {
      return res.status(400).json({ error: 'Invalid package ID' });
    }

    const { channelIds } = z.object({
      channelIds: z.array(z.number().int().positive()),
    }).parse(req.body);

    // Verify package exists
    const [pkg] = await db
      .select()
      .from(channelPackages)
      .where(eq(channelPackages.id, packageId));

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Get existing channel IDs in package
    const existing = await db
      .select({ channelId: packageChannels.channelId })
      .from(packageChannels)
      .where(eq(packageChannels.packageId, packageId));

    const existingIds = new Set(existing.map(e => e.channelId));

    // Filter out already added channels and verify they belong to same provider
    const newChannelIds = channelIds.filter(id => !existingIds.has(id));

    if (newChannelIds.length === 0) {
      return res.json({ success: true, added: 0 });
    }

    // Verify channels belong to same provider as package
    const validChannels = await db
      .select({ id: iptvChannels.id })
      .from(iptvChannels)
      .where(and(
        inArray(iptvChannels.id, newChannelIds),
        eq(iptvChannels.providerId, pkg.providerId),
        eq(iptvChannels.isEnabled, true)
      ));

    const validIds = validChannels.map(c => c.id);

    if (validIds.length === 0) {
      return res.status(400).json({ error: 'No valid enabled channels to add' });
    }

    // Get max sort order
    const [maxSort] = await db
      .select({ max: sql<number>`COALESCE(MAX(${packageChannels.sortOrder}), 0)::int` })
      .from(packageChannels)
      .where(eq(packageChannels.packageId, packageId));

    let sortOrder = (maxSort?.max || 0) + 1;

    // Insert new channels
    await db.insert(packageChannels).values(
      validIds.map(channelId => ({
        packageId,
        channelId,
        sortOrder: sortOrder++,
      }))
    );

    // Clear user channel cache so changes appear immediately
    await xtreamCodesService.forceRefreshCache();
    loggers.adminIptv.info('Added channels to package', { packageId, addedCount: validIds.length });

    res.json({ success: true, added: validIds.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error adding channels to package', { error });
    res.status(500).json({ error: 'Failed to add channels to package' });
  }
});

/**
 * POST /api/admin/channel-packages/:id/remove-channels
 * Bulk remove channels from a package
 */
router.post('/channel-packages/:id/remove-channels', requireSuperAdmin, async (req, res) => {
  try {
    const packageId = parseInt(req.params.id);
    if (isNaN(packageId)) {
      return res.status(400).json({ error: 'Invalid package ID' });
    }

    const { channelIds } = z.object({
      channelIds: z.array(z.number().int().positive()),
    }).parse(req.body);

    if (channelIds.length === 0) {
      return res.json({ success: true, removed: 0 });
    }

    const result = await db
      .delete(packageChannels)
      .where(and(
        eq(packageChannels.packageId, packageId),
        inArray(packageChannels.channelId, channelIds)
      ))
      .returning();

    // Clear user channel cache so changes appear immediately
    await xtreamCodesService.forceRefreshCache();
    loggers.adminIptv.info('Bulk removed channels from package', { packageId, removedCount: result.length });
    res.json({ success: true, removed: result.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error bulk removing channels', { error });
    res.status(500).json({ error: 'Failed to remove channels' });
  }
});

/**
 * DELETE /api/admin/channel-packages/:packageId/channels/:channelId
 * Remove a channel from a package
 */
router.delete('/channel-packages/:packageId/channels/:channelId', requireSuperAdmin, async (req, res) => {
  try {
    const packageId = parseInt(req.params.packageId);
    const channelId = parseInt(req.params.channelId);

    if (isNaN(packageId) || isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid IDs' });
    }

    const result = await db
      .delete(packageChannels)
      .where(and(
        eq(packageChannels.packageId, packageId),
        eq(packageChannels.channelId, channelId)
      ))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Channel not in package' });
    }

    // Clear user channel cache so changes appear immediately
    await xtreamCodesService.forceRefreshCache();

    res.json({ success: true });
  } catch (error) {
    loggers.adminIptv.error('Error removing channel from package', { error });
    res.status(500).json({ error: 'Failed to remove channel from package' });
  }
});

// ============================================
// Plan-Package Assignment Endpoints
// ============================================

/**
 * GET /api/admin/subscription-plans/:id/packages
 * Get packages assigned to a plan
 */
router.get('/subscription-plans/:id/packages', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const packages = await db
      .select({
        id: planPackages.id,
        packageId: planPackages.packageId,
        packageName: channelPackages.name,
        providerId: channelPackages.providerId,
        isActive: channelPackages.isActive,
        createdAt: planPackages.createdAt,
      })
      .from(planPackages)
      .innerJoin(channelPackages, eq(planPackages.packageId, channelPackages.id))
      .where(eq(planPackages.planId, planId));

    // Add channel counts
    const packagesWithCounts = await Promise.all(
      packages.map(async (pkg) => {
        const [count] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(packageChannels)
          .where(eq(packageChannels.packageId, pkg.packageId));

        return {
          ...pkg,
          channelCount: Number(count?.count) || 0,
        };
      })
    );

    res.json(packagesWithCounts);
  } catch (error) {
    loggers.adminIptv.error('Error fetching plan packages', { error });
    res.status(500).json({ error: 'Failed to fetch plan packages' });
  }
});

/**
 * POST /api/admin/subscription-plans/:id/packages
 * Assign a package to a plan
 */
router.post('/subscription-plans/:id/packages', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const { packageId } = z.object({
      packageId: z.number().int().positive(),
    }).parse(req.body);

    // Verify plan exists
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId));

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Verify package exists
    const [pkg] = await db
      .select()
      .from(channelPackages)
      .where(eq(channelPackages.id, packageId));

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Check if already assigned
    const [existing] = await db
      .select()
      .from(planPackages)
      .where(and(
        eq(planPackages.planId, planId),
        eq(planPackages.packageId, packageId)
      ));

    if (existing) {
      return res.status(400).json({ error: 'Package already assigned to this plan' });
    }

    // Create assignment
    const [assignment] = await db
      .insert(planPackages)
      .values({ planId, packageId })
      .returning();

    res.status(201).json({
      ...assignment,
      packageName: pkg.name,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error assigning package to plan', { error });
    res.status(500).json({ error: 'Failed to assign package to plan' });
  }
});

/**
 * DELETE /api/admin/subscription-plans/:planId/packages/:packageId
 * Remove a package from a plan
 */
router.delete('/subscription-plans/:planId/packages/:packageId', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    const packageId = parseInt(req.params.packageId);

    if (isNaN(planId) || isNaN(packageId)) {
      return res.status(400).json({ error: 'Invalid IDs' });
    }

    const result = await db
      .delete(planPackages)
      .where(and(
        eq(planPackages.planId, planId),
        eq(planPackages.packageId, packageId)
      ))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ success: true });
  } catch (error) {
    loggers.adminIptv.error('Error removing package from plan', { error });
    res.status(500).json({ error: 'Failed to remove package from plan' });
  }
});

// ============================================
// Legacy Credential Endpoints (for backward compatibility)
// ============================================

/**
 * GET /api/admin/iptv-credentials
 * List all IPTV credentials (passwords masked)
 */
router.get('/iptv-credentials', requireSuperAdmin, async (req, res) => {
  try {
    const credentials = await db
      .select()
      .from(iptvCredentials)
      .orderBy(desc(iptvCredentials.createdAt));

    // Mask sensitive data and add active stream count
    const credentialsWithStats = await Promise.all(
      credentials.map(async (cred) => {
        const activeStreams = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(activeIptvStreams)
          .where(eq(activeIptvStreams.credentialId, cred.id));

        return {
          id: cred.id,
          providerId: cred.providerId,
          name: cred.name,
          serverUrl: cred.serverUrl ? maskCredential(decrypt(cred.serverUrl)) : null,
          username: maskCredential(decrypt(cred.username)),
          maxConnections: cred.maxConnections,
          isActive: cred.isActive,
          notes: cred.notes,
          healthStatus: cred.healthStatus,
          lastHealthCheck: cred.lastHealthCheck,
          activeStreams: Number(activeStreams[0]?.count) || 0,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
        };
      })
    );

    res.json(credentialsWithStats);
  } catch (error) {
    loggers.adminIptv.error('Error fetching IPTV credentials', { error });
    res.status(500).json({ error: 'Failed to fetch IPTV credentials' });
  }
});

/**
 * GET /api/admin/iptv-credentials/:id
 * Get a single IPTV credential (with full server URL for editing)
 */
router.get('/iptv-credentials/:id', requireSuperAdmin, async (req, res) => {
  try {
    const credentialId = parseInt(req.params.id);
    if (isNaN(credentialId)) {
      return res.status(400).json({ error: 'Invalid credential ID' });
    }

    const [credential] = await db
      .select()
      .from(iptvCredentials)
      .where(eq(iptvCredentials.id, credentialId));

    if (!credential) {
      return res.status(404).json({ error: 'Credential not found' });
    }

    // Return with decrypted server URL and username (for edit form)
    // Password is never returned
    res.json({
      id: credential.id,
      providerId: credential.providerId,
      name: credential.name,
      serverUrl: credential.serverUrl ? decrypt(credential.serverUrl) : null,
      username: decrypt(credential.username),
      maxConnections: credential.maxConnections,
      isActive: credential.isActive,
      notes: credential.notes,
      healthStatus: credential.healthStatus,
      lastHealthCheck: credential.lastHealthCheck,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    });
  } catch (error) {
    loggers.adminIptv.error('Error fetching IPTV credential', { error });
    res.status(500).json({ error: 'Failed to fetch IPTV credential' });
  }
});

/**
 * POST /api/admin/iptv-credentials
 * Create a new IPTV credential
 */
router.post('/iptv-credentials', requireSuperAdmin, async (req, res) => {
  try {
    const validatedData = createCredentialSchema.parse(req.body);

    // Encrypt sensitive fields
    const [newCredential] = await db
      .insert(iptvCredentials)
      .values({
        name: validatedData.name,
        serverUrl: encrypt(validatedData.serverUrl),
        username: encrypt(validatedData.username),
        password: encrypt(validatedData.password),
        maxConnections: validatedData.maxConnections,
        notes: validatedData.notes || null,
        isActive: validatedData.isActive,
        healthStatus: 'unknown',
      })
      .returning();

    // Reload credential in manager
    await xtreamCodesManager.reloadCredential(newCredential.id);

    res.status(201).json({
      id: newCredential.id,
      name: newCredential.name,
      maxConnections: newCredential.maxConnections,
      isActive: newCredential.isActive,
      notes: newCredential.notes,
      healthStatus: newCredential.healthStatus,
      createdAt: newCredential.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error creating IPTV credential', { error });
    res.status(500).json({ error: 'Failed to create IPTV credential' });
  }
});

/**
 * PUT /api/admin/iptv-credentials/:id
 * Update an IPTV credential
 */
router.put('/iptv-credentials/:id', requireSuperAdmin, async (req, res) => {
  try {
    const credentialId = parseInt(req.params.id);
    if (isNaN(credentialId)) {
      return res.status(400).json({ error: 'Invalid credential ID' });
    }

    const validatedData = updateCredentialSchema.parse(req.body);

    // Build update object with encrypted fields
    const updateData: any = { updatedAt: new Date() };

    if (validatedData.name !== undefined) {
      updateData.name = validatedData.name;
    }
    if (validatedData.serverUrl !== undefined) {
      updateData.serverUrl = encrypt(validatedData.serverUrl);
    }
    if (validatedData.username !== undefined) {
      updateData.username = encrypt(validatedData.username);
    }
    if (validatedData.password) {
      // Only update password if provided (non-empty)
      updateData.password = encrypt(validatedData.password);
    }
    if (validatedData.maxConnections !== undefined) {
      updateData.maxConnections = validatedData.maxConnections;
    }
    if (validatedData.notes !== undefined) {
      updateData.notes = validatedData.notes;
    }
    if (validatedData.isActive !== undefined) {
      updateData.isActive = validatedData.isActive;
    }

    const [updatedCredential] = await db
      .update(iptvCredentials)
      .set(updateData)
      .where(eq(iptvCredentials.id, credentialId))
      .returning();

    if (!updatedCredential) {
      return res.status(404).json({ error: 'Credential not found' });
    }

    // Reload credential in manager
    await xtreamCodesManager.reloadCredential(credentialId);

    res.json({
      id: updatedCredential.id,
      name: updatedCredential.name,
      maxConnections: updatedCredential.maxConnections,
      isActive: updatedCredential.isActive,
      notes: updatedCredential.notes,
      healthStatus: updatedCredential.healthStatus,
      updatedAt: updatedCredential.updatedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error updating IPTV credential', { error });
    res.status(500).json({ error: 'Failed to update IPTV credential' });
  }
});

/**
 * DELETE /api/admin/iptv-credentials/:id
 * Delete an IPTV credential
 */
router.delete('/iptv-credentials/:id', requireSuperAdmin, async (req, res) => {
  try {
    const credentialId = parseInt(req.params.id);
    if (isNaN(credentialId)) {
      return res.status(400).json({ error: 'Invalid credential ID' });
    }

    // Release any active streams for this credential
    await streamTrackerService.releaseAllCredentialStreams(credentialId);

    // Delete from database (cascade will handle junction table)
    const result = await db
      .delete(iptvCredentials)
      .where(eq(iptvCredentials.id, credentialId))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Credential not found' });
    }

    // Remove from manager
    xtreamCodesManager.removeCredential(credentialId);

    res.json({ success: true });
  } catch (error) {
    loggers.adminIptv.error('Error deleting IPTV credential', { error });
    res.status(500).json({ error: 'Failed to delete IPTV credential' });
  }
});

/**
 * POST /api/admin/iptv-credentials/:id/test
 * Test connection to IPTV server
 */
router.post('/iptv-credentials/:id/test', requireSuperAdmin, async (req, res) => {
  try {
    const credentialId = parseInt(req.params.id);
    if (isNaN(credentialId)) {
      return res.status(400).json({ error: 'Invalid credential ID' });
    }

    const [credential] = await db
      .select()
      .from(iptvCredentials)
      .where(eq(iptvCredentials.id, credentialId));

    if (!credential) {
      return res.status(404).json({ error: 'Credential not found' });
    }

    // Get server URL from credential (legacy) or provider (new system)
    let serverUrl: string;
    if (credential.serverUrl) {
      serverUrl = decrypt(credential.serverUrl);
    } else if (credential.providerId) {
      const [provider] = await db
        .select()
        .from(iptvProviders)
        .where(eq(iptvProviders.id, credential.providerId));
      if (!provider) {
        return res.status(400).json({ error: 'Provider not found for credential' });
      }
      if (!provider.serverUrl) {
        return res.status(400).json({ error: 'M3U providers do not support credential testing' });
      }
      serverUrl = decrypt(provider.serverUrl);
    } else {
      return res.status(400).json({ error: 'No server URL available for credential' });
    }

    // Create a temporary client to test
    const client = new XtreamCodesClient({
      serverUrl,
      username: decrypt(credential.username),
      password: decrypt(credential.password),
      credentialId: credential.id,
    });

    try {
      const authInfo = await client.authenticate();
      const healthy = authInfo.user_info.status === 'Active';

      // Update health status
      await db
        .update(iptvCredentials)
        .set({
          healthStatus: healthy ? 'healthy' : 'unhealthy',
          lastHealthCheck: new Date(),
        })
        .where(eq(iptvCredentials.id, credentialId));

      res.json({
        success: healthy,
        status: authInfo.user_info.status,
        expiration: authInfo.user_info.exp_date
          ? new Date(authInfo.user_info.exp_date * 1000).toISOString()
          : null,
        maxConnections: authInfo.user_info.max_connections || null,
        activeConnections: authInfo.user_info.active_cons || null,
      });
    } catch (testError) {
      // Update health status to unhealthy
      await db
        .update(iptvCredentials)
        .set({
          healthStatus: 'unhealthy',
          lastHealthCheck: new Date(),
        })
        .where(eq(iptvCredentials.id, credentialId));

      res.json({
        success: false,
        error: 'Connection failed',
      });
    }
  } catch (error) {
    loggers.adminIptv.error('Error testing IPTV credential', { error });
    res.status(500).json({ error: 'Failed to test IPTV credential' });
  }
});

/**
 * GET /api/admin/iptv-credentials/:id/streams
 * Get active streams for a credential
 */
router.get('/iptv-credentials/:id/streams', requireSuperAdmin, async (req, res) => {
  try {
    const credentialId = parseInt(req.params.id);
    if (isNaN(credentialId)) {
      return res.status(400).json({ error: 'Invalid credential ID' });
    }

    const streams = await streamTrackerService.getActiveStreamsForCredential(credentialId);
    const capacity = await streamTrackerService.getCredentialCapacity(credentialId);

    res.json({
      streams,
      capacity,
    });
  } catch (error) {
    loggers.adminIptv.error('Error fetching credential streams', { error });
    res.status(500).json({ error: 'Failed to fetch credential streams' });
  }
});

/**
 * POST /api/admin/iptv-credentials/:id/disconnect-all
 * Disconnect all active streams for a credential
 */
router.post('/iptv-credentials/:id/disconnect-all', requireSuperAdmin, async (req, res) => {
  try {
    const credentialId = parseInt(req.params.id);
    if (isNaN(credentialId)) {
      return res.status(400).json({ error: 'Invalid credential ID' });
    }

    const count = await streamTrackerService.releaseAllCredentialStreams(credentialId);

    res.json({ success: true, disconnected: count });
  } catch (error) {
    loggers.adminIptv.error('Error disconnecting streams', { error });
    res.status(500).json({ error: 'Failed to disconnect streams' });
  }
});

/**
 * POST /api/admin/iptv-credentials/cleanup-stale
 * Clean up all stale streams across all credentials
 */
router.post('/iptv-credentials/cleanup-stale', requireSuperAdmin, async (req, res) => {
  try {
    const count = await streamTrackerService.cleanupStaleStreams();
    res.json({ success: true, cleaned: count });
  } catch (error) {
    loggers.adminIptv.error('Error cleaning up stale streams', { error });
    res.status(500).json({ error: 'Failed to cleanup stale streams' });
  }
});

/**
 * POST /api/admin/iptv-credentials/clear-all-streams
 * Force clear ALL active streams (use with caution)
 */
router.post('/iptv-credentials/clear-all-streams', requireSuperAdmin, async (req, res) => {
  try {
    const result = await db.delete(activeIptvStreams).returning();
    loggers.adminIptv.info('Force cleared all streams', { clearedCount: result.length });
    res.json({ success: true, cleared: result.length });
  } catch (error) {
    loggers.adminIptv.error('Error clearing all streams', { error });
    res.status(500).json({ error: 'Failed to clear streams' });
  }
});

/**
 * GET /api/admin/iptv-credentials/all-streams
 * Get all active streams with details for debugging
 */
router.get('/iptv-credentials/all-streams', requireSuperAdmin, async (req, res) => {
  try {
    const streams = await streamTrackerService.getAllActiveStreams();
    res.json(streams);
  } catch (error) {
    loggers.adminIptv.error('Error fetching all streams', { error });
    res.status(500).json({ error: 'Failed to fetch streams' });
  }
});

// ============================================
// Plan-Credential Assignment Endpoints
// ============================================

/**
 * GET /api/admin/subscription-plans/:id/iptv-credentials
 * Get IPTV credentials assigned to a plan
 */
router.get('/subscription-plans/:id/iptv-credentials', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const assignments = await db
      .select({
        id: planIptvCredentials.id,
        credentialId: planIptvCredentials.credentialId,
        priority: planIptvCredentials.priority,
        credentialName: iptvCredentials.name,
        isActive: iptvCredentials.isActive,
        maxConnections: iptvCredentials.maxConnections,
        healthStatus: iptvCredentials.healthStatus,
      })
      .from(planIptvCredentials)
      .innerJoin(iptvCredentials, eq(planIptvCredentials.credentialId, iptvCredentials.id))
      .where(eq(planIptvCredentials.planId, planId))
      .orderBy(planIptvCredentials.priority);

    res.json(assignments);
  } catch (error) {
    loggers.adminIptv.error('Error fetching plan credentials', { error });
    res.status(500).json({ error: 'Failed to fetch plan credentials' });
  }
});

/**
 * POST /api/admin/subscription-plans/:id/iptv-credentials
 * Assign an IPTV credential to a plan
 */
router.post('/subscription-plans/:id/iptv-credentials', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const validatedData = assignCredentialSchema.parse(req.body);

    // Check if plan exists
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId));

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Check if credential exists
    const [credential] = await db
      .select()
      .from(iptvCredentials)
      .where(eq(iptvCredentials.id, validatedData.credentialId));

    if (!credential) {
      return res.status(404).json({ error: 'Credential not found' });
    }

    // Check if already assigned
    const [existing] = await db
      .select()
      .from(planIptvCredentials)
      .where(and(
        eq(planIptvCredentials.planId, planId),
        eq(planIptvCredentials.credentialId, validatedData.credentialId)
      ));

    if (existing) {
      return res.status(400).json({ error: 'Credential already assigned to this plan' });
    }

    // Create assignment
    const [assignment] = await db
      .insert(planIptvCredentials)
      .values({
        planId,
        credentialId: validatedData.credentialId,
        priority: validatedData.priority,
      })
      .returning();

    res.status(201).json({
      id: assignment.id,
      credentialId: assignment.credentialId,
      priority: assignment.priority,
      credentialName: credential.name,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error assigning credential to plan', { error });
    res.status(500).json({ error: 'Failed to assign credential to plan' });
  }
});

/**
 * PUT /api/admin/subscription-plans/:planId/iptv-credentials/:credId
 * Update priority of a plan-credential assignment
 */
router.put('/subscription-plans/:planId/iptv-credentials/:credId', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    const credentialId = parseInt(req.params.credId);

    if (isNaN(planId) || isNaN(credentialId)) {
      return res.status(400).json({ error: 'Invalid IDs' });
    }

    const { priority } = z.object({ priority: z.number().int().min(0) }).parse(req.body);

    const [updated] = await db
      .update(planIptvCredentials)
      .set({ priority })
      .where(and(
        eq(planIptvCredentials.planId, planId),
        eq(planIptvCredentials.credentialId, credentialId)
      ))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    loggers.adminIptv.error('Error updating assignment', { error });
    res.status(500).json({ error: 'Failed to update assignment' });
  }
});

/**
 * DELETE /api/admin/subscription-plans/:planId/iptv-credentials/:credId
 * Remove an IPTV credential from a plan
 */
router.delete('/subscription-plans/:planId/iptv-credentials/:credId', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    const credentialId = parseInt(req.params.credId);

    if (isNaN(planId) || isNaN(credentialId)) {
      return res.status(400).json({ error: 'Invalid IDs' });
    }

    const result = await db
      .delete(planIptvCredentials)
      .where(and(
        eq(planIptvCredentials.planId, planId),
        eq(planIptvCredentials.credentialId, credentialId)
      ))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ success: true });
  } catch (error) {
    loggers.adminIptv.error('Error removing credential from plan', { error });
    res.status(500).json({ error: 'Failed to remove credential from plan' });
  }
});

/**
 * GET /api/admin/iptv-streams
 * Get all active IPTV streams with detailed info
 */
router.get('/iptv-streams', requireSuperAdmin, async (req, res) => {
  try {
    const streams = await streamTrackerService.getAllActiveStreams();

    // Also get credential capacity info
    const capacityInfo = [];
    const credentialIds = [...new Set(streams.map(s => s.credentialId).filter((id): id is number => id !== null))];

    for (const credId of credentialIds) {
      const capacity = await streamTrackerService.getCredentialCapacity(credId);
      if (capacity) {
        capacityInfo.push({ credentialId: credId, ...capacity });
      }
    }

    res.json({
      streams,
      capacityInfo,
      totalActive: streams.length
    });
  } catch (error) {
    loggers.adminIptv.error('Error fetching active streams', { error });
    res.status(500).json({ error: 'Failed to fetch active streams' });
  }
});

/**
 * DELETE /api/admin/iptv-streams
 * Clear all active streams (emergency reset)
 */
router.delete('/iptv-streams', requireSuperAdmin, async (req, res) => {
  try {
    const result = await db.delete(activeIptvStreams).returning();
    loggers.adminIptv.info('Cleared active IPTV streams', { clearedCount: result.length });
    res.json({
      success: true,
      clearedCount: result.length
    });
  } catch (error) {
    loggers.adminIptv.error('Error clearing active streams', { error });
    res.status(500).json({ error: 'Failed to clear active streams' });
  }
});

/**
 * DELETE /api/admin/iptv-streams/:id
 * Delete a specific active stream
 */
router.delete('/iptv-streams/:id', requireSuperAdmin, async (req, res) => {
  try {
    const streamId = parseInt(req.params.id);
    if (isNaN(streamId)) {
      return res.status(400).json({ error: 'Invalid stream ID' });
    }

    const result = await db.delete(activeIptvStreams)
      .where(eq(activeIptvStreams.id, streamId))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    loggers.adminIptv.info('Deleted stream', { streamId });
    res.json({ success: true });
  } catch (error) {
    loggers.adminIptv.error('Error deleting stream', { error });
    res.status(500).json({ error: 'Failed to delete stream' });
  }
});

/**
 * POST /api/admin/iptv-streams/cleanup
 * Force trigger stale stream cleanup
 */
router.post('/iptv-streams/cleanup', requireSuperAdmin, async (req, res) => {
  try {
    const cleanedCount = await streamTrackerService.cleanupStaleStreams();
    res.json({
      success: true,
      cleanedCount
    });
  } catch (error) {
    loggers.adminIptv.error('Error running stream cleanup', { error });
    res.status(500).json({ error: 'Failed to run stream cleanup' });
  }
});

// ============================================================================
// CHANNEL MAPPING ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/channel-mappings
 * List all channel mappings with full channel info
 */
router.get('/channel-mappings', requireSuperAdmin, async (req, res) => {
  try {
    const mappings = await channelMappingService.getAllMappings();
    const stats = await channelMappingService.getMappingStats();

    res.json({
      mappings,
      stats
    });
  } catch (error) {
    loggers.adminIptv.error('Error fetching channel mappings', { error });
    res.status(500).json({ error: 'Failed to fetch channel mappings' });
  }
});

/**
 * POST /api/admin/channel-mappings
 * Create a new channel mapping
 */
router.post('/channel-mappings', requireSuperAdmin, async (req, res) => {
  try {
    const schema = z.object({
      primaryChannelId: z.number(),
      backupChannelId: z.number(),
      priority: z.number().optional()
    });

    const data = schema.parse(req.body);
    const mapping = await channelMappingService.createMapping(
      data.primaryChannelId,
      data.backupChannelId,
      data.priority
    );

    res.json({ mapping });
  } catch (error: any) {
    loggers.adminIptv.error('Error creating channel mapping', { error });
    if (error.message?.includes('different providers') || error.message?.includes('not found')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create channel mapping' });
  }
});

/**
 * PUT /api/admin/channel-mappings/:id
 * Update a mapping's priority or active status
 */
router.put('/channel-mappings/:id', requireSuperAdmin, async (req, res) => {
  try {
    const mappingId = parseInt(req.params.id);
    if (isNaN(mappingId)) {
      return res.status(400).json({ error: 'Invalid mapping ID' });
    }

    const schema = z.object({
      priority: z.number().optional(),
      isActive: z.boolean().optional()
    });

    const data = schema.parse(req.body);
    await channelMappingService.updateMapping(mappingId, data);

    res.json({ success: true });
  } catch (error) {
    loggers.adminIptv.error('Error updating channel mapping', { error });
    res.status(500).json({ error: 'Failed to update channel mapping' });
  }
});

/**
 * DELETE /api/admin/channel-mappings/:id
 * Delete a channel mapping
 */
router.delete('/channel-mappings/:id', requireSuperAdmin, async (req, res) => {
  try {
    const mappingId = parseInt(req.params.id);
    if (isNaN(mappingId)) {
      return res.status(400).json({ error: 'Invalid mapping ID' });
    }

    await channelMappingService.deleteMapping(mappingId);
    res.json({ success: true });
  } catch (error) {
    loggers.adminIptv.error('Error deleting channel mapping', { error });
    res.status(500).json({ error: 'Failed to delete channel mapping' });
  }
});

/**
 * GET /api/admin/channel-mappings/search-primary
 * Search for channels to use as primary channel in mapping
 */
router.get('/channel-mappings/search-primary', requireSuperAdmin, async (req, res) => {
  try {
    const query = (req.query.q as string) || '';

    if (query.length < 2) {
      return res.json([]);
    }

    const searchPattern = `%${query.toLowerCase()}%`;

    const channels = await db.select({
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
        eq(iptvChannels.isEnabled, true),
        eq(iptvProviders.isActive, true),
        sql`LOWER(${iptvChannels.name}) LIKE ${searchPattern}`
      ))
      .orderBy(iptvChannels.name)
      .limit(30);

    res.json(channels);
  } catch (error) {
    loggers.adminIptv.error('Error searching primary channels', { error });
    res.status(500).json({ error: 'Failed to search channels' });
  }
});

/**
 * GET /api/admin/channel-mappings/search
 * Search for potential backup channels from other providers
 */
router.get('/channel-mappings/search', requireSuperAdmin, async (req, res) => {
  try {
    const primaryChannelId = parseInt(req.query.primaryChannelId as string);
    const query = (req.query.q as string) || '';

    if (isNaN(primaryChannelId)) {
      return res.status(400).json({ error: 'primaryChannelId is required' });
    }

    const candidates = await channelMappingService.searchBackupCandidates(
      primaryChannelId,
      query,
      30
    );

    res.json({ candidates });
  } catch (error) {
    loggers.adminIptv.error('Error searching backup candidates', { error });
    res.status(500).json({ error: 'Failed to search backup candidates' });
  }
});

/**
 * POST /api/admin/channel-mappings/suggest
 * Auto-suggest backup channels based on name similarity
 */
router.post('/channel-mappings/suggest', requireSuperAdmin, async (req, res) => {
  try {
    const schema = z.object({
      channelId: z.number(),
      targetProviderId: z.number().optional()
    });

    const { channelId, targetProviderId } = schema.parse(req.body);

    let suggestions;
    if (targetProviderId) {
      // Get suggestions for a specific provider
      suggestions = await channelMappingService.suggestMappingsForProvider(channelId, targetProviderId, 10);
    } else {
      // Get suggestions from all other providers
      suggestions = await channelMappingService.suggestMappings(channelId, 10);
    }

    res.json({ suggestions });
  } catch (error) {
    loggers.adminIptv.error('Error suggesting mappings', { error });
    res.status(500).json({ error: 'Failed to suggest mappings' });
  }
});

/**
 * GET /api/admin/channel-mappings/suggest-for-provider
 * Get backup suggestions for a channel from a specific provider (GET version for easier use)
 */
router.get('/channel-mappings/suggest-for-provider', requireSuperAdmin, async (req, res) => {
  try {
    const channelId = parseInt(req.query.channelId as string);
    const targetProviderId = parseInt(req.query.targetProviderId as string);
    const query = (req.query.q as string) || '';

    if (isNaN(channelId) || isNaN(targetProviderId)) {
      return res.status(400).json({ error: 'channelId and targetProviderId are required' });
    }

    // If there's a search query, search within the target provider (ALL channels, not just enabled)
    if (query.length >= 2) {
      const searchPattern = `%${query.toLowerCase()}%`;

      const channels = await db.select({
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
          sql`LOWER(${iptvChannels.name}) LIKE ${searchPattern}`
        ))
        .orderBy(iptvChannels.name)
        .limit(30);

      // Check which are already mapped
      const existingMappings = await db.select({ backupChannelId: channelMappings.backupChannelId })
        .from(channelMappings)
        .where(eq(channelMappings.primaryChannelId, channelId));
      const mappedIds = new Set(existingMappings.map(m => m.backupChannelId));

      return res.json({
        suggestions: channels.map(c => ({
          channel: c,
          confidence: 100,
          alreadyMapped: mappedIds.has(c.id)
        }))
      });
    }

    // Otherwise, get AI suggestions
    const suggestions = await channelMappingService.suggestMappingsForProvider(channelId, targetProviderId, 10);

    // Check which are already mapped
    const existingMappings = await db.select({ backupChannelId: channelMappings.backupChannelId })
      .from(channelMappings)
      .where(eq(channelMappings.primaryChannelId, channelId));
    const mappedIds = new Set(existingMappings.map(m => m.backupChannelId));

    res.json({
      suggestions: suggestions.map(s => ({
        ...s,
        alreadyMapped: mappedIds.has(s.channel.id)
      }))
    });
  } catch (error) {
    loggers.adminIptv.error('Error suggesting mappings for provider', { error });
    res.status(500).json({ error: 'Failed to suggest mappings' });
  }
});

/**
 * POST /api/admin/channel-mappings/auto-suggest
 * Get auto-mapping suggestions for multiple channels
 */
router.post('/channel-mappings/auto-suggest', requireSuperAdmin, async (req, res) => {
  try {
    const { primaryChannelIds, targetProviderId, minConfidence = 60 } = req.body;

    if (!Array.isArray(primaryChannelIds) || primaryChannelIds.length === 0) {
      return res.status(400).json({ error: 'primaryChannelIds array is required' });
    }

    if (!targetProviderId || isNaN(parseInt(targetProviderId))) {
      return res.status(400).json({ error: 'targetProviderId is required' });
    }

    const suggestions = await channelMappingService.getAutoMappingSuggestions(
      primaryChannelIds.map((id: any) => parseInt(id)),
      parseInt(targetProviderId),
      parseInt(minConfidence)
    );

    // Filter to only show suggestions that have a match
    const withSuggestions = suggestions.filter(s => s.suggestedBackup !== null);
    const alreadyMapped = suggestions.filter(s => s.existingMapping);
    const noMatch = suggestions.filter(s => s.suggestedBackup === null && !s.existingMapping);

    res.json({
      suggestions: withSuggestions,
      alreadyMapped: alreadyMapped.length,
      noMatch: noMatch.length,
      total: suggestions.length,
    });
  } catch (error) {
    loggers.adminIptv.error('Error getting auto-mapping suggestions', { error });
    res.status(500).json({ error: 'Failed to get auto-mapping suggestions' });
  }
});

/**
 * POST /api/admin/channel-mappings/test-failover
 * Test failover configuration for a channel
 * If testBackupIndex is provided, returns a stream URL for that backup to test playback
 */
router.post('/channel-mappings/test-failover', requireSuperAdmin, async (req, res) => {
  try {
    const { channelId, testBackupIndex } = req.body;

    if (!channelId || isNaN(parseInt(channelId))) {
      return res.status(400).json({ error: 'channelId is required' });
    }

    // Get the channel info
    const [channel] = await db.select({
      id: iptvChannels.id,
      name: iptvChannels.name,
      streamId: iptvChannels.streamId,
      providerId: iptvChannels.providerId,
      providerName: iptvProviders.name,
      providerHealth: iptvProviders.healthStatus,
    })
      .from(iptvChannels)
      .innerJoin(iptvProviders, eq(iptvChannels.providerId, iptvProviders.id))
      .where(eq(iptvChannels.id, parseInt(channelId)));

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Get ALL mappings for this channel (not just active ones) to show full picture
    const allMappings = await db.select({
      mappingId: channelMappings.id,
      mappingIsActive: channelMappings.isActive,
      priority: channelMappings.priority,
      backupChannelId: iptvChannels.id,
      backupChannelName: iptvChannels.name,
      backupChannelStreamId: iptvChannels.streamId,
      backupChannelEnabled: iptvChannels.isEnabled,
      backupProviderId: iptvProviders.id,
      backupProviderName: iptvProviders.name,
      backupProviderActive: iptvProviders.isActive,
      backupProviderHealth: iptvProviders.healthStatus,
    })
      .from(channelMappings)
      .innerJoin(iptvChannels, eq(channelMappings.backupChannelId, iptvChannels.id))
      .innerJoin(iptvProviders, eq(iptvChannels.providerId, iptvProviders.id))
      .where(eq(channelMappings.primaryChannelId, parseInt(channelId)))
      .orderBy(asc(channelMappings.priority));

    // Categorize backups
    const backupChannels = allMappings.map(m => {
      const issues: string[] = [];
      if (!m.mappingIsActive) issues.push('mapping disabled');
      // Note: disabled channels CAN be used as backups (hidden from users but work for failover)
      if (!m.backupProviderActive) issues.push('provider inactive');

      const isUsable = issues.length === 0;
      const isHealthy = isUsable && (m.backupProviderHealth === 'healthy' || m.backupProviderHealth === 'degraded');

      return {
        id: m.backupChannelId,
        name: m.backupChannelName,
        streamId: m.backupChannelStreamId,
        providerId: m.backupProviderId,
        providerName: m.backupProviderName,
        providerHealth: m.backupProviderHealth || 'unknown',
        priority: m.priority,
        isUsable,
        isHealthy,
        issues: issues.length > 0 ? issues.join(', ') : null,
      };
    });

    const usableBackups = backupChannels.filter(b => b.isUsable);
    const healthyBackups = backupChannels.filter(b => b.isHealthy);

    // If testBackupIndex is provided, generate a test stream URL for that backup
    let testStreamUrl: string | null = null;
    let testedBackup: typeof backupChannels[0] | null = null;

    if (typeof testBackupIndex === 'number' && testBackupIndex >= 0 && testBackupIndex < backupChannels.length) {
      testedBackup = backupChannels[testBackupIndex];
      // Generate the stream URL using the backup's streamId directly
      // This bypasses the primary and uses the backup stream
      testStreamUrl = `/api/iptv/stream/${testedBackup.streamId}.m3u8`;
    }

    res.json({
      primaryChannel: {
        id: channel.id,
        name: channel.name,
        streamId: channel.streamId,
        providerId: channel.providerId,
        providerName: channel.providerName,
        providerHealth: channel.providerHealth || 'unknown',
      },
      backupChannels,
      failoverReady: usableBackups.length > 0,
      healthyBackups: healthyBackups.length,
      totalMappings: allMappings.length,
      usableBackups: usableBackups.length,
      // Test stream info (if testing a specific backup)
      testStreamUrl,
      testedBackup: testedBackup ? {
        name: testedBackup.name,
        providerName: testedBackup.providerName,
        streamId: testedBackup.streamId,
      } : null,
    });
  } catch (error) {
    loggers.adminIptv.error('Error testing failover', { error });
    res.status(500).json({ error: 'Failed to test failover' });
  }
});

/**
 * POST /api/admin/channel-mappings/test-mode
 * Enable or disable test failover mode for a stream
 * When enabled, all users watching this channel will get the backup stream
 */
router.post('/channel-mappings/test-mode', requireSuperAdmin, async (req, res) => {
  try {
    const { streamId, enabled } = req.body;
    loggers.adminIptv.debug('Test mode POST request received', { streamId, enabled });

    if (!streamId) {
      return res.status(400).json({ error: 'streamId is required' });
    }

    // Initialize global map if not exists
    (global as any).testFailoverStreams = (global as any).testFailoverStreams || new Map<string, boolean>();
    const testFailoverStreams = (global as any).testFailoverStreams as Map<string, boolean>;

    if (enabled) {
      testFailoverStreams.set(String(streamId), true);
      loggers.adminIptv.info('Enabled test failover mode', { streamId, currentTestModes: Array.from(testFailoverStreams.keys()) });
    } else {
      testFailoverStreams.delete(String(streamId));
      loggers.adminIptv.info('Disabled test failover mode', { streamId });
    }

    // Clear any cached stream so the change takes effect immediately
    (global as any).iptvSegmentBaseUrls = (global as any).iptvSegmentBaseUrls || new Map();
    (global as any).iptvSegmentBaseUrls.delete(streamId);

    // Also clear shared streams cache so manifest gets re-fetched
    (global as any).sharedStreams = (global as any).sharedStreams || new Map();
    (global as any).sharedStreams.delete(streamId);

    res.json({
      success: true,
      streamId,
      testModeEnabled: enabled,
      message: enabled
        ? 'Test mode enabled - all users will now receive the backup stream'
        : 'Test mode disabled - users will receive the primary stream',
    });
  } catch (error) {
    loggers.adminIptv.error('Error toggling test mode', { error });
    res.status(500).json({ error: 'Failed to toggle test mode' });
  }
});

/**
 * GET /api/admin/channel-mappings/test-mode/:streamId
 * Check if test mode is enabled for a stream
 */
router.get('/channel-mappings/test-mode/:streamId', requireSuperAdmin, async (req, res) => {
  try {
    const { streamId } = req.params;

    (global as any).testFailoverStreams = (global as any).testFailoverStreams || new Map<string, boolean>();
    const testFailoverStreams = (global as any).testFailoverStreams as Map<string, boolean>;

    res.json({
      streamId,
      testModeEnabled: testFailoverStreams.get(streamId) === true,
    });
  } catch (error) {
    loggers.adminIptv.error('Error checking test mode', { error });
    res.status(500).json({ error: 'Failed to check test mode' });
  }
});

/**
 * GET /api/admin/channel-mappings/test-mode-all
 * Get all streams currently in test mode
 */
router.get('/channel-mappings/test-mode-all', requireSuperAdmin, async (req, res) => {
  try {
    (global as any).testFailoverStreams = (global as any).testFailoverStreams || new Map<string, boolean>();
    const testFailoverStreams = (global as any).testFailoverStreams as Map<string, boolean>;

    const activeTestModes: string[] = [];
    testFailoverStreams.forEach((enabled, streamId) => {
      if (enabled) activeTestModes.push(streamId);
    });

    res.json({
      activeTestModes,
      count: activeTestModes.length,
    });
  } catch (error) {
    loggers.adminIptv.error('Error getting test modes', { error });
    res.status(500).json({ error: 'Failed to get test modes' });
  }
});

/**
 * POST /api/admin/channel-mappings/bulk-create
 * Create multiple mappings at once
 */
router.post('/channel-mappings/bulk-create', requireSuperAdmin, async (req, res) => {
  try {
    const { mappings } = req.body;

    if (!Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ error: 'mappings array is required' });
    }

    const created = await channelMappingService.bulkCreateMappings(mappings);

    res.json({
      success: true,
      created,
      total: mappings.length,
    });
  } catch (error) {
    loggers.adminIptv.error('Error bulk creating mappings', { error });
    res.status(500).json({ error: 'Failed to create mappings' });
  }
});

/**
 * GET /api/admin/channel-mappings/:channelId
 * Get all mappings for a specific primary channel
 * NOTE: This route MUST be after all specific /channel-mappings/* routes
 */
router.get('/channel-mappings/:channelId', requireSuperAdmin, async (req, res) => {
  try {
    const channelId = parseInt(req.params.channelId);
    if (isNaN(channelId)) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    const mappings = await channelMappingService.getMappingsForChannel(channelId);

    // Get the primary channel info
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
      .where(eq(iptvChannels.id, channelId));

    res.json({
      channel: primaryChannel || null,
      mappings
    });
  } catch (error) {
    loggers.adminIptv.error('Error fetching channel mappings', { error });
    res.status(500).json({ error: 'Failed to fetch channel mappings' });
  }
});

// ============================================================================
// PROVIDER HEALTH ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/iptv-providers/:id/health
 * Get health status and history for a provider
 */
router.get('/iptv-providers/:id/health', requireSuperAdmin, async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: 'Invalid provider ID' });
    }

    const [provider] = await db.select()
      .from(iptvProviders)
      .where(eq(iptvProviders.id, providerId));

    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    const history = await providerHealthService.getHealthHistory(providerId, 24);
    const uptime24h = await providerHealthService.getUptimePercentage(providerId, 1);
    const uptime7d = await providerHealthService.getUptimePercentage(providerId, 7);

    res.json({
      providerId,
      name: provider.name,
      currentStatus: provider.healthStatus,
      lastHealthCheck: provider.lastHealthCheck,
      uptime24h,
      uptime7d,
      history
    });
  } catch (error) {
    loggers.adminIptv.error('Error fetching provider health', { error });
    res.status(500).json({ error: 'Failed to fetch provider health' });
  }
});

/**
 * POST /api/admin/iptv-providers/:id/health-check
 * Manually trigger a health check for a provider
 */
router.post('/iptv-providers/:id/health-check', requireSuperAdmin, async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: 'Invalid provider ID' });
    }

    const result = await providerHealthService.checkProviderHealth(providerId);

    res.json({
      providerId,
      ...result,
      checkedAt: new Date()
    });
  } catch (error: any) {
    loggers.adminIptv.error('Error running health check', { error });
    res.status(500).json({ error: error.message || 'Failed to run health check' });
  }
});

/**
 * GET /api/admin/provider-health-summary
 * Get health summary for all active providers
 */
router.get('/provider-health-summary', requireSuperAdmin, async (req, res) => {
  try {
    const summary = await providerHealthService.getAllProvidersHealthSummary();
    res.json({ providers: summary });
  } catch (error) {
    loggers.adminIptv.error('Error fetching health summary', { error });
    res.status(500).json({ error: 'Failed to fetch health summary' });
  }
});

export default router;
