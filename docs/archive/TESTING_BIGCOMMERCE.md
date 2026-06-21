# Testing BigCommerce App Integration

This guide outlines the steps to test the Naridon BigCommerce application in a development environment.

## Prerequisites

1.  **BigCommerce Developer Account**: Sign up at [devtools.bigcommerce.com](https://devtools.bigcommerce.com/).
2.  **Sandbox Store**: Create a sandbox store in your developer portal.
3.  **Tunneling Tool**: `ngrok` (or Cloudflare Tunnel) to expose your local environment.

## 1. Environment Configuration

### Backend

Add the following variables to `backend/.env`. If the file doesn't exist, create it.

```env
# BigCommerce App Credentials (Get these after Step 2)
BIGCOMMERCE_CLIENT_ID=your_client_id
BIGCOMMERCE_CLIENT_SECRET=your_client_secret

# Tunnel URL (Must be HTTPS)
# IMPORTANT: Use BIGCOMMERCE_APP_URL to prevent conflict with other platform envs
BIGCOMMERCE_APP_URL=https://your-tunnel-url.ngrok-free.app
```

### Frontend

No specific `.env` changes are required for the BigCommerce frontend app (`frontend/apps/bigcommerce`) as it is served by Vite and proxies API calls to the backend via `vite.config.ts`.

## 2. Register the App in BigCommerce

1.  Log in to the [BigCommerce Developer Portal](https://devtools.bigcommerce.com/).
2.  Click **Create an App**.
3.  **Technical Details**:
    *   **Auth Callback URL**: `{BIGCOMMERCE_APP_URL}/api/platform/bigcommerce/auth/callback`
        *   Example: `https://abcd-1234.ngrok-free.app/api/platform/bigcommerce/auth/callback`
    *   **Load Callback URL**: `{BIGCOMMERCE_APP_URL}/api/platform/bigcommerce/auth/load`
    *   **Uninstall Callback URL**: `{BIGCOMMERCE_APP_URL}/api/platform/bigcommerce/auth/uninstall`
4.  **OAuth Scopes**:
    *   Select `Information > Read-Only` (or other scopes as needed by the app).
5.  Click **Update & Save**.
6.  Copy the **Client ID** and **Client Secret** shown on the screen and update your `backend/.env` file.

## 3. Start the Development Environment

### Start the Backend

Open a terminal in the `backend` directory:

```bash
cd backend
pnpm dev
```

The server runs on port `3000`.

### Start the Frontend

Open a new terminal in the `frontend/apps/bigcommerce` directory:

```bash
cd frontend/apps/bigcommerce
pnpm dev
```

The frontend runs on port `5173`.

### Start the Tunnel

Tunnel to your **Frontend (5173)**. This allows you to see the UI while `/api` requests are proxied to the backend via Vite.

```bash
ngrok http 5173
```

*Note: Ensure the URL generated matches `BIGCOMMERCE_APP_URL` in your `.env`.*

## 4. Install the App

1.  Go to the **BigCommerce Developer Portal**.
2.  Locate your draft app.
3.  Click **Install**.
4.  Select your **Sandbox Store**.
5.  Click **Confirm**.

The OAuth flow will trigger:
1.  BigCommerce redirects to your Backend (`/auth/callback`).
2.  Backend exchanges code for token and stores it in the database.
3.  Backend redirects to `/` (Frontend).
4.  Frontend initializes and calls `/auth/exchange` using the `signed_payload_jwt`.
5.  App loads in the iframe.

## Troubleshooting

### "Authentication failed" / 400 Bad Request
*   **Cause**: `redirect_uri_mismatch`.
*   **Fix**: Ensure `BIGCOMMERCE_APP_URL` in `.env` matches the ngrok URL exactly (https vs http, no trailing slash). Restart backend after changing `.env`.

### "Invalid issuer"
*   **Cause**: BigCommerce sending `iss: "bc"` but adapter expected `"BigCommerce"`.
*   **Fix**: Ensure you have the latest backend code updates (Auth Adapter v0.1.1+ supports "bc").

### "The table public.PlatformInstallation does not exist"
*   **Cause**: Database schema is ahead of the actual database.
*   **Fix**: Run the following command in the `backend` folder to sync the schema:
    ```bash
    pnpm --filter @naridon/db exec prisma db push
    ```

### "Refused to frame..." (CSP Error)
*   **Cause**: The app is trying to be framed by BigCommerce but headers deny it, or ngrok interstitial page is blocking.
*   **Fix**:
    *   Ensure `BIGCOMMERCE_APP_URL` uses HTTPS.
    *   If using ngrok free tier, use the `--host-header=rewrite` flag or click "Visit Site" on the warning page once.
    *   Check backend `index.ts` to ensure no global CSP headers (e.g. Helmet) are blocking framing from `*.bigcommerce.com`.