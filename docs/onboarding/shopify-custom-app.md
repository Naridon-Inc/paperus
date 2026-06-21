# Onboarding Guide: Shopify Custom App

This guide explains how enterprise clients or specific merchants can install a Custom Distribution of Naridon.

## Prerequisites
- A custom installation link provided by Naridon (e.g., `https://admin.shopify.com/oauth/install_custom_app...`).
- An active Shopify store.

## Installation Steps
1.  **Receive Install Link**: You will receive a unique installation link from your Naridon account manager.
2.  **Click Link**: Open the link while logged into your Shopify Admin.
3.  **Approve Permissions**: You will see a prompt to install "Naridon Custom" (or specific name like "Naridon Adidas"). Click "Install app".
4.  **Redirect**: You will be redirected to the Naridon dashboard inside your Shopify Admin.

## Onboarding Flow
The flow is identical to the Public App, but tailored for your specific needs:

1.  **Welcome & Configuration**: The app is pre-configured with your enterprise settings if applicable.
2.  **Competitor Setup**: Enter key competitors or let AI suggest them.
3.  **Prompt Generation**: AI generates tracking prompts based on your catalog.

## Billing (Stripe)
Unlike public apps, Custom Apps use **Stripe** for billing.

1.  **Trial Activation**: You may start with a free trial.
2.  **Manage Subscription**:
    *   Go to the "Pricing" tab in the app.
    *   Click "Manage Subscription" to open the secure Stripe Customer Portal.
    *   Here you can update payment methods, view invoices, or change plans.
3.  **Enterprise Codes**: If you have a negotiated contract, you might use an "Enterprise Code" to unlock specific limits without a credit card flow.

---

## ✅ Deployment Checklist

### EngOps / SalesOps (Technical Setup)
- [ ] **Generate Credentials**: Create API Key/Secret for the specific shop (`scripts/add-custom-app.ts`).
- [ ] **Configure DB**: Add `CustomAppConfig` entry for the shop domain.
- [ ] **Deploy Config**: Create and push `shopify.app.[client].toml` (optional but recommended).
- [ ] **Generate Install Link**: Create the OAuth installation link using the Client ID and correct `permanent_domain`.
- [ ] **Handoff**: Provide the installation link to the Sales Team.

### Sales Team (Communication)
- [ ] **Request Setup**: Provide EngOps with the client's `myshopify.com` domain.
- [ ] **Send Email**: Send the install link and instructions to the client.
- [ ] **Support**: Guide the client through permission approval if needed.

### Customer Side
- [ ] **Access Store**: Ensure you have Admin access to the Shopify store.
- [ ] **Install App**: Click the provided link and approve permissions.
- [ ] **Select Plan**:
    -   Navigate to "Pricing" tab.
    -   Choose a plan (Starter/Growth/Pro).
    -   Complete payment via Stripe Checkout.
- [ ] **Verify Setup**: Ensure Dashboard loads and initial scan begins.

### Next Steps
1.  **Review Prompts**: Go to "Monitor > Tracking" and approve/edit the AI-generated prompts.
2.  **Wait for Data**: Allow 24 hours for the first full competitor analysis and fix suggestions to populate.
3.  **Schedule Training**: Book a 15-min walkthrough call with our success team (optional).
