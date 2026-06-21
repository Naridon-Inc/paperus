# Platform Implementation Comparison

**Date:** January 14, 2026
**Status:** Audit Complete

---

## 1. Overview

The backend supports 4 platforms via `delivery/platform/*`. Each implements authentication and webhook handling differently due to platform constraints, but they all converge on the common Domain/Application layer.

## 2. Feature Parity Matrix

| Feature | Shopify | BigCommerce | Shopware | WooCommerce |
| :--- | :--- | :--- | :--- | :--- |
| **Auth Flow** | OAuth (Official Lib) | OAuth (Custom) | App System Handshake | API Keys (Custom) |
| **Session Storage** | `PlatformSession` (via Adapter) | `PlatformSession` | `PlatformSession` | `PlatformSession` |
| **Shop Creation** | ✅ `CreateOrUpdateShop` | ✅ `CreateOrUpdateShop` | ✅ `CreateOrUpdateShop` | ✅ Manual Creation |
| **Org Creation** | ⚠️ **Missing?** (Implicit) | ✅ Explicit `EnsureOrg` | ✅ Explicit `EnsureOrg` | ⚠️ **Missing?** |
| **Uninstall** | ✅ Webhook | ✅ Callback | ❓ Not Visible | ❓ Not Visible |
| **Dependencies** | Repos, Scheduler | Repos, Scheduler | Repos, TokenService | Repos |

## 3. Integration Details

### 3.1 Shopify (`@naridon/platform-shopify`)
*   **Mechanism:** Uses `@shopify/shopify-api` node adapter.
*   **Session:** Stores via `PlatformSessionStorage` -> `PlatformSessionRepositoryImpl` (which supports the migration to `PlatformInstallation`).
*   **Gap:** The auth flow calls `storeSession` which creates the shop, but does **not** explicitly call `EnsureOrgForShopUseCase`. This means Shopify shops might be created without an Organization initially (orphaned).

### 3.2 BigCommerce (`@naridon/platform-bigcommerce`)
*   **Mechanism:** Custom OAuth implementation (`routes/auth.ts`).
*   **Integration:** Explicitly calls `EnsureOrgForShopUseCase` during the OAuth callback.
*   **Robustness:** High. Handles Load/Uninstall callbacks standard to BigC.

### 3.3 Shopware (`@naridon/platform-shopware`)
*   **Mechanism:** Shopware App System (Registration/Confirmation handshake).
*   **Integration:** Explicitly calls `EnsureOrgForShopUseCase` during confirmation.
*   **Robustness:** High. Includes signature verification middleware.

### 3.4 WooCommerce (`@naridon/platform-woocommerce`)
*   **Mechanism:** Legacy API Key exchange or manual entry?
*   **Integration:** Seems to manually create entities in `routes/auth.ts` rather than using the standard `CreateOrUpdateShopUseCase`.
*   **Gap:** Least standardized. Missing explicit Org creation and standardized Uninstall handling in the scanned files.

---

## 4. Recommendations

1.  **Standardize Org Creation:** Update `Shopify` and `WooCommerce` auth flows to explicitly call `EnsureOrgForShopUseCase` after creating the shop, ensuring every shop belongs to an organization.
2.  **Unify WooCommerce:** Refactor `WooCommerce` to use `CreateOrUpdateShopUseCase` like the others.
3.  **Audit Uninstalls:** Ensure `Shopware` and `WooCommerce` have webhook handlers for app deletion to clean up data (using `UninstallShopUseCase`).
