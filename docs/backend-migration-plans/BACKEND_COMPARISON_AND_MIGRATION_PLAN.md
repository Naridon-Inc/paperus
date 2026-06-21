# Backend Architecture Comparison & Migration Plan

**Date:** January 12, 2026  
**Version:** 1.0  
**Status:** Draft

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Comparison](#architecture-comparison)
3. [Key Differences](#key-differences)
4. [Gap Analysis](#gap-analysis)
5. [Migration Strategy](#migration-strategy)
6. [Implementation Plan](#implementation-plan)
7. [Risk Assessment](#risk-assessment)
8. [Success Criteria](#success-criteria)

---

## Executive Summary

This document compares the current production backend (`/backend/`) with the reference implementation from the GitHub repository (`temp/migrate-to-ts` branch at `/temp_reference/backend/`) and provides a comprehensive migration plan.

### Key Findings

**Current Backend Status:**
- ✅ Working production system with monitoring features
- ✅ Multi-platform support (Shopify, WooCommerce, BigCommerce, Shopware)
- ✅ Complete billing and optimization domains
- ⚠️ Monolithic dashboard endpoint structure
- ⚠️ Mixed architectural patterns in delivery layer
- ⚠️ Limited domain value objects for monitoring

**Reference Backend Status:**
- ✅ Clean DDD architecture with clear layer separation
- ✅ Granular dashboard endpoints (13+ focused endpoints)
- ✅ Rich domain modeling with value objects
- ✅ Comprehensive use case implementations
- ✅ Better TypeBox/Zod integration
- ⚠️ Focused primarily on Shopify platform
- ⚠️ Missing some production features (billing, multi-platform)

### Recommendation

**Adopt a hybrid approach:** Migrate monitoring domain architecture from reference while preserving current production features for billing, optimization, and multi-platform support.

---

## Architecture Comparison

### 1. Project Structure

#### Current Backend (`/backend/`)
```
backend/
├── application/
│   └── common/
│       ├── billing/          ✅ Production feature
│       ├── monitoring/       ⚠️ Needs refactoring
│       ├── optimization/     ✅ Production feature
│       └── shop/             ✅ Production feature
├── delivery/
│   ├── api/                  ⚠️ Monolithic structure
│   ├── common/               ⚠️ Minimal implementation
│   └── platform/             ✅ Multi-platform support
│       ├── bigcommerce/
│       ├── shopify/
│       ├── shopware/
│       └── woocommerce/
├── domain/
│   ├── billing/              ✅ Production domain
│   ├── monitoring/           ⚠️ Incomplete domain model
│   ├── optimization/         ✅ Production domain
│   ├── organization/         ✅ Production domain
│   └── shop/                 ✅ Production domain
├── infrastructure/
│   ├── database/             ✅ Comprehensive repositories
│   ├── external/             ✅ Search API adapter
│   ├── jobs/                 ✅ QStash scheduler
│   └── optimize/             ✅ AI agents & rules
└── libs/                     ✅ Shared libraries
```

#### Reference Backend (`/temp_reference/backend/`)
```
temp_reference/backend/
├── application/
│   ├── app-shopify/          ✅ Platform-specific app layer
│   └── common/
│       ├── monitoring/       ✅✅ Rich use cases
│       │   ├── commands/     ✅ Query/command objects
│       │   ├── competitor/   ✅ Competitor analysis
│       │   └── use-cases/    ✅✅ 38+ use cases
│       │       ├── analysis/ (4 use cases)
│       │       ├── competitors/ (1 use case)
│       │       ├── dashboard/ (11 use cases)
│       │       ├── personas/ (4 use cases)
│       │       ├── products/ (1 use case)
│       │       ├── prompts/ (4 use cases)
│       │       ├── signals/ (2 use cases)
│       │       └── watchlist/ (3 use cases)
│       └── shop/             ✅ Shop management
├── delivery/
│   ├── api-shopify/          ✅ Clean API structure
│   └── common/               ✅✅ Shared routes
│       └── routes/           ✅✅ Modular endpoints
│           ├── analysis/     (4 routes)
│           ├── competitors/  (1 route)
│           ├── dashboard/    (11 routes)
│           ├── personas/     (1 route)
│           ├── products/     (1 route)
│           ├── prompts/      (1 route)
│           ├── signals/      (1 route)
│           └── watchlist/    (1 route)
├── domain/
│   ├── compliance/           ✅ GDPR compliance
│   ├── monitoring/           ✅✅ Rich domain model
│   │   ├── entities/         ✅ MonitoringRun, Persona, TopicRanking
│   │   ├── repositories/     ✅ Interface definitions
│   │   ├── services/         ✅ StatisticsCalculator, TrendAnalyzer
│   │   └── value-objects/    ✅✅ Chart, DataPoint, Stat, TimeRange, SourceType
│   └── shop/                 ✅ Shop domain
├── infrastructure/
│   ├── database/
│   │   └── repositories/
│   │       └── monitoring/   ✅✅ Complete implementations
│   ├── events/               ✅ Event publisher
│   └── optimize/             ✅ Same as current
└── libs/                     ✅ Shared libraries
```

### 2. Workspace Configuration

#### Current Backend
```json
{
  "workspaces": [
    "libs/db",
    "libs/platform/base",
    "libs/platform/shopify",
    "libs/platform/shopware",  // ✅ Multi-platform
    "libs/shared",
    "libs/ai",
    "libs/restapi",
    "domain",
    "application/common",
    "infrastructure",
    "delivery/common",
    "delivery/api",
    "delivery/platform/shopify",
    "delivery/platform/shopware"  // ✅ Multi-platform
  ]
}
```

#### Reference Backend
```json
{
  "workspaces": [
    "libs/db",
    "libs/platform",
    "libs/shared",
    "libs/ai",
    "libs/restapi",
    "domain",
    "application/common",
    "application/app-shopify",  // ✅ Shopify-specific app layer
    "infrastructure",
    "interface"
  ]
}
```

**Analysis:** Current has better multi-platform support structure, reference has cleaner Shopify-focused architecture.

---

## Key Differences

### 1. Dashboard Endpoints Architecture

#### Current Implementation (Monolithic)
- **Single Endpoint:** `/api/v1/monitor/dashboard`
- **Returns:** 15+ different data types in one response
- **Problems:**
  - Frontend loads unnecessary data
  - Difficult to cache effectively
  - Hard to maintain and test
  - Violates Single Responsibility Principle
  - No granular rate limiting

**Example current route:**
```typescript
// delivery/api/src/routes/monitor.ts
fastify.get("/dashboard", async (req, reply) => {
  // Returns everything at once:
  // - stats, signals, competitors, topics, charts,
  // - sources, products, personas, citations, etc.
  const useCase = new GetDashboardDataUseCase(/* many repos */);
  const result = await useCase.execute({ shopId });
  return reply.send(result);
});
```

#### Reference Implementation (Granular)
- **13 Focused Endpoints:**
  1. `/api/monitor/dashboard/config` - Shop configuration
  2. `/api/monitor/dashboard/stats` - Global statistics
  3. `/api/monitor/dashboard/charts` - Visualization data
  4. `/api/monitor/dashboard/trends` - Share of voice trends
  5. `/api/monitor/dashboard/competitors` - Competitor metrics
  6. `/api/monitor/dashboard/insights` - Deep competitor analysis
  7. `/api/monitor/dashboard/sources` - Source analysis (ChatGPT, Perplexity)
  8. `/api/monitor/dashboard/topics` - Topic rankings
  9. `/api/monitor/dashboard/citations` - Citation analysis
  10. `/api/monitor/dashboard/deep-dive` - Detailed metrics
  11. `/api/monitor/dashboard/personas` - User personas
  12. `/api/monitor/products` - Paginated products (separate)
  13. Additional analysis endpoints

**Benefits:**
- ✅ Better caching opportunities
- ✅ Parallel frontend loading
- ✅ Granular rate limiting
- ✅ Easier to maintain and test
- ✅ Clear separation of concerns
- ✅ Smaller response payloads

**Example reference route:**
```typescript
// delivery/common/src/routes/dashboard/dashboard-stats.route.ts
export async function dashboardStatsRoute(
  fastify: NaridonFastifyInstance,
  options: DashboardStatsRouteOptions,
): Promise<void> {
  fastify.get<{ Querystring: StatsQuery }>(
    "/api/monitor/dashboard/stats",
    {
      schema: {
        description: "Get aggregated global statistics",
        tags: ["Dashboard"],
        querystring: StatsQuerySchema,  // TypeBox for Swagger
        response: {
          200: StatsResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const shopId = await getShopId(request.shop);
      const query = parseStatsQuery({ shopId, ...request.query });
      const useCase = new GetGlobalStatsUseCase(monitoringRepository);
      const result = await useCase.execute(query);
      return reply.send(result);
    },
  );
}
```

### 2. Domain Layer Architecture

#### Current Domain (`/backend/domain/src/monitoring/`)
```
monitoring/
├── competitor/
│   ├── entities/competitor.ts
│   ├── repositories/competitor-repository.ts
│   └── value-objects/competitor-strength.ts
├── personas/
│   ├── persona.ts
│   └── persona-repository.ts
├── prompts/
│   ├── entities/prompt.ts, run.ts
│   └── repositories/
├── run/
│   ├── entities/run.ts
│   └── repositories/run-repository.ts
└── smart-signal/
    ├── entities/smart-signal.ts
    ├── repositories/smart-signal-repository.ts
    └── value-objects/
        ├── signal-severity.ts
        ├── signal-status.ts
        └── signal-type.ts
```

**Missing:**
- ❌ TimeRange value object (hardcoded logic scattered)
- ❌ SourceType value object (string comparisons everywhere)
- ❌ DataPoint value object (raw objects in use cases)
- ❌ Stat value object (inconsistent stat structures)
- ❌ Chart value object (no domain model for charts)
- ❌ TopicRanking entity
- ❌ MonitoringRun entity (uses generic Run)
- ❌ Domain services (StatisticsCalculator, TrendAnalyzer)

#### Reference Domain (`/temp_reference/backend/domain/src/monitoring/`)
```
monitoring/
├── entities/
│   ├── monitoring-run.ts       ✅ Specialized run entity
│   ├── persona.ts              ✅ Enhanced persona
│   └── topic-ranking.ts        ✅ Topic analysis entity
├── repositories/
│   ├── monitoring-repository.ts     ✅ Comprehensive interface
│   ├── persona-repository.ts
│   └── topic-repository.ts
├── services/
│   ├── statistics-calculator.ts     ✅ Pure calculation logic
│   └── trend-analyzer.ts            ✅ Trend detection logic
└── value-objects/
    ├── chart.ts                ✅ Chart domain model
    ├── data-point.ts           ✅ Time series data
    ├── source-type.ts          ✅ AI source abstraction
    ├── stat.ts                 ✅ Statistics model
    └── time-range.ts           ✅ Time filtering logic
```

**Benefits:**
- ✅ Domain logic encapsulated in value objects
- ✅ Reusable across use cases
- ✅ Type-safe operations
- ✅ Testable in isolation
- ✅ Self-documenting code

**Example value object:**
```typescript
// domain/src/monitoring/value-objects/time-range.ts
export class TimeRange {
  static getStartDate(range: "7" | "30" | "90" | "all"): Date | null {
    if (range === "all") return null;
    const days = parseInt(range);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  static getEndDate(): Date {
    return new Date();
  }
}
```

### 3. Application Layer (Use Cases)

#### Current Application (`/backend/application/common/src/monitoring/`)
```
monitoring/
├── analysis/
│   ├── intelligence-service.ts
│   ├── real-trio-analysis-service.ts
│   ├── social-analysis-service.ts
│   └── social-detection.ts
├── competitor/
│   ├── analyze-competitors-service.ts
│   ├── analyze-gap-use-case.ts
│   ├── deep-analysis-service.ts
│   ├── get-active-competitor-signals-use-case.ts
│   ├── get-competitors-use-case.ts
│   ├── get-urgent-signals-use-case.ts
│   ├── run-deep-analysis-use-case.ts
│   └── run-gap-analysis-use-case.ts
├── personas/
│   ├── create-persona-use-case.ts
│   └── get-personas-use-case.ts
├── prompts/
│   ├── ai-prompt-generator.ts
│   ├── create-prompt.use-case.ts
│   ├── delete-prompt.use-case.ts
│   ├── generate-prompts.use-case.ts
│   ├── get-prompt-details.use-case.ts
│   ├── get-prompts.use-case.ts
│   └── update-prompt.use-case.ts
├── get-dashboard-data.use-case.ts  ⚠️ Monolithic
├── get-products-use-case.ts
└── run-analysis.use-case.ts
```

**Issues:**
- ⚠️ Single monolithic `GetDashboardDataUseCase`
- ⚠️ Limited command/query pattern usage
- ⚠️ No dedicated dashboard use cases
- ⚠️ Missing analysis use cases

#### Reference Application (`/temp_reference/backend/application/common/src/monitoring/`)
```
monitoring/
├── commands/                    ✅ Query/command objects
│   ├── charts-query.ts
│   ├── dashboard-query.ts
│   ├── deep-dive-query.ts
│   ├── products-query.ts
│   └── stats-query.ts
├── competitor/                  ✅ Same as current
├── use-cases/
│   ├── analysis/                ✅ NEW: Analysis use cases
│   │   ├── get-citation-analysis-use-case.ts
│   │   ├── get-external-mentions-use-case.ts
│   │   ├── get-platform-metrics-use-case.ts
│   │   └── get-sentiment-analysis-use-case.ts
│   ├── competitors/
│   │   └── get-competitors-use-case.ts
│   ├── dashboard/               ✅✅ NEW: 11 focused use cases
│   │   ├── get-citation-data-use-case.ts
│   │   ├── get-competitor-insights-use-case.ts
│   │   ├── get-dashboard-charts-use-case.ts
│   │   ├── get-dashboard-competitors-use-case.ts
│   │   ├── get-dashboard-config-use-case.ts
│   │   ├── get-dashboard-trends-use-case.ts
│   │   ├── get-deep-dive-stats-use-case.ts
│   │   ├── get-global-stats-use-case.ts
│   │   ├── get-sources-analysis-use-case.ts
│   │   ├── get-topic-rankings-use-case.ts
│   │   └── get-visibility-trend-use-case.ts
│   ├── personas/                ✅ Enhanced CRUD
│   │   ├── create-persona-use-case.ts
│   │   ├── delete-persona-use-case.ts
│   │   ├── get-personas-use-case.ts
│   │   └── update-persona-use-case.ts
│   ├── products/
│   │   └── get-products-use-case.ts
│   ├── prompts/
│   │   ├── get-prompt-details-use-case.ts
│   │   ├── get-prompts-use-case.ts
│   │   └── update-prompt-use-case.ts
│   ├── signals/                 ✅ NEW: Signal management
│   │   ├── get-signals-use-case.ts
│   │   └── update-signal-status-use-case.ts
│   └── watchlist/               ✅ NEW: Watchlist feature
│       ├── add-to-watchlist-use-case.ts
│       ├── get-watchlist-entries-use-case.ts
│       └── remove-from-watchlist-use-case.ts
```

**Benefits:**
- ✅ Each use case has single responsibility
- ✅ Command/query pattern for validation
- ✅ TypeBox (routes) + Zod (use cases) validation
- ✅ Easier to test and maintain
- ✅ Clear data flow

**Example command/query pattern:**
```typescript
// application/common/src/monitoring/commands/stats-query.ts
import { z } from "zod";

export const StatsQuerySchema = z.object({
  shopId: z.string().uuid(),
  timeRange: z.enum(["7", "30", "90", "all"]).default("30"),
  productId: z.string().optional(),
  region: z.string().optional(),
});

export type StatsQuery = z.infer<typeof StatsQuerySchema>;

export const parseStatsQuery = (data: unknown): StatsQuery => {
  return StatsQuerySchema.parse(data);
};
```

### 4. Delivery Layer (Routes)

#### Current Delivery (`/backend/delivery/api/src/routes/`)
```
routes/
├── billing.ts
├── cron.ts
├── debug.ts
├── embed.ts
├── monitor.ts           ⚠️ Monolithic (510 lines)
├── onboarding.ts
├── optimization.ts
├── personas.ts
├── prompts.ts
├── settings.ts
└── workers.ts
```

**`monitor.ts` structure:**
- ⚠️ All monitoring routes in one file
- ⚠️ Direct repository usage in routes
- ⚠️ Limited schema definitions
- ⚠️ Type.Any() used extensively

#### Reference Delivery (`/temp_reference/backend/delivery/`)
```
delivery/
├── api-shopify/           ✅ Platform-specific entry point
│   └── src/
│       ├── constants/
│       │   └── plan-constants.ts
│       ├── routes/
│       │   ├── auth.routes.ts
│       │   ├── monitoring.routes.ts  (imports common routes)
│       │   └── webhooks.routes.ts
│       ├── schemas/
│       │   └── common.schemas.ts
│       └── services/
│           ├── product-data-access.ts
│           ├── shop-data-access.ts
│           └── shop-id-resolver.ts
└── common/                ✅ Shared route implementations
    └── src/
        └── routes/
            ├── analysis/        (4 route files)
            ├── competitors/     (1 route file)
            ├── dashboard/       (11 route files)
            ├── personas/        (1 route file)
            ├── products/        (1 route file)
            ├── prompts/         (1 route file)
            ├── signals/         (1 route file)
            └── watchlist/       (1 route file)
```

**Benefits:**
- ✅ Clear separation: platform-specific vs. shared
- ✅ One file per endpoint group
- ✅ Full TypeBox schemas for Swagger
- ✅ Dependency injection pattern
- ✅ Consistent error handling

**Example route structure:**
```typescript
// delivery/common/src/routes/dashboard/dashboard-config.route.ts
export interface DashboardConfigRouteOptions {
  shopRepository: IShopRepository;
  getShopId: (shopDomain: string) => Promise<string>;
}

export async function dashboardConfigRoute(
  fastify: NaridonFastifyInstance,
  options: DashboardConfigRouteOptions,
): Promise<void> {
  // Route implementation with full schema
}
```

### 5. Infrastructure Layer

#### Current Infrastructure
```
infrastructure/src/
├── database/
│   ├── repositories/
│   │   ├── monitoring/
│   │   │   ├── competitor-repository-impl.ts
│   │   │   ├── persona-repository-impl.ts
│   │   │   ├── prompts/
│   │   │   │   └── prompt-repository-impl.ts
│   │   │   ├── run/
│   │   │   │   └── run-repository-impl.ts
│   │   │   └── smart-signal-repository-impl.ts
│   │   ├── optimization/
│   │   ├── organization/
│   │   └── shop/
│   └── schema/          ✅ Comprehensive Prisma schema
├── external/
│   └── searchapi-adapter.ts
├── jobs/
│   ├── qstash-adapter.ts
│   └── qstash-scheduler-adapter.ts
├── optimize/            ✅ Production optimization rules
└── platform/
    ├── shopify-billing-adapter.ts
    └── shopify-content-adapter.ts
```

**Status:** ✅ Complete and production-ready

#### Reference Infrastructure
```
infrastructure/src/
├── database/
│   └── repositories/
│       ├── compliance/
│       │   └── compliance-repository-impl.ts
│       ├── monitoring/
│       │   ├── competitor-repository-impl.ts
│       │   ├── monitoring-repository-impl.ts  ✅ NEW
│       │   ├── persona-repository-impl.ts
│       │   ├── smart-signal-repository-impl.ts
│       │   └── topic-repository-impl.ts       ✅ NEW
│       └── shop/
├── events/              ✅ Event publisher pattern
│   ├── event-publisher-impl.ts
│   └── event-publisher.ts
└── optimize/            ✅ Same as current
```

**Key Addition:**
```typescript
// infrastructure/src/database/repositories/monitoring/monitoring-repository-impl.ts
export class MonitoringRepositoryImpl implements IMonitoringRepository {
  // Comprehensive implementation with:
  // - findRunsByShop with advanced filtering
  // - getGlobalStats with aggregations
  // - getShareOfVoiceTrend with time series
  // - getCompetitorInsights with analytics
  // - getSourceAnalysis with grouping
  // - getTopicRankings with ranking logic
  // - getCitationData with citation analysis
  // - Many more specialized queries...
}
```

---

## Gap Analysis

### Features in Current Backend NOT in Reference

| Feature | Location | Status | Migration Strategy |
|---------|----------|--------|-------------------|
| **Billing Domain** | `domain/billing/`, `application/common/src/billing/` | ✅ Production | **KEEP**: Essential production feature |
| **Optimization Domain** | `domain/optimization/`, `application/common/src/optimization/` | ✅ Production | **KEEP**: Essential production feature |
| **Organization Domain** | `domain/organization/` | ✅ Production | **KEEP**: Multi-tenant support |
| **Multi-Platform Support** | `delivery/platform/{bigcommerce,shopware,woocommerce}` | ✅ Production | **KEEP**: Business requirement |
| **QStash Scheduler** | `infrastructure/jobs/` | ✅ Production | **KEEP**: Background jobs |
| **Search API Adapter** | `infrastructure/external/searchapi-adapter.ts` | ✅ Production | **KEEP**: External integration |
| **Usage Tracking** | `domain/shop/entities/usage-ledger.ts` | ✅ Production | **KEEP**: Billing dependency |

### Features in Reference Backend NOT in Current

| Feature | Location | Priority | Migration Strategy |
|---------|----------|----------|-------------------|
| **Split Dashboard Endpoints** | `delivery/common/src/routes/dashboard/` | 🔴 HIGH | **MIGRATE**: Core improvement |
| **Domain Value Objects** | `domain/monitoring/value-objects/` | 🔴 HIGH | **MIGRATE**: Better modeling |
| **Domain Services** | `domain/monitoring/services/` | 🔴 HIGH | **MIGRATE**: Business logic |
| **Dashboard Use Cases** | `application/common/src/monitoring/use-cases/dashboard/` | 🔴 HIGH | **MIGRATE**: Core improvement |
| **Analysis Use Cases** | `application/common/src/monitoring/use-cases/analysis/` | 🟡 MEDIUM | **MIGRATE**: Enhanced features |
| **Signals Use Cases** | `application/common/src/monitoring/use-cases/signals/` | 🟡 MEDIUM | **MIGRATE**: Signal management |
| **Watchlist Feature** | `application/common/src/monitoring/use-cases/watchlist/` | 🟢 LOW | **CONSIDER**: Nice to have |
| **Command/Query Objects** | `application/common/src/monitoring/commands/` | 🔴 HIGH | **MIGRATE**: Better validation |
| **MonitoringRepository** | `infrastructure/src/database/repositories/monitoring/monitoring-repository-impl.ts` | 🔴 HIGH | **MIGRATE**: Comprehensive queries |
| **TopicRepository** | `infrastructure/src/database/repositories/monitoring/topic-repository-impl.ts` | 🟡 MEDIUM | **MIGRATE**: Topic analysis |
| **Event Publisher** | `infrastructure/src/events/` | 🟢 LOW | **CONSIDER**: Event-driven arch |
| **Compliance Domain** | `domain/compliance/` | 🟡 MEDIUM | **MIGRATE**: GDPR compliance |
| **Shopify App Layer** | `application/app-shopify/` | 🟢 LOW | **CONSIDER**: Platform separation |

### Architecture Quality Comparison

| Aspect | Current | Reference | Winner |
|--------|---------|-----------|--------|
| **DDD Adherence** | 6/10 | 9/10 | 🏆 Reference |
| **Layer Separation** | 7/10 | 9/10 | 🏆 Reference |
| **Domain Modeling** | 6/10 | 9/10 | 🏆 Reference |
| **Use Case Design** | 6/10 | 9/10 | 🏆 Reference |
| **API Design** | 5/10 | 9/10 | 🏆 Reference |
| **Type Safety** | 8/10 | 9/10 | 🏆 Reference |
| **Testability** | 7/10 | 9/10 | 🏆 Reference |
| **Multi-Platform** | 9/10 | 5/10 | 🏆 Current |
| **Production Features** | 10/10 | 7/10 | 🏆 Current |
| **Business Logic** | 9/10 | 7/10 | 🏆 Current |

**Overall Assessment:** Reference has superior architecture, Current has more complete features.

---

## Migration Strategy

### Philosophy: Incremental Hybrid Approach

**Goal:** Adopt reference architecture patterns while preserving production features.

**Principles:**
1. ✅ **No Big Bang:** Migrate incrementally, feature by feature
2. ✅ **Feature Flags:** New endpoints behind flags initially
3. ✅ **Parallel Running:** Run old and new simultaneously
4. ✅ **Data Compatibility:** No database schema changes initially
5. ✅ **Preserve Production:** Keep all working features
6. ✅ **Add, Don't Replace:** Enhance rather than rewrite

### Migration Phases

```
Phase 1: Foundation (Week 1-2)
  ├─ Domain value objects
  ├─ Domain services
  ├─ Command/query objects
  └─ Test infrastructure

Phase 2: Core Use Cases (Week 3-4)
  ├─ Dashboard use cases
  ├─ Analysis use cases
  └─ Repository implementations

Phase 3: API Layer (Week 5-6)
  ├─ Split dashboard endpoints
  ├─ Route refactoring
  └─ Schema definitions

Phase 4: Integration (Week 7-8)
  ├─ Frontend migration
  ├─ Performance testing
  └─ Gradual rollout

Phase 5: Cleanup (Week 9-10)
  ├─ Deprecate old endpoints
  ├─ Remove dead code
  └─ Documentation
```

---

## Implementation Plan

### Phase 1: Domain Foundation (Week 1-2)

**Objective:** Establish rich domain model for monitoring

#### Step 1.1: Create Domain Value Objects

**Files to create:**
```
backend/domain/src/monitoring/value-objects/
├── time-range.ts       (Port from reference)
├── source-type.ts      (Port from reference)
├── data-point.ts       (Port from reference)
├── stat.ts             (Port from reference)
├── chart.ts            (Port from reference)
└── index.ts
```

**Implementation:**
```typescript
// domain/src/monitoring/value-objects/time-range.ts
import { z } from "zod";

export const TimeRangeSchema = z.enum(["7", "30", "90", "all"]);
export type TimeRangeValue = z.infer<typeof TimeRangeSchema>;

export class TimeRange {
  private constructor(private readonly value: TimeRangeValue) {}

  static from(value: TimeRangeValue): TimeRange {
    return new TimeRange(TimeRangeSchema.parse(value));
  }

  static getStartDate(range: TimeRangeValue): Date | null {
    if (range === "all") return null;
    const days = parseInt(range);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  static getEndDate(): Date {
    return new Date();
  }

  getDays(): number | null {
    if (this.value === "all") return null;
    return parseInt(this.value);
  }

  toString(): string {
    return this.value;
  }
}
```

**Testing:**
```typescript
// domain/src/monitoring/value-objects/time-range.spec.ts
describe("TimeRange", () => {
  it("should calculate start date for 7 days", () => {
    const range = TimeRange.from("7");
    const startDate = TimeRange.getStartDate("7");
    expect(startDate).toBeDefined();
    // Assert 7 days ago
  });

  it("should return null for all time", () => {
    const range = TimeRange.from("all");
    const startDate = TimeRange.getStartDate("all");
    expect(startDate).toBeNull();
  });
});
```

#### Step 1.2: Create Domain Services

**Files to create:**
```
backend/domain/src/monitoring/services/
├── statistics-calculator.ts    (Port from reference)
├── trend-analyzer.ts           (Port from reference)
└── index.ts
```

**Example:**
```typescript
// domain/src/monitoring/services/statistics-calculator.ts
import { Stat } from "../value-objects/stat";
import { DataPoint } from "../value-objects/data-point";

/**
 * Pure domain service for statistical calculations.
 * No I/O, no side effects, just math.
 */
export class StatisticsCalculator {
  /**
   * Calculate share of voice percentage
   */
  calculateShareOfVoice(mentions: number, totalMentions: number): number {
    if (totalMentions === 0) return 0;
    return (mentions / totalMentions) * 100;
  }

  /**
   * Calculate average from data points
   */
  calculateAverage(dataPoints: DataPoint[]): number {
    if (dataPoints.length === 0) return 0;
    const sum = dataPoints.reduce((acc, dp) => acc + dp.value, 0);
    return sum / dataPoints.length;
  }

  /**
   * Calculate trend direction and magnitude
   */
  calculateTrend(dataPoints: DataPoint[]): {
    direction: "up" | "down" | "stable";
    percentage: number;
  } {
    if (dataPoints.length < 2) {
      return { direction: "stable", percentage: 0 };
    }

    const first = dataPoints[0].value;
    const last = dataPoints[dataPoints.length - 1].value;

    if (first === 0) {
      return { direction: last > 0 ? "up" : "stable", percentage: 0 };
    }

    const change = ((last - first) / first) * 100;

    if (Math.abs(change) < 5) {
      return { direction: "stable", percentage: change };
    }

    return {
      direction: change > 0 ? "up" : "down",
      percentage: Math.abs(change),
    };
  }

  /**
   * Create stat with comparison
   */
  createStat(
    label: string,
    current: number,
    previous: number,
  ): Stat {
    const change = current - previous;
    const changePercent = previous === 0 ? 0 : (change / previous) * 100;

    return Stat.create({
      label,
      value: current,
      change: changePercent,
      trend: change > 0 ? "up" : change < 0 ? "down" : "stable",
    });
  }
}
```

#### Step 1.3: Create Command/Query Objects

**Files to create:**
```
backend/application/common/src/monitoring/commands/
├── dashboard-query.ts
├── stats-query.ts
├── charts-query.ts
├── deep-dive-query.ts
├── products-query.ts
└── index.ts
```

**Example:**
```typescript
// application/common/src/monitoring/commands/stats-query.ts
import { z } from "zod";
import { TimeRangeSchema } from "@naridon/domain";

export const StatsQuerySchema = z.object({
  shopId: z.string().uuid(),
  timeRange: TimeRangeSchema.default("30"),
  productId: z.string().optional(),
  region: z.string().optional(),
});

export type StatsQuery = z.infer<typeof StatsQuerySchema>;

export const parseStatsQuery = (data: unknown): StatsQuery => {
  return StatsQuerySchema.parse(data);
};

// HTTP query schema for route validation (with coercion)
export const StatsHttpQuerySchema = z.object({
  timeRange: z
    .string()
    .refine((val) => ["7", "30", "90", "all"].includes(val), {
      message: "timeRange must be one of: 7, 30, 90, all",
    })
    .default("30"),
  productId: z.string().optional(),
  region: z.string().optional(),
});
```

**Tasks:**
- [ ] Create all 5 value objects
- [ ] Create 2 domain services
- [ ] Create 5 command/query objects
- [ ] Write unit tests for value objects
- [ ] Write unit tests for domain services
- [ ] Update domain index exports

**Estimated Time:** 5-7 days

---

### Phase 2: Use Cases & Repository (Week 3-4)

**Objective:** Implement use cases and repository methods

#### Step 2.1: Enhance Monitoring Repository

**File to update:**
```
backend/infrastructure/src/database/repositories/monitoring/
└── monitoring-repository-impl.ts  (Enhance existing or create new)
```

**Add methods from reference:**
```typescript
export class MonitoringRepositoryImpl implements IMonitoringRepository {
  // Existing methods...

  // NEW: Comprehensive dashboard queries
  async getGlobalStats(
    shopId: string,
    options?: MonitoringFilterOptions,
  ): Promise<GlobalStats> {
    // Port from reference implementation
  }

  async getShareOfVoiceTrend(
    shopId: string,
    options?: MonitoringFilterOptions,
  ): Promise<DataPoint[]> {
    // Port from reference implementation
  }

  async getCompetitorInsights(
    shopId: string,
    options?: MonitoringFilterOptions,
  ): Promise<CompetitorInsight[]> {
    // Port from reference implementation
  }

  async getSourceAnalysis(
    shopId: string,
    options?: MonitoringFilterOptions,
  ): Promise<SourceData[]> {
    // Port from reference implementation
  }

  async getTopicRankings(
    shopId: string,
    options?: MonitoringFilterOptions,
  ): Promise<TopicRanking[]> {
    // Port from reference implementation
  }

  async getCitationData(
    shopId: string,
    options?: MonitoringFilterOptions,
  ): Promise<CitationData> {
    // Port from reference implementation
  }
}
```

#### Step 2.2: Create Dashboard Use Cases

**Files to create:**
```
backend/application/common/src/monitoring/use-cases/dashboard/
├── get-dashboard-config-use-case.ts       (1)
├── get-global-stats-use-case.ts           (2)
├── get-visibility-trend-use-case.ts       (3)
├── get-dashboard-charts-use-case.ts       (4)
├── get-dashboard-trends-use-case.ts       (5)
├── get-dashboard-competitors-use-case.ts  (6)
├── get-competitor-insights-use-case.ts    (7)
├── get-sources-analysis-use-case.ts       (8)
├── get-topic-rankings-use-case.ts         (9)
├── get-citation-data-use-case.ts          (10)
├── get-deep-dive-stats-use-case.ts        (11)
└── index.ts
```

**Implementation order (simplest to most complex):**

**1. GetDashboardConfigUseCase** (Simplest - 30 mins)
```typescript
export class GetDashboardConfigUseCase {
  constructor(
    private readonly shopRepository: IShopRepository,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async execute(query: { shopId: string }): Promise<DashboardConfig> {
    const shop = await this.shopRepository.findById(query.shopId);
    if (!shop) throw new Error("Shop not found");

    const limits = await this.entitlementsService.getShopLimits(query.shopId);

    return {
      brandName: shop.name,
      shopDomain: shop.domain,
      activePlan: shop.planName,
      planLimits: limits,
    };
  }
}
```

**2. GetGlobalStatsUseCase** (Moderate - 2 hours)
```typescript
export class GetGlobalStatsUseCase {
  constructor(
    private readonly monitoringRepository: IMonitoringRepository,
    private readonly statsCalculator: StatisticsCalculator,
  ) {}

  async execute(query: StatsQuery): Promise<GlobalStatsResponse> {
    // Validate query
    const validated = parseStatsQuery(query);

    // Fetch data from repository
    const stats = await this.monitoringRepository.getGlobalStats(
      validated.shopId,
      {
        timeRange: validated.timeRange,
        productId: validated.productId,
        region: validated.region,
      },
    );

    // Apply domain logic
    return {
      stats: {
        totalPrompts: stats.totalPrompts,
        avgSentiment: this.statsCalculator.roundToDecimal(stats.avgSentiment, 2),
        visibilityScore: this.statsCalculator.calculateVisibilityScore(stats),
        invisibleCount: stats.invisibleCount,
        citationScore: this.statsCalculator.calculateCitationScore(stats),
        netAiScore: this.statsCalculator.calculateNetAiScore(stats),
      },
    };
  }
}
```

**Continue for all 11 use cases...**

#### Step 2.3: Create Analysis Use Cases

**Files to create:**
```
backend/application/common/src/monitoring/use-cases/analysis/
├── get-citation-analysis-use-case.ts
├── get-external-mentions-use-case.ts
├── get-platform-metrics-use-case.ts
├── get-sentiment-analysis-use-case.ts
└── index.ts
```

**Tasks:**
- [ ] Port monitoring repository methods
- [ ] Implement 11 dashboard use cases
- [ ] Implement 4 analysis use cases
- [ ] Write integration tests for use cases
- [ ] Write integration tests for repository

**Estimated Time:** 7-10 days

---

### Phase 3: API Routes (Week 5-6)

**Objective:** Create granular dashboard endpoints

#### Step 3.1: Create Delivery Common Routes

**Directory structure to create:**
```
backend/delivery/common/src/routes/
├── dashboard/
│   ├── dashboard-config.route.ts
│   ├── dashboard-stats.route.ts
│   ├── dashboard-charts.route.ts
│   ├── dashboard-trends.route.ts
│   ├── dashboard-competitors.route.ts
│   ├── dashboard-insights.route.ts
│   ├── dashboard-sources.route.ts
│   ├── dashboard-topics.route.ts
│   ├── dashboard-citations.route.ts
│   ├── dashboard-deep-dive.route.ts
│   ├── dashboard-personas.route.ts
│   └── index.ts
├── analysis/
│   ├── citations.route.ts
│   ├── mentions.route.ts
│   ├── platforms.route.ts
│   ├── sentiment.route.ts
│   └── index.ts
├── monitoring-routes.ts
└── index.ts
```

**Example route implementation:**
```typescript
// delivery/common/src/routes/dashboard/dashboard-stats.route.ts
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  GetGlobalStatsUseCase,
  parseStatsQuery,
} from "@naridon/application-common";
import { IMonitoringRepository } from "@naridon/domain";
import { NaridonFastifyInstance } from "@naridon/restapi";

const StatsQuerySchema = Type.Object({
  timeRange: Type.Union([
    Type.Literal("7"),
    Type.Literal("30"),
    Type.Literal("90"),
    Type.Literal("all"),
  ], { default: "30" }),
  productId: Type.Optional(Type.String()),
  region: Type.Optional(Type.String()),
});

const StatsResponseSchema = Type.Object({
  stats: Type.Object({
    totalPrompts: Type.Number(),
    avgSentiment: Type.Number(),
    visibilityScore: Type.Number(),
    invisibleCount: Type.Number(),
    citationScore: Type.Number(),
    netAiScore: Type.Number(),
  }),
});

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
});

type StatsQuery = Static<typeof StatsQuerySchema>;

export interface DashboardStatsRouteOptions {
  monitoringRepository: IMonitoringRepository;
  getShopId: (shopDomain: string) => Promise<string>;
}

export async function dashboardStatsRoute(
  fastify: NaridonFastifyInstance,
  options: DashboardStatsRouteOptions,
): Promise<void> {
  const { monitoringRepository, getShopId } = options;

  fastify.get<{ Querystring: StatsQuery }>(
    "/api/monitor/dashboard/stats",
    {
      schema: {
        description: "Get aggregated global statistics",
        tags: ["Dashboard"],
        querystring: StatsQuerySchema,
        response: {
          200: StatsResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: StatsQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const shopDomain = request.shop;
        const shopId = await getShopId(shopDomain);

        const query = parseStatsQuery({
          shopId,
          ...request.query,
        });

        const useCase = new GetGlobalStatsUseCase(monitoringRepository);
        const result = await useCase.execute(query);

        return reply.send(result);
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );
}
```

#### Step 3.2: Register Routes in API

**Update:**
```typescript
// delivery/api/src/index.ts
import { dashboardStatsRoute } from "@naridon/delivery-common";

// Register new routes with feature flag
if (process.env.ENABLE_NEW_DASHBOARD_ENDPOINTS === "true") {
  await dashboardStatsRoute(app, {
    monitoringRepository,
    getShopId: shopIdResolver.resolve,
  });
  // Register other routes...
}

// Keep old route for backward compatibility
await monitorRoutes(app, { /* ... */ });
```

#### Step 3.3: Create Route Index

**Create:**
```typescript
// delivery/common/src/routes/index.ts
export * from "./dashboard/dashboard-config.route";
export * from "./dashboard/dashboard-stats.route";
export * from "./dashboard/dashboard-charts.route";
// ... export all routes

// Helper to register all dashboard routes
export async function registerDashboardRoutes(
  fastify: NaridonFastifyInstance,
  options: DashboardRoutesOptions,
): Promise<void> {
  await dashboardConfigRoute(fastify, options);
  await dashboardStatsRoute(fastify, options);
  await dashboardChartsRoute(fastify, options);
  // ... register all routes
}
```

**Tasks:**
- [ ] Create 11 dashboard route files
- [ ] Create 4 analysis route files
- [ ] Create route index
- [ ] Update API entry point
- [ ] Add feature flags
- [ ] Write E2E tests for routes

**Estimated Time:** 7-10 days

---

### Phase 4: Frontend Integration (Week 7-8)

**Objective:** Update frontend to use new endpoints

#### Step 4.1: Create API Client

**Frontend changes needed:**
```typescript
// frontend/packages/api-client/src/dashboard-api.ts
export class DashboardAPI {
  // Old endpoint (deprecated)
  async getDashboardData(shopId: string): Promise<DashboardData> {
    const response = await fetch(`/api/v1/monitor/dashboard?shopId=${shopId}`);
    return response.json();
  }

  // New endpoints
  async getConfig(): Promise<DashboardConfig> {
    const response = await fetch(`/api/monitor/dashboard/config`);
    return response.json();
  }

  async getStats(params: StatsParams): Promise<GlobalStats> {
    const query = new URLSearchParams(params);
    const response = await fetch(`/api/monitor/dashboard/stats?${query}`);
    return response.json();
  }

  async getCharts(params: ChartsParams): Promise<ChartData> {
    const query = new URLSearchParams(params);
    const response = await fetch(`/api/monitor/dashboard/charts?${query}`);
    return response.json();
  }

  // ... other endpoints
}
```

#### Step 4.2: Create React Hooks

**Create hooks for each endpoint:**
```typescript
// frontend/packages/hooks/src/use-dashboard-stats.ts
import { useQuery } from "@tanstack/react-query";
import { dashboardAPI } from "@/api-client";

export function useDashboardStats(params: StatsParams) {
  return useQuery({
    queryKey: ["dashboard", "stats", params],
    queryFn: () => dashboardAPI.getStats(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useDashboardCharts(params: ChartsParams) {
  return useQuery({
    queryKey: ["dashboard", "charts", params],
    queryFn: () => dashboardAPI.getCharts(params),
    staleTime: 5 * 60 * 1000,
  });
}

// ... other hooks
```

#### Step 4.3: Update Dashboard Component

**Refactor dashboard to use new hooks:**
```typescript
// frontend/apps/main/src/pages/Dashboard.tsx
export function Dashboard() {
  const { data: config } = useDashboardConfig();
  const { data: stats } = useDashboardStats({ timeRange: "30" });
  const { data: charts } = useDashboardCharts({ timeRange: "30" });
  const { data: trends } = useDashboardTrends({ timeRange: "30" });
  const { data: competitors } = useDashboardCompetitors({ timeRange: "30" });

  // Parallel loading with Suspense
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardLayout config={config}>
        <StatsSection stats={stats} />
        <ChartsSection charts={charts} />
        <TrendsSection trends={trends} />
        <CompetitorsSection competitors={competitors} />
      </DashboardLayout>
    </Suspense>
  );
}
```

**Benefits of new approach:**
- ✅ Parallel loading (faster perceived performance)
- ✅ Granular caching (stats cached separately from charts)
- ✅ Selective refetching (only refetch what changed)
- ✅ Better error handling (one section can fail without breaking others)

#### Step 4.4: Feature Flag Rollout

**Gradual rollout strategy:**
```typescript
// frontend/apps/main/src/config/features.ts
export const FEATURES = {
  NEW_DASHBOARD_ENDPOINTS: {
    enabled: process.env.NEXT_PUBLIC_NEW_DASHBOARD === "true",
    rolloutPercentage: 0, // Start at 0%, gradually increase
  },
};

// Use in components
if (FEATURES.NEW_DASHBOARD_ENDPOINTS.enabled) {
  // Use new endpoints
} else {
  // Use old monolithic endpoint
}
```

**Rollout phases:**
1. Week 7: Internal testing (0% users)
2. Week 8: Beta users (10% users)
3. Week 9: Gradual rollout (25% → 50% → 75%)
4. Week 10: Full rollout (100% users)

**Tasks:**
- [ ] Create API client for new endpoints
- [ ] Create React Query hooks
- [ ] Update dashboard component
- [ ] Add feature flags
- [ ] Test parallel loading
- [ ] Monitor performance metrics

**Estimated Time:** 7-10 days

---

### Phase 5: Testing & Optimization (Week 9-10)

**Objective:** Ensure quality and performance

#### Step 5.1: Performance Testing

**Metrics to measure:**
```typescript
// tests/performance/dashboard-endpoints.spec.ts
describe("Dashboard Endpoints Performance", () => {
  it("should respond within 200ms (p95)", async () => {
    const responses = [];
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      await fetch("/api/monitor/dashboard/stats?timeRange=30");
      responses.push(Date.now() - start);
    }
    const p95 = percentile(responses, 95);
    expect(p95).toBeLessThan(200);
  });

  it("should handle parallel requests efficiently", async () => {
    const start = Date.now();
    await Promise.all([
      fetch("/api/monitor/dashboard/config"),
      fetch("/api/monitor/dashboard/stats"),
      fetch("/api/monitor/dashboard/charts"),
      fetch("/api/monitor/dashboard/trends"),
      fetch("/api/monitor/dashboard/competitors"),
    ]);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500); // Should be parallelized
  });
});
```

#### Step 5.2: Load Testing

**Use k6 for load testing:**
```javascript
// tests/load/dashboard.js
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "2m", target: 100 }, // Ramp up to 100 users
    { duration: "5m", target: 100 }, // Stay at 100 users
    { duration: "2m", target: 200 }, // Ramp up to 200 users
    { duration: "5m", target: 200 }, // Stay at 200 users
    { duration: "2m", target: 0 },   // Ramp down to 0 users
  ],
};

export default function () {
  const responses = http.batch([
    ["GET", "http://api.example.com/api/monitor/dashboard/stats"],
    ["GET", "http://api.example.com/api/monitor/dashboard/charts"],
    ["GET", "http://api.example.com/api/monitor/dashboard/trends"],
  ]);

  check(responses[0], {
    "stats status is 200": (r) => r.status === 200,
    "stats response time < 200ms": (r) => r.timings.duration < 200,
  });

  sleep(1);
}
```

**Run load test:**
```bash
k6 run tests/load/dashboard.js
```

#### Step 5.3: Database Optimization

**Add indexes for new queries:**
```sql
-- Add indexes for monitoring queries
CREATE INDEX IF NOT EXISTS idx_run_prompt_created_at 
  ON "Run" ("promptId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_run_shop_time 
  ON "Run" ("shopId", "createdAt" DESC)
  WHERE "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_run_location_time 
  ON "Run" ("location", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_run_sentiment_time 
  ON "Run" ("sentiment", "createdAt" DESC)
  WHERE "sentiment" IS NOT NULL;

-- Add indexes for competitor queries
CREATE INDEX IF NOT EXISTS idx_competitor_shop_strength 
  ON "Competitor" ("shopId", "strength" DESC);

-- Add indexes for topic queries
CREATE INDEX IF NOT EXISTS idx_topic_shop_ranking 
  ON "TopicRanking" ("shopId", "score" DESC);
```

**Analyze query performance:**
```sql
-- Check slow queries
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  max_time
FROM pg_stat_statements
WHERE query LIKE '%Run%'
ORDER BY mean_time DESC
LIMIT 10;
```

#### Step 5.4: Caching Strategy

**Add response caching:**
```typescript
// delivery/api/src/middleware/cache.ts
import { FastifyRequest, FastifyReply } from "fastify";

export function cacheMiddleware(ttlSeconds: number) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const cacheKey = `cache:${request.url}`;
    
    // Check cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      reply.header("X-Cache", "HIT");
      return reply.send(JSON.parse(cached));
    }

    // Set cache header
    reply.header("X-Cache", "MISS");
    reply.header("Cache-Control", `public, max-age=${ttlSeconds}`);

    // Cache response after sending
    reply.addHook("onSend", async (req, rep, payload) => {
      await redis.setex(cacheKey, ttlSeconds, payload);
      return payload;
    });
  };
}

// Use in routes
fastify.get(
  "/api/monitor/dashboard/stats",
  {
    preHandler: [auth, cacheMiddleware(300)], // 5 minutes
  },
  handler,
);
```

**Cache invalidation strategy:**
```typescript
// infrastructure/src/cache/invalidation.ts
export class CacheInvalidator {
  async invalidateDashboard(shopId: string): Promise<void> {
    const patterns = [
      `cache:/api/monitor/dashboard/*?shopId=${shopId}*`,
      `cache:/api/monitor/products?shopId=${shopId}*`,
      `cache:/api/monitor/competitors?shopId=${shopId}*`,
    ];

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  }
}

// Call after data updates
await cacheInvalidator.invalidateDashboard(shopId);
```

**Tasks:**
- [ ] Write performance tests
- [ ] Run load tests
- [ ] Add database indexes
- [ ] Implement response caching
- [ ] Implement cache invalidation
- [ ] Monitor metrics in production

**Estimated Time:** 7-10 days

---

### Phase 6: Deprecation & Cleanup (Week 11-12)

**Objective:** Remove old code and finalize migration

#### Step 6.1: Deprecate Old Endpoint

**Add deprecation warnings:**
```typescript
// delivery/api/src/routes/monitor.ts
fastify.get("/dashboard", async (req, reply) => {
  // Add deprecation header
  reply.header("X-Deprecated", "true");
  reply.header(
    "X-Deprecation-Message",
    "This endpoint is deprecated. Use /api/monitor/dashboard/* endpoints instead."
  );
  reply.header("X-Sunset", "2026-03-01"); // Sunset date

  // Log deprecation usage
  fastify.log.warn({
    msg: "Deprecated endpoint used",
    shopId: req.user?.shopId,
    userAgent: req.headers["user-agent"],
  });

  // Continue with old logic
  const result = await getDashboardDataUseCase.execute({ shopId });
  return reply.send(result);
});
```

**Monitor deprecation usage:**
```sql
-- Track deprecated endpoint usage
SELECT 
  date_trunc('day', timestamp) as day,
  count(*) as requests
FROM api_logs
WHERE endpoint = '/api/v1/monitor/dashboard'
  AND timestamp > now() - interval '30 days'
GROUP BY day
ORDER BY day DESC;
```

#### Step 6.2: Remove Old Code

**After 100% migration (all users on new endpoints):**

**Remove files:**
```
backend/application/common/src/monitoring/
└── get-dashboard-data.use-case.ts  ❌ DELETE

backend/delivery/api/src/routes/
└── monitor.ts (dashboard route)    ❌ REMOVE dashboard route
```

**Update route registration:**
```typescript
// delivery/api/src/index.ts

// Remove old route registration
// await monitorRoutes(app, { /* ... */ });

// Keep only new routes
await registerDashboardRoutes(app, {
  monitoringRepository,
  competitorRepository,
  productRepository,
  personaRepository,
  getShopId: shopIdResolver.resolve,
});
```

#### Step 6.3: Update Documentation

**Update API documentation:**
```markdown
# API Documentation

## Dashboard Endpoints (v2)

### GET /api/monitor/dashboard/config
Get shop configuration and plan limits.

### GET /api/monitor/dashboard/stats
Get global statistics for the shop.

**Query Parameters:**
- `timeRange`: "7" | "30" | "90" | "all" (default: "30")
- `productId`: string (optional)
- `region`: string (optional)

**Response:**
```json
{
  "stats": {
    "totalPrompts": 1234,
    "avgSentiment": 0.75,
    "visibilityScore": 85,
    "invisibleCount": 45,
    "citationScore": 92,
    "netAiScore": 88
  }
}
```

... (document all endpoints)

## Deprecated Endpoints

### ~~GET /api/v1/monitor/dashboard~~ (DEPRECATED)
**Deprecated:** January 15, 2026  
**Sunset Date:** March 1, 2026  
**Replacement:** Use granular `/api/monitor/dashboard/*` endpoints

This endpoint returns all dashboard data in one response. It has been replaced by granular endpoints for better performance and caching.

**Migration Guide:** See [Dashboard Migration Guide](./migrations/dashboard-v2.md)
```

**Update internal documentation:**
```markdown
# Backend Architecture

## Monitoring Domain

The monitoring domain follows clean architecture principles:

### Domain Layer
- **Entities:** MonitoringRun, Persona, TopicRanking, Competitor, SmartSignal
- **Value Objects:** TimeRange, SourceType, DataPoint, Stat, Chart, CompetitorStrength, SignalType, SignalStatus, SignalSeverity
- **Services:** StatisticsCalculator, TrendAnalyzer
- **Repositories:** IMonitoringRepository, ICompetitorRepository, IPersonaRepository, ITopicRepository

### Application Layer
- **Use Cases:** 38+ focused use cases organized by feature
- **Commands/Queries:** Zod-validated input objects

### Infrastructure Layer
- **Repositories:** Prisma implementations with optimized queries
- **External:** SearchAPI adapter

### Delivery Layer
- **Routes:** 20+ granular API endpoints
- **Schemas:** TypeBox for Swagger, Zod for validation
```

**Tasks:**
- [ ] Add deprecation warnings
- [ ] Monitor usage metrics
- [ ] Remove old code (after migration complete)
- [ ] Update API documentation
- [ ] Update architecture documentation
- [ ] Create migration guide

**Estimated Time:** 5-7 days

---

## Risk Assessment

### High Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Data inconsistency between old and new endpoints** | High | Medium | Run parallel comparison tests, log differences, fix before rollout |
| **Performance regression** | High | Medium | Load test before each phase, monitor metrics, rollback plan |
| **Breaking changes for API clients** | High | Low | Feature flags, versioning, gradual rollout, deprecation period |
| **Database query performance** | High | Medium | Index optimization, query profiling, caching strategy |
| **Cache invalidation issues** | Medium | Medium | Conservative TTLs, manual invalidation on updates, monitoring |

### Medium Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Frontend integration bugs** | Medium | Medium | Comprehensive E2E tests, canary deployment, quick rollback |
| **Missing edge cases** | Medium | Medium | Extensive testing, beta user feedback, monitoring |
| **Documentation gaps** | Low | High | Regular docs updates, code reviews for comments |
| **Team knowledge gaps** | Medium | Low | Pair programming, code reviews, knowledge sharing sessions |

### Low Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Type definition mismatches** | Low | Low | TypeScript strict mode, E2E type checking |
| **Deployment issues** | Low | Low | Staging environment, smoke tests |

---

## Success Criteria

### Phase 1: Domain Foundation ✅

- [ ] All 5 value objects created and tested
- [ ] 2 domain services implemented with unit tests
- [ ] 5 command/query objects with validation
- [ ] Unit test coverage > 80% for domain layer
- [ ] Code review approved by 2+ developers

### Phase 2: Use Cases & Repository ✅

- [ ] 11 dashboard use cases implemented
- [ ] 4 analysis use cases implemented
- [ ] Monitoring repository enhanced with 10+ methods
- [ ] Integration tests for all use cases
- [ ] Integration tests for repository
- [ ] Test coverage > 70% for application layer

### Phase 3: API Routes ✅

- [ ] 11 dashboard route files created
- [ ] 4 analysis route files created
- [ ] Full TypeBox schemas for all routes
- [ ] Swagger documentation auto-generated
- [ ] E2E tests for all routes
- [ ] Postman/Bruno collection updated

### Phase 4: Frontend Integration ✅

- [ ] API client updated for new endpoints
- [ ] React Query hooks created for all endpoints
- [ ] Dashboard component refactored
- [ ] Feature flags implemented
- [ ] Parallel loading working correctly
- [ ] Cypress/Playwright tests updated

### Phase 5: Testing & Optimization ✅

- [ ] Performance tests show p95 < 200ms for all endpoints
- [ ] Load tests pass at 200 concurrent users
- [ ] Database indexes added and verified
- [ ] Response caching implemented (5min TTL)
- [ ] Cache invalidation working correctly
- [ ] Production monitoring dashboards created

### Phase 6: Deprecation & Cleanup ✅

- [ ] Old endpoint deprecated with warnings
- [ ] Usage metrics show < 5% traffic to old endpoint
- [ ] Old code removed after 30-day deprecation period
- [ ] API documentation fully updated
- [ ] Architecture documentation updated
- [ ] Migration guide published

### Overall Project Success ✅

- [ ] All phases completed within 10-12 weeks
- [ ] No data inconsistencies between old and new endpoints
- [ ] Performance improved by > 30% (measured by p95 response time)
- [ ] Frontend loading time improved by > 20%
- [ ] Zero production incidents during rollout
- [ ] 100% of users migrated to new endpoints
- [ ] Code coverage > 75% for new code
- [ ] Team trained on new architecture

---

## Appendix A: File Mapping

### Domain Layer

| Current | Reference | Action |
|---------|-----------|--------|
| N/A | `domain/src/monitoring/value-objects/time-range.ts` | **CREATE** |
| N/A | `domain/src/monitoring/value-objects/source-type.ts` | **CREATE** |
| N/A | `domain/src/monitoring/value-objects/data-point.ts` | **CREATE** |
| N/A | `domain/src/monitoring/value-objects/stat.ts` | **CREATE** |
| N/A | `domain/src/monitoring/value-objects/chart.ts` | **CREATE** |
| N/A | `domain/src/monitoring/services/statistics-calculator.ts` | **CREATE** |
| N/A | `domain/src/monitoring/services/trend-analyzer.ts` | **CREATE** |
| `domain/src/monitoring/personas/persona.ts` | `domain/src/monitoring/entities/persona.ts` | **KEEP** (current is similar) |
| N/A | `domain/src/monitoring/entities/monitoring-run.ts` | **CONSIDER** (could enhance existing Run) |
| N/A | `domain/src/monitoring/entities/topic-ranking.ts` | **CREATE** |

### Application Layer

| Current | Reference | Action |
|---------|-----------|--------|
| `application/common/src/monitoring/get-dashboard-data.use-case.ts` | (Split into 11 use cases) | **REFACTOR** |
| N/A | `application/common/src/monitoring/commands/*.ts` | **CREATE** (5 files) |
| N/A | `application/common/src/monitoring/use-cases/dashboard/*.ts` | **CREATE** (11 files) |
| N/A | `application/common/src/monitoring/use-cases/analysis/*.ts` | **CREATE** (4 files) |
| `application/common/src/monitoring/personas/create-persona-use-case.ts` | `application/common/src/monitoring/use-cases/personas/create-persona-use-case.ts` | **KEEP & ENHANCE** |
| `application/common/src/monitoring/prompts/*.ts` | `application/common/src/monitoring/use-cases/prompts/*.ts` | **KEEP & ORGANIZE** |

### Infrastructure Layer

| Current | Reference | Action |
|---------|-----------|--------|
| `infrastructure/src/database/repositories/monitoring/run-repository-impl.ts` | `infrastructure/src/database/repositories/monitoring/monitoring-repository-impl.ts` | **ENHANCE** (add methods) |
| N/A | `infrastructure/src/database/repositories/monitoring/topic-repository-impl.ts` | **CREATE** |
| `infrastructure/src/database/repositories/monitoring/persona-repository-impl.ts` | `infrastructure/src/database/repositories/monitoring/persona-repository-impl.ts` | **KEEP** (similar) |

### Delivery Layer

| Current | Reference | Action |
|---------|-----------|--------|
| `delivery/api/src/routes/monitor.ts` (dashboard route) | (Split into 11+ route files) | **REFACTOR** |
| N/A | `delivery/common/src/routes/dashboard/*.ts` | **CREATE** (11 files) |
| N/A | `delivery/common/src/routes/analysis/*.ts` | **CREATE** (4 files) |
| N/A | `delivery/common/src/routes/monitoring-routes.ts` | **CREATE** (route registry) |

---

## Appendix B: Dependencies to Add

### NPM Packages

All dependencies already present in both backends. No new packages needed.

### Database Migrations

No schema changes required initially. The reference implementation uses the same database schema as current.

**Optional enhancements (post-migration):**
```sql
-- Add TopicRanking table (if not exists)
CREATE TABLE IF NOT EXISTS "TopicRanking" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "mentions" INTEGER NOT NULL,
  "sentiment" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TopicRanking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TopicRanking_shopId_idx" ON "TopicRanking"("shopId");
CREATE INDEX "TopicRanking_topic_idx" ON "TopicRanking"("topic");
```

---

## Appendix C: Testing Checklist

### Unit Tests

- [ ] TimeRange value object (all methods)
- [ ] SourceType value object (all methods)
- [ ] DataPoint value object (all methods)
- [ ] Stat value object (all methods)
- [ ] Chart value object (all methods)
- [ ] StatisticsCalculator service (all methods)
- [ ] TrendAnalyzer service (all methods)
- [ ] All command/query parsing functions

### Integration Tests

- [ ] GetDashboardConfigUseCase
- [ ] GetGlobalStatsUseCase
- [ ] GetVisibilityTrendUseCase
- [ ] GetDashboardChartsUseCase
- [ ] GetDashboardTrendsUseCase
- [ ] GetDashboardCompetitorsUseCase
- [ ] GetCompetitorInsightsUseCase
- [ ] GetSourcesAnalysisUseCase
- [ ] GetTopicRankingsUseCase
- [ ] GetCitationDataUseCase
- [ ] GetDeepDiveStatsUseCase
- [ ] MonitoringRepositoryImpl (all new methods)
- [ ] TopicRepositoryImpl (all methods)

### E2E Tests

- [ ] GET /api/monitor/dashboard/config
- [ ] GET /api/monitor/dashboard/stats (all query param combinations)
- [ ] GET /api/monitor/dashboard/charts (all query param combinations)
- [ ] GET /api/monitor/dashboard/trends
- [ ] GET /api/monitor/dashboard/competitors
- [ ] GET /api/monitor/dashboard/insights
- [ ] GET /api/monitor/dashboard/sources
- [ ] GET /api/monitor/dashboard/topics
- [ ] GET /api/monitor/dashboard/citations
- [ ] GET /api/monitor/dashboard/deep-dive
- [ ] GET /api/monitor/dashboard/personas
- [ ] Authentication for all endpoints
- [ ] Rate limiting for all endpoints
- [ ] Error handling for all endpoints

### Performance Tests

- [ ] Response time p50 < 100ms
- [ ] Response time p95 < 200ms
- [ ] Response time p99 < 500ms
- [ ] Concurrent requests (100 users)
- [ ] Concurrent requests (200 users)
- [ ] Database query time < 50ms
- [ ] Cache hit rate > 60%

### Load Tests

- [ ] Sustained load (100 users, 5 min)
- [ ] Sustained load (200 users, 5 min)
- [ ] Spike test (0 → 500 users in 1 min)
- [ ] Stress test (gradually increase until failure)
- [ ] Soak test (100 users, 1 hour)

---

## Appendix D: Rollback Plan

### If Issues Arise During Rollout

**Immediate Rollback (< 5 minutes):**
1. Set feature flag: `ENABLE_NEW_DASHBOARD_ENDPOINTS=false`
2. Deploy configuration change
3. Monitor old endpoint performance
4. Investigate issues

**Partial Rollback (specific endpoints):**
```typescript
// delivery/api/src/feature-flags.ts
export const ENDPOINT_FLAGS = {
  DASHBOARD_CONFIG: true,
  DASHBOARD_STATS: true,
  DASHBOARD_CHARTS: false,  // Rollback charts only
  DASHBOARD_TRENDS: true,
  // ...
};
```

**Data Inconsistency Rollback:**
1. Identify inconsistent data
2. Log differences for analysis
3. Rollback to old endpoint
4. Fix repository implementation
5. Re-test thoroughly
6. Gradual re-rollout

**Database Migration Rollback:**
```sql
-- If new indexes cause issues
DROP INDEX IF EXISTS idx_run_prompt_created_at;
DROP INDEX IF EXISTS idx_run_shop_time;
-- ... drop other indexes
```

---

## Appendix E: Monitoring & Alerting

### Metrics to Monitor

**API Metrics:**
- Response time (p50, p95, p99)
- Error rate (4xx, 5xx)
- Request rate (per endpoint)
- Cache hit rate

**Database Metrics:**
- Query execution time
- Connection pool usage
- Slow query count
- Index usage

**Business Metrics:**
- Dashboard load time (frontend)
- User engagement
- Feature adoption rate

### Alerts to Configure

**Critical Alerts (PagerDuty):**
- Error rate > 5% for 5 minutes
- Response time p95 > 1s for 5 minutes
- Database connection pool exhausted
- API completely down

**Warning Alerts (Slack):**
- Error rate > 1% for 10 minutes
- Response time p95 > 500ms for 10 minutes
- Cache hit rate < 40% for 15 minutes
- Slow query detected (> 1s)

### Dashboards

**API Performance Dashboard:**
- Request rate per endpoint
- Response time percentiles
- Error rate
- Cache performance

**Database Performance Dashboard:**
- Query execution time
- Connection pool usage
- Index usage statistics
- Slow query log

**Business Metrics Dashboard:**
- Feature adoption (% users on new endpoints)
- User engagement metrics
- Dashboard load time trends

---

## Conclusion

This migration plan provides a comprehensive roadmap for adopting the improved monitoring architecture from the reference implementation while preserving all production features.

**Key Takeaways:**
1. ✅ Reference architecture is superior for monitoring domain
2. ✅ Current backend has essential production features
3. ✅ Hybrid approach combines best of both
4. ✅ Incremental migration reduces risk
5. ✅ Feature flags enable safe rollout
6. ✅ Comprehensive testing ensures quality

**Next Steps:**
1. Review and approve this plan
2. Assign tasks to team members
3. Set up project tracking (Jira/Linear)
4. Begin Phase 1: Domain Foundation
5. Weekly progress reviews
6. Adjust timeline as needed

**Estimated Total Duration:** 10-12 weeks  
**Team Size Recommendation:** 2-3 developers  
**Risk Level:** Medium (with proper testing and gradual rollout)

---

**Document Revision History:**
- v1.0 (2026-01-12): Initial version

**Prepared By:** AI Assistant  
**Reviewed By:** [To be filled]  
**Approved By:** [To be filled]

