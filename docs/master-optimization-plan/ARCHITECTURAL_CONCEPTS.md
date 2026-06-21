# Architecture: Unified Rule Engine & Data Flow

## 1. The `RuleTarget` Interface
This is the core abstraction that allows the engine to run on anything. By normalizing data *before* it hits the rules, we avoid writing `if (isShopify)` logic inside every rule.

```typescript
// backend/domain/src/optimization/types.ts

export type ResourceType = 'PRODUCT' | 'PAGE' | 'BLOG' | 'COLLECTION';
export type PlatformType = 'SHOPIFY' | 'BIGCOMMERCE' | 'WEBFLOW' | 'WORDPRESS' | 'CUSTOM';

export interface RuleTarget {
    // Identity
    id: string; // Internal UUID
    platformId: string; // External ID (Shopify GID, URL)
    type: ResourceType;
    platform: PlatformType;
    
    // Content Payload
    title: string;
    content: string; // Normalized HTML or Text
    url: string;
    
    // Structured Metadata (normalized from platform specific fields)
    metadata: {
        seoTitle?: string;
        seoDescription?: string;
        publishedAt?: Date;
        author?: string;
        tags?: string[];
        price?: number; // Only for products
        inventory?: number; // Only for products
        [key: string]: any; // Platform specific extras
    };
}
```

## 2. The Unified `OptimizationRule` Class
Rules implement a standard interface that returns a `SmartSignal` (Issue) and optionally a `Fix` (Solution).

```typescript
// backend/domain/src/optimization/rules/optimization-rule.interface.ts

export interface OptimizationRule {
    ruleId: string;
    category: 'AEO' | 'SEO' | 'UX' | 'CONVERSION';
    severity: 'CRITICAL' | 'MODERATE' | 'MINOR';
    
    // Can this rule run on this target?
    supports(target: RuleTarget): boolean;
    
    // The core logic
    evaluate(target: RuleTarget): Promise<RuleResult>;
}

export interface RuleResult {
    passed: boolean;
    score?: number; // 0-100
    details?: string; // "Missing H1 tag"
    suggestedFix?: {
        action: 'UPDATE_FIELD' | 'APPEND_CONTENT' | 'REPLACE_CONTENT';
        field?: string;
        value?: any;
        instructions?: string; // For manual fixes
    };
}
```

## 3. Data Flow Architecture

### A. The Discovery Pipeline
1.  **Ingestion**:
    *   **Ecommerce**: `ShopifyContentAdapter` polls `products/update` webhook.
    *   **Custom**: `WebScraperAdapter` crawls `sitemap.xml`.
2.  **Normalization**:
    *   Raw data is mapped to `RuleTarget` format.
    *   HTML is cleaned (scripts removed) using `Cheerio` + `Turndown`.
3.  **Persistence**:
    *   Saved to `Resource` table in Prisma.

### B. The Analysis Pipeline (Async Queue)
1.  **Trigger**: New `Resource` detected or manual "Rescan" requested.
2.  **Execution**: `GenerateFixesUseCase` loads all applicable rules.
3.  **Output**:
    *   **Pass**: Updates `Resource.optimizationScore`.
    *   **Fail**: Creates `SmartSignal` (Issue) and `Fix` (Pending Action).

### C. The Remediation Pipeline
1.  **User Action**: User clicks "Apply Fix" or "Copy Code".
2.  **Routing**:
    *   If `ApplyFixUseCase` receives a Shopify ID -> Calls `ShopifyOptimizationAdapter`.
    *   If `ApplyFixUseCase` receives a Custom URL -> Returns 400 (Client-side manual copy flow).

## 4. Fix Entity Structure
The database schema for `Fix` is designed to be polymorphic.

```prisma
model Fix {
  id          String   @id @default(uuid())
  resourceId  String   // Link to Resource
  ruleId      String   // Which rule failed?
  status      String   // PENDING, APPLIED, DISMISSED
  
  // The Solution
  type        String   // AUTO_MERGE, MANUAL_INSTRUCTION
  payload     Json     // { "field": "body_html", "diff": "..." }
  
  // AI Context
  aiReasoning String?  // "We changed this because..."
  impactScore Int      // Estimated traffic lift
}
```
