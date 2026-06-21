# Testing Subscriptions with Newly Installed Partners App

## Quick Start Guide

This guide walks you through testing app subscriptions after installing your app through Shopify Partners (not as a custom app).

---

## 🤖 Automated Testing

**Quick Test Script Available!**

Run the automated test script to verify everything is set up:

```bash
# Option 1: Using npx (recommended)
npx tsx backend/scripts/test-subscription.ts <shop-domain>

# Option 2: Using pnpm exec
cd backend
pnpm exec tsx scripts/test-subscription.ts <shop-domain>
```

This script automatically:

- ✅ Verifies shop exists in database
- ✅ Checks app installation (Partner-owned)
- ✅ Lists active subscriptions
- ✅ Tests subscription creation
- ✅ Validates database state

See `backend/scripts/README_SUBSCRIPTION_TEST.md` for details.

---

## 📖 Installation Guide

**⚠️ Important:** Before testing subscriptions, ensure your app is installed through Shopify Partners (not as a custom app).

**See detailed guide:** [`INSTALL_APP_PARTNERS.md`](../INSTALL_APP_PARTNERS.md)

**Quick steps:**

1. Go to Partners dashboard → Your app → "Test on development store"
2. Select your dev store and install
3. Verify "Manage in Partners" link appears in store admin
4. Run test script to verify: `pnpm test:subscription <shop-domain>`

---

## ✅ Pre-Flight Checks

Before testing subscriptions, verify everything is set up correctly:

### 1. Verify App Installation

**In your dev store admin:**

1. Go to **Settings** → **Apps and sales channels**
2. Find "mono-app"
3. ✅ **Should see**: "Manage in Partners" link
4. ❌ **Should NOT see**: "This app is not listed in the Shopify App Store" warning

If you see the warning, the app wasn't installed through Partners. Reinstall it.

### 2. Check App Status via API

Call the app status endpoint to verify billing capability:

```bash
GET /api/v1/billing/app-status
Authorization: Bearer <your-embed-token>
```

**Expected Response:**

```json
{
  "message": "App status check",
  "canCreateBilling": true, // ✅ Should be true
  "billingError": null // ✅ Should be null
}
```

If `canCreateBilling` is `false`, check the `billingError` field for details.

### 3. Verify Test Mode

Your app automatically uses test mode when `NODE_ENV !== "production"`. Check your backend logs - you should see:

```
Subscribe endpoint: Processing subscription request {
  shopId: "...",
  planName: "Starter Plan",
  isTest: true  // ✅ Should be true
}
```

---

## 🧪 Step-by-Step Testing

### Test 1: Basic Subscription Flow

#### Step 1: Navigate to Pricing Page

1. Open your app in the dev store
2. Go to `/pricing` or `/app/pricing`
3. You should see the pricing plans (Free, Starter, Growth, Enterprise)

#### Step 2: Select a Paid Plan

1. Click on any paid plan (e.g., "Starter Plan")
2. The app will:
   - Call `POST /api/v1/billing/subscribe`
   - Create a test subscription in Shopify
   - Return a `confirmationUrl`

#### Step 3: Approve Subscription

1. You'll be redirected to Shopify's confirmation page
2. Click **"Approve"** or **"Confirm"**
3. **No real charge will occur** (test mode)
4. You'll be redirected back to your app

#### Step 4: Verify Subscription

1. **In your app**: Pricing page should show "Current Plan: Starter Plan"
2. **In Shopify Admin**:
   - Go to **Settings** → **Billing** → **App subscriptions**
   - You should see a subscription with a **"Test"** badge
   - Status should be **"Active"**

#### Step 5: Check Database

```sql
SELECT * FROM "ShopPlanLimit"
WHERE "shopId" = '<your-shop-id>'
ORDER BY "updatedAt" DESC;

-- Should show:
-- - planName: "Starter Plan"
-- - active: true
-- - updatedAt: recent timestamp
```

---

### Test 2: Check Current Plan via API

```bash
GET /api/v1/billing/plan
Authorization: Bearer <your-embed-token>
```

**Expected Response:**

```json
{
  "activePlan": "Starter Plan",
  "planLimits": {
    "prompts": 10,
    "products": 100,
    "competitors": 5,
    "fixes": 5,
    "mentions": 1000,
    "daily_scans": 1,
    "autopilot_frequency_days": 7
  },
  "currentUsage": {
    "prompts": 0,
    "products": 0,
    "competitors": 0,
    "fixes": 0,
    "mentions": 0
  }
}
```

---

### Test 3: Monthly vs Annual Plans

1. On the pricing page, toggle between **Monthly** and **Annual**
2. Select a plan (e.g., Starter Plan)
3. **Monthly**: Should create subscription with name `"Starter Plan"`
4. **Annual**: Should create subscription with name `"Starter Plan (Annual)"`
5. Verify the correct plan name in:
   - Shopify admin → Billing
   - Database (`ShopPlanLimit` table)
   - API response (`/api/v1/billing/plan`)

---

### Test 4: Plan Upgrade

1. Start with **Starter Plan** (from Test 1)
2. Go to pricing page
3. Select **Growth Plan**
4. Approve the new subscription
5. **Verify**:
   - Old subscription should be cancelled
   - New subscription should be active
   - Database should show "Growth Plan"
   - API should return "Growth Plan"

---

### Test 5: Plan Downgrade

1. Start with **Growth Plan** (from Test 4)
2. Go to pricing page
3. Select **Starter Plan**
4. Approve the new subscription
5. **Verify**:
   - Old subscription should be cancelled
   - New subscription should be active
   - Database should show "Starter Plan"

---

### Test 6: Cancel to Free Plan

1. Start with any paid plan (e.g., Starter Plan)
2. Go to pricing page
3. Click **"Downgrade to Free"** or select **Free Plan**
4. **Verify**:
   - Active subscription should be cancelled
   - Database should show "Free Plan"
   - API should return "Free Plan"
   - Shopify admin should show subscription as cancelled

---

## 🔍 Verification Checklist

After each test, verify:

- [ ] Subscription appears in Shopify admin → Settings → Billing → App subscriptions
- [ ] Subscription has "Test" badge (test mode)
- [ ] Subscription status is "Active" (for paid plans)
- [ ] Database (`ShopPlanLimit`) is updated with correct plan name
- [ ] API endpoint (`/api/v1/billing/plan`) returns correct plan
- [ ] App pricing page shows "Current Plan" correctly
- [ ] Backend logs show successful subscription creation

---

## 🐛 Troubleshooting

### Issue: "APP REINSTALLATION REQUIRED" Error

**Symptoms:**

- Error message about app needing to be reinstalled
- App shows "not listed in the Shopify App Store" warning

**Solution:**

1. Uninstall the app from dev store
2. Reinstall through Partners dashboard
3. Use the Partners installation URL (not custom app)

---

### Issue: Subscription Not Creating

**Check:**

1. Backend logs for error messages
2. `GET /api/v1/billing/app-status` - check `canCreateBilling` field
3. Verify app has billing scopes in Partners dashboard
4. Check if test mode is enabled (check logs for `isTest: true`)

**Common Causes:**

- App not properly installed through Partners
- Missing billing scopes
- API credentials mismatch

---

### Issue: Plan Not Updating After Subscription

**Check:**

1. Wait a few seconds (webhook may be delayed)
2. Check backend logs for webhook processing:
   ```
   Received app_subscriptions/update webhook
   Updated ShopPlanLimit from webhook
   ```
3. Call `GET /api/v1/billing/plan` - fallback sync should update DB
4. Check database directly

**If webhook missed:**

- The fallback sync will update DB on next `/plan` call
- Check logs for "Synced subscription to DB (fallback)"

---

### Issue: Redirect Not Working

**Check:**

1. `returnUrl` length (must be < 255 characters)
2. Browser console for redirect errors
3. Backend logs for `confirmationUrl` in response
4. Verify `confirmationUrl` is a valid Shopify URL

---

## 📊 Monitoring & Logs

### Backend Logs to Watch

**Successful Subscription:**

```
Subscribe endpoint: Processing subscription request {
  shopId: "...",
  planName: "Starter Plan",
  returnUrl: "...",
  isTest: true
}
Subscribe endpoint: Subscription created successfully {
  confirmationUrl: "https://..."
}
```

**Webhook Processing:**

```
Received app_subscriptions/update webhook {
  shopDomain: "...",
  subscriptionName: "Starter Plan",
  subscriptionStatus: "ACTIVE"
}
Updated ShopPlanLimit from webhook {
  shopId: "...",
  planName: "Starter Plan"
}
```

**Errors:**

```
Subscribe endpoint: Error creating subscription {
  error: "...",
  planName: "...",
  shopId: "..."
}
```

---

## 🎯 Testing Scenarios Summary

| Scenario              | Action                | Expected Result                                    |
| --------------------- | --------------------- | -------------------------------------------------- |
| **New Subscription**  | Select paid plan      | Subscription created, DB updated, API returns plan |
| **Monthly vs Annual** | Toggle billing period | Correct plan name in subscription                  |
| **Upgrade**           | Select higher tier    | Old cancelled, new active, DB updated              |
| **Downgrade**         | Select lower tier     | Old cancelled, new active, DB updated              |
| **Cancel to Free**    | Select Free plan      | Subscription cancelled, DB shows "Free Plan"       |

---

## ✅ Final Verification

After completing all tests:

1. ✅ App is installed through Partners (has "Manage in Partners" link)
2. ✅ Subscriptions can be created (no errors)
3. ✅ Test mode is working (subscriptions have "Test" badge)
4. ✅ Database updates correctly (webhook + fallback sync)
5. ✅ API endpoints return correct plan information
6. ✅ All subscription flows work (upgrade, downgrade, cancel)

---

## 🚀 Next Steps

Once testing is complete:

1. Set up webhook in Partners dashboard (if not already done)
2. Test in staging environment (if available)
3. Test with real store (still in test mode first)
4. Prepare for production deployment
5. Test subscription lifecycle (activate, cancel, renew, expire)

---

## 📝 Notes

- **Test subscriptions never charge real money**
- **Test mode is automatic** when `NODE_ENV !== "production"`
- **Webhooks may be delayed** - wait a few seconds before checking
- **Fallback sync ensures DB is updated** even if webhook is missed
- **All subscriptions in dev stores are test subscriptions** by default
