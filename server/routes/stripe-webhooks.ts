import { Router } from 'express';
import { db } from '../db';
import {
  userSubscriptions,
  invoices,
  paymentMethods,
  subscriptionPlans
} from '@shared/schema';
import { eq } from 'drizzle-orm';
import { stripeService } from '../services/stripe-service';
import type Stripe from 'stripe';
import { loggers } from '../lib/logger';

const router = Router();

/**
 * POST /webhooks/stripe
 * Handle Stripe webhook events
 *
 * IMPORTANT: This route must be registered BEFORE express.json() middleware
 * because it needs the raw body for signature verification
 */
router.post('/stripe', async (req, res) => {
  if (!stripeService.isConfigured()) {
    return res.status(503).json({ error: 'Stripe is not configured' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    loggers.stripe.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event: Stripe.Event;

  try {
    const stripe = stripeService.getStripeInstance();
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      webhookSecret
    );
  } catch (err) {
    loggers.stripe.error('Webhook signature verification failed', { error: err });
    return res.status(400).json({ error: 'Invalid signature' });
  }

  loggers.stripe.info(`Received Stripe webhook: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'payment_method.attached':
        await handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
        break;

      case 'payment_method.detached':
        await handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
        break;

      default:
        loggers.stripe.debug(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    loggers.stripe.error('Error processing webhook', { error });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Handle checkout.session.completed event
 * This is triggered when a user completes a Stripe Checkout session
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  loggers.stripe.info(`Processing checkout.session.completed: ${session.id}`);

  if (session.mode !== 'subscription') {
    loggers.stripe.debug('Checkout session is not for subscription, skipping');
    return;
  }

  if (!session.subscription) {
    loggers.stripe.error('Checkout session has no subscription ID');
    return;
  }

  const userId = parseInt(session.metadata?.user_id || session.client_reference_id || '0');
  const planId = parseInt(session.metadata?.plan_id || '0');
  const billingPeriod = session.metadata?.billing_period as 'monthly' | 'annual';

  if (!userId || !planId || !billingPeriod) {
    loggers.stripe.error('Missing required metadata in checkout session', {
      userId,
      planId,
      billingPeriod,
    });
    return;
  }

  // Get the subscription details from Stripe
  const stripe = stripeService.getStripeInstance();
  const subscription = await stripe.subscriptions.retrieve(session.subscription as string);

  // Check if subscription already exists in database
  const existingSubscription = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, subscription.id))
    .limit(1);

  // Access period dates from the first subscription item (Stripe API 2025-10-29.clover)
  const firstItem = subscription.items.data[0];
  const periodStart = firstItem?.current_period_start ?? subscription.start_date;
  const periodEnd = firstItem?.current_period_end ?? subscription.start_date;
  // Map 'paused' status to 'canceled' for database compatibility
  const dbStatus = subscription.status === 'paused' ? 'canceled' : subscription.status;

  if (existingSubscription.length > 0) {
    loggers.stripe.debug('Subscription already exists in database, updating');
    await db
      .update(userSubscriptions)
      .set({
        status: dbStatus as 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid',
        current_period_start: new Date(periodStart * 1000),
        current_period_end: new Date(periodEnd * 1000),
        cancel_at_period_end: subscription.cancel_at_period_end || false,
        updated_at: new Date(),
      })
      .where(eq(userSubscriptions.id, existingSubscription[0].id));
    return;
  }

  // Create new subscription record
  await db.insert(userSubscriptions).values({
    user_id: userId,
    plan_id: planId,
    stripe_customer_id: session.customer as string,
    stripe_subscription_id: subscription.id,
    status: dbStatus as 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid',
    billing_period: billingPeriod,
    current_period_start: new Date(periodStart * 1000),
    current_period_end: new Date(periodEnd * 1000),
    cancel_at_period_end: subscription.cancel_at_period_end || false,
  });

  loggers.stripe.info(`Subscription created in database: ${subscription.id}`);

  // If the session has a default payment method, save it
  if (subscription.default_payment_method) {
    const paymentMethodId = typeof subscription.default_payment_method === 'string'
      ? subscription.default_payment_method
      : subscription.default_payment_method.id;

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

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
}

/**
 * Handle customer.subscription.created event
 */
async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  loggers.stripe.info(`Processing subscription.created: ${subscription.id}`);

  // Subscription should already exist in DB from createSubscription()
  // But update it with latest data from Stripe
  const existingSubscription = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, subscription.id))
    .limit(1);

  if (existingSubscription.length > 0) {
    // Access period dates from the first subscription item (Stripe API 2025-10-29.clover)
    const firstItem = subscription.items.data[0];
    const periodStart = firstItem?.current_period_start ?? subscription.start_date;
    const periodEnd = firstItem?.current_period_end ?? subscription.start_date;
    // Map 'paused' status to 'canceled' for database compatibility
    const dbStatus = subscription.status === 'paused' ? 'canceled' : subscription.status;

    await db
      .update(userSubscriptions)
      .set({
        status: dbStatus as 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid',
        current_period_start: new Date(periodStart * 1000),
        current_period_end: new Date(periodEnd * 1000),
        cancel_at_period_end: subscription.cancel_at_period_end || false,
        updated_at: new Date(),
      })
      .where(eq(userSubscriptions.id, existingSubscription[0].id));
  }
}

/**
 * Handle customer.subscription.updated event
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  loggers.stripe.info(`Processing subscription.updated: ${subscription.id}`);

  const existingSubscription = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, subscription.id))
    .limit(1);

  if (existingSubscription.length === 0) {
    loggers.stripe.error(`Subscription not found in database: ${subscription.id}`);
    return;
  }

  // Access period dates from the first subscription item (Stripe API 2025-10-29.clover)
  const firstItem = subscription.items.data[0];
  const periodStart = firstItem?.current_period_start ?? subscription.start_date;
  const periodEnd = firstItem?.current_period_end ?? subscription.start_date;
  // Map 'paused' status to 'canceled' for database compatibility
  const dbStatus = subscription.status === 'paused' ? 'canceled' : subscription.status;

  await db
    .update(userSubscriptions)
    .set({
      status: dbStatus as 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid',
      current_period_start: new Date(periodStart * 1000),
      current_period_end: new Date(periodEnd * 1000),
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      updated_at: new Date(),
    })
    .where(eq(userSubscriptions.id, existingSubscription[0].id));
}

/**
 * Handle customer.subscription.deleted event
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  loggers.stripe.info(`Processing subscription.deleted: ${subscription.id}`);

  await db
    .update(userSubscriptions)
    .set({
      status: 'canceled',
      canceled_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(userSubscriptions.stripe_subscription_id, subscription.id));
}

/**
 * Handle invoice.paid event
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  loggers.stripe.info(`Processing invoice.paid: ${invoice.id}`);

  // Access subscription via parent (Stripe API 2025-10-29.clover)
  const subscriptionId = invoice.parent?.subscription_details?.subscription;
  const stripeSubscriptionId = typeof subscriptionId === 'string'
    ? subscriptionId
    : subscriptionId?.id;

  if (!stripeSubscriptionId) {
    loggers.stripe.debug('Invoice has no subscription, skipping');
    return;
  }

  // Get the subscription from our database
  const subscription = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, stripeSubscriptionId))
    .limit(1);

  if (subscription.length === 0) {
    loggers.stripe.error(`Subscription not found for invoice: ${stripeSubscriptionId}`);
    return;
  }

  // Check if invoice already exists (idempotency)
  const existingInvoice = await db
    .select()
    .from(invoices)
    .where(eq(invoices.stripe_invoice_id, invoice.id))
    .limit(1);

  if (existingInvoice.length > 0) {
    loggers.stripe.debug('Invoice already exists in database, updating status');
    await db
      .update(invoices)
      .set({
        status: 'paid',
        invoice_pdf_url: invoice.invoice_pdf || null,
      })
      .where(eq(invoices.id, existingInvoice[0].id));
    return;
  }

  // Create invoice record
  await db.insert(invoices).values({
    user_id: subscription[0].user_id,
    subscription_id: subscription[0].id,
    stripe_invoice_id: invoice.id,
    amount: invoice.amount_paid,
    status: 'paid',
    invoice_pdf_url: invoice.invoice_pdf || null,
    invoice_number: invoice.number || null,
    billing_period_start: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
    billing_period_end: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
  });

  // Update subscription status to active if it was in another state
  if (subscription[0].status !== 'active') {
    await db
      .update(userSubscriptions)
      .set({
        status: 'active',
        updated_at: new Date(),
      })
      .where(eq(userSubscriptions.id, subscription[0].id));
  }
}

/**
 * Handle invoice.payment_failed event
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  loggers.stripe.warn(`Processing invoice.payment_failed: ${invoice.id}`);

  // Access subscription via parent (Stripe API 2025-10-29.clover)
  const subscriptionId = invoice.parent?.subscription_details?.subscription;
  const stripeSubscriptionId = typeof subscriptionId === 'string'
    ? subscriptionId
    : subscriptionId?.id;

  if (!stripeSubscriptionId) {
    return;
  }

  const subscription = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, stripeSubscriptionId))
    .limit(1);

  if (subscription.length === 0) {
    return;
  }

  // Update subscription status to past_due
  await db
    .update(userSubscriptions)
    .set({
      status: 'past_due',
      updated_at: new Date(),
    })
    .where(eq(userSubscriptions.id, subscription[0].id));

  // Create/update invoice record
  const existingInvoice = await db
    .select()
    .from(invoices)
    .where(eq(invoices.stripe_invoice_id, invoice.id))
    .limit(1);

  if (existingInvoice.length > 0) {
    await db
      .update(invoices)
      .set({
        status: 'open',
      })
      .where(eq(invoices.id, existingInvoice[0].id));
  } else {
    await db.insert(invoices).values({
      user_id: subscription[0].user_id,
      subscription_id: subscription[0].id,
      stripe_invoice_id: invoice.id,
      amount: invoice.amount_due,
      status: 'open',
      invoice_pdf_url: invoice.invoice_pdf || null,
      invoice_number: invoice.number || null,
      billing_period_start: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      billing_period_end: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    });
  }

  // TODO: Send email notification to user about payment failure
}

/**
 * Handle payment_method.attached event
 */
async function handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod) {
  loggers.stripe.debug(`Processing payment_method.attached: ${paymentMethod.id}`);

  // Payment method should be saved when subscription is created
  // This is just for logging
}

/**
 * Handle payment_method.detached event
 */
async function handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod) {
  loggers.stripe.debug(`Processing payment_method.detached: ${paymentMethod.id}`);

  // Remove payment method from database
  await db
    .delete(paymentMethods)
    .where(eq(paymentMethods.stripe_payment_method_id, paymentMethod.id));
}

export default router;
