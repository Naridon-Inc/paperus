# Master Migration Plan: Monolith to Clean Architecture

## 1. Executive Summary
**Objective:** Transition the working functionality from `backend_legacy` (Monolith) to the new `backend` (Clean Architecture/DDD).
**Strategy:** Vertical Slice Migration. We will migrate feature-by-feature, strictly adhering to the new layered architecture.
**Codebase State:**
-   `backend_legacy`: Reference implementation (Source of Truth for logic).
-   `backend`: Target architecture (Source of Truth for structure).

---

## 2. Architecture Mapping

We are moving from a "Service/Router" pattern to "Domain/Use-Case/Infrastructure" pattern.

| Concept | Legacy Location (`backend_legacy`) | Target Location (`backend`) | Responsibility |
| :--- | :--- | :--- | :--- |
| **Database Schema** | `infrastructure/db/schema.prisma` | `libs/db` | Database definition & Client generation. |
| **Data Models** | Prisma Generated Types | `domain/src/**/entities` | Rich objects with business rules & validation (Zod). |
| **Business Logic** | `api/v1/**` & `AIService.ts` | `application/**/use-cases` | Orchestration of business flows. |
| **External APIs** | `infrastructure/ai/*` | `libs/ai` & `infrastructure/**` | Adapters for 3rd party services (OpenAI, Shopify). |
| **API Routes** | `api/v1/**` | `delivery/api/src/routes` | HTTP handling, validation, mapping to Use Cases. |
| **Workers** | `workers/**` | `infrastructure/src/jobs` | Background task processing. |

### 📂 Backend Folder Structure (Detailed)

*   **`backend/domain`**: The "Brain". Pure TypeScript entities with business logic.
    *   Contains: Entities (`Competitor`, `Shop`), Value Objects (`SignalType`), Repository Interfaces (`IShopRepository`).
    *   Rule: No external dependencies (except Zod/Shared). No DB code.
*   **`backend/application`**: The "Flow".
    *   Contains: Use Cases (`RunAnalysisUseCase`), Application Services (`AnalyzeCompetitorsService`).
    *   Split: `common` (shared logic), `app-shopify` (Shopify-specific flows).
    *   Rule: Orchestrates domain objects and repositories. Does not know about HTTP or SQL.
*   **`backend/infrastructure`**: The "Plumbing".
    *   Contains: Repository Implementations (`CompetitorRepositoryImpl`), External Adapters (SendGrid, QStash).
    *   Rule: Implements interfaces defined in Domain. Connects to `libs/db`.
*   **`backend/delivery`**: The "Interface".
    *   **`api`**: The Core Server. Host generic routes (`/monitor`, `/optimization`). Uses generic Auth Middleware.
    *   **`platform/shopify`**: Shopify Adapter Plugin. Handles OAuth, Webhooks. Registered into Core Server.
    *   Rule: Handles HTTP, validation, and dependency injection.
*   **`backend/libs`**: Shared Libraries.
    *   `db`: Prisma Schema & Client.
    *   `ai`: AI Clients (OpenAI/Vercel AI SDK).
    *   `platform`: Platform adapters (Shopify API wrappers).
    *   `shared`: Utilities (Logger, JSON Parser).

---

## 3. Migration Phases

### ✅ Phase 0: Setup & Foundation (COMPLETED)
**Goal:** Ensure the new workspace builds and connects to the database.
1.  [x] **Dependencies:** Run `pnpm install` and resolve workspace version conflicts.
2.  [x] **Database:**
    -   [x] Copy `backend_legacy/infrastructure/db/schema.prisma` to `backend/libs/db/prisma/schema.prisma`.
    -   [x] Run `prisma generate` in `backend/libs/db`.
    -   [x] Ensure `libs/db` exports the Prisma client correctly.
3.  [x] **Shared Libs:** Ensure `libs/shared` contains necessary utilities (logger, `generateId`, base errors).

### ✅ Phase 1: Core Domain Modeling (COMPLETED)
**Goal:** Define *what* the system does before defining *how* it does it.
**Focus:** `backend/domain`
1.  [x] **Review Legacy Data:** Analyze `backend_legacy/infrastructure/db/schema.prisma`.
2.  [x] **Create Entities:** Port logic from Legacy Services into Domain Entities.
    -   [x] `Monitoring`: Competitor, SmartSignal (Refined & Adapted to `shopConfigId`).
    -   [x] `Identity`: Shop, PlatformSession.
    -   [x] `Configuration`: ShopConfig (Created to bridge gap in Naridon architecture).
    -   [ ] `Optimization`: Fix, Redirect (Next).
3.  [x] **Define Interfaces:** Create Repository Interfaces (e.g., `ICompetitorRepository`, `IShopConfigRepository`) in `domain`.

### 🏗️ Phase 2: Infrastructure Implementation (COMPLETED)
**Goal:** Connect the Domain to the real world (Database, AI).
**Focus:** `backend/infrastructure` & `backend/libs`
1.  [x] **Database Repositories:** Implemented all monitoring and shop repositories.
2.  [x] **AI Engine (`libs/ai`):**
    -   [x] Implemented `OpenAIClient` using Vercel AI SDK.
    -   [x] Implemented `AIClientFactory`.
3.  [x] **Shopify Adapter:** Auth is fully implemented and working. API client is ready.
4.  [x] **QStash Adapter:** Implemented for secure worker execution.

### 🚀 Phase 3: Application Layer (IN PROGRESS)
**Goal:** Implement the specific actions users take.
**Focus:** `backend/application`
**Key Use Cases to Migrate:**
1.  **Monitoring:**
    -   [x] `GetDashboardDataUseCase` (Implemented & Tested)
    -   [x] `RunAnalysisUseCase` (Implemented with Entitlements & Idempotency)
    -   [x] `AnalyzeCompetitorsService` (Shared logic)
2.  **Optimization:**
    -   [x] `GetFixesUseCase`
    -   [x] `ApplyFixUseCase`

### 📦 Phase 4: Delivery Layer (COMPLETED)
**Goal:** Expose the Use Cases via HTTP.
**Focus:** `backend/delivery`
1.  [x] **Setup Fastify:** Configure the server in `delivery/api` (Universal Backend).
2.  [x] **Authentication:** Implement the Auth Middleware (`requireEmbedAuth`) & Routes using `libs/platform/shopify`.
3.  **Create Application Routes:**
    -   [x] `GET /api/v1/monitor/dashboard` -> `GetDashboardDataUseCase`.
    -   [x] `POST /api/v1/monitor/run` -> `RunAnalysisUseCase`.
    -   [x] `POST /api/v1/workers/process-prompt` -> Worker Ingress (Secure).

---

## 4. Specific Refactoring Rules

1.  **No "God Classes":**
    -   ❌ `AIService.ts` (2000 lines)
    -   ✅ Split into: `CompetitorAnalysisService`, `SentimentService`, `FixGenerationService`.
    -   ✅ Orchestrated by `RunAnalysisUseCase`.

2.  **Strict Validation:**
    -   All Use Cases must accept a strictly typed Request object (DTO).
    -   Use `zod` for all runtime validation.

3.  **Dependency Injection:**
    -   Use Cases receive Repositories via constructor.
    -   Do not import `prisma` directly in Use Cases.

---

## 5. Immediate Next Steps

1.  [x] **Migrate AI Logic:** Implement `libs/ai` and move logic from `AIService.ts`.
2.  [x] **Complete RunAnalysis:** Finish `RunAnalysisUseCase` with real AI calls.
3.  [x] **Create Routes:** Expose the analysis endpoint.
4.  [x] **Entitlements:** Implement `EntitlementsService` and enforce limits.
5.  [x] **Optimization:**
    -   [x] Defined `Fix` & `FixExecution` domain entities.
    -   [x] Created `PlatformOptimizationPort` interface and `ShopifyOptimizationAdapter`.
    -   [x] Implemented `GetFixesUseCase` & `ApplyFixUseCase` (Deterministic, no entitlements required).
    -   [x] Exposed routes `GET /fixes` & `POST /fixes/:id/apply`.
6.  [x] **Prompts & Settings:**
    -   [x] Defined `Prompt` (with status) & `ShopConfig` domain entities.
    -   [x] Created `QStashSchedulerAdapter` implementing `ISchedulerPort`.
    -   [x] Implemented Use Cases: `Get/Create/Update/Delete Prompt` and `Get/Update Settings`.
    -   [x] Integrated Scheduling logic in `Create/Update Prompt`.
    -   [x] Exposed routes `GET/POST/PATCH/DELETE /prompts` and `GET/PUT /settings`.
7.  [x] **Onboarding (New):**
    -   [x] Implemented Use Cases: `GetStatus`, `UpdateStep`, `Complete`.
    -   [x] Exposed routes `GET/PATCH/POST /onboarding`.
8.  [x] **Prompt Generation (General):**
    -   [x] Implemented `AIPromptGenerator` service.
    -   [x] Implemented `GeneratePromptsUseCase`.
    -   [x] Exposed route `POST /prompts/generate`.
9.  [x] **Refactoring (Platform Agnostic):**
    -   [x] Split `delivery` into `api` (Core) and `platform/shopify` (Adapter).
    -   [x] Implemented Rate Limiting (Redis-backed).
    -   [x] Implemented Webhooks (Uninstall).

### 🏁 **Migration Completed**
The backend has been fully migrated to the Clean Architecture (Monorepo) structure.
All critical features from legacy (Analysis, Dashboard, Optimization, Prompts, Settings) are now implemented with:
*   Secure Auth (Embed Token)
*   Cost Control (Entitlements)
*   Platform Agnosticism
*   Safety (Idempotency & Worker Isolation)

---

## 6. Backend Architecture Checklist (Strict Rules)

This checklist aligns with the final architectural decisions: **Polaris-only SPA, iframe-first, multi-platform, orgs, no storefront copilot.**

### 1️⃣ Authentication & Trust Model (CRITICAL)
*   [x] **No Header Trust**: ❌ Do NOT trust `x-shop-id` headers. ❌ Do NOT accept `shopId` from query/body without verification.
*   [x] **Signed Embed Token**: Backend issues a signed JWT (Embed Token) after validating the platform session.
*   [x] **Token Verification**: Verify Embed Token on **every** API request.
*   [x] **Context Derivation**: Backend derives `orgId`, `shopId`, `platform`, `userId`, `role` from the token.
*   [x] **Token Lifecycle**: Short-lived (5-15 min). Refresh via parent iframe shell. SPA never stores secrets long-term.

### 2️⃣ Embedded App Contract (Iframe-first)
*   [x] **Endpoints**: Support `/embed/session/init`, `/embed/session/refresh`, `/embed/session/revoke`.
*   [x] **Token Exchange**:
    1.  Platform shell authenticates user/shop.
    2.  Backend validates platform auth.
    3.  Backend issues Naridon embed token.
    4.  SPA only talks to Naridon backend using Bearer token.

### 3️⃣ Org & Multi-Shop Architecture
*   [x] **Data Model**:
    *   Each Shop belongs to exactly one Org.
    *   One-shop installs auto-create an Org.
    *   Ownership can be transferred.
*   [x] **Access Rules**: Users belong to Orgs. Analytics aggregated per Shop (optionally per Org).
*   [x] **API Context**: APIs must always accept `orgId` (from token) and `shopId` (from token or explicit switch).

### 4️⃣ Platform Abstraction Layer (Non-negotiable)
*   [x] **No Hardcoding**: Never hardcode Shopify logic in domain layer.
*   [x] **Connector Interfaces**: Use interfaces for Product read, Metadata write, Redirects, Platform capabilities.
*   [x] **Reality Check**: Ready for Woo (REST), Magento/BigCommerce (REST/GraphQL), Salesforce.

### 5️⃣ Billing & Entitlements
*   [x] **Enforcement**: Enforce limits **before** enqueueing jobs, processing workers, or manual runs.
*   [x] **Metered Items**: Prompt runs, Mention scans.
*   [x] **Unified Resolver**: Implement `getEntitlements(orgId, shopId)`.

### 6️⃣ Workers, Jobs & Idempotency
*   [x] **Security**: Verify signature at ingress (QStash). Workers cannot be abused by forged payloads.
*   [x] **Billing**: Re-check billing inside worker.
*   [x] **Attribution**: Job IDs must be verified + owned by org/shop. Record cost attribution.

### 7️⃣ Monitoring Runs & Cost Control
*   [x] **Deduplication**: Intelligent deduplication of runs.
*   [ ] **Caching**: Cache search results, LLM judgments, citation analysis.
*   [ ] **Retention**: Store raw responses but plan archival (90-180 days). Keep aggregated metrics forever.

### 8️⃣ UI-Agnostic API Design (Polaris-only SPA)
*   [x] **Decoupling**: No Polaris/App Bridge coupling in Backend. No Remix assumptions.
*   [x] **Format**: Pure JSON APIs.
*   [x] **Context**: Platform context only via token.

### 9️⃣ Embedded-only Constraint
*   [x] **Flow**: Never require top-level redirects. Support iframe-safe auth flows.
*   [x] **Auth**: Avoid cookie-based auth assumptions.

### 🔟 Platform-Specific Backend Differences
*   [x] **Shell Handling**: Different auth proofs, billing callbacks, uninstall semantics handled via Shell/Adapters.
*   [x] **Core Logic**: Core domain logic stays identical.

### 1️⃣1️⃣ Security & Abuse Prevention
*   [x] **Rate Limiting**: By Org + Shop.
*   [x] **Validation**: Validate embed tokens strictly. Reject cross-org access.
*   [x] **Logging**: Log cost-heavy abuse patterns.

### 1️⃣2️⃣ Future-Ready (Deferrable)
*   [ ] **Defer**: Standalone auth, Non-embedded UI, Enterprise SSO, SOC2. Don't block MVP.

---

## 7. Final Auth + Refresh Spec (API-only backend, embedded SPA)

### 0️⃣ Non-negotiables
*   SPA is always `app.naridon.com` (Shopify iframe loads it directly).
*   Frontend uses App Bridge client-only to mint Shopify Session Token.
*   Backend verifies Shopify session token and mints Naridon Embed JWT (15 min).
*   All Naridon APIs require `Authorization: Bearer <naridon_jwt>`.
*   Refresh is stateless: when Naridon JWT expires → frontend gets fresh Shopify session token → calls `/embed/session/init` again.

### 1️⃣ Endpoints (Minimal Set)

#### POST /embed/session/init
*   **Purpose**: Exchange platform proof → Naridon token.
*   **Headers**: `Authorization: Bearer <shopify_session_token>` (or `X-Platform-Token`).
*   **Body**: `{ "platform": "shopify", "shop": "example.myshopify.com" }`
*   **Backend Logic**:
    1.  Verify Shopify session token signature + claims.
    2.  Derive canonical shop identity.
    3.  Upsert Shop (and Org if first install) in DB.
    4.  Mint Naridon JWT containing: `platform`, `shopId`, `orgId`, `exp`, `iat`, `jti`.
    5.  Return: `{ "accessToken": "jwt", "expiresIn": 900, "org": {...}, "shop": {...} }`.

### 2️⃣ Naridon JWT Verification Middleware
*   Verify JWT signature & validate exp.
*   Read `orgId`, `shopId`, `platform` from token.
*   **Rule**: Never accept `shopId` from query/header/body.
*   Put `{orgId, shopId, platform}` into request context.

### 3️⃣ Refresh Logic (Frontend)
*   **Lifecycle**: Store `naridonToken` in memory. On load -> App Bridge -> Session Token -> `/embed/session/init`.
*   **API Wrapper**:
    1.  Send `Authorization: Bearer <naridonToken>`.
    2.  If 401: Get fresh Shopify session token -> Call `/embed/session/init` -> Retry once.
*   **Storm Prevention**: Keep single in-flight refresh promise.

### 4️⃣ Worker Security
*   Worker ingress does **not** use Naridon JWT.
*   Protected by QStash signature verification.
*   Looks up job payload `{shopId, promptId}`.
*   Runs use case with context fetched from DB.