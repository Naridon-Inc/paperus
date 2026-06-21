# Architecture Comparison: Strict vs. Feature-Sliced

This document provides an objective comparison between the two architectural patterns currently present in the Naridon ecosystem:

1.  **Architecture A (Current Monorepo):** Strict Ports & Adapters (Hexagonal).
    *   *Characteristic:* `backend/application` contains only generic/common logic. Platform specifics are pushed to `infrastructure` and `delivery`.
2.  **Architecture B (Reference / Temp Branch):** Feature-Sliced Application Layer.
    *   *Characteristic:* `backend/application` contains both `common` and platform-specific modules (e.g., `app-shopify`).

---

## 1. Directory Structure

### Architecture A (Current)
```text
backend/
├── application/
│   └── common/          # Pure business logic (Use Cases). No platform deps.
├── domain/              # Entities and Port Interfaces.
├── infrastructure/      # Implementations of Ports (Adapters).
│   ├── platform/
│   │   └── shopify-content-adapter.ts
├── delivery/            # Entry points (API Routes).
│   └── platform/
│       └── shopify/     # Routes/Controllers for Shopify.
```

### Architecture B (Reference)
```text
backend/
├── application/
│   ├── common/          # Shared business logic.
│   └── app-shopify/     # Shopify-specific Application Services.
│       ├── src/
│       │   ├── shopify-session-service.ts
│       │   └── webhooks/
├── domain/              # Entities.
├── infrastructure/      # Low-level implementation.
├── delivery/            # API Routes.
```

---

## 2. Logic Placement Comparison

| Feature | Architecture A (Strict) | Architecture B (Feature-Sliced) |
| :--- | :--- | :--- |
| **Session Storage Logic** | **Infrastructure**. The `PlatformSessionRepositoryImpl` handles the mapping and storage details. The `Use Case` in `common` only enforces rules like "Update if exists". | **Application**. `app-shopify/shopify-session-service.ts` contains the logic for how a Shopify session translates to a stored entity. |
| **Webhook Logic** | **Delivery -> Common**. The Route (`delivery`) receives the webhook, verifies it, and calls a generic Use Case (e.g., `UninstallShop`). | **Application**. `app-shopify/webhooks` contains specific handlers that encapsulate the business logic for that event before maybe calling common code. |
| **Platform APIs** | **Infrastructure (Adapters)**. All external API calls are hidden behind generic interfaces (`IContentPort`). | **Application (Services)**. Services in `app-shopify` might call Shopify APIs directly or via a thinner adapter layer. |

---

## 3. Scalability (Adding New Platforms)

### Scenario: Adding BigCommerce

#### Architecture A (Strict)
1.  **Define Interface:** Ensure `IPlatformBillingPort` in `domain` covers BigCommerce needs.
2.  **Implement Adapter:** Create `BigCommerceBillingAdapter` in `infrastructure`.
3.  **Create Routes:** Create `delivery/platform/bigcommerce`.
4.  **No Touch:** You rarely touch `application/common`. The core logic is reused automatically because it only speaks to the Interface.

*   **Pros:** Enforces high code reuse. Guarantees that business rules are consistent across platforms.
*   **Cons:** Can be rigid. If BigCommerce requires a completely unique business flow (e.g., "3-step approval"), fitting it into the generic `common` Use Case might require creating a new, specific Use Case anyway.

#### Architecture B (Feature-Sliced)
1.  **Create Module:** Create `backend/application/app-bigcommerce`.
2.  **Implement Logic:** Write specific services (`BigCommerceSessionService`) that handle the unique flows of that platform.
3.  **Reuse Common:** Import shared utilities from `application/common`.

*   **Pros:** Flexible. If BigCommerce is vastly different from Shopify, you have a dedicated place to write that unique logic without polluting the common core.
*   **Cons:** Risk of duplication. Developers might re-write "Create Shop" logic in `app-bigcommerce` instead of reusing the `common` version, leading to drift in business rules.

---

## 4. Testing Implications

| Aspect | Architecture A (Strict) | Architecture B (Feature-Sliced) |
| :--- | :--- | :--- |
| **Unit Testing** | **Easier.** Use Cases in `common` depend on Interfaces. You can easily mock `IContentPort` and test the business logic in isolation. | **Mixed.** Services in `app-shopify` might depend on concrete Shopify implementations or require more complex mocking if they mix business logic with platform behavior. |
| **Integration Testing** | **Focused.** You test Adapters (`infrastructure`) to ensure they talk to APIs correctly, and Routes (`delivery`) to ensure they handle HTTP correctly. | **Broader.** You test the Application Services to ensure the entire flow (Logic + Platform nuance) works together. |

---

## 5. Recommendation

### Choose Architecture A (Strict) If:
*   Your application behaves **identically** across platforms (e.g., "Analyze SEO" is the same logic everywhere).
*   You want to enforce strict discipline to prevent platform-specific hacks from leaking into the core.
*   You prioritize **Testability** and **Interface Segregation**.

### Choose Architecture B (Feature-Sliced) If:
*   The platforms are **fundamentally different** in how they operate (e.g., Shopify is Saas, WooCommerce is Self-Hosted Plugin), requiring distinct business workflows.
*   You find yourself writing "Empty Adapters" just to satisfy an interface in Architecture A.
*   You want to group everything related to "Shopify" (Routes, Logic, DB Mapping) in one vertical slice for easier navigation.

### Current Verdict for Naridon
Given the goal is a unified "E-commerce Intelligence API" where the core value prop (AI Analysis) is shared, **Architecture A** is currently the stronger fit. It forces the team to define the "Naridon Standard" for data and billing, making the platform adapters conform to *us*, rather than us conforming to them.