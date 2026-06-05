// @ts-nocheck
/**
 * yjs-persist.ts — minimal offline persistence for a Y.Doc, the RN stand-in for
 * the desktop's `y-indexeddb` (which Hermes can't run).
 *
 * Strategy: debounce-save the WHOLE document state (`Y.encodeStateAsUpdate`) as a
 * base64 string under `ydoc:<docId>`, and on attach load+apply it. For small
 * notes/team-index docs this is simple and robust; a per-update append log over
 * expo-sqlite is the scale-up if docs get large.
 *
 * The loaded state is applied with origin `'persist'` (NOT `'e2ee-sync'`), so the
 * E2EE publish observer in p2p-doc DOES re-encrypt and broadcast it — that's
 * correct: offline edits made last session propagate to peers on reconnect.
 */
import * as Y from 'yjs';
import { Buffer } from 'buffer';
import { storage } from '../store/persistence';

const SAVE_DEBOUNCE_MS = 800;

export type Persistence = { ready: Promise<void>; detach: () => void };

export function attachPersistence(doc: any, docId: string): Persistence {
  const key = `ydoc:${docId}`;
  let timer: any = null;

  const save = () => {
    timer = null;
    try {
      const u8 = Y.encodeStateAsUpdate(doc);
      storage.set(key, Buffer.from(u8).toString('base64'));
    } catch (_e) {
      /* never let a save crash the editor */
    }
  };

  const onUpdate = () => {
    if (timer) return;
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  const load = async () => {
    try {
      const b64 = await storage.get(key);
      if (b64) Y.applyUpdate(doc, new Uint8Array(Buffer.from(b64, 'base64')), 'persist');
    } catch (_e) {
      /* corrupt/absent → start empty */
    }
  };

  doc.on('update', onUpdate);
  const ready = load();

  return {
    ready,
    detach: () => {
      try {
        doc.off('update', onUpdate);
      } catch (_e) {
        /* noop */
      }
      if (timer) {
        clearTimeout(timer);
        save(); // flush a pending write on close
      }
    },
  };
}

/** Forget a doc's offline state (used when leaving a team). */
export async function clearPersistence(docId: string): Promise<void> {
  await storage.remove(`ydoc:${docId}`);
}
