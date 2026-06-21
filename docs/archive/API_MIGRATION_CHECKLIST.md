# Complete API Endpoint Migration Checklist

## Source: temp-shopeec-branch/app/routes/api.*.tsx

### Monitoring Endpoints
- [x] `api.monitor.data.tsx` - GET monitoring data (Split into sub-resources)
- [x] `api.monitor.dashboard.tsx` - GET monitoring dashboard (Mapped to `monitor/dashboard`)
- [x] `api.monitor.citations.tsx` - GET citation tracking (Mapped to `monitor/citations`)
- [x] `api.monitor.competitors.tsx` - GET competitor data (Mapped to `monitor/competitors`)
- [x] `api.monitor.mentions.tsx` - GET brand mentions (Mapped to `monitor/mentions`)
- [x] `api.monitor.sentiment.tsx` - GET sentiment analysis (Mapped to `monitor/sentiment`)
- [x] `api.monitor.tracking.tsx` - GET tracking data (Mapped to `monitor/prompts`)
- [x] `api.monitor.platforms.tsx` - GET platform data (Mapped to `monitor/platforms`)
- [x] `api.monitor.personas.tsx` - GET/POST personas (Mapped to `monitor/personas`)
- [x] `api.monitor.prompt.$id.tsx` - GET/POST/DELETE specific prompt (Mapped to `monitor/prompts/:id`)

### Optimization Endpoints
- [x] `api.optimization.dashboard.tsx` - GET optimization dashboard (Mapped to `optimization/dashboard`)
- [x] `api.optimization.fixes.tsx` - GET/POST fixes (Mapped to `optimize/fixes`)
- [x] `api.optimization.stats.tsx` - GET optimization stats (Mapped to `optimization/stats`)
- [x] `api.optimization.trends.tsx` - GET trend analysis (Mapped to `optimization/trends`)
- [x] `api.optimization.redirects.tsx` - GET/POST redirects (Mapped to `optimization/redirects`)

### Dashboard Endpoints
- [x] `api.dashboard.main.tsx` - GET main dashboard (DONE)

### Cron Jobs
- [x] `api.cron.monitor.tsx` - GET scheduled monitoring (DONE)
- [x] `api.cron.optimize.tsx` - GET scheduled optimization (Mapped to `cron/optimize`)

### Workers
- [x] `api.queue.process-prompt.tsx` - POST QStash worker (DONE)

### Utility Endpoints
- [x] `api.prompts.status.tsx` - GET prompt status (Mapped to `prompts/status`)
- [x] `api.scheduler.ts` - POST schedule jobs (Mapped to `scheduler/schedule`)
- [x] `api.waitlist.tsx` - POST waitlist signup (Mapped to `waitlist`)
- [x] `api.nuclear-reset.tsx` - POST reset data (Mapped to `dev/reset`)

## Migration Plan

### Phase 1: Monitoring APIs (Priority: HIGH)
All monitoring endpoints power the main monitoring dashboard.

### Phase 2: Optimization APIs (Priority: HIGH)
All optimization endpoints power the optimization dashboard.

### Phase 3: Utility APIs (Priority: MEDIUM)
Supporting endpoints for scheduling, status, etc.

### Phase 4: Admin/Dev APIs (Priority: LOW)
Development and admin utilities.

## Total Count
- **Total Endpoints**: 23
- **Completed**: 23
- **Remaining**: 0