# Discussion: The "Shop vs. Project" Migration Plan

## 1. The Current State
Currently, `shopId` is the primary foreign key across the entire database.
- `SmartSignal` -> `shopId`
- `Fix` -> `shopId`
- `Prompt` -> `shopId`
- `User` -> `orgId` -> `OrganizationShop` -> `Shop`

Renaming this column in the database would require a massive migration and potentially break every single query in the system.

## 2. The Semantic Shift (Soft Migration)
Instead of a hard rename (which is high-risk), we will treat `Shop` as a legacy term for "Project Container."

**In the Code:**
*   We keep `shopId` in the database schema to avoid breaking changes.
*   In new domain entities (like `RuleTarget`), we use `projectId` as an alias for `shopId`.
*   In the UI, we exclusively use the term "Project" or "Site."

**In the Domain Layer:**
```typescript
// backend/domain/src/types.ts
export type ProjectId = string; // Alias for UUID

// In interfaces
export interface IProjectRepository {
   findById(id: ProjectId): Promise<Project>;
}
// (This interface basically wraps IShopRepository)
```

## 3. Webflow Specifics
*   **Shopify**: `Shop` = The Store.
*   **Webflow**: `Shop` = The Site.
*   **Custom**: `Shop` = The Domain.

We will add a `type` field to the `Shop` model (already exists as `OrganizationType` but we might need a finer grain `Platform` enum on the Shop itself).

## 4. Why this approach?
*   **Low Risk**: No database column renames.
*   **High Velocity**: We can build Webflow support *now* without waiting for a massive refactor.
*   **Future Proof**: We can slowly introduce a `Project` entity that links to `Shop` (1:1) if we ever need to separate billing/settings from the platform connection.
