// @ts-nocheck
/**
 * session.ts — TeamSession: the live runtime for one joined team.
 *
 * Holds the team ROOT doc (note index + roster) and lazily-opened per-note docs,
 * each through the same `openP2PDoc` chokepoint (E2EE + P2P). Exposes the live
 * note tree, connection status, online-presence count, and note CRUD. Screens
 * subscribe via `subscribe()`.
 *
 * Per-note CONTENT syncs only while some peer has that note open in the same
 * derived room — so editing a note here syncs with a desktop that also has the
 * note open. Offline persistence keeps the phone's own copy regardless.
 */
import { openP2PDoc } from './p2p-doc';
import { deriveNoteKeys } from './team-keys';
import { readNotesTree, readTeamName, flattenTree } from './notes';
import { attachPersistence } from './yjs-persist';

export type SessionStatus = { signaling: boolean; peers: number; synced: boolean };

export class TeamSession {
  constructor(material: any, signaling: string[]) {
    this.material = material;
    this.signaling = signaling;
    this.root = null;
    this.notes = new Map(); // noteId -> { handle, persist, text }
    this.status = { signaling: false, peers: 0, synced: false };
    this.tree = [];
    this.online = 0;
    this.presence = null;
    this.connecting = false;
    this.connected = false;
    this.error = null;
    this.listeners = new Set();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (_e) {
        /* noop */
      }
    }
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    this.error = null;
    this._emit();
    try {
      const handle = await openP2PDoc({
        docId: this.material.teamDocId,
        swarmKey: this.material.swarmKey,
        e2eeKey: this.material.e2eeKey,
        signaling: this.signaling,
        onStatus: (s: any) => {
          if (s.kind === 'status') this.status.signaling = s.connected;
          else if (s.kind === 'peers') this.status.peers = s.webrtc;
          else if (s.kind === 'synced') this.status.synced = true;
          this._emit();
        },
      });
      this.root = handle;

      this.persist = attachPersistence(handle.doc, this.material.teamDocId);
      await this.persist.ready;

      const refresh = () => {
        this.tree = flattenTree(readNotesTree(handle.doc));
        const nm = readTeamName(handle.doc);
        if (nm) this.material.teamName = nm;
        this._emit();
      };
      handle.doc.getMap('notes').observe(refresh);
      handle.doc.getMap('teamMeta').observe(refresh);

      const aw = handle.awareness;
      const onAw = () => {
        try {
          this.online = aw.getStates ? aw.getStates().size : 0;
        } catch (_e) {
          this.online = 0;
        }
        this._emit();
      };
      aw.on('change', onAw);
      onAw();

      refresh();
      this.connected = true;
    } catch (e: any) {
      this.error = e?.message || String(e);
    } finally {
      this.connecting = false;
      this._emit();
    }
  }

  getRootDoc(): any {
    return this.root && this.root.doc;
  }

  setPresence(user: any): void {
    this.presence = user;
    try {
      if (this.root) this.root.awareness.setLocalStateField('user', user);
    } catch (_e) {
      /* noop */
    }
  }

  async openNote(noteId: string): Promise<any> {
    const cached = this.notes.get(noteId);
    if (cached) return cached;
    const keys = await deriveNoteKeys(this.material.teamRootKey, noteId);
    const handle = await openP2PDoc({
      docId: keys.docId,
      swarmKey: keys.swarmKey,
      e2eeKey: keys.e2eeKey,
      signaling: this.signaling,
    });
    const persist = attachPersistence(handle.doc, keys.docId);
    await persist.ready;
    const entry = { handle, persist, text: handle.doc.getText('content'), noteId };
    this.notes.set(noteId, entry);
    return entry;
  }

  closeNote(noteId: string): void {
    const e = this.notes.get(noteId);
    if (!e) return;
    try {
      e.persist.detach();
    } catch (_err) {
      /* noop */
    }
    try {
      e.handle.destroy();
    } catch (_err) {
      /* noop */
    }
    this.notes.delete(noteId);
  }

  disconnect(): void {
    for (const id of [...this.notes.keys()]) this.closeNote(id);
    try {
      if (this.persist) this.persist.detach();
    } catch (_e) {
      /* noop */
    }
    try {
      if (this.root) this.root.destroy();
    } catch (_e) {
      /* noop */
    }
    this.root = null;
    this.connected = false;
    this.connecting = false;
    this.status = { signaling: false, peers: 0, synced: false };
    this.online = 0;
    this._emit();
  }
}
