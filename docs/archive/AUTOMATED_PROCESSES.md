# Automated Processes & Scheduling Architecture

## Overview
The application uses a serverless-friendly scheduling architecture powered primarily by **Upstash QStash**. This avoids the need for a persistent Redis-backed worker fleet (like BullMQ) in the main API service, reducing costs and complexity for the App Runner environment.

## Infrastructure

### 1. QStash (Active)
*   **Role**: Distributed scheduler and message queue.
*   **Integration**: `QStashSchedulerAdapter` (`backend/infrastructure/src/jobs/qstash-scheduler-adapter.ts`).
*   **Mechanism**:
    *   **Scheduling**: Calls `client.publishJSON({ cron: "..." })`.
    *   **Execution**: QStash sends HTTP POST requests to the application's worker endpoints.
    *   **Security**: Signature verification (`Upstash-Signature`) in `backend/delivery/api/src/routes/workers.ts`.

### 2. BullMQ (Inactive)
*   **Status**: Libraries are present in `backend/libs/queue` but **not initialized** in the production API server (`backend/delivery/api/src/index.ts`).
*   **Reason**: BullMQ requires a persistent Redis connection and long-running worker processes, which are less ideal for the current scale-to-zero App Runner setup compared to HTTP-push based QStash.

---

## Automated Processes

### 1. Prompt Autopilot (Analysis)
*   **Description**: Regularly executes specific AI prompts (e.g., "Analyze competitor pricing for ski boots") to track changes over time.
*   **Trigger**: Scheduled when a Prompt is created or updated.
*   **Schedule Interval**:
    *   Dynamic based on `frequency` setting on the Prompt.
    *   Defaults to Plan Limit (`autopilot_frequency_days`, typically **Daily** or **Weekly**).
    *   Cron expression generated dynamically (e.g., `0 0 * * *` for daily).
*   **Worker Endpoint**: `POST /api/v1/workers/process-prompt`
*   **Plan Conscious**: **YES**
    *   **Scheduling**: Frequency restricted by `autopilot_frequency_days`.
    *   **Execution**: Before running, the worker calls `entitlementsService.assertCanConsumeUsage(shopId, "daily_scans")`. If the daily limit is reached, the job fails/skips.
    *   **Usage Recording**: Records `PROMPT_RUN` usage in the ledger.

### 2. Competitor Deep Dive
*   **Description**: Performs in-depth analysis (SWOT, full catalog scan) of top competitors.
*   **Trigger**: Periodic Cron Job (configured externally or via QStash console to hit the endpoint).
*   **Worker Endpoint**: `POST /api/v1/cron/deep-dive`
*   **Plan Conscious**: **YES**
    *   **Selection**: Sorts competitors by "strength" and selects only the top N, where N = `deep_dive_competitors_limit` (e.g., Top 3 for Starter Plan).
    *   **Frequency**: Checks `lastDeepDiveAt`. Only runs if `(Now - LastRun) > deep_dive_frequency_days` (e.g., 30 days).
    *   **Usage**: Deducts relevant credits or checks limits before execution.

### 3. Store Optimization Scan (Manual/Gap)
*   **Description**: Scans products for missing meta descriptions, alt text, etc.
*   **Current Status**: **Automated** (Scheduled Daily).
*   **Automated Schedule**: 
    *   **Trigger**: `/api/v1/cron/schedule-daily-scans` (configured in QStash).
    *   **Logic**: Iterates all active shops. Checks plan limit (`daily_scans > 0`). Schedules `/api/v1/workers/scan-store` worker for eligible shops.
    *   **Worker Endpoint**: `POST /api/v1/workers/scan-store`.

---

## Verification Checklist

To ensure these processes are working in production:

1.  **Environment Variables**:
    *   `QSTASH_TOKEN`: Must be valid.
    *   `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`: For signature verification.
    *   `WORKER_URL`: Must point to the public App Runner URL (e.g., `https://app.naridon.com`) so QStash can reach the endpoints. **Critical**: If this is `localhost`, scheduling is skipped (see code).
    *   `CRON_SECRET`: For protecting the `/cron/deep-dive` and `/cron/schedule-daily-scans` endpoints.

2.  **Plan Limits**:
    *   Ensure `ShopPlanLimit` table is populated. If limits are 0 or null, automated jobs may skip execution or fail immediately.

3.  **Logs**:
    *   Look for `[Worker] Processing prompt...` or `[Cron] Running Deep Dive...` or `[Worker] Scanning store...` in App Runner logs.

## Manual Test (Daily Scan)
You can manually trigger the daily scan scheduler to verify it works:
```bash
curl -X POST https://app.naridon.com/api/v1/cron/schedule-daily-scans \
  -H "Authorization: Bearer <CRON_SECRET>"
```
Response should be like: `{"scheduled":1,"skipped":0,"total":1,"message":"Scheduled daily scans for 1 shops."}`
