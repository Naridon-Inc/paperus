# Migration Plan: Single-Platform to Multi-Platform Architecture

## 1. Objective
Transition the existing monolithic Remix application (Shopify-centric) into a modular, Clean Architecture system capable of supporting multiple e-commerce platforms (Shopify, WooCommerce, BigCommerce) while maintaining high scalability and separation of concerns.

## 2. Phase 1: Database Schema Evolution

### 2.1 The Platform-Agnostic `Shop` Model
We moved away from using the Shopify domain as the primary key. The new source of truth is a `Shop` table that standardizes identity across platforms.

**Schema Change:**
```prisma
model Shop {
  id        String   @id @default(uuid())
  platform  String   // "shopify", "woocommerce", "bigcommerce"
  shopId    String   @unique  // Native Platform ID (e.g., Shopify GID: "gid://shopify/Shop/123")
  shop      String   // Domain (e.g., store.myshopify.com)
  domain    String   @unique
  // ... metadata
}
```

### 2.2 Dual-Field Strategy
To ensure performance without complex joins and to maintain backward compatibility with legacy logic that relied on the `shop` domain string:
*   **Strategy**: All child models (Prompts, Topics, Brands, etc.) now store **both** `shopId` and `shop`.
*   **Rationale**: 
    *   `shopId`: Stable, immutable reference for the platform.
    *   `shop`: Human-readable, used for fast lookups and legacy compatibility.
*   **Implementation**: This avoids the need for joins on every query to fetch the domain name, crucial for high-volume read operations.

## 3. Phase 2: Architectural Decoupling

The monolithic structure was split into a domain-driven backend and a monorepo frontend.

### 3.1 Backend Restructuring (`/backend`)
*   **API Layer (`/backend/api`)**: dedicated Express server handling routing (v1) and controllers.
*   **Domain Layer (`/backend/domain`)**: Core business logic separated into contexts:
    *   `identity`
    *   `monitoring`
    *   `optimization`
    *   `billing`
*   **Infrastructure (`/backend/infrastructure`)**:
    *   `db`: Prisma Client with multi-file schema support.
    *   `ai`: AI Engine runners (OpenAI, Gemini).
*   **Workers (`/backend/workers`)**: Queue-based background processes for high-latency tasks (AI monitoring runs).

### 3.2 Frontend Monorepo (`/frontend`)
*   **`apps/shopify`**: The existing Remix app, stripped of core domain logic, now focused on Shopify App Bridge and OAuth.
*   **`apps/standalone`**: A new Remix app for usage outside of Shopify (e.g., WooCommerce standalone dashboard).
*   **`packages/ui-kit`**: Shared React component library (Polaris + Tailwind) ensuring UI consistency across both apps.

## 4. Phase 3: Initialization & Logic

### 4.1 Unified Initialization Service
*   **Service**: `initializeShopAndConfig()` (located in `app/services/shop.server`).
*   **Logic**: 
    1.  Detects platform context (headers or payload).
    2.  Checks for existing `Shop` record by `shopId`.
    3.  Creates or updates record, normalizing data regardless of origin (Shopify Webhook vs WooCommerce REST API).

### 4.2 Auth Abstraction
*   Authentication middleware was refactored to verify platform-specific tokens (Session Tokens for Shopify, API Keys/JWT for WooCommerce) before handing off to the shared Domain Layer.