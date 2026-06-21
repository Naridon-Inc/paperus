# 07. Billing & Subscriptions: Beyond the App Store

This document outlines how Naridon will monetize standalone web users.

## 1. Billing Engines

### 1.1 App Store Billing
*   **Shopify Billing API**: Used for embedded users. Charges appear on the Shopify invoice.
*   **Shopware Billing**: Integrated into the Shopware Cloud.

### 1.2 SaaS Billing
*   **Stripe**: Integrated for `web.naridon.com` users. Handles credit cards, invoices, and tax.

## 2. Entitlement Logic (`backend/libs/shared/entitlements`)

We will create a unified **Entitlement Service** that abstracts away the source of the payment.

**Logic:**
```typescript
async function canRunScan(projectId: string): Promise<boolean> {
  const project = await repo.findById(projectId);
  if (project.platform === 'SHOPIFY') {
    return shopifyBilling.hasActivePlan(project);
  } else {
    return stripeBilling.hasActiveSubscription(project.orgId);
  }
}
```

## 3. Pricing Tiers (Unified)
*   **Free**: 1 Project, 5 Resources, Weekly scans.
*   **Pro**: 3 Projects, 100 Resources, Daily scans, Social Sentiment.
*   **Agency**: Unlimited Projects, White-labeling.

## 4. Migration Plan
1.  **Stripe Adapter**: Create a new library in `backend/libs/platform/stripe`.
2.  **Organization Model**: Map billing status to the `Organization` level rather than individual `Shops`.
3.  **Checkout Flow**: Build a custom checkout page in the standalone React app.
