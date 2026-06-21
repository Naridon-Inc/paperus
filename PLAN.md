# Opus: The Sovereign Knowledge Protocol

## 1. Executive Summary
Opus is a **Local-First, End-to-End Encrypted (E2EE), Peer-to-Peer (P2P)** collaboration platform. It reimagines the document not as a file on a server, but as a **cryptographic object** owned by the user, synchronized directly between devices.

**The Promise:**
1.  **Sovereignty:** You own your data. It lives on your disk. No cloud provider can delete it.
2.  **Privacy:** Everything is encrypted before it leaves your device.
3.  **Resilience:** Works offline. Syncs when online. No central point of failure.

---

## 2. Detailed Architecture

### 2.1 Layer 1: The Local Engine (Storage & Versioning)
This layer manages the "Source of Truth" on the user's file system.

*   **File Format:** Standard **Markdown (`.md`)**. This ensures zero vendor lock-in. You can open your notes in VS Code, Obsidian, or Notepad.
*   **Shadow Repository (`.opus`):** A hidden directory in every project root that acts like a `.git` folder.
    *   `/.opus/history/`: Stores compressed snapshots of files.
        *   **Format:** `[timestamp]_[hash].snap` (Binary or compressed JSON).
        *   **Retention:** Rolling window (e.g., last 100 edits + key milestones).
    *   `/.opus/manifest.json`: The "Brain" of the folder. Tracks:
        *   **File IDs:** UUIDs mapped to file paths (handles renames).
        *   **Signatures:** Cryptographic signatures of the latest versions.
        *   **Permissions:** Who has access to what (Public Keys).

**The Save Cycle (Autosave):**
1.  **Trigger:** User stops typing for `1000ms`.
2.  **Action:** 
    *   Write content to `file.md` (Human readable).
    *   Compute `SHA-256` hash.
    *   If hash differs from last snapshot -> Write new snapshot to `/.opus/history/`.
3.  **UI Feedback:** Change footer status from "Unsaved" -> "Saving..." -> "Saved".

### 2.2 Layer 2: The Synchronization Layer (P2P)
This layer handles moving data between devices without a central storage server.

*   **CRDT Engine (Yjs):** 
    *   We don't sync text; we sync **Operations** (e.g., *User A inserted 'x' at index 5*).
    *   This guarantees eventual consistency. No "Merge Conflict" dialogs.
*   **Networking Stack:**
    *   **Transport:** `WebRTC` (UDP) for high-performance, low-latency direct connections.
    *   **Signaling:** A lightweight WebSocket server used *only* for discovery ("I am here, where are you?"). It hands off the connection and steps away.
    *   **Protocol:** `y-webrtc` adapted for E2EE.
*   **The "Swarm":** 
    *   A Swarm is defined by a **Topic ID** (Hash of the Shared Secret).
    *   Anyone with the Secret can derive the Topic ID and join the Swarm.

### 2.3 Layer 3: Identity & Security (The "Circles" Model)
Security is not an afterthought; it is the foundation.

*   **Identity (DID-like):**
    *   **Private Key:** `Ed25519` key generated on first run. Stored in system Keychain (future) or LocalStorage (prototype).
    *   **Public Key:** Your User ID. Safe to share.
*   **Encryption Hierarchy:**
    1.  **Device Key:** Encrypts the `.opus` folder at rest (Optional).
    2.  **Room Key (Symmetric):** A random AES-256 key generated for a specific document or folder.
    3.  **Key Exchange:** To invite Alice:
        *   You fetch Alice's Public Key.
        *   You encrypt the `Room Key` with Alice's Public Key.
        *   You send this "Envelope" to Alice via the Swarm.

---

## 3. User Experience (UX)

### 3.1 The "Time Travel" Interface
Instead of a simple "Undo", Opus offers a linear timeline.
*   **UI:** A slider or list in the sidebar.
*   **Interaction:** Dragging the slider instantly updates the editor to show the document state at that timestamp.
*   **Action:** "Restore this version" creates a new commit on top of the current state (reverting without losing history).

### 3.2 The "Circle" Interface (Collaboration)
*   **Inviting:** Click "Share" -> Generates a magic link or QR code containing the **Room Key**.
*   **Presence:** See colored cursors of active peers.
*   **Offline Indicator:** "Last synced 5 mins ago" (Vector clock comparison).

---

## 4. Monetization: The "Convenience" Layer
Since the core software is free and open, we monetize services that bridge the gap between "Sovereign" and "Convenient".

1.  **Opus Relay ($5/month)**
    *   **The Problem:** P2P requires both devices to be online.
    *   **The Solution:** An encrypted "Dead Drop".
    *   **How it works:** You push encrypted updates to the Relay. Later, your phone pulls them. The Relay cannot read your data (Zero Knowledge).

2.  **Opus Enterprise ($20/user/month)**
    *   **Audit Logs:** "Who accessed this document?" (Cryptographically signed logs).
    *   **Key Management:** Admin can revoke keys (technically, re-key the documents) if an employee leaves.
    *   **SSO Bridge:** Authenticate via Okta/Google to unlock the local Private Key.

3.  **Opus Names ($10/year)**
    *   Map `0x7f2a...` to `alice.opus`. Human-readable discovery.

---

## 5. Development Roadmap (Updated)

**See [ROADMAP_TO_BETA.md](ROADMAP_TO_BETA.md) for the active engineering plan.**

This project has moved from conceptual phase to active stabilization.

### Legacy Conceptual Milestones
*   **Phase 1 (Prototype):** Basic Editor, .opus folder structure, P2P Stub.
*   **Phase 2 (Core):** Yjs Integration, IndexedDB persistence, WebRTC signaling.
*   **Phase 3 (Cloud Bridge):** WebSocket relay, Postgres storage for offline async.
*   **Phase 4 (Beta - Current):** Unified File Model, History Compaction, Security Hardening.

### Phase 1: Foundation (Completed)
- [x] **Editor:** Rich Text <-> Markdown conversion.
- [x] **File System:** Native file reading/writing.
- [x] **Autosave:** Non-blocking save on idle.
- [x] **Basic P2P:** Connecting peers via shared secret.

### Phase 2: Refinement (Current)
- [ ] **History UI:** Visual timeline of snapshots.
- [ ] **Conflict Handling:** Robust CRDT binding for offline-to-online transitions.
- [ ] **File Tree Sync:** Syncing folder structures, not just individual files.

### Phase 3: Hardening (Future)
- [ ] **Encryption:** Implementing the full `crypto-js` / `libsodium` envelope.
- [ ] **Identity Persistence:** Export/Import Private Keys.
- [ ] **Performance:** Virtualized lists for large document histories.
