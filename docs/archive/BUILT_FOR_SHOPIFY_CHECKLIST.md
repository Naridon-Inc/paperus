# Built for Shopify Certification Checklist

This checklist covers the key requirements to achieve the "Built for Shopify" badge, which signifies the highest level of app quality, performance, and security.

## 🚀 1. Performance & Vitals
*Criteria: Must meet Core Web Vitals thresholds.*

- [ ] **LCP (Largest Contentful Paint)**: ≤ 2.5s for 75% of users.
- [ ] **FID (First Input Delay)**: ≤ 100ms (or INP ≤ 200ms).
- [ ] **CLS (Cumulative Layout Shift)**: ≤ 0.1.
- [ ] **Admin Performance**: App loads within 400ms inside the Shopify Admin.
- [ ] **Minimize Reflows**: Avoid layout shifts when data loads (use skeletons).

## 🛡️ 2. Security & Reliability
*Criteria: Secure data handling and stable uptime.*

- [x] **GDPR Webhooks**: Implement `customers/data_request`, `customers/redact`, `shop/redact`.
- [ ] **Protected Customer Data**: Only request necessary scopes.
- [x] **CSP Headers**: Implement Content Security Policy correctly for embedded apps.
- [ ] **Error Rate**: Maintain < 1% error rate on API calls.
- [ ] **Uptime**: Maintain > 99.9% uptime.

## 🎨 3. Design & User Experience
*Criteria: Native Shopify look and feel.*

- [x] **Polaris Components**: Use Shopify Polaris for all UI elements.
- [x] **App Bridge**: Use App Bridge for navigation, modals, and toasts.
- [ ] **Embedded App**: App must be embedded in the Shopify Admin (unless valid exemption).
- [ ] **Mobile Responsive**: UI must work perfectly on mobile devices.
- [ ] **Accessible**: Follow WCAG 2.1 AA standards (color contrast, keyboard nav).

## 🔌 4. API Usage & Architecture
*Criteria: Efficient and modern API usage.*

- [ ] **GraphQL First**: Prefer GraphQL over REST for Admin API calls.
- [ ] **Rate Limits**: Handle `429 Too Many Requests` gracefully (retry logic).
- [ ] **Webhooks**: Use webhooks for data sync instead of polling.
- [ ] **Session Tokens**: Use Session Tokens (JWT) instead of cookies for auth.
- [ ] **API Versioning**: Use a supported stable API version (no deprecated versions).

## 🛒 5. App Listing & Onboarding
*Criteria: Clear value proposition and easy setup.*

- [ ] **Listing Quality**: High-quality icon, screenshots, and description.
- [ ] **Onboarding Flow**: Self-contained onboarding within the app (no external redirects if possible).
- [ ] **Zero-Config Setup**: App should work "out of the box" or guide setup clearly.
- [ ] **Support**: Accessible support channel (email/chat) from within the app.

## 📋 6. Specific "Built for Shopify" Rules
*Criteria: Automatic checks by Shopify.*

- [ ] **No "Flash of Unstyled Content"**: App must look native immediately.
- [x] **Clean Uninstall**: App must clean up script tags/assets upon uninstallation (via `app/uninstalled` webhook).
- [ ] **Performance Dashboard**: Check the "App Health" section in Partner Dashboard regularly.

## ✅ Verification Steps

1.  **Run Lighthouse**: Audit your app's performance in Chrome DevTools.
2.  **Partner Dashboard**: Check "App Health" > "Vitals" for real-world metrics.
3.  **Theme Check**: If you have a theme extension, run `shopify theme check`.
4.  **Polaris Review**: Manually verify all UI components match Polaris guidelines.
