# Shopify App Submission Verification Guide

This guide helps you verify that the application meets all Shopify App Store requirements before submission.

## 1. Functionality Verification

### Authentication & Session Tokens
**Requirement:** Must authenticate immediately and use session tokens.
*   **Implementation**: `@naridon/platform-shopify` (Backend) and `@shopify/app-bridge-react` (Frontend).
*   **Verify**:
    1.  Install the app on a development store.
    2.  Check Network tab: Requests to `/api/*` should include `Authorization: Bearer <token>`.
    3.  Backend logs should show successful `verifyRequest` calls in `ShopifyAuthAdapter`.

### Billing API
**Requirement:** Must use Shopify Billing.
*   **Implementation**: `ShopifyBillingAdapter` in `@naridon/infrastructure`.
*   **Verify**:
    1.  Check `backend/infrastructure/src/platform/shopify-billing-adapter.ts`.
    2.  Ensure `CreateSubscriptionUseCase` is called during onboarding or plan upgrades.
    3.  Test upgrading/downgrading plans in the UI.

### Webhooks & GDPR
**Requirement:** Data synchronization and GDPR compliance.
*   **Implementation**: `backend/delivery/platform/shopify/src/routes/webhooks.ts`.
*   **Verify**:
    1.  Go to **Shopify Partner Dashboard -> App Setup**.
    2.  Ensure the following webhooks are registered (or handled via Event Bridge):
        *   `app/uninstalled` -> Triggers `UninstallShopUseCase`.
        *   `customers/data_request` (GDPR)
        *   `customers/redact` (GDPR)
        *   `shop/redact` (GDPR)
    3.  Check that the URLs point to your production endpoint: `https://<YOUR-DOMAIN>/webhooks/shopify/...`

## 2. Listing & Marketing Assets

### App Icon & Branding
*   **Icon**: 1200x1200px, no text, distinct branding.
*   **Name**: "Naridon" (Must match throughout the app).
*   **Description**: Clear, benefit-oriented.

### Screencast / Demo
*   Record a 1-2 minute video showing:
    1.  Installation/Onboarding.
    2.  Core feature usage (Monitoring Dashboard).
    3.  Plan selection (Billing).

## 3. Production Deployment Checklist (Prerequisites)

### SSL Certificate
**Requirement**: Valid HTTPS with no errors.
*   **Action**: Ensure your production domain (`app.naridon.com`) has a valid SSL certificate (managed by your hosting provider like Render/Railway/AWS).

### Environment Variables
Ensure these are set in production:
*   `SHOPIFY_API_KEY`
*   `SHOPIFY_API_SECRET`
*   `SHOPIFY_APP_URL` (Must match the App URL in Partner Dashboard)
*   `SCOPES` (e.g., `read_products,write_products,read_content`)

## 4. Common Rejection Reasons to Avoid

1.  **Broken Auth Loop**: If the app redirects indefinitely.
    *   *Fix*: Ensure `frontend/apps/shopify-new` handles the OAuth redirect correctly.
2.  **Leftover Placeholder Content**: "Lorem Ipsum" or "Test" text in the UI.
    *   *Fix*: Review all UI text strings.
3.  **Missing Setup Instructions**: If the app requires theme setup.
    *   *Fix*: Since Naridon is an embedded app/dashboard, ensure the dashboard is self-explanatory.
4.  **Slow Performance**: App takes > 5s to load.
    *   *Fix*: Production build serves optimized static assets.

## 5. Submission Steps

1.  **Deploy** the Production Build (Docker container).
2.  **Update** Partner Dashboard URLs.
3.  **Test** on a fresh Development Store (as if you were a new user).
4.  **Fill** out the Listing form.
5.  **Submit** for review.
