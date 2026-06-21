# 03. Database Migration Strategy: From Shop to Brand

This document outlines the Prisma schema changes needed to transition the local and RDS databases to a platform-agnostic model.

## 1. Schema Changes (Incremental)

### 1.1 Model Renaming (Logical)
While keeping the underlying SQL tables for stability initially, we will add fields to make them generic.

**`Shop` Table Updates:**
```prisma
model Shop {
  id          String   @id @default(uuid())
  platform    Platform // SHOPIFY, WEB, SHOPWARE...
  name        String
  domain      String   @unique
  // NEW FIELDS
  isStandalone Boolean @default(false)
  ownerId      String? // Links to a User for standalone accounts
  ...
}
```

**`Product` Table Updates (Polymorphic):**
```prisma
model Product {
  id          String   @id @default(uuid())
  type        String   @default("PRODUCT") // PRODUCT, PAGE, POST
  
  // Ecommerce Identity
  sku         String?  // Nullable
  
  // Web Identity
  url         String?  // Required for PAGE/POST
  cmsId       String?  // ID from Webflow/Wordpress
  
  // Content
  contentBody String?  // Stores scraped HTML/Text for analysis
  
  // Ecommerce Metrics
  price       Float?
  inventory   Int?
  
  // Universal Metrics
  lastCrawledAt DateTime?
  ...
}
```

## 2. Migration Execution (Zero Downtime)

1.  **Phase 1: Shadow Fields**: Add the new fields (`url`, `cmsId`, `contentBody`) as nullable. Push to RDS.
2.  **Phase 2: Data Backfill**: Run a script to set `type="PRODUCT"` for all existing Shopify products.
3.  **Phase 3: Validation**: Update the Domain Entities to enforce:
    *   If `type="PRODUCT"`, then `sku`/`price` might be required (platform dependent).
    *   If `type="PAGE"`, then `url` is required.
4.  **Phase 4: Cleanup**: (Optional) Rename tables in a major release (e.g., `Shop` -> `Project`).

## 3. Storage Efficiency
*   For generic web resources, we will store a **content hash** to detect changes without re-analyzing identical pages.
*   The `Mention` table will be indexed by `projectId` to support high-volume sentiment analysis for standalone brands.
