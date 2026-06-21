# PNPM Migration Tracker

## Overview
Migrating the monorepo from `npm` to `pnpm` to improve dependency management and speed.

## Checklist

### 1. Preparation
- [x] Create `pnpm-workspace.yaml` defining workspace structure.
- [x] Remove `node_modules` folders (root, frontend, backend).
- [x] Remove `package-lock.json` files.
- [x] Clean up git tracking of `node_modules` (if any).

### 2. Dependency Installation
- [x] Install dependencies using `pnpm install` (via `npx pnpm`).
- [x] Fix `peer dependency` warnings if critical.

### 3. Script Updates
- [x] Update root `package.json` scripts to use `pnpm` (via `npx pnpm`).
- [x] Update `frontend/apps/shopify/package.json` scripts.
- [x] Verify `backend/package.json` scripts (standard `node`/`ts-node` usage is fine, but ensure `prisma` runs).

### 4. Prisma & Database
- [x] Regenerate Prisma Client for Backend (`backend/infrastructure/db/schema.prisma`).
  - [x] Command: `npx pnpm --filter @test-app/backend run db:generate`
- [x] Regenerate Prisma Client for Shopify App (`frontend/apps/shopify/prisma/schema.prisma`).
  - [x] Command: `cd frontend/apps/shopify && npx prisma generate`
- [x] Verify database connection string in `.env` files.

### 5. Frontend & Tooling
- [x] Fix Shopify App dev script (`npm exec remix` issue).
  - [x] Ensure `shopify app dev` uses local node_modules correctly.
- [x] Verify Vite configuration handles pnpm symlinks (deduplication).

### 6. Verification
- [x] Run `npm run dev:all` successfully.
- [x] Verify Backend API response (Bruno/Curl).
- [x] Verify Shopify App loads (Monitor Dashboard).

## Current Status
- **Complete:** Migration to pnpm is finished. All services are running correctly.