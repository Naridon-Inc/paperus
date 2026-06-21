# Comprehensive Backend Comparison & Migration Master Report

**Date:** January 14, 2026
**Target Workspace:** `@backend/` (Multi-Platform Architecture)
**Reference Source:** `@temp_reference/backend/` (Branch: `temp/migrate-to-ts`)
**Status:** Deep Analysis & Code-Level Audit Complete

---

## 1. Executive Summary & Critical Action Items

### 1.1 The State of the Union
We have successfully analyzed two divergent evolutionary paths of the Naridon backend:
1.  **The "Empty Shell" (Target):** The `@backend/` workspace. It represents the *correct* future architecture (Hexagonal, Multi-Platform, Independent Database), but it is functionally hollow. It lacks the critical "brains" (AI logic, compliance, deep statistics) required for production.
2.  **The "Brain Trust" (Source):** The `@temp_reference` repository. It is a monolithic, Shopify-coupled implementation, but it contains the *actual working logic* for the application's core value propositions (Competitor Analysis, AI Intelligence, Compliance).

### 1.2 The "Ghost Relation" Crisis
**CRITICAL BUG DISCOVERED:**
The `@backend/` repository implementation (`CompetitorRepositoryImpl`) is fundamentally broken.
- **The Code:** Attempts to link Competitors to `ShopConfig` (expecting `shopConfigId`).
- **The Database:** The schema links Competitors directly to `Shop` (via `shopId`).
- **The Result:** Runtime crashes on any attempt to save or read competitors. This proves the Target backend has not been E2E tested with real data.

### 1.3 The Migration Mandate
We must perform a **"Brain Transplant"**. We will inject the logic from the Source into the architectural body of the Target. We will **NOT** revert to the Source's monolithic structure.

---

## 2. Deep Architecture Audit

### 2.1 Workspace Structure & Philosophy

| Feature | Target (`@backend/`) | Source (`@temp_reference`) | Verdict |
| :--- | :--- | :--- | :--- |
| **Monorepo Strategy** | **Multi-Platform Native** | Shopify-First | Target is superior. |
| **Platform Logic** | `libs/platform/{shopify,shopware}` | `libs/platform` (Generic/Mixed) | Target isolates platforms correctly. |
| **Database Schema** | **Self-Contained** (`libs/db`) | Implicit / Shared | Target owns its destiny. |
| **API Entry** | `delivery/api` (Generic) | `delivery/api-shopify` | Target separates API from Webhooks. |
| **Compliance** | ❌ **Missing** | ✅ **Present** | **BLOCKER** for launch. |

### 2.2 Dependency Graph Analysis

**Target Flow (Correct):**
`API` -> `UseCase` -> `Domain` <- `Infrastructure` -> `DB`
*Note: The Target correctly inverts dependencies, keeping the Domain pure.*

**Source Flow (Legacy):**
`API` -> `App` -> `Domain` -> `Infra`
*Note: The Source often leaks infrastructure details (like Shopify sessions) into the application layer.*

---

## 3. Domain-by-Domain Gap Analysis

### 3.1 Domain: Compliance (GDPR)
**Status:** 🔴 **CRITICAL GAP**
The Target is completely missing the Compliance domain. This is required for App Store approval.

| File / Component | Status in Target | Action Required |
| :--- | :--- | :--- |
| `domain/compliance/` | ❌ Missing | **Copy Folder** |
| `events/customer-redacted.ts` | ❌ Missing | **Copy File** |
| `events/shop-redacted.ts` | ❌ Missing | **Copy File** |
| `services/gdpr-compliance.ts` | ❌ Missing | **Copy File** |
| `repositories/compliance.ts` | ❌ Missing | **Copy Interface** |

### 3.2 Domain: Monitoring (The Core)
**Status:** 🟡 **PARTIAL / BROKEN**
The Target has the entities but lacks the *calculators* and *value objects* that make the data useful.

| File / Component | Status in Target | Issue | Action |
| :--- | :--- | :--- | :--- |
| `entities/competitor.ts` | ✅ Present | Mismatched Props | **Align with Schema** |
| `services/statistics.ts` | ❌ Missing | Logic is inline in API | **Extract & Port** |
| `services/trend-analysis.ts` | ❌ Missing | Logic is inline in API | **Extract & Port** |
| `value-objects/chart.ts` | ❌ Missing | API returns `any` | **Port VO** |
| `value-objects/data-point.ts`| ❌ Missing | API returns `any` | **Port VO** |

### 3.3 Domain: Optimization (Fixes)
**Status:** 🟡 **PARTIAL**
The Source has recently added sophisticated scoring logic (`fix-scoring-service.ts`) which the Target lacks.

| File / Component | Status in Target | Source Status | Gap |
| :--- | :--- | :--- | :--- |
| `entities/fix.ts` | ✅ Present | ✅ Present | Consistent |
| `services/fix-scoring.ts` | ❌ Missing | ✅ Present | **Logic Gap** |
| `services/fix-validator.ts` | ❌ Missing | ✅ Present | **Logic Gap** |
| `services/priority.ts` | ❌ Missing | ✅ Present | **Logic Gap** |

---

## 4. Application Layer: The "Logic Compression" Issue

The Target backend suffers from "God Class" syndrome in its Use Cases. Logic that is beautifully separated in the Source (Services, Value Objects) has been mashed into massive Use Case files in the Target.

### 4.1 Case Study: Dashboard Data
**Target:** `GetDashboardDataUseCase` (~600 lines)
- Fetches data.
- Calculates trends manually (loops).
- Calculates sentiment manually (loops).
- formats charts manually.

**Source:** `GetDashboardChartsUseCase`, `GetGlobalStatsUseCase`, `StatisticsCalculator`
- Separates concerns.
- Reusable logic.
- Testable units.

**Migration Action:**
We must **Refactor** the Target's monolithic Use Case into the granular Use Cases found in the Source.

### 4.2 Case Study: Intelligence Service
**Target:**
```typescript
// Stub implementation
async analyzeRun(runId: string) {
  // Randomly assigns "Durability" or "Price"
  const attr = attributes[Math.floor(Math.random() * length)];
}
```
**Source:**
```typescript
// Real implementation
async analyzeSentiment(text: string) {
  const result = await this.aiClient.run(prompt); // Calls OpenAI/Anthropic
  return JSON.parse(result);
}
```
**Migration Action:**
Delete the Target's stub. Port the Source's `SentimentAnalysisService` and `BrandAnalysisService`.

---

## 5. Infrastructure Layer Audit

### 5.1 Database Repositories
The Repository layer is where the "Ghost Relation" bug lives.

| Repository | Target Implementation | Source Implementation | Status |
| :--- | :--- | :--- | :--- |
| `CompetitorRepository` | **BUG:** Uses `shopConfigId` | Uses `shopConfigId` (Legacy) | **FIX NEEDED:** Target must use `shopId` to match its own schema. |
| `ShopRepository` | ✅ Good | Standard | Target is better (has `hardDelete`). |
| `PromptRepository` | ⚠️ Basic | Advanced Filters | Port filters from Source. |
| `RunRepository` | ⚠️ Basic | Advanced Queries | Port dashboard queries. |

### 5.2 Event Bus
**Target:** Missing. Side effects (like "Delete data when Shop uninstalls") are likely hardcoded or missing.
**Source:** Has `EventPublisher` and `DomainEvent` interfaces.
**Action:** Port the `infrastructure/events` module.

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Days 1-2)
1.  **Fix Schema/Code Mismatch:** Rewrite `CompetitorRepositoryImpl` in Target to correctly use `shopId`.
2.  **Port Compliance Domain:** Copy the entire `compliance` folder to Target.
3.  **Port Value Objects:** Bring over `Chart`, `DataPoint`, `TimeRange`.

### Phase 2: Logic Injection (Days 3-5)
1.  **Port Domain Services:**
    - `StatisticsCalculator`
    - `TrendAnalyzer`
    - `FixScoringService`
2.  **Port AI Services:**
    - `SentimentAnalysisService`
    - `BrandAnalysisService`
3.  **Wire Up:** Replace stubs in Target with these real services.

### Phase 3: Application Refactor (Days 6-8)
1.  **Split Dashboard:** Break `GetDashboardDataUseCase` into 5 granular Use Cases.
2.  **Optimization Routes:** Implement the missing `optimization` routes in `delivery/api`.

### Phase 4: Verification (Days 9-10)
1.  **Add Indexes:** Apply the dashboard performance indexes to `libs/db/prisma/schema.prisma`.
2.  **E2E Test:** Run a full analysis cycle and verify data persists correctly.

---

## 7. File-by-File Migration Checklist

### 7.1 Files to Create (New)
- [ ] `backend/domain/src/compliance/index.ts`
- [ ] `backend/domain/src/compliance/events/*`
- [ ] `backend/domain/src/compliance/repositories/*`
- [ ] `backend/domain/src/compliance/services/*`
- [ ] `backend/domain/src/monitoring/services/statistics-calculator.ts`
- [ ] `backend/domain/src/monitoring/services/trend-analyzer.ts`
- [ ] `backend/domain/src/monitoring/value-objects/chart.ts`
- [ ] `backend/domain/src/monitoring/value-objects/data-point.ts`
- [ ] `backend/domain/src/optimization/services/fix-scoring-service.ts`
- [ ] `backend/infrastructure/src/events/event-publisher.ts`
- [ ] `backend/infrastructure/src/events/event-publisher-impl.ts`

### 7.2 Files to Modify (Fix/Refactor)
- [ ] `backend/infrastructure/src/database/repositories/monitoring/competitor-repository-impl.ts` (Fix relations)
- [ ] `backend/application/common/src/monitoring/analysis/intelligence-service.ts` (Replace stubs)
- [ ] `backend/application/common/src/monitoring/get-dashboard-data.use-case.ts` (Refactor)
- [ ] `backend/libs/db/prisma/schema.prisma` (Add indexes)

---

## 8. Conclusion

The `@backend/` workspace is the correct vessel for the future of Naridon. It is multi-platform ready and architecturally sound. However, it is currently "brain dead" compared to the `@temp_reference` codebase. By executing this migration plan, we will surgically implant the high-value logic from the reference into the superior body of the target, resulting in a robust, scalable, and feature-complete backend.
