# Optimization Engine Migration Plan

This plan outlines the steps to migrate the AI Optimization Engine from the reference Remix app (`temp_shopeec_analysis`) to the current Clean Architecture backend (`backend/`) and integrate it with the `shared-features` frontend.

## 🎯 Goal
Enable the "Optimization" feature in the new platform, powered by:
1.  **SmartSignals:** A database of detected issues (Signals).
2.  **Fix Engine:** An automated system to generate solutions (Fixes).
3.  **AI Analysis:** Deep semantic analysis using LLMs.

---

## 📅 Phases & Steps

### Phase 1: Infrastructure Foundations
**Focus:** Enabling the backend to "think" (AI) and "work in background" (Queues).

- [ ] **1.1 Implement LLM Adapter**
    -   **Source:** `temp_shopeec_analysis/app/services/ai/llm.ts`
    -   **Destination:** `backend/infrastructure/src/external/llm-adapter.ts`
    -   **Task:** Implement `ILLMService` port with Azure/OpenAI/Gemini fallback logic.
- [ ] **1.2 Setup Job Queue**
    -   **Task:** Ensure `backend/infrastructure/src/jobs` has a working queue (BullMQ/Redis) to handle long-running `AnalyzeProduct` jobs.

### Phase 2: Domain Logic (The Brain)
**Focus:** Porting the logic that detects problems and proposes solutions.

- [ ] **2.1 Define Optimization Rule Interface**
    -   **Destination:** `backend/domain/src/optimization/rules/optimization-rule.interface.ts`
    -   **Contract:** `check(product): boolean`, `generate(product): string`.
- [ ] **2.2 Implement Rules**
    -   **Source:** `temp_shopeec_analysis/app/services/optimize/rules/`
    -   **Task:** Port `MissingDescriptionRule`, `WeakTitleRule`, `MissingGTINRule` etc.
- [ ] **2.3 Create `AnalyzeProductUseCase`**
    -   **Destination:** `backend/application/common/src/optimization/analyze-product.use-case.ts`
    -   **Logic:**
        1.  Fetch Product.
        2.  Run Heuristic Rules.
        3.  Run AI Analysis (if enabled).
        4.  Save/Update `SmartSignal` entities.
- [ ] **2.4 Create `GenerateFixesUseCase`**
    -   **Destination:** `backend/application/common/src/optimization/generate-fixes.use-case.ts`
    -   **Logic:**
        1.  Query active `SmartSignals`.
        2.  Match Signal Type -> Fix Type.
        3.  Generate `Fix` entity (with `payload` containing the AI suggestion).

### Phase 3: API Layer (The Interface)
**Focus:** Exposing the data to the frontend.

- [ ] **3.1 Create Endpoints**
    -   **Destination:** `backend/delivery/api/src/routes/optimization.ts`
    -   `POST /optimization/scan`: Trigger async scan.
    -   `GET /optimization/stats`: Return counts (Signals, Fixes).
    -   `GET /optimization/fixes`: Return list of Fixes with pagination/filtering.
    -   `POST /optimization/fixes/:id/apply`: Apply a fix to Shopify.

### Phase 4: Frontend Integration
**Focus:** Connecting the wires.

- [ ] **4.1 Verify Shared Components**
    -   Check `frontend/packages/shared-features/src/components/optimization/*`.
    -   Ensure they match the data structure returned by the new API.
- [ ] **4.2 Update Hooks**
    -   **Destination:** `frontend/packages/shared-features/src/hooks/useOptimizationData.ts`
    -   **Task:** Point to the new Fastify endpoints.

---

## 🛠 Reference Mapping

| Concept | Reference Code (`temp_shopeec_analysis`) | New Backend Code (`backend/`) |
| :--- | :--- | :--- |
| **Analysis Logic** | `app/services/product_analysis.server.ts` | `AnalyzeProductUseCase` |
| **Fix Logic** | `app/services/fix.server.ts` | `GenerateFixesUseCase` |
| **Rules** | `app/services/optimize/rules/*.ts` | `domain/src/optimization/rules/*.ts` |
| **AI Client** | `app/services/ai/llm.ts` | `infrastructure/src/external/llm-adapter.ts` |
| **API** | `app/routes/api.optimization.*` | `delivery/api/src/routes/optimization.ts` |

