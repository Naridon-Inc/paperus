# Gap Analysis: Legacy vs. New Backend

This document tracks the features present in the legacy Remix app (`temp-shopeec-branch`) that are missing or incomplete in the new Monorepo Backend (`backend/delivery/api`).

## 1. Monitoring Domain

### Implemented ✅
- `POST /run`: Run analysis (Basic).
- `GET /dashboard`: Main stats and recent signals.
- `GET /mentions`: Brand mentions.
- `GET /citations`: Citations from runs.
- `GET /competitors`: Competitor list.

### Missing ❌
- **Personas:** (`api.monitor.personas`) - CRUD for customer personas.
- **Sentiment Details:** (`api.monitor.sentiment`) - Detailed sentiment breakdown beyond basic stats.
- **Platform Metrics:** (`api.monitor.platforms`) - Specific metrics per platform (Reddit vs Quora etc.).
- **Tracking Status:** (`api.monitor.tracking`) - Configuration status for what is being tracked.
- **Run Details:** (`api.monitor.prompt.$id`) - Deep dive into a specific prompt run (partially covered by `GET /prompts/:id`?).

## 2. Optimization Domain

### Implemented ✅
- `GET /fixes`: List suggested fixes.
- `POST /fixes/:id/apply`: Apply a fix.

### Missing ❌
- **Redirect Management:** (`api.optimization.redirects`) - CRUD for URL redirects.
- **Trends:** (`api.optimization.trends`) - Historical trend analysis.
- **Detailed Stats:** (`api.optimization.stats`) - More granular optimization metrics.
- **Automate Settings:** (`app.optimization.automate`) - Configuration for auto-apply rules.
- **Sitemap:** (`app.optimization.sitemap`) - Sitemap injection status/control.

## 3. Prompts & AI

### Implemented ✅
- `CRUD /prompts`: Create, Read, Update, Delete prompts.

### Missing ❌
- **Generate Prompts:** (`POST /generate`) - Currently returns "Not implemented". Needs AI service integration.
- **Prompt Status:** (`api.prompts.status`) - Polling endpoint for async generation status.

## 4. System & Billing

### Implemented ✅
- **Auth:** Full OAuth flow (Install/Callback).
- **Billing:** Port & Adapter created (but routes need final wiring).
- **Webhooks:** GDPR & Uninstall handled.

### Missing ❌
- **Cron Jobs:** (`api.cron.*`) - Endpoints to trigger scheduled tasks (unless handled by internal worker).
- **Waitlist:** (`api.waitlist`) - User waitlist management.
- **Referrals:** (`app.referral`) - Referral system logic.

## 5. Next Steps Roadmap

1.  **Implement Personas:** Create `Persona` entity, repository, and routes.
2.  **Implement Redirects:** Add `Redirect` entity and adapter methods (Shopify Redirect API).
3.  **Connect AI Generation:** Implement `GeneratePromptsUseCase` using the AI library.
4.  **Finish Billing:** Wire up the `POST /subscribe` route to the UI.