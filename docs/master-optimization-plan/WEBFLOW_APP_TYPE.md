# Webflow Integration: App Type Decision

## Options Analysis (2026)

Webflow offers three main integration types. Here is how they map to Naridon's "Command Center" vision:

### 1. Data Client App (Our Choice) ✅
*   **What it is**: A server-side application that connects to Webflow via OAuth 2.0.
*   **Where it lives**: Outside of Webflow (on our Standalone Dashboard).
*   **Capabilities**:
    *   Read/Write CMS Items (Blogs, Products).
    *   Read/Write Static Pages (SEO Metadata).
    *   Manage Assets.
*   **Why it fits**:
    *   Matches our "Command Center" model where the user manages multiple platforms from *our* UI.
    *   Allows us to run heavy AI jobs on our infrastructure without blocking the Webflow designer.
    *   Zero friction for agencies managing client sites (just auth and go).

### 2. Designer Extension
*   **What it is**: An app that runs *inside* the Webflow Designer canvas (like a Figma plugin).
*   **Use Case**: Drag-and-drop components, real-time styling helpers.
*   **Why NOT now**:
    *   Too narrow. We want to optimize *published* content for AEO, not just help design the layout.
    *   Forces the user to be "in the designer," breaking the unified dashboard flow.

### 3. Site Token (Internal Integration)
*   **What it is**: A manual API key generated per site.
*   **Why NOT now**:
    *   Good for testing, but bad UX for a SaaS product. We need OAuth for a seamless "One-Click Connect" experience.

## The Plan: "Naridon for Webflow" (Data Client)
We will build a **Data Client Application** that uses the Webflow Data API v2.

### User Flow
1.  User logs into Naridon Standalone Dashboard.
2.  Clicks "Add Project" -> "Connect Webflow."
3.  Redirects to Webflow OAuth screen -> User selects their Workspace/Site.
4.  Redirects back to Naridon.
5.  Naridon syncs the site structure (Pages + Collections) as a new `Shop` (Project).
6.  User runs an Audit -> Naridon pulls content via API -> AI analyzes -> Fixes proposed.
7.  User clicks "Apply" -> Naridon pushes updates back to Webflow via API.
