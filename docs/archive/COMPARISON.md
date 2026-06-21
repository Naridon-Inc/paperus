# Comparison: Current Setup vs Reference Repo

This document compares our current architecture (`Test-app`) against the reference architecture cloned from `Uniskool/naridon` (branch `temp/migrate-to-ts`).

---

## 1. High-Level Architecture

| Feature | Our Setup (`Test-app`) | Reference (`temp/migrate-to-ts`) |
| :--- | :--- | :--- |
| **Workspace Type** | Root-level Monorepo (Turbo + PNPM) | Backend-centric Monorepo (PNPM Workspaces) |
| **Backend** | Single Package (`@test-app/backend`) | Modular Workspaces (`domain`, `infra`, `libs`...) |
| **Frontend** | Modular (`apps/shopify`, `apps/core-spa`) | Legacy Root (`app/`) |
| **Framework** | Fastify + Remix + Vite | Unknown (Backend structure suggests Hexagonal) |

---

## 2. Backend Structure

### Our Setup (`backend/`)
We use a **Layered Monolith** approach inside a single package.
*   **API:** `api/` (Fastify routes, controllers)
*   **Domain:** `domain/` (Business logic services)
*   **Infrastructure:** `infrastructure/` (DB, AI, Email adapters)
*   **Connectors:** `backend/connectors` (Platform logic).
*   **Pros:** Simpler to navigate, easier to deploy as a single unit.
*   **Cons:** Boundaries are logical (folders), not physical (packages).

### Reference Setup (`temp_comparison/backend/`)
They use a **Strict Modular/Hexagonal** approach using physical packages.
*   **Framework:** Fastify (Same as us).
*   **Workspaces:**
    *   `libs/platform`: Dedicated connector abstraction (`base`, `shopify`).
    *   `delivery/api-shopify`: The Fastify server implementation (similar to our `backend/api`).
    *   `domain/`: Pure business logic.
    *   `infrastructure/`: Adapters.
*   **Pros:** Strict dependency enforcement (Domain cannot import Infra) and clean platform abstraction via `libs/platform`.
*   **Cons:** High boilerplate, complex build pipeline (`pnpm --filter ...`).

---

## 3. Frontend Structure

### Our Setup (`frontend/`)
We have adopted a **Platform Shell** architecture.
*   **`apps/shopify`:** Thin Remix wrapper for Shopify Auth.
*   **`apps/core-spa`:** (New) Standalone React SPA for the main UI.
*   **`packages/ui-kit`:** Shared UI components.
*   **Strategy:** Decoupled UI that can be embedded anywhere.

### Reference Setup (`temp_comparison/app/`)
They appear to use a **Standard Remix App** structure at the root.
*   `app/routes`: Remix file-based routing.
*   `app/shopify.server.ts`: Tightly coupled Shopify logic.
*   **Strategy:** Classic "Embedded App" pattern where the backend and frontend are tightly coupled in the Remix runtime.

---

## 4. Key Takeaways

1.  **Backend:** Our backend is simpler but "messier" (folder-based separation). The reference backend is stricter but heavier. Given our goal to move fast, our current structure is appropriate, provided we respect the `domain` vs `infrastructure` boundaries.
2.  **Frontend:** Our frontend architecture (`core-spa` + `shells`) is **superior** for the multi-platform goal. The reference repo is still tied to the Shopify/Remix coupled model.
3.  **Authentication:** We are moving towards `JWT Exchange` (Shell -> SPA), whereas the reference likely relies on standard Remix session cookies/tokens.

## 5. Recommendation

**Stick to our current path.**
*   The **Shell + SPA** architecture we just scaffolded is the right move for multi-platform support.
*   Refactoring the backend into 10+ packages (like the reference) creates unnecessary friction at this stage. We can enforce boundaries via linting rules or folder structure without the overhead of physical packages.