# Backend TypeScript Architecture Comparison & Migration Plan

**Reference Branch:** `temp/migrate-to-ts`
**Local Target:** `backend/` (Current TypeScript Monorepo)
**Date:** 2024-05-22

---

## 1. Executive Summary

This document details the comparison between the current local TypeScript backend and the reference implementation in the `temp/migrate-to-ts` branch.

**Key Finding:** The reference backend represents a **significant architectural refinement** specifically for the Monitoring domain and Infrastructure (Event-Driven), but it is a **stripped-down implementation** (Shopify-only, missing integrations like Billing, QStash, PostHog).

**Strategic Direction:** We must perform a **surgical migration**. We will inject the architectural improvements from the reference (Domain Services, Event Bus, Queue Lib) into the feature-rich local backend. We will **NOT** replace the local backend wholesale, as this would result in the loss of multi-platform support, billing, and key third-party integrations.

---

## 2. Detailed Architecture Comparison

### 2.1 Dependencies & Workspace
*   **Local:** Rich set of platform libraries (`libs/platform/*`).
*   **Reference:** Adds **`libs/queue`** and **`libs/search`**.
*   **Action:** We must adopt `libs/queue` and `libs/search` as new workspaces.

### 2.2 Database Layer
*   **Local:** Contains a complete `schema.prisma` with Billing, Organization, and multi-platform schemas.
*   **Reference:** **Missing `schema.prisma`**. The reference implementation relies on an implied schema.
*   **Action:** We must infer the required database changes for the new `Compliance` domain and `Monitoring` updates by analyzing the domain code and manually updating the local `schema.prisma`.

### 2.3 Domain Layer (`domain/src`)
| Feature | Local Implementation | Reference Implementation | Improvement |
| :--- | :--- | :--- | :--- |
| **Monitoring** | Entities & Repositories split by type (`personas`, `prompts`) | Unified `monitoring` domain with **Services** (`StatisticsCalculator`) & **Value Objects** | **High**. Moves calc logic out of DB/Service layers into pure Domain functions. |
| **Compliance** | *Missing* | **Present** (`domain/src/compliance`) | **Additive**. New feature to be ported. |
| **Organization** | Present | *Missing* | Local is better (keep). |
| **Billing** | Present | *Missing* | Local is better (keep). |

### 2.4 Platform Library (`libs/platform`)
*   **Local:** `libs/platform/shopify` is a thin client wrapper. Webhook handling is in `delivery/platform/shopify`.
*   **Reference:** `libs/platform/shopify` includes `adapters/` and `webhooks/`.
*   **Analysis:** The reference design is more cohesive (Self-Contained Library).
*   **Action:** Consider refactoring local `libs/platform/shopify` to include webhook logic, but do not break existing delivery routes.

### 2.5 Infrastructure Layer (`infrastructure/src`)
*   **Local:** Production-ready with `jobs` (QStash), `external` (SearchAPI), `telemetry` (PostHog).
*   **Reference:** Introduces **`events`** (Event Bus) but lacks the integrations above.
*   **Action:** Merge `events` into local. Refactor `jobs` to use the new `libs/queue` (if applicable) or maintain QStash as the underlying driver for the new Queue lib.

---

## 3. Migration Strategy: The "Hybrid" Approach

We will build a "Super-Backend" that combines the **Breadth** (Features/Integrations) of the local version with the **Depth** (Architecture/Domain Logic) of the reference.

### Phase 1: Foundation (New Libraries)
**Goal:** Establish the new architectural building blocks.
1.  **Copy `libs/queue`:** Port the workspace.
2.  **Copy `libs/search`:** Port the workspace.
3.  **Update `pnpm-workspace.yaml`:** Register new libs.

### Phase 2: Domain Enrichment
**Goal:** Upgrade business logic without breaking API contracts.
1.  **Port `StatisticsCalculator`:** Copy `reference/.../monitoring/services/statistics-calculator.ts` to `backend/domain/src/monitoring/services/`. This is a pure function refactor and low risk.
2.  **Port Value Objects:** Copy `reference/.../monitoring/value-objects` (e.g., `TimeRange`, `Chart`).
3.  **Add Compliance Domain:** Copy the entire `compliance` folder.
4.  **Database Migration:** Create a new Prisma migration to support `Compliance` entities and any new fields required by the updated `Monitoring` domain.

### Phase 3: Infrastructure Modernization
**Goal:** Enable Event-Driven capabilities.
1.  **Port `infrastructure/events`:** Copy the Event Bus implementation.
2.  **Wire up Events:** Update `infrastructure/src/index.ts` to export the event system.

### Phase 4: Delivery Refactor (Careful)
**Goal:** Expose new logic via APIs.
1.  **Review `api-shopify`:** The reference has a dedicated `delivery/api-shopify`.
2.  **Strategy:** Instead of copying this folder, **re-implement** the relevant endpoints within the existing `backend/delivery/platform/shopify` or `backend/delivery/api` structures. This preserves the multi-platform architecture.

---

## 4. Implementation Checklist

### Step 1: Libraries
- [ ] Create `backend/libs/queue` from reference.
- [ ] Create `backend/libs/search` from reference.
- [ ] Install dependencies (`pnpm install`).

### Step 2: Domain - Monitoring Upgrade
- [ ] Create `backend/domain/src/monitoring/services/`.
- [ ] Copy `statistics-calculator.ts` and `trend-analyzer.ts`.
- [ ] Create `backend/domain/src/monitoring/value-objects/`.
- [ ] Copy `time-range.ts`, `chart.ts`, `data-point.ts`.
- [ ] Refactor existing Monitoring Service to use `StatisticsCalculator` (optional immediate step, or tech debt).

### Step 3: Domain - New Features
- [ ] Copy `backend/domain/src/compliance`.
- [ ] Update `backend/libs/db/prisma/schema.prisma`:
    - [ ] Add `Compliance` models (infer from `domain/src/compliance/entities`).
    - [ ] Run `pnpm db:generate` and `pnpm db:migrate`.

### Step 4: Infrastructure
- [ ] Copy `backend/infrastructure/src/events`.
- [ ] Ensure `events` sub-module compiles with local dependencies.

---

## 5. Risk Assessment & Mitigation

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **Database Schema Mismatch** | High (Runtime Errors) | Since Reference lacks `schema.prisma`, we must carefully audit `domain` entities to ensure all fields exist in our local DB. |
| **Library Conflicts** | Medium | The reference `libs/queue` might expect a specific Redis setup. Verify env vars. |
| **Over-writing Logic** | High | **NEVER** copy-paste entire `infrastructure` or `delivery` folders. Only cherry-pick new files. |

---

## 6. Appendix: Critical Files to Port

**Domain Services (Pure Logic):**
*   `domain/src/monitoring/services/statistics-calculator.ts`
*   `domain/src/monitoring/services/trend-analyzer.ts`

**Value Objects (Data Structure):**
*   `domain/src/monitoring/value-objects/time-range.ts`
*   `domain/src/monitoring/value-objects/chart.ts`

**Infrastructure:**
*   `infrastructure/src/events/*` (Entire folder)