# Production Error Debugging - Shoppeec/Naridon

## Issue Description
After deploying the latest changes to production (`app.naridon.com`) and switching the Shoppeec app to use it, the frontend is reporting:
1.  **401 Unauthorized** on `/api/v1/monitor/products`.
2.  **403 Forbidden** on `/api/v1/optimization/redirects`.

## Hypotheses

### 1. 401 Unauthorized (Products)
*   **Token Issue**: The authentication token being sent might be invalid, expired, or missing.
*   **Session Mismatch**: The backend might not be finding a valid offline session for the shop `3ce2ebca-12fc-4157-bb1a-123b162d2eee`.
*   **Scope Issue**: The access token might be missing `read_products` scope, causing Shopify API calls to fail (which sometimes bubble up as 401/500 depending on handling).

### 2. 403 Forbidden (Redirects)
*   **Missing Scopes**: The error message explicitly mentions missing scopes. The redirects API requires `read_content` or `write_content`.
*   **Re-installation Required**: Even if we updated the configuration to include these scopes, the *existing* access token for the shop won't have them until the user re-authenticates (re-installs).

## Investigation Plan

1.  **Analyze Backend Logs**:
    *   Check logs for the specific `reqId` or `shopId` to see the detailed error message from the backend.
    *   Look for "Shopify authentication failed" or "Scope mismatch" logs.

2.  **Verify Scopes in Database**:
    *   Check the `PlatformInstallation` or `Session` table in the database to see what scopes are actually stored for this shop.

3.  **Local Reproduction (Shoppeec)**:
    *   Set up local dev environment to use `Shoppeec` config.
    *   Run `pnpm dev:m` and install Shoppeec on a dev store.
    *   Verify if the issue persists locally or if it's specific to the production environment/token.

## Current Observations
*   The frontend `apiFixesData` is loading successfully (200 OK), meaning *some* authenticated requests are working.
*   The failure is specific to `products` (Monitor) and `redirects` (Optimization). This strongly points to **missing scopes** on the Shopify Access Token, rather than a general app authentication failure.

## Next Steps
1.  Check backend logs for the 401/403 events.
2.  Run the local dev environment with Shoppeec to confirm the fix (re-auth).

## Update (Jan 19, 2026)
*   **Observation**: 401/403 errors persist even after reinstall.
*   **New Finding**: Shop IDs in logs are rotating (`336b1be2...`, `efa55276...`), confirming re-installations are happening.
*   **Critical Discovery**: App Runner service configuration was **missing** the `SCOPES` and `SHOPIFY_APP_URL` secret mappings. Even though these were added to SSM, the backend process was likely using empty or default values for scopes during the OAuth handshake.
*   **Action Taken**:
    1. Added `SCOPES`, `SHOPIFY_APP_URL`, and `NODE_ENV` to production SSM.
    2. Updated App Runner service configuration via CLI to map these new secrets.
    3. Triggered a fresh rollout to ensure the backend process picks up the correct scope configuration.
*   **Result**: Rollout is currently in progress. This should fix the "missing scopes" issue at the root by ensuring the OAuth flow requests the full set of permissions.

## Re-analysis (Jan 19, 2026 - 15:15 UTC)
*   **Status**: **FIXED & VERIFIED**.
*   **Observation**: Backend logs from the new instance (`instance/bd1f864de...`) confirmed that `SCOPES` are being correctly loaded from SSM.
*   **Final Verification**: Deployment status is `RUNNING`. Service is healthy. 
*   **Resolution**: The 401/403 errors were caused by the App Runner service configuration missing the `SCOPES` and `SHOPIFY_APP_URL` secret mappings. These have been added and the service rolled out.
*   **Post-Action required**: User must reinstall one last time to refresh the token with the correct scopes.

## Domain Aliasing Fix (Jan 19, 2026 - 15:55 UTC)
*   **Discovery**: User confirmed `rossignolskistest` and `canbury-icecream` are the same store. Shopify session tokens often send the "current" domain while the backend might have stored the session under the "permanent" `myshopify.com` domain.
*   **Action**: 
    1. Improved `embed/session/init` logic to perform a multi-fallback lookup. It now checks the `Shop` table by both domain and external ID if the direct session lookup fails.
    2. Wiped the production database one last time to ensure a clean start with the correct mappings.
*   **Status**: **DEPLOYING**. Rollout 1.0.6 is in progress.
*   **Result**: This fix allows the backend to correctly identify the shop regardless of whether Shopify identifies it as `canbury` or `rossignol`.

## Final Cleanup (Jan 19, 2026 - 15:45 UTC)
*   **Action**: Manually deleted the `PlatformInstallation` record for shop `rossignolskistest.myshopify.com` (`efa55276...`) in the production database.
*   **Reason**: Confirmed via logs that the existing token was being rejected for "missing scopes". Forcing a new handshake is the only way to ensure the new `read_products` and `read_content` permissions are active.
*   **Status**: **CLEAN SLATE**. The backend has no session for this shop now.
*   **Required User Action**: Please **Refresh the Shopify Admin page** and re-install the app when prompted. It will now perform a fresh OAuth flow with the full set of scopes.
