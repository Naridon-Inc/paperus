# Directory Structure Comparison

## Overview

Both repositories follow a similar high-level structure, adhering to Domain-Driven Design principles.

### Root Level
| Directory | `@backend/` | `@reference/repo/backend/` | Notes |
|-----------|-------------|----------------------------|-------|
| `application` | Present | Present | Application layer (use cases) |
| `delivery` | Present | Present | Interface layer (API, workers). Reference calls this `delivery` in folders but `interface` in `package.json` workspaces. |
| `domain` | Present | Present | Core domain logic (entities, repositories interfaces) |
| `infrastructure` | Present | Present | Implementation of interfaces (DB, adapters) |
| `libs` | Present | Present | Shared libraries |

## Key Differences

### 1. Platform Abstraction (`libs/platform`)

- **`@backend/`**: Breaks down platforms into specific libraries:
  - `libs/platform/base`
  - `libs/platform/shopify`
  - `libs/platform/shopware`
  - `libs/platform/bigcommerce`
  - `libs/platform/woocommerce`

- **`@reference/repo/backend/`**: Contains a single `libs/platform` directory.
  - This suggests `@backend/` has better separation of concerns for multi-tenant/multi-platform support.

### 2. Application Layer

- **`@backend/`**: Contains `application/common` and flat files in `application/`.
- **`@reference/repo/backend/`**: Explicitly separates `application/app-shopify` and `application/common`.

### 3. Delivery Layer

- **`@backend/`**:
  - `delivery/api`
  - `delivery/common`
  - `delivery/platform/*` (shopify, shopware, etc.)
  
- **`@reference/repo/backend/`**:
  - `delivery/api-shopify`
  - `delivery/common`
  
  The `@backend/` structure supports multiple delivery mechanisms per platform more explicitly.

### 4. Root Scripts

- **`@backend/`**: Contains numerous root-level scripts (`backfill-*.ts`, `debug-*.ts`, `seed-*.ts`).
- **`@reference/repo/backend/`**: Cleaner root, fewer scripts.

## Conclusion

The `@backend/` structure is optimized for a multi-platform strategy (Shopify, Shopware, BigCommerce, WooCommerce), whereas the reference implementation seems more focused on Shopify initially (or consolidates platforms differently).
