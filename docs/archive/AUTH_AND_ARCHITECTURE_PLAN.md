# Auth & Architecture Remediation Plan

This document outlines the strategic plan to secure the application, enforce billing limits, and prepare the architecture for multi-platform support (Shopify, WooCommerce, etc.), based on the assessment of the current codebase state.

---

## 🚨 Critical Security Fixes (Immediate Priority)

### 1. Eliminate Blind Trust in `x-shop-id`
**Problem:** The backend API currently trusts the `x-shop-id` header blindly, allowing impersonation.
**Solution:** Implement cryptographic verification for all requests.

- [ ] **Define Tenant Identity Model:**
    - Conceptually decouple "Shop" (platform-specific) from "Tenant" (Naridon identity).
    - For now, 1 Shop = 1 Tenant is acceptable, but the code should treat them as separate concepts.

- [ ] **Implement `validateRequest` Middleware:**
    - Replace the current `getAuth` helper with a robust middleware.
    - **Development Mode:** Allow `x-shop-id` ONLY if `NODE_ENV=development`.
    - **Production Mode:** Require a valid **JWT** in the `Authorization` header.
    - **Service-to-Service:** Require a shared secret (e.g., `CRON_SECRET`) or verify QStash signatures for workers/webhooks.

- [ ] **Token Exchange Mechanism:**
    - The Shopify frontend (Remix) already authenticates via App Bridge.
    - It must exchange its Shopify session token for a **Naridon JWT** when calling the backend API.
    - Backend validates the Shopify token, resolves the Shop/Tenant, and issues a short-lived Naridon JWT.

### 2. Secure Worker Ingress
**Problem:** Workers trust payloads without verifying their source (QStash).
**Solution:** Verify signatures.

- [ ] **Verify QStash Signature:**
    - In `backend/api/v1/workers.ts` (or equivalent ingress), verify the `Upstash-Signature` header before enquing jobs.

---

## 💰 Billing & Limits Enforcement

**Problem:** Limits exist in the DB (`ShopPlanLimit`) but are ignored by workers and API endpoints.
**Solution:** Create a centralized metering service.

- [ ] **Create `UsageService` Domain:**
    - `assertAndConsume(shopId, resource: 'prompt_run' | 'fix_apply', cost: number)`
    - This function should throw a specific error (`BillingError` or `LimitExceededError`) if the action is not allowed.

- [ ] **Enforce at Entry Points:**
    - **API (`POST /monitor/run`):** Call `UsageService.assertAndConsume` *before* triggering the worker.
    - **Worker (`email-queue`):** Re-check limits inside the worker (double-check pattern) to prevent race conditions or "free" usage if the API check was bypassed/stale.
    - **Optimization (`POST /optimize/fixes`):** Gate fix application based on plan limits.

---

## 🏗 Platform Abstraction & Architecture

**Goal:** Clean separation between the "Core App" logic and "Platform Shells".

### 1. Standardize Connector Interface
**Problem:** Some logic might still be platform-coupled.
**Solution:** Ensure all platform interactions go through a unified interface.

- [ ] **Define `PlatformConnector` Interface:**
    - `syncCatalog()`
    - `applyFix(fixId)`
    - `getStoreContext()`
- [ ] **Audit Domain Services:** Ensure `AnalyticsService` and `MonitoringService` do not import Shopify SDKs directly. They should use the abstract connector.

### 2. Migration to `app.naridon.com` Iframe
**Current State:** Iframe content served by `frontend/apps/shopify`.
**Target State:** Iframe content served by `app.naridon.com` (Core App), wrapped by platform shells.

- [ ] **Phase 1 (Stabilize):** Keep UI in Shopify app for now, but secure the backend API.
- [ ] **Phase 2 (Decouple):**
    - Build the Core App (Next.js/Remix) at `app.naridon.com`.
    - Shopify App becomes a "Thin Shell" that performs Auth Handshake -> Load Iframe with Token.

---

## 🧹 Data Retention Policy

**Problem:** Raw LLM outputs stored indefinitely.
**Solution:** Implement a retention policy to manage DB growth.

- [ ] **Define Policy:**
    - `Run.response`: Keep for 30 days.
    - `Metrics/Stats`: Keep indefinitely.
- [ ] **Implement Cleanup Job:**
    - Create a cron job (via QStash/Scheduler) to delete old `Run` content or archive it.

---

## 📝 Execution Checklist

### Week 1: Security & Billing
- [x] Create `validateRequest` middleware (Backend).
- [x] Update `dashboard-v2.ts` and all Monitor/Optimize routes to use middleware.
- [x] Implement `UsageService` (Backend).
- [x] Add `UsageService` checks to `POST /prompts` and `POST /run`.

### Week 2: Platform Independence
- [ ] Refactor `frontend` to pass JWTs instead of raw IDs.
- [ ] Audit and refactor `seed` scripts to use API/Service layers instead of direct DB inserts where possible (or verify they remain dev-only tools).

### Week 3+: Architecture Migration
- [ ] (Future) Begin work on standalone `app.naridon.com` deployment.