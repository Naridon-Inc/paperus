# 04. Frontend Hybrid Model: Apps and Shells

This document explains how we will build multiple frontends (Shopify, Web, Chrome Extension) while sharing 100% of the UI logic.

## 1. The "Shell" Concept
The shell is responsible for **Initialization** and **Layout**.

| Shell | Platform | Initialization | Styling |
| :--- | :--- | :--- | :--- |
| **`apps/shopify-new`** | Shopify | App Bridge / Session Tokens | Polaris (Embedded) |
| **`apps/web-app`** | Standalone SaaS | JWT / Cookies | Standard CSS / Polaris |
| **`apps/extension`** | Chrome | Content Script / JWT | Shadow DOM |

### 1.1 CMS Integrations (Ecosystem Mode)
Inside the **`apps/web-app`** shell, users can choose their "Content Source":
*   **Webflow**: User provides an API Token and Site ID.
*   **WordPress**: User installs a plugin or provides Application Credentials.
*   **Benefits**: Fixes can be applied via "One-Click" API calls directly to the CMS.

### 1.2 Custom Websites (Wild Mode)
For sites without a supported CMS (Next.js, Legacy, etc.):
*   **Scraper**: User provides a sitemap URL.
*   **Fixes**: Suggestions are provided as Copy-Paste snippets or GitHub Pull Requests.

## 2. Shared Features Refactor (`packages/shared-features`)

### 2.1 From `Product` to `Resource`
Update all UI labels to use generic terminology based on context.
*   Ecommerce Context: Show "Product Grid" and "Price".
*   Content Context: Show "Page List" and "Word Count".

### 2.2 Navigation Logic
*   The `AppLayout` in `shared-features` must handle different routing engines.
*   **Web**: Uses `window.location`.
*   **Shopify**: Uses `app-bridge.actions.Navigation`.

## 3. Deployment Strategy
*   **Shopify App**: Stays on AWS App Runner (for backend) + Vercel (for frontend proxy).
*   **Web App**: Deployed to a new Vercel project (`web.naridon.com`).
*   **Shared Packages**: Managed via `pnpm` workspace links. No need to publish to NPM.

## 4. Feature Parity
Every feature developed in `shared-features` is **instantly available** on both `app.naridon.com` and `web.naridon.com`. 
*   Example: If we add a new "Social Insights" chart, it will show up for both Shopify merchants and SaaS brand owners automatically.
