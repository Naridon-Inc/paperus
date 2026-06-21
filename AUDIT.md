# Opus System Audit

## 1. Invariant Compliance Check

| Invariant | Status | Verification Evidence |
|-----------|--------|-----------------------|
| **1. Stable Document Identity** | ✅ PASS | `ManifestManager` creates UUIDs. `DocumentEngine` initializes with `docId`, not path. Renames update manifest but keep ID. |
| **2. CRDT as Truth** | ✅ PASS | `ProjectionManager` reads file on open but binds Yjs as the authoritative model. Autosave is derived from Yjs state. |
| **3. Ephemeral Presence** | ✅ PASS | `PresenceManager` uses `y-protocols/awareness`. It is separate from `Y.Doc` history. No presence data is written to disk. |
| **4. Encrypted Storage** | ✅ PASS | `SnapshotManager` encrypts state vectors with `libsodium` (`crypto_secretbox_easy`) before calling `fs:saveSnapshot`. |
| **5. Key Rotation** | ⚠️ PARTIAL | `CryptoManager` supports key generation, but "Re-keying" UI is not yet implemented. Revocation is technically possible but manual. |
| **6. Filesystem Projection** | ✅ PASS | `ProjectionManager` observes Yjs -> writes File. Reconciles File -> Yjs on load. |

## 2. Security Analysis

### 2.1 Encryption at Rest
*   **Mechanism:** `SnapshotManager` generates ephemeral symmetric keys or uses shared document keys.
*   **Verification:** `TESTING.md` Scenario S1 checks that `.bin` files are garbage to the naked eye.
*   **Risk:** Metadata in `manifest.json` (paths, filenames) is currently **plaintext**.
    *   *Mitigation Strategy:* Future version should encrypt the manifest itself using the User's Device Key.

### 2.2 P2P Security
*   **Mechanism:** `y-webrtc` password field is set to the `Room Key`.
*   **Risk:** If the Signaling Server is compromised, it can see *who* is talking to *whom* (metadata leak), but cannot decrypt the content (payload is encrypted).
*   **Mitigation:** `P2PNetwork` derives a `roomName` hash so the raw key is never sent to the signaling server.

### 2.3 Identity
*   **Mechanism:** `Ed25519` keypair generated in `localStorage`.
*   **Risk:** `localStorage` is accessible to any script on the origin. In an Electron context, this is safer than web, but XSS could leak keys.
*   **Mitigation:** Move key storage to `electron-safe-storage` (system keychain) in production build.

## 3. Resilience & Data Integrity

### 3.1 Offline-First
*   **Behavior:** App works 100% without network.
*   **Sync:** `Yjs` queues updates. When `P2PNetwork` connects, it exchanges state vectors.
*   **Conflict:** CRDT guarantees convergence. `TESTING.md` Scenario C1 covers this.

### 3.2 Data Loss Prevention
*   **Snapshots:** Every save creates a restore point.
*   **Redundancy:** Data exists as:
    1.  Visible `file.md` (Projected)
    2.  Hidden `.opus/history/*.bin` (Snapshots)
    3.  IndexedDB `y-indexeddb` (Binary CRDT state)
*   **Risk:** If user deletes `.opus` folder manually, they lose history, but file remains. If they delete file, history remains.

## 4. Conclusion
Opus v1 architecture successfully implements the **Sovereign Knowledge Protocol**. It is a robust, local-first foundation that treats security and identity as first-class citizens, not add-ons.

**Ready for Alpha Testing.**
