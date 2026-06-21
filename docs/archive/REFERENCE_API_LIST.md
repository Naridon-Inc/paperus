# Legacy App API Reference

This document lists the API routes discovered in the `temp-shopeec-branch` (Remix App), which serve as the reference for porting functionality to the new `backend/delivery` layer.

## 1. Monitoring APIs (`api.monitor.*`)
These endpoints likely power the "Monitor" dashboard section.
- `api.monitor.citations.tsx`: Fetch citation data (where the brand is mentioned).
- `api.monitor.competitors.tsx`: Competitor analysis data.
- `api.monitor.dashboard.tsx`: Aggregated monitoring dashboard stats.
- `api.monitor.data.tsx`: Generic data fetcher?
- `api.monitor.mentions.tsx`: Brand mentions tracking.
- `api.monitor.personas.tsx`: Customer persona data.
- `api.monitor.platforms.tsx`: Platform-specific metrics.
- `api.monitor.prompt.$id.tsx`: Details for a specific prompt run.
- `api.monitor.sentiment.tsx`: Sentiment analysis data.
- `api.monitor.tracking.tsx`: Tracking configuration/status.

## 2. Optimization APIs (`api.optimization.*`)
These endpoints likely power the "Optimize" dashboard section.
- `api.optimization.dashboard.tsx`: Optimization overview stats.
- `api.optimization.fixes.tsx`: List of proposed fixes/optimizations.
- `api.optimization.redirects.tsx`: URL redirect management.
- `api.optimization.stats.tsx`: detailed stats?
- `api.optimization.trends.tsx`: Trend analysis.

## 3. Core/Dashboard APIs
- `api.dashboard.main.tsx`: Main dashboard overview data.
- `api.waitlist.tsx`: Waitlist management (maybe for features?).
- `api.prompts.status.tsx`: Check status of async prompt runs.
- `api.queue.process-prompt.tsx`: Internal queue processor endpoint?

## 4. Background Jobs / Cron
- `api.cron.monitor.tsx`: Scheduled monitoring job trigger.
- `api.cron.optimize.tsx`: Scheduled optimization job trigger.
- `api.scheduler.ts`: General scheduler logic.

## 5. Webhooks (`webhooks.*`)
Shopify event handlers.
- `webhooks.app.scopes_update.tsx`
- `webhooks.app.uninstalled.tsx`
- `webhooks.compliance.tsx`: General compliance?
- `webhooks.customers.data_request.tsx` (GDPR)
- `webhooks.customers.redact.tsx` (GDPR)
- `webhooks.shop.redact.tsx` (GDPR)

## 6. Auth & App Proxy
- `auth.$.tsx`: Main OAuth handler.
- `auth.login.tsx`: Login page?
- `auth.update-scopes.tsx`: Handle scope updates.
- `app_proxy.api.optimization.redirects.report.tsx`: App Proxy endpoint (accessible from storefront).

## 7. App UI Routes (for reference)
These are React pages, not JSON APIs, but indicate feature sets.
- `app.dashboard.tsx`
- `app.monitor.tsx`
- `app.optimization.*.tsx`
- `app.pricing.tsx`
- `app.settings.tsx`
- `app.onboarding.tsx`
