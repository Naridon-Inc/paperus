# 06\. Auth & Security: Multi-Platform Identity Management

This document details the transition to a hybrid authentication model.

## 1\. Identity Providers
### 1.1 Federated Identity (E-commerce / Apps)

1.  **Shopify**: Uses OAuth 2.0 and Session Tokens.
2.  **Shopware**: Uses App Handshake and Signature verification.

### 1.2 Direct Identity (SaaS Web)

1.  **Email/Password**: Standard database-backed login (via Supabase or Auth0).
2.  **Social Login**: Google/GitHub.
3.  **CMS Auth**:
4.  "Login with Webflow" (OAuth) to auto-import sites.
5.  "Connect WordPress" (Application Password or OAuth).

## 2\. The Unified Token Model

Regardless of the login method, the backend issues a **Naridon JWT**.

**Payload Structure:**

{

"orgId": "UUID",

"projectId": "UUID",

"identityId": "UUID",

"platform": "SHOPIFY | WEB | WORDPRESS | WEBFLOW",

"role": "OWNER | ADMIN | VIEWER",

"scope": \["read:content", "write:fixes"\]

}

## 3\. Implementation Plan

1.  **Auth Middleware Upgrade**: Modify `backend/delivery/api/src/middleware/auth.ts` to support both Session Tokens and standard Bearer JWTs.
2.  **Organization Scope**: Ensure all DB queries filter by `orgId` (Multi-tenancy).
3.  **Cross-Origin Isolation**: Configure CORS to allow `app.naridon.com` (Shopify), `web.naridon.com` (SaaS), and `*.webflow.io` (if creating a Webflow App).