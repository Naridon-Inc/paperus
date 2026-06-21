# Appendix: Code Implementation Examples

This appendix provides concrete code snippets showing the architectural differences between the current backend and the reference implementation. Use these as a guide when porting features.

## 1. Monitoring Domain: Services vs. Logic

**Current State (`backend/domain/src/monitoring/index.ts`):**
The current backend exports entities and repositories directly, but lacks a `services` layer for pure business logic. Calculations are often done inside Use Cases or even API handlers.

```typescript
// Current exports
export * from "./competitor";
export * from "./smart-signal";
export * from "./prompts/entities/prompt";
// ... (Missing services)
```

**Target State (Reference):**
The reference introduces `StatisticsCalculator` to encapsulate math logic.

```typescript
// temp_reference/backend/domain/src/monitoring/services/statistics-calculator.ts

export class StatisticsCalculator {
  /**
   * Calculate share of voice percentage.
   * Formula: (mentions / totalMentions) * 100
   */
  static calculateShareOfVoice(
    mentions: number,
    totalMentions: number
  ): number {
    if (totalMentions === 0) {
      return 0;
    }
    return Math.round((mentions / totalMentions) * 100);
  }
  // ...
}
```

**Migration Action:**
Create `backend/domain/src/monitoring/services/statistics-calculator.ts` and paste the logic. Update `index.ts` to export it.

## 2. Infrastructure: Event Bus

**Current State:**
No standard interface for publishing events. Events are often handled by direct function calls or tightly coupled QStash calls.

**Target State (Reference):**
A clean interface `IEventPublisher` in the Infrastructure layer.

```typescript
// temp_reference/backend/infrastructure/src/events/event-publisher.ts

export interface IDomainEvent {
  readonly occurredAt: Date;
}

export interface IEventPublisher {
  publish<T extends IDomainEvent>(event: T): Promise<void>;
  publishMany<T extends IDomainEvent>(events: T[]): Promise<void>;
}
```

**Migration Action:**
1.  Define these interfaces in `backend/infrastructure/src/events/`.
2.  Implement them using your preferred broker (or start with an in-memory implementation for simpler events).
3.  Inject `IEventPublisher` into your Application Services.

## 3. Library Structure

**Current:**
Dependencies are scattered.

**Target:**
Modular libraries (`libs/queue`, `libs/search`) that hide implementation details.

*   `libs/queue`: wraps BullMQ/QStash.
*   `libs/search`: wraps SearchAPI.

**Migration Action:**
Move the direct `fetch('https://www.searchapi.io/...')` calls from your adapters into the new `libs/search` client, making the core code testable and cleaner.
