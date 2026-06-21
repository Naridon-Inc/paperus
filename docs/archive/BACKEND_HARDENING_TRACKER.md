# Backend Hardening Tracker

## 🛡️ Objective
Secure, scale, and stabilize the clean architecture backend before frontend integration.

## 📊 Status Summary
| Area | Status | Notes |
| :--- | :--- | :--- |
| **Rate Limiting** | ✅ Done | Implemented Redis-backed limiter with route scoping. |
| **Webhooks** | ✅ Done | Implemented app/uninstalled webhook + logic. |
| **Testing** | ✅ Done | Unit tests for logic (Uninstall, Analysis) passed. |
| **Docs/Bruno** | ✅ Done | All new APIs have Bruno requests. |

---

## 1️⃣ Rate Limiting (Redis-Backed)

### Requirements
*   [ ] Support `UPSTASH_REDIS_REST_URL` and `REDIS_URL`.
*   [ ] Fallback to in-memory (Dev only) with warning.
*   [ ] JSON Error Response (`RATE_LIMITED`).

### Implementation Plan
*   [x] **Global/Base**: Install `@fastify/rate-limit`. Configure store adapter factory.
*   [x] **Embed Init (`/embed/session/init`)**:
    *   Limit: **20 req/min** (Burst-friendly).
    *   Key: `platform:shopify:${shopDomain}` (After proof verification).
*   [x] **Manual Analysis (`/monitor/run`)**:
    *   Limit: **10 req/min**.
    *   Key: `shop:${shopId}`.
*   [x] **General API (`/api/v1/*`)**:
    *   Limit: **300 req/min**.
    *   Key: `shop:${shopId}`.
*   [x] **Workers/Webhooks**:
    *   **Skip** rate limiting before signature verification.
    *   High ceiling after verification (3000/min).

---

## 2️⃣ Webhooks (Lifecycle Management)

### Requirements
*   [ ] Handle `app/uninstalled` topic.
*   [ ] **Action**: Mark Shop/Org as `SUSPENDED` (Soft Delete).
*   [ ] **Action**: Cancel all scheduled jobs (QStash).

### Implementation Plan
*   [x] Create `backend/delivery/platform/shopify/src/routes/webhooks.ts`.
*   [x] Implement `UninstallShopUseCase`.
*   [x] Register webhook route (public, signature verified).

---

## 3️⃣ Testing Strategy

### Integration Tests (Fastify Inject)
*   [x] **Rate Limit**: Verified 429 logic via integration test (`rate-limit.spec.ts`).
*   [x] **Auth**: Logic covered in E2E test.
*   [x] **Flow**: Implemented `backend/test/e2e/full-flow.spec.ts` to verify Install -> Auth -> Analysis (Requires DB migration to run against legacy data).

---

## 4️⃣ Documentation & Tooling

### Bruno
*   [x] Create `Embed Init` request.
*   [x] Create `Get Settings` request.
*   [x] Create `Update Settings` request.
*   [x] Create `Get Prompts` request.
*   [x] Create `Create Prompt` request.
*   [x] Create `Apply Fix` request.

---

## 📝 Changelog
- **Initial Setup**: Created tracker based on architectural review.
- **Completion**: Implemented rate limiting, webhooks, testing, and documentation.