# Unified Optimization Engine: Detailed Implementation Roadmap

## ✅ Phase 1: Foundation (Completed)
**Goal:** Establish the UI/UX and data ingestion capabilities for custom sites.
*   [x] **Audit UI Overhaul**: Implemented high-end Tailwind layout for Site Audit listing and detail views.
*   [x] **AI Formatting**: Built `CleanMarkdownUseCase` to transform raw HTML into structured, professional documents.
*   [x] **Scraper Hardening**: Improved `WebScraperAdapter` to strip noise while preserving structural hierarchy.
*   [x] **Efficiency**: Implemented `lastScrapedAt` persistence to prevent redundant AI costs.

## 🛠 Phase 2: Core Engine Refactoring (Target: 1 Week)
**Goal:** Decouple rules from "Products" so they can run on any web asset.

### 2.1 Domain Layer Refactor
*   [ ] **Create `RuleTarget` Interface**: Define the normalized shape for Products/Pages/Blogs.
*   [ ] **Refactor `OptimizationRule`**: Update interface to accept `RuleTarget` instead of `Product`.
*   [ ] **Migrate Existing Rules**: Update `WeakTitleRule` and `MissingDescriptionRule` to use the new interface.
*   [ ] **Update `AnalyzeProductUseCase`**: Rename to `AnalyzeResourceUseCase` and support polymorphic inputs.

### 2.2 Agnostic Rule Implementation
*   [ ] **`MachineReadabilityRule`**: Implement Flesch-Kincaid logic using `flesch-kincaid` library.
*   [ ] **`InformationDensityRule`**: Create logic to measure "Unique Facts per 100 Words".
*   [ ] **`AEOReadinessRule`**: AI-based check for "Answer Engine" formatting (headers, lists, tables).

**Definition of Done:** Unit tests pass for all refactored rules running against both a Shopify Product mock and a Raw HTML mock.

## 🔗 Phase 3: Integration & Intelligence (Target: 1.5 Weeks)
**Goal:** Connect the Audit UI to the new Engine and visualize the scores.

### 3.1 Backend Integration
*   [ ] **Connect Scraper to Engine**: When `WebScraperAdapter` finishes, automatically trigger `AnalyzeResourceUseCase`.
*   [ ] **Persist Agnostic Fixes**: Save "Advisory Fixes" to the database even if we can't auto-apply them.

### 3.2 Frontend Visualization
*   [ ] **Live Score Sidebar**: Wire the `AuditScoreSidebar` (currently mock data) to real `RuleResult` data.
*   [ ] **Breakdown Logic**: Map specific failed rules to the sidebar categories (Readability, Freshness, Structure).
*   [ ] **"Generate Fix" Action**: Add button in Audit Detail to trigger AI remediation for specific failed rules.

**Definition of Done:** Clicking "Analyze" on a custom URL updates the DB with real scores, and the UI reflects those scores accurately.

## 🚀 Phase 4: Remediation & Expansion (Target: 2 Weeks)
**Goal:** Close the loop by allowing users to fix issues on non-ecommerce platforms.

### 4.1 "Advisory" Remediation Flow
*   [ ] **Fix UI Update**: Create a "Manual Application" modal for custom sites.
*   [ ] **Diff Viewer**: Show "Original" vs "Optimized" Markdown side-by-side.
*   [ ] **Copy-Paste Tools**: "Copy HTML", "Copy Markdown", "Copy Meta Tags" buttons.

### 4.2 Platform Expansion
*   [ ] **Webflow Adapter**: Implement `IPlatformContentPort` for Webflow API.
*   [ ] **WordPress/WooCommerce**: Verify rules against WP-JSON endpoints.

**Definition of Done:** A user can audit a custom blog post, see a "Low Readability" warning, generate a fix, and copy the optimized text to their clipboard.
