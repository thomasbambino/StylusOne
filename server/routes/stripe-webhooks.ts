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
    console.error('STRIPE_WEBHOOK_SECRET not configured');
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
    console.error('Webhook signature verification failed:', err);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log(`Received Stripe webhook: ${event.type}`);

  try {
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
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Handle customer.subscription.created event
 */
async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  console.log('Processing subscription created:', subscription.id);

  // Subscription should already exist in DB from createSubscription()
  // But update it with latest data from Stripe
  const existingSubscription = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, subscription.id))
    .limit(1);

  if (existingSubscription.length > 0) {
    await db
      .update(userSubscriptions)
      .set({
        status: subscription.status,
        current_period_start: new Date(subscription.current_period_start * 1000),
        current_period_end: new Date(subscription.current_period_end * 1000),
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
  console.log('Processing subscription updated:', subscription.id);

  const existingSubscription = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, subscription.id))
    .limit(1);

  if (existingSubscription.length === 0) {
    console.error('Subscription not found in database:', subscription.id);
    return;
  }

  await db
    .update(userSubscriptions)
    .set({
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000),
      current_period_end: new Date(subscription.current_period_end * 1000),
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      updated_at: new Date(),
    })
    .where(eq(userSubscriptions.id, existingSubscription[0].id));
}

/**
 * Handle customer.subscription.deleted event
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('Processing subscription deleted:', subscription.id);

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
  console.log('Processing invoice paid:', invoice.id);

  if (!invoice.subscription) {
    console.log('Invoice has no subscription, skipping');
    return;
  }

  // Get the subscription from our database
  const subscription = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, invoice.subscription as string))
    .limit(1);

  if (subscription.length === 0) {
    console.error('Subscription not found for invoice:', invoice.subscription);
    return;
  }

  // Check if invoice already exists (idempotency)
  const existingInvoice = await db
    .select()
    .from(invoices)
    .where(eq(invoices.stripe_invoice_id, invoice.id))
    .limit(1);

  if (existingInvoice.length > 0) {
    console.log('Invoice already exists in database, updating status');
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
  console.log('Processing invoice payment failed:', invoice.id);

  if (!invoice.subscription) {
    return;
  }

  const subscription = await db
    .select()
    .from(userSubscriptions)
    .where(eq(userSubscriptions.stripe_subscription_id, invoice.subscription as string))
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
  console.log('Processing payment method attached:', paymentMethod.id);

  // Payment method should be saved when subscription is created
  // This is just for logging
}

/**
 * Handle payment_method.detached event
 */
async function handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod) {
  console.log('Processing payment method detached:', paymentMethod.id);

  // Remove payment method from database
  await db
    .delete(paymentMethods)
    .where(eq(paymentMethods.stripe_payment_method_id, paymentMethod.id));
}

export default router;
