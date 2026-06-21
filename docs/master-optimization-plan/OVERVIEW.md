# Unified Optimization Engine: Comprehensive Overview

## 1. Executive Summary
The Unified Optimization Engine is the strategic heart of the platform. It transitions the application from a simple "Audit Tool" into an active "Remediation Engine." By treating all web assets—whether Shopify Products, Webflow Blog Posts, or Custom HTML—as unified **Resources**, we can apply a consistent standard of **AEO (Answer Engine Optimization)** intelligence across a client's entire digital footprint.

This engine doesn't just find problems; it understands the constraints of the underlying platform (Ecommerce vs. CMS vs. Custom) and provides the most direct path to fixing them, ranging from one-click automation to guided implementation.

## 2. Core Philosophy: The "Resource" Abstraction
In the legacy system, `Products` and `Pages` were distinct silos.
- **Products**: Had rich metadata (price, SKU) and API write access.
- **Pages**: Were dumb text blobs with no actionable path.

**The New Paradigm:**
Every URL is a `Resource`.
A `Resource` has:
1.  **Content Payload**: The text, images, and structure.
2.  **Platform Context**: Capabilities of the source (e.g., `canUpdateViaApi: true`).
3.  **Optimization State**: A collection of `SmartSignals` (issues) and `Fixes` (solutions).

## 3. The Three Tiers of Remediation
The engine adapts its output based on the technical capabilities of the connected platform:

### Tier 1: Connected Ecommerce (Shopify, BigCommerce, WooCommerce)
*   **Access Level**: Read/Write API.
*   **Discovery**: Real-time webhook synchronization and bulk API pulls.
*   **Analysis**: Deep inspection of structured data (Metafields, Alt Tags, JSON-LD).
*   **Remediation**: **One-Click Automation**. The user clicks "Apply," and the engine writes the optimized content directly to the store's database.

### Tier 2: Managed CMS (Webflow, Contentful, WordPress)
*   **Access Level**: Read (via API/Sitemap) / Partial Write.
*   **Discovery**: API sync or Intelligent Sitemap Crawling.
*   **Analysis**: Content structure, semantic density, and CMS-specific fields.
*   **Remediation**: **Semi-Automated**.
    *   *Direct Mode*: If API tokens are present, push updates like Tier 1.
    *   *Editor Mode*: If API is restricted, provide a "Copy to Clipboard" block formatted specifically for that CMS's rich text editor.

### Tier 3: Custom & Headless (React, Next.js, Legacy)
*   **Access Level**: Read-Only (Public Web).
*   **Discovery**: `WebScraperAdapter` (Cheerio/Puppeteer) via `sitemap.xml`.
*   **Analysis**: Pure HTML/Text analysis using NLP and Computer Vision (for layout).
*   **Remediation**: **Advisory**.
    *   The engine generates a "Developer Brief" or "Content Pack."
    *   Output includes raw Markdown, optimized JSON-LD snippets, and meta tags ready for a developer to commit to the codebase.

## 4. Business Value & User Journey
1.  **Onboarding**: User connects a Store or enters a URL.
2.  **Diagnostic (The Scan)**:
    *   The engine crawls the target.
    *   It identifies high-value pages (based on traffic/revenue potential) vs. low-value noise.
3.  **Analysis (The Brain)**:
    *   Agnostic Rules run: "Is this readable by AI?", "Does it answer user intent?"
    *   Platform Rules run: "Is the Google Product Category correct?"
4.  **Action (The Dashboard)**:
    *   Users see a prioritized list of **Fixes**, not just warnings.
    *   They filter by "Effort" (Low/High) and "Impact" (Visibility/Conversion).
    *   They execute fixes, watching their **Optimization Score** rise in real-time.

## 5. Integration with Brand Intelligence
This engine doesn't operate in a vacuum. It pulls data from the **Monitoring** module:
- **Competitor Insights**: "Your competitor mentions 'Vegan Leather' 50 times; you mention it 2 times. Fix generated."
- **Review Sentiment**: "Users complain about 'Sizing'. Fix generated: Add Sizing Chart to description."
- **Search Trends**: "Traffic for 'Summer' is spiking. Fix generated: Update homepage metadata."
