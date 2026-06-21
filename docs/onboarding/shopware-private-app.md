# Onboarding Guide: Shopware Private App

This guide explains how to install Naridon on a Shopware 6 store (Cloud or Self-Hosted).

## Prerequisites
- A Shopware 6 store (Version 6.4+).
- Administrator access to the Shopware Admin.
- The `Naridon.zip` extension file provided by your account manager.

## Installation Steps
1.  **Log in**: Access your Shopware Administration panel (usually `https://your-shop-domain.com/admin`).
2.  **Navigate to Extensions**: Go to **Extensions > My Extensions** in the sidebar.
3.  **Upload**:
    *   Click the **"Upload extension"** button.
    *   Select the `Naridon.zip` file.
4.  **Install**:
    *   Find "Naridon Intelligence" in the list.
    *   Click the **"Install"** link next to it.
5.  **Activate**:
    *   Toggle the switch to **Active**.
6.  **Open App**:
    *   Click on **"Naridon"** in the sidebar (sometimes under "Marketing" or "My Apps").

## Onboarding Flow
Since Shopware apps run in an iframe, the experience is seamless:

1.  **Account Creation**: You might be prompted to create a Naridon account or sign in (if using standalone auth). For integrated apps, it usually auto-provisions based on Shop ID.
2.  **Product Sync**: Naridon connects to your Shopware API to read product data.
3.  **Configuration**: Set up competitors and generate AI tracking prompts.

## Billing
Billing for Shopware Private Apps is handled via **Stripe**.
-   Go to the "Pricing" tab in the Naridon dashboard.
-   Select a plan and pay securely via Stripe.
-   Use "Manage Subscription" to handle billing settings.

---

## ✅ Deployment Checklist

### Naridon Team (Our Side)
- [ ] **Generate Manifest**: Ensure `manifest.xml` has production URLs and the correct secret.
- [ ] **Configure Backend**: Set `SHOPWARE_APP_SECRET` in production SSM/Env.
- [ ] **Package App**: Create the `Naridon.zip` file containing the manifest.
- [ ] **Distribute**: Send the zip file securely to the client.

### Customer Side
- [ ] **Backup Shop**: Ensure Shopware instance is backed up (standard precaution).
- [ ] **Upload Extension**: Upload `Naridon.zip` in Administration.
- [ ] **Install & Activate**: Run installation and toggle activation.
- [ ] **Verify Connection**: Open the app and check if it loads the dashboard.
- [ ] **Subscribe**: Select a plan in the "Pricing" tab.

### Next Steps
1.  **Product Sync**: Allow initial sync of product catalog (happens in background).
2.  **Competitor Setup**: Add competitors to track.
3.  **Regular Review**: Check back weekly for performance reports.
