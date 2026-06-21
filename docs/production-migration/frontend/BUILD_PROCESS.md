# Frontend Production Build

## 1. Build Process

The frontend application (`apps/shopify-new`) is a Vite-based React application. It must be compiled into static HTML/CSS/JS files before being served by the backend.

### Command
```bash
# Run from root
pnpm build
# Or specifically
pnpm --filter shopify-new build
```

### Output
The build artifacts will be located in:
`frontend/apps/shopify-new/dist`

## 2. Environment Variables

Vite embeds environment variables starting with `VITE_` into the code **at build time**.

### Critical Variables
Ensure these are present in your CI/CD pipeline during the build step:

*   `VITE_SHOPIFY_API_KEY`: The public API key for your Shopify App.
*   `VITE_API_URL`: (Optional) If you are using absolute URLs for API calls. If you use relative paths (e.g., `/api/...`), this is not needed as the backend serves the frontend.

## 3. API Proxying vs. Same-Origin

In development, Vite proxies `/api` to `localhost:3000`.
In production, since the backend serves the frontend files, the frontend and backend share the **same origin**.
*   Requests to `/api/v1/...` will naturally hit the backend.
*   No CORS configuration is required for the frontend-to-backend communication.
