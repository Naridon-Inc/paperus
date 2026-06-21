# Architecture Migration Plan: Single SPA & Platform Shells

**Target State:** A single, unified React SPA (`app.naridon.com`) loaded inside lightweight "Platform Shells" (Shopify App, WooCommerce Plugin) via an iframe.

**Core Principle:** The backend (`api.naridon.com`) blindly trusts NO headers. It only trusts a signed **Naridon JWT** obtained via a handshake with the platform shell.

---

## 🏗 Phase 1: Security & Identity Foundation (The Bridge)
*Goal: Secure the backend and enable the token exchange mechanism without breaking the current app.*

### 1.1 Backend: Token Exchange Endpoint
- **Task:** Create `POST /api/auth/exchange`.
- **Logic:**
    1.  Accepts `{ platform: 'shopify', sessionToken: '...' }`.
    2.  Verifies the platform token (e.g., checks Shopify signature).
    3.  Resolves the `Shop` (and future `Tenant`).
    4.  Mints and returns a **Naridon JWT** (Embed Token).
    5.  Payload includes: `sub: shopId`, `aud: 'naridon-spa'`, `roles`, `exp`.

### 1.2 Backend: Auth Middleware Update
- **Task:** Update `AuthService` to verify **Naridon JWTs**.
- **Logic:**
    - If `Authorization: Bearer <jwt>` is present -> Verify signature -> Set context.
    - If `x-cron-secret` is present -> Set system context.
    - If `NODE_ENV=development` AND `x-shop-id` is present -> Allow legacy dev access (temporarily).

### 1.3 Domain: Identity Service
- **Task:** Create `backend/domain/identity/token.service.ts`.
- **Responsibility:** Centralize JWT minting/verification logic.

---

## 🖥 Phase 2: The Core SPA (The Payload)
*Goal: Extract the dashboard UI into a standalone application that can run anywhere.*

### 2.1 Scaffold Core SPA
- **Task:** Create `frontend/apps/core-spa` (Vite + React).
- **Setup:**
    - configured with `react-router` (or lightweight router).
    - configured with `@shopify/polaris` (as the theme layer).
    - configured with `ui-kit`.

### 2.2 Implement "Child" Handshake
- **Task:** Create `EmbedAuthContext` provider.
- **Logic:**
    - On mount: Send `postMessage({ type: 'NARIDON_READY' }, '*')`.
    - Listen for: `postMessage({ type: 'NARIDON_INIT', token: '...' })`.
    - Store token in memory.
    - Intercept all `axios/fetch` calls to attach `Authorization: Bearer <token>`.

---

## 🐚 Phase 3: The Platform Shell (The Host)
*Goal: Turn the existing Shopify app into a thin wrapper.*

### 3.1 Implement "Parent" Handshake
- **Task:** Create a new route/component in `frontend/apps/shopify`.
- **Logic:**
    - Render `<iframe src="https://core-spa.local..." />`.
    - Use App Bridge to get `sessionToken`.
    - Call Backend `/api/auth/exchange` to get `naridonToken`.
    - Listen for `NARIDON_READY`.
    - Send `NARIDON_INIT` with the token.

### 3.2 Token Refresh
- **Task:** Implement refresh loop.
- **Logic:**
    - Child sends `NARIDON_REFRESH_REQUEST`.
    - Shell gets fresh platform token -> calls backend -> sends new `naridonToken`.

---

## 🧹 Phase 4: Migration & Cleanup
*Goal: Switch traffic and delete legacy code.*

1.  **Migrate Routes:** Move `Dashboard`, `Monitor`, `Optimize` views from `apps/shopify` to `apps/core-spa`.
2.  **Switch Default Route:** `apps/shopify/app/routes/app._index.tsx` should just render the Iframe Shell.
3.  **Deprecate `x-shop-id`:** Once stable, remove the dev bypass in `AuthService`.

---

## 📝 Immediate Action Items (This Session)
1.  [x] Create `backend/domain/identity/token.service.ts` (JWT handling).
2.  [x] Create `POST /api/auth/exchange` endpoint.
3.  [x] Create `frontend/apps/core-spa` scaffold.