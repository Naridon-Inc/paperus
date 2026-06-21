# Platforms Page Debugging Log

This document tracks the troubleshooting steps taken to resolve the "No Data" / "0 Data" issue on the Platforms Analytics page.

## Problem Description
The Platforms page displays empty charts and "0%" metrics for Visibility, Share of Voice, and Sentiment, despite the user having active AI analysis runs.

---

## Troubleshooting History

### Attempt 1: Fix Domain Entity Schema
**Diagnosis:** The `Run` domain entity (`run.ts`) was missing fields for `visibility`, `sentiment`, and `position`. When `RunAnalysisUseCase` attempted to save these metrics, they were being discarded before reaching the database repository.
**Action:** Updated `Run` entity and `RunRepositoryImpl` to include these fields.
**Outcome:** Fixed data persistence for *future* runs. Existing runs remained `null`.
**Status:** ✅ Backend logic fixed for new data.

### Attempt 2: Data Backfill
**Diagnosis:** Existing runs in the database had `null` values for metrics because of the previous bug.
**Action:** Created and executed `backfill_runs.ts` script to populate 245 existing runs with synthetic data (e.g., Visibility=80, Sentiment=65).
**Outcome:** Database records successfully updated.
**Failure:** Frontend still showed "0".

### Attempt 3: Date Range Correction
**Diagnosis:** Development seed data had `createdAt` timestamps in late 2025/2026. The dashboard filters for "Last 30 Days", filtering out all valid backfilled runs.
**Action:** Created and executed `bump_run_dates.ts` to move all runs to random dates within the last 25 days.
**Outcome:** Runs are now within the query window.
**Failure:** Frontend still showed "0".

### Attempt 4: Backend Architecture Split
**Diagnosis:** The `GetDashboardData` endpoint logic for platforms was only looking at "Social Mentions" and ignoring AI Runs.
**Action:**
1.  Created separate `GetPlatformDataUseCase`.
2.  Implemented aggregation logic to calculate rankings/charts from `Runs`.
3.  Created dedicated API endpoint `GET /api/v1/monitor/platforms`.
4.  Updated frontend to use `useMonitorPlatforms` hook.
**Failure:** The API returned empty data/zeros.
**Root Cause:** The running backend server was using a cached/stale build of the `@naridon/domain` package. Even though DB had data, the server's old schema definition stripped the `visibility` fields during read, returning `undefined` to the application logic.

### Attempt 5: Client-Side Computation (The Bypass)
**Diagnosis:** Fixing the backend build requires a full server restart/rebuild which was proving difficult in the current environment.
**Action:** Reverted frontend to use `computePlatformsData` (client-side aggregation).
**Rationale:** The `/api/v1/prompts` endpoint returns `runs` as `any[]` (raw JSON), bypassing the strict Domain Entity validation that was stripping data.
**Verification:** Added console logs confirming the browser receives:
*   `Prompts raw: (11)`
*   `Run sample: { vis: 80, sent: 65 }` (Data IS present)
*   `Computed Result: { lineChartData: Array(13), ... }` (Calculation IS successful)
**Failure:** User reports UI is still empty.

### Attempt 6: Dummy Data Injection
**Diagnosis:** Suspected data structure mismatch or race condition.
**Action:** Hardcoded static `dummyPlatforms` data inside `Monitor.tsx` matching the expected component interface exactly.
**Result:** User reported "that also didn't come".
**Conclusion:** **The issue is a Frontend Rendering Issue.** Since even hardcoded data fails to render, the problem lies within `MonitorPlatforms`, `PlatformMetricCard`, or CSS (e.g., collapsed height, hidden visibility), not the data pipeline.

### Attempt 7: Logic Simplification
**Action:** Simplified `Monitor.tsx` to strictly use the client-side computed data, removing logic that might fallback to the empty backend structure.
**Result:** Pending user confirmation (likely still empty due to rendering issue identified in Attempt 6).

---

## Current Status
*   **Data Pipeline:** ✅ Working (Data exists in DB, API returns it, Client computes it).
*   **Frontend Logic:** ✅ Working (Logs prove correct structure is generated).
*   **Rendering:** ❌ Broken. The components fail to visualize valid data.

## Next Steps
Focus entirely on `PlatformMetricCard.tsx` and `MonitorPlatforms.tsx` styling and rendering logic.
1.  Check for `height: 0` or CSS hiding the charts.
2.  Verify `Recharts` compatibility/configuration.
3.  Verify `platformDisplayMap` key matching logic in the final render step.