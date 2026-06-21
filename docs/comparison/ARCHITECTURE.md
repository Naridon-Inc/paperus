# Architecture & Components Comparison
## Database

1.  `**@backend/**`:
2.  Uses Prisma.
3.  Schema location: `libs/db/prisma/schema.prisma`.
4.  Includes migration history (`libs/db/prisma/migrations`).
5.  Active DB management commands in `package.json`.
6.  `**@reference/repo/backend/**`:
7.  `libs/db` exists but contains no `schema.prisma`.
8.  The Python backend (`backend_py`) in the reference repo contains a Prisma schema.
9.  *Implication*: The Reference TS backend likely relies on the Python backend for DB schema management or hasn't fully migrated the DB layer yet. `@backend/` is self-contained.

## AI Integration

1.  **Both**:
2.  Use Vercel AI SDK.
3.  Identical `libs/ai` implementation structure.
4.  Support multiple providers (OpenAI, Anthropic, Google, Azure).

## Platform Integration

1.  `**@backend/**`:
2.  Uses a "Base Platform" abstraction (`libs/platform/base`).
3.  Concrete implementations for Shopify, Shopware, etc.
4.  This allows the core domain logic to remain agnostic of the e-commerce platform.
5.  `**@reference/repo/backend/**`:
6.  `libs/platform` likely contains the abstraction or a monolithic implementation.
7.  Stronger coupling to Shopify in the directory structure (`app-shopify`, `api-shopify`).

## Configuration (TypeScript)

1.  **Both**:
2.  Use `tsconfig.base.json` extended by sub-projects.
3.  `compilerOptions` are identical (Target ES2022, NodeNext module resolution, Strict mode).

## Summary

`@backend/` is a more mature TypeScript implementation in terms of:

1.  **Self-sufficiency**: It owns its database schema and migrations.
2.  **Extensibility**: It is architected from the ground up for multi-platform support, whereas the reference appears to be transitioning from a Shopify-first or Python-centric approach.