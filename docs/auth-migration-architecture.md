# Shopify App API & Authentication Migration

## Overview

This document outlines the architecture refactor moving the Shopify OAuth handshake and session management from the Remix Frontend to the Fastify Backend. This establishes a clean "Backend-for-Frontend" (BFF) pattern where the Frontend acts as a lightweight UI layer and the Backend serves as the central authority for Authentication, Data, and Background Jobs.

## Architecture

### Previous State (Standard Remix Template)
- **Frontend (Remix)**: Handled OAuth, Session Storage, and UI.
- **Backend**: Isolated, difficult to share session context without duplicating logic.
- **Database**: Accessed directly by Frontend for session checks.

### New State (Migrated)
- **Frontend (Remix)**:
  - Acts as the **View Layer**.
  - **Reads** sessions from the shared database to verify login status.
  - Proxies authentication requests (`/auth/*`) to the Backend.
  - Proxies API requests (`/api/*`) to the Backend.
- **Backend (Fastify)**:
  - **Writes** sessions to the shared database during the OAuth handshake.
  - Handles Shopify Webhooks and API requests.
  - Manages Background Workers (BullMQ).
- **Database (Postgres)**:
  - Single source of truth for Sessions, accessible by both services via Prisma.

## The Authentication Flow

### 1. Installation / Login
When a user installs the app or logs in:

1.  **User visits App URL**: `https://<tunnel-url>?shop=store.myshopify.com`
2.  **Remix Check**: Frontend checks DB for a valid session.
    - *Result*: No session found.
3.  **Redirect**: Remix redirects browser to `/auth/login`.
4.  **Proxy Intercept**: The Vite Proxy (`vite.config.ts`) catches requests to `/auth/*` and forwards them to `http://localhost:4000/api/auth/*`.
5.  **Backend Handshake**:
    - Fastify receives the request.
    - Initiates Shopify OAuth flow (redirects to Shopify permissions screen).
6.  **Callback**:
    - User accepts permissions.
    - Shopify redirects to `/auth/callback`.
    - Backend exchanges code for **Access Token**.
    - Backend **saves Session** to Postgres `session` table.
7.  **Completion**: Backend displays a "Connection Successful" page and links back to the dashboard.

### 2. Dashboard Access
When an authenticated user opens the app in Shopify Admin:

1.  **Shopify loads App**: `https://admin.shopify.com/store/.../apps/...`
2.  **Remix Check**: Frontend checks DB for a valid session using the `shop` query param.
    - *Result*: Session found (saved by Backend in step 1).
3.  **Render**: Remix renders the App Dashboard.
4.  **Data Fetching**: The UI fetches data via `/api/v1/...`, which is proxied to the Backend.

## Key Configuration Changes

### 1. Frontend Proxy (`frontend/apps/shopify/vite.config.ts`)
Configured to forward Auth and API requests to the running backend.

```typescript
proxy: {
  "/api": {
    target: "http://localhost:4000",
    changeOrigin: false,
    secure: false,
  },
  "/auth": {
    target: "http://localhost:4000",
    changeOrigin: false,
    secure: false,
    rewrite: (path) => path.replace(/^\/auth/, "/api/auth"),
  },
}
```

### 2. Route Cleanup
- **Removed**: `frontend/apps/shopify/app/routes/auth.login` (Folder)
- **Removed**: `frontend/apps/shopify/app/routes/auth.$.tsx`
- **Updated**: `_index/route.tsx` (Landing Page) to use `reloadDocument` on form submission to bypass client-side routing and trigger the proxy.

### 3. Shared Database
Both services use the same Prisma schema (`session` model) and connect to the same Postgres instance.

## Verification

To verify the flow works:

1.  **Clear Sessions**:
    ```bash
    cd backend && npx ts-node infrastructure/db/reset-session.ts
    ```
2.  **Open App**: Visit the Cloudflare tunnel URL or open the app in Shopify Admin.
3.  **Observe Logs**:
    - **Frontend**: Redirects to `/auth/login`.
    - **Backend**: Logs `[shopify-api/INFO] Beginning OAuth`, saves session to DB.
4.  **Success**: App Dashboard loads, and API requests (e.g., `/api/v1/monitor/dashboard`) return `200 OK`.

## Benefits

1.  **Decoupling**: The Frontend is now easily replaceable (e.g., with a Mobile App or Next.js) without rewriting Auth logic.
2.  **Security**: Tokens and secrets are managed centrally by the Backend.
3.  **Consistency**: Background workers and UI share the exact same session and data context.