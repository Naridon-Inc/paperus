# Backend Optimization Tracker

This document tracks the implementation of the comprehensive backend optimization plan executed on January 21, 2026. The goal was to improve data integrity, performance, and architecture scalability.

## 🟢 Phase 1: Integrity & Foundations
**Goal:** Ensure atomic operations and standardized error handling.

- [x] **Domain Errors**: Created standardized error classes (`EntityNotFoundError`, `ValidationError`, etc.) in `@naridon/domain`.
- [x] **Unit of Work Interface**: Defined `IUnitOfWork` in Domain layer to abstract transaction management.
- [x] **Prisma Unit of Work**: Implemented `PrismaUnitOfWork` in Infrastructure layer to handle database transactions.
- [x] **Refactor Use Cases**: Updated `CreateOrUpdateShopUseCase` and `PlatformSessionStorage` to use the Unit of Work pattern, ensuring shop and config creation happen atomically.

**Files Impacted:**
- `backend/domain/src/errors.ts`
- `backend/domain/src/ports/unit-of-work.ts`
- `backend/infrastructure/src/database/unit-of-work.ts`
- `backend/application/common/src/shop/create-or-update-shop-use-case.ts`

---

## 🟢 Phase 2: Performance & Caching
**Goal:** Reduce database load and improve response times.

- [x] **Redis Integration**: Implemented `RedisCacheService` supporting both TCP (`ioredis`) and HTTP (`@upstash/redis`) for serverless environments.
- [x] **Repository Caching**: Created `CachedShopRepository` decorator to transparently cache shop lookups (`findById`, `findByExternalId`, `findByDomain`).
- [x] **Database Indexing**: Added covering indexes to `Shop` table (`[platform, externalId, status]`, `[orgId]`) in `schema.prisma`.
- [x] **Production Config**: Updated `apprunner-config.json` and AWS SSM parameters to use Upstash Redis in production.

**Files Impacted:**
- `backend/infrastructure/src/cache/redis-cache-service.ts`
- `backend/infrastructure/src/cache/cached-shop-repository.ts`
- `backend/libs/db/prisma/schema/base.prisma`
- `apprunner-config.json`

---

## 🟢 Phase 3: Decoupling & Observability
**Goal:** Clean up business logic and improve visibility.

- [x] **Structured Logging**: Implemented `PinoLogger` in `@naridon/shared` for high-performance JSON logging.
- [x] **Event Bus**: Created a simple in-memory `EventBus` in `@naridon/shared` for decoupling side effects.
- [x] **Domain Events**: Added event capabilities to `Shop` entity (`addEvent`, `getEvents`) and defined `ShopCreatedEvent`.
- [x] **Event Handlers**: Implemented `ShopCreatedHandler` to automatically handle post-creation tasks (Organization creation, Plan Limits).
- [x] **Auth Cleanup**: Refactored `auth.ts` (BigCommerce/Shopify) to rely on events instead of manual procedural calls.

**Files Impacted:**
- `backend/libs/shared/src/logger.ts`
- `backend/libs/shared/src/event-bus.ts`
- `backend/domain/src/shop/entities/shop.ts`
- `backend/application/common/src/shop/handlers/shop-created-handler.ts`
- `backend/delivery/api/src/index.ts` (Handler registration)

---

## 🚀 Production Readiness
- **Redis Provider**: Upstash Redis (HTTP mode used for App Runner).
- **Secrets**: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` added to AWS SSM Parameter Store.
- **Deployment**: `apprunner-config.json` updated to inject these secrets.

## ✅ Summary
The backend has been successfully migrated to a **Clean, Event-Driven, and Caching-First** architecture.
- **Transactions** prevent data corruption.
- **Caching** prevents database overload.
- **Events** prevent spaghetti code in controllers.
