# Testing App Subscriptions in Shopify Dev Store

## Overview

Your app automatically uses **test mode** when `NODE_ENV !== "production"`. Test subscriptions don't charge real money and are perfect for development and testing.

## Database Updates After Subscription

✅ **YES - Database is automatically updated** after subscription completion via:

1. **Webhook Handler** (Primary method):
   - Shopify sends `app_subscriptions/update` webhook when subscription is approved
   - Webhook handler at `/platform/shopify/webhooks/app_subscriptions/update`
   - Updates `ShopPlanLimit` table with the new plan name
   - Handles both activation and cancellation

2. **Fallback Sync** (Secondary method):
   - When `/api/v1/billing/plan` is called, if no DB record exists but Shopify has an active subscription
   - Automatically syncs the subscription status to database
   - Ensures DB is updated even if webhook is missed or delayed

### Webhook Setup Required

To enable automatic database updates, you need to:

1. Register the webhook in Shopify Partners dashboard
2. Webhook URL: `https://your-app-url.com/api/auth/shopify/webhooks/app_subscriptions/update`
3. Webhook topic: `app_subscriptions/update`
4. The webhook handler will automatically update the database when subscriptions change

## Current Configuration

The app is already configured to use test mode in development:

- `isTest: process.env["NODE_ENV"] !== "production"` (line 373, 443 in billing.ts)
- Test subscriptions are created with `test: true` flag in Shopify GraphQL API

## Step-by-Step Testing Guide

### 1. Set Up Development Store

1. **Create a Development Store**:
   - Go to https://partners.shopify.com
   - Navigate to **Stores** → **Add store** → **Development store**
   - Choose "Development store" type
   - Fill in store details and create

2. **Install Your App**:
   - In your dev store admin, go to **Settings** → **Apps and sales channels**
   - Click **Develop apps** → **Allow custom app development**
   - Or install your app via the app URL

### 2. Verify Test Mode is Active

Check your backend logs when creating a subscription. You should see:

```
Subscribe endpoint: Processing subscription request { isTest: true }
```

Or check the console:

```bash
# In your terminal where the backend is running
# Look for: "Test Mode: true"
```

### 3. Test Subscription Flow

#### A. Test Paid Plan Subscription

1. **Navigate to Pricing Page**:
   - Open your app in the dev store
   - Go to `/app/pricing` or your pricing route

2. **Select a Plan**:
   - Click on any paid plan (Starter, Growth, or Enterprise)
   - The app will:
     - Call `/api/v1/billing/subscribe`
     - Create a test subscription in Shopify
     - Redirect to Shopify's confirmation page

3. **Confirm Subscription**:
   - On Shopify's confirmation page, click **Approve**
   - You'll be redirected back to your app
   - **No real charge will occur** (test mode)

4. **Verify Subscription**:
   - Check your app's pricing page - should show "Current Plan"
   - Check Shopify admin → **Settings** → **Billing**
   - You should see a test subscription (marked as "Test")

#### B. Test Free Plan (Downgrade)

1. **If you have an active subscription**:
   - Click "Downgrade to Free" on the pricing page
   - The app will:
     - Cancel the active subscription
     - Update DB to Free Plan
     - Refresh the page

2. **Verify**:
   - Pricing page should show Free Plan as active
   - Shopify admin should show subscription as cancelled

### 4. Check Subscription Status

#### Via API:

```bash
GET /api/v1/billing/plan
Authorization: Bearer <your-token>
```

Response:

```json
{
  "activePlan": "Starter Plan",
  "planLimits": { ... },
  "currentUsage": { ... }
}
```

#### Via Shopify Admin:

1. Go to your dev store admin
2. **Settings** → **Billing**
3. Look for **App subscriptions**
4. Test subscriptions will be marked with "Test" badge

### 5. Test Different Scenarios

#### Scenario 1: Monthly vs Annual

- Toggle between Monthly/Annual
- Verify correct plan name is sent:
  - Monthly: `"Starter Plan"`
  - Annual: `"Starter Plan (Annual)"`

#### Scenario 2: Plan Upgrade

- Start with Starter Plan
- Upgrade to Growth Plan
- Verify old subscription is cancelled and new one is created

#### Scenario 3: Plan Downgrade

- Start with Growth Plan
- Downgrade to Starter Plan
- Verify subscription is updated correctly

#### Scenario 4: Cancel to Free

- Start with any paid plan
- Select Free Plan
- Verify subscription is cancelled and DB updated

## Important Notes

### Test Mode Behavior

✅ **What Works in Test Mode**:

- Creating subscriptions
- Cancelling subscriptions
- Checking subscription status
- All billing API calls

❌ **What Doesn't Work**:

- Real charges (no money is charged)
- Production webhooks (test subscriptions have different webhook payloads)
- Some Shopify admin features may show test subscriptions differently

### Test Subscription Limitations

1. **No Real Charges**: Test subscriptions never charge real money
2. **Auto-Approval**: In some cases, test subscriptions may auto-approve
3. **Webhook Testing**: Test subscription webhooks may have different structure
4. **Expiration**: Test subscriptions may behave differently regarding expiration

### Environment Variables

Current setup:

```bash
# Test mode is automatically enabled when:
NODE_ENV=development  # or any value other than "production"

# To force test mode even in production (optional):
SHOPIFY_APP_TEST_CHARGES=true
```

### Debugging

#### Check Test Mode Status:

```bash
# Backend logs will show:
Subscribe endpoint: Processing subscription request {
  shopId: "...",
  planName: "Starter Plan",
  isTest: true  # <-- This confirms test mode
}
```

#### Check Subscription in Shopify:

1. Go to dev store admin
2. **Settings** → **Billing** → **App subscriptions**
3. Look for subscriptions with "Test" badge
4. Click to see details

#### Check Database:

```sql
-- Check ShopPlanLimit table
SELECT * FROM "ShopPlanLimit" WHERE "shopId" = '<your-shop-id>';

-- Should show current plan name
```

## Troubleshooting

### Issue: "App needs to be migrated to Partners"

**Solution**:

- App must be Partner-owned (not Shop-owned)
- See `/api/v1/billing/app-status` for instructions

### Issue: Subscription not showing in Shopify

**Solution**:

- Check if test mode is enabled (check logs)
- Verify app is Partner-owned
- Check Shopify admin → Billing (test subscriptions may be in a separate section)

### Issue: Redirect not working

**Solution**:

- Check `returnUrl` length (must be < 255 chars)
- Verify `confirmationUrl` is returned from API
- Check browser console for redirect errors

### Issue: Plan not updating after subscription

**Solution**:

- Wait a few seconds (Shopify webhook may be delayed)
- Check `/api/v1/billing/plan` endpoint
- Verify ShopPlanLimit in database

## Testing Checklist

- [ ] Create development store
- [ ] Install app in dev store
- [ ] **Set up webhook** (see Webhook Setup section above)
- [ ] Verify test mode is active (check logs)
- [ ] Test Starter Plan subscription
- [ ] **Verify database updated** (check ShopPlanLimit table)
- [ ] Test Growth Plan subscription
- [ ] Test Annual plan toggle
- [ ] Test Free plan downgrade
- [ ] Verify subscription in Shopify admin
- [ ] Verify plan status in app
- [ ] Test plan upgrade flow
- [ ] Test plan downgrade flow
- [ ] **Verify webhook received** (check backend logs for webhook processing)

## Verifying Database Updates

### Check Database After Subscription:

```sql
-- Check ShopPlanLimit table
SELECT * FROM "ShopPlanLimit"
WHERE "shopId" = '<your-shop-id>'
ORDER BY "updatedAt" DESC;

-- Should show:
-- - planName: "Starter Plan" (or selected plan)
-- - active: true
-- - updatedAt: recent timestamp
```

### Check Webhook Logs:

Look for these log messages in your backend:

```
Received app_subscriptions/update webhook
Updated ShopPlanLimit from webhook
```

### Manual Verification:

1. **After subscription approval**:
   - Wait a few seconds for webhook
   - Call `GET /api/v1/billing/plan`
   - Should return the new plan name

2. **If webhook missed**:
   - The fallback sync will update DB on next `/plan` call
   - Check logs for "Synced subscription to DB (fallback)"

## Next Steps

Once testing is complete:

1. Test in staging environment (if available)
2. Test with real store (use test mode first)
3. Prepare for production deployment
4. Set up webhook handlers for subscription events
5. Test subscription lifecycle (activate, cancel, renew)
