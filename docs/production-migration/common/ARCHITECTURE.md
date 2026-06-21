# Production Architecture Changes

## Current Development State (The "Tunnel" Model)

In development (`npm run dev:m`), the application runs as two separate services bridged by a Cloudflare tunnel:

1.  **Backend**: Runs on `localhost:3000`.
2.  **Frontend**: Runs on `localhost:5173` (Vite Dev Server).
3.  **Tunnel**: Exposes `localhost:3000` to the internet (e.g., `https://random.trycloudflare.com`).
4.  **Routing**: The backend proxies specific requests or the frontend is accessed via the tunnel which routes /api back to localhost.

## Target Production State (The "Monolith Container" Model)

In production, we will deploy a **Single Docker Container** that serves both the API and the UI.

### Key Components

1.  **Fastify Server (Node.js)**:
    *   Acts as the primary HTTP server.
    *   **API Routes**: Handles `/api/*`, `/auth/*`, `/webhooks/*`.
    *   **Static Assets**: Serves the compiled React app from `frontend/apps/shopify-new/dist` for all other routes.
    *   **SPA Fallback**: Returns `index.html` for 404s on non-API routes (Client-Side Routing).

2.  **Database (PostgreSQL)**:
    *   Managed external service (e.g., AWS RDS, Railway Postgres, Supabase).
    *   Connected via connection string.

3.  **Redis**:
    *   Used for queue management (BullMQ) and caching.
    *   Managed external service.

## Data Flow

1.  User accesses `https://app.naridon.com`.
2.  Request hits the **Fastify Server**.
3.  Server checks:
    *   Is it an API request? -> Process via Controller/UseCase.
    *   Is it a static file? -> Serve from `/public` or `/dist`.
    *   Is it a page load? -> Serve `index.html`.

## Environment Variable Strategy

*   **Build Time**: `VITE_` variables must be available during `pnpm build` if they are embedded in the code.
*   **Runtime**: Backend variables (`DATABASE_URL`, `SHOPIFY_API_SECRET`) are injected into the container at runtime.
