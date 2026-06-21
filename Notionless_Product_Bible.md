# Notionless: Product & Technical Bible

> **Version:** 1.0
> **Status:** Beta / Pre-Launch
> **Target Audience:** Internal Team & Stakeholders

---

## 1. Executive Summary
**Notionless** is a "Local-First" collaborative workspace designed for speed, privacy, and focus. Unlike Notion or Google Docs, it does not rely on the cloud for basic functionality. It works entirely offline and syncs peer-to-peer (P2P) or via a cloud relay only when needed.

**Core Philosophy:**
1.  **Your Data is Yours**: Files are stored as standard Markdown (`.md`) on the user's local disk.
2.  **Zero Latency**: Editing is instant because it happens locally first.
3.  **Collaboration on Demand**: Share only what you want, with granular permissions.

---

## 2. Key Features

### 2.1 The Editor
A distraction-free writing environment built on **Quill.js**, customized for a block-based feel.
*   **Slash Commands (`/`)**: Instantly add headings, lists, tables, callouts, and more.
*   **Markdown Support**: Full support for standard Markdown syntax.
*   **Media**: Drag-and-drop images (currently local-only for privacy).
*   **Page Linking**: Create new sub-pages instantly (`/page`) which links documents together.

### 2.2 Collaboration & Sync
We use a **Hybrid Sync Architecture** (CRDTs via Yjs):
*   **Local Mode (Default)**: Changes save to disk (`.md`) and IndexedDB.
*   **P2P Mode (Free)**: Users connect directly via WebRTC. Server only handles the handshake (Signaling). Both must be online.
*   **Cloud Mode (Pro)**: Changes sync to our AWS Lightsail backend (PostgreSQL). Allows "Store & Forward" (async collaboration).

### 2.3 File Management
*   **File System Mirror**: The sidebar mirrors the user's actual hard drive folder.
*   **Smart Naming**: Files use underscores (`My_Note.md`) for safety, but display with spaces ("My Note") in the UI.
*   **Backlinks**: Renaming a file automatically updates links to it in other documents (Refactoring).

### 2.4 Team & Permissions
*   **Invite System**: Invite users by email to specific documents.
*   **Roles**:
    *   `VIEW`: Read-only.
    *   `EDIT`: Full edit access.
    *   `OWNER`: Can manage access.
*   **Notifications**: Real-time alerts (via WebSocket) when invited or mentioned.

---

## 3. Technical Architecture

### 3.1 Frontend (Electron + React)
*   **Framework**: Electron (Main process handles FS, Renderer handles UI).
*   **State Management**: Yjs (CRDT) is the single source of truth.
*   **Offline First**: Data persists to `IndexedDB` and `.md` files immediately.

### 3.2 Backend (Node.js on AWS Lightsail)
*   **Service**: Containerized Node.js (Express + WebSocket).
*   **Database**: PostgreSQL (via Prisma). Stores:
    *   Users & Teams
    *   Document Permissions
    *   Yjs Updates (Binary blobs for sync history)
*   **Signaling**: Custom WebSocket handler for P2P connection brokering.

### 3.3 Security
*   **Authentication**: JWT (JSON Web Tokens).
*   **Encryption**:
    *   *Transit*: TLS (HTTPS/WSS).
    *   *P2P*: WebRTC encryption.
    *   *Storage*: Standard Postgres encryption. (Future: Client-side E2EE).

---

## 4. Business Model (Pricing)

### Free Plan ($0)
*   Unlimited local documents.
*   **P2P Sync**: Collaborate via direct connection (requires both online).
*   Export to PDF/HTML.
*   *Strategy*: Viral growth tool.

### Pro Plan ($5/month)
*   **Always-On Cloud Sync**: Devices sync even if offline.
*   **Web Access**: Edit via `notionless.bucksaas.com`.
*   **Version History**: Restore deleted content.
*   *Strategy*: Sustainable revenue (90% margin).

### Team Plan ($10/user/month)
*   Shared Team Workspaces.
*   Centralized Billing & Admin.

---

## 5. Roadmap & Outstanding Issues
### 5.1 Immediate Next Steps
*   **Cloud Asset Storage**: Currently, images are local-only. We need an **S3 Bucket** to allow syncing images across devices.
*   **Web App Polish**: The web version (`notionless.bucksaas.com/app`) needs `window.api` mocking to function fully without Electron.

### 5.2 Future
*   **Mobile App**: React Native wrapper around the editor.
*   **E2EE**: End-to-End Encryption for "Zero Knowledge" cloud storage.
*   **API**: Public API for integrations.

---

## 6. Competitive Analysis: Why Notionless?

### The Notion Problem
Notion is a powerful database tool, but it fails as a pure writing environment:
1.  **Latency**: Notion is "Cloud-First". Every keystroke, every page load depends on their servers. When their API is slow, your thinking slows down.
2.  **Offline Anxiety**: Notion's offline mode is notoriously unreliable. You cannot confidently board a plane and expect to access all your work without pre-loading.
3.  **Data Lock-in**: Your notes are stored in a proprietary database structure. Exporting them often results in messy, disjointed files. You don't truly "own" your data.
4.  **Feature Bloat**: Notion forces you to manage databases, properties, and layouts. It interrupts the "Flow State" of writing.

### The Notionless Solution
Notionless is built for **Speed, Ownership, and Focus**:

| Feature | Notion | Notionless |
| :--- | :--- | :--- |
| **Storage** | Cloud Database (Proprietary) | Local Markdown Files (`.md`) |
| **Offline** | Cache-based (Unreliable) | **Native Local-First** (Always works) |
| **Speed** | 300ms+ latency | **0ms latency** (Instant) |
| **Sync** | Centralized | **P2P + Cloud Relay** (Hybrid) |
| **Privacy** | Access by Notion Staff possible | **P2P Encrypted** / Private Cloud |
| **Portability**| Difficult Export | **Universal Format** (Open in VS Code, Obsidian) |

### Why Teams Switch
*   **Developers**: Love Markdown and Git-friendly file formats.
*   **Writers**: Need a distraction-free environment that doesn't lag.
*   **Privacy-Conscious**: Prefer data to live on their devices, not just in a SaaS silo.

