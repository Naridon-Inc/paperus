# Migration & Architecture Plan: CMS Ecosystems vs. Standalone

## 1. Current State Assessment
Naridon started as a Shopify-first application. To become a universal platform, we need to balance the "Integrated App" feel of CMS ecosystems (Shopify, WooCommerce, BigCommerce) with the "Enterprise SaaS" feel of a standalone platform.

### Architecture Comparison
| Feature | CMS Ecosystem (Shopify/Woo) | Standalone (Custom) |
| :--- | :--- | :--- |
| **Navigation** | Top-level tabs, flat hierarchy. | Deep sidebar, granular categories. |
| **Auth** | App Bridge / Session Tokens. | Bearer Tokens / JWT. |
| **Data Fetching** | via Admin APIs (Shopify GraphQL). | via Sitemaps, Crawlers, and GSC. |
| **Branding** | Must look like the host (Polaris/Woo). | Naridon-first branding. |

---

## 2. Refined Standalone Navigation Strategy
Instead of using the monolithic `Monitor` component, we are splitting it into native routes.

### AI Visibility (Granular Menu)
- **Market Overview**: High-level visibility & sentiment gauge.
- **Tracked Prompts**: Full management of natural language queries.
- **Competitor Intel**: Comparison charts and strength benchmarks.
- **Sentiment Analysis**: Granular feedback from AI models.
- **Source Citations**: Deep-dive into verified links & mentions.

### SEO & Content
- **Site Audit**: Technical health check based on discovered sitemap links.
- **Content Creation**: AI-driven drafting and optimization.

---

## 3. Component Migration Strategy

### Step 1: De-coupling Shared Features
- Move all business logic from "Page" components into "Feature" components.
- Shared Features (`packages/shared-features`) should export "Dumb" components and "Smart" hooks.
- **Rule**: Page-level containers (like `Monitor.tsx`) are now app-specific.

### Step 2: Adaptive UI based on `PlatformProvider`
- Use the `capabilities` flag to hide/show CMS-specific features.
- Example: Disable "Auto-fix descriptions" for Standalone if we don't have write-access yet.

---

## 4. Discovery Engine for Standalone
For CMS, we get products via API. For Standalone, we use:
1. **Sitemap Discovery**: Fetch and parse `sitemap.xml` on onboarding.
2. **Technical Metadata**: Read `llms.txt` and `robots.txt`.
3. **Crawl Queue**: Continuously index found pages into the `Resource` repository.

---

## 5. Next Actions
1. [x] Refactor Standalone to use granular routing for AI Visibility.
2. [x] Resize and fix branding in Standalone TopBar.
3. [ ] Implement `DiscoverPagesUseCase` as a standard background task.
4. [ ] Create a "Site Audit" base component in Shared Features.
