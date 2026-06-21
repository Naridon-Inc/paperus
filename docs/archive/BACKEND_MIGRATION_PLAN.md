# Backend Migration Plan: Express to Fastify

## 1. Objective
Transition the existing backend API service from **Express** to **Fastify**.

**Primary Goals:**
1.  **Performance**: Leverage Fastify's lower overhead and faster JSON serialization.
2.  **Schema Validation**: Utilize Fastify's native schema support (via AJV) for robust input/output validation, replacing manual Zod checks where applicable.
3.  **Modern DX**: Adopt the plugin-based architecture for better encapsulation.
4.  **Compatibility**: Maintain 100% API compatibility for the frontend consumers.

## 2. Migration Strategy

### Phase 1: Infrastructure Setup
*   [ ] Install Fastify dependencies (`fastify`, `@fastify/cors`, `@fastify/helmet`, `fastify-plugin`).
*   [ ] Uninstall Express dependencies (after completion).
*   [ ] Create the Fastify Application Factory (`backend/api/app.ts`).
*   [ ] Configure Global Middleware (CORS, Helmet).
*   [ ] Port the Server Entry Point (`backend/api/server.ts`).

### Phase 2: Core Middleware & Plugins
*   [ ] **Database**: Create a Prisma plugin (`backend/api/plugins/prisma.ts`) to attach `prisma` to the Fastify instance.
*   [ ] **Authentication**: Create an Auth plugin/decorator to replace `getAuth(req)`.
    *   *Express*: Helper function extracting headers.
    *   *Fastify*: `fastify.decorateRequest('shopId', ...)` via a `preHandler` hook.
*   [ ] **Error Handling**: Implement a global error handler that mimics the current Express responses.

### Phase 3: Route Migration (Iterative)
We will migrate routes domain by domain. Each Express Router will become a Fastify Plugin (Encapsulated Context).

**Domain 1: Monitoring (High Priority)**
*   [x] `GET /api/v1/monitor/dashboard`
*   [x] `GET /api/v1/monitor/competitors` (+ POST)
*   [x] `GET /api/v1/monitor/citations`
*   [x] `GET /api/v1/monitor/mentions`
*   [x] `GET /api/v1/monitor/sentiment`
*   [x] `GET /api/v1/monitor/platforms`
*   [x] `GET /api/v1/monitor/prompts` (+ details)
*   [x] `GET /api/v1/monitor/personas`

**Domain 2: Optimization**
*   [ ] `GET /api/v1/optimization/dashboard`
*   [ ] `GET /api/v1/optimization/stats`
*   [ ] `GET /api/v1/optimization/trends`
*   [ ] `GET /api/v1/optimization/redirects` (+ POST/DELETE)
*   [ ] `POST /api/v1/optimize/fixes`

**Domain 3: Core & Utility**
*   [ ] `GET /api/v1/dashboard/main`
*   [ ] `GET /api/v1/prompts/status`
*   [ ] `POST /api/v1/scheduler/schedule`
*   [ ] `POST /api/v1/waitlist`
*   [ ] `POST /api/v1/dev/reset`

**Domain 4: Webhooks & Cron**
*   [ ] `POST /api/v1/webhooks/*` (Needs raw body handling - verify Fastify content type parsers).
*   [ ] `GET /api/v1/cron/*` (Verify Vercel Cron auth header logic).
*   [ ] `POST /api/v1/workers/*` (QStash signature verification).

### Phase 4: Validation & Cleanup
*   [ ] Verify all endpoints with Frontend (Shopify App).
*   [ ] Verify QStash worker callbacks.
*   [ ] Remove Express code.
*   [ ] Update `package.json` scripts.

## 3. Implementation Details

### 3.1 The Auth Decorator
Instead of importing `getAuth` in every file, we will use a hook:

```typescript
// Fastify
fastify.addHook('preHandler', async (request, reply) => {
  const shopId = request.headers['x-shop-id'] as string;
  if (!shopId) {
    // Only throw for protected routes
    // Check route config
  }
  request.shopId = shopId;
});

// Usage in Route
const shopId = request.shopId;
```

### 3.2 Routing Structure
*   **Express**: `router.get('/', handler)` mounted via `app.use('/prefix', router)`.
*   **Fastify**: `fastify.register(monitorRoutes, { prefix: '/api/v1/monitor' })`.

### 3.3 Request/Response
*   `req.body` -> `request.body`
*   `req.query` -> `request.query`
*   `req.params` -> `request.params`
*   `res.json(...)` -> `return ...` (Fastify auto-serializes objects) or `reply.send(...)`.
*   `res.status(400).json(...)` -> `reply.code(400).send(...)` or `throw new Error(...)` (caught by global handler).

## 4. Migration Tracker

| Status | Domain | Modules |
| :--- | :--- | :--- |
| ✅ | **Infrastructure** | Server, App Factory, Plugins |
| ✅ | **Monitor** | Dashboard, Competitors, Citations, Mentions, Sentiment, Platforms, Prompts, Personas |
| ✅ | **Optimization** | Dashboard, Fixes, Redirects |
| ✅ | **Core** | Dashboard, Waitlist, Scheduler |
| ✅ | **System** | Webhooks, Cron, Workers |

```
