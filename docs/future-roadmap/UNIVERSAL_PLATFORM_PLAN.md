# Naridon Universal Platform Expansion Plan

**Objective:** Transform Naridon from a Shopify-centric app into a universal "Market Intelligence & Optimization" platform for **any** website or digital asset (SaaS, Content Sites, Custom E-com).

---

## 1. Architectural Core Shift

The fundamental shift is abstracting the "Subject" of analysis. Currently, the system is hard-wired to `Product`.

### 1.1. Domain Model Evolution
*   **Current:** `Shop` -> `Product` (linked to Shopify ID)
*   **Future:** `Organization` -> `Project` (was `Shop`) -> `Resource` (was `Product`)

**New `Resource` Entity Concept:**
```typescript
interface Resource {
  id: string;
  type: "PRODUCT" | "PAGE" | "ARTICLE" | "LANDING_PAGE";
  url: string;           // The definitive identity for Web/SaaS
  externalId?: string;   // Optional (e.g. Shopify Product ID)
  
  // Content Snapshot (Normalized)
  title: string;
  content: string;       // HTML or Text body
  metaDescription?: string;
  
  // Metrics (Shared)
  visibilityScore: number;
  sentimentScore: number;
}
```

### 1.2. The "Adapter" Pattern Expansion
We already use adapters for `Shopify` vs `Shopware`. We introduce a **`GenericWebAdapter`**.

*   **Input:** URL (e.g., `https://naridon.com/pricing`)
*   **Action:** Scrape/Crawl the page.
*   **Output:** Normalized `Resource` object.
*   **Optimization:** Instead of API write, it generates a "Change Request" (Markdown/HTML diff).

---

## 2. Market Expansion Strategy

By decoupling from Shopify, we unlock:

| Market | Subject of Analysis | Fix Mechanism |
| :--- | :--- | :--- |
| **SaaS Companies** | Landing Pages, Pricing, Features | Copy/Paste content, or GitHub PR |
| **Content Publishers** | Blog Posts, News Articles | CMS Plugins (WordPress/Ghost) |
| **Agencies** | Client Websites (Any Platform) | PDF Reports & Action Plans |
| **Custom E-com** | Next.js / Hydrogen Storefronts | Headless CMS API |

---

## 3. Implementation Roadmap (Zero-Breaking Change)

We will execute this in phases to ensure the current Shopify App remains stable.

### Phase 1: The "Universal" Backend Entry (DONE ✅)
*   We already modified `/embed/session/init` to accept `platform: "web"`.
*   We can now issue JWTs for non-Shopify users.

### Phase 2: The "Manual Resource" Feature
*   **Action:** Add a "Add URL to Track" button in the Dashboard.
*   **Backend:** Create a `ManualContentAdapter`.
    *   *Simple version:* User enters Title + Desc manually.
    *   *Pro version:* Fetch URL -> Puppeteer/Cheerio -> Extract Title/Desc.
*   **Storage:** Store this in the `Product` table but with `platform="WEB"` and `externalId=uuid()`.
*   **Result:** The AI Agents will treat it exactly like a Shopify product and run analysis.

### Phase 3: Frontend Generalization (`shared-features`)
*   **Rename Props:** Rename `products` prop to `resources` in generic components (keeping alias for backward compat).
*   **Conditional UI:** 
    *   If `resource.type === 'PRODUCT'`, show "Price", "SKU".
    *   If `resource.type === 'PAGE'`, show "URL", "Last Crawled".
*   **Fix Actions:**
    *   Shopify: "Apply Fix" button (API).
    *   Web: "Copy Fix" button (Clipboard) or "Email Fix".

### Phase 4: Standalone SaaS App (`web.naridon.com`)
*   **Auth:** Build a real Login/Signup page (Supabase Auth or Custom JWT).
*   **Onboarding:** "Enter your website URL" instead of "Install App".
*   **Billing:** Stripe integration (since we can't use Shopify Billing for web users).

---

## 4. Frontend Architecture Plan

We keep `frontend/packages/shared-features` as the source of truth.

### Workspace Structure
```
frontend/
  apps/
    shopify-new/       (The Embedded App - uses App Bridge)
    web-app/           (The Standalone SaaS - uses Standard Router)
    chrome-extension/  (Browser plugin for on-page analysis)
  packages/
    shared-features/   (90% of Logic: Dashboard, Charts, AI Analysis)
    ui-kit/            (Agnostic UI components, slowly replacing Polaris?)
```

### The "Shell" Strategy
*   **Shopify Shell**: Provides `AppBridgeProvider`, `PolarisProvider`, uses Shopify Auth.
*   **Web Shell**: Provides `AuthProvider` (Email/Pass), `StripeProvider`, custom `Sidebar/Layout`.
*   **Inner Content**: Both render `<MonitorDashboard />` from shared-features.

---

## 5. Technical Tasks Breakdown

### Backend
- [ ] Create `WebScraperService` (Puppeteer/Playwright) to turn URLs into `Resource` entities.
- [ ] Update `Product` entity in Prisma to allow nullable `price` (for non-products).
- [ ] Create `StripeAdapter` for billing outside Shopify.

### Frontend
- [ ] Refactor `DataFilters` to be generic ("Topics/Pages" vs "Products").
- [ ] Create `AddResourceModal` in shared-features (Input URL -> Call Scraper).
- [ ] Build `Login` and `Register` pages in `apps/web-app`.

### Infrastructure
- [ ] Set up `web.naridon.com` on Vercel.
- [ ] Set up `api.naridon.com` (optional, or reuse `app.naridon.com`).

---

## 6. Immediate Next Step
**Build the "Add Custom URL" feature.**
This allows you to test the "Web" use-case *inside* the current Shopify app (e.g., "Monitor my blog post") before even building the standalone SaaS. It validates the data model without infrastructure changes.
