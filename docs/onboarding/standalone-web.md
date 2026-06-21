# Onboarding Guide: Standalone Web (Any Platform)

This guide explains how to use Naridon for any website or e-commerce platform (WooCommerce, Magento, Custom, etc.) using the standalone dashboard.

## Prerequisites
- A website URL.
- An email address.

## Registration Steps
1.  **Visit Dashboard**: Go to [https://web.naridon.com](https://web.naridon.com).
2.  **Sign Up**: Click "Create Account" and enter your email/password.
3.  **Create Workspace**:
    *   Enter your **Company Name**.
    *   Enter your **Website URL** (e.g., `https://example.com`).

## Onboarding Flow
1.  **Product/Content Import**:
    *   Since we don't have direct API access to your store, Naridon will **crawl** your website to discover products and content.
    *   Alternatively, you can upload a CSV/XML product feed (if supported).
2.  **Competitor Setup**: Manually enter your top competitors.
3.  **Prompt Generation**: AI analyzes your crawled content to generate tracking prompts.
4.  **Verification**: You may need to verify domain ownership (DNS or HTML tag) to access advanced features like "Fix Engine" (pushing content updates).

## Billing
Billing is handled via **Stripe**.
-   Manage your subscription directly in the [https://web.naridon.com](https://web.naridon.com) dashboard under "Settings > Billing".

---

## ✅ Deployment Checklist

### Naridon Team (Our Side)
- [ ] **Infrastructure**: Ensure `web.naridon.com` is accessible and scaling.
- [ ] **Crawlers**: Verify web scraper infrastructure (proxies, rate limits) is healthy.

### Customer Side
- [ ] **Sign Up**: Create an account at `web.naridon.com`.
- [ ] **Define Workspace**: Enter website URL and company name.
- [ ] **Verify Domain (Optional)**: Add TXT record if required for advanced features.
- [ ] **Configure Tracking**: Add competitors and keywords/prompts.
- [ ] **Subscribe**: Choose a plan to increase crawling limits.

### Next Steps
1.  **Sitemap Upload**: Provide a sitemap URL to speed up product discovery.
2.  **Invite Team**: Go to "Team Settings" and invite colleagues.
3.  **Check Reporting**: Review automated weekly reports sent to your email.
