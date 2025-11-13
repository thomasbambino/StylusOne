import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import {
  subscriptionPlans,
  userSubscriptions,
  invoices,
  paymentMethods,
  users
} from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { stripeService } from '../services/stripe-service';

const router = Router();

// Validation schemas
const createSubscriptionSchema = z.object({
  plan_id: z.number().int().positive(),
  billing_period: z.enum(['monthly', 'annual']),
  payment_method_id: z.string().min(1),
});

const updateSubscriptionSchema = z.object({
  plan_id: z.number().int().positive(),
  billing_period: z.enum(['monthly', 'annual']),
});

const updatePaymentMethodSchema = z.object({
  payment_method_id: z.string().min(1),
});

/**
 * Middleware to ensure user is authenticated
 */
function requireAuth(req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * GET /api/subscriptions/plans
 * Get all active subscription plans available for purchase
 */
router.get('/plans', requireAuth, async (req, res) => {
  try {
    const plans = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.is_active, true))
      .orderBy(subscriptionPlans.sort_order, subscriptionPlans.price_monthly);

    res.json(plans);
  } catch (error) {
    console.error('Error fetching subscription plans:', error);
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

/**
 * GET /api/subscriptions/current
 * Get user's current subscription with plan details
 */
router.get('/current', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const subscription = await db
      .select({
        id: userSubscriptions.id,
        plan_id: userSubscriptions.plan_id,
        status: userSubscriptions.status,
        billing_period: userSubscriptions.billing_period,
        current_period_start: userSubscriptions.current_period_start,
        current_period_end: userSubscriptions.current_period_end,
        cancel_at_period_end: userSubscriptions.cancel_at_period_end,
        canceled_at: userSubscriptions.canceled_at,
        created_at: userSubscriptions.created_at,
        plan_name: subscriptionPlans.name,
        plan_description: subscriptionPlans.description,
        plan_features: subscriptionPlans.features,
        price_monthly: subscriptionPlans.price_monthly,
        price_annual: subscriptionPlans.price_annual,
      })
      .from(userSubscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, userSubscriptions.plan_id))
      .where(eq(userSubscriptions.user_id, userId))
      .orderBy(desc(userSubscriptions.created_at))
      .limit(1);

    if (subscription.length === 0) {
      return res.json(null);
    }

    res.json(subscription[0]);
  } catch (error) {
    console.error('Error fetching current subscription:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

/**
 * POST /api/subscriptions/create
 * Create a new subscription for the user
 */
router.post('/create', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const validatedData = createSubscriptionSchema.parse(req.body);

    // Check if user already has an active subscription
    const existingSubscription = await db
      .select()
      .from(userSubscriptions)
      .where(and(
        eq(userSubscriptions.user_id, userId),
        eq(userSubscriptions.status, 'active')
      ))
      .limit(1);

    if (existingSubscription.length > 0) {
      return res.status(400).json({ error: 'User already has an active subscription' });
    }

    // Get user email
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || !user.email) {
      return res.status(400).json({ error: 'User email is required' });
    }

    // Create subscription via Stripe
    const result = await stripeService.createSubscription({
      userId,
      planId: validatedData.plan_id,
      billingPeriod: validatedData.billing_period,
      paymentMethodId: validatedData.payment_method_id,
      email: user.email,
    });

    res.status(201).json({
      success: true,
      subscriptionId: result.subscriptionId,
      clientSecret: result.clientSecret,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating subscription:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create subscription'
    });
  }
});

/**
 * POST /api/subscriptions/upgrade
 * Upgrade/downgrade to a different plan
 */
router.post('/upgrade', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const validatedData = updateSubscriptionSchema.parse(req.body);

    await stripeService.updateSubscriptionPlan({
      userId,
      newPlanId: validatedData.plan_id,
      billingPeriod: validatedData.billing_period,
    });

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating subscription:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update subscription'
    });
  }
});

/**
 * POST /api/subscriptions/cancel
 * Cancel user's subscription
 */
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { immediately } = req.body;

    await stripeService.cancelSubscription(userId, immediately === true);

    res.json({ success: true });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to cancel subscription'
    });
  }
});

/**
 * POST /api/subscriptions/reactivate
 * Reactivate a subscription that was set to cancel at period end
 */
router.post('/reactivate', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    await stripeService.reactivateSubscription(userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error reactivating subscription:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to reactivate subscription'
    });
  }
});

/**
 * POST /api/subscriptions/payment-method
 * Update payment method
 */
router.post('/payment-method', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const validatedData = updatePaymentMethodSchema.parse(req.body);

    await stripeService.updatePaymentMethod(userId, validatedData.payment_method_id);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating payment method:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update payment method'
    });
  }
});

/**
 * GET /api/subscriptions/payment-methods
 * Get user's saved payment methods
 */
router.get('/payment-methods', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const methods = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.user_id, userId))
      .orderBy(desc(paymentMethods.is_default), desc(paymentMethods.created_at));

    res.json(methods);
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

/**
 * GET /api/subscriptions/invoices
 * Get user's invoices
 */
router.get('/invoices', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const userInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.user_id, userId))
      .orderBy(desc(invoices.created_at));

    res.json(userInvoices);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

/**
 * GET /api/subscriptions/invoices/:id/download
 * Get download URL for an invoice
 */
router.get('/invoices/:id/download', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const invoiceId = parseInt(req.params.id);

    if (isNaN(invoiceId)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(
        eq(invoices.id, invoiceId),
        eq(invoices.user_id, userId)
      ))
      .limit(1);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (!invoice.invoice_pdf_url) {
      return res.status(404).json({ error: 'Invoice PDF not available' });
    }

    // Redirect to Stripe-hosted PDF
    res.redirect(invoice.invoice_pdf_url);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({ error: 'Failed to download invoice' });
  }
});

/**
 * GET /api/subscriptions/has-feature/:feature
 * Check if user has access to a specific feature
 */
router.get('/has-feature/:feature', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const feature = req.params.feature;

    // Get user's active subscription with plan features
    const subscription = await db
      .select({
        features: subscriptionPlans.features,
        status: userSubscriptions.status,
      })
      .from(userSubscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, userSubscriptions.plan_id))
      .where(and(
        eq(userSubscriptions.user_id, userId),
        eq(userSubscriptions.status, 'active')
      ))
      .limit(1);

    if (subscription.length === 0) {
      return res.json({ hasAccess: false });
    }

    const features = subscription[0].features as any;
    const hasAccess = features[feature] === true;

    res.json({ hasAccess });
  } catch (error) {
    console.error('Error checking feature access:', error);
    res.status(500).json({ error: 'Failed to check feature access' });
  }
});

export default router;
