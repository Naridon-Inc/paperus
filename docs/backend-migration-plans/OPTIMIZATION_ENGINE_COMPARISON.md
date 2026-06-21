# Optimization Engine Comparison: Reference vs. Current Backend

This document compares the AI Optimization (AIO) engine in the reference repository (`temp_shopeec_analysis`) with the current implementation in the `backend/` directory.

## 1. High-Level Summary

| Feature | Reference Repo (`temp_shopeec_analysis`) | Current Backend (`backend/`) | Status |
| :--- | :--- | :--- | :--- |
| **Architecture** | Monolithic Remix App (Service Layer) | Clean Architecture (Hexagonal) | ✅ Architecture is better in Current, but Logic is missing. |
| **AI Integration** | **Advanced**: Azure OpenAI + Fallback (OpenAI/Gemini). | **None/Minimal**: No LLM adapter found in `infrastructure`. | 🔴 Critical Gap |
| **Analysis Depth** | **High**: Heuristic checks + Deep Semantic LLM analysis. | **Low**: Simple string length checks (Simulation). | 🔴 Critical Gap |
| **Workflow** | Signals -> Fixes (Decoupled) | Direct Fix Creation (Coupled) | ⚠️ Needs refactoring to use Signals. |
| **Background Jobs** | Redis Queues for heavy lifting. | Not fully implemented in Use Case. | ⚠️ Needs implementation. |

---

## 2. Detailed Feature Comparison

### A. Analysis Capabilities

#### Reference Repo (`ProductAnalysisService`)
The reference implementation is production-ready with a mix of fast heuristics and slow, deep AI analysis.

1.  **Thin Content**: Checks word count (< 50 words).
2.  **Unstructured Content**: Regex check for headers like "Materials", "Dimensions".
3.  **Missing GTIN**: Checks variant barcode.
4.  **Missing Images**: Checks media edges.
5.  **Missing Vendor**: Checks for "myshopify" or empty vendor.
6.  **No FAQ**: Heuristic check for "?" or "FAQ" in description.
7.  **Ambiguous Title**: Short word count check.
8.  **Deep Semantic Analysis (LLM)**:
    *   **Prompt**: "You are a Semantic Product Analyst..."
    *   **Detection**: Missing core attributes (Color, Material, etc.), Semantic Gaps, Persona alignment.
    *   **Output**: Structured JSON.

#### Current Backend (`ScanStoreUseCase`)
The current implementation is a placeholder/skeleton.

1.  **Weak Description**: Simple length check (< 50 chars).
2.  **Weak Title**: Simple length check (< 20 chars).
3.  **Note**: It fetches top 50 products and runs these checks synchronously. It bypasses the `SmartSignal` architecture and creates `Fix` records directly.

### B. The Fix Engine

#### Reference Repo (`FixService`)
*   **Signal-Driven**: Scans `SmartSignal` table.
*   **Granular Fix Types**:
    *   `MISSING_GTIN` -> Priority HIGH
    *   `MISSING_IMAGE` -> Priority HIGH
    *   `NO_FAQ` -> Priority MEDIUM
    *   `PRODUCT_MISSING_ATTRIBUTES` -> Priority MEDIUM (Payload contains missing fields)
    *   `SEASONAL_MISMATCH` -> Priority LOW
*   **Separation of Concerns**: Analysis Service creates *Problems* (Signals). Fix Service creates *Solutions* (Fixes).

#### Current Backend
*   **Direct Creation**: `ScanStoreUseCase` instantiates `Fix` entities directly.
*   **Limited Types**: Only `WEAK_DESCRIPTION` and `WEAK_TITLE` observed.
*   **SmartSignal Entity**: Exists in `domain/monitoring/smart-signal` but is currently underutilized in the optimization flow.

### C. AI & LLM Infrastructure

#### Reference Repo (`app/services/ai/llm.ts`)
*   **Robust Client**: Handles Azure OpenAI with fallback to standard OpenAI and Google Gemini.
*   **Cost Optimization**: Supports `gpt-4o-mini` for cheaper tasks and `gpt-4o`/`gpt-5.2` for smart tasks.
*   **Resilience**: Retry logic and exponential backoff.

#### Current Backend
*   **Missing Adapter**: No `LLMAdapter` or `OpenAIAdapter` found in `infrastructure/src/external`.
*   **Existing Adapters**: Only `SearchAPIAdapter` is present.

### D. Rule-Based Architecture (Discovery)

#### Reference Repo (`app/services/optimize/optimize.server.ts`)
*   **Interface**: Defines `OptimizationRule` (check, generate, apply).
*   **Implementations**:
    *   `MissingDescriptionRule`: Generates SEO copy via LLM.
    *   `WeakProductTitleRule`: Rewrites titles.
    *   **Advanced Rules** (in `rules/`): `BrokenLinks`, `CompetitorGap`, `ImageFile`, `SentimentDrift`, `TrendOpportunity`.
*   **Extensibility**: New rules can be added by implementing the interface.

#### Current Backend
*   **Ad-Hoc**: Checks are hardcoded in the Use Case (`if (desc < 50) ...`).
*   **No Interface**: No standard `OptimizationRule` contract exists.

### E. API Integration Surface

#### Reference Repo (Remix Routes)
*   **Planning Strategy**: "API-fication" plan to split monolithic loaders into granular endpoints (`stats`, `trends`, `fixes`) for performance/streaming.
*   **Endpoints**:
    *   `api.optimization.fixes.tsx`: Returns list of `Fix` items (likely filtered by `SmartSignal`).
    *   `api.optimization.stats.tsx`: Returns counts of issues/fixes.
    *   `app.optimization.fixes.tsx`: The UI View that consumes the API.

#### Current Backend (Fastify Routes)
*   **Routes**: `backend/delivery/api/src/routes/optimization.ts` (implied/verified previously).
*   **Structure**: Exposes `GET /optimization/fixes` (likely).
*   **Gap**: The Reference repo has specialized endpoints for *Trends*, *Redirects*, and *Dashboard* which seem missing in current backend.

---

## 3. Migration & Gap Closure Plan

To bring the Current Backend up to parity with the Reference Repo, the following steps are required:

### Phase 1: Infrastructure Foundations
1.  **Implement LLM Adapter**: Port `llm.ts` to `backend/infrastructure/src/external/llm-adapter.ts`.
    *   Define `Port` in `backend/domain/src/common/ports/llm.port.ts`.
    *   Implement Azure/OpenAI/Gemini logic.
2.  **Implement Queue/Job System**: Ensure `backend/infrastructure/src/jobs` can handle background analysis tasks (Analysis is slow).

### Phase 2: Domain Logic Porting
1.  **Port Product Analysis Logic**:
    *   Create `AnalyzeProductUseCase` in `backend/application/common/src/optimization`.
    *   Move heuristic checks (GTIN, Image, etc.) from Reference's `ProductAnalysisService`.
    *   Move Semantic Analysis (LLM Prompt) to this Use Case.
2.  **Activate SmartSignals**:
    *   Update `AnalyzeProductUseCase` to save `SmartSignal` entities instead of `Fix` entities directly.
3.  **Port Fix Generation Logic**:
    *   Create `GenerateFixesFromSignalsUseCase`.
    *   Port the switch/case logic from Reference's `FixService` to map Signals to Fixes.

### Phase 3: Advanced Features
1.  **Competitor Analysis**: Port `CompetitorAnalysisService` (requires SearchAPI which is partially there).
2.  **Brand Analysis**: Port `BrandAnalysisService` (requires LLM).

## 4. Conclusion

The current backend is a solid *architectural shell* but lacks the *feature density* of the reference repo. The "Brain" (AI) is missing, and the "Eyes" (Analysis) are currently nearsighted (simple length checks).

**Immediate Priority**: Implement the `LLMAdapter` and port the heuristic checks from `ProductAnalysisService` to populate `SmartSignals`.
