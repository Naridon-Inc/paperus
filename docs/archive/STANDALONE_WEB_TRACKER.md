# Standalone Web App Implementation Tracker

**Goal:** Launch a fully functional SaaS version of Naridon (`web.naridon.com`) that allows users to sign up via email and monitor any website URL.

## 1. Authentication Foundation (The "Key")
- [ ] **Database Schema**: Add `User` model to `schema.prisma`.
- [ ] **Domain Entity**: Create `User` entity in `backend/domain`.
- [ ] **Auth Repository**: Implement `IUserRepository`.
- [ ] **Auth Service**: Implement `PasswordService` (hashing).
- [ ] **API Routes**:
    - [ ] `POST /auth/signup`
    - [ ] `POST /auth/login`
- [ ] **Frontend Login Page**: Connect `LoginPage.tsx` to real API.

## 2. Resource Management (The "Subject")
- [ ] **Database Schema**: Update `Product` to generic `Resource` (polymorphic fields).
- [ ] **Scraper Service**: Implement `Cheerio` scraper to fetch Title/Desc from URL.
- [ ] **API Routes**:
    - [ ] `POST /api/v1/resources`: Add URL.
    - [ ] `GET /api/v1/resources`: List mixed resources.
- [ ] **Frontend Modal**: "Add Resource" modal in Standalone App.

## 3. Shared UI Refactor (The "View")
- [ ] **Data Normalization**: Ensure `useMonitorDashboard` returns a unified `resource` shape.
- [ ] **Conditional Rendering**: Update `ProductList` to handle:
    - [ ] Ecommerce Items (Price, SKU).
    - [ ] Web Pages (URL, Last Crawled).
- [ ] **Navigation**: Fix `useNavigate` calls to be router-agnostic (already started).

## 4. Optimization Engine Adapter (The "Fix")
- [ ] **Web Content Adapter**: Implement `IContentAdapter` for generic URLs.
    - [ ] `getProducts()` -> Returns list of tracked URLs.
    - [ ] `updateProduct()` -> Returns "Not Supported" or "Copy Fix".

## 5. Deployment
- [ ] **Vercel Project**: Set up `web.naridon.com`.
- [ ] **Environment**: Configure production env vars for standalone app.
