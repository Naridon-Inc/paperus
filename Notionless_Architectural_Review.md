# Notionless: Architectural & Founder Review

> **Date:** Feb 2026
> **Context:** Honest assessment of current architecture vs. promises.

---

## A. Core Architecture & Invariants

### 1. Document Identity
*   **Current Reality:** We use a **hybrid identity**.
    *   **Internal (Sync):** Stable `docId` (UUID). This is used by Yjs and the Backend.
    *   **External (Linking/UI):** File Path. Links are stored as `[Title](path.md)`.
*   **Risk:** If a file is renamed, the `docId` stays the same (sync works), but **markdown links in other files break**.
*   **Mitigation:** We implemented a basic "Backlink Updater" (`fs:updateLinks`), but it relies on Regex text replacement, which is fragile.

### 2. Source of Truth
*   **Hierarchy of Truth:**
    1.  **Yjs Doc (In-Memory)**: The absolute truth during a session.
    2.  **IndexedDB**: The local persistence layer (fastest load).
    3.  **Postgres**: The cloud backup/relay (eventual consistency).
    4.  **Markdown File**: A **Projection** (Export).
*   **Conflict Resolution:** If the Markdown file on disk is edited externally (e.g., VS Code), **Yjs wins** currently (we overwrite the file on save). We do not yet fully support "Two-Way Sync" with external editors.

### 3. Rename & Collaboration
*   **Scenario:** User A renames `Old.md` to `New.md` while User B is editing.
*   **Flow:**
    1.  User A changes title. `renameFile` runs locally.
    2.  User A's file system changes.
    3.  User A syncs metadata update to Server (not fully implemented yet - we sync content, but filename is metadata).
    4.  **Broken State:** User B might still see `Old.md` until they refresh or receive a metadata event. They will likely create a divergent file or get a sync error.

### 4. Presence
*   **Persistence:** Presence (cursors) is **Ephemeral**. It lives only in the WebSocket server's RAM and is broadcasted. It is never written to disk or DB. This is correct and safe.

---

## B. Collaboration & Sync Semantics

### 1. Sync Payload
*   **We sync:** **Yjs Binary Updates** (Uint8Array).
*   **Safety:** This is safe. We do NOT sync full text or diffs. This ensures eventual consistency via CRDTs.

### 2. Offline Conflict (The "2 Hours Later" Scenario)
*   **Behavior:** **Automatic Merge**.
*   **Result:** Yjs will mathematically merge the two paragraphs. If they edited the same sentence, you might see "interleaved" text or a result that preserves both intents. No data is lost, and no "Conflict UI" blocks the user.

### 3. Storage & Compaction
*   **Storage:** We store Yjs updates **forever** in the `YjsUpdate` table.
*   **Compaction:** **None.**
*   **Risk:** The database will grow indefinitely. Loading a document requires downloading *every keystroke history* ever made.
*   **Required Fix:** Implement `Y.encodeStateAsUpdate` snapshots and squash old updates periodically.

### 4. Lightsail Down Scenario
*   **Result:** **Correct Functionality (Local).**
*   Since we are Local-First, the app works perfectly for the user. They just cannot *see* other users' cursors or receive updates. Nothing breaks.

---

## C. Security & Trust

### 1. Encryption Status
*   **Status:** **Transit Encryption Only (TLS).**
*   **Can we read notes?** **YES.** The backend stores binary Yjs blobs. While not plain text, we *could* load them into a Yjs instance and read them.
*   **Verdict:** We are **Not Zero-Knowledge** today.

### 2. Access Revocation
*   **Method:** We delete the row in `DocumentPermission`.
*   **Effectiveness:**
    *   **Future Access:** Revoked (Server rejects connection).
    *   **Past Data:** The removed user **keeps their local copy**. We cannot remotely wipe their disk. This is a fundamental property of Local-First.

### 3. Key Storage
*   **Keys:** We rely on JWTs for auth. No E2EE private keys are managed yet.

---

## D. File System & Refactoring

### 1. Backlink Updates
*   **Method:** Text Search (Regex).
*   **Limitation:** It is "dumb". If a link is inside a code block, it might still get replaced. If the filename is "Index", it might replace the wrong things.

### 2. External Edits (VS Code)
*   **Who Wins?** **Notionless Wins.**
*   **Risk:** If you edit in VS Code while Notionless is open, Notionless might overwrite your external changes on its next auto-save because it doesn't watch for file changes aggressively enough to merge them back into Yjs state.

### 3. Case Sensitivity
*   **Handling:** We do not handle it. On Linux `Note.md` and `note.md` are different; on Windows/macOS they are the same. This will cause sync issues across platforms.

---

## E. Electron vs. Web

### 1. Web App Status
*   **Status:** **Degraded Client.**
*   **Storage:** IndexedDB (Browser Cache).
*   **Mental Model:** It behaves like a Cloud app. If you clear browser cache, data is lost *unless* it synced to the server.
*   **Persistence:** IndexedDB is **not** durable storage (OS can wipe it under pressure).

---

## F. Business Model vs. Architecture

### 1. Charging for "Sync"
*   **Viability:** Valid. Users pay for the *convenience* of the Relay Server and S3 storage, not access to the data itself.

### 2. Downgrade Logic
*   **Scenario:** Pro -> Free.
*   **Result:** User keeps all files locally. Cloud Sync stops. Web App access stops. No data lock-in.

---

## G. Terminology & Positioning

*   **Current Identity:** A "Notion Alternative" for Writers.
*   **Optimization:** Optimizing for **Writers** (Speed, Focus). Teams features are secondary and currently basic.

---

## H. The Honest Answer

**Q: "Can Notionless read my notes?"**

**A: Technically, yes.**
Today, your data is encrypted *in transit* (HTTPS) and stored securely in our database, but our servers possess the keys to process and relay this data. We are **not** End-to-End Encrypted (Zero Knowledge) yet.

---
