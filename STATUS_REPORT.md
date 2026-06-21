# Opus – Detailed Status & Architecture Check

## 1. Core Editor & Local-First Behavior

*   **Can I create a document and edit it fully offline with zero errors?**
    *   **Yes.** The editor uses `IndexeddbPersistence` (via `y-indexeddb`) to store the Yjs document state locally in the browser's IndexedDB. This allows full offline editing capability.
*   **Where exactly is the document stored on disk?**
    *   **Path:** Documents are stored as `.md` files in the user-selected project folder (e.g., `/Users/muhammed/Documents/Opus/test.md`).
    *   **Format:** The disk contains standard Markdown files. However, the application uses a "dual-storage" approach:
        *   **Canonical State:** The `Yjs` CRDT document (stored in IndexedDB) is the true runtime state, preserving edit history and metadata.
        *   **Projection:** The `.md` file on disk is a *projection* of this state, updated via `window.api.writeFile` whenever the editor content changes.
*   **Is Markdown the canonical format, or a projection from another state?**
    *   **Projection.** The Yjs document (`docEngine.doc`) is the source of truth for the session. The Markdown file is generated from the Quill editor content for compatibility with external tools.
*   **What happens if the app crashes mid-edit — do I lose anything?**
    *   **Minimal loss.** Yjs updates are persisted to IndexedDB almost immediately. Upon restart, the app loads the state from IndexedDB first. The file system write (`saveCurrentFile`) is debounced (1s), so a crash within that second might lose the update to the `.md` file, but the internal state should be preserved in IndexedDB.
*   **Can I open the same folder in a normal editor (VS Code) and see readable files?**
    *   **Yes.** The files are standard Markdown.
*   **If I edit the file externally while Opus is open, what exactly happens?**
    *   **Currently undefined behavior / race condition.** The app watches for *renames* (via `metadata.observe` in Yjs), but I did not find active `fs.watch` listeners in `main.js` that reload file content if it changes externally while the file is open. If you edit in VS Code, Opus might overwrite your changes on its next save cycle.

## 2. Document Identity & Renames

*   **Does each document have a stable internal ID (docId) independent of file path?**
    *   **Yes.** The `ManifestManager` (`src/main/manifest.js`) maintains a mapping of file paths to stable UUIDs (`docId`).
*   **What happens internally when I rename a file?**
    *   1. The `fs:rename` IPC is called to move the file on disk.
    *   2. The Yjs document's `metadata` map is updated with the new filename.
    *   3. The local `sidebar-manager` updates the UI path.
    *   4. `fs:updateLinks` is called to update back-links.
*   **If another peer is editing while a rename happens, what do they see?**
    *   Peers listen to the `metadata` map. When the filename changes there, the peer's client attempts to replicate the rename locally (effectively a move operation) if they have the file access.
*   **Do links between documents break on rename? If yes, how?**
    *   **Links are resilient.** The editor uses a custom `page-link` blot that stores the `docId`. When clicking, it resolves the `docId` to the current path using the Manifest, making links robust against renames.
*   **Are links path-based or ID-based today?**
    *   **ID-based** primarily (`docId` stored in blot), with a path fallback.

## 3. CRDT (Very Important)

*   **What CRDT library are we using?**
    *   **Yjs**.
*   **What exactly is synchronized between peers?**
    *   **Ops (Update Blobs).** Peers exchange Yjs update messages (binary blobs representing operations).
*   **Can two users edit the same paragraph offline and merge later?**
    *   **Yes.** Yjs handles conflict resolution automatically.
*   **What does the merged result look like in that case?**
    *   It depends on the specific edits, but generally, it interleaves characters or paragraphs without data loss. It does not use "conflict markers" like Git; it converges to a consistent state.
*   **Where are CRDT updates stored locally?**
    *   **IndexedDB** (browser-side database).
*   **Where are CRDT updates stored remotely (if at all)?**
    *   **Postgres Database.** The backend (`backend/src/yjs-handler.js`) listens for updates and saves them as binary blobs in the `YjsUpdate` table.
*   **Is there any compaction or snapshotting, or does history grow forever?**
    *   **Grows forever (Database).** The `YjsUpdate` table accumulates updates indefinitely. There is no logic currently implemented to squash/compact these updates into a single snapshot on the server side.

## 4. Realtime Collaboration & Presence

*   **Can two users type at the same time and see each other live?**
    *   **Yes.**
*   **Are cursors / selections visible?**
    *   **Yes.** Handled by `y-protocols/awareness` and `PresenceManager`.
*   **Is presence data ever written to disk or DB?**
    *   **No.** Presence is ephemeral and only exchanged over the WebSocket connection.
*   **What happens to presence if a user disconnects abruptly?**
    *   The WebSocket connection closes, and other peers remove the user from their awareness state (cursor disappears).
*   **Can presence affect document state in any way?**
    *   **No.** It is a separate layer.

## 5. Sharing Model

*   **What are the two types of documents today: local vs shared?**
    *   **Local:** Files living on your file system, managed by `ManifestManager`.
    *   **Shared (Cloud):** Documents that exist primarily on the Cloud/Backend. They are accessed via the "Shared" list and stored in IndexedDB, but not necessarily mirrored as files in your local project folder.
*   **Where do shared documents live on the receiver’s machine?**
    *   **IndexedDB.** They are not downloaded as files to the user's hard drive unless they are manually "Imported" or saved.
*   **Does sharing force the sender’s folder structure onto the receiver?**
    *   **No.** Shared documents appear as a flat list in the "Shared" section.
*   **Can the receiver choose where shared files live locally?**
    *   **No.** They are virtual/cloud-only documents in the current implementation.
*   **Can a shared document be moved locally without affecting others?**
    *   N/A (since they aren't local files).
*   **Can the sender choose to share:**
    *   *Single document?* **Yes.**
    *   *Multiple documents?* **No** (UI only supports single doc share).
    *   *Read-only vs edit?* **Yes** (Role selection exists: VIEW/EDIT).
*   **What happens when access is revoked?**
    *   The user will fail to fetch document permissions/content upon next refresh. If they have the document open, the WebSocket connection might stay active until a reconnect forces re-authorization.

## 6. Permissions & Access Control

*   **How are permissions enforced — UI only or at data level?**
    *   **Backend Level.** The `documents.js` and `teams.js` endpoints check `DocumentPermission` tables.
    *   **WebSocket Level:** The `setupWSConnection` in `index.js` checks the token, but it does **not** explicitly check `DocumentPermission` for the specific document ID before establishing the Yjs sync stream. **This is a security gap.** (Any authenticated user might be able to connect to any room if they guess the ID).
*   **If a user has the file locally but access is revoked, what stops edits?**
    *   If they have a local copy (FS), nothing stops them. If it's a Cloud Doc (IndexedDB), they can edit offline, but their changes will be rejected (or rather, just not synced/merged if the socket rejects them) when they reconnect.
*   **Can a revoked user still see old content?**
    *   **Yes.** The content remains in their local IndexedDB cache.
*   **Is this expected behavior or a limitation?**
    *   Expected for "Local-First" software (you own your device's state).

## 7. Sync & Transport

*   **What sync transports exist today?**
    *   **WebSocket (Cloud)**: Primary method for sharing.
    *   **WebRTC (P2P)**: Implemented in `p2p.js`, uses public signaling servers (and our own).
*   **Is sync modular, or hard-coded to one backend?**
    *   **Semi-modular.** `DocumentEngine` accepts a provider. `team.js` hardcodes the WebSocket URL. `p2p.js` handles WebRTC.
*   **Can the app run with zero servers online?**
    *   **Yes.** Local editing works fine. P2P sync (via `y-webrtc`) works if users are on the same LAN or can reach public signaling servers.
*   **If yes, what features stop working?**
    *   Cloud Sharing ("Shared" list), Permissions management, Auth/Login.
*   **Can we point the app to a custom WebSocket server today?**
    *   **No.** The URL is hardcoded in `auth-client.js`, `team.js`, `notifications.js`.
*   **If not, what’s missing to make sync pluggable?**
    *   A configuration UI to set the `API_URL` and `WS_URL`.

## 8. Privacy & Security

*   **Is data end-to-end encrypted today?**
    *   **Cloud Sync:** **No.** Updates are sent to the server and stored as binary blobs. The server *could* read them using Yjs libraries.
    *   **P2P Sync:** **Yes.** `y-webrtc` uses the room key as a password for encryption.
    *   **Snapshots:** `SnapshotManager` uses `libsodium` to encrypt snapshots before sending them to the backend storage.
*   **Can our backend technically read user documents?**
    *   **Yes** (for live Cloud Sync documents).
*   **Where are auth credentials stored locally?**
    *   `localStorage` (`auth_token`).
*   **Are there any private keys today, or only JWTs?**
    *   `crypto.js` manages an `opus_id_private` key in `localStorage` for signing/encryption purposes (used for snapshots/identity).
*   **What would need to change to support E2EE cleanly?**
    *   The Yjs updates sent over WebSocket need to be encrypted *before* leaving the client, and the server should just relay the opaque blobs. `y-webrtc` does this; `y-websocket` standard server does not. We'd need to layer encryption on top of the WebSocket provider.

## 9. On-Prem / Enterprise Readiness

*   **Could a company run Opus without touching our cloud at all?**
    *   **Yes.** The backend is Dockerized.
*   **What would they need to deploy?**
    *   The `notionless-backend` Docker container + a Postgres Database.
*   **Is anything in the core assuming “our server” exists?**
    *   Hardcoded URLs in the renderer code (`auth-client.js`).
*   **Are there any hard blockers for on-prem usage today?**
    *   Changing the hardcoded URLs requires rebuilding the client app.

## 10. Extensibility & Future Safety

*   **Is the core editor logic decoupled from networking?**
    *   **Yes.** `DocumentEngine` holds the state; providers (WS, P2P) are attached separately.
*   **Could we add a new sync transport without touching the editor?**
    *   **Yes.**
*   **Is the filesystem layer replaceable?**
    *   **Yes.** It communicates via IPC (`window.api.invoke`). The renderer doesn't use Node `fs` directly.
*   **Are there any shortcuts taken that will block:**
    *   *E2EE?* **Yes.** The current Cloud Sync relies on the server understanding Yjs updates (for `y-indexeddb` persistence on server-side logic in `yjs-handler`). E2EE would break server-side persistence unless we switch to "blind storage".
    *   *On-prem?* **No**, just config needed.
    *   *Mobile?* **No**, architecture (CRDT/Local-first) is ideal for mobile.

## 11. Brutal Reality Check

*   **What can a real user successfully do today without hitting bugs?**
    *   Create local notes, write/edit Markdown, rename files, and share a document with another user (who can view/edit it).
*   **What is the most fragile part of the system right now?**
    *   **Cloud Document Persistence vs. Local File System.** The distinction between a "Local File" and a "Cloud Document" is blurry. A cloud doc lives in IndexedDB/Server, while a local doc lives on disk. If a user expects "Shared" files to appear in their Finder/Explorer, they will be confused.
*   **What is the biggest technical risk you see?**
    *   **Yjs History Bloat.** Storing every single keystroke update in Postgres (`YjsUpdate` table) without compaction will eventually scale poorly and slow down document loading times significantly.
*   **If we froze features and only stabilized for 2 weeks, what would you focus on?**
    *   1. **Unified Storage Model:** Make Shared docs sync to disk so they are just files like everything else.
    *   2. **Conflict Resolution for File System:** Handle external edits/moves gracefully.
    *   3. **History Compaction:** Implement server-side snapshotting/squashing of Yjs updates.

## 12. Final Question

**In one paragraph: how far is this from a solid beta, and what specifically is missing?**

Opus is effectively an **Early Alpha**. It has a functional core (editor, CRDT, basic sharing), but it lacks the robustness required for a beta. Specifically missing: **E2EE for cloud sync** (security), **server-side history compaction** (performance/scalability), **unified file-system sync for shared documents** (UX consistency), and **configurable endpoints** for on-prem deployment. The foundational architecture is sound (Local-First/Yjs), but the "glue" holding the Cloud and Local worlds together is thin.
