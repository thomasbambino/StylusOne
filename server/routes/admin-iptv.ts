import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { iptvCredentials, planIptvCredentials, activeIptvStreams, subscriptionPlans } from '@shared/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { encrypt, decrypt, maskCredential } from '../utils/encryption';
import { xtreamCodesManager, XtreamCodesClient } from '../services/xtream-codes-service';
import { streamTrackerService } from '../services/stream-tracker-service';

const router = Router();

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

/**
 * Middleware to check if user is super admin
 */
function requireSuperAdmin(req: any, res: any, next: any) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
}

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
          .select({ count: sql<number>`count(*)` })
          .from(activeIptvStreams)
          .where(eq(activeIptvStreams.credentialId, cred.id));

        return {
          id: cred.id,
          name: cred.name,
          serverUrl: maskCredential(decrypt(cred.serverUrl)),
          username: maskCredential(decrypt(cred.username)),
          maxConnections: cred.maxConnections,
          isActive: cred.isActive,
          notes: cred.notes,
          healthStatus: cred.healthStatus,
          lastHealthCheck: cred.lastHealthCheck,
          activeStreams: activeStreams[0]?.count || 0,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
        };
      })
    );

    res.json(credentialsWithStats);
  } catch (error) {
    console.error('Error fetching IPTV credentials:', error);
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
      name: credential.name,
      serverUrl: decrypt(credential.serverUrl),
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
    console.error('Error fetching IPTV credential:', error);
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
    console.error('Error creating IPTV credential:', error);
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
    console.error('Error updating IPTV credential:', error);
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
    console.error('Error deleting IPTV credential:', error);
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

    // Create a temporary client to test
    const client = new XtreamCodesClient({
      serverUrl: decrypt(credential.serverUrl),
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
    console.error('Error testing IPTV credential:', error);
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
    console.error('Error fetching credential streams:', error);
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
    console.error('Error disconnecting streams:', error);
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
    console.error('Error cleaning up stale streams:', error);
    res.status(500).json({ error: 'Failed to cleanup stale streams' });
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
    console.error('Error fetching all streams:', error);
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
    console.error('Error fetching plan credentials:', error);
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
    console.error('Error assigning credential to plan:', error);
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
    console.error('Error updating assignment:', error);
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
    console.error('Error removing credential from plan:', error);
    res.status(500).json({ error: 'Failed to remove credential from plan' });
  }
});

/**
 * GET /api/admin/iptv-streams
 * Get all active IPTV streams
 */
router.get('/iptv-streams', requireSuperAdmin, async (req, res) => {
  try {
    const streams = await streamTrackerService.getAllActiveStreams();
    res.json(streams);
  } catch (error) {
    console.error('Error fetching active streams:', error);
    res.status(500).json({ error: 'Failed to fetch active streams' });
  }
});

export default router;
