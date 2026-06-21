# Rationale: Dual-Field Strategy (shopId and shop)

## Overview
As we transition from a single-platform (Shopify-only) application to a multi-platform architecture (Shopify, WooCommerce, BigCommerce), we have adopted a **Dual-Field Strategy** in our database schema. 

This document explains why we maintain both `shopId` and `shop` columns on almost all relational models (e.g., `Prompts`, `Orders`, `Customers`), despite normal database normalization rules suggesting otherwise.

## The Strategy

Every model that belongs to a specific store will carry these two fields:

1.  **`shopId`** (String): The stable, unique identifier from the specific platform.
    *   *Example (Shopify):* `gid://shopify/Shop/123456789`
    *   *Example (WooCommerce):* `woo_store_98765`
    *   *Purpose:* Used for stable relationships and platform API calls.

2.  **`shop`** (String): The human-readable domain or handle of the shop.
    *   *Example:* `my-cool-store.myshopify.com`
    *   *Purpose:* Used for fast lookups, logging, and legacy compatibility.

## Key Drivers

### 1. Performance (Read-Heavy Optimization)
Our application is read-heavy on the frontend. Often, we simply need to display the shop's domain (e.g., in a dashboard header or a list view) alongside the data. 

*   **Without `shop` column:** We would need to `JOIN` the `Shop` table for every single query to fetch the domain name.
*   **With `shop` column:** We can query the `Orders` table and immediately have the domain string available for display without an extra join.

### 2. Backward Compatibility
The legacy version of this application (v1) relied entirely on the `shop` (domain) string as the foreign key. 
*   Existing codebases and third-party integrations often pass the `shop` domain in headers or query parameters.
*   Keeping the `shop` column allows us to support these legacy access patterns while we migrate to ID-based references in the background.

### 3. Platform Agnostic Queries
Different platforms expose different identifiers. 
*   Shopify uses Global IDs (GIDs).
*   WooCommerce uses integer IDs.
*   BigCommerce uses hashes.

By storing the normalized `shop` domain alongside the `shopId`, we provide a common human-readable denominator for support staff and developers debugging the database directly.

## Rules for Implementation

1.  **Source of Truth:** The `Shop` table is the only place where the mapping between `shopId` and `shop` is authoritative.
2.  **Immutability:** Once a record is created, `shopId` should never change. `shop` (domain) changes are rare but possible (e.g., domain migration). If a domain changes, a background job must update the `shop` string across related tables, but the relationship integrity is maintained via `shopId`.
3.  **Indexing:** Both columns should typically be indexed if they are used in `WHERE` clauses frequently.

## Schema Example

```prisma
model Order {
  id        String   @id @default(uuid())
  
  // The Dual-Field Setup
  shopId    String
  shop      String   // Redundant but necessary for perf/compat
  
  createdAt DateTime @default(now())
  // ... other fields
  
  @@index([shopId])
  @@index([shop])
}
```
