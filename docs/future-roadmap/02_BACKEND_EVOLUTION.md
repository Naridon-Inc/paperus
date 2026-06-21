# 02. Backend Evolution: Layered Refactoring Plan

This document details the specific changes required in the backend codebase to support the Universal Platform.

## 1. Domain Layer (`backend/domain`)

### 1.1 Entities
*   **`Shop` (Rename to `Project`)**:
    *   Add `platformType: "COMMERCE" | "CMS" | "WEB"`.
    *   Add `settings: JSON` to store platform-specific config (e.g. sitemap URL, scraping frequency).
*   **`Product` (Rename to `Resource`)**:
    *   Add `resourceType: "PRODUCT" | "PAGE" | "POST"`.
    *   **Polymorphic Fields**:
        *   Ecommerce: `price`, `sku`, `inventory` (Nullable).
        *   CMS/Web: `contentBody`, `cmsId`, `lastCrawledAt` (Nullable).

### 1.2 Repositories
*   **`IResourceRepository`**: Add `findByUrl(url)` and `listByFilters(type, status)`.
*   **`IProjectRepository`**: Standardize across all platforms.

## 2. Application Layer (`backend/application`)

### 2.1 Use Cases
*   **`AnalyzeResourceUseCase`**: New unified use case. It calls the appropriate `ContentAdapter` based on the resource type.
*   **`SyncResourcesUseCase`**:
    *   **Ecommerce**: Fetches from Shopify GraphQL.
    *   **CMS**: Fetches from Webflow/WP API.
    *   **Web**: Crawls the provided Sitemap or scans the home page.

## 3. Infrastructure Layer (`backend/infrastructure`)

### 3.1 New Adapters
*   **`WebflowAdapter` / `WordPressAdapter` (Ecosystem Mode)**:
    *   Uses native APIs to fetch "Items" and "Collections".
    *   Supports pushing fixes directly back to the CMS.
*   **`ScraperAdapter` (Wild Mode)**:
    *   Uses **Cheerio** or **Puppeteer** to extract content from raw URLs.
    *   Normalizes the website structure into the `Resource` domain entity.
*   **`GitHubAdapter` (Future Wild Mode)**:
    *   To push "Fixes" as PRs for Next.js/React websites.

## 4. Delivery Layer (`backend/delivery`)

### 4.1 Unified API (`delivery/api`)
*   **`initSession`**: Update to accept any platform proof.
*   **New Routes**:
    *   `POST /api/v1/projects`: Manually create a monitoring project.
    *   `POST /api/v1/resources`: Add custom URLs/Pages to a project.
    *   `GET /api/v1/monitor/summary`: Platform-agnostic dashboard data.
