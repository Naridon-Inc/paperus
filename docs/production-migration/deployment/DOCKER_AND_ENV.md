# Deployment & Docker Configuration

## 1. Dockerfile.prod

Create a `Dockerfile.prod` in the root of the monorepo. This uses a multi-stage build to minimize image size.

```dockerfile
# ----------------------------------------
# Stage 1: Builder
# ----------------------------------------
FROM node:18-alpine AS builder
WORKDIR /app

# Install global build tools
RUN npm install -g pnpm turbo

# Copy monorepo configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy package.jsons for all workspaces to fetch dependencies
# (You might need a script or manual copy here if strict about caching, 
#  but copying source works for simple setups)
COPY backend/package.json backend/
COPY backend/libs/db/package.json backend/libs/db/
# ... copy other backend lib package.jsons ...
COPY frontend/apps/shopify-new/package.json frontend/apps/shopify-new/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build Project (Backend + Frontend)
# Ensure your turbo pipeline is configured to build 'shopify-new' and 'api'
RUN pnpm build

# Prune dev dependencies
RUN pnpm prune --prod

# ----------------------------------------
# Stage 2: Runner
# ----------------------------------------
FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy workspace config
COPY --from=builder /app/package.json .
COPY --from=builder /app/pnpm-workspace.yaml .
COPY --from=builder /app/node_modules ./node_modules

# Copy Backend Build Artifacts
COPY --from=builder /app/backend ./backend

# Copy Frontend Build Artifacts
COPY --from=builder /app/frontend/apps/shopify-new/dist ./frontend/apps/shopify-new/dist

# Expose Port
EXPOSE 3000

# Start Command
CMD ["node", "backend/delivery/api/dist/index.js"]
```

## 2. Shopify Partner Dashboard Setup

You must update your App Configuration in the Shopify Partner Dashboard to point to your production URL.

1.  **App URL**: `https://<YOUR-PRODUCTION-DOMAIN>`
2.  **Allowed Redirection URL(s)**:
    *   `https://<YOUR-PRODUCTION-DOMAIN>/auth/callback`
    *   `https://<YOUR-PRODUCTION-DOMAIN>/auth/shopify/callback`
    *   `https://<YOUR-PRODUCTION-DOMAIN>/api/auth/callback` (If using the API route prefix)

## 3. Required Environment Variables (Production)

These variables must be set in your hosting provider (Render, Railway, AWS, etc.).

| Variable | Description |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `HOST` | `0.0.0.0` |
| `DATABASE_URL` | Production PostgreSQL connection string. |
| `SHOPIFY_API_KEY` | Your App's API Key. |
| `SHOPIFY_API_SECRET` | Your App's Secret Key. |
| `SHOPIFY_APP_URL` | The public URL (e.g., `https://app.naridon.com`). |
| `SCOPES` | Scopes required by the app (e.g., `read_products,write_products`). |
| `OPENAI_API_KEY` | If using AI features. |
| `REDIS_URL` | Connection string for Redis (if using queues). |
