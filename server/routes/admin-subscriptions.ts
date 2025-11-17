import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { subscriptionPlans, userSubscriptions, users } from '@shared/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { stripeService } from '../services/stripe-service';

const router = Router();

// Validation schemas
const createPlanSchema = z.object({
  name: z.string().min(1, 'Plan name is required'),
  description: z.string().optional(),
  price_monthly: z.number().int().min(0, 'Monthly price must be non-negative'),
  price_annual: z.number().int().min(0, 'Annual price must be non-negative'),
  features: z.object({
    plex_access: z.boolean(),
    live_tv_access: z.boolean(),
    books_access: z.boolean(),
    game_servers_access: z.boolean(),
    max_favorite_channels: z.number().int().min(0),
  }),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

const updatePlanSchema = createPlanSchema.partial();

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
 * GET /api/admin/subscription-plans
 * List all subscription plans
 */
router.get('/subscription-plans', requireSuperAdmin, async (req, res) => {
  try {
    const plans = await db
      .select()
      .from(subscriptionPlans)
      .orderBy(subscriptionPlans.sort_order, subscriptionPlans.created_at);

    res.json(plans);
  } catch (error) {
    console.error('Error fetching subscription plans:', error);
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

/**
 * POST /api/admin/subscription-plans
 * Create a new subscription plan
 */
router.post('/subscription-plans', requireSuperAdmin, async (req, res) => {
  try {
    const validatedData = createPlanSchema.parse(req.body);

    // Create plan in database
    const [newPlan] = await db
      .insert(subscriptionPlans)
      .values(validatedData)
      .returning();

    // Create Stripe product and prices
    if (stripeService.isConfigured()) {
      try {
        await stripeService.createProductAndPrices(newPlan.id);

        // Fetch updated plan with Stripe IDs
        const [updatedPlan] = await db
          .select()
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.id, newPlan.id));

        res.status(201).json(updatedPlan);
      } catch (stripeError) {
        console.error('Error creating Stripe product:', stripeError);
        // Delete the plan since Stripe creation failed
        await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, newPlan.id));
        res.status(500).json({ error: 'Failed to create Stripe product' });
      }
    } else {
      res.status(201).json(newPlan);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating subscription plan:', error);
    res.status(500).json({ error: 'Failed to create subscription plan' });
  }
});

/**
 * PUT /api/admin/subscription-plans/:id
 * Update a subscription plan
 */
router.put('/subscription-plans/:id', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const validatedData = updatePlanSchema.parse(req.body);

    const [updatedPlan] = await db
      .update(subscriptionPlans)
      .set({ ...validatedData, updated_at: new Date() })
      .where(eq(subscriptionPlans.id, planId))
      .returning();

    if (!updatedPlan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // TODO: If prices changed, update Stripe prices
    // For now, Stripe prices are immutable - would need to create new prices

    res.json(updatedPlan);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating subscription plan:', error);
    res.status(500).json({ error: 'Failed to update subscription plan' });
  }
});

/**
 * DELETE /api/admin/subscription-plans/:id
 * Delete a subscription plan (only if no active subscribers)
 */
router.delete('/subscription-plans/:id', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    // Check for active subscribers
    const activeSubscribers = await db
      .select({ count: sql<number>`count(*)` })
      .from(userSubscriptions)
      .where(eq(userSubscriptions.plan_id, planId));

    if (activeSubscribers[0]?.count > 0) {
      return res.status(400).json({
        error: 'Cannot delete plan with active subscribers',
        subscriberCount: activeSubscribers[0].count
      });
    }

    await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting subscription plan:', error);
    res.status(500).json({ error: 'Failed to delete subscription plan' });
  }
});

/**
 * GET /api/admin/subscription-plans/:id/subscribers
 * Get list of subscribers for a specific plan
 */
router.get('/subscription-plans/:id/subscribers', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.id);
    if (isNaN(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const subscribers = await db
      .select({
        id: userSubscriptions.id,
        user_id: userSubscriptions.user_id,
        username: users.username,
        email: users.email,
        status: userSubscriptions.status,
        billing_period: userSubscriptions.billing_period,
        current_period_start: userSubscriptions.current_period_start,
        current_period_end: userSubscriptions.current_period_end,
        cancel_at_period_end: userSubscriptions.cancel_at_period_end,
        created_at: userSubscriptions.created_at,
      })
      .from(userSubscriptions)
      .innerJoin(users, eq(users.id, userSubscriptions.user_id))
      .where(eq(userSubscriptions.plan_id, planId))
      .orderBy(desc(userSubscriptions.created_at));

    res.json(subscribers);
  } catch (error) {
    console.error('Error fetching subscribers:', error);
    res.status(500).json({ error: 'Failed to fetch subscribers' });
  }
});

/**
 * GET /api/admin/analytics/mrr
 * Get Monthly Recurring Revenue analytics
 */
router.get('/analytics/mrr', requireSuperAdmin, async (req, res) => {
  try {
    // Get all active subscriptions with plan details
    const activeSubscriptions = await db
      .select({
        billing_period: userSubscriptions.billing_period,
        price_monthly: subscriptionPlans.price_monthly,
        price_annual: subscriptionPlans.price_annual,
        plan_name: subscriptionPlans.name,
      })
      .from(userSubscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, userSubscriptions.plan_id))
      .where(eq(userSubscriptions.status, 'active'));

    // Calculate MRR
    let totalMRR = 0;
    const planBreakdown: Record<string, { count: number; mrr: number }> = {};

    for (const sub of activeSubscriptions) {
      const monthlyRevenue = sub.billing_period === 'monthly'
        ? sub.price_monthly / 100 // Convert from cents to dollars
        : sub.price_annual / 100 / 12; // Annual divided by 12 months

      totalMRR += monthlyRevenue;

      if (!planBreakdown[sub.plan_name]) {
        planBreakdown[sub.plan_name] = { count: 0, mrr: 0 };
      }
      planBreakdown[sub.plan_name].count++;
      planBreakdown[sub.plan_name].mrr += monthlyRevenue;
    }

    // Get subscriber counts by status
    const statusCounts = await db
      .select({
        status: userSubscriptions.status,
        count: sql<number>`count(*)`,
      })
      .from(userSubscriptions)
      .groupBy(userSubscriptions.status);

    // Calculate daily revenue (MRR / 30)
    const dailyRevenue = totalMRR / 30;

    // Calculate ARR (Annual Recurring Revenue)
    const totalARR = totalMRR * 12;

    res.json({
      totalMRR: Math.round(totalMRR * 100) / 100, // Round to 2 decimal places
      totalARR: Math.round(totalARR * 100) / 100,
      dailyRevenue: Math.round(dailyRevenue * 100) / 100,
      totalActiveSubscribers: activeSubscriptions.length,
      planBreakdown,
      statusCounts: statusCounts.reduce((acc, item) => {
        acc[item.status] = item.count;
        return acc;
      }, {} as Record<string, number>),
    });
  } catch (error) {
    console.error('Error calculating MRR:', error);
    res.status(500).json({ error: 'Failed to calculate analytics' });
  }
});

/**
 * GET /api/admin/analytics/plans/:planId/users
 * Get users subscribed to a specific plan
 */
router.get('/analytics/plans/:planId/users', requireSuperAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);

    const users = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        email: usersTable.email,
        status: userSubscriptions.status,
        billing_period: userSubscriptions.billing_period,
        current_period_start: userSubscriptions.current_period_start,
        current_period_end: userSubscriptions.current_period_end,
        created_at: userSubscriptions.created_at,
      })
      .from(userSubscriptions)
      .innerJoin(usersTable, eq(usersTable.id, userSubscriptions.user_id))
      .where(eq(userSubscriptions.plan_id, planId))
      .orderBy(userSubscriptions.created_at);

    res.json(users);
  } catch (error) {
    console.error('Error fetching plan users:', error);
    res.status(500).json({ error: 'Failed to fetch plan users' });
  }
});

export default router;
