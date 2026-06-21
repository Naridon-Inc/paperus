# UI vs Backend Gap Analysis

## 🚨 Critical Gaps Identified
This document maps the planned UI Components (from `UI_MIGRATION_PLAN.md`) to the current Backend Implementation (`backend/delivery/api`). It highlights missing data fields, endpoints, or logic mismatches that will block the frontend integration.

---

## 1️⃣ Prompt Creation & Management

### 🔴 Mismatch: Create Prompt Payload
*   **UI Requirement**: The "Add Prompt" form allows users to configure:
    *   `text` (Query)
    *   `topic` (Categorization)
    *   `locations` (Geo-targeting, e.g., "US", "UK") - *Missing in API*
    *   `frequency` (Autopilot schedule, e.g., "Daily", "Weekly") - *Missing in API*
    *   `competitors` (Specific competitors to track for this prompt) - *Missing in API*
*   **Backend Reality** (`POST /api/v1/prompts`):
    *   Accepts: `{ text, topic, personaId }`.
    *   Result: `locations` defaults to `['US']`. `frequency` is derived from Plan Limits (not per-prompt).
*   **Fix Required**:
    1.  Update `CreatePromptSchema` to accept `locations`, `frequency`, `competitors`.
    2.  Update `Prompt` entity to persist these overrides.
    3.  Update `CreatePromptUseCase` to schedule based on *prompt-specific* frequency (if allowed by plan).

### 🔴 Missing Endpoint: Detailed Prompt View
*   **UI Requirement**: `MonitorTracking` / `PromptDetails` page needs:
    *   Prompt Metadata (Text, Topic).
    *   **Run History** (Sparkline/List of past runs).
    *   **Current Metrics** (Avg Position, SoV trend).
*   **Backend Reality**:
    *   `GET /api/v1/prompts` returns a *list* of Prompts.
    *   `GET /api/v1/monitor/dashboard` returns aggregated stats.
    *   **Missing**: `GET /api/v1/prompts/:id` (Single prompt details with history).
*   **Fix Required**: Implement `GetPromptDetailsUseCase` and route.

---

## 2️⃣ Monitoring Dashboard

### 🟡 Partial: Optimization Charts (Trends)
*   **UI Requirement**: `OptimizationCharts` requires historical trend data:
    *   `AutopilotActivityChart` (Fixes applied over time).
    *   `FixSuccessTrendChart` (Ranking improvement vs Fixes).
*   **Backend Reality**:
    *   `GET /api/v1/monitor/dashboard` returns *current snapshots* (`stats`, `recentSignals`).
    *   It does **not** return time-series data for charts.
*   **Fix Required**:
    *   Add `trends` field to Dashboard API or create `GET /api/v1/monitor/trends`.
    *   Logic: Aggregation query on `Run` table (grouped by day) and `FixExecution` table.

### 🟡 Partial: Competitor Insights
*   **UI Requirement**: `MonitorCompetitors` view needs:
    *   `CompetitorLogo` (Domain/Logo URL).
    *   `CompetitorPressureCard` (Threat score, keyword gaps).
*   **Backend Reality**:
    *   `Competitor` entity has `strength` and `topKeywords`.
    *   **Missing**: "Keyword Gaps" (intersection of my keywords vs theirs). "Overlap Matrix".
    *   **Missing**: Logo resolution (can be done on FE or via Clearbit/Brandfetch on BE).

---

## 3️⃣ Optimization & Fixes

### 🔴 Mismatch: Fix Payload Structure
*   **UI Requirement**: `DiffCard` shows "Before" vs "After".
    *   Expects structured data like `{ original: "...", suggested: "...", reason: "..." }`.
*   **Backend Reality**:
    *   `Fix` entity has generic `payload: Record<string, any>`.
    *   Logic generates `{ suggestedTitle, suggestedDescription }` but structure varies by fix type.
*   **Fix Required**:
    *   Standardize `payload` schema for `METADATA` fixes to ensure UI can reliably render the Diff.
    *   Ensure `reason` is persisted in `Fix` entity (it exists in schema, check UseCase mapping).

---

## 4️⃣ Onboarding & Discovery

### 🔴 Missing Logic: Shop Analysis (Phase 0)
*   **UI Requirement**: `OnboardingHero` assumes the system knows the "Industry" and "Topics".
*   **Backend Reality**:
    *   `GeneratePromptsUseCase` relies on `shop.industry`.
    *   **Critical Gap**: We never *set* `shop.industry` intelligently. It defaults to "E-commerce" or relies on Shopify raw data (often empty).
*   **Fix Required**:
    *   Implement **Shop Analysis** (SearchAPI + AI) to detect Industry/Niche automatically on install.

---

## 5️⃣ Summary of Tasks
| Priority | Component | Task |
| :--- | :--- | :--- |
| **High** | Prompts | Update `POST /prompts` to support locations/frequency. |
| **High** | Prompts | Implement `GET /prompts/:id` (Details + History). |
| **High** | Dashboard | Add Time-Series Data for Charts. |
| **Medium** | Onboarding | Implement `AnalyzeShop` logic (Auto-detect industry). |
| **Medium** | Fixes | Standardize Diff Payload for UI rendering. |