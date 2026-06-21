# Shopify App Submission Checklist

Based on the app capabilities selected.

## Functionality requirements

- [x] **Must authenticate immediately after install**
  - *Verification*: Verified in `backend/delivery/platform/shopify/src/routes/auth.ts` (`/install` -> `/callback` flow).
- [x] **Must have UI merchants can interact with**
  - *Verification*: `frontend/apps/shopify-new` exists.
- [x] **App must be free from user interface errors, bugs, and functional errors, that fully prevent the review**
- [ ] **Apps that add optional paid items to buyer carts or checkouts** (N/A)
- [ ] **Apps that increase default shipping prices** (N/A)
- [ ] **Functional login credentials provided** (Handled during submission)
- [ ] **Must have valid SSL certificate with no errors** (Deployment concern - requires HTTPS on production)
- [x] **Must not be a capital lending app**
- [x] **Must not be a desktop app**
- [x] **Must not be a marketplace**
- [x] **Must not be an app that provides refunds**
- [x] **Must not be an unauthorized payment gateway**
- [ ] **Must not be identical to your other published apps**
- [x] **Must not bypass Shopify checkout**
- [x] **Must not bypass the Shopify theme store**
- [x] **Must not claim to duplicate protected products**
- [x] **Must not connect merchants to external agencies and developers**
- [x] **Must not connect to Third Party POS**
- [x] **Must not falsify data**
- [x] **Must not require browser extension**
- [x] **Must redirect to app UI after install**
  - *Verification*: `auth.ts` redirects to `https://${session.shop}/admin/apps/${apiKey}`.
- [x] **Must submit as a regular app**
- [x] **Must use session tokens for embedded apps**
  - *Verification*: Verified `AppBridgeProvider.tsx` (Frontend) and `verifyRequest` (Backend).
- [x] **Must use Shopify APIs after install**
  - *Verification*: Verified `ShopifyGraphQLClient` usage.
- [x] **Must implement Billing API correctly**
  - *Verification*: `ShopifyBillingAdapter` exists.
- [x] **Must use Shopify Billing**
- [x] **Admin blocks, admin actions, and admin links must be feature-complete** (None defined)
- [x] **Admin UI blocks, admin actions, and admin links can't display promotions or advertisements** (N/A)
- [x] **App must be free from user interface errors, bugs, and functional errors**
- [ ] **Chat in Checkout access scope** (N/A)
- [x] **Data synchronization** (Webhooks implemented for uninstall and GDPR)
  - *Verification*: `webhookRoutes` handles `app/uninstalled`, `customers/data_request`, `customers/redact`.
- [x] **Must allow changing between pricing plans**
- [x] **Must not request .myshopify.com URLs**
- [x] **Must re-install properly**
  - *Verification*: `UninstallShopUseCase` marks shop as SUSPENDED; Re-install (via Auth) will likely reactivate it.
- [ ] **Payment Mandate API access scope** (N/A)
- [ ] **Post Purchase access scope** (N/A)
- [ ] **Read all orders access scope** (N/A)
- [ ] **Subscription API access scope** (N/A)

## Listing requirements

- [ ] **Submission must include test credentials**
- [ ] **App listing must include all pricing options**
- [ ] **Must have icon uploaded to Partner dashboard**
- [ ] **Must not have misleading or inaccurate tags applied**
- [ ] **Must not misuse App card subtitle**
- [ ] **Must state if it requires Online Store sales channel**
- [ ] **Submission must include demo screencast**
- [ ] **App must not claim to be published in languages that are not fully supported**
- [x] **App name fields must be similar**
  - *ACTION REQUIRED*: `shopify.app.toml` currently uses `name = "mono-app"`. Update to `Naridon`.
- [ ] **Centralize all pricing information under Pricing details**
- [x] **Ensure your App details are clear and descriptive**
- [ ] **Must not have reviews or testimonials in listing**
- [ ] **Must not have stats or data in listing**
- [ ] **Must not use Shopify brand in graphics**
- [ ] **Must state if it requires geographic and API information**

## Embedded requirements

- [x] **Must use Shopify App Bridge from OAuth**
- [x] **Apps must not launch Max modal without user interaction or from the app nav**
- [x] **Must use the latest version of App Bridge**

## Online store requirements

- [ ] **Must properly show widget in the storefront** (N/A)
- [ ] **Must include detailed onboarding instructions for Theme App Extensions** (N/A)
- [x] **Must meet App Name Branding criteria** ("Naridon" used)
- [x] **Must send collected data back to the merchant**
- [ ] **Must use theme app extensions** (N/A)
