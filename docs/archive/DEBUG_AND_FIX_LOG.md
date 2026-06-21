# Platforms Page Debugging & Fix Log

This document serves as a comprehensive record of the troubleshooting and resolution process for the Platforms Analytics page issues in the `Test-app`.

## 🚨 Problem Statement
The "Platforms" page in the Monitor dashboard was displaying "No Data" (empty charts and tables) despite the user having active AI prompts and runs. Additionally, the Matrix view was broken, and hovering over certain charts caused application crashes.

---

## 🔍 Root Cause Analysis

After extensive investigation, we identified a chain of failures spanning the Database, Backend API, and Frontend Rendering layers:

1.  **Data Loss in Persistence:**
    *   The `Run` domain entity was missing definitions for critical metric fields (`visibility`, `sentiment`, `position`).
    *   The backend analysis service calculated these metrics correctly, but they were silently discarded by the strict Domain Entity validation before being saved to the database.
    *   **Result:** Database rows existed but had `null` values for all analytics columns.

2.  **Stale/Incompatible Data:**
    *   Development seed data had `createdAt` timestamps far in the future (2025/2026).
    *   The dashboard's default "Last 30 Days" filter excluded all this data.
    *   **Result:** Even if metrics were present, the queries returned 0 results.

3.  **Flawed Backend Architecture:**
    *   The original `/api/v1/monitor/dashboard` endpoint relied on a monolithic Use Case that calculated "Platform Stats" solely from *Social Mentions* (e.g., Tweets), completely ignoring the AI Run data (ChatGPT/Perplexity results).
    *   **Result:** The API returned empty/placeholder structures for the Platforms view.

4.  **Frontend Data Structure Mismatch:**
    *   The `MatrixView` component expected a complex nested data structure (`Topics -> Prompts -> Scores`).
    *   The initial fix attempted to pass a flat array of topics.
    *   **Result:** The component couldn't find the scores nested deep in the object tree, rendering empty rows.

5.  **Component State Logic:**
    *   The `MatrixView` defaulted to showing "Competitors" on load. Since competitor data aggregation wasn't implemented initially, the table appeared blank, confusing the user.

6.  **Missing Configuration & Crashes:**
    *   The local app configuration (`platforms.ts`) was missing definitions for `google-ai-overview`.
    *   **Result:** Hovering over a chart line for Google AI Overview caused a crash (`Cannot read properties of undefined`) because the tooltip couldn't find the logo.

---

## 🛠️ Actions Taken & Solutions

We executed a systematic fix across the entire stack:

### 1. Database & Data Integrity
*   **Schema Update:** Updated `backend/domain/src/monitoring/prompts/entities/run.ts` to include `visibility`, `sentiment`, etc.
*   **Wipe & Reset:** Wiped all stale/broken data from the database.
*   **Real Analysis:** Triggered a fresh, live AI analysis script (`reset_and_run_real.ts`) that successfully called external APIs (Perplexity, SearchAPI) and populated the DB with valid, time-correct data.

### 2. Backend/Frontend Logic Split
*   **Client-Side Calculation:** Instead of relying on the flawed backend aggregation endpoint, we updated `MonitorPlatforms.tsx` (Local) to compute analytics directly from the raw `prompts` list on the client side.
*   **Benefit:** This bypassed backend build/caching issues and ensured the UI always reflects the exact raw data returned by the API.

### 3. Metric Aggregation Logic
*   **Updated Computation:** Rewrote `computePlatformsData` in `monitorUtils.ts` to:
    *   Aggregate `visibility`, `share of voice`, and `citations` simultaneously.
    *   Build the specific nested structure required by `MatrixView`.
    *   Implement competitor scoring by parsing mentions from the runs.

### 4. Component Fixes
*   **Matrix View:** Updated `MatrixView.tsx` to automatically switch the default view to **"Topics"** (which is always populated) if competitor data is sparse.
*   **Tooltips:** Updated `CustomLineChartTooltip` usage to explicitly pass missing props (`displayNameToKey`) and updated `platforms.ts` to include missing keys (`google-ai-overview`), eliminating crashes.
*   **Prop Passing:** Fixed `MonitorPlatforms.tsx` to pass the `matrixData` prop in the correct shape (`{ topics: [...], competitors: [...] }`).

---

## ✅ Final State

The Platforms page is now fully functional:
*   **Charts:** Visibility and Share of Voice charts populate correctly with real data.
*   **Matrix:** The table loads immediately showing Topic scores.
*   **Toggles:** Users can switch between "Visibility", "Share of Voice", and "Citation Share" views.
*   **Competitors:** The Competitor view works and displays rival brands found during analysis.
*   **Stability:** No console errors or crashes during interaction.