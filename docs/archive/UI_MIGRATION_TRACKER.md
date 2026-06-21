# UI & Route Migration Tracker

## Overview
This document tracks the migration of Route files from the legacy `temp-shopeec-branch` to the new `frontend/apps/shopify` application. This involves two major transformations:
1.  **UI Migration**: Replacing Polaris components with `@test-app/ui-kit`.
2.  **Data Migration**: Replacing direct DB loaders with calls to the new Backend API (`/api/v1`).

## 📊 Status Summary
- **Total Routes**: ~80
- **Migrated**: 7
- **Pending**: 73

## 📝 Route Inventory

### 1. Core Layouts
| Route File | Status | Notes |
| :--- | :--- | :--- |
| `app.tsx` | ✅ Done | NavMenu & Links migrated |
| `app._index.tsx` | ✅ Done | Partially migrated (Card/Button) |

### 2. Monitor Suite
| Route File | Target | Status | Dependencies |
| :--- | :--- | :--- | :--- |
| `app.monitor.tsx` | `/app/monitor` | ✅ Done | Layout with Tabs |
| `app.monitor.dashboard.tsx` | `/app/monitor/_index` | ✅ Done | Exact Legacy Replica |
| `app.monitor.tracking.tsx` | `/app/monitor/tracking` | ✅ Done | Data Table |
| `app.monitor.competitors.tsx` | `/app/monitor/competitors` | ✅ Done | Grid/List View |
| `app.monitor.citations.tsx` | `/app/monitor/citations` | ✅ Done | Rich Table + Charts |
| `app.monitor.mentions.tsx` | `/app/monitor/mentions` | 🟡 Skeleton | Needs Implementation |
| `app.monitor.sentiment.tsx` | `/app/monitor/sentiment` | 🟡 Skeleton | Needs Implementation |
| `app.monitor.platforms.tsx` | `/app/monitor/platforms` | 🟡 Skeleton | Needs Implementation |
| `app.monitor.personas.tsx` | `/app/monitor/personas` | 🟡 Skeleton | Needs Implementation |
| `app.monitor.prompts.$id.tsx` | `/app/monitor/prompts/:id` | ⏳ Pending | Needs Detail View |

### 3. Optimization Suite
| Route File | Target | Status | Dependencies |
| :--- | :--- | :--- | :--- |
| `app.optimization._index.tsx` | `/app/optimization` | ⏳ Pending | Layout |
| `app.optimization.dashboard.tsx` | `/app/optimization/dashboard` | ⏳ Pending | Needs `OptimizationCharts` |
| `app.optimization.fixes.tsx` | `/app/optimization/fixes` | ⏳ Pending | Needs `DiffCard` |
| `app.optimization.redirects.tsx` | `/app/optimization/redirects` | ⏳ Pending | Needs `DataTable` |

### 4. Settings & Onboarding
| Route File | Status | Notes |
| :--- | :--- | :--- |
| `app.onboarding.tsx` | ⏳ Pending | Needs `OnboardingHero` |
| `app.settings.tsx` | ⏳ Pending | Form migration |

## 🛠️ Migration Procedure

For each file:
1.  **Copy**: Read content from `temp-shopeec-branch/app/routes/[name]`.
2.  **Create**: Create file in `frontend/apps/shopify/app/routes/[name]`.
3.  **Refactor Imports**:
    *   Remove `~/components/...`
    *   Add `import { ... } from "@test-app/ui-kit"`
4.  **Refactor Loader**:
    *   Remove `prisma`, `Service` imports.
    *   Implement `fetch('http://localhost:4000/api/v1/...')`.
5.  **Refactor JSX**:
    *   Replace Polaris `Page`, `Layout`, `Card` with UI Kit equivalents.
    *   Replace `Text` with HTML tags + Tailwind classes.

## 🚀 Priority Queue
1.  `app.tsx` (Navigation)
2.  `app.monitor.tsx` (Layout)
3.  `app.monitor.dashboard.tsx` (Main View)