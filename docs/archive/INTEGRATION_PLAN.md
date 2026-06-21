# Integration Plan: Smart Shared Features 🧠

This document outlines the revised strategy for integrating `@test-app/shared-features` into platform applications (Shopify, Shopware). Based on requirements, we are moving to a **Smart Component** architecture where shared components handle their own data fetching.

## 1. Core Philosophy

*   **Shared Components are "Smart":** They use React Query hooks to fetch the data they need directly.
*   **Platform Apps are "Providers":** They only provide the **Authentication Context** (e.g., an Axios instance with the correct headers) and the **Query Client**.
*   **API Standardization:** Both platforms must proxy requests to the standard backend API structure (`/api/v1/...`).

## 2. Architecture

### Shared Library (`shared-features`)
1.  **`ApiContext`:** A React Context that exposes an `api` client (Axios instance).
2.  **`useApi` Hook:** Consumes the context.
3.  **Data Hooks:** Custom hooks like `useMonitorDashboard()`, `useCompetitors()` that use `useApi` + `useQuery`.
4.  **Components:** `MonitorPage` calls these hooks directly.

### Platform App (`apps/shopify-new`)
1.  **`ApiProvider`:** Wraps the app. Passes an Axios instance configured with Shopify Session Tokens (via App Bridge).
2.  **Usage:** Just render `<MonitorPage />`. No data plumbing required.

## 3. Implementation Steps

### Step 1: Create API Context in Shared Lib
**File:** `frontend/packages/shared-features/src/providers/ApiProvider.tsx`
-   Define context for `AxiosInstance`.
-   Export `useApi()` hook.

### Step 2: Create Data Hooks
**File:** `frontend/packages/shared-features/src/hooks/useMonitorData.ts`
-   Implement `useQuery` calls to:
    -   `/api/v1/monitor/dashboard`
    -   `/api/v1/monitor/mentions`
    -   etc.

### Step 3: Refactor Monitor Page
**File:** `frontend/packages/shared-features/src/pages/Monitor.tsx`
-   Remove `MOCK_MONITOR_DATA`.
-   Replace with `useMonitorData()` hooks.

### Step 4: Integrate in Shopify
**File:** `frontend/apps/shopify-new/src/App.tsx` (or Layout)
-   Wrap with `ApiProvider` passing the `api` instance (which already has interceptors).

## 4. Why this is better
-   **Drop-in:** You can drop `MonitorPage` into *any* React app (Shopware, Standalone) as long as you provide an authenticated Axios instance.
-   **Decoupled:** The UI doesn't care *how* auth happens, only that it has a client that works.
-   **Scalable:** Adding a new feature only requires updating the shared library; platform apps automatically inherit the logic.