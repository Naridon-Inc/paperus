# Platform Agnostic Design

**Status**: Draft
**Version**: 1.0

Naridon is designed to support multiple e-commerce platforms (Shopify, Shopware, BigCommerce, WooCommerce, Custom) using a unified internal model.

---

## 1. The Unified Product Entity

The core of the system is the `Product` entity in `@naridon/domain`. All platform data is normalized into this structure.

```typescript
// backend/domain/src/shop/entities/product.ts
export class Product {
  id: string;           // Internal Naridon ID
  platformId: string;   // Original Platform ID (e.g., gid://shopify/Product/123)
  shopId: string;
  title: string;
  handle: string;
  description: string;
  images: Image[];
  variants: Variant[];
  price: number;
  currency: string;
  productType: string;  // Normalized category
  vendor: string;       // Normalized brand
  metadata: Record<string, any>; // Platform-specific raw data stash
}
```

## 2. Platform Adapters (Hexagonal Architecture)

We use the **Adapter Pattern** to isolate platform specifics.

### Interface: `IPlatformContentPort`
Defined in `backend/domain/src/ports/platform-content-port.ts`.

```typescript
export interface IPlatformContentPort {
  fetchTopProducts(shopId: string, limit?: number): Promise<Product[]>;
  fetchProduct(shopId: string, productId: string): Promise<Product | null>;
  // Future: updateProduct(shopId: string, product: Partial<Product>): Promise<void>;
}
```

### Implementations
Located in `backend/infrastructure/src/platform/`.

*   `ShopifyContentAdapter`: Uses Shopify GraphQL Admin API.
*   `ShopwareContentAdapter`: Uses Shopware 6 Admin API.
*   `BigCommerceContentAdapter`: Uses BigCommerce V3 API.

## 3. The Composite Adapter

The `CompositeContentAdapter` allows the application layer to be agnostic. It selects the correct adapter at runtime based on the `Shop` entity's `platform` field.

```typescript
// backend/infrastructure/src/platform/composite-content-adapter.ts
export class CompositeContentAdapter implements IPlatformContentPort {
  async getAdapter(shopId: string) {
    const shop = await this.repo.findById(shopId);
    return this.adapters[shop.platform];
  }
  // ... delegates calls to specific adapter
}
```

## 4. Handling Platform-Specific Quirks

### Metafields / Custom Fields
*   **Shopify**: Uses `metafields`.
*   **Shopware**: Uses `customFields`.
*   **Magento**: Uses EAV attributes.

**Strategy**:
1.  **Read**: Adapters map these to standard `Product` fields where possible (e.g., "gtin" metafield -> `Product.gtin`).
2.  **Stash**: Unmapped fields go into `Product.metadata` for context, but rules should rely on standard fields.
3.  **Write**: `ApplyFixUseCase` will need platform-specific logic to know *where* to write the fix (e.g., update `body_html` vs `description`).

## 5. Adding a New Platform

1.  **Create Adapter**: Implement `IPlatformContentPort`.
2.  **Map Data**: Write the transformation logic (External API -> `Product` entity).
3.  **Register**: Add to `CompositeContentAdapter` in `index.ts`.
4.  **Auth**: Ensure the `AuthAdapter` for that platform is also implemented (handles token exchange).
