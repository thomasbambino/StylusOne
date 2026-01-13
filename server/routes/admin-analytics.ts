import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import {
  viewingHistory,
  activeIptvStreams,
  iptvCredentials,
  iptvChannels,
  users,
} from '@shared/schema';
import { eq, desc, and, sql, gte, lte, asc, count } from 'drizzle-orm';
import { streamTrackerService } from '../services/stream-tracker-service';

const router = Router();

/**
 * Helper to set a date to end-of-day (23:59:59.999)
 * This ensures date ranges include the entire end day
 */
function setEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Middleware to check if user is admin or superadmin
 */
function requireAdmin(req: any, res: any, next: any) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ============================================
// Real-Time Analytics Endpoints
// ============================================

/**
 * GET /api/admin/analytics/active-streams
 * Get all currently active streams with user and channel details
 */
router.get('/active-streams', requireAdmin, async (req, res) => {
  try {
    const streams = await db
      .select({
        id: activeIptvStreams.id,
        userId: activeIptvStreams.userId,
        username: users.username,
        email: users.email,
        channelId: activeIptvStreams.streamId,
        credentialId: activeIptvStreams.credentialId,
        credentialName: iptvCredentials.name,
        startedAt: activeIptvStreams.startedAt,
        lastHeartbeat: activeIptvStreams.lastHeartbeat,
        ipAddress: activeIptvStreams.ipAddress,
        deviceType: activeIptvStreams.deviceType,
      })
      .from(activeIptvStreams)
      .innerJoin(users, eq(activeIptvStreams.userId, users.id))
      .leftJoin(iptvCredentials, eq(activeIptvStreams.credentialId, iptvCredentials.id))
      .orderBy(desc(activeIptvStreams.startedAt));

    // Enrich with channel names
    const enrichedStreams = await Promise.all(
      streams.map(async (stream) => {
        const [channel] = await db
          .select({ name: iptvChannels.name, logo: iptvChannels.logo })
          .from(iptvChannels)
          .where(eq(iptvChannels.streamId, stream.channelId))
          .limit(1);

        return {
          ...stream,
          channelName: channel?.name || `Channel ${stream.channelId}`,
          channelLogo: channel?.logo || null,
        };
      })
    );

    res.json(enrichedStreams);
  } catch (error) {
    console.error('Error fetching active streams:', error);
    res.status(500).json({ error: 'Failed to fetch active streams' });
  }
});

/**
 * GET /api/admin/analytics/live-stats
 * Get live statistics for the dashboard
 */
router.get('/live-stats', requireAdmin, async (req, res) => {
  try {
    // Current active streams
    const [activeCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(activeIptvStreams);

    // Unique viewers today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [uniqueViewersToday] = await db
      .select({ count: sql<number>`count(DISTINCT user_id)::int` })
      .from(viewingHistory)
      .where(gte(viewingHistory.startedAt, today));

    // Total watch time today (in seconds)
    const [watchTimeToday] = await db
      .select({ sum: sql<number>`COALESCE(SUM(duration_seconds), 0)::int` })
      .from(viewingHistory)
      .where(gte(viewingHistory.startedAt, today));

    // Total sessions today
    const [sessionsToday] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(viewingHistory)
      .where(gte(viewingHistory.startedAt, today));

    res.json({
      activeStreams: Number(activeCount?.count) || 0,
      uniqueViewersToday: Number(uniqueViewersToday?.count) || 0,
      watchTimeToday: Number(watchTimeToday?.sum) || 0,
      sessionsToday: Number(sessionsToday?.count) || 0,
    });
  } catch (error) {
    console.error('Error fetching live stats:', error);
    res.status(500).json({ error: 'Failed to fetch live stats' });
  }
});

/**
 * DELETE /api/admin/analytics/active-streams/:id
 * Disconnect a specific active stream
 */
router.delete('/active-streams/:id', requireAdmin, async (req, res) => {
  try {
    const streamId = parseInt(req.params.id);
    if (isNaN(streamId)) {
      return res.status(400).json({ error: 'Invalid stream ID' });
    }

    // Get stream to find session token
    const [stream] = await db
      .select()
      .from(activeIptvStreams)
      .where(eq(activeIptvStreams.id, streamId));

    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    await streamTrackerService.releaseStream(stream.sessionToken);
    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting stream:', error);
    res.status(500).json({ error: 'Failed to disconnect stream' });
  }
});

// ============================================
// Channel Analytics Endpoints
// ============================================

/**
 * GET /api/admin/analytics/channels
 * Get aggregated channel statistics
 */
router.get('/channels', requireAdmin, async (req, res) => {
  try {
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
    const endDate = req.query.endDate
      ? setEndOfDay(new Date(req.query.endDate as string))
      : setEndOfDay(new Date());

    const channelStats = await db
      .select({
        channelId: viewingHistory.channelId,
        channelName: viewingHistory.channelName,
        totalWatchTime: sql<number>`COALESCE(SUM(duration_seconds), 0)::int`,
        uniqueViewers: sql<number>`count(DISTINCT user_id)::int`,
        totalSessions: sql<number>`count(*)::int`,
        avgSessionDuration: sql<number>`COALESCE(AVG(duration_seconds), 0)::int`,
      })
      .from(viewingHistory)
      .where(and(
        gte(viewingHistory.startedAt, startDate),
        lte(viewingHistory.startedAt, endDate)
      ))
      .groupBy(viewingHistory.channelId, viewingHistory.channelName)
      .orderBy(desc(sql`SUM(duration_seconds)`))
      .limit(100);

    // Add current viewer counts
    const enrichedStats = await Promise.all(
      channelStats.map(async (stat) => {
        const [currentViewers] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(activeIptvStreams)
          .where(eq(activeIptvStreams.streamId, stat.channelId));

        // Get channel logo
        const [channel] = await db
          .select({ logo: iptvChannels.logo })
          .from(iptvChannels)
          .where(eq(iptvChannels.streamId, stat.channelId))
          .limit(1);

        return {
          ...stat,
          currentViewers: Number(currentViewers?.count) || 0,
          channelLogo: channel?.logo || null,
        };
      })
    );

    res.json(enrichedStats);
  } catch (error) {
    console.error('Error fetching channel analytics:', error);
    res.status(500).json({ error: 'Failed to fetch channel analytics' });
  }
});

// ============================================
// User Analytics Endpoints
// ============================================

/**
 * GET /api/admin/analytics/users
 * Get aggregated user viewing statistics
 */
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate
      ? setEndOfDay(new Date(req.query.endDate as string))
      : setEndOfDay(new Date());

    const userStats = await db
      .select({
        userId: viewingHistory.userId,
        username: users.username,
        email: users.email,
        totalWatchTime: sql<number>`COALESCE(SUM(duration_seconds), 0)::int`,
        channelsWatched: sql<number>`count(DISTINCT channel_id)::int`,
        totalSessions: sql<number>`count(*)::int`,
        lastWatched: sql<Date>`MAX(started_at)`,
      })
      .from(viewingHistory)
      .innerJoin(users, eq(viewingHistory.userId, users.id))
      .where(and(
        gte(viewingHistory.startedAt, startDate),
        lte(viewingHistory.startedAt, endDate)
      ))
      .groupBy(viewingHistory.userId, users.username, users.email)
      .orderBy(desc(sql`SUM(duration_seconds)`))
      .limit(100);

    // Add current watching status
    const enrichedStats = await Promise.all(
      userStats.map(async (stat) => {
        const [currentStream] = await db
          .select({ streamId: activeIptvStreams.streamId })
          .from(activeIptvStreams)
          .where(eq(activeIptvStreams.userId, stat.userId))
          .limit(1);

        // Look up channel name if user is watching
        let currentChannelName: string | null = null;
        if (currentStream) {
          const [channel] = await db
            .select({ name: iptvChannels.name })
            .from(iptvChannels)
            .where(eq(iptvChannels.streamId, currentStream.streamId))
            .limit(1);
          currentChannelName = channel?.name || currentStream.streamId;
        }

        return {
          ...stat,
          isWatching: !!currentStream,
          currentChannel: currentChannelName,
        };
      })
    );

    res.json(enrichedStats);
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({ error: 'Failed to fetch user analytics' });
  }
});

/**
 * GET /api/admin/analytics/users/:id
 * Get detailed watch history for a specific user
 */
router.get('/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;

    // Get user info
    const [user] = await db
      .select({ id: users.id, username: users.username, email: users.email })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get viewing history
    const history = await db
      .select()
      .from(viewingHistory)
      .where(eq(viewingHistory.userId, userId))
      .orderBy(desc(viewingHistory.startedAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(viewingHistory)
      .where(eq(viewingHistory.userId, userId));

    // Get top channels for this user
    const topChannels = await db
      .select({
        channelId: viewingHistory.channelId,
        channelName: viewingHistory.channelName,
        totalWatchTime: sql<number>`COALESCE(SUM(duration_seconds), 0)::int`,
        sessionCount: sql<number>`count(*)::int`,
      })
      .from(viewingHistory)
      .where(eq(viewingHistory.userId, userId))
      .groupBy(viewingHistory.channelId, viewingHistory.channelName)
      .orderBy(desc(sql`SUM(duration_seconds)`))
      .limit(10);

    res.json({
      user,
      history,
      topChannels,
      pagination: {
        page,
        limit,
        total: Number(totalResult?.count) || 0,
        totalPages: Math.ceil((Number(totalResult?.count) || 0) / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching user history:', error);
    res.status(500).json({ error: 'Failed to fetch user history' });
  }
});

// ============================================
// History Endpoints
// ============================================

/**
 * GET /api/admin/analytics/history
 * Get paginated viewing history with filters
 */
router.get('/history', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;

    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : undefined;
    const endDate = req.query.endDate
      ? setEndOfDay(new Date(req.query.endDate as string))
      : undefined;
    const userId = req.query.userId
      ? parseInt(req.query.userId as string)
      : undefined;
    const channelSearch = (req.query.channelSearch as string) || '';

    // Build conditions
    const conditions = [];
    if (startDate) {
      conditions.push(gte(viewingHistory.startedAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(viewingHistory.startedAt, endDate));
    }
    if (userId) {
      conditions.push(eq(viewingHistory.userId, userId));
    }
    if (channelSearch) {
      conditions.push(sql`LOWER(${viewingHistory.channelName}) LIKE ${`%${channelSearch.toLowerCase()}%`}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get history with user info
    const history = await db
      .select({
        id: viewingHistory.id,
        userId: viewingHistory.userId,
        username: users.username,
        channelId: viewingHistory.channelId,
        channelName: viewingHistory.channelName,
        programTitle: viewingHistory.programTitle,
        endProgramTitle: viewingHistory.endProgramTitle,
        startedAt: viewingHistory.startedAt,
        endedAt: viewingHistory.endedAt,
        durationSeconds: viewingHistory.durationSeconds,
        deviceType: viewingHistory.deviceType,
        ipAddress: viewingHistory.ipAddress,
      })
      .from(viewingHistory)
      .innerJoin(users, eq(viewingHistory.userId, users.id))
      .where(whereClause)
      .orderBy(desc(viewingHistory.startedAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(viewingHistory)
      .where(whereClause);

    res.json({
      history,
      pagination: {
        page,
        limit,
        total: Number(totalResult?.count) || 0,
        totalPages: Math.ceil((Number(totalResult?.count) || 0) / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching viewing history:', error);
    res.status(500).json({ error: 'Failed to fetch viewing history' });
  }
});

// ============================================
// Data Management Endpoints
// ============================================

/**
 * POST /api/admin/analytics/export
 * Export viewing history as CSV
 */
router.post('/export', requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).parse(req.body);

    const conditions = [];
    if (startDate) {
      conditions.push(gte(viewingHistory.startedAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(viewingHistory.startedAt, setEndOfDay(new Date(endDate))));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const history = await db
      .select({
        id: viewingHistory.id,
        userId: viewingHistory.userId,
        username: users.username,
        channelId: viewingHistory.channelId,
        channelName: viewingHistory.channelName,
        programTitle: viewingHistory.programTitle,
        endProgramTitle: viewingHistory.endProgramTitle,
        startedAt: viewingHistory.startedAt,
        endedAt: viewingHistory.endedAt,
        durationSeconds: viewingHistory.durationSeconds,
        deviceType: viewingHistory.deviceType,
        ipAddress: viewingHistory.ipAddress,
      })
      .from(viewingHistory)
      .innerJoin(users, eq(viewingHistory.userId, users.id))
      .where(whereClause)
      .orderBy(asc(viewingHistory.startedAt));

    // Convert to CSV
    const headers = [
      'ID',
      'User ID',
      'Username',
      'Channel ID',
      'Channel Name',
      'Program Title',
      'Started At',
      'Ended At',
      'Duration (seconds)',
      'Device Type',
      'IP Address',
    ];

    const rows = history.map((row) => [
      row.id,
      row.userId,
      row.username,
      row.channelId,
      row.channelName || '',
      row.programTitle || '',
      row.startedAt?.toISOString() || '',
      row.endedAt?.toISOString() || '',
      row.durationSeconds || 0,
      row.deviceType || '',
      row.ipAddress || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="viewing-history-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error exporting history:', error);
    res.status(500).json({ error: 'Failed to export history' });
  }
});

/**
 * POST /api/admin/analytics/import
 * Import viewing history from CSV
 */
router.post('/import', requireAdmin, async (req, res) => {
  try {
    const { data } = z.object({
      data: z.array(z.object({
        userId: z.number(),
        channelId: z.string(),
        channelName: z.string().optional(),
        programTitle: z.string().optional(),
        startedAt: z.string(),
        endedAt: z.string().optional(),
        durationSeconds: z.number().optional(),
        deviceType: z.string().optional(),
        ipAddress: z.string().optional(),
      })),
    }).parse(req.body);

    let imported = 0;
    for (const row of data) {
      try {
        await db.insert(viewingHistory).values({
          userId: row.userId,
          channelId: row.channelId,
          channelName: row.channelName || null,
          programTitle: row.programTitle || null,
          startedAt: new Date(row.startedAt),
          endedAt: row.endedAt ? new Date(row.endedAt) : null,
          durationSeconds: row.durationSeconds || null,
          deviceType: row.deviceType || null,
          ipAddress: row.ipAddress || null,
        });
        imported++;
      } catch (err) {
        console.error('Error importing row:', err);
      }
    }

    res.json({ success: true, imported, total: data.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error importing history:', error);
    res.status(500).json({ error: 'Failed to import history' });
  }
});

/**
 * DELETE /api/admin/analytics/history
 * Delete viewing history within a date range
 */
router.delete('/history', requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, confirm } = z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      confirm: z.boolean(),
    }).parse(req.body);

    if (!confirm) {
      return res.status(400).json({ error: 'Confirmation required' });
    }

    const conditions = [];
    if (startDate) {
      conditions.push(gte(viewingHistory.startedAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(viewingHistory.startedAt, setEndOfDay(new Date(endDate))));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const result = await db
      .delete(viewingHistory)
      .where(whereClause)
      .returning({ id: viewingHistory.id });

    console.log(`[ADMIN] Deleted ${result.length} viewing history records`);
    res.json({ success: true, deleted: result.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error deleting history:', error);
    res.status(500).json({ error: 'Failed to delete history' });
  }
});

export default router;
