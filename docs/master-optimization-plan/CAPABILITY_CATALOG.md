# Naridon Fix Capability Catalog

**Status**: Draft
**Version**: 1.0

This catalog defines the complete set of capabilities for the Naridon Optimization Engine. It serves as the source of truth for what the system *can* do.

---

## 1️⃣ Deterministic Fixes (System Can Apply Automatically)
*Safe, mechanical, non-creative fixes. Applied via API.*

### A. Product Data & Structure
| ID | Fix Name | Description | Target Attribute |
|:---|:---|:---|:---|
| D-01 | Normalize Titles | Remove fluff, reorder for clarity (Brand + Model + Key Specs). | `title` |
| D-02 | Product Type Mapping | Enforce mapping to standard taxonomy (Google Product Category). | `productType` |
| D-03 | Fix Missing Type | Populate missing `productType` based on analysis. | `productType` |
| D-04 | Standardize Variants | Normalize Option names (e.g., "Sz" -> "Size", "Col" -> "Color"). | `variants` |
| D-05 | Deduplicate Variants | Merge duplicate variants that confuse AI parsers. | `variants` |
| D-06 | Fix ID References | Ensure consistent SKU/ID usage across fields. | `sku`, `id` |
| D-07 | GTIN/MPN Formatting | Validate and format barcode data (UPC/EAN/ISBN). | `barcode` |
| D-08 | Normalize Brand | Ensure consistent brand field usage. | `vendor` |
| D-09 | Explicit Availability | Map inventory to schema.org availability states. | `inventoryPolicy` |
| D-10 | Remove Conflicting Availability | Clear contradictory tags vs. inventory state. | `tags`, `metafields` |

### B. Schema & Feeds
| ID | Fix Name | Description | Target Attribute |
|:---|:---|:---|:---|
| D-11 | Fix Product Schema | Add/repair JSON-LD `Product` structured data. | `metafields.schema` |
| D-12 | Fix Offer Schema | Add/repair `Offer` (price/currency) schema. | `metafields.schema` |
| D-13 | Fix AggregateRating | Add/repair review aggregate schema. | `metafields.schema` |
| D-14 | Fix Review Schema | Add individual review structured data. | `metafields.schema` |
| D-15 | Add FAQPage Schema | Generate schema from existing FAQ content. | `metafields.schema` |
| D-16 | Schema Validation | Fix syntax errors preventing Rich Results. | `metafields.schema` |
| D-17 | Price Alignment | Ensure schema price matches storefront price. | `metafields.schema` |
| D-18 | Inventory Alignment | Ensure schema availability matches inventory. | `metafields.schema` |
| D-19 | Image URL Fixes | Ensure schema images are valid/crawlable URLs. | `metafields.schema` |
| D-20 | Image Metadata | Add missing height/width to schema images. | `metafields.schema` |
| D-21 | Feed Sync | Resolve mismatches with Merchant Center feed. | `google_feed` |
| D-22 | Prune Stale Feeds | Remove orphaned products from feeds. | `google_feed` |

### C. Image & Media Metadata
| ID | Fix Name | Description | Target Attribute |
|:---|:---|:---|:---|
| D-23 | Generate Alt Text | Create descriptive, keyword-rich alt text. | `image.altText` |
| D-24 | Semantic Filenames | Rename image files (e.g., `IMG_123.jpg` -> `blue-shirt.jpg`). | `image.url` (re-upload) |
| D-25 | Flag Low-Res | Identify images below AI quality thresholds. | `image` |
| D-26 | Remove Placeholders | Detect and remove "Image Coming Soon" placeholders. | `images` |
| D-27 | Hero Clarity | Ensure primary image clearly depicts the product. | `image` (sort order) |

### D. Crawlability & Index Signals
| ID | Fix Name | Description | Target Attribute |
|:---|:---|:---|:---|
| D-28 | Ensure Indexable | Check/fix robots.txt or meta tag blocks. | `seo.hidden` |
| D-29 | Fix Accidental Noindex | Remove `noindex` from valid product pages. | `metafields.seo` |
| D-30 | Fix Canonical Conflicts | Ensure self-referencing canonicals are correct. | `seo.canonical` |
| D-31 | Normalize URLs | Enforce clean URL structure (remove query params). | `handle` |
| D-32 | Deduplicate Content | Canonicalize duplicate variants/collections. | `seo.canonical` |
| D-33 | Update Sitemap | Ensure all active products are in sitemap.xml. | `sitemap` |
| D-34 | Clean Sitemap | Remove 404s/archived products from sitemap. | `sitemap` |

---

## 2️⃣ AI-Assisted Fixes (Safe Rewrite, Fact-Preserving)
*Uses AI to rewrite existing facts. Never invents data.*

### A. Answer-Readiness & Summarization
| ID | Fix Name | Description | Target Attribute |
|:---|:---|:---|:---|
| AI-35 | First Sentence Clarity | Rewrite opener to be definition-style (Who/What). | `description` |
| AI-36 | 1-Line Summary | Generate concise summary for snippets. | `meta.description` |
| AI-37 | "Best For" Bullets | Extract 3 bullets on ideal use cases. | `description` / `metafields` |
| AI-38 | "Avoid If" Bullets | Extract 3 bullets on limitations (honesty signal). | `description` / `metafields` |
| AI-39 | Pros/Cons Summary | Create balanced summary table. | `description` |
| AI-40 | Tone Normalization | Rewrite marketing fluff into neutral facts. | `description` |

### B. FAQ & Question Coverage
| ID | Fix Name | Description | Target Attribute |
|:---|:---|:---|:---|
| AI-41 | Attribute FAQs | Generate FAQs from static attributes (Material, Size). | `description` |
| AI-42 | Paragraph to Q&A | Convert dense text blocks into Q&A format. | `description` |
| AI-43 | Suitability FAQs | Add "Is this good for X?" questions. | `description` |
| AI-44 | Comparison FAQs | Add "Vs Alternatives" (generic) FAQs. | `description` |
| AI-45 | Constraint FAQs | Add fit/compatibility Q&A. | `description` |

### C. Comparison & Evaluation Language
| ID | Fix Name | Description | Target Attribute |
|:---|:---|:---|:---|
| AI-46 | Comparison Hints | Add structured data for comparison tables. | `metafields` |
| AI-47 | Use-Case Framing | Explicitly state primary use case (e.g., "For Beginners"). | `description` |
| AI-48 | Limitation Clarity | Explicitly state edge cases. | `description` |
| AI-49 | De-risk Claims | Remove unverified superlatives ("Best ever"). | `description` |
| AI-50 | Hallucination Proofing | Rephrase ambiguous sentences. | `description` |

### D. Review Summarization
| ID | Fix Name | Description | Target Attribute |
|:---|:---|:---|:---|
| AI-51 | Theme Summary | Summarize common review themes. | `description` |
| AI-52 | Extract Pros | List top 3 verified pros. | `description` |
| AI-53 | Extract Cons | List top 3 verified complaints. | `description` |
| AI-54 | Review-based FAQs | Answer common questions found in reviews. | `description` |
| AI-55 | Flag Review Gaps | Identify missing review signals. | *Signal Only* |

---

### E. Taxonomy & Attribute Intelligence (New)
*Platform-specific deep data enrichment. Matches Shopify "Magic" & Shopware AI capabilities.*

| ID | Fix Name | Description | Target Attribute |
|:---|:---|:---|:---|
| **AI-90** | **Smart Taxonomy Prediction** | Predicts the precise Google/Shopify Standard Taxonomy Category. | `productCategory` / `googleProductCategory` |
| **AI-91** | **Category Metafield Fill** | Extracts specific attributes required by the category (Color, Material, Age Group, Gender). | `metafields.standard.*` |
| **AI-92** | **Feature Tagging** | Generates tags for automated collections (e.g., "Summer", "Eco-Friendly"). | `tags` |
| **AI-93** | **Visual Attribute Extraction** | Analyzes images to detect attributes text missed (e.g., "Crew Neck", "Long Sleeve"). | `metafields` / `variants` |

## 3️⃣ Guided / Recommended Fixes (Human Action Required)
*System flags issue and provides instructions, but cannot auto-apply.*

### A. Review & Trust Signals
*   **G-56**: Recommend review collection campaigns.
*   **G-57**: Identify products needing review volume.
*   **G-58**: Flag missing verified purchase badges.
*   **G-59**: Suggest improvements to review email prompts.
*   **G-60**: Identify sentiment imbalance.

### B. Policy & Trust Pages
*   **G-61**: Flag missing/unclear Return Policy.
*   **G-62**: Flag missing Warranty info.
*   **G-63**: Flag unclear Shipping Timelines.
*   **G-64**: Flag missing Business Identity signals (Address, Phone).
*   **G-65**: Flag weak Contact/Support visibility.

### C. Authority & Off-Site Presence
*   **G-66**: Detect absence from AI citation sources.
*   **G-67**: Recommend external content topics.
*   **G-68**: Identify PR/Review site gaps.
*   **G-69**: Suggest niche authority topics.
*   **G-70**: Flag over-dependency on marketplaces.

---

## 4️⃣ Monitoring-Only (Metrics)
*Tracked signals that indicate health/performance.*

### A. AI Visibility
*   **M-71**: AI Citation Frequency (Share of Voice).
*   **M-72**: Brand Mention Presence.
*   **M-73**: Product Mention Presence.
*   **M-74**: Query Coverage Growth.
*   **M-75**: Competitive Displacement.

### B. Commercial Impact
*   **M-76**: Brand Search Lift.
*   **M-77**: Assisted Conversion Lag.
*   **M-78**: AI-Referral Traffic.
*   **M-79**: Zero-Click Exposure Estimate.
*   **M-80**: Competitive Share of Voice.

---

## 5️⃣ Planned Fixes (Future Updates)
*Fixes slated for future implementation.*

| Signal | Planned Fix | Status | Action |
|:---|:---|:---|:---|
| `MISSING_IMAGE` | **D-26** (Remove Placeholders) | ❌ Planned | **"Upload Image" (Deep Link)** |
| `GLOBAL_MISSING_BRAND`| **D-08** (Normalize Brand) | ❌ Planned | **"Set Brand" (Deep Link to Settings)** |
| `RISK_DISCLAIMER` | **AI-49** (De-risk Claims) | ❌ Planned | "Add Disclaimer" |
| `SEASONAL_UPDATE` | **AI-47** (Use-Case Framing) | ❌ Planned | "Update Context" |
| `TRUST_SIGNAL_WEAK` | **G-64** (Business Identity) | ❌ Planned | **"Update Settings" (Deep Link)** |
| `BRAND_IDENTITY_GENERIC`| **AI-40** (Tone Normalization) | ❌ Planned | "Refine Voice" |

## 6️⃣ Strategic Intelligence (Deep Data Insights)
*High-level insights derived from aggregate analysis of store-wide data and prompt runs.*

### A. Strategic Content Analysis
| ID | Fix Name | Description | Target Scope |
|:---|:---|:---|:---|
| **S-81** | **Semantic Content Gap** | Identify topics missing across entire categories (e.g., "Running Shoes" category lacks "Arch Support" info). | Category / Collection |
| **S-82** | **Brand Voice Audit** | Detect descriptions that deviate from the configured Brand Persona (e.g., Clinical vs. Playful). | Store-wide |
| **S-83** | **Keyword Cannibalization** | Flag multiple products competing for the exact same high-value keyword. | Store-wide |
| **S-84** | **Seasonal Relevance Decay** | Identify products with out-of-season keywords (e.g., "Summer" in October). | Store-wide |

### B. Visual & Commercial Strategy
| ID | Fix Name | Description | Target Scope |
|:---|:---|:---|:---|
| **S-85** | **Visual Content Strategy** | Audit aggregate Alt Text to find missing visual angles (e.g., "No lifestyle shots in Apparel"). | Category |
| **S-86** | **Value Proposition Gap** | Flag products with high price points but generic/low-value descriptions. | Product |
| **S-87** | **Objection Mining** | Aggregate negative sentiments from Reviews/FAQs to find root cause product flaws. | Product / Variant |
| **S-88** | **Competitive Parity Gap** | Identify where competitors consistently outperform on specific attributes (e.g., Warranty, Shipping). | Store-wide |

## 7️⃣ Direct Action Implementation Map
*Ensuring every fix has a clear path to resolution.*

### Automatic Fixes (One-Click Apply)
These are handled via the `Apply Fix` button in the UI, which calls the platform-specific adapters.

### Guided Fixes (Deep Links)
For items requiring manual store updates, the `Action` button will deep link into the platform admin:

| Fix Category | Shopify Deep Link Template | Shopware Deep Link Template |
|:---|:---|:---|
| **Product Data** | `/admin/products/{productId}` | `/admin#/sw/product/detail/{productId}` |
| **Store Policies** | `/admin/settings/legal` | `/admin#/sw/settings/shipping/index` |
| **Theme / SEO** | `/admin/online_store/themes/{themeId}/editor` | `/admin#/sw/cms/index` |
| **Review Apps** | `/admin/apps/{appSlug}` | `/admin#/sw/extension/my-extensions` |

### Fix Verification
After a manual action is taken, Naridon provides a "Verify Fix" button which re-scans the specific resource to confirm the issue is resolved.
