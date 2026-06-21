# Database Optimization Plan

**Date:** January 14, 2026
**Target:** `backend/libs/db/prisma/schema.prisma`

## 1. Analysis

### 1.1 Unused / Legacy Tables
*   **`EmailJob`**: Likely legacy background job table. Replaced by `libs/queue` (BullMQ/QStash).
    *   *Action:* Mark for deprecation. Do not delete yet to preserve history.
*   **`Waitlist`**: Likely from pre-launch.
    *   *Action:* Keep for historical data.
*   **`session`**: Lowercase model name indicates legacy auth library (likely `@shopify/shopify-api-node`).
    *   *Action:* Keep. Required by Shopify auth.

### 1.2 Missing Indexes (Performance)
*   **`Run` Table:**
    *   Queries often fetch `PENDING` runs for workers.
    *   *Current:* `@@index([promptId, createdAt])`, `@@index([createdAt])`.
    *   *Missing:* `@@index([status])` or `@@index([shopId, status])` for "My Pending Runs".
*   **`Organization` Table:**
    *   `ownerShopId` is a scalar.
    *   *Missing:* `@@index([ownerShopId])`.

## 2. Implementation Plan

### Step 1: Add Performance Indexes
Add the following indexes to `schema.prisma`:

```prisma
model Run {
  // ...
  @@index([status]) // For worker polling
  @@index([shopId, status]) // For shop dashboard "Processing..." status
}

model Organization {
  // ...
  @@index([ownerShopId])
}
```

### Step 2: Apply Changes
1.  Update `schema.prisma`.
2.  Run `pnpm db:generate`.
3.  Run `pnpm db:migrate` (or `db push` for dev).

## 3. Future Cleanup
*   Evaluate dropping `EmailJob` table after 30 days of `libs/queue` stability.
