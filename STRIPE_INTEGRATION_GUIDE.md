# Stripe Integration Guide

## Overview

The Stripe integration is now fully implemented and ready to use. This guide explains how to configure your Stripe products and enable payment processing.

## What's Been Implemented

### 1. Database Schema
- **stripe_products** table: Stores product configurations for three tiers (Starter, Professional, Enterprise)
- **stripe_customers** table: Links Supabase users to Stripe customers
- **stripe_subscriptions** table: Tracks subscription status and billing information
- **stripe_orders** table: Records one-time payment transactions

### 2. Edge Functions
- **stripe-checkout**: Creates Stripe checkout sessions
- **stripe-webhook**: Handles Stripe webhook events for payment processing

### 3. Frontend Components
- **StripeProductConfig**: Admin interface to configure Stripe price IDs
- **useStripeCheckout**: Hook for initiating checkout sessions
- **Landing Page**: Dynamic pricing display with checkout integration

## Setup Instructions

### Step 1: Configure Stripe Environment Variables

Make sure these environment variables are set in your Supabase project:
- `STRIPE_SECRET_KEY` - Your Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Webhook signing secret from Stripe
- `VITE_SUPABASE_URL` - Your Supabase project URL (already set)
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anon key (already set)

### Step 2: Create Products in Stripe Dashboard

1. Go to https://dashboard.stripe.com/products
2. Create three products (one for each tier):
   - Starter
   - Professional
   - Enterprise

3. For each product, create TWO prices:
   - One for monthly billing (e.g., $49/month)
   - One for annual billing (e.g., $499/year)

4. Copy the Price IDs (they start with `price_...`)

### Step 3: Configure Price IDs in the App

1. Log in as an agency owner
2. Click "Agency Settings"
3. Navigate to the "Stripe Products" tab
4. For each tier, enter:
   - Monthly Stripe Price ID
   - Annual Stripe Price ID
   - Verify the price amounts match what you set in Stripe
5. Toggle "Active" to enable the tier
6. Click "Save"

### Step 4: Set Up Stripe Webhook

1. Go to https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. Enter your webhook URL:
   ```
   https://[your-project-ref].supabase.co/functions/v1/stripe-webhook
   ```
4. Select these events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Copy the webhook signing secret and add it to your environment variables

### Step 5: Test the Integration

1. Go to your landing page (logged out)
2. You should see the three pricing tiers with the prices you configured
3. Click "Get Started" on any tier
4. If not logged in, you'll be redirected to request access
5. If logged in, you'll be redirected to Stripe Checkout
6. Complete a test transaction using Stripe test card: `4242 4242 4242 4242`
7. Verify the subscription appears in your Stripe dashboard

## How It Works

### Checkout Flow

1. User clicks "Get Started" on the landing page
2. Frontend calls `useStripeCheckout` hook
3. Hook makes a request to the `stripe-checkout` edge function
4. Edge function:
   - Verifies user authentication
   - Creates or retrieves Stripe customer ID
   - Creates a checkout session
   - Returns the Stripe Checkout URL
5. User is redirected to Stripe Checkout
6. After payment, user is redirected back to the app
7. Stripe webhook notifies your app of the successful payment
8. Subscription is synced to your database

### Data Flow

```
Landing Page → useStripeCheckout Hook → stripe-checkout Function
                                              ↓
                                    Stripe Checkout Page
                                              ↓
                                    User Completes Payment
                                              ↓
                                    Stripe Webhook Event
                                              ↓
                              stripe-webhook Function Updates Database
```

## Database Tables Reference

### stripe_products
- `tier_name`: 'starter', 'professional', or 'enterprise'
- `monthly_price_id`: Stripe price ID for monthly billing
- `annual_price_id`: Stripe price ID for annual billing
- `monthly_price_amount`: Price in cents
- `annual_price_amount`: Price in cents
- `features`: JSON array of feature strings
- `is_active`: Whether tier is available for purchase

### stripe_customers
- `user_id`: Links to auth.users
- `customer_id`: Stripe customer ID

### stripe_subscriptions
- `customer_id`: Stripe customer ID
- `subscription_id`: Stripe subscription ID
- `price_id`: Currently active price
- `status`: Subscription status (active, canceled, etc.)
- `current_period_start/end`: Billing period timestamps

## Security Notes

- All Stripe API calls use your secret key securely stored in environment variables
- Webhook signatures are verified to prevent spoofing
- Row Level Security (RLS) ensures users can only view their own data
- Only agency owners can configure products

## Troubleshooting

### "Pricing option not available"
- Check that you've entered the Price ID in the admin panel
- Verify the product is marked as "Active"
- Ensure the Price ID is valid in your Stripe dashboard

### Checkout fails
- Check browser console for errors
- Verify STRIPE_SECRET_KEY is set correctly
- Ensure user is logged in

### Webhook not working
- Verify STRIPE_WEBHOOK_SECRET is set
- Check webhook is configured in Stripe dashboard
- Review edge function logs in Supabase dashboard

## Next Steps

1. Test the entire flow in test mode
2. Switch to live Stripe keys when ready for production
3. Monitor your subscriptions in both Stripe and your database
4. Consider adding a customer portal for users to manage subscriptions
