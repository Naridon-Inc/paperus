# Monorepo Architecture & Multi-Platform Strategy

1\. High-Level **Philosophy** + A C

The core design principle of this repository is **"Centralized Intelligence, Distributed Interface."**

Instead of building a "Shopify App," we are building an **AI-Powered Brand Monitoring & Reputation Intelligence Platform** that happens to have a Shopify integration. This distinction is crucial for future scalability. All high-value logic (Prompt execution, Sentiment analysis, Citation tracking) lives in one place, while platform-specific code is isolated to thin adapters.

## 2\. Directory Structure & Responsibilities
### **Backend (**`**@test-app/backend**`**)**

*The "Brain" of the operation.*

1.  **Status**: Platform-Agnostic.
2.  **Responsibilities**:
3.  **Core Business Logic**: AI Prompt Management, LLM Execution, Sentiment Analysis, Competitor Tracking.
4.  **Database**: Owns the Prisma schema and migrations.
5.  **Workers**: Processes background jobs (e.g., `monitor-queue`) independent of where the job came from.
6.  **API**: Provides a unified REST/GraphQL API for all frontends.

### **Frontend Apps (**`**frontend/apps/***`**)**

*The "Face" of the operation.*

1.  **Status**: Platform-Specific.
2.  **Responsibilities**:
3.  `**apps/shopify**`: A Remix app using `@shopify/polaris`. It acts purely as a View Layer. It does **not** process data or execute analysis. It simply authenticates and renders data from the Backend API.
4.  `**apps/web**` **(Future)**: A standalone React dashboard for users who don't use Shopify (e.g., direct sign-up).
5.  `**apps/woocommerce**` **(Future)**: A WordPress plugin or iframe host.

### **Shared Packages (**`**frontend/packages/***`**)**

*The "Tools" used by the faces.*

1.  `**ui-kit**`: Shared React components (buttons, charts) that don't rely on specific platform design systems (or wrap them abstractly).
2.  `**api-client**`: Typed fetch wrappers to talk to the Backend.

* * *

## 3\. The "Platform Connector" Pattern

To support multiple platforms without spaghetti code, we use a **Connector Pattern** in the backend.

### How it works

The backend defines a generic interface (conceptual or TypeScript interface) for interactions:

interface PlatformConnector {

getOrders(since: Date): Promise;

getProducts(): Promise;

validateSession(token: string): Promise;

}

### Implementations

1.  `**backend/connectors/shopify/**`: Implements the interface using Shopify's Graph Admin API.
2.  `**backend/connectors/woocommerce/**` (Future): Implements the same interface using the WooCommerce REST API.

When a Worker needs to "Fetch Products" or "Analyze Shop Metadata," it doesn't care if the shop is Shopify or Magento. It just calls `connector.getProducts()`.

* * *

## 4\. Universal Authentication

We successfully migrated to a **Backend-Managed Auth** flow to support this architecture.

### The Problem

Shopify uses OAuth + Session Tokens. WooCommerce uses API Keys. Stripe uses standard Email/Password.

### The Solution: Normalized Sessions

Regardless of *how* a user logs in, the result is always a standardized row in the shared `session` table.

1.  **Shopify Login**:
2.  Backend performs OAuth handshake.
3.  Saves `accessToken` and `platform: 'shopify'` to DB.
4.  **WooCommerce Login** (Future):
5.  User provides API Key.
6.  Backend validates key.
7.  Saves `apiKey` and `platform: 'woocommerce'` to DB.

**The Frontend's Job**: The Frontend simply checks the database: *"Does a valid session exist for this context?"* It doesn't need to know how it got there.

* * *

## 5\. Universal Billing

Billing is often the hardest part to abstract. We handle it by treating "Entitlements" separately from "Payments."

1.  **Payment Gateway (Platform Specific)**:
2.  Shopify Billing API (for Shopify users).
3.  Stripe (for standalone/WooCommerce users).
4.  **Entitlements (Shared)**:
5.  The `Shop` table has a `plan` column (e.g., `FREE`, `PRO`).
6.  The Backend checks `shop.plan` before allowing features (e.g., "AI Generation").
7.  It doesn't matter *who* processed the payment; the Backend only cares about the resulting Plan status.

* * *

## 6\. How to Add a New Platform (e.g., WooCommerce)

Because of this architecture, adding a new platform requires **zero changes** to the core AI or Worker logic.

1.  **Create the Connector**:
2.  Add `backend/connectors/woocommerce/`.
3.  Implement auth validation and order fetching logic.
4.  **Add the Auth Route**:
5.  Add `POST /api/auth/woocommerce` in the Backend to handle the handshake/API key validation.
6.  **Build the Frontend Shell**:
7.  Create `frontend/apps/woocommerce`.
8.  Build a simple UI that calls your existing Backend APIs.
9.  **Done**:
10.  The existing Monitor Worker will automatically start processing prompts for these new users because they are just rows in the `Shop` table.

* * *

## Summary

<table><tbody><tr><td data-row="1">Feature</td><td data-row="1"><strong>Where it lives</strong></td><td data-row="1"><strong>Status</strong></td></tr><tr><td data-row="2"><strong>UI Components</strong></td><td data-row="2"><code>frontend/apps/[platform]</code></td><td data-row="2">Specific (Polaris, etc.)</td></tr><tr><td data-row="3"><strong>Auth Handshake</strong></td><td data-row="3"><code>backend/api/auth</code></td><td data-row="3">Specific Routes, Shared DB</td></tr><tr><td data-row="4"><strong>Session Storage</strong></td><td data-row="4"><code>Postgres DB</code></td><td data-row="4">Shared</td></tr><tr><td data-row="5"><strong>Data Fetching</strong></td><td data-row="5"><code>backend/connectors/[platform]</code></td><td data-row="5">Specific Implementation, Generic Interface</td></tr><tr><td data-row="6"><strong>AI Generation</strong></td><td data-row="6"><code>backend/workers</code></td><td data-row="6"><strong>100% Shared</strong></td></tr><tr><td data-row="7"><strong>Sentiment Analysis</strong></td><td data-row="7"><code>backend/workers</code></td><td data-row="7"><strong>100% Shared</strong></td></tr><tr><td data-row="8"><strong>Billing Logic</strong></td><td data-row="8"><code>backend/services/billing</code></td><td data-row="8">Shared (Plan checks)</td></tr></tbody></table>

**This architecture ensures that 80% of your code (the Backend) is written once, while the remaining 20% (Frontend/Connectors) ensures a native-feeling experience on every platform.**