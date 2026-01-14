import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { userSubscriptions, subscriptionPlans } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Feature flags that can be checked
 */
export type Feature = 'plex_access' | 'live_tv_access' | 'books_access' | 'game_servers_access' | 'events_access';

/**
 * Human-readable feature names for display
 */
const FEATURE_NAMES: Record<Feature, string> = {
  plex_access: 'Plex',
  live_tv_access: 'Live TV',
  books_access: 'Books',
  game_servers_access: 'Game Servers',
  events_access: 'Events',
};

/**
 * Middleware to check if user has access to a specific feature
 * Returns 403 if user doesn't have an active subscription with the required feature
 */
export function requireFeature(feature: Feature) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Get user's active subscription with plan details
      const subscription = await db
        .select({
          subscription: userSubscriptions,
          plan: subscriptionPlans,
        })
        .from(userSubscriptions)
        .innerJoin(
          subscriptionPlans,
          eq(userSubscriptions.plan_id, subscriptionPlans.id)
        )
        .where(
          and(
            eq(userSubscriptions.user_id, userId),
            eq(userSubscriptions.status, 'active')
          )
        )
        .limit(1);

      // No active subscription
      if (subscription.length === 0) {
        return res.status(403).json({
          error: `Active subscription required to access ${FEATURE_NAMES[feature]}`,
          feature: FEATURE_NAMES[feature],
          upgrade_required: true,
        });
      }

      const { plan } = subscription[0];

      // Check if plan includes the required feature
      const features = plan.features as any;
      if (!features || !features[feature]) {
        return res.status(403).json({
          error: `Your ${plan.name} plan does not include ${FEATURE_NAMES[feature]}`,
          feature: FEATURE_NAMES[feature],
          current_plan: plan.name,
          upgrade_required: true,
        });
      }

      // Feature access granted
      next();
    } catch (error) {
      console.error('[Feature Gate] Error checking feature access:', error);
      res.status(500).json({
        error: 'Failed to verify feature access',
      });
    }
  };
}

/**
 * Middleware to check if user has ANY active subscription
 * Used for features that require any paid plan
 */
export function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Check for any active subscription
      const subscription = await db
        .select()
        .from(userSubscriptions)
        .where(
          and(
            eq(userSubscriptions.user_id, userId),
            eq(userSubscriptions.status, 'active')
          )
        )
        .limit(1);

      if (subscription.length === 0) {
        return res.status(403).json({
          error: 'Active subscription required',
          upgrade_required: true,
        });
      }

      next();
    } catch (error) {
      console.error('[Feature Gate] Error checking subscription:', error);
      res.status(500).json({
        error: 'Failed to verify subscription',
      });
    }
  };
}

/**
 * Helper function to get user's active subscription with plan details
 * Can be used in route handlers to check features programmatically
 */
export async function getUserSubscription(userId: number) {
  const subscription = await db
    .select({
      subscription: userSubscriptions,
      plan: subscriptionPlans,
    })
    .from(userSubscriptions)
    .innerJoin(
      subscriptionPlans,
      eq(userSubscriptions.plan_id, subscriptionPlans.id)
    )
    .where(
      and(
        eq(userSubscriptions.user_id, userId),
        eq(userSubscriptions.status, 'active')
      )
    )
    .limit(1);

  return subscription.length > 0 ? subscription[0] : null;
}

/**
 * Helper function to check if user has access to a specific feature
 */
export async function hasFeatureAccess(userId: number, feature: Feature): Promise<boolean> {
  const subscription = await getUserSubscription(userId);

  if (!subscription) {
    return false;
  }

  const features = subscription.plan.features as any;
  return features && features[feature] === true;
}
