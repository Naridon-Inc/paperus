# Migration & Consolidation Plan

**Goal**: Elevate `@backend/` to feature parity with `@reference` while maintaining its superior multi-platform architecture.

## Phase 1: Foundation (Infrastructure & Events)

1.  **Port Event Infrastructure**:
    - Copy `reference/.../infrastructure/src/events/` to `backend/infrastructure/src/events/`.
    - Implement `IEventPublisher` in `backend/libs/shared` (or `domain/ports`).

2.  **Port Compliance Domain**:
    - Copy `reference/.../domain/src/compliance` to `backend/domain/src/compliance`.
    - Register Repositories in `backend/infrastructure`.

## Phase 2: Core Domain Services (The Brains)

The logic in `@backend/` is currently stubbed. We need the real "brains".

1.  **Port Monitoring Services**:
    - Move `SentimentAnalysisService` (Reference) -> `libs/ai/src/services/` (Backend).
    - Move `StatisticsCalculator`, `TrendAnalyzer` (Reference) -> `domain/src/monitoring/services/` (Backend).
    - **Fix**: Update `IntelligenceService` in Backend to use these real services instead of `Math.random()`.

2.  **Port Optimization Logic**:
    - Move `FixScoringService`, `PriorityCalculator` (Reference) -> `domain/src/optimization/services/` (Backend).
    - Verify `FixRepository` implementations match.

## Phase 3: Application Layer Refactor

Break down the "God Classes" in `@backend/`.

1.  **Refactor `GetDashboardDataUseCase`**:
    - Split into: `GetDashboardCharts`, `GetTopicRankings`, `GetRecentSignals`.
    - Use the ported `StatisticsCalculator` for metrics instead of inline math.

2.  **Restore Missing Use Cases**:
    - Port `get-citation-analysis.use-case.ts`.
    - Port `get-competitor-insights.use-case.ts`.

## Phase 4: Verification

1.  **Test Suite**: Port `vitest` tests from `@reference`.
2.  **Comparison Script**: Run `debug-competitor-calc.ts` (Backend) vs Reference logic to ensure numbers match.

## Execution Order
1. Infrastructure (Events)
2. Domain (Compliance)
3. Domain Services (AI/Stats)
4. Application (Refactor)
