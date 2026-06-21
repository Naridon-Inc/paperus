# 01. Architecture Blueprint: The Agnostic Resource Model

**Objective:** Transition Naridon from an "Ecommerce App" into a "Universal Intelligence Engine".

## 1. Core Abstraction
The primary shift is moving away from `Shop` and `Product` as hard-coded concepts.

### 1.1 From "Shop" to "Project"
Currently, every piece of data is tied to a `Shop`. We will introduce a `Project` (or `MonitoredBrand`) entity that represents the root monitored asset.
*   **For Shopify**: A Project maps 1:1 to a Store URL.
*   **For Standalone Web**: A Project maps to a primary Domain (e.g., `acme.com`).
*   **For Agencies**: One Organization can have multiple Projects (Clients).

### 1.2 From "Product" to "Resource" (Polymorphic Model)
A `Product` is just a specialized type of `Resource`. We will support three distinct modes:

1.  **Ecommerce Mode (The "Shop" Model)**
    *   **User:** Shopify/Woo/BigCommerce store owner.
    *   **Input:** Automated sync (Products, Prices, Inventory).
    *   **Action:** One-click fixes via API.
    *   **Data:** Title, Description, Price, SKU, Images.

2.  **Ecosystem Web Mode (The "CMS" Model)**
    *   **User:** Marketing manager using Webflow, WordPress, Ghost.
    *   **Input:** Automated sync (Pages, Posts, Collections) via Plugin/API.
    *   **Action:** One-click fixes (or deep link to CMS editor).
    *   **Data:** Title, Content Body, Slug, CMS ID.

3.  **Wild Web Mode (The "Scraper" Model)**
    *   **User:** SaaS founder (Next.js), Agency, Legacy site owner.
    *   **Input:** Manual URL entry or Sitemap URL.
    *   **Action:** Manual fixes (Copy/Paste HTML, Markdown, or GitHub PR).
    *   **Data:** Page URL, Meta Title, Scraped Content, H1-H3 Tags.

This approach ensures we **never ruin the simple ecommerce experience** for Shopify users, while enabling complex scraping workflows for advanced users.

## 2. Platform Layer Refactoring
We will leverage the existing Adapter pattern in `backend/libs/platform/*`.

### 2.1 The "Web" Platform Spectrum
The "WEB" platform is no longer a single type but a spectrum of integration levels:

*   **Integrated CMS (WordPress, Webflow)**: 
    *   **Mechanism**: Uses native APIs or plugins/extensions (similar to our Shopify App).
    *   **Benefit**: Direct access to content without scraping; allows "One-Click Fixes" via CMS API.
    *   **Port**: Calls WordPress REST API or Webflow Data API.
*   **Scraped Web (Next.js, Custom sites)**:
    *   **Mechanism**: Fetches data via web scraping (Playwright/Cheerio).
    *   **Benefit**: Works for any site on the internet without installation.
    *   **Fixes**: Suggestions are provided as manual copy-paste or GitHub PRs.

### 2.2 Auth Port Evolution
*   **Integrated**: Uses platform-specific OAuth or API Keys (Webflow Token, WP Application Password).
*   **Standard**: Uses standard JWT login for standalone account management.

## 3. The "Hybrid" UI Strategy
The frontend will separate the **Shell** from the **Feature**.
*   **The Feature**: (`shared-features`) Contains 100% agnostic logic (Dashboard, Charts).
*   **The Shell**: (`apps/*`) Injects platform-specific context (Shopify App Bridge vs. Browser History API).

## 4. Multi-Tenant Organization Model
Elevate `Organization` in `backend/domain` to be the primary billing and access control boundary, allowing users to add different platform sources to a single organization.
