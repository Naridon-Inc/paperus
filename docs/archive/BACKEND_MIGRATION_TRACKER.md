# Backend Migration Tracker

## Phase 1: Infrastructure & Core Services (Moved from `temp-shopeec-branch`)

- [x] **AI Infrastructure** (`backend/infrastructure/ai`)
    - [x] Core Service (`service.ts`)
    - [x] LLM Judges (`judges.ts`)
    - [x] Runners (`/runners/*`) - OpenAI, Perplexity, etc.
- [x] **Shopify Connector** (`backend/connectors/shopify`)
    - [x] Product Service (`services/product.service.ts`)
    - [x] Shop Details Method (added to connector interface)
    - [ ] Webhook Registration *(Pending)*
    - [ ] Order Sync *(Pending)*

## Phase 2: Domain Logic (The "Brains")

- [x] **Monitoring Domain** (`backend/domain/monitoring`)
    - [x] Service Shell (`service.ts`)
    - [x] Competitor Analysis (`competitor.service.ts`)
- [x] **Optimization Domain** (`backend/domain/optimization`)
    - [x] Service Shell (`service.ts`)
    - [x] Fix Service (`fix.service.ts`)
- [x] **Identity Domain** (`backend/domain/identity`)
    - [x] Shop/User Management (`service.ts` - refactored to use Connectors)
- [x] **Analytics Domain** (`backend/domain/analytics`)
    - [x] Service (`service.ts`)
- [x] **Billing Domain** (`backend/domain/billing`)
    - [x] Service (`service.ts`)

## Phase 3: API Layer (The "Doorway")

- [x] **Express Routes** (`backend/api/v1`)
    - [x] `POST /api/v1/monitor/run` (Triggers Monitoring)
    - [x] `GET /api/v1/monitor/stats` (Dashboard Stats)
    - [x] `POST /api/v1/optimize/fixes` (Apply Fixes)
    - [x] `GET /api/v1/optimize/fixes/:shopId` (Get Fixes)
    - [x] `POST /api/v1/webhooks/shopify/*` (Handle incoming webhooks with HMAC verification)
    - [x] `GET /api/v1/dashboard/main` (Main dashboard metrics & insights)
    - [x] `GET /api/v1/cron/monitor` (Scheduled monitoring job)
    - [x] `GET /api/v1/cron/optimize` (Scheduled optimization job)
    - [x] `POST /api/v1/workers/process-prompt` (QStash worker for AI analysis)
    - [x] Integrated into main Express server

## Phase 4: Database & Prisma

- [x] **Schema Migration**
    - [x] Merged all schema files into `backend/infrastructure/db/schema.prisma`
    - [x] Generated Prisma Client successfully
    - [ ] Run migrations on database

## Phase 5: QStash & Workers

- [x] **QStash Integration**
    - [x] Installed `@upstash/qstash` package
    - [x] Created worker endpoint with signature verification
    - [x] Integrated with Scheduler Service
- [x] **Cron Jobs**
    - [x] Monitor cron (every 10 min)
    - [x] Optimize cron
    - [x] Vercel cron authentication

## Phase 6: Cleanup

- [ ] Delete `temp-shopeec-branch`
- [ ] Update environment variables documentation
- [ ] Test all endpoints (Future Work)

## Phase 7: Frontend Migration Plan (Future Work)

**Objective**: Migrate the UI from `temp-shopeec-branch/app` to `frontend/apps/shopify` and `frontend/packages/ui-kit`.

### 1. Component Migration (`frontend/packages/ui-kit`)
- [ ] **Move generic UI components** from `temp/app/components` to `ui-kit`.
    - `analyzing-card.tsx`
    - `circular-progress.tsx`
    - `gradient-box.tsx`
    - `shimmer-text.tsx`
- [ ] **Refactor**: Ensure they use `interface` for props and do not depend on Remix `Link` directly (pass as prop or use generic anchor).

### 2. Route Migration (`frontend/apps/shopify`)
- [ ] **Dashboard**: Migrate `app.dashboard.tsx` -> `frontend/apps/shopify/app/routes/app.dashboard.tsx`.
    - *Change*: Replace server-side `loader` logic with API calls to `backend/api/v1/monitor/stats`.
- [ ] **Monitoring**: Migrate `app.monitor.tsx` -> `frontend/apps/shopify/app/routes/app.monitor.tsx`.
    - *Change*: Fetch data from `backend/api/v1/monitor/data`.
- [ ] **Optimization**: Migrate `app.optimization.tsx`
    - *Change*: Submit fixes via `POST` to `backend/api/v1/optimize/fixes`.

### 3. Data Fetching Strategy
- [ ] Create `frontend/apps/shopify/app/api.server.ts` helper.
    - Responsible for calling `http://localhost:4000/api/v1/...`
    - Attaches `x-shop-id` and `x-access-token` headers automatically.


## Phase 5: Cleanup

- [ ] Delete `temp-shopeec-branch`
