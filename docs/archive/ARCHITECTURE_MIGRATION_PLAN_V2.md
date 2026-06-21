# Clean Architecture Migration Plan

## 🎯 Objective
Transition the current `backend` from a **Service-Based Monolith** to a **Domain-Driven Design (Clean Architecture)** implementation, leveraging the patterns found in `temp_comparison`.

## 🏗 Architecture Comparison

| Aspect | Current Architecture (`backend`) | Target Architecture (`temp_comparison`) |
| :--- | :--- | :--- |
| **Structure** | Flat/Layered (`api`, `infrastructure`, `workers`) | Modular (`domain`, `application`, `infrastructure`, `interface`) |
| **Business Logic** | Embedded in Services (`AIService.ts`) & API Routes | Encapsulated in **Entities** & **Use Cases** |
| **Data Access** | Direct Prisma calls in Services | **Repositories** (Interfaces in Domain, Impl in Infra) |
| **Validation** | Manual / Partial | Strict **Value Objects** & **Zod Schemas** |
| **Dependency** | `API -> Service -> DB` | `API -> Use Case -> Domain <- Repository Impl` |

---

## 📅 Migration Phases

We will adopt a **Strangler Fig Pattern**: we will build the new structure *alongside* the old one, migrate features piece-by-piece, and then remove the old code.

### Phase 1: Foundation & Structure Setup (Week 1)
**Goal:** Establish the directory structure and shared libraries without breaking existing code.

1.  **Directory Restructuring**
    *   Create `backend/src/` to hold the new architecture.
    *   Create the four core layers:
        *   `backend/src/domain/` (Entities, Value Objects, Repository Interfaces)
        *   `backend/src/application/` (Use Cases, Application Services)
        *   `backend/src/infrastructure/` (Database, External APIs, Repositories)
        *   `backend/src/interface/` (API Routes, Workers, CLI)

2.  **Shared Libraries Integration**
    *   Adopt the `libs/ai` pattern: Create `backend/src/infrastructure/ai/client.ts` using Vercel AI SDK (from comparison repo).
    *   Adopt the `libs/db` pattern: Centralize Prisma client instantiation in `backend/src/infrastructure/db/client.ts`.

3.  **TSConfig Paths**
    *   Update `tsconfig.json` to map aliases:
        *   `@domain/*` -> `./src/domain/*`
        *   `@application/*` -> `./src/application/*`
        *   `@infrastructure/*` -> `./src/infrastructure/*`

### Phase 2: Domain Migration - Vertical Slice (Monitoring) (Week 2)
**Goal:** Migrate the "Competitor" and "Monitoring" logic, as this is the most developed part of the comparison repo.

1.  **Migrate Entities & Value Objects**
    *   Copy `Competitor`, `CompetitorStrength`, `SmartSignal` from `temp_comparison/backend/domain` to `backend/src/domain/monitoring/`.
    *   Ensure all `zod` validations are preserved.

2.  **Create Repository Interfaces**
    *   Create `backend/src/domain/monitoring/repositories/ICompetitorRepository.ts`.

3.  **Implement Infrastructure**
    *   Create `backend/src/infrastructure/repositories/PrismaCompetitorRepository.ts` that implements the interface using the *existing* Prisma Client.
    *   **Crucial:** Do not change the DB schema yet if possible. Map the Domain Entity to the existing DB Table inside the Repository.

### Phase 3: Service Refactoring - The "AIService" Breakup (Week 3-4)
**Goal:** Decompose the massive `AIService.ts` (1600+ lines) into discrete Use Cases.

The `AIService.runAnalysis` function currently does too much. We will break it down:

1.  **Create Use Cases (Application Layer)**
    *   `backend/src/application/monitoring/RunCompetitorAnalysisUseCase.ts`
    *   `backend/src/application/monitoring/AnalyzeSentimentUseCase.ts`
    *   `backend/src/application/monitoring/GenerateSmartSignalsUseCase.ts`

2.  **Refactor Logic**
    *   Move the logic from `AIService` into these Use Cases.
    *   Instead of raw OpenAI calls, inject the `AIProvider` (from Phase 1).
    *   Instead of `prisma.competitor.create`, use `competitorRepository.save()`.

3.  **Bridge the Old Service**
    *   Update `AIService.ts` to call these new Use Cases internally. This keeps the rest of the app working while we refactor the core.
    *   *Example:*
        ```typescript
        // AIService.ts
        static async runAnalysis(...) {
           await new RunCompetitorAnalysisUseCase(repo, ai).execute(...);
           // ...
        }
        ```

### Phase 4: API Layer Adaptation (Week 5)
**Goal:** Point API endpoints directly to Use Cases, bypassing the old Service.

1.  **Refactor Controllers**
    *   Update `backend/api/v1/monitor/competitors.ts`.
    *   Instead of calling `AIService`, instantiate `GetCompetitorsUseCase` or `RunCompetitorAnalysisUseCase`.

2.  **Dependency Injection**
    *   Simple DI setup in `backend/src/interface/container.ts` to wire Repositories to Use Cases.

### Phase 5: Cleanup & Standardization (Week 6)
**Goal:** Remove legacy code and enforce new standards.

1.  **Retire Legacy Code**
    *   Once `AIService` methods are empty (just delegating), delete the methods and point callers to Use Cases.
    *   Delete old "script-style" logic files.

2.  **Database Migration (Optional/Advanced)**
    *   Evaluate adopting the "Split Prisma Schema" approach from `temp_comparison` if the `schema.prisma` file becomes unmanageable.

---

## 🛡 Rules of the New Architecture

1.  **Dependency Rule**: Source code dependencies can only point **inwards**.
    *   `Infrastructure` depends on `Application` & `Domain`.
    *   `Application` depends on `Domain`.
    *   `Domain` depends on **NOTHING**.
2.  **Entities are King**: Business logic belongs in Entities (`Competitor.ts`), not in Services.
3.  **Interfaces for IO**: Never depend on concrete `PrismaClient` in the `Application` layer. Use `IRepository`.

## 🚀 Immediate Next Steps

1.  Create the directory structure.
2.  Copy the `domain` folder from `temp_comparison` to `backend/src/domain`.
3.  Implement `PrismaCompetitorRepository`.