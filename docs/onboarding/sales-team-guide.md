# Sales Team Guide: Selling & Onboarding Naridon

This guide equips the sales team with the knowledge to pitch, demo, and onboard clients onto the Naridon Intelligence platform.

## 🎯 Value Proposition
Naridon is the **Operating System for E-commerce Growth**. It solves three critical problems:
1.  **AI Visibility**: Products are often invisible to modern AI search engines (ChatGPT, Perplexity, Google SGE). Naridon fixes this.
2.  **Competitor Intelligence**: Tracks competitor pricing, messaging, and strategy in real-time.
3.  **Automated Optimization**: Automatically fixes product content (titles, descriptions, meta) to boost traffic.

## 🛒 Supported Platforms & Onboarding

### 1. Shopify (Standard/SMB)
*   **Target**: Small to Medium businesses.
*   **Process**: Direct them to the **Shopify App Store**.
*   **Billing**: Handled automatically via Shopify Subscription.
*   **Action**: Send them the App Store link. No manual setup required.

### 2. Shopify Plus / Enterprise (Custom)
*   **Target**: Large brands (e.g., Adidas, Nike) who need custom integrations, security, or negotiated pricing.
*   **Process**: "Custom App" installation.
*   **Roles**:
    *   **Sales Team**: Client communication, requirements gathering, contract, handoff.
    *   **EngOps (Engineering Operations)**: Technical setup, credential generation, database configuration.
*   **Billing**: **Stripe Invoicing**. The client pays via credit card or invoice through our Stripe Portal inside the app.

### 3. Shopware (Cloud & On-Prem)
*   **Target**: European mid-market/enterprise.
*   **Process**: "Private Extension" upload.
*   **Roles**:
    *   **Sales Team**: Sends the package to client.
    *   **EngOps**: Generates the signed `Naridon.zip` package.
*   **Billing**: **Stripe**. Managed inside the app.

### 4. Any Website (Standalone)
*   **Target**: Magento, WooCommerce, BigCommerce, or custom stacks.
*   **Process**: Self-serve sign up at `https://web.naridon.com`.

---

## 🚀 How to Onboard an Enterprise Client (Step-by-Step)

If you close a deal with a large Shopify brand (e.g., "MegaShoes"), follow this process:

### Phase 1: Preparation (Sales Team)
1.  **Get Shop Domain**: Ask the client for their `myshopify.com` domain (e.g., `megashoes-corp.myshopify.com`).
2.  **Submit Request**: Post in `#eng-ops` channel (or designated tracker):
    > "Request: Custom App Setup for MegaShoes (`megashoes-corp.myshopify.com`)."

### Phase 2: Technical Setup (EngOps)
1.  **Generate Credentials**: EngOps runs scripts to generate Client ID & Secret for the shop.
2.  **Configure DB**: EngOps adds the shop to the `CustomAppConfig` database.
3.  **Generate Link**: EngOps creates the unique installation URL.
4.  **Handoff**: EngOps sends the installation link back to the Sales Team.

### Phase 3: Client Handoff (Sales Team)
1.  **Email the Client**:
    > "Here is your exclusive installation link. Please click this while logged into your Shopify Admin."
2.  **Verify Install**: Confirm with the client that the dashboard loads.

### Phase 4: Billing & Contract
*   **Standard Enterprise**: Tell them to go to "Pricing" tab and subscribe to "PRO" plan via Stripe.
*   **Negotiated Contract**:
    *   **Enterprise Code**: Provide them with a code (e.g., `VIP-ANNUAL-2024`) to bypass the paywall if configured, OR
    *   **Backend Override**: Ask EngOps to set their plan to "PRO" manually in the database.

---

## 💡 Demo Flow Checklist

1.  **Dashboard**: Show the "Visibility Score". Explain it's like a credit score for their store's AI readiness.
2.  **Monitor > Competitors**: Show how we track their rivals. "See? Your competitor changed their price yesterday."
3.  **Fix Engine**: This is the "Magic" moment.
    *   Go to "Fix Engine".
    *   Show a "Weak Title" issue.
    *   Click "Generate Fix".
    *   Show the Before vs After.
    *   Explain: "We do this for your entire catalog automatically."
4.  **Tracking**: Show "Golden Prompts". "We track how often you appear when people ask AI these questions."

## ❓ FAQ

**Q: Do we support multi-currency?**
A: Yes, the dashboard adapts, but billing is currently in USD.

**Q: Can I use this on a headless store?**
A: Yes! Use the Standalone dashboard (`web.naridon.com`) or the Shopify App (it works via API, so headless is fine).

**Q: Is my data safe?**
A: We only read public product data and analytics. We do not touch customer PII (Personal Identifiable Information) unless explicitly authorized for specific features.
