# Missing Files & Logic Tracker

## Domain Layer
- [ ] `domain/src/compliance/` (Entire folder)
- [ ] `domain/src/monitoring/services/sentiment-analysis.service.ts`
- [ ] `domain/src/monitoring/services/brand-analysis.service.ts`
- [ ] `domain/src/monitoring/services/visibility-calculator.service.ts`
- [ ] `domain/src/monitoring/services/statistics-calculator.ts`
- [ ] `domain/src/monitoring/services/trend-analyzer.ts`
- [ ] `domain/src/monitoring/value-objects/chart.ts`
- [ ] `domain/src/monitoring/value-objects/stat.ts`
- [ ] `domain/src/optimization/services/fix-scoring-service.ts`
- [ ] `domain/src/optimization/services/priority-calculator.ts`

## Application Layer
- [ ] `application/common/src/monitoring/use-cases/analysis/get-citation-analysis-use-case.ts`
- [ ] `application/common/src/monitoring/use-cases/dashboard/get-topic-rankings-use-case.ts` (Logic exists in monolithic UC, needs extraction)
- [ ] `application/common/src/monitoring/use-cases/dashboard/get-dashboard-charts-use-case.ts` (Logic exists in monolithic UC, needs extraction)

## Infrastructure Layer
- [ ] `infrastructure/src/events/event-publisher-impl.ts`
- [ ] `infrastructure/src/database/repositories/compliance/`
