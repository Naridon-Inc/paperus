# Detailed Backend Comparison: Current vs Reference

**Date:** January 14, 2026
**Target:** `/backend` (Current Production)
**Reference:** `/temp_reference/backend` (Clean DDD / TypeScript Migration Reference)

---

## 1. Executive Summary

This document provides a file-level and architectural comparison between the current production backend and the reference implementation. The goal is to identify gaps, architectural improvements, and migration steps required to adopt the clean DDD patterns from the reference while maintaining the production features (billing, multi-platform support) of the current backend.

**High-Level Stats:**
*   **Current Backend (`backend`):** ~150+ Source Files (excluding dist/node_modules). Heavy on operational scripts (`.ts` at root).
*   **Reference Backend (`temp_reference/backend`):** ~100+ Source Files. Heavy on Documentation (`.md`) and structured DDD layers.

**Key Structural Differences:**
1.  **Root:** Current backend has ~40+ operational scripts (seeds, debug, triggers) at the root. Reference backend is clean, containing mostly documentation and plans.
2.  **Delivery:** Current backend uses a Vercel-style `api` folder and platform-specific folders. Reference backend uses `api-shopify`.
3.  **Domain:** Reference backend implements `compliance` domain (missing in current) and has a richer `monitoring` domain with explicit `services` and `value-objects`.
4.  **Infrastructure:** Current backend has production integrations (PostHog, QStash, SearchAPI). Reference backend introduces an `Event Bus` but lacks these specific adapters.
5.  **Libs:** Reference backend introduces `libs/queue` and `libs/search` as distinct workspaces.

---

## 2. Top-Level Directory Comparison

### Root Directory

| File / Folder | Current Backend (`backend`) | Reference (`temp_reference/backend`) | Status / Action |
| :--- | :--- | :--- | :--- |
| `.env` | ✅ Present | ❌ Missing | Keep local |
| `API_REFERENCE.md` | ✅ Present | ❌ Missing | Keep local |
| `Dockerfile` | ✅ Present | ❌ Missing | Keep local |
| `ACTUAL_STATUS.md` | ❌ Missing | ✅ Present | Reference Doc |
| `CURSOR_FUCKUP.md` | ❌ Missing | ✅ Present | Reference Doc |
| `MIGRATION_PLAN.md` | ✅ Present | ✅ Present | Compare Content |
| `package.json` | ✅ Present | ✅ Present | Merge Dependencies |
| `pnpm-workspace.yaml` | ✅ Present | ✅ Present | Update for new libs |
| `tsconfig.base.json` | ✅ Present | ✅ Present | Check settings |
| **Operational Scripts** | **Many** (`backfill-*.ts`, `debug-*.ts`, `seed-*.ts`) | **None** | Keep local (tools) |
| `test/` | ✅ Present (`e2e`) | ❌ Missing | Keep local |

**Detailed List of Unique Root Scripts in Current Backend:**
*   `backfill-graph-data.ts`, `backfill-intelligence.ts`
*   `categorize-prompts.ts` (v1, v2, v3)
*   `check-db-integrity.ts`, `check-db-session.ts`, `check-total-mentions.ts`
*   `debug-api-response.ts`, `debug-competitor-calc.ts`, `debug-competitors-logic.ts`, `debug-embed-logic.ts`, `debug-products-error.ts`, `debug-server-start.ts`, `debug-stats-anomaly.ts`, `debug-topic-authority.ts`
*   `fix-rossignol-type.ts`, `fix-shop-limits.ts`
*   `reset-monitoring-data.ts`
*   `seed-citations.ts`, `seed-diversity.ts`, `seed-more-brands.ts`, `seed-rich-swot.ts`, `seed-rossignol-data.ts`, `seed-shopware-prompts.ts`
*   `set-brand-name.ts`
*   `test-shopify-api.ts`
*   `trigger-cron.ts`, `trigger-deep-dive-batch.ts`, `trigger-real-analysis.ts`

**Analysis:** The current backend root is "noisy" with operational tools. The reference is clean.
**Recommendation:** Move operational scripts to `scripts/` folder or `delivery/scripts` to clean up the root.

---

## 3. Library Layer Comparison (`libs/`)

| Library | Current Backend | Reference Backend | Notes |
| :--- | :--- | :--- | :--- |
| `libs/ai` | ✅ Present | ✅ Present | Check for `agent` and `tool` updates. |
| `libs/db` | ✅ Present | ✅ Present | Local has complete `schema.prisma`. |
| `libs/platform` | ✅ Present (Multi-platform) | ✅ Present (Shopify focused) | Local is superior (Multi-platform). |
| `libs/queue` | ❌ Missing | ✅ Present | **ADOPT**. New standard for queues. |
| `libs/restapi` | ✅ Present | ✅ Present | Check for `plugins` updates. |
| `libs/search` | ❌ Missing | ✅ Present | **ADOPT**. New SearchAPI client wrapper. |
| `libs/shared` | ✅ Present | ✅ Present | Check `utils` and `uuid`. |

**Detailed Analysis of `libs/platform`:**
*   **Current:** `base`, `bigcommerce`, `shopify`, `shopware`, `woocommerce`.
*   **Reference:** `base`, `shopify`.
*   **Decision:** Keep Current structure. Port any specific Shopify improvements from Reference into `libs/platform/shopify`.

**Detailed Analysis of `libs/queue` (New):**
*   Reference implementation includes `queue-factory.ts` and `bullmq/` adapter.
*   Current backend uses `infrastructure/jobs` with QStash.
*   **Migration:** Adopt `libs/queue` workspace. Refactor `infrastructure/jobs` to implement the `libs/queue` interfaces or use it as the provider.

---

## 4. Domain Layer Comparison (`domain/`)

The core business logic differences.

### 4.1 Monitoring Domain (`domain/src/monitoring`)

**Current Backend:**
*   `competitor/`, `smart-signal/`, `personas/`, `prompts/`, `run/`.
*   Focuses on data entities and basic processing.

**Reference Backend:**
*   `competitor/`, `smart-signal/`
*   **`services/`**: Explicit domain services (e.g., `statistics-calculator.ts`).
*   **`value-objects/`**: Rich value objects (`time-range.ts`, `chart.ts`, `data-point.ts`).
*   **`entities/`**: Clean entity definitions.

**Gap:** Reference has better DDD separation (Value Objects & Domain Services).
**Action:** Port `services/` and `value-objects/` from Reference to Current.

### 4.2 Compliance Domain (`domain/src/compliance`)

*   **Current:** Missing.
*   **Reference:** Present (`events`, `repositories`, `services`).
*   **Action:** Copy entire `compliance` domain to Current.

### 4.3 Billing & Organization Domains

*   **Current:** Present (`billing/`, `organization/`).
*   **Reference:** Missing or minimal.
*   **Action:** Keep Current implementation.

### 4.4 Optimization Domain

*   **Current:** `repositories`, `ports`, `entities`.
*   **Reference:** `repositories`, `services`, `entities`, `value-objects`.
*   **Action:** Check `optimization/services` in Reference for logic improvements and port if necessary.

---

## 5. Infrastructure Layer Comparison (`infrastructure/`)

### 5.1 Events System
*   **Current:** No explicit Event Bus in `src/events`.
*   **Reference:** `src/events` with `event-publisher.ts` and implementation.
*   **Action:** Port `src/events` to Current. This is a critical architectural upgrade.

### 5.2 Integrations
*   **Current:**
    *   `telemetry/posthog-service.ts` (Keep)
    *   `jobs/qstash-adapter.ts` (Keep/Refactor)
    *   `external/searchapi-adapter.ts` (Refactor to use `libs/search`)
*   **Reference:**
    *   Missing these specific adapters.
*   **Action:** Keep current adapters, but refactor `searchapi-adapter.ts` to use the new `libs/search` package. Refactor `jobs` to align with `libs/queue` interfaces if possible.

---

## 6. Delivery Layer Comparison (`delivery/`)

### 6.1 Structure
*   **Current:** `delivery/api` (Vercel-style), `delivery/platform/*`.
*   **Reference:** `delivery/api-shopify`.

**Analysis:**
The Reference uses a dedicated `api-shopify` package. The Current backend uses a monolithic `api` package for Vercel deployment, plus platform-specific delivery folders.

**Strategy:**
Do **NOT** replace `delivery/api` with `api-shopify`. Instead, verify if `api-shopify` contains new endpoints or logic (e.g., specific webhooks or dashboard routes) and implement them within the existing `delivery/api` or `delivery/platform/shopify` structure to maintain the multi-platform architecture.

### 6.2 Scripts
*   **Current:** `delivery/api/scripts/` contains many maintenance scripts (`cleanup_competitors.ts`, `seed.ts`, `test_reputation.ts`).
*   **Reference:** No equivalent scripts folder shown in `delivery`.
*   **Action:** Keep `delivery/api/scripts`.

---

## 7. Application Layer Comparison (`application/`)

### 7.1 Common Application
*   **Current:** `application/common/src` with `billing`, `config`, `monitoring`, `optimization`, `shop`.
*   **Reference:** `application/common/src` with `monitoring`, `optimization`, `shop`, `types`.

**Gap:** Reference might have updated Use Cases in `monitoring`.
**Action:** Compare `application/common/src/monitoring` files. If Reference has clearer Use Cases (Command/Query separation), adopt them.

### 7.2 App Specifics
*   **Current:** `application/common` is the main entry.
*   **Reference:** `application/app-shopify`.
*   **Action:** Similar to Delivery, `app-shopify` is platform-specific. Keep Current's shared approach, but check `app-shopify` for any Shopify-specific business logic that should be in `application/common` or `libs/platform/shopify`.

---

## 8. Migration Checklist & Plan

### Phase 1: Preparation (Workspaces & Libs)
1.  [ ] **Backup:** Snapshot current backend.
2.  [ ] **New Workspaces:**
    *   Copy `temp_reference/backend/libs/queue` to `backend/libs/queue`.
    *   Copy `temp_reference/backend/libs/search` to `backend/libs/search`.
3.  [ ] **Update Config:** Add new paths to `backend/pnpm-workspace.yaml`.
4.  [ ] **Install:** Run `pnpm install` in `backend`.

### Phase 2: Domain Architecture (The "Clean" Core)
5.  [ ] **Compliance:** Copy `temp_reference/backend/domain/src/compliance` to `backend/domain/src/compliance`.
6.  [ ] **Monitoring Value Objects:** Copy `temp_reference/backend/domain/src/monitoring/value-objects` to `backend/domain/src/monitoring/`.
7.  [ ] **Monitoring Services:** Copy `temp_reference/backend/domain/src/monitoring/services` to `backend/domain/src/monitoring/`.
8.  [ ] **Database:**
    *   Update `backend/libs/db/prisma/schema.prisma`.
    *   Add models for `Compliance`.
    *   Run `pnpm db:generate`.

### Phase 3: Infrastructure Events
9.  [ ] **Event Bus:** Copy `temp_reference/backend/infrastructure/src/events` to `backend/infrastructure/src/events`.
10. [ ] **Export:** Export events from `backend/infrastructure/src/index.ts`.

### Phase 4: Integration & Cleanup
11. [ ] **Search Refactor:** Update `backend/infrastructure/src/external/searchapi-adapter.ts` to use `libs/search`.
12. [ ] **Verify:** Run `backend/test/e2e` to ensure no regression in billing or shopify flows.
13. [ ] **Cleanup:** (Optional) Move root `.ts` scripts to `backend/scripts/`.

---

## 9. File-by-File Inventory (Difference Highlight)

### Files Unique to Reference (Candidates for Porting)
*   `libs/queue/package.json`
*   `libs/queue/src/index.ts`
*   `libs/queue/src/queue-factory.ts`
*   `libs/queue/src/types.ts`
*   `libs/queue/src/bullmq/*`
*   `libs/search/package.json`
*   `libs/search/src/index.ts`
*   `libs/search/src/searchapi-client.ts`
*   `libs/search/src/types.ts`
*   `domain/src/compliance/index.ts`
*   `domain/src/compliance/events/*`
*   `domain/src/compliance/repositories/*`
*   `domain/src/compliance/services/*`
*   `domain/src/monitoring/services/*`
*   `domain/src/monitoring/value-objects/*`
*   `infrastructure/src/events/event-publisher.ts`
*   `infrastructure/src/events/event-publisher-impl.ts`

### Files Unique to Current (DO NOT DELETE)
*   `libs/platform/woocommerce/*`
*   `libs/platform/bigcommerce/*`
*   `libs/platform/shopware/*`
*   `domain/src/billing/*`
*   `domain/src/organization/*`
*   `infrastructure/src/telemetry/*`
*   `infrastructure/src/jobs/qstash*`
*   `delivery/api/scripts/*`
*   `delivery/api/vercel.json`
*   `test/e2e/*`
*   `Dockerfile`
*   `Root operational scripts (*.ts)`

---

## 10. Conclusion

The `temp_reference` backend represents a cleaner, more modular architecture, particularly in the Domain (Services/Value Objects) and Infrastructure (Events) layers. However, it lacks the multi-platform and billing features of the current production backend.

The recommended path is a **surgical graft**:
1.  **Implant** the missing libraries (`queue`, `search`).
2.  **Implant** the Event Bus (`infrastructure/events`).
3.  **Implant** the Compliance domain and Monitoring improvements.
4.  **Preserve** the Billing domain, multi-platform libs, and operational tooling.

This hybrid approach modernizes the architecture without causing regression in supported platforms or revenue-critical features (billing).

## Appendix A: Full File List - Current Backend
```text
backend
backend/TODO_MONITORING.md
backend/fix-shop-limits.ts
backend/categorize-prompts-v3.ts
backend/pnpm-lock.yaml
backend/fix-rossignol-type.ts
backend/seed-citations.ts
backend/check-total-mentions.ts
backend/debug-topic-authority.ts
backend/check-db-integrity.ts
backend/debug-competitors-logic.ts
backend/seed-more-brands.ts
backend/API_REFERENCE.md
backend/test
backend/test/e2e
backend/test/e2e/billing_flow.test.ts
backend/test/e2e/full-flow.spec.ts
backend/categorize-prompts.ts
backend/check-db-session.ts
backend/categorize-prompts-v2.ts
backend/debug-products-error.ts
backend/tsconfig.base.json
backend/debug-competitor-calc.ts
backend/test-shopify-api.ts
backend/Dockerfile
backend/trigger-real-analysis.ts
backend/debug-server-start.ts
backend/INFRASTRUCTURE_IMPLEMENTATION_SUMMARY.md
backend/set-brand-name.ts
backend/trigger-cron.ts
backend/backfill-graph-data.ts
backend/reset-monitoring-data.ts
backend/MIGRATION_PLAN.md
backend/libs
backend/libs/platform
backend/libs/platform/woocommerce
backend/libs/platform/woocommerce/dist
backend/libs/platform/woocommerce/tsconfig.tsbuildinfo
backend/libs/platform/woocommerce/package.json
backend/libs/platform/woocommerce/tsconfig.json
backend/libs/platform/woocommerce/src
backend/libs/platform/bigcommerce
backend/libs/platform/bigcommerce/dist
backend/libs/platform/bigcommerce/tsconfig.tsbuildinfo
backend/libs/platform/bigcommerce/package.json
backend/libs/platform/bigcommerce/tsconfig.json
backend/libs/platform/bigcommerce/src
backend/libs/platform/shopify
backend/libs/platform/shopify/dist
backend/libs/platform/shopify/tsconfig.tsbuildinfo
backend/libs/platform/shopify/package.json
backend/libs/platform/shopify/tsconfig.json
backend/libs/platform/shopify/src
backend/libs/platform/shopware
backend/libs/platform/shopware/dist
backend/libs/platform/shopware/tsconfig.tsbuildinfo
backend/libs/platform/shopware/package.json
backend/libs/platform/shopware/tsconfig.json
backend/libs/platform/shopware/src
backend/libs/platform/package.json
backend/libs/platform/tsconfig.json
backend/libs/platform/base
backend/libs/platform/base/dist
backend/libs/platform/base/tsconfig.tsbuildinfo
backend/libs/platform/base/package.json
backend/libs/platform/base/tsconfig.json
backend/libs/platform/base/src
backend/libs/shared
backend/libs/shared/dist
backend/libs/shared/dist/types.js
backend/libs/shared/dist/types.js.map
backend/libs/shared/dist/auth
backend/libs/shared/dist/types.d.ts
backend/libs/shared/dist/uuid.js.map
backend/libs/shared/dist/index.js
backend/libs/shared/dist/utils
backend/libs/shared/dist/utils.d.ts
backend/libs/shared/dist/uuid.d.ts.map
backend/libs/shared/dist/utils.d.ts.map
backend/libs/shared/dist/uuid.js
backend/libs/shared/dist/index.js.map
backend/libs/shared/dist/uuid.d.ts
backend/libs/shared/dist/utils.js
backend/libs/shared/dist/utils.js.map
backend/libs/shared/dist/types.d.ts.map
backend/libs/shared/dist/index.d.ts
backend/libs/shared/dist/index.d.ts.map
backend/libs/shared/tsconfig.tsbuildinfo
backend/libs/shared/package.json
backend/libs/shared/tsconfig.json
backend/libs/shared/src
backend/libs/shared/src/uuid.ts
backend/libs/shared/src/auth
backend/libs/shared/src/utils.ts
backend/libs/shared/src/utils
backend/libs/shared/src/types.ts
backend/libs/shared/src/index.ts
backend/libs/restapi
backend/libs/restapi/dist
backend/libs/restapi/dist/plugins.js.map
backend/libs/restapi/dist/app.d.ts.map
backend/libs/restapi/dist/app.js.map
backend/libs/restapi/dist/types.js
backend/libs/restapi/dist/app.d.ts
backend/libs/restapi/dist/types.js.map
backend/libs/restapi/dist/types.d.ts
backend/libs/restapi/dist/plugins.js
backend/libs/restapi/dist/index.js
backend/libs/restapi/dist/index.js.map
backend/libs/restapi/dist/types.d.ts.map
backend/libs/restapi/dist/plugins.d.ts.map
backend/libs/restapi/dist/index.d.ts
backend/libs/restapi/dist/app.js
backend/libs/restapi/dist/index.d.ts.map
backend/libs/restapi/dist/plugins.d.ts
backend/libs/restapi/tsconfig.tsbuildinfo
backend/libs/restapi/package.json
backend/libs/restapi/tsconfig.json
backend/libs/restapi/src
backend/libs/restapi/src/app.ts
backend/libs/restapi/src/types.ts
backend/libs/restapi/src/index.ts
backend/libs/restapi/src/plugins.ts
backend/libs/ai
backend/libs/ai/dist
backend/libs/ai/dist/client.js
backend/libs/ai/dist/client.js.map
backend/libs/ai/dist/types.js
backend/libs/ai/dist/types.js.map
backend/libs/ai/dist/tool.d.ts.map
backend/libs/ai/dist/tool.js.map
backend/libs/ai/dist/types.d.ts
backend/libs/ai/dist/providers
backend/libs/ai/dist/agent.js.map
backend/libs/ai/dist/tool.d.ts
backend/libs/ai/dist/index.js
backend/libs/ai/dist/agent.d.ts
backend/libs/ai/dist/agent.d.ts.map
backend/libs/ai/dist/client.d.ts.map
backend/libs/ai/dist/index.js.map
backend/libs/ai/dist/tool.js
backend/libs/ai/dist/types.d.ts.map
backend/libs/ai/dist/index.d.ts
backend/libs/ai/dist/client.d.ts
backend/libs/ai/dist/index.d.ts.map
backend/libs/ai/dist/agent.js
backend/libs/ai/tsconfig.tsbuildinfo
backend/libs/ai/package.json
backend/libs/ai/tsconfig.json
backend/libs/ai/src
backend/libs/ai/src/tool.ts
backend/libs/ai/src/providers
backend/libs/ai/src/agent.ts
backend/libs/ai/src/types.ts
backend/libs/ai/src/client.ts
backend/libs/ai/src/index.ts
backend/libs/queue
backend/libs/queue/dist
backend/libs/queue/dist/types.js
backend/libs/queue/dist/types.js.map
backend/libs/queue/dist/queue-factory.js
backend/libs/queue/dist/types.d.ts
backend/libs/queue/dist/queue-factory.d.ts
backend/libs/queue/dist/index.js
backend/libs/queue/dist/index.js.map
backend/libs/queue/dist/queue-factory.d.ts.map
backend/libs/queue/dist/queue-factory.js.map
backend/libs/queue/dist/types.d.ts.map
backend/libs/queue/dist/index.d.ts
backend/libs/queue/dist/bullmq
backend/libs/queue/dist/index.d.ts.map
backend/libs/queue/tsconfig.tsbuildinfo
backend/libs/db
backend/libs/db/dist
backend/libs/db/dist/client.js
backend/libs/db/dist/client.js.map
backend/libs/db/dist/types.js
backend/libs/db/dist/types.js.map
backend/libs/db/dist/types.d.ts
backend/libs/db/dist/index.js
backend/libs/db/dist/client.d.ts.map
backend/libs/db/dist/index.js.map
backend/libs/db/dist/types.d.ts.map
backend/libs/db/dist/index.d.ts
backend/libs/db/dist/client.d.ts
backend/libs/db/dist/index.d.ts.map
backend/libs/db/tsconfig.tsbuildinfo
backend/libs/db/prisma
backend/libs/db/prisma/migrations
backend/libs/db/prisma/schema.prisma
backend/libs/db/migration.sql
backend/libs/db/package.json
backend/libs/db/tsconfig.json
backend/libs/db/src
backend/libs/db/src/types.ts
backend/libs/db/src/client.ts
backend/libs/db/src/index.ts
backend/seed-shopware-prompts.ts
backend/debug-embed-logic.ts
backend/package.json
backend/seed-rich-swot.ts
backend/backfill-intelligence.ts
backend/.env
backend/API_SPECIFICATION.md
backend/MONITORING_IMPLEMENTATION_SUMMARY.md
backend/delivery
backend/delivery/platform
backend/delivery/platform/woocommerce
backend/delivery/platform/woocommerce/dist
backend/delivery/platform/woocommerce/tsconfig.tsbuildinfo
backend/delivery/platform/woocommerce/package.json
backend/delivery/platform/woocommerce/tsconfig.json
backend/delivery/platform/woocommerce/src
backend/delivery/platform/bigcommerce
backend/delivery/platform/bigcommerce/dist
backend/delivery/platform/bigcommerce/tsconfig.tsbuildinfo
backend/delivery/platform/bigcommerce/package.json
backend/delivery/platform/bigcommerce/tsconfig.json
backend/delivery/platform/bigcommerce/src
backend/delivery/platform/shopify
backend/delivery/platform/shopify/dist
backend/delivery/platform/shopify/tsconfig.tsbuildinfo
backend/delivery/platform/shopify/package.json
backend/delivery/platform/shopify/tsconfig.json
backend/delivery/platform/shopify/src
backend/delivery/platform/shopware
backend/delivery/platform/shopware/dist
backend/delivery/platform/shopware/tsconfig.tsbuildinfo
backend/delivery/platform/shopware/package.json
backend/delivery/platform/shopware/tsconfig.json
backend/delivery/platform/shopware/src
backend/delivery/common
backend/delivery/common/dist
backend/delivery/common/dist/index.js
backend/delivery/common/dist/index.js.map
backend/delivery/common/dist/index.d.ts
backend/delivery/common/dist/routes
backend/delivery/common/dist/index.d.ts.map
backend/delivery/common/tsconfig.tsbuildinfo
backend/delivery/common/package.json
backend/delivery/common/tsconfig.json
backend/delivery/common/src
backend/delivery/common/src/index.ts
backend/delivery/package.json
backend/delivery/api
backend/delivery/api/list_shops.ts
backend/delivery/api/vercel.json
backend/delivery/api/dist
backend/delivery/api/dist/middleware
backend/delivery/api/dist/config
backend/delivery/api/dist/index.js
backend/delivery/api/dist/utils
backend/delivery/api/dist/vercel-entry.js
backend/delivery/api/dist/index.js.map
backend/delivery/api/dist/vercel-entry.js.map
backend/delivery/api/dist/rate-limit-factory.d.ts.map
backend/delivery/api/dist/rate-limit-factory.js
backend/delivery/api/dist/vercel-entry.d.ts.map
backend/delivery/api/dist/index.d.ts
backend/delivery/api/dist/rate-limit-factory.d.ts
backend/delivery/api/dist/routes
backend/delivery/api/dist/vercel-entry.d.ts
backend/delivery/api/dist/index.d.ts.map
backend/delivery/api/dist/rate-limit-factory.js.map
backend/delivery/api/tsconfig.tsbuildinfo
backend/delivery/api/package.json
backend/delivery/api/scripts
backend/delivery/api/scripts/test_reputation.ts
backend/delivery/api/scripts/dump_competitors.ts
backend/delivery/api/scripts/cleanup_prompt_text.ts
backend/delivery/api/scripts/verify_prompts_api.ts
backend/delivery/api/scripts/cleanup_competitors.ts
backend/delivery/api/scripts/upgrade_plan.ts
backend/delivery/api/scripts/verify_personas.ts
backend/delivery/api/scripts/test_nearby_locations.ts
backend/delivery/api/scripts/seed.ts
backend/delivery/api/scripts/migrate-installations.ts
backend/delivery/api/scripts/test_shopify_hyperlocal.ts
backend/delivery/api/scripts/run_prompts.ts
backend/delivery/api/scripts/seed_rossignol.ts
backend/delivery/api/scripts/seed_and_run_personas.ts
backend/delivery/api/scripts/dump_brands.ts
backend/delivery/api/scripts/test_global_locations.ts
backend/delivery/api/scripts/delete_empty_runs.ts
backend/delivery/api/scripts/test_hyperlocal.ts
backend/delivery/api/scripts/verify_runs.ts
backend/delivery/api/scripts/compare_global_runs.ts
backend/delivery/api/api
backend/delivery/api/api/index.ts
backend/delivery/api/tsconfig.json
backend/delivery/api/.vercelignore
backend/delivery/api/src
backend/delivery/api/src/middleware
backend/delivery/api/src/config
backend/delivery/api/src/tests
backend/delivery/api/src/utils
backend/delivery/api/src/rate-limit-factory.ts
backend/delivery/api/src/index.ts
backend/delivery/api/src/vercel-entry.ts
backend/delivery/api/src/routes
backend/seed-rossignol-data.ts
backend/trigger-deep-dive-batch.ts
backend/debug-api-response.ts
backend/debug-stats-anomaly.ts
backend/application
backend/application/common
backend/application/common/dist
backend/application/common/dist/config
backend/application/common/dist/optimization
backend/application/common/dist/shop
backend/application/common/dist/index.js
backend/application/common/dist/index.js.map
backend/application/common/dist/monitoring
backend/application/common/dist/index.d.ts
backend/application/common/dist/billing
backend/application/common/dist/index.d.ts.map
backend/application/common/tsconfig.tsbuildinfo
backend/application/common/package.json
backend/application/common/tsconfig.json
backend/application/common/src
backend/application/common/src/config
backend/application/common/src/optimization
backend/application/common/src/shop
backend/application/common/src/index.ts
backend/application/common/src/monitoring
backend/application/common/src/billing
backend/infrastructure
backend/infrastructure/dist
backend/infrastructure/dist/database
backend/infrastructure/dist/database/index.js
backend/infrastructure/dist/database/repositories
backend/infrastructure/dist/database/index.js.map
backend/infrastructure/dist/database/index.d.ts
backend/infrastructure/dist/database/index.d.ts.map
backend/infrastructure/dist/optimize
backend/infrastructure/dist/optimize/index.js
backend/infrastructure/dist/optimize/shopify-optimization-adapter.js.map
backend/infrastructure/dist/optimize/shopify-optimization-adapter.d.ts.map
backend/infrastructure/dist/optimize/rules
backend/infrastructure/dist/optimize/index.js.map
backend/infrastructure/dist/optimize/shopify-optimization-adapter.d.ts
backend/infrastructure/dist/optimize/index.d.ts
backend/infrastructure/dist/optimize/shopify-optimization-adapter.js
backend/infrastructure/dist/optimize/index.d.ts.map
backend/infrastructure/dist/platform
backend/infrastructure/dist/platform/shopware-content-adapter.js.map
backend/infrastructure/dist/platform/shopware-content-adapter.d.ts.map
backend/infrastructure/dist/platform/composite-content-adapter.d.ts
backend/infrastructure/dist/platform/shopify-content-adapter.d.ts
backend/infrastructure/dist/platform/composite-content-adapter.d.ts.map
backend/infrastructure/dist/platform/shopware-content-adapter.d.ts
backend/infrastructure/dist/platform/shopify-content-adapter.d.ts.map
backend/infrastructure/dist/platform/shopify-billing-adapter.js.map
backend/infrastructure/dist/platform/shopware-content-adapter.js
backend/infrastructure/dist/platform/shopify-content-adapter.js.map
backend/infrastructure/dist/platform/shopify-billing-adapter.d.ts
backend/infrastructure/dist/platform/composite-content-adapter.js.map
backend/infrastructure/dist/platform/shopify-content-adapter.js
backend/infrastructure/dist/platform/shopify-billing-adapter.d.ts.map
backend/infrastructure/dist/platform/composite-content-adapter.js
backend/infrastructure/dist/platform/shopify-billing-adapter.js
backend/infrastructure/dist/index.js
backend/infrastructure/dist/index.js.map
backend/infrastructure/dist/telemetry
backend/infrastructure/dist/telemetry/posthog-service.d.ts
backend/infrastructure/dist/telemetry/posthog-service.d.ts.map
backend/infrastructure/dist/telemetry/posthog-service.js
backend/infrastructure/dist/telemetry/posthog-service.js.map
backend/infrastructure/dist/external
backend/infrastructure/dist/external/searchapi-adapter.js
backend/infrastructure/dist/external/searchapi-adapter.d.ts.map
backend/infrastructure/dist/external/searchapi-adapter.js.map
backend/infrastructure/dist/external/searchapi-adapter.d.ts
backend/infrastructure/dist/jobs
backend/infrastructure/dist/jobs/qstash-scheduler-adapter.js
backend/infrastructure/dist/jobs/queue-factory.js
backend/infrastructure/dist/jobs/qstash-adapter.js.map
backend/infrastructure/dist/jobs/qstash-scheduler-adapter.js.map
backend/infrastructure/dist/jobs/bullmq-scheduler-adapter.d.ts.map
backend/infrastructure/dist/jobs/queue-factory.d.ts
backend/infrastructure/dist/jobs/qstash-adapter.d.ts.map
backend/infrastructure/dist/jobs/bullmq-scheduler-adapter.js.map
backend/infrastructure/dist/jobs/bullmq-scheduler-adapter.js
backend/infrastructure/dist/jobs/bullmq-scheduler-adapter.d.ts
backend/infrastructure/dist/jobs/qstash-scheduler-adapter.d.ts.map
backend/infrastructure/dist/jobs/qstash-scheduler-adapter.d.ts
backend/infrastructure/dist/jobs/queue-factory.d.ts.map
backend/infrastructure/dist/jobs/queue-factory.js.map
backend/infrastructure/dist/jobs/qstash-adapter.d.ts
backend/infrastructure/dist/jobs/qstash-adapter.js
backend/infrastructure/dist/events
backend/infrastructure/dist/events/event-publisher-impl.d.ts
backend/infrastructure/dist/events/event-publisher-impl.js
backend/infrastructure/dist/events/event-publisher-impl.js.map
backend/infrastructure/dist/events/index.js
backend/infrastructure/dist/events/event-publisher-impl.d.ts.map
backend/infrastructure/dist/events/index.js.map
backend/infrastructure/dist/events/index.d.ts
backend/infrastructure/dist/events/index.d.ts.map
backend/infrastructure/dist/index.d.ts
backend/infrastructure/dist/index.d.ts.map
backend/infrastructure/tsconfig.tsbuildinfo
backend/infrastructure/package.json
backend/infrastructure/tsconfig.json
backend/infrastructure/src
backend/infrastructure/src/database
backend/infrastructure/src/database/repositories
backend/infrastructure/src/database/schema
backend/infrastructure/src/database/index.ts
backend/infrastructure/src/optimize
backend/infrastructure/src/optimize/shopify-optimization-adapter.ts
backend/infrastructure/src/optimize/rules
backend/infrastructure/src/optimize/index.ts
backend/infrastructure/src/platform
backend/infrastructure/src/platform/shopify-content-adapter.ts
backend/infrastructure/src/platform/composite-content-adapter.ts
backend/infrastructure/src/platform/shopify-billing-adapter.ts
backend/infrastructure/src/platform/shopware-content-adapter.ts
backend/infrastructure/src/index.ts
backend/infrastructure/src/telemetry
backend/infrastructure/src/telemetry/posthog-service.ts
backend/infrastructure/src/external
backend/infrastructure/src/external/searchapi-adapter.ts
backend/infrastructure/src/jobs
backend/infrastructure/src/jobs/qstash-adapter.ts
backend/infrastructure/src/jobs/qstash-scheduler-adapter.ts
backend/domain
backend/domain/dist
backend/domain/dist/organization
backend/domain/dist/organization/repositories
backend/domain/dist/organization/entities
backend/domain/dist/optimization
backend/domain/dist/optimization/repositories
backend/domain/dist/optimization/ports
backend/domain/dist/optimization/entities
backend/domain/dist/shop
backend/domain/dist/shop/index.js
backend/domain/dist/shop/repositories
backend/domain/dist/shop/index.js.map
backend/domain/dist/shop/index.d.ts
backend/domain/dist/shop/entities
backend/domain/dist/shop/index.d.ts.map
backend/domain/dist/index.js
backend/domain/dist/index.js.map
backend/domain/dist/monitoring
backend/domain/dist/monitoring/competitor
backend/domain/dist/monitoring/index.js
backend/domain/dist/monitoring/smart-signal
backend/domain/dist/monitoring/personas
backend/domain/dist/monitoring/prompts
backend/domain/dist/monitoring/index.js.map
backend/domain/dist/monitoring/run
backend/domain/dist/monitoring/index.d.ts
backend/domain/dist/monitoring/index.d.ts.map
backend/domain/dist/index.d.ts
backend/domain/dist/ports
backend/domain/dist/ports/telemetry-port.d.ts
backend/domain/dist/ports/platform-billing-port.d.ts
backend/domain/dist/ports/platform-content-port.js.map
backend/domain/dist/ports/telemetry-port.js.map
backend/domain/dist/ports/platform-billing-port.js.map
backend/domain/dist/ports/search-port.d.ts
backend/domain/dist/ports/scheduler-port.js
backend/domain/dist/ports/telemetry-port.js
backend/domain/dist/ports/platform-content-port.d.ts.map
backend/domain/dist/ports/search-port.js.map
backend/domain/dist/ports/search-port.d.ts.map
backend/domain/dist/ports/platform-content-port.d.ts
backend/domain/dist/ports/scheduler-port.js.map
backend/domain/dist/ports/platform-billing-port.js
backend/domain/dist/ports/platform-billing-port.d.ts.map
backend/domain/dist/ports/scheduler-port.d.ts.map
backend/domain/dist/ports/telemetry-port.d.ts.map
backend/domain/dist/ports/platform-content-port.js
backend/domain/dist/ports/scheduler-port.d.ts
backend/domain/dist/ports/search-port.js
backend/domain/dist/billing
backend/domain/dist/billing/plans.d.ts.map
backend/domain/dist/billing/plans.js.map
backend/domain/dist/billing/repositories
backend/domain/dist/billing/plans.d.ts
backend/domain/dist/billing/plans.js
backend/domain/dist/index.d.ts.map
backend/domain/tsconfig.tsbuildinfo
backend/domain/package.json
backend/domain/tsconfig.json
backend/domain/src
backend/domain/src/organization
backend/domain/src/organization/repositories
backend/domain/src/organization/entities
backend/domain/src/optimization
backend/domain/src/optimization/repositories
backend/domain/src/optimization/ports
backend/domain/src/optimization/entities
backend/domain/src/shop
backend/domain/src/shop/repositories
backend/domain/src/shop/index.ts
backend/domain/src/shop/entities
backend/domain/src/index.ts
backend/domain/src/monitoring
backend/domain/src/monitoring/competitor
backend/domain/src/monitoring/smart-signal
backend/domain/src/monitoring/personas
backend/domain/src/monitoring/prompts
backend/domain/src/monitoring/index.ts
backend/domain/src/monitoring/run
backend/domain/src/ports
backend/domain/src/ports/platform-content-port.ts
backend/domain/src/ports/search-port.ts
backend/domain/src/ports/platform-billing-port.ts
backend/domain/src/ports/scheduler-port.ts
backend/domain/src/ports/telemetry-port.ts
backend/domain/src/billing
backend/domain/src/billing/plans.ts
backend/domain/src/billing/repositories
backend/seed-diversity.ts
backend/pnpm-workspace.yaml
```


## Appendix B: Full File List - Reference Backend
```text
temp_reference/backend
temp_reference/backend/TODO_MONITORING.md
temp_reference/backend/pnpm-lock.yaml
temp_reference/backend/CURSOR_FUCKUP.md
temp_reference/backend/NEXT_STEPS.md
temp_reference/backend/tsconfig.base.json
temp_reference/backend/IMPLEMENTATION_PROGRESS.md
temp_reference/backend/INFRASTRUCTURE_IMPLEMENTATION_SUMMARY.md
temp_reference/backend/OPTIMIZATION_CHECKS_PLAN.md
temp_reference/backend/DEVELOPERS.md
temp_reference/backend/PHASE_4B_PLAN.md
temp_reference/backend/MIGRATION_PLAN.md
temp_reference/backend/libs
temp_reference/backend/libs/platform
temp_reference/backend/libs/platform/shopify
temp_reference/backend/libs/platform/shopify/package.json
temp_reference/backend/libs/platform/shopify/tsconfig.json
temp_reference/backend/libs/platform/shopify/src
temp_reference/backend/libs/platform/package.json
temp_reference/backend/libs/platform/tsconfig.json
temp_reference/backend/libs/platform/base
temp_reference/backend/libs/platform/base/package.json
temp_reference/backend/libs/platform/base/tsconfig.json
temp_reference/backend/libs/platform/base/src
temp_reference/backend/libs/shared
temp_reference/backend/libs/shared/tests
temp_reference/backend/libs/shared/tests/utils.test.ts
temp_reference/backend/libs/shared/tests/uuid.test.ts
temp_reference/backend/libs/shared/package.json
temp_reference/backend/libs/shared/tsconfig.json
temp_reference/backend/libs/shared/src
temp_reference/backend/libs/shared/src/uuid.ts
temp_reference/backend/libs/shared/src/utils.ts
temp_reference/backend/libs/shared/src/types.ts
temp_reference/backend/libs/shared/src/index.ts
temp_reference/backend/libs/search
temp_reference/backend/libs/search/package.json
temp_reference/backend/libs/search/tsconfig.json
temp_reference/backend/libs/search/src
temp_reference/backend/libs/search/src/types.ts
temp_reference/backend/libs/search/src/index.ts
temp_reference/backend/libs/search/src/searchapi-client.ts
temp_reference/backend/libs/restapi
temp_reference/backend/libs/restapi/tests
temp_reference/backend/libs/restapi/tests/plugins.test.ts
temp_reference/backend/libs/restapi/README.md
temp_reference/backend/libs/restapi/package.json
temp_reference/backend/libs/restapi/tsconfig.json
temp_reference/backend/libs/restapi/src
temp_reference/backend/libs/restapi/src/app.ts
temp_reference/backend/libs/restapi/src/types.ts
temp_reference/backend/libs/restapi/src/index.ts
temp_reference/backend/libs/restapi/src/plugins.ts
temp_reference/backend/libs/ai
temp_reference/backend/libs/ai/tests
temp_reference/backend/libs/ai/tests/tool.test.ts
temp_reference/backend/libs/ai/README.md
temp_reference/backend/libs/ai/package.json
temp_reference/backend/libs/ai/tsconfig.json
temp_reference/backend/libs/ai/src
temp_reference/backend/libs/ai/src/tool.ts
temp_reference/backend/libs/ai/src/providers
temp_reference/backend/libs/ai/src/agent.ts
temp_reference/backend/libs/ai/src/types.ts
temp_reference/backend/libs/ai/src/client.ts
temp_reference/backend/libs/ai/src/runners
temp_reference/backend/libs/ai/src/index.ts
temp_reference/backend/libs/queue
temp_reference/backend/libs/queue/README.md
temp_reference/backend/libs/queue/package.json
temp_reference/backend/libs/queue/tsconfig.json
temp_reference/backend/libs/queue/src
temp_reference/backend/libs/queue/src/types.ts
temp_reference/backend/libs/queue/src/queue-factory.ts
temp_reference/backend/libs/queue/src/index.ts
temp_reference/backend/libs/queue/src/bullmq
temp_reference/backend/libs/db
temp_reference/backend/libs/db/tests
temp_reference/backend/libs/db/tests/client.test.ts
temp_reference/backend/libs/db/package.json
temp_reference/backend/libs/db/tsconfig.json
temp_reference/backend/libs/db/src
temp_reference/backend/libs/db/src/types.ts
temp_reference/backend/libs/db/src/client.ts
temp_reference/backend/libs/db/src/index.ts
temp_reference/backend/OPTIMIZATION_COMPLETE_SUMMARY.md
temp_reference/backend/PHASE_4B_REVISED_PLAN.md
temp_reference/backend/package.json
temp_reference/backend/API_SPECIFICATION.md
temp_reference/backend/DASHBOARD_SPLIT_PLAN.md
temp_reference/backend/MONITORING_IMPLEMENTATION_SUMMARY.md
temp_reference/backend/PRIORITY_1_PROGRESS.md
temp_reference/backend/delivery
temp_reference/backend/delivery/common
temp_reference/backend/delivery/common/package.json
temp_reference/backend/delivery/common/tsconfig.json
temp_reference/backend/delivery/common/src
temp_reference/backend/delivery/common/src/types
temp_reference/backend/delivery/common/src/index.ts
temp_reference/backend/delivery/common/src/routes
temp_reference/backend/delivery/api-shopify
temp_reference/backend/delivery/api-shopify/package.json
temp_reference/backend/delivery/api-shopify/tsconfig.json
temp_reference/backend/delivery/api-shopify/src
temp_reference/backend/delivery/api-shopify/src/types
temp_reference/backend/delivery/api-shopify/src/constants
temp_reference/backend/delivery/api-shopify/src/middlewares
temp_reference/backend/delivery/api-shopify/src/schemas
temp_reference/backend/delivery/api-shopify/src/index.ts
temp_reference/backend/delivery/api-shopify/src/routes
temp_reference/backend/delivery/api-shopify/src/services
temp_reference/backend/IMPLEMENTATION_GUIDE.md
temp_reference/backend/application
temp_reference/backend/application/app-shopify
temp_reference/backend/application/app-shopify/package.json
temp_reference/backend/application/app-shopify/tsconfig.json
temp_reference/backend/application/app-shopify/src
temp_reference/backend/application/app-shopify/src/shopify-session-service.ts
temp_reference/backend/application/app-shopify/src/index.ts
temp_reference/backend/application/app-shopify/src/shopify-shop-service.ts
temp_reference/backend/application/app-shopify/src/webhooks
temp_reference/backend/application/common
temp_reference/backend/application/common/package.json
temp_reference/backend/application/common/tsconfig.json
temp_reference/backend/application/common/src
temp_reference/backend/application/common/src/types
temp_reference/backend/application/common/src/optimization
temp_reference/backend/application/common/src/shop
temp_reference/backend/application/common/src/index.ts
temp_reference/backend/application/common/src/monitoring
temp_reference/backend/REMAINING_TASKS.md
temp_reference/backend/infrastructure
temp_reference/backend/infrastructure/package.json
temp_reference/backend/infrastructure/tsconfig.json
temp_reference/backend/infrastructure/src
temp_reference/backend/infrastructure/src/database
temp_reference/backend/infrastructure/src/database/repositories
temp_reference/backend/infrastructure/src/database/schema
temp_reference/backend/infrastructure/src/database/index.ts
temp_reference/backend/infrastructure/src/optimize
temp_reference/backend/infrastructure/src/optimize/rules
temp_reference/backend/infrastructure/src/optimize/index.ts
temp_reference/backend/infrastructure/src/index.ts
temp_reference/backend/infrastructure/src/events
temp_reference/backend/infrastructure/src/events/event-publisher-impl.ts
temp_reference/backend/infrastructure/src/events/event-publisher.ts
temp_reference/backend/infrastructure/src/events/index.ts
temp_reference/backend/OPTIMIZATION_LEGACY_COMPARISON.md
temp_reference/backend/domain
temp_reference/backend/domain/package.json
temp_reference/backend/domain/tsconfig.json
temp_reference/backend/domain/src
temp_reference/backend/domain/src/optimization
temp_reference/backend/domain/src/optimization/value-objects
temp_reference/backend/domain/src/optimization/repositories
temp_reference/backend/domain/src/optimization/index.ts
temp_reference/backend/domain/src/optimization/services
temp_reference/backend/domain/src/optimization/entities
temp_reference/backend/domain/src/shop
temp_reference/backend/domain/src/shop/repositories
temp_reference/backend/domain/src/shop/index.ts
temp_reference/backend/domain/src/shop/events
temp_reference/backend/domain/src/shop/services
temp_reference/backend/domain/src/shop/entities
temp_reference/backend/domain/src/compliance
temp_reference/backend/domain/src/compliance/repositories
temp_reference/backend/domain/src/compliance/index.ts
temp_reference/backend/domain/src/compliance/events
temp_reference/backend/domain/src/compliance/services
temp_reference/backend/domain/src/index.ts
temp_reference/backend/domain/src/monitoring
temp_reference/backend/domain/src/monitoring/value-objects
temp_reference/backend/domain/src/monitoring/competitor
temp_reference/backend/domain/src/monitoring/repositories
temp_reference/backend/domain/src/monitoring/smart-signal
temp_reference/backend/domain/src/monitoring/index.ts
temp_reference/backend/domain/src/monitoring/services
temp_reference/backend/domain/src/monitoring/entities
temp_reference/backend/OPTIMIZATION_IMPLEMENTATION_SUMMARY.md
temp_reference/backend/PHASE_3_COMPLETE.md
temp_reference/backend/PLATFORM_AGNOSTIC_FIX.md
temp_reference/backend/ACTUAL_STATUS.md
temp_reference/backend/pnpm-workspace.yaml
```

