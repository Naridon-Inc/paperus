# Business Logic Migration Tracker

## 🚨 Critical Business Logic Gaps
The new backend structure is solid, but several core *business logic* components from the legacy system (and "Real Trio" vision) have not yet been fully ported or are simplified. This tracker ensures we support every advanced use case without hardcoding.

---

## 1️⃣ Deep Context & Shop Analysis (Onboarding Phase 0)
**Goal:** Before generating prompts, we must "understand" the shop deeply to avoid generic suggestions.

### 🧩 Logic Requirements
*   [ ] **Fetch Platform Context**:
    *   Abstract `ProductService.fetchTopProducts(limit: 5)` (Platform Agnostic).
    *   Get `Shop.domain`, `Shop.currency`, `Shop.language`.
*   [ ] **External Intelligence (SearchAPI)**:
    *   Run a Google Search for `site:<shop_domain>` or `"<brand_name>"`.
    *   Extract meta descriptions, industry cues, and competitor mentions from SERP snippets.
    *   *Why:* Startups often have empty product descriptions; Google knows how they position themselves.
*   [ ] **Generate Shop Profile**:
    *   Use AI to synthesize Platform Data + Search Data into `Shop.industry`, `Shop.description`, `Shop.targetAudience`.
    *   **Save this profile** to `Shop` or `ShopConfig` for all future prompt generations.
    *   ❌ **NO HARDCODING**: Never default `industry` to "E-commerce". Detect it.

### 🛠 Implementation Plan
*   [ ] Create `IShopAnalysisPort` (Infrastructure interface).
*   [ ] Implement `SearchApiAdapter` (Infrastructure) for Google Search.
*   [ ] Create `AnalyzeShopUseCase` (Application):
    1.  Fetch products via `IPlatformContentPort`.
    2.  Search brand via `IShopAnalysisPort`.
    3.  AI Synthesizes "Brand Context".
    4.  Update `Shop` entity.

---

## 2️⃣ Topic & Prompt Generation (The "Brain")
**Goal:** Generate high-intent keywords based on the *actual* catalog and brand context.

### 🧩 Logic Requirements
*   [ ] **Topic Discovery**:
    *   Input: `Shop.industry`, `Product` titles/categories.
    *   Output: High-level buckets (e.g., "Performance Running", "Marathon Training").
*   [ ] **Prompt Generation (Advanced)**:
    *   Input: Topic + Brand Context + Location.
    *   Output: "Best [Topic] for [Audience]", "[Brand] vs [Competitor]".
    *   *Current State:* `GeneratePromptsUseCase` exists but logic is basic. It needs to inject `Shop.industry` (derived above) and `Product` context.

### 🛠 Implementation Plan
*   [ ] Update `GeneratePromptsUseCase` to accept/fetch `products` context.
*   [ ] Create `GenerateTopicsUseCase` (Auto-discovery before prompts).

---

## 3️⃣ The "Real Trio" & Execution Engine
**Goal:** We don't just run "OpenAI". We run a matrix of models and cross-reference them.

### 🧩 Logic Requirements
*   [ ] **Real Trio**:
    *   We must query **Google (Search/Gemini)**, **ChatGPT (Search)**, and **Perplexity**.
    *   *Why:* Different engines index differently.
*   [ ] **AI Judge**:
    *   Raw model outputs are noisy.
    *   We need a "Judge" layer that parses the HTML/Markdown from the Trio.
    *   **Normalization**: Map "Position 1" in Perplexity to "Rank 1" in our DB.
*   [ ] **RAG (SearchAPI Integration)**:
    *   For models without live browsing (e.g. standard GPT-4o), we must:
        1.  Call SearchAPI (Google SERP).
        2.  Feed SERP JSON + User Prompt to LLM.
        3.  LLM analyzes Share of Voice.

### 🛠 Implementation Plan
*   [ ] **Enhance `AIClient`**: Support multiple providers (`PerplexityClient`, `GoogleVertexClient`, `SearchAPIClient`).
*   [ ] **Refactor `AnalyzeCompetitorsService`**:
    *   It currently runs 1 model.
    *   It needs to support **Runner Strategies** (e.g., `HybridRunner`, `NativeRunner`).
*   [ ] **Implement Judges**:
    *   Create domain service `RankExtractionService` to robustly parse "our position" from unstructured text.

---

## 4️⃣ Platform Agnosticism (Verification)
**Goal:** `application/common` must never import `platform/shopify`.

### 🧩 Logic Requirements
*   [ ] **Product Fetching**:
    *   Need `IPlatformProductRepository` (Domain Interface).
    *   Shopify implementation: Uses GraphQL.
    *   Woo implementation: Uses REST.
*   [ ] **Metadata Writing**:
    *   Need `IPlatformMetadataRepository` (Domain Interface).
    *   Used for applying SEO fixes.

### 🛠 Implementation Plan
*   [ ] Define `IPlatformContentPort` in `domain/src/ports`.
*   [ ] Implement `ShopifyContentAdapter` in `infrastructure`.
*   [ ] Inject into `AnalyzeShopUseCase`.

---

## 📝 Next Steps (Priority Order)
1.  **SearchAPI Adapter**: We need live data for "Real Trio" (RAG) and Shop Analysis.
2.  **Analyze Shop UseCase**: To populate `industry` and `brandName` dynamically.
3.  **Refactor Execution**: Update `RunAnalysisUseCase` to handle "Real Trio" logic (multiple parallel runs if plan allows).