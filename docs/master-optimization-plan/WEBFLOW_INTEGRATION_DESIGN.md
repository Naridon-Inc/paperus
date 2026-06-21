# Discussion: Webflow Integration & Platform-Agnostic Strategy

## 1. Architectural Goal: True Agnosticism
Our current core domain relies on the `Resource` and `RuleTarget` abstractions. To support Webflow (and others) without polluting the Domain layer:

*   **Avoid Platform Enums**: Instead of adding `WEBFLOW` to every enum in the Domain, we should use a `PlatformProvider` string or an extensible `SourceType`.
*   **Adapter Pattern**: The `WebflowContentAdapter` (Infrastructure) will be responsible for translating Webflow's specific CMS structure into our unified `RuleTarget`.
*   **Remediation Mapping**: A "Fix" for a Webflow page will be the same `Fix` entity as a Shopify product, but the `PlatformDispatcher` (Infrastructure) will know to call the Webflow API instead of Shopify.

## 2. Dashboard Coexistence: How they help/disturb each other
Currently, we have:
1.  **Shopify App**: Embedded in Shopify Admin. Highly specialized for Shopify users.
2.  **Standalone App**: A central dashboard for users who might have *multiple* projects (e.g., a Shopify store AND a Webflow blog).

### How Webflow helps:
*   **The Standalone App** becomes the "Master Dashboard." A user can see their total "Brand Health" across Shopify and Webflow in one view.
*   **Shared Features** (`packages/shared-features`) allow us to use the *exact same* Audit and Optimization UI for Webflow as we do for Shopify.

### Potential Disturbances:
*   **Data Silos**: If we hardcode "Shop" concepts (like `shopId`), we exclude non-commerce sites. We must transition `Shop` -> `Project` or `Workspace`.
*   **Navigation Confusion**: A Shopify user expects "Products." A Webflow user expects "Pages/Collections." Our UI must dynamically update terminology based on the active project type.

## 3. The Integration Flow (Webflow App vs. API)
Webflow allows two types of integration:
1.  **Data Client (API)**: We pull data via OAuth. The user stays in our Standalone Dashboard.
2.  **Designer Extension**: A tool that lives *inside* the Webflow Designer.

**Initial Strategy**: Focus on the **Data Client**. This allows us to keep the user in our newly designed Standalone Dashboard and treat Webflow simply as another "Content Source" for our Optimization Engine.

## 4. Discussion Points
*   **Project vs. Shop**: Should we rename the `Shop` entity in the DB/Domain to `Project` to be more inclusive?
*   **Unified Auth**: How do we handle a user who logs in via Shopify but also wants to connect a Webflow site?
*   **Rule Customization**: Do we need "Webflow-specific" rules, or can 100% of our current AEO rules apply?

## 5. Local Development & Integration (2026)
To develop the Webflow integration locally, we must handle the following:

### Redirect URIs
Webflow requires HTTPS for redirect URIs in production. For local development, we can use `http://localhost:4002/api/v1/auth/webflow/callback` or a Cloudflare tunnel.
Current Registered Redirect URI: `https://flow.naridon.com/api/v1/auth/webflow/callback`

### Multi-Platform Dev Script (`pnpm dev:m`)
The `dev:m` script currently pulls Shopify environment variables. As we add more platforms, we should ensure the backend environment is unified.
- **Credential Storage**: Webflow credentials are now stored in `backend/.env`.
- **Tunneling**: Since Webflow OAuth needs a consistent callback URL, we should ensure the tunnel script (`scripts/set-tunnel.sh`) also updates the Webflow App settings if possible, or use a static dev URL.

### App Identification
In 2026, Webflow Apps are classified by "Building Blocks." Our app uses the **Data Client (REST API)** block, which allows it to function as a standalone SaaS integration. This confirms our "Command Center" strategy where Naridon acts as the orchestrator.
