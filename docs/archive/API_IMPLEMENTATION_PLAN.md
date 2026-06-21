# Complete API Endpoint Migration - Detailed Implementation Plan

## Overview
We need to migrate 20+ API endpoints from Remix resource routes to Express routes.

## Key Challenge
The original endpoints use Remix's `authenticate.admin(request)` which:
1. Validates Shopify session
2. Provides `admin` GraphQL client
3. Provides `billing` API
4. Provides `session` object

## Solution Strategy
For the backend API, we'll:
1. Accept `shopId` and `accessToken` as parameters (from headers or query)
2. Remove Remix-specific authentication
3. Keep all business logic intact
4. Use existing services (AnalyticsService, etc.)

## Endpoint Migration List

### 1. Monitor Data (COMPLEX - 8 tabs in one endpoint!)
**Source**: `api.monitor.data.tsx`
**Target**: `backend/api/v1/monitor/data.ts`
**Tabs**:
- Tab 0: Dashboard (default)
- Tab 1: Prompts/Tracking
- Tab 2: Competitors
- Tab 3: Citations
- Tab 4: External Mentions
- Tab 5: Sentiment
- Tab 6: Platforms
- Tab 7: Personas

**Strategy**: Create one endpoint with tab parameter, OR split into separate endpoints:
- `GET /api/v1/monitor/dashboard`
- `GET /api/v1/monitor/prompts`
- `GET /api/v1/monitor/competitors`
- `GET /api/v1/monitor/citations`
- `GET /api/v1/monitor/mentions`
- `GET /api/v1/monitor/sentiment`
- `GET /api/v1/monitor/platforms`
- `GET /api/v1/monitor/personas`

**Decision**: Split into separate endpoints for clarity

### 2. Monitor Dashboard
**Source**: `api.monitor.dashboard.tsx`
**Target**: Already covered by monitor/data tab 0

### 3. Monitor Citations
**Source**: `api.monitor.citations.tsx`
**Target**: Already covered by monitor/data tab 3

### 4. Monitor Competitors
**Source**: `api.monitor.competitors.tsx`
**Target**: Already covered by monitor/data tab 2

### 5. Monitor Mentions
**Source**: `api.monitor.mentions.tsx`
**Target**: Already covered by monitor/data tab 4

### 6. Monitor Sentiment
**Source**: `api.monitor.sentiment.tsx`
**Target**: Already covered by monitor/data tab 5

### 7. Monitor Tracking
**Source**: `api.monitor.tracking.tsx`
**Target**: Already covered by monitor/data tab 1

### 8. Monitor Platforms
**Source**: `api.monitor.platforms.tsx`
**Target**: Already covered by monitor/data tab 6

### 9. Monitor Personas
**Source**: `api.monitor.personas.tsx`
**Target**: `GET/POST /api/v1/monitor/personas`

### 10. Monitor Prompt (specific)
**Source**: `api.monitor.prompt.$id.tsx`
**Target**: `GET/POST/DELETE /api/v1/monitor/prompts/:id`

### 11. Optimization Dashboard
**Source**: `api.optimization.dashboard.tsx`
**Target**: `GET /api/v1/optimization/dashboard`

### 12. Optimization Fixes
**Source**: `api.optimization.fixes.tsx`
**Target**: `GET/POST /api/v1/optimization/fixes` (already exists, enhance)

### 13. Optimization Stats
**Source**: `api.optimization.stats.tsx`
**Target**: `GET /api/v1/optimization/stats`

### 14. Optimization Trends
**Source**: `api.optimization.trends.tsx`
**Target**: `GET /api/v1/optimization/trends`

### 15. Optimization Redirects
**Source**: `api.optimization.redirects.tsx`
**Target**: `GET/POST /api/v1/optimization/redirects`

### 16. Prompts Status
**Source**: `api.prompts.status.tsx`
**Target**: `GET /api/v1/prompts/status`

### 17. Scheduler
**Source**: `api.scheduler.ts`
**Target**: `POST /api/v1/scheduler/schedule`

### 18. Waitlist
**Source**: `api.waitlist.tsx`
**Target**: `POST /api/v1/waitlist`

### 19. Nuclear Reset (Dev Only)
**Source**: `api.nuclear-reset.tsx`
**Target**: `POST /api/v1/dev/reset` (only in development)

### 20. Cron Optimize
**Source**: `api.cron.optimize.tsx`
**Target**: `GET /api/v1/cron/optimize` (already created, enhance)

## Implementation Order (Priority)

### Phase 1: Critical Dashboard APIs (Do First)
1. ✅ Monitor Dashboard (main metrics)
2. Monitor Data - All 8 tabs
3. Optimization Dashboard
4. Optimization Stats

### Phase 2: Feature APIs
5. Monitor Personas (GET/POST)
6. Monitor Prompt by ID (GET/POST/DELETE)
7. Optimization Fixes (enhance existing)
8. Optimization Trends
9. Optimization Redirects

### Phase 3: Utility APIs
10. Prompts Status
11. Scheduler
12. Waitlist

### Phase 4: Dev/Admin APIs
13. Nuclear Reset (dev only)

## Authentication Strategy

All endpoints will accept:
```typescript
// Option 1: Headers (preferred)
headers: {
  'x-shop-id': 'shop-uuid',
  'x-access-token': 'shopify-access-token'
}

// Option 2: Query params (for GET requests)
?shopId=xxx&accessToken=xxx
```

## Services to Migrate/Fix
- AnalyticsService - Already in `backend/domain/analytics/service.ts`
- SmartSignalService - Need to migrate
- Billing utilities - Need to adapt

## Next Steps
1. Migrate AnalyticsService imports
2. Create all monitor endpoints
3. Create all optimization endpoints
4. Create utility endpoints
5. Test each endpoint
6. Update checklist
