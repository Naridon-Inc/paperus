# Verification Guide: Auth & Backend Integration

This guide outlines the steps to verify that the **Authentication Migration** and **Backend-for-Frontend** integration are working correctly.

## Prerequisites

1.  **Running Environment**:
2.  Ensure the development environment is running:

pnpm run dev:all

1.  Backend running on port `4000`.
2.  Frontend running via Shopify CLI (with Cloudflare tunnel).
3.  Worker running (optional for auth, but good for system health).
4.  **Database**:
5.  Ensure Postgres is running (Docker) and accessible.

## 1\. Verify Authentication Flow

This test ensures that the Frontend correctly delegates authentication to the Backend.

### Steps

1.  **Clear Existing Sessions** (Force a clean state):

cd backend && npx ts-node infrastructure/db/reset-session.ts

1.  *Expected Output*: `Deleted X sessions.`
2.  **Access the App**:
3.  **Option A (Recommended)**: Go to your **Shopify Admin** > Apps > \[Your App Name\].
4.  **Option B (Dev Tunnel)**: Visit the Cloudflare URL provided in the terminal (e.g., `https://random-name.trycloudflare.com`).
5.  **Observe Behavior**:
6.  **Redirect**: The browser should redirect to `/auth/login`.
7.  **Proxy**: The Vite proxy forwards this to `http://localhost:4000/api/auth/login`.
8.  **Handshake**: You should see the Shopify OAuth permission screen (if strictly new) or a quick redirect loop (if re-authorizing).
9.  **Success**: You should land on the "Connection Successful" page (if external) or load the Dashboard immediately (if in Admin).
10.  **Check Logs**:
11.  Look at the `[BACKEND]` logs in your terminal. You should see:

\[shopify-api/INFO\] Beginning OAuth ...

\[shopify-api/INFO\] Completing OAuth ...

\[shopify-api/INFO\] Creating new session ...

\[ShopifyAuth\] Successfully authenticated <your-shop-domain>

1.  **Check Database**:
2.  Run the check script:

cd backend && npx ts-node infrastructure/db/check-session.ts

1.  *Expected Output*: `Found 1 sessions: - Shop: <your-shop-domain> ...`

## 2\. Verify Backend API Integration

This test ensures that the Frontend acts as a proper UI layer, fetching data from the Backend API.

### Steps

1.  **Load the Dashboard**:
2.  Navigate to the app's main dashboard in Shopify Admin.
3.  **Inspect Network Traffic**:
4.  Open Browser Developer Tools (F12) > **Network** tab.
5.  Filter by `Fetch/XHR`.
6.  Refresh the page.
7.  **Look for API Calls**:
8.  You should see requests to `/api/v1/monitor/dashboard` (or similar).
9.  **Status Code**: `200 OK`.
10.  **Response**: JSON data containing `stats`, `dashboard`, `chartData`, etc.
11.  **Check Logs**:
12.  Look at the `[BACKEND]` logs. You should see:
13.  `text req: { method: 'GET', url: '/api/v1/monitor/dashboard', ... } prisma:query ... (Multiple SQL queries fetching data) res: { statusCode: 200 } ...`

## 3\. Verify Session Sharing

This confirms that the Frontend and Backend are reading from the same "Source of Truth."

1.  **Frontend Logic**:
2.  The Remix loader in `app/routes/app.monitor._index.tsx` uses `authenticate.admin(request)`. This succeeds because it reads the session from the shared Postgres database.
3.  **Backend Logic**:
4.  The API endpoint in `backend/api/v1/monitor/dashboard.ts` checks `x-shop-id` or session headers. It verifies the request matches the session stored in the DB.

## Troubleshooting Common Issues

<table><tbody><tr><td data-row="1">Issue</td><td data-row="1"><strong>Symptom</strong></td><td data-row="1"><strong>Fix</strong></td></tr><tr><td data-row="2"><strong>Tunnel Mismatch</strong></td><td data-row="2"><code>Cloudflare Tunnel error</code> or 404s</td><td data-row="2">Restart <code>pnpm run dev:all</code> and use the <strong>new</strong> Cloudflare URL.</td></tr><tr><td data-row="3"><strong>Missing DB</strong></td><td data-row="3">Connection errors in logs</td><td data-row="3">Ensure Docker container is up (<code>docker compose up -d</code>) and schema is pushed (<code>pnpm run db:push</code>).</td></tr><tr><td data-row="4"><strong>Auth Loop</strong></td><td data-row="4">Constant redirecting to login</td><td data-row="4">Clear browser cookies or run <code>reset-session.ts</code> to clear stale DB states.</td></tr><tr><td data-row="5"><strong>Proxy Fail</strong></td><td data-row="5"><code>404 Not Found</code> on <code>/auth</code></td><td data-row="5">Check <code>vite.config.ts</code> proxy rules. Ensure conflicting Remix routes (e.g., <code>routes/auth.login</code>) are deleted.</td></tr></tbody></table>