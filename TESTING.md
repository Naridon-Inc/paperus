# Opus Test Matrix

## 1. Concurrency & Conflict Resolution

| ID | Scenario | Steps | Expected Outcome |
|----|----------|-------|------------------|
| C1 | **Offline Divergence** | 1. User A & B sync. <br> 2. Both go offline. <br> 3. A edits line 1. B edits line 1. <br> 4. Both reconnect. | Content merges deterministically (e.g. "Hello World"). No data lost. |
| C2 | **Rename Race** | 1. A renames `doc.md` -> `notes.md`. <br> 2. B edits `doc.md` concurrently. | Edit applies to the document (ID based), regardless of filename change. |
| C3 | **Delete vs Edit** | 1. A deletes `doc.md`. <br> 2. B edits `doc.md` concurrently. | Edit resurrects the document (add-wins strategy) OR delete wins (tombstone). Opus logic: ID persists? |

## 2. Network & P2P

| ID | Scenario | Steps | Expected Outcome |
|----|----------|-------|------------------|
| N1 | **Signaling Outage** | 1. Signaling server goes down. <br> 2. A & B are already connected. | Direct WebRTC connection persists. Sync continues. |
| N2 | **Firewall Traversal** | 1. A is on Corp Network. B is on Home. <br> 2. Attempt sync. | Connection succeeds (via STUN/TURN if configured) or fails gracefully. |
| N3 | **Key Rotation** | 1. Admin rotates Team Key. <br> 2. Evicted user tries to connect. | Connection rejected / Decryption fails. |

## 3. Persistence & Filesystem

| ID | Scenario | Steps | Expected Outcome |
|----|----------|-------|------------------|
| F1 | **External Edit** | 1. Close Opus. <br> 2. Edit `file.md` in VS Code. <br> 3. Open Opus. | External changes imported into CRDT history as a patch. |
| F2 | **File Lock** | 1. OS locks `file.md` (e.g. open in Word). <br> 2. Opus tries to autosave. | Opus retries silently; UI shows "Saving..." or "Save Failed" without crashing. |
| F3 | **Corruption** | 1. Corrupt `.opus/history` binary files. | App loads latest state from FS. Logs warning. Doesn't crash. |

## 4. Security & Privacy

| ID | Scenario | Steps | Expected Outcome |
|----|----------|-------|------------------|
| S1 | **Snapshot Inspection** | 1. Open `.opus/history/snapshot.bin`. <br> 2. Read contents. | Content is binary garbage (Encrypted). Cannot derive text without key. |
| S2 | **Relay Inspection** | 1. Intercept traffic to Relay. | Payload is encrypted blob. No plaintext text/metadata leaks. |
| S3 | **Key Leak** | 1. Private Key deleted from LocalStorage. | User cannot decrypt documents. (Correct behavior). |

## 5. UI & UX

| ID | Scenario | Steps | Expected Outcome |
|----|----------|-------|------------------|
| U1 | **Large File** | 1. Paste 1MB of text. | Editor remains responsive. Autosave finishes < 200ms. |
| U2 | **Rapid Typing** | 1. Mash keyboard. | Autosave debounces correctly (doesn't write to disk on every keystroke). |
| U3 | **History Restore** | 1. Restore old version. <br> 2. Verify new edit on top. | History line is preserved. Old snapshots accessible. |
