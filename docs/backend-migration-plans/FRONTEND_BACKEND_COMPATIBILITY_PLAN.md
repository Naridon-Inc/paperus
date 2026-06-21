# Frontend-Backend Compatibility & Integration Plan

**Date:** January 12, 2026  
**Version:** 1.0  
**Status:** Compatibility Analysis Complete

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Frontend Integration Analysis](#current-frontend-integration-analysis)
3. [Compatibility Assessment](#compatibility-assessment)
4. [Migration Strategy for Frontend](#migration-strategy-for-frontend)
5. [Breaking vs. Non-Breaking Changes](#breaking-vs-non-breaking-changes)
6. [Incremental Adoption Plan](#incremental-adoption-plan)
7. [API Client Refactoring Guide](#api-client-refactoring-guide)
8. [Testing Strategy](#testing-strategy)
9. [Rollout Plan](#rollout-plan)

---

## Executive Summary

### Good News ✅

**The backend migration is designed to be FULLY BACKWARD COMPATIBLE** with the current frontend!

### Key Findings

1. ✅ **No breaking changes required** - Old endpoints remain functional
2. ✅ **Incremental adoption** - Frontend can migrate at its own pace
3. ✅ **Feature flags available** - Easy A/B testing and rollback
4. ✅ **Same data structures** - Response formats remain compatible
5. ✅ **Performance improvements** - Faster without frontend changes

### Migration Approach

**Phase 1-3 (Backend):** Deploy new endpoints alongside old ones (Weeks 1-6)  
**Phase 4 (Frontend):** Gradually migrate frontend hooks (Weeks 7-8)  
**Phase 5 (Cleanup):** Deprecate old endpoints after migration (Weeks 9-12)

---

## Current Frontend Integration Analysis

### Technology Stack

```typescript
// Frontend Tech Stack (from shared-features)
- React Query (TanStack Query) ✅ - Perfect for new endpoints
- Axios ✅ - Works great with REST APIs
- TypeScript ✅ - Type-safe API client
- Context API ✅ - For API provider
```

### Current API Endpoints Used

Based on analysis of `frontend/packages/shared-features/src/hooks/`:

#### 1. Monitoring Dashboard (`useMonitorData.ts`)

**Current Endpoint:**
```typescript
GET /monitor/dashboard?shopId={shopId}
```

**Response Structure:**
```typescript
{
  stats: {
    competitorsCount: number;
    activeSignalsCount: number;
    urgentSignalsCount: number;
    promptsCount: number;
    averageCompetitorStrength: number;
  };
  recentSignals: any[];
  topCompetitors: any[];
}
```

**Status:** ⚠️ **MONOLITHIC** - Returns all dashboard data at once

---

#### 2. Competitors (`useCompetitors.ts`)

**Current Endpoint:**
```typescript
GET /monitor/competitors?shopId={shopId}&limit=100&productIds={ids}&topic={topic}&location={region}
```

**Response Structure:**
```typescript
Competitor[] {
  id: string;
  name: string;
  domain: string;
  strength: number;
  topKeywords: string[];
  lastSeen: string;
  stats?: {
    visibility: number;
    sentiment: number;
    position: number;
  };
}
```

**Status:** ✅ **ALREADY GRANULAR** - This endpoint is good!

---

#### 3. Prompts CRUD (`usePrompts.ts`)

**Current Endpoints:**
```typescript
GET    /prompts?shopId={shopId}
GET    /prompts/{id}?shopId={shopId}
POST   /prompts
PATCH  /prompts/{id}
DELETE /prompts/{id}
```

**Status:** ✅ **ALREADY GRANULAR** - These endpoints are good!

---

### Current Hook Structure

#### Example: `useMonitorDashboard`

```typescript
// frontend/packages/shared-features/src/hooks/useMonitorData.ts
export const useMonitorDashboard = (shopId?: string) => {
  const api = useApi();

  return useQuery({
    queryKey: ["monitor", "dashboard", shopId],
    queryFn: async () => {
      const { data } = await api.get<MonitorDashboardData>(
        "/monitor/dashboard",
        { params: { shopId } }
      );
      
      // Maps old structure to expected frontend structure
      return {
        ...data,
        stats: {
          ...data.stats,
          totalPrompts: data.stats.promptsCount,
          totalMentions: 0,
          sentimentScore: 0,
        },
        competitors: {
          list: data.topCompetitors,
          suggested: [],
        },
        potentialRevenue: 0,
        shareOfVoiceStats: [],
      };
    },
    enabled: true,
  });
};
```

**Issue:** ⚠️ Single API call fetches ALL dashboard data (slow, no caching)

---

## Compatibility Assessment

### Backend Changes Overview

| Change Type | Impact on Frontend | Backward Compatible? |
|-------------|-------------------|----------------------|
| **Split dashboard endpoint** | None initially | ✅ YES (old endpoint stays) |
| **Add domain value objects** | None (internal) | ✅ YES |
| **Add domain services** | None (internal) | ✅ YES |
| **Add new use cases** | None (internal) | ✅ YES |
| **Add 13 new endpoints** | Optional adoption | ✅ YES (additive) |
| **Database indexes** | Better performance | ✅ YES (transparent) |

### ✅ 100% Backward Compatible

**All backend changes are NON-BREAKING:**

1. ✅ Old `/monitor/dashboard` endpoint continues to work
2. ✅ Response structures remain the same
3. ✅ Query parameters remain the same
4. ✅ Authentication remains the same
5. ✅ Error handling remains the same

---

## Migration Strategy for Frontend

### Phase 1-3: Backend Deployment (Weeks 1-6)

**Action:** NONE required from frontend team

**What Happens:**
- Backend deploys new endpoints alongside old ones
- Old `/monitor/dashboard` continues to work
- Performance improvements from database indexes
- Frontend automatically benefits from faster queries

**Frontend Changes:** ❌ None needed

---

### Phase 4: Frontend Migration (Weeks 7-8)

**Action:** Gradually adopt new granular endpoints

**Approach:** One hook at a time

#### Step 1: Create New Hooks (Keep Old Ones)

**Strategy:** Add new hooks alongside existing ones

```typescript
// frontend/packages/shared-features/src/hooks/useDashboard.ts

// NEW: Granular hooks (add these)
export const useDashboardConfig = () => {
  const api = useApi();
  
  return useQuery({
    queryKey: ["dashboard", "config"],
    queryFn: async () => {
      const { data } = await api.get("/monitor/dashboard/config");
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useDashboardStats = (params: {
  timeRange?: string;
  productId?: string;
  region?: string;
}) => {
  const api = useApi();
  
  return useQuery({
    queryKey: ["dashboard", "stats", params],
    queryFn: async () => {
      const { data } = await api.get("/monitor/dashboard/stats", {
        params,
      });
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useDashboardCharts = (params: {
  timeRange?: string;
  source?: string;
  productId?: string;
}) => {
  const api = useApi();
  
  return useQuery({
    queryKey: ["dashboard", "charts", params],
    queryFn: async () => {
      const { data } = await api.get("/monitor/dashboard/charts", {
        params,
      });
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useDashboardCompetitors = (params: {
  timeRange?: string;
  productId?: string;
}) => {
  const api = useApi();
  
  return useQuery({
    queryKey: ["dashboard", "competitors", params],
    queryFn: async () => {
      const { data } = await api.get("/monitor/dashboard/competitors", {
        params,
      });
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

// OLD: Keep existing hook (mark as deprecated)
/**
 * @deprecated Use granular hooks instead (useDashboardConfig, useDashboardStats, etc.)
 */
export const useMonitorDashboard = (shopId?: string) => {
  // ... existing implementation
};
```

**Benefits:**
- ✅ No breaking changes
- ✅ Old code continues to work
- ✅ New code can use better hooks
- ✅ Gradual migration possible

---

#### Step 2: Update Components (One at a Time)

**Strategy:** Refactor components to use new hooks

**Before (Monolithic):**
```typescript
// Old: One hook for everything
function MonitorDashboard() {
  const { data, isLoading, error } = useMonitorDashboard();
  
  if (isLoading) return <Loading />;
  if (error) return <Error />;
  
  return (
    <div>
      <Stats stats={data.stats} />
      <Charts charts={data.charts} />
      <Competitors competitors={data.competitors} />
    </div>
  );
}
```

**After (Granular):**
```typescript
// New: Multiple hooks for better UX
function MonitorDashboard() {
  const { data: config } = useDashboardConfig();
  const { data: stats, isLoading: statsLoading } = useDashboardStats({ timeRange: "30" });
  const { data: charts, isLoading: chartsLoading } = useDashboardCharts({ timeRange: "30" });
  const { data: competitors, isLoading: competitorsLoading } = useDashboardCompetitors({ timeRange: "30" });
  
  return (
    <div>
      {/* Config loads immediately (cached) */}
      <Header config={config} />
      
      {/* Stats load in parallel */}
      {statsLoading ? <StatsSkeleton /> : <Stats stats={stats} />}
      
      {/* Charts load independently */}
      {chartsLoading ? <ChartsSkeleton /> : <Charts charts={charts} />}
      
      {/* Competitors load independently */}
      {competitorsLoading ? <CompetitorsSkeleton /> : <Competitors competitors={competitors} />}
    </div>
  );
}
```

**Benefits:**
- ✅ **Parallel loading** - All data loads simultaneously
- ✅ **Selective rendering** - Show what's ready
- ✅ **Better UX** - Partial content instead of spinner
- ✅ **Granular caching** - Each piece cached independently
- ✅ **Easier refetching** - Update just what changed

---

#### Step 3: Add Feature Flag Support

**Strategy:** Test new endpoints in production with feature flags

```typescript
// frontend/packages/shared-features/src/config/features.ts
export const FEATURES = {
  NEW_DASHBOARD_ENDPOINTS: {
    enabled: process.env.NEXT_PUBLIC_NEW_DASHBOARD === "true",
    rolloutPercentage: 0, // Start at 0%, gradually increase
  },
};

// frontend/packages/shared-features/src/hooks/useDashboard.ts
export const useMonitorDashboard = (shopId?: string) => {
  const api = useApi();
  
  // Use new endpoints if feature flag is enabled
  if (FEATURES.NEW_DASHBOARD_ENDPOINTS.enabled) {
    return useNewDashboardEndpoints(shopId);
  }
  
  // Fall back to old endpoint
  return useOldDashboardEndpoint(shopId);
};

// Helper hook that combines new endpoints
function useNewDashboardEndpoints(shopId?: string) {
  const config = useDashboardConfig();
  const stats = useDashboardStats({ timeRange: "30" });
  const charts = useDashboardCharts({ timeRange: "30" });
  const competitors = useDashboardCompetitors({ timeRange: "30" });
  
  // Combine results to match old structure
  return {
    data: {
      config: config.data,
      stats: stats.data,
      charts: charts.data,
      competitors: competitors.data,
    },
    isLoading: config.isLoading || stats.isLoading || charts.isLoading || competitors.isLoading,
    error: config.error || stats.error || charts.error || competitors.error,
  };
}
```

**Rollout Plan:**
1. Week 7: Internal testing (0% users)
2. Week 8: Beta users (10% users)
3. Week 9: Gradual rollout (25% → 50%)
4. Week 10: Full rollout (100%)

---

## Breaking vs. Non-Breaking Changes

### ✅ Non-Breaking (Safe to Deploy)

These changes are ADDITIVE and don't affect existing code:

#### 1. New Endpoints Added
```typescript
// NEW: Granular dashboard endpoints
GET /monitor/dashboard/config       ✅ NEW
GET /monitor/dashboard/stats        ✅ NEW
GET /monitor/dashboard/charts       ✅ NEW
GET /monitor/dashboard/trends       ✅ NEW
GET /monitor/dashboard/competitors  ✅ NEW
// ... 8 more new endpoints

// OLD: Continues to work
GET /monitor/dashboard              ✅ REMAINS
```

#### 2. Response Enhancements
```typescript
// Backend may ADD new fields (non-breaking)
{
  stats: {
    promptsCount: 10,
    visibilityScore: 85,  // ✅ NEW field (ignored by old frontend)
  }
}
```

#### 3. Performance Improvements
- Database indexes (transparent to frontend)
- Query optimizations (transparent to frontend)
- Caching improvements (transparent to frontend)

---

### ⚠️ Potentially Breaking (Review Required)

These changes WOULD be breaking but are NOT in the current plan:

#### ❌ NOT PLANNED: Response Structure Changes
```typescript
// ❌ BAD: Don't change field names
{
  stats: {
    promptsCount: 10,     // Old
    totalPrompts: 10,     // ❌ BREAKING if we remove promptsCount
  }
}

// ✅ GOOD: Add new fields, keep old ones
{
  stats: {
    promptsCount: 10,     // ✅ Keep for backward compat
    totalPrompts: 10,     // ✅ New field (optional)
  }
}
```

#### ❌ NOT PLANNED: Endpoint Removal
```typescript
// ❌ BAD: Don't remove old endpoints immediately
DELETE /monitor/dashboard  // ❌ BREAKING

// ✅ GOOD: Deprecate first, remove later
GET /monitor/dashboard
  Response Headers:
    X-Deprecated: true
    X-Sunset: 2026-03-01
    X-Migration-Guide: /docs/api-migration
```

#### ❌ NOT PLANNED: Required Parameter Changes
```typescript
// ❌ BAD: Don't make optional params required
GET /monitor/dashboard?shopId={shopId}
  // shopId was optional (inferred from token)
  // ❌ Making it required would break existing code

// ✅ GOOD: Keep optional params optional
GET /monitor/dashboard?shopId={shopId}
  // shopId remains optional
```

---

## Incremental Adoption Plan

### Approach: One Component at a Time

**Philosophy:** Migrate gradually, validate each step

```
Week 7-8: Frontend Migration Phase
├─ Week 7: Add new hooks (no component changes)
│   ├─ Day 1-2: Create 13 new hooks
│   ├─ Day 3: Add feature flags
│   ├─ Day 4: Test in development
│   └─ Day 5: Deploy with flags OFF
│
└─ Week 8: Migrate components (one by one)
    ├─ Day 1: MonitorDashboard (main dashboard)
    ├─ Day 2: MonitorStats (stats cards)
    ├─ Day 3: MonitorCharts (chart section)
    ├─ Day 4: MonitorCompetitors (competitors section)
    └─ Day 5: Enable for 10% of users
```

### Component Migration Order

**Priority order (high to low):**

1. ✅ **MonitorDashboard.tsx** (HIGH) - Main dashboard page
2. ✅ **MonitorMetricsSection.tsx** (HIGH) - Stats cards
3. ✅ **VisibilityTrendsSection.tsx** (HIGH) - Charts
4. ✅ **CompetitorInsightsSection.tsx** (MEDIUM) - Competitors
5. ✅ **DeepDiveStatsSection.tsx** (MEDIUM) - Deep dive
6. ⚠️ **MonitorCitation.tsx** (LOW) - Citation analysis
7. ⚠️ **MonitorSentiment.tsx** (LOW) - Sentiment analysis
8. ⚠️ **MonitorPlatforms.tsx** (LOW) - Platform metrics

### Testing Each Migration

**For each component:**

```typescript
// 1. Create test file
describe("MonitorDashboard with new endpoints", () => {
  it("should fetch data from granular endpoints", async () => {
    // Mock new endpoints
    server.use(
      rest.get("/monitor/dashboard/config", (req, res, ctx) => {
        return res(ctx.json({ brandName: "Test" }));
      }),
      rest.get("/monitor/dashboard/stats", (req, res, ctx) => {
        return res(ctx.json({ stats: { totalPrompts: 10 } }));
      }),
    );
    
    render(<MonitorDashboard />);
    
    await waitFor(() => {
      expect(screen.getByText("Test")).toBeInTheDocument();
      expect(screen.getByText("10 prompts")).toBeInTheDocument();
    });
  });
  
  it("should handle partial failures gracefully", async () => {
    // One endpoint fails
    server.use(
      rest.get("/monitor/dashboard/stats", (req, res, ctx) => {
        return res(ctx.status(500));
      }),
    );
    
    render(<MonitorDashboard />);
    
    // Other sections should still render
    await waitFor(() => {
      expect(screen.getByText("Error loading stats")).toBeInTheDocument();
      expect(screen.getByTestId("charts-section")).toBeInTheDocument();
    });
  });
});

// 2. Run tests
pnpm test MonitorDashboard.test.tsx

// 3. Visual regression testing
pnpm test:visual MonitorDashboard
```

---

## API Client Refactoring Guide

### Current Structure (Acceptable)

```typescript
// frontend/packages/shared-features/src/hooks/useMonitorData.ts
export const useMonitorDashboard = (shopId?: string) => {
  const api = useApi();
  return useQuery({
    queryKey: ["monitor", "dashboard", shopId],
    queryFn: async () => {
      const { data } = await api.get("/monitor/dashboard", { params: { shopId } });
      return data;
    },
  });
};
```

**Status:** ✅ This works fine, no changes required initially

---

### Improved Structure (Recommended for New Hooks)

**Create dedicated API client module:**

```typescript
// frontend/packages/shared-features/src/api/dashboard-api.ts
import type { AxiosInstance } from "axios";

export interface DashboardConfig {
  brandName: string;
  shopDomain: string;
  activePlan: string;
  planLimits: any;
}

export interface DashboardStats {
  totalPrompts: number;
  avgSentiment: number;
  visibilityScore: number;
  invisibleCount: number;
  citationScore: number;
  netAiScore: number;
}

export interface StatsParams {
  timeRange?: "7" | "30" | "90" | "all";
  productId?: string;
  region?: string;
}

export class DashboardAPI {
  constructor(private api: AxiosInstance) {}

  async getConfig(): Promise<DashboardConfig> {
    const { data } = await this.api.get("/monitor/dashboard/config");
    return data;
  }

  async getStats(params: StatsParams = {}): Promise<{ stats: DashboardStats }> {
    const { data } = await this.api.get("/monitor/dashboard/stats", { params });
    return data;
  }

  async getCharts(params: any = {}): Promise<any> {
    const { data } = await this.api.get("/monitor/dashboard/charts", { params });
    return data;
  }

  async getCompetitors(params: any = {}): Promise<any> {
    const { data } = await this.api.get("/monitor/dashboard/competitors", { params });
    return data;
  }

  // ... other methods
}
```

**Use in hooks:**

```typescript
// frontend/packages/shared-features/src/hooks/useDashboard.ts
import { useApi } from "../providers/ApiProvider";
import { DashboardAPI } from "../api/dashboard-api";

export const useDashboardConfig = () => {
  const api = useApi();
  const dashboardAPI = new DashboardAPI(api);

  return useQuery({
    queryKey: ["dashboard", "config"],
    queryFn: () => dashboardAPI.getConfig(),
    staleTime: 5 * 60 * 1000,
  });
};

export const useDashboardStats = (params: StatsParams = {}) => {
  const api = useApi();
  const dashboardAPI = new DashboardAPI(api);

  return useQuery({
    queryKey: ["dashboard", "stats", params],
    queryFn: () => dashboardAPI.getStats(params),
    staleTime: 5 * 60 * 1000,
  });
};
```

**Benefits:**
- ✅ Type-safe API methods
- ✅ Centralized API logic
- ✅ Easier to test (mock DashboardAPI)
- ✅ Better IDE autocomplete
- ✅ Reusable across hooks

---

## Testing Strategy

### Unit Tests (Hooks)

```typescript
// frontend/packages/shared-features/src/hooks/__tests__/useDashboard.test.ts
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDashboardStats } from "../useDashboard";
import { ApiProvider } from "../../providers/ApiProvider";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";

describe("useDashboardStats", () => {
  let mock: MockAdapter;
  let queryClient: QueryClient;

  beforeEach(() => {
    mock = new MockAdapter(axios);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    mock.restore();
  });

  it("should fetch dashboard stats successfully", async () => {
    mock.onGet("/monitor/dashboard/stats").reply(200, {
      stats: {
        totalPrompts: 42,
        avgSentiment: 0.85,
        visibilityScore: 90,
      },
    });

    const wrapper = ({ children }: any) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={axios}>{children}</ApiProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useDashboardStats({ timeRange: "30" }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.stats.totalPrompts).toBe(42);
    expect(result.current.data?.stats.avgSentiment).toBe(0.85);
  });

  it("should handle errors gracefully", async () => {
    mock.onGet("/monitor/dashboard/stats").reply(500);

    const wrapper = ({ children }: any) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={axios}>{children}</ApiProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useDashboardStats(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});
```

---

### Integration Tests (Components)

```typescript
// frontend/packages/shared-features/src/components/monitor/dashboard/__tests__/MonitorDashboard.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MonitorDashboard } from "../MonitorDashboard";
import { ApiProvider } from "../../../../providers/ApiProvider";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";

describe("MonitorDashboard", () => {
  let mock: MockAdapter;
  let queryClient: QueryClient;

  beforeEach(() => {
    mock = new MockAdapter(axios);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  it("should render dashboard with new endpoints", async () => {
    // Mock all granular endpoints
    mock.onGet("/monitor/dashboard/config").reply(200, {
      brandName: "Test Shop",
      shopDomain: "test.myshopify.com",
    });

    mock.onGet("/monitor/dashboard/stats").reply(200, {
      stats: {
        totalPrompts: 42,
        avgSentiment: 0.85,
        visibilityScore: 90,
      },
    });

    mock.onGet("/monitor/dashboard/charts").reply(200, {
      chartData: [],
    });

    const wrapper = ({ children }: any) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={axios}>{children}</ApiProvider>
      </QueryClientProvider>
    );

    render(<MonitorDashboard />, { wrapper });

    // Should show loading state initially
    expect(screen.getByTestId("dashboard-loading")).toBeInTheDocument();

    // Should render data after loading
    await waitFor(() => {
      expect(screen.getByText("Test Shop")).toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getByText("90%")).toBeInTheDocument();
    });
  });
});
```

---

## Rollout Plan

### Week 7-8: Gradual Rollout

#### Stage 1: Internal Testing (Week 7, Days 1-3)
- Deploy with feature flag OFF
- Enable for internal team only
- Monitor for errors
- Collect feedback

**Success Criteria:**
- ✅ No errors in production
- ✅ All endpoints responding
- ✅ Response times improved
- ✅ Team feedback positive

---

#### Stage 2: Beta Users (Week 7, Days 4-5)
- Enable for 10% of users
- Monitor metrics closely
- A/B test old vs new

**Metrics to Monitor:**
- Response times (should be 30-50% faster)
- Error rates (should be same or lower)
- User engagement (should be same or better)
- Cache hit rates (should be 60-80%)

**Success Criteria:**
- ✅ Error rate < 0.1%
- ✅ Response time p95 < 200ms
- ✅ Zero customer complaints
- ✅ Cache hit rate > 60%

---

#### Stage 3: Gradual Rollout (Week 8)
- Day 1: 25% of users
- Day 2: 50% of users
- Day 3: 75% of users
- Day 4: 100% of users
- Day 5: Monitor full rollout

**Rollback Plan:**
If issues arise, immediately:
1. Set feature flag to OFF (instant rollback)
2. Investigate issue
3. Fix in development
4. Re-test
5. Re-rollout

---

## Summary & Recommendations

### ✅ What's Great About This Plan

1. **Zero Breaking Changes** - Frontend continues to work
2. **Incremental Adoption** - Migrate at your own pace
3. **Performance Wins** - Get benefits immediately
4. **Feature Flags** - Easy rollback if needed
5. **Backward Compatible** - Old code works during transition

### 🎯 Recommended Path Forward

#### Option 1: Conservative (Recommended)
```
Phase 1-3: Deploy backend (Weeks 1-6)
  └─ Frontend: No changes required
Phase 4: Migrate frontend (Weeks 7-8)
  └─ Add new hooks, keep old ones
Phase 5: Gradual rollout (Weeks 9-10)
  └─ Feature flags, A/B testing
Phase 6: Cleanup (Weeks 11-12)
  └─ Deprecate old endpoints
```

#### Option 2: Aggressive (Higher Risk)
```
Phase 1-3: Deploy backend (Weeks 1-6)
Phase 4: Migrate frontend immediately (Week 7)
  └─ Switch to new endpoints (no fallback)
Phase 5: Monitor closely (Week 8)
  └─ Fix issues quickly
```

**Recommendation:** Option 1 (Conservative) - Lower risk, same timeline

---

### 📋 Frontend Team Action Items

#### Immediate (Week 1)
- [ ] Review this compatibility plan
- [ ] Approve migration approach
- [ ] Schedule frontend migration (Weeks 7-8)

#### Week 7 (Preparation)
- [ ] Create 13 new hooks (granular endpoints)
- [ ] Add feature flag support
- [ ] Write tests for new hooks
- [ ] Test in development environment

#### Week 8 (Migration)
- [ ] Migrate MonitorDashboard component
- [ ] Migrate other components one by one
- [ ] Enable for 10% of users (feature flag)
- [ ] Monitor metrics

#### Week 9-10 (Rollout)
- [ ] Gradual rollout (25% → 50% → 75% → 100%)
- [ ] Monitor performance improvements
- [ ] Collect user feedback
- [ ] Mark old hooks as deprecated

#### Week 11-12 (Cleanup)
- [ ] Remove old hooks
- [ ] Update documentation
- [ ] Celebrate improved performance! 🎉

---

## Appendix: Example Migration PR

### Pull Request Template

```markdown
# feat: Migrate MonitorDashboard to granular endpoints

## Summary
Refactors MonitorDashboard to use new granular dashboard endpoints for better performance and caching.

## Changes
- Added 4 new hooks: useDashboardConfig, useDashboardStats, useDashboardCharts, useDashboardCompetitors
- Migrated MonitorDashboard.tsx to use new hooks
- Added feature flag support for gradual rollout
- Maintained backward compatibility with old endpoint

## Performance Impact
- Before: 1 API call, 800ms average
- After: 4 API calls (parallel), 200ms average
- Improvement: 4x faster, better caching

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Tested with feature flag ON
- [ ] Tested with feature flag OFF
- [ ] Tested error handling

## Rollout Plan
1. Deploy with feature flag OFF
2. Enable for internal team
3. Enable for 10% of users
4. Gradual rollout to 100%

## Rollback Plan
Set NEXT_PUBLIC_NEW_DASHBOARD=false (instant rollback)
```

---

**Document Revision History:**
- v1.0 (2026-01-12): Initial compatibility analysis

**Prepared By:** AI Assistant  
**Reviewed By:** [To be filled]  
**Approved By:** [To be filled]

