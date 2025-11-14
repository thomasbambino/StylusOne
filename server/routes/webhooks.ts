import { Router } from 'express';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { db } from '../db';
import { userSubscriptions, invoices, paymentMethods, users } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

const router = Router();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events
 *
 * IMPORTANT: This route must use raw body for signature verification
 */
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    return res.status(400).send('No signature provided');
  }

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event: Stripe.Event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  console.log(`[Webhook] Received event: ${event.type}`);

  try {
    // Handle different event types
    switch (event.type) {
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
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[Webhook] Error processing event:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to process webhook'
    });
  }
});

/**
 * Handle subscription.created event
 */
async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  console.log(`[Webhook] Processing subscription.created: ${subscription.id}`);

  // Get customer email to find user
  const customer = await stripe.customers.retrieve(subscription.customer as string);
  if (customer.deleted) {
    throw new Error('Customer has been deleted');
  }

  const email = customer.email;
  if (!email) {
    throw new Error('Customer has no email');
  }

  // Find user by email
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    throw new Error(`User not found for email: ${email}`);
  }

  // Check if subscription already exists (idempotency)
  const existing = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, subscription.id))
    .limit(1);

  if (existing.length > 0) {
    console.log('[Webhook] Subscription already exists, skipping creation');
    return;
  }

  // Get plan ID from metadata
  const planId = subscription.metadata.plan_id;
  if (!planId) {
    throw new Error('Subscription missing plan_id in metadata');
  }

  // Create subscription record
  await db.insert(userSubscriptions).values({
    user_id: user.id,
    plan_id: parseInt(planId),
    stripe_customer_id: subscription.customer as string,
    stripe_subscription_id: subscription.id,
    status: subscription.status as any,
    billing_period: subscription.metadata.billing_period as 'monthly' | 'annual',
    current_period_start: new Date(subscription.current_period_start * 1000),
    current_period_end: new Date(subscription.current_period_end * 1000),
    cancel_at_period_end: subscription.cancel_at_period_end,
    created_at: new Date(),
    updated_at: new Date(),
  });

  console.log(`[Webhook] Created subscription for user ${user.id}`);
}

/**
 * Handle subscription.updated event
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log(`[Webhook] Processing subscription.updated: ${subscription.id}`);

  // Find existing subscription
  const [existing] = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, subscription.id))
    .limit(1);

  if (!existing) {
    console.log('[Webhook] Subscription not found, creating new record');
    await handleSubscriptionCreated(subscription);
    return;
  }

  // Update subscription
  await db
    .update(userSubscriptions)
    .set({
      status: subscription.status as any,
      current_period_start: new Date(subscription.current_period_start * 1000),
      current_period_end: new Date(subscription.current_period_end * 1000),
      cancel_at_period_end: subscription.cancel_at_period_end,
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      updated_at: new Date(),
    })
    .where(eq(userSubscriptions.id, existing.id));

  console.log(`[Webhook] Updated subscription ${existing.id}`);
}

/**
 * Handle subscription.deleted event
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log(`[Webhook] Processing subscription.deleted: ${subscription.id}`);

  await db
    .update(userSubscriptions)
    .set({
      status: 'canceled',
      canceled_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(userSubscriptions.stripe_subscription_id, subscription.id));

  console.log(`[Webhook] Marked subscription as canceled`);
}

/**
 * Handle invoice.paid event
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  console.log(`[Webhook] Processing invoice.paid: ${invoice.id}`);

  if (!invoice.subscription) {
    console.log('[Webhook] Invoice has no subscription, skipping');
    return;
  }

  // Find subscription
  const [subscription] = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, invoice.subscription as string))
    .limit(1);

  if (!subscription) {
    console.log('[Webhook] Subscription not found');
    return;
  }

  // Check if invoice already exists (idempotency)
  const existing = await db
    .select()
    .from(invoices)
    .where(eq(invoices.stripe_invoice_id, invoice.id))
    .limit(1);

  if (existing.length > 0) {
    console.log('[Webhook] Invoice already exists, updating');
    await db
      .update(invoices)
      .set({
        status: invoice.status || 'paid',
        invoice_pdf_url: invoice.invoice_pdf || null,
      })
      .where(eq(invoices.id, existing[0].id));
    return;
  }

  // Create invoice record
  await db.insert(invoices).values({
    user_id: subscription.user_id,
    subscription_id: subscription.id,
    stripe_invoice_id: invoice.id,
    amount: invoice.amount_paid,
    status: invoice.status || 'paid',
    invoice_pdf_url: invoice.invoice_pdf || null,
    invoice_number: invoice.number || null,
    billing_period_start: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
    billing_period_end: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    created_at: new Date(),
  });

  // Update subscription status to active if it was past_due
  if (subscription.status === 'past_due') {
    await db
      .update(userSubscriptions)
      .set({
        status: 'active',
        updated_at: new Date(),
      })
      .where(eq(userSubscriptions.id, subscription.id));
  }

  console.log(`[Webhook] Created invoice for user ${subscription.user_id}`);
}

/**
 * Handle invoice.payment_failed event
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  console.log(`[Webhook] Processing invoice.payment_failed: ${invoice.id}`);

  if (!invoice.subscription) {
    console.log('[Webhook] Invoice has no subscription, skipping');
    return;
  }

  // Update subscription status to past_due
  await db
    .update(userSubscriptions)
    .set({
      status: 'past_due',
      updated_at: new Date(),
    })
    .where(eq(userSubscriptions.stripe_subscription_id, invoice.subscription as string));

  console.log(`[Webhook] Marked subscription as past_due`);
}

/**
 * Handle payment_method.attached event
 */
async function handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod) {
  console.log(`[Webhook] Processing payment_method.attached: ${paymentMethod.id}`);

  if (!paymentMethod.customer) {
    console.log('[Webhook] Payment method has no customer, skipping');
    return;
  }

  // Get customer to find user
  const customer = await stripe.customers.retrieve(paymentMethod.customer as string);
  if (customer.deleted) {
    throw new Error('Customer has been deleted');
  }

  const email = customer.email;
  if (!email) {
    throw new Error('Customer has no email');
  }

  // Find user by email
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    console.log(`[Webhook] User not found for email: ${email}`);
    return;
  }

  // Check if payment method already exists
  const existing = await db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.stripe_payment_method_id, paymentMethod.id))
    .limit(1);

  if (existing.length > 0) {
    console.log('[Webhook] Payment method already exists, skipping');
    return;
  }

  // Create payment method record
  if (paymentMethod.card) {
    await db.insert(paymentMethods).values({
      user_id: user.id,
      stripe_payment_method_id: paymentMethod.id,
      card_brand: paymentMethod.card.brand,
      card_last4: paymentMethod.card.last4,
      card_exp_month: paymentMethod.card.exp_month,
      card_exp_year: paymentMethod.card.exp_year,
      is_default: customer.invoice_settings.default_payment_method === paymentMethod.id,
      created_at: new Date(),
    });

    console.log(`[Webhook] Created payment method for user ${user.id}`);
  }
}

/**
 * Handle payment_method.detached event
 */
async function handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod) {
  console.log(`[Webhook] Processing payment_method.detached: ${paymentMethod.id}`);

  // Delete payment method record
  await db
    .delete(paymentMethods)
    .where(eq(paymentMethods.stripe_payment_method_id, paymentMethod.id));

  console.log(`[Webhook] Deleted payment method`);
}

export default router;
