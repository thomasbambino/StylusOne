# Subscription System Setup Guide

This guide will help you set up the complete subscription and billing system for your Homelab Dashboard.

## Overview

The subscription system includes:
- **Stripe Integration** - Payment processing and subscription management
- **Subscription Plans** - Configurable plans with custom features
- **Feature Gates** - Access control based on subscription
- **Invoice Management** - Automatic invoice generation and downloads
- **First-Time Onboarding** - Subscription selection during signup
- **Admin Dashboard** - MRR analytics and subscriber management

## Prerequisites

1. **Stripe Account** - Sign up at https://stripe.com
2. **PostgreSQL Database** - Running instance for storing subscription data
3. **Node.js 20+** - For running the application

## Step 1: Configure Stripe

### Create Stripe Account
1. Go to https://dashboard.stripe.com/register
2. Complete registration
3. Verify your email

### Get API Keys
1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy your **Publishable key** (starts with `pk_test_`)
3. Copy your **Secret key** (starts with `sk_test_`)

### Set Up Webhook
1. Go to https://dashboard.stripe.com/test/webhooks
2. Click **Add endpoint**
3. Enter your webhook URL: `https://yourdomain.com/api/webhooks/stripe`
4. Select events to listen for:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `payment_method.attached`
   - `payment_method.detached`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)

## Step 2: Configure Environment Variables

Add the following to your `.env` file:

```bash
# Stripe Payment Processing
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

For production (`.env.production`):
```bash
# Use live keys for production
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key_here
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_your_stripe_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

## Step 3: Run Database Migrations

Create the subscription tables in your database:

```bash
npm run db:push
```

This will create the following tables:
- `subscriptionPlans` - Subscription plan definitions
- `userSubscriptions` - User subscription records
- `invoices` - Billing history
- `paymentMethods` - Saved payment methods

## Step 4: Create Subscription Plans

### Option A: Via Super Admin UI

1. Log in as a super admin
2. Navigate to **Menu → Subscription Plans**
3. Click **Create Plan**
4. Fill in plan details:
   - **Name**: e.g., "Basic", "Premium", "Enterprise"
   - **Description**: What's included in the plan
   - **Monthly Price**: Price in dollars (e.g., 9.99)
   - **Annual Price**: Price in dollars (e.g., 99.99)
   - **Features**: Toggle which features are included
     - Plex Access
     - Live TV Access
     - Books Access
     - Game Servers Access
     - Max Favorite Channels
   - **Active**: Whether plan is available for purchase
   - **Sort Order**: Display order (0 = first)
5. Click **Create Plan**
6. The system will automatically create the Stripe product and prices

### Option B: Via Database/API

```sql
INSERT INTO "subscriptionPlans" (
  name,
  description,
  price_monthly,
  price_annual,
  features,
  is_active,
  sort_order
) VALUES (
  'Basic',
  'Essential features for home entertainment',
  999,  -- $9.99 in cents
  9999,  -- $99.99 in cents
  '{"plex_access": true, "live_tv_access": false, "books_access": true, "game_servers_access": false, "max_favorite_channels": 10}',
  true,
  0
);
```

## Step 5: Test the System

### Test in Development

1. Start the application:
   ```bash
   npm run dev
   ```

2. Access the application at http://localhost:5000

3. Test subscription flow:
   - Create a new user account
   - Go through first-time setup dialog
   - Select a subscription plan
   - Use Stripe test card: `4242 4242 4242 4242`
   - Any future expiration date
   - Any 3-digit CVC

### Test Stripe Webhooks Locally

Use Stripe CLI to forward webhooks to your local server:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe  # macOS
# or download from https://stripe.com/docs/stripe-cli

# Login
stripe login

# Forward webhooks
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

Copy the webhook signing secret and update your `.env`:
```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Test Cards

Stripe provides test cards for different scenarios:

- **Successful payment**: `4242 4242 4242 4242`
- **Payment requires authentication**: `4000 0025 0000 3155`
- **Payment declined**: `4000 0000 0000 9995`
- **Insufficient funds**: `4000 0000 0000 9995`

Full list: https://stripe.com/docs/testing

## Step 6: Deploy to Production

### Update Environment Variables

In your production `.env`:

```bash
# Switch to live Stripe keys
STRIPE_SECRET_KEY=sk_live_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...  # From production webhook
```

### Set Up Production Webhook

1. Go to https://dashboard.stripe.com/webhooks (live mode)
2. Add endpoint with your production URL
3. Select same events as test mode
4. Update `STRIPE_WEBHOOK_SECRET` with new signing secret

### Deploy

```bash
# Build the application
npm run build

# Deploy using Docker
docker-compose build
docker-compose up -d

# Or deploy to your hosting platform
```

## Step 7: Activate Live Mode

1. **Complete Stripe Activation**:
   - Go to https://dashboard.stripe.com/settings/account
   - Complete business information
   - Verify identity
   - Add bank account

2. **Enable Live Mode** in Stripe Dashboard

3. **Test Production Flow**:
   - Create a test subscription with a real card
   - Verify webhook events are received
   - Check invoice generation
   - Test cancellation flow

## Features

### Super Admin Features

- **Subscription Plans Management** (`/subscription-plans`)
  - Create/edit/delete plans
  - Set pricing and features
  - View subscriber count per plan
  - MRR (Monthly Recurring Revenue) analytics
  - Sync with Stripe automatically

- **Analytics Dashboard**
  - Total MRR
  - Active subscribers
  - Subscriber breakdown by plan
  - Subscription status distribution

### User Features

- **My Subscription** (`/my-subscription`)
  - View current plan and features
  - Subscribe to a plan
  - Upgrade/downgrade plans
  - Switch billing period (monthly/annual)
  - Cancel subscription
  - Reactivate canceled subscription
  - Update payment method
  - View billing history
  - Download invoices

- **Feature Access Control**
  - Automatic restriction based on subscription
  - Upgrade prompts for locked features
  - Seamless access when subscribed

- **First-Time Setup**
  - Subscription plan selection during onboarding
  - Clear feature comparison
  - Optional - can subscribe later

## Subscription Features

Configure what users get with each plan:

- **Plex Access** - Access to Plex media server
- **Live TV Access** - IPTV streaming
- **Books Access** - E-book library
- **Game Servers Access** - Game server management
- **Max Favorite Channels** - Number of IPTV favorites allowed

## Troubleshooting

### Webhooks Not Working

**Check webhook secret:**
```bash
# Test webhook signature
curl -X POST localhost:5000/api/webhooks/stripe \
  -H "stripe-signature: test" \
  -d '{}'
```

**View webhook logs in Stripe:**
- Go to https://dashboard.stripe.com/test/webhooks
- Click on your webhook endpoint
- View delivery attempts and responses

### Subscription Not Creating

**Check logs:**
```bash
# View server logs
docker-compose logs app -f

# Look for Stripe errors
grep -i "stripe" logs
```

**Common issues:**
- Invalid API keys
- Incorrect price IDs
- Missing payment method
- Webhook secret mismatch

### Payment Failing

**Verify:**
1. Stripe keys are correct (test vs live)
2. Customer exists in Stripe
3. Payment method is attached
4. No restrictions on account

**Test in Stripe Dashboard:**
- Go to https://dashboard.stripe.com/test/payments
- Create a manual payment intent
- Use test card to verify setup

### Feature Gates Not Working

**Check:**
1. User has active subscription: `GET /api/subscriptions/current`
2. Plan includes required feature
3. Subscription status is "active"
4. Browser cache cleared

**Debug:**
```bash
# Check user subscription in database
psql -d gamelab -c "SELECT * FROM \"userSubscriptions\" WHERE user_id = YOUR_USER_ID;"

# Check plan features
psql -d gamelab -c "SELECT * FROM \"subscriptionPlans\";"
```

## Best Practices

1. **Always test in Stripe test mode first**
2. **Set up webhook monitoring** - Use tools like Sentry or Stripe's built-in monitoring
3. **Handle failed payments gracefully** - Send email notifications, show grace period
4. **Regular backup of subscription data** - Critical business data
5. **Monitor MRR trends** - Track growth and churn
6. **Clear communication** - Inform users before billing
7. **Compliance** - Follow PCI DSS requirements, store no card data

## Support

### Resources

- **Stripe Documentation**: https://stripe.com/docs
- **Stripe Test Cards**: https://stripe.com/docs/testing
- **Webhook Testing**: https://stripe.com/docs/webhooks/test
- **Stripe CLI**: https://stripe.com/docs/stripe-cli

### Common Questions

**Q: Can I offer free trials?**
A: Yes, use Stripe's trial period feature when creating subscriptions.

**Q: Can I offer discounts/coupons?**
A: Yes, create coupons in Stripe and apply during checkout.

**Q: How do I handle refunds?**
A: Refunds can be issued through Stripe Dashboard or API.

**Q: Can users have multiple subscriptions?**
A: Currently no, one subscription per user. Can be customized.

**Q: How do I migrate existing users?**
A: Create subscription records manually or via bulk import script.

## Next Steps

1. Create your subscription plans
2. Test the complete flow with test cards
3. Set up monitoring and alerts
4. Configure email notifications for subscription events
5. Customize plan features for your needs
6. Launch and promote your subscription tiers!
