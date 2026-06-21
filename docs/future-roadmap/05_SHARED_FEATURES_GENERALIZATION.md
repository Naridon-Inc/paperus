# 05. Shared Features Generalization: Component & Hook Refactor

This document describes how to update the shared UI library to be platform-agnostic.

## 1. Components Refactor

### 1.1 `MonitorDashboard.tsx`
*   **Agnostic Headers**: Allow the shell to inject the Page Title and Actions.
*   **Dynamic Sections (Conditional Rendering)**:
    *   `if (isCommerce)`: Show "Inventory", "Sales", "Price History".
    *   `if (isWeb)`: Show "SEO Status", "Crawl Health", "Word Count".
*   **CMS Management Links**:
    *   If the resource is managed via Webflow/WP, show an "Edit in CMS" button that deep-links to their editor.
    *   If Shopify, show "Edit Product in Admin".

### 1.2 `DataFilters.tsx`
*   **Search**: Update input to handle "Product Search" (by SKU/Title) AND "URL Search" (by Path).
*   **Filter Categories**:
    *   Shopify: "Vendor", "Product Type".
    *   Webflow: "Collection", "Draft/Published".
    *   WordPress: "Category", "Tag", "Author".

## 2. Hooks Refactor (`src/hooks/*`)

### 2.1 `useMonitorDashboard.ts`
*   Add a `projectType` parameter.
*   The hook will decide whether to call the Shopify-optimized API or the Generic Web API.

### 2.2 `useApi.ts`
*   This hook must detect the environment.
*   **In Shopify**: Intercepts requests to add Shopify Session Tokens.
*   **In Web**: Adds standard `Authorization: Bearer <JWT>` headers.

## 3. UI Kit Independence
Long-term, we will move away from strictly using Polaris components to a custom `@naridon/ui-kit` (already in `frontend/packages`). This ensures the `web.naridon.com` app doesn't look like a Shopify clone.

*   Start by abstracting standard components: `Button`, `Card`, `Stack`, `Badge`.
*   Maintain a "Shopify Theme" and a "Naridon Theme" for the UI Kit.
