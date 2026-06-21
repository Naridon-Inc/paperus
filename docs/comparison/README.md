# Backend Comparison Summary

This directory contains a detailed comparison between the current `@backend/` workspace and the reference repository at `@reference/repo/` (specifically the `temp/migrate-to-ts` branch).

## Key Findings

1. **Repository Match**: The reference repository is confirmed to be on branch `temp/migrate-to-ts`.
2. **Structure**: Both codebases share a Domain-Driven Design (DDD) structure (`application`, `domain`, `infrastructure`, `libs`).
3. **Evolution**: The `@backend/` workspace appears to be a more modularized evolution of the reference backend, particularly in how it handles platform-specific logic (`libs/platform/*` vs single `libs/platform`).
4. **Database**: `@backend/` contains a Prisma schema in `libs/db`, whereas the reference TS backend lacks a Prisma schema (likely relying on the Python backend or external schema management).
5. **Dependencies**: Core dependencies (TypeScript, AI SDKs) are identical, suggesting a shared origin or strict alignment.

## Detailed Reports

- [Directory Structure Comparison](./STRUCTURE.md)
- [Dependency Comparison](./DEPENDENCIES.md)
- [Architecture & Components](./ARCHITECTURE.md)
