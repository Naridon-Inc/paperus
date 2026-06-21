# Production Migration Master Plan

This directory contains the detailed documentation and steps required to move the `Test-app` monorepo from a local development environment (using Cloudflare tunnels) to a production-ready containerized deployment.

## Directory Structure

- **[Common](./common/)**: Architecture changes and shared environment configuration.
- **[Backend](./backend/)**: Server modifications to serve static files and database production setup.
- **[Frontend](./frontend/)**: Build processes for the Shopify app and asset handling.
- **[Deployment](./deployment/)**: Docker configuration, CI/CD steps, and Shopify Partner Dashboard updates.

## Executive Summary

The migration involves:
1.  **Consolidating the Server**: Modifying the Fastify backend to serve the compiled frontend assets (`dist/`) instead of running a separate Vite dev server.
2.  **Containerization**: Creating a multi-stage Dockerfile to build and run the application in a single container.
3.  **Environment Setup**: Defining production environment variables and updating the Shopify App configuration to point to the real domain.

## checklist

- [ ] **Code Changes**: Implement `fastify-static` in backend.
- [ ] **Build Check**: Verify `pnpm build` generates correct `dist` folder.
- [ ] **Docker**: Create and test `Dockerfile.prod`.
- [ ] **Database**: Prepare production database and migration scripts.
- [ ] **Shopify**: Update App URL and Redirect URLs in Partner Dashboard.
