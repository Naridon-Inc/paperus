# Current State Assessment (Jan 2026)

This document reflects the actual state of the codebase as of Jan 5, 2026, based on a deep investigation of the source code.

---

## 1️⃣ Auth & Session Handling
**Status:** Hybrid (Shopify OAuth + Header-based Identification)

1.  **Trusting `shopId`:**
    *   **Mechanism:** API routes currently trust the `x-shop-id` header blindly in the helper function `getAuth`.
    *   **Validation:** There is NO cryptographic signature validation or JWT verification middleware applied globally to backend API routes. The `getAuth` helper simply reads the header:
        ```typescript
        const shopId = (headers["x-shop-id"] as string) || query.shopId;
        ```
    *   **Risk:** High. Any caller can impersonate a shop if they know the UUID or domain.

2.  **API Middleware:**
    *   **Status:** No global auth middleware found in `backend/api/server.ts` or `app.ts`.
    *   **Frontend-Backend Trust:** The frontend calls the backend using `fetchSpa`, which likely (in production) would pass a session token, but the backend implementation currently relies on the manual `x-shop-id` header for context.

3.  **Standalone Auth:**
    *   **App.naridon.com:** There is a `frontend/apps/standalone` Remix app, suggesting a separate entry point exists. However, the primary `backend` logic is heavily coupled with `prisma.shop` lookups which support `platform: 'shopify'`. There is no separate "User" auth table visible in the schema scan (only `PlatformSession` and `session` which are Shopify-specific).

---

## 2️⃣ Embedded App Reality
**Status:** Yes, Embedded (Shopify)

4.  **Embedding:**
    *   **Yes:** The `frontend/apps/shopify` app is configured as `embedded = true` in `shopify.app.toml`.

5.  **Technology:**
    *   **App Bridge:** Yes, used extensively (`@shopify/app-bridge-react`).
    *   **Session Tokens:** Used for the initial load (`authenticate.admin(request)` in Remix loaders), but the communication between the Remix frontend and the external Backend API (`@test-app/backend`) is loosely coupled via headers.

6.  **Iframe Source:**
    *   The iframe source is served by the `frontend/apps/shopify` Remix app (e.g., `https://...trycloudflare.com`), not `app.naridon.com` directly.

---

## 3️⃣ Billing & Entitlements
**Status:** Database-driven limits, but enforcement is partial.

7.  **Implementation:**
    *   **Schema:** The database has a `ShopPlanLimit` table and `ShopConfig` with credit fields (`promptRunCredits`, `mentionCredits`).
    *   **Source:** `ShopConfig` and `ShopPlanLimit` tables in the Postgres DB are the source of truth for limits.

8.  **Storage:**
    *   Stored internally in `ShopPlanLimit` (columns: `prompts`, `products`, `dailyScans`).

9.  **Gating:**
    *   **Workers:** The email worker (`backend/workers/index.ts`) does **not** explicitly check billing limits before processing a job.
    *   **API:** Endpoints like `/api/v1/monitor/prompts` do not appear to check credit balances before execution in the current code snapshot.

---

## 4️⃣ Platform Abstraction
**Status:** In Progress / Partial

10. **Connector Usage:**
    *   **Existence:** A `backend/connectors` directory exists with `shopify` and `woocommerce` subfolders.
    *   **Usage:** The `AnalyticsService` and `MonitoringService` (`backend/domain/...`) interact mostly with the Prisma DB (`Shop`, `Run`, `Prompt`). They abstract data *storage*, but data *ingestion* (syncing products) would rely on these connectors.
    *   **Direct Calls:** The codebase still contains direct references to Shopify-specific logic in seed scripts (`seed-rossignol.ts` hardcodes `platform: 'shopify'`).

11. **Optimization Actions:**
    *   Optimization endpoints (`/api/v1/optimize/fixes`) are structured to receive generic fix payloads, but the actual execution logic (writing back to the platform) was not fully visible in the inspected files (often marked as `// TODO: Implement fix application logic`).

---

## 5️⃣ Data Volume & Retention
**Status:** Full Retention (No Auto-Cleanup)

12. **Payload Storage:**
    *   **Raw Output:** Yes. The `Run` table has a `response` field (String) that stores the raw LLM output.
        ```prisma
        model Run {
          // ...
          response String // Full text stored
        }
        ```
    *   **Aggregation:** Aggregation happens on-the-fly via queries (`AnalyticsService.getGlobalStats` aggregates runs).

13. **Retention:**
    *   **No Cleanup:** There are no visible cron jobs or workers dedicated to archiving or deleting old `Run` or `PromptMetric` records. `backend/infrastructure/db/schema.prisma` does not define TTLs.

---

## 6️⃣ Workers & Idempotency
**Status:** Basic Idempotency via Status Checks

14. **Idempotency:**
    *   **Yes:** The worker (`backend/workers/index.ts`) explicitly checks job status before processing:
        ```typescript
        if (emailJob.status !== 'PENDING') {
             console.log(`[Worker] Job ${emailJobId} is already ${emailJob.status}. Skipping.`);
             return;
        }
        ```
    *   This prevents double-processing if QStash retries a job that already started/finished.

15. **Payload Validation:**
    *   **Weak:** The worker validates that `emailJobId` exists in the database (`prisma.emailJob.findUnique`). However, it trusts that the job ID provided in the payload is the correct one to process. It does not re-verify cryptographic signatures from QStash in the inspected worker code (though signature verification might happen at the ingress route `backend/api/v1/workers.ts` before enqueuing/delegating, or inside the worker library).

---

## 7️⃣ Multi-platform Roadmap
**Status:** Shopify First, WooCommerce Scaffolded

16. **Live Platforms:**
    *   **Shopify:** The only fully functional and integrated platform (App Bridge, Remix App, Database Seeding).

17. **Next Reality:**
    *   **WooCommerce:** A `backend/connectors/woocommerce` directory exists, indicating it is the immediate next target for implementation.

---

## 8️⃣ UI Stack Reality
**Status:** Shared Components (`ui-kit`), Separate Apps

18. **Polaris Usage:**
    *   **Heavily Used:** `frontend/apps/shopify` relies entirely on Polaris.
    *   **UI Kit:** The `frontend/packages/ui-kit` imports `lucide-react` and standard HTML/Tailwind (`div`, `span`, `table`), suggesting it is designed to be **platform-agnostic** (not strictly bound to Polaris).
    *   **Exceptions:** Some specific wrappers in the Shopify app (`AppProvider`, `TitleBar`) are Polaris/App Bridge specific.

19. **Architecture:**
    *   **Monorepo:** Uses `turbo` to manage multiple apps.
    *   **Strategy:** Platform-specific shells (`apps/shopify`, `apps/standalone`) consuming a shared UI library (`packages/ui-kit`). This allows the "Standalone" app to potentially use a different design system or a generic Tailwind theme while the Shopify app uses Polaris where necessary (or embeds the generic UI kit).