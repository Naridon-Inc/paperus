# Opus: Roadmap to Beta (v0.2)

**Current Status:** Alpha (v0.1.5)
**Target:** Solid Beta (v0.2)
**Focus:** Cloud-First Architecture, Web App parity, and Scalability.

---

## 1. The Core Philosophy (Pivot)

> **"Opus is a cloud-native collaboration platform with a local-first option for Mac/Linux. Web and Windows are Cloud-Only."**

We are shifting priority from local file system projection to a robust **Cloud File System**. Local filesystem features on Mac/Linux are now secondary stabilization tasks.

---

## 2. Mandatory Milestones (Must-Fix for Beta)

### 🔴 M1: Cloud File System (The "Notion-like" Core)
*   **Goal:** Fully manageable folders and documents in the database.
*   **Status:** Backend schema and API implemented.
*   **Next Steps:**
    *   Refactor frontend to use the Cloud FS by default on all platforms.
    *   Implement "Move document" and "Delete document" in the UI.

### 🔴 M2: Web App Parity
*   **Goal:** Running Opus in any browser without Electron.
*   **Status:** Initial scaffolding and Nginx container deployed.
*   **Next Steps:**
    *   Port full editor UI to the web build.
    *   Implement browser-side authentication (localStorage).

### 🔴 M3: History Compaction & Scalability
*   **Goal:** Prevent database performance degradation.
*   **Status:** Backend snapshotting implemented.
*   **Next Steps:**
    *   Verify compaction under heavy load.

### 🔴 M4: Multi-User Collaboration Polish
*   **Goal:** Smooth live editing experience.
*   **Next Steps:**
    *   Finalize Presence (Live cursors) for Web users.
    *   Fix stacking context issues (Inbox/Sidebar) globally.

---

## 3. Deprioritized / Optional (Post-v1.0)

*   **P2P for Windows:** Windows remains Cloud-Only for simplicity.
*   **Advanced File System Watching:** Reduced focus on local FS conflicts.

---

## 4. Technical Narrative for Early Adopters

*   **What Opus IS:** A local-first editor that syncs. Your data lives on your disk. Encryption is available for P2P.
*   **What Opus IS NOT (Yet):** A fully E2EE cloud vault (Server can currently read sync stream for persistence). A dropbox replacement (Sync is for docs, not arbitrary files).

---

## 5. Next Steps

1.  **Freeze Feature Development:** No new UI features until M1-M3 are complete.
2.  **Begin M1 (Unified Storage):** Design the `Shared` folder structure and projection logic.
