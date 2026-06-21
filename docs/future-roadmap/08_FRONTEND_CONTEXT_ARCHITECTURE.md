# 08. Frontend Architecture: The Platform Context Strategy

**Objective:** Enable `shared-features` to dynamically adapt its UI, Labels, and Logic based on the active platform (Shopify vs. Web vs. Shopware) without spaghetti code.

## 1. The `PlatformProvider`
We will introduce a top-level React Context that defines the "World" the app is running in.

```typescript
// frontend/packages/shared-features/src/providers/PlatformProvider.tsx

export type PlatformType = "SHOPIFY" | "WEB" | "SHOPWARE";

export interface PlatformConfig {
  type: PlatformType;
  labels: {
    resource: string;      // "Product" or "Page"
    collection: string;    // "Collection" or "Folder"
    metric: string;        // "Sales" or "Conversions"
  };
  capabilities: {
    hasInventory: boolean;
    hasCheckout: boolean;
    hasNativeFix: boolean; // True if we can write via API
    requiresSitemap: boolean;
  };
  routes: {
    resourceDetail: (id: string) => string; // "/products/:id" or "/pages/:id"
  };
}

export const PlatformContext = createContext<PlatformConfig | null>(null);
```

## 2. Shell Responsibility
Each "Shell" App is responsible for injecting the correct config.

### **Shopify App (`apps/shopify-new`)**
```tsx
<PlatformProvider config={{
  type: "SHOPIFY",
  labels: { resource: "Product", collection: "Collection", metric: "Sales" },
  capabilities: { hasInventory: true, hasCheckout: true, hasNativeFix: true, requiresSitemap: false },
  routes: { resourceDetail: (id) => `shopify:admin/products/${id}` } // Deep link to Admin
}}>
  <MonitorDashboard />
</PlatformProvider>
```

### **Web App (`apps/web-app`)**
```tsx
<PlatformProvider config={{
  type: "WEB",
  labels: { resource: "Page", collection: "Section", metric: "Traffic" },
  capabilities: { hasInventory: false, hasCheckout: false, hasNativeFix: false, requiresSitemap: true },
  routes: { resourceDetail: (id) => `/resources/${id}` }
}}>
  <MonitorDashboard />
</PlatformProvider>
```

## 3. Smart Component Adaptation

### 3.1 Dynamic Labels
Instead of hardcoding "Products", components use the hook:
```tsx
const { labels } = usePlatform();
return <Card title={`Top Performing ${labels.resource}s`} />;
```

### 3.2 Conditional Features
```tsx
const { capabilities } = usePlatform();
{capabilities.hasInventory && <InventoryStatusCard />}
```

### 3.3 Abstracted Actions
The `useFixAction` hook will look at `capabilities.hasNativeFix`.
*   If `true`: Runs the API mutation.
*   If `false`: Opens a "Manual Fix" modal with copy-paste instructions.

## 4. Implementation Steps

1.  **Create Provider**: Add `PlatformProvider` to `shared-features`.
2.  **Define Configs**: Create constant configs for `SHOPIFY` and `WEB`.
3.  **Refactor Hooks**: Update `useMonitorDashboard` to accept platform context (or read from provider).
4.  **Update Shells**: Wrap `shopify-new` and `standalone` apps with the provider.
5.  **Sweep & Replace**: Go through `MonitorDashboard` and replace string literals ("Product") with dynamic labels.
