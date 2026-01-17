import Stripe from 'stripe';
import { db } from '../db';
import {
  subscriptionPlans,
  userSubscriptions,
  invoices,
  paymentMethods,
  users
} from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { loggers } from '../lib/logger';

/**
 * Stripe Service
 * Handles all Stripe API operations for subscription management
 */
export class StripeService {
  private stripe: Stripe;
  private initialized: boolean = false;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      loggers.stripe.warn('STRIPE_SECRET_KEY not configured - Stripe service disabled');
      this.stripe = null as any;
      return;
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2025-10-29.clover',
      typescript: true,
    });

    this.initialized = true;
    loggers.stripe.info('Stripe service initialized');
  }

  /**
   * Check if Stripe is configured and initialized
   */
  isConfigured(): boolean {
    return this.initialized && !!this.stripe;
  }

  /**
   * Create or retrieve a Stripe customer for a user
   */
  async getOrCreateCustomer(userId: number, email: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    // Check if user already has a customer ID
    const existingSubscription = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.user_id, userId))
      .limit(1);

    if (existingSubscription.length > 0 && existingSubscription[0].stripe_customer_id) {
      return existingSubscription[0].stripe_customer_id;
    }

    // Create new customer
    const customer = await this.stripe.customers.create({
      email,
      metadata: {
        user_id: userId.toString(),
      },
    });

    return customer.id;
  }

  /**
   * Create a new subscription
   */
  async createSubscription(params: {
    userId: number;
    planId: number;
    billingPeriod: 'monthly' | 'annual';
    paymentMethodId: string;
    email: string;
  }): Promise<{ subscriptionId: string; clientSecret: string | null }> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    const { userId, planId, billingPeriod, paymentMethodId, email } = params;

    // Get the plan
    const plan = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (plan.length === 0) {
      throw new Error('Subscription plan not found');
    }

    const selectedPlan = plan[0];
    const priceId = billingPeriod === 'monthly'
      ? selectedPlan.stripe_price_id_monthly
      : selectedPlan.stripe_price_id_annual;

    if (!priceId) {
      throw new Error(`Stripe price ID not configured for ${billingPeriod} billing`);
    }

    // Get or create customer
    const customerId = await this.getOrCreateCustomer(userId, email);

    // Attach payment method to customer
    await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    // Set as default payment method
    await this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // Create subscription
    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
    });

    // Save subscription to database
    // Access period dates from the first subscription item (Stripe API 2025-10-29.clover)
    const firstItem = subscription.items.data[0];
    const periodStart = firstItem?.current_period_start ?? subscription.start_date;
    const periodEnd = firstItem?.current_period_end ?? subscription.start_date;
    // Map 'paused' status to 'canceled' for database compatibility
    const dbStatus = subscription.status === 'paused' ? 'canceled' : subscription.status;

    await db.insert(userSubscriptions).values({
      user_id: userId,
      plan_id: planId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: dbStatus as 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid',
      billing_period: billingPeriod,
      current_period_start: new Date(periodStart * 1000),
      current_period_end: new Date(periodEnd * 1000),
      cancel_at_period_end: subscription.cancel_at_period_end || false,
    });

    // Save payment method
    const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    if (paymentMethod.card) {
      await db.insert(paymentMethods).values({
        user_id: userId,
        stripe_payment_method_id: paymentMethodId,
        card_brand: paymentMethod.card.brand,
        card_last4: paymentMethod.card.last4,
        card_exp_month: paymentMethod.card.exp_month,
        card_exp_year: paymentMethod.card.exp_year,
        is_default: true,
      });
    }

    // Access payment_intent via type assertion (Stripe API 2025-10-29.clover)
    const latestInvoice = subscription.latest_invoice as any;
    const clientSecret = typeof latestInvoice === 'object' && latestInvoice?.payment_intent
      ? (typeof latestInvoice.payment_intent === 'object'
          ? latestInvoice.payment_intent.client_secret
          : null)
      : null;

    return {
      subscriptionId: subscription.id,
      clientSecret,
    };
  }

  /**
   * Create a Stripe Checkout session for subscription
   */
  async createCheckoutSession(params: {
    userId: number;
    userEmail: string;
    planId: number;
    billingPeriod: 'monthly' | 'annual';
  }): Promise<{ url: string }> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    const { userId, userEmail, planId, billingPeriod } = params;

    // Get the plan
    const plan = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (plan.length === 0) {
      throw new Error('Subscription plan not found');
    }

    const selectedPlan = plan[0];
    const priceId = billingPeriod === 'monthly'
      ? selectedPlan.stripe_price_id_monthly
      : selectedPlan.stripe_price_id_annual;

    if (!priceId) {
      throw new Error(`Stripe price ID not configured for ${billingPeriod} billing`);
    }

    // Sanitize email for Stripe (replace localhost with example.com for test environments)
    let stripeEmail = userEmail;
    if (stripeEmail.endsWith('@localhost')) {
      stripeEmail = stripeEmail.replace('@localhost', '@example.com');
    }

    // Create Stripe checkout session
    const session = await this.stripe.checkout.sessions.create({
      customer_email: stripeEmail,
      client_reference_id: userId.toString(),
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.APP_URL || 'http://localhost:3000'}/my-subscription?success=true`,
      cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/my-subscription?canceled=true`,
      metadata: {
        user_id: userId.toString(),
        plan_id: planId.toString(),
        billing_period: billingPeriod,
      },
    });

    return { url: session.url! };
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(userId: number, cancelImmediately: boolean = false): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    const subscription = await db
      .select()
      .from(userSubscriptions)
      .where(and(
        eq(userSubscriptions.user_id, userId),
        eq(userSubscriptions.status, 'active')
      ))
      .limit(1);

    if (subscription.length === 0) {
      throw new Error('No active subscription found');
    }

    const stripeSubscriptionId = subscription[0].stripe_subscription_id;

    if (cancelImmediately) {
      // Cancel immediately
      await this.stripe.subscriptions.cancel(stripeSubscriptionId);

      await db
        .update(userSubscriptions)
        .set({
          status: 'canceled',
          canceled_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(userSubscriptions.id, subscription[0].id));
    } else {
      // Cancel at period end
      await this.stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      await db
        .update(userSubscriptions)
        .set({
          cancel_at_period_end: true,
          updated_at: new Date(),
        })
        .where(eq(userSubscriptions.id, subscription[0].id));
    }
  }

  /**
   * Reactivate a subscription that was set to cancel
   */
  async reactivateSubscription(userId: number): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    const subscription = await db
      .select()
      .from(userSubscriptions)
      .where(and(
        eq(userSubscriptions.user_id, userId),
        eq(userSubscriptions.cancel_at_period_end, true)
      ))
      .limit(1);

    if (subscription.length === 0) {
      throw new Error('No subscription scheduled for cancellation found');
    }

    const stripeSubscriptionId = subscription[0].stripe_subscription_id;

    await this.stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await db
      .update(userSubscriptions)
      .set({
        cancel_at_period_end: false,
        updated_at: new Date(),
      })
      .where(eq(userSubscriptions.id, subscription[0].id));
  }

  /**
   * Update subscription plan
   */
  async updateSubscriptionPlan(params: {
    userId: number;
    newPlanId: number;
    billingPeriod: 'monthly' | 'annual';
  }): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    const { userId, newPlanId, billingPeriod } = params;

    // Get current subscription
    const currentSubscription = await db
      .select()
      .from(userSubscriptions)
      .where(and(
        eq(userSubscriptions.user_id, userId),
        eq(userSubscriptions.status, 'active')
      ))
      .limit(1);

    if (currentSubscription.length === 0) {
      throw new Error('No active subscription found');
    }

    // Get new plan
    const newPlan = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, newPlanId))
      .limit(1);

    if (newPlan.length === 0) {
      throw new Error('New subscription plan not found');
    }

    const priceId = billingPeriod === 'monthly'
      ? newPlan[0].stripe_price_id_monthly
      : newPlan[0].stripe_price_id_annual;

    if (!priceId) {
      throw new Error(`Stripe price ID not configured for ${billingPeriod} billing`);
    }

    // Get Stripe subscription
    const stripeSubscription = await this.stripe.subscriptions.retrieve(
      currentSubscription[0].stripe_subscription_id
    );

    // Update subscription
    await this.stripe.subscriptions.update(stripeSubscription.id, {
      items: [{
        id: stripeSubscription.items.data[0].id,
        price: priceId,
      }],
      proration_behavior: 'always_invoice',
    });

    // Update database
    await db
      .update(userSubscriptions)
      .set({
        plan_id: newPlanId,
        billing_period: billingPeriod,
        updated_at: new Date(),
      })
      .where(eq(userSubscriptions.id, currentSubscription[0].id));
  }

  /**
   * Update payment method
   */
  async updatePaymentMethod(userId: number, paymentMethodId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    const subscription = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.user_id, userId))
      .limit(1);

    if (subscription.length === 0) {
      throw new Error('No subscription found for user');
    }

    const customerId = subscription[0].stripe_customer_id;

    // Attach new payment method
    await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    // Set as default
    await this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // Mark old payment methods as not default
    await db
      .update(paymentMethods)
      .set({ is_default: false })
      .where(eq(paymentMethods.user_id, userId));

    // Save new payment method
    const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    if (paymentMethod.card) {
      await db.insert(paymentMethods).values({
        user_id: userId,
        stripe_payment_method_id: paymentMethodId,
        card_brand: paymentMethod.card.brand,
        card_last4: paymentMethod.card.last4,
        card_exp_month: paymentMethod.card.exp_month,
        card_exp_year: paymentMethod.card.exp_year,
        is_default: true,
      });
    }
  }

  /**
   * Create a Stripe product and prices for a subscription plan
   */
  async createProductAndPrices(planId: number): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    const plan = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (plan.length === 0) {
      throw new Error('Plan not found');
    }

    const selectedPlan = plan[0];

    // Create product
    const product = await this.stripe.products.create({
      name: selectedPlan.name,
      description: selectedPlan.description || undefined,
      metadata: {
        plan_id: planId.toString(),
      },
    });

    // Create monthly price
    const monthlyPrice = await this.stripe.prices.create({
      product: product.id,
      unit_amount: selectedPlan.price_monthly,
      currency: 'usd',
      recurring: {
        interval: 'month',
      },
      metadata: {
        plan_id: planId.toString(),
        billing_period: 'monthly',
      },
    });

    // Create annual price
    const annualPrice = await this.stripe.prices.create({
      product: product.id,
      unit_amount: selectedPlan.price_annual,
      currency: 'usd',
      recurring: {
        interval: 'year',
      },
      metadata: {
        plan_id: planId.toString(),
        billing_period: 'annual',
      },
    });

    // Update plan with Stripe IDs
    await db
      .update(subscriptionPlans)
      .set({
        stripe_product_id: product.id,
        stripe_price_id_monthly: monthlyPrice.id,
        stripe_price_id_annual: annualPrice.id,
        updated_at: new Date(),
      })
      .where(eq(subscriptionPlans.id, planId));
  }

  /**
   * Get the Stripe instance for direct API access
   */
  getStripeInstance(): Stripe {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }
    return this.stripe;
  }
}

// Export singleton instance
export const stripeService = new StripeService();
