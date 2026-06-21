# Dependency Comparison

## Package.json Analysis

Both projects use `pnpm` and have a workspace setup.

### Workspaces

**`@backend/` Workspaces:**
```json
[
  "libs/db",
  "libs/platform/base",
  "libs/platform/shopify",
  "libs/platform/shopware",
  "libs/platform/bigcommerce",
  "libs/platform/woocommerce",
  "libs/shared",
  "libs/ai",
  "libs/restapi",
  "domain",
  "application/common",
  "infrastructure",
  "delivery/common",
  "delivery/api",
  "delivery/platform/shopify",
  "delivery/platform/shopware",
  "delivery/platform/bigcommerce",
  "delivery/platform/woocommerce"
]
```

**`@reference/repo/backend/` Workspaces:**
```json
[
  "libs/db",
  "libs/platform",
  "libs/shared",
  "libs/ai",
  "libs/restapi",
  "libs/queue",
  "domain",
  "application/common",
  "application/app-shopify",
  "infrastructure",
  "interface"
]
```

*Difference*: `@backend/` has granular platform workspaces, while `@reference` has a generic `libs/platform` and `interface`. `@reference` also includes `libs/queue` which is not explicitly a workspace in `@backend/` (though code might exist).

### Core Dependencies

Both projects share identical versions for key libraries, indicating they are synchronized or one is a direct fork of the other.

- **AI SDK**: `@ai-sdk/*` (v3.0.2), `ai` (v6.0.6), `openai` (v6.15.0) are present in `libs/ai` in both.
- **TypeScript**: v5.9.3 in both.
- **Node**: Engines set to `>=20.0.0` (@backend) vs `>=22.0.0` (@reference).

### Scripts

- **`@backend/`**: Includes DB management scripts (`db:migrate`, `db:generate`, `db:studio`) in the root `package.json`.
- **`@reference/repo/backend/`**: Lacks root-level DB scripts, suggesting DB management might be handled differently (e.g., via Makefiles, or inside `libs/db` but not exposed at root).

## Conclusion

The dependency trees are highly consistent. The primary divergence is in the workspace definitions to support the architectural shift towards multi-platform modularity in `@backend/`.
