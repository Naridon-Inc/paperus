import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { Awareness } from 'y-protocols/awareness'
import { PresenceManager } from './presence'
import { SnapshotManager } from './snapshot'
import { P2PNetwork } from './p2p'
import { e2eeManager } from './e2ee'

function createNoopPersistence() {
  return {
    synced: true,
    destroy: () => {},
    on: () => {},
    once: (ev, cb) => cb && cb()
  }
}

/**
 * Opus Document Engine
 * Manages the lifecycle of a CRDT document.
 *
 * Sync layers (all operate simultaneously when available):
 *   1. IndexedDB  — local persistence, offline-first (both Electron + Web)
 *   2. WebSocket  — cloud relay, DB-persisted on server
 *   3. WebRTC     — direct P2P, zero server data transfer
 *
 * All three feed into the same Y.Doc. Yjs CRDTs handle merge automatically.
 * On Web clients: IndexedDB works natively, WebRTC works natively,
 * WebSocket works natively. No Electron-specific dependencies here.
 */
export class DocumentEngine {
  // Max incremental blobs kept in the encrypted transport log before it's
  // collapsed to a single snapshot (see _compactTransport). Bounds replicated
  // storage AND the window in which deleted text is recoverable from the log.
  static COMPACT_THRESHOLD = 200

  constructor(docId) {
    this.docId = docId
    this.doc = new Y.Doc({ guid: docId })
    console.log(`[Engine] Initializing for DocID: ${docId}`);

    // Awareness State (Part of Yjs but managed via Protocols)
    this.awareness = new Awareness(this.doc)

    // Web thin-client: skip IndexedDB, rely purely on server-backed sync
    this.isWebClient = typeof document !== 'undefined' && document.body?.classList.contains('is-web')

    // Pending ops queue for beforeunload guard (web only)
    this._pendingOps = 0
    this._beforeUnloadHandler = null

    // Durable Storage (Offline Support) — Electron only, skipped on Web
    try {
        const idbEnabled = !this.isWebClient &&
            (typeof window === 'undefined' || window.__opusIndexedDbEnabled !== false)
        if (!idbEnabled) {
          console.warn(`[Engine] IndexedDB ${this.isWebClient ? 'skipped (web thin-client)' : 'disabled by startup probe'}: ${docId}`)
          this.persistence = createNoopPersistence()
        } else {
        console.log(`[Engine] Initializing IndexedDB persistence: ${docId}`);
        const persistence = new IndexeddbPersistence(docId, this.doc)
        this.persistence = persistence

        if (persistence && persistence._db && typeof persistence._db.catch === 'function') {
          persistence._db.catch((e) => {
            console.warn('[Engine] IndexedDB open failed, disabling persistence for this session:', e)
            try {
              this.doc.off('update', persistence._storeUpdate)
              this.doc.off('destroy', persistence.destroy)
              persistence._destroyed = true
            } catch (_) {}
            this.persistence = createNoopPersistence()
          })
        }

        this.persistence.on('synced', () => {
          console.log(`[Engine] ${docId} synced with local IndexedDB`)
        })
        }
    } catch (e) {
        console.warn('[Engine] Persistence failed (Offline support disabled):', e)
        this.persistence = createNoopPersistence()
    }

    // Web thin-client: track pending ops for beforeunload guard
    if (this.isWebClient) {
        this.doc.on('update', (update, origin) => {
            if (origin === 'e2ee-sync' || origin === 'remote') return
            this._pendingOps++
            this._installBeforeUnload()
        })

        // When cloud provider syncs, clear pending ops
        this._onCloudSync = () => {
            this._pendingOps = 0
            this._removeBeforeUnload()
        }
    }

    // Shared Types
    this.text = this.doc.getText('content')
    this.meta = this.doc.getMap('metadata')

    // Undo Manager (Scoped to the text content)
    this.undoManager = new Y.UndoManager(this.text, {
        trackedOrigins: new Set([null, 'user', 'disk-load', 'markdown-upgrade']),
        captureTimeout: 500
    })

    // Presence (Data + UI logic)
    this.presence = new PresenceManager(this.doc, this.awareness)

    // Snapshots (Versioning)
    this.snapshots = new SnapshotManager(this)

    // E2EE properties
    this.isEncrypted = false
    this.docKey = null
    this.transportDoc = null
    this.isSyncingE2EE = false

    // Sync layer references
    this.cloudProvider = null  // WebsocketProvider
    this.network = null        // P2PNetwork (WebRTC)

    // Connection status tracking
    this._syncStatus = { cloud: 'disconnected', p2p: 'disconnected', idb: 'syncing' }
  }

  async setupE2EE(docKey) {
      if (!docKey) throw new Error('Document key is required for E2EE');
      this.isEncrypted = true;
      this.docKey = docKey;

      console.log('[Engine] Setting up E2EE sync for doc:', this.docId);

      // Create a separate document for syncing encrypted blobs
      this.transportDoc = new Y.Doc();
      const updatesArray = this.transportDoc.getArray('encrypted_updates');
      this._transportArray = updatesArray;

      // 1. Send local updates to transport doc. Every blob is bound to this note's
      //    docId (AEAD associated data), so it can never be replayed into another
      //    note's transport log and still authenticate.
      this.doc.on('update', (update, origin) => {
          if (origin === 'e2ee-sync') return; // Don't re-encrypt remote updates

          const encrypted = e2eeManager.encryptUpdate(update, this.docKey, this.docId);
          this.transportDoc.transact(() => {
              updatesArray.push([encrypted]);
          }, 'e2ee-publish');

          // Bound the append-only log: collapse history into a single snapshot
          // once it grows past the threshold (see _compactTransport).
          this._maybeCompactTransport();
      });

      // 2. Receive remote updates from transport doc
      updatesArray.observe(event => {
          event.changes.added.forEach(item => {
              item.content.getContent().forEach(blob => {
                  if (blob instanceof Uint8Array) {
                      const decrypted = e2eeManager.decryptUpdate(blob, this.docKey, this.docId);
                      if (decrypted) {
                          Y.applyUpdate(this.doc, decrypted, 'e2ee-sync');
                      }
                  }
              });
          });
      });

      // Initial migration: If main doc has content but transport is empty, publish it
      if (this.doc.getText('content').length > 0 && updatesArray.length === 0) {
          const fullState = Y.encodeStateAsUpdate(this.doc);
          const encrypted = e2eeManager.encryptUpdate(fullState, this.docKey, this.docId);
          updatesArray.push([encrypted]);
      }

      // Persist the ciphertext at rest too, so our encrypted edits stay durable
      // even when no peer was online to receive them — a later replica serves them.
      this._attachTransportPersistence();
      // A doc loaded from a large on-disk backlog should compact on open too.
      if (this.transportPersistence && typeof this.transportPersistence.once === 'function') {
          this.transportPersistence.once('synced', () => this._maybeCompactTransport());
      }
  }

  /**
   * Compact the encrypted transport log if it has grown past COMPACT_THRESHOLD.
   * Cheap no-op below the threshold, so it's safe to call after every publish.
   */
  _maybeCompactTransport() {
      if (this._compacting || this.isReplicaOnly || !this.docKey || !this._transportArray) return;
      if (this._transportArray.length <= DocumentEngine.COMPACT_THRESHOLD) return;
      this._compactTransport();
  }

  /**
   * Replace the entire append-only log of incremental encrypted updates with a
   * SINGLE fresh full-state snapshot (encrypted), atomically.
   *
   * Why this matters for privacy: the transport log is append-only and is
   * replicated to (and stored by) every team member. Without compaction it keeps
   * the ciphertext of every keystroke forever — so any current OR future
   * key-holder could decrypt the complete edit history, including text that was
   * later deleted. Collapsing to a snapshot of the *current* plaintext state
   * discards that history: deleted content is no longer recoverable from the log.
   *
   * Safety under concurrency: the snapshot is a full CRDT state (idempotent to
   * apply), and Yjs transactions are locally atomic. A peer that concurrently
   * appended a blob keeps it (it sits after the snapshot and merges additively),
   * so compaction can never lose a write — at worst two peers each write a
   * redundant snapshot, collapsed on the next pass.
   */
  _compactTransport() {
      if (!this.transportDoc || !this.docKey || this.isReplicaOnly) return;
      const arr = this._transportArray || this.transportDoc.getArray('encrypted_updates');
      const n = arr.length;
      if (n <= 1) return;
      this._compacting = true;
      try {
          // Snapshot from a GC'd CLONE, not from this.doc directly. this.doc keeps
          // deleted content alive (the UndoManager holds it for undo), so encoding
          // it would smuggle deleted text into the baseline. Replaying the state
          // into a fresh gc:true doc with no undo manager lets Yjs garbage-collect
          // the tombstoned content, so the encoded baseline carries only what's
          // currently visible — a member who joins later and builds from this
          // snapshot can never recover previously-deleted text from the log.
          const clean = new Y.Doc({ gc: true });
          Y.applyUpdate(clean, Y.encodeStateAsUpdate(this.doc));
          const fullState = Y.encodeStateAsUpdate(clean);
          clean.destroy();
          const snapshot = e2eeManager.encryptUpdate(fullState, this.docKey, this.docId);
          this.transportDoc.transact(() => {
              arr.delete(0, n);        // drop all incremental history…
              arr.push([snapshot]);    // …leaving one self-contained, GC'd baseline
          }, 'e2ee-compact');
      } catch (e) {
          console.warn('[Engine] transport compaction failed (non-fatal):', e);
      } finally {
          this._compacting = false;
      }
  }

  /** Force a transport compaction now (used by tests / explicit "forget history"). */
  compactTransport() {
      this._compactTransport();
  }

  /**
   * Persist the encrypted transport doc to IndexedDB (`<docId>:enc`) so the
   * note's ciphertext survives restarts and a (re-formed) replica can serve the
   * latest encrypted state without a live peer. Electron only — the web build is
   * dev-only and intentionally ephemeral. Idempotent.
   */
  _attachTransportPersistence() {
      if (this.transportPersistence || !this.transportDoc) return;
      const idbEnabled = !this.isWebClient &&
          (typeof window === 'undefined' || window.__opusIndexedDbEnabled !== false);
      if (!idbEnabled) return;
      try {
          this.transportPersistence = new IndexeddbPersistence(`${this.docId}:enc`, this.transportDoc);
      } catch (e) {
          console.warn('[Engine] transport persistence failed (ciphertext not durable at rest):', e);
      }
  }

  /**
   * Replicate-only mode: join a doc's swarm and sync its ENCRYPTED transport doc
   * WITHOUT holding the content key. The peer relays/persists ciphertext blindly
   * and never decrypts, so the plaintext `doc` stays empty. This is how a team
   * member backs up a note's ciphertext for availability even when they aren't
   * allowed to read it (every member replicates every note).
   *
   * Setting `isEncrypted` makes connectP2P bind the WebRTC provider to
   * `transportDoc` (the Y.Array of AEAD blobs), exactly like an encrypted reader
   * — the difference is purely that there's no key and no encrypt/decrypt wiring.
   * Like setupE2EE, the transport doc is persisted to IndexedDB (`<docId>:enc`)
   * so the ciphertext survives restarts and this peer can serve it later.
   */
  async setupReplicaOnly() {
      this.isEncrypted = true;       // → connectP2P binds the provider to transportDoc
      this.isReplicaOnly = true;
      this.docKey = null;            // no key — this peer never decrypts
      this.transportDoc = new Y.Doc();

      // A replica has no plaintext, so drop the (empty) plaintext persistence the
      // constructor attached — it must not touch the editor's `<docId>` store.
      try { this.persistence.destroy(); } catch (_e) { /* ignore */ }
      this.persistence = createNoopPersistence();

      // Durable ciphertext at rest, so this peer can serve the note's latest
      // state to others later.
      this._attachTransportPersistence();
  }

  /**
   * Wait for IndexedDB to load the initial state.
   */
  async whenSynced() {
    // Wait for Persistence (IndexedDB)
    if (!this.persistence.synced) {
        await new Promise(resolve => this.persistence.once('synced', resolve));
    }
    this._syncStatus.idb = 'synced'

    // Wait for Cloud Sync (if connected)
    if (this.cloudProvider && !this.cloudProvider.synced) {
        console.log('[Engine] Waiting for Cloud sync...');
        await new Promise(resolve => {
            const onSync = (isSynced) => {
                if (isSynced) {
                    this.cloudProvider.off('sync', onSync);
                    resolve();
                }
            };
            this.cloudProvider.on('sync', onSync);

            // Safety timeout
            setTimeout(() => {
                this.cloudProvider.off('sync', onSync);
                resolve();
            }, 5000);
        });
    }

    // Hook cloud sync acknowledgement for web thin-client beforeunload guard
    if (this.isWebClient && this.cloudProvider && this._onCloudSync) {
        this.cloudProvider.on('sync', (isSynced) => {
            if (isSynced) this._onCloudSync();
        });
    }
  }

  /**
   * Connect to P2P Swarm.
   * Can run simultaneously with cloud sync — both feed the same Y.Doc.
   * IndexedDB persistence captures all updates from both channels.
   */
  connectP2P(roomKeyHex) {
    if (this.network) this.network.disconnect()
    this.network = new P2PNetwork(this, roomKeyHex)
    // Remember the swarm key so a disconnected engine can be reconnected with the
    // same room (used by the mobile companion's foreground/background leaf cycle).
    this._lastSwarmKey = roomKeyHex
    this._syncStatus.p2p = 'connecting'
  }

  disconnectP2P() {
    if (this.network) {
      this.network.disconnect()
      this.network = null
      this._syncStatus.p2p = 'disconnected'
    }
  }

  /**
   * Get current sync status across all layers.
   */
  get syncStatus() {
    return {
      cloud: this.cloudProvider?.wsconnected ? 'connected' : (this.cloudProvider ? 'connecting' : 'disconnected'),
      p2p: this.network?.connected ? 'connected' : (this.network ? 'connecting' : 'disconnected'),
      p2pPeers: this.network?.peerCount || 0,
      idb: this._syncStatus.idb,
      isEncrypted: this.isEncrypted
    }
  }

  _installBeforeUnload() {
    if (this._beforeUnloadHandler || !this.isWebClient) return
    this._beforeUnloadHandler = (e) => {
      if (this._pendingOps > 0) {
        e.preventDefault()
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
        return e.returnValue
      }
    }
    window.addEventListener('beforeunload', this._beforeUnloadHandler)
  }

  _removeBeforeUnload() {
    if (this._beforeUnloadHandler && this._pendingOps === 0) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler)
      this._beforeUnloadHandler = null
    }
  }

  getBinding() {
    return {
      doc: this.doc,
      text: this.text,
      meta: this.meta,
      awareness: this.awareness,
      snapshots: this.snapshots,
      engine: this
    }
  }

  updateMetadata(key, value) {
    this.doc.transact(() => {
      this.meta.set(key, value)
    })
  }

  destroy() {
    console.log(`[Engine] Destroying DocID: ${this.docId}`);
    // Remove beforeunload guard
    if (this._beforeUnloadHandler) {
        window.removeEventListener('beforeunload', this._beforeUnloadHandler);
        this._beforeUnloadHandler = null;
    }
    if (this.cloudProvider) {
        this.cloudProvider.destroy();
        this.cloudProvider = null;
    }
    if (this.network) {
        this.network.disconnect();
        this.network = null;
    }
    if (this.transportPersistence) {
        try { this.transportPersistence.destroy(); } catch (_e) { /* ignore */ }
        this.transportPersistence = null;
    }
    if (this.transportDoc) {
        this.transportDoc.destroy();
        this.transportDoc = null;
    }
    if (this.undoManager) {
        this.undoManager.destroy();
        this.undoManager = null;
    }
    this.presence.destroy()
    this.persistence.destroy()
    this.doc.destroy()
  }
}

/**
 * Unified chokepoint for opening a pure-P2P document (team root, team note, or
 * standalone share). Guarantees the correct ordering so the WebRTC provider
 * always binds to the ENCRYPTED transport doc when an e2eeKey is supplied:
 *
 *   new DocumentEngine → setupE2EE(e2eeKey) → connectP2P(swarmKey) → presence
 *
 * Every P2P doc-open path should route through here rather than wiring the
 * engine by hand, so the E2EE + transportDoc binding (R1) can never be skipped.
 *
 * @param {object}  opts
 * @param {string}  opts.docId      stable Y.Doc guid (e.g. "team-<id>" or a noteId)
 * @param {string}  opts.swarmKey   y-webrtc topic seed + password (hashed before it hits the relay)
 * @param {string} [opts.e2eeKey]   symmetric AEAD key; when present the doc is E2EE end-to-end
 * @param {object} [opts.identity]  { id, name, color?, email? } for presence/cursors
 * @param {boolean}[opts.replicaOnly] open as a blind ciphertext replica (no key,
 *                                  no editor, no presence) — backs up a note's
 *                                  encrypted transport doc for availability
 * @returns {Promise<DocumentEngine>}
 */
export async function openP2PDoc({ docId, swarmKey, e2eeKey, identity, replicaOnly } = {}) {
  if (!docId) throw new Error('openP2PDoc: docId is required')
  if (!swarmKey) throw new Error('openP2PDoc: swarmKey is required')

  const engine = new DocumentEngine(docId)

  // E2EE / transport binding MUST be set up before connectP2P: connectP2P binds
  // the WebRTC provider to engine.transportDoc when isEncrypted, so the transport
  // doc has to exist first or peers would exchange plaintext CRDT ops (R1).
  if (replicaOnly) {
    // Blind ciphertext replica — joins the same swarm and syncs the encrypted
    // transport doc without the content key (never decrypts).
    await engine.setupReplicaOnly()
  } else if (e2eeKey) {
    await engine.setupE2EE(e2eeKey)
  }

  engine.connectP2P(swarmKey)

  // Replicas stay silent (no presence on rooms they're merely relaying).
  if (identity && !replicaOnly) {
    engine.presence.setUser({
      id: identity.id,
      name: identity.name || 'Guest',
      color: identity.color || engine.presence.generateColor(identity.id || identity.email || docId),
      email: identity.email || '',
    })
  }

  return engine
}
