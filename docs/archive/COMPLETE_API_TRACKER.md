# Complete API Endpoint Migration Tracker

## Progress: 10/25 Complete (40%)

---

## ✅ COMPLETED (10)

### Infrastructure & Core
- [x] `GET /api/v1/health` - Health check
- [x] `POST /api/v1/monitor/run` - Trigger monitoring
- [x] `GET /api/v1/monitor/stats` - Basic monitoring stats
- [x] `GET /api/v1/dashboard/main` - Main dashboard metrics
- [x] `POST /api/v1/optimize/fixes` - Apply optimization fixes
- [x] `GET /api/v1/optimize/fixes/:shopId` - Get pending fixes
- [x] `POST /api/v1/webhooks/shopify/orders/create` - Order webhook
- [x] `POST /api/v1/webhooks/shopify/app/uninstalled` - Uninstall webhook
- [x] `GET /api/v1/cron/monitor` - Scheduled monitoring job
- [x] `POST /api/v1/workers/process-prompt` - QStash worker for AI analysis

---

## 🔄 IN PROGRESS (15)

### Monitoring Endpoints (from api.monitor.data.tsx)
- [x] `GET /api/v1/monitor/dashboard` - Monitoring dashboard (Tab 0)
- [ ] `GET /api/v1/monitor/prompts` - Prompts/tracking data (Tab 1)
- [ ] `GET /api/v1/monitor/competitors` - Competitor analysis (Tab 2)
- [ ] `GET /api/v1/monitor/citations` - Citation tracking (Tab 3)
- [ ] `GET /api/v1/monitor/mentions` - External mentions (Tab 4)
- [ ] `GET /api/v1/monitor/sentiment` - Sentiment analysis (Tab 5)
- [ ] `GET /api/v1/monitor/platforms` - Platform metrics (Tab 6)
- [ ] `GET /api/v1/monitor/personas` - GET personas (Tab 7)
- [ ] `POST /api/v1/monitor/personas` - Create persona
- [ ] `GET /api/v1/monitor/prompts/:id` - Get specific prompt
- [ ] `POST /api/v1/monitor/prompts/:id` - Update prompt
- [ ] `DELETE /api/v1/monitor/prompts/:id` - Delete prompt

### Optimization Endpoints
- [ ] `GET /api/v1/optimization/dashboard` - Optimization dashboard
- [ ] `GET /api/v1/optimization/stats` - Optimization statistics
- [ ] `GET /api/v1/optimization/trends` - Trend analysis
- [ ] `GET /api/v1/optimization/redirects` - Get redirects
- [ ] `POST /api/v1/optimization/redirects` - Create redirect

### Utility Endpoints
- [ ] `GET /api/v1/prompts/status` - Prompt status tracking
- [ ] `POST /api/v1/scheduler/schedule` - Schedule jobs
- [ ] `POST /api/v1/waitlist` - Waitlist signup
- [ ] `GET /api/v1/cron/optimize` - Scheduled optimization (enhance existing)

### Development Endpoints
- [ ] `POST /api/v1/dev/reset` - Nuclear reset (dev only)

---

## 📊 Summary by Category

| Category | Total | Done | Remaining |
|----------|-------|------|-----------|
| Infrastructure | 4 | 4 | 0 |
| Monitoring | 12 | 2 | 10 |
| Optimization | 5 | 2 | 3 |
| Utility | 3 | 0 | 3 |
| Development | 1 | 0 | 1 |
| **TOTAL** | **25** | **10** | **15** |

---

## 🎯 Migration Order

### Phase 1: Monitoring Endpoints (Priority: CRITICAL)
These power the main monitoring dashboard UI.

1. [ ] Prompts/Tracking
2. [ ] Competitors
3. [ ] Citations
4. [ ] Mentions
5. [ ] Sentiment
6. [ ] Platforms
7. [ ] Personas (GET/POST)
8. [ ] Prompt by ID (GET/POST/DELETE)

### Phase 2: Optimization Endpoints (Priority: HIGH)
These power the optimization dashboard UI.

9. [ ] Optimization Dashboard
10. [ ] Optimization Stats
11. [ ] Optimization Trends
12. [ ] Redirects (GET/POST)

### Phase 3: Utility Endpoints (Priority: MEDIUM)
Supporting functionality.

13. [ ] Prompts Status
14. [ ] Scheduler
15. [ ] Waitlist

### Phase 4: Development Endpoints (Priority: LOW)
Development utilities.

16. [ ] Nuclear Reset

---

## 📝 Notes

- Each endpoint will be created in its own file for maintainability
- All endpoints use the same auth pattern: `x-shop-id` and `x-access-token` headers
- Original Remix authentication removed, replaced with header-based auth
- All business logic preserved from original endpoints
- Services (AnalyticsService, etc.) used as-is

---

## 🚀 Next Steps

1. Create all monitoring endpoints (8 remaining)
2. Create all optimization endpoints (3 remaining)
3. Create utility endpoints (3 remaining)
4. Create dev endpoint (1 remaining)
5. Update main router to mount all new routes
6. Test each endpoint
7. Update this tracker as we complete each one
