// @ts-nocheck
/**
 * p2p-doc.ts — the native port of the desktop `openP2PDoc` chokepoint
 * (engine.js + p2p.js), trimmed to exactly what a read/edit mobile peer needs:
 * the plaintext Y.Doc, the E2EE `transportDoc`, and the y-webrtc provider — no
 * IndexedDB persistence, no presence renderer, no snapshots, no projection.
 *
 * Wire behaviour is matched BYTE-FOR-BYTE with the desktop so a phone interops
 * with a running desktop team. The three load-bearing constants:
 *
 *   roomName = "notionless-" + hex( BLAKE2b-256( utf8(swarmKey) ) )   (p2p.js _deriveRoomName)
 *   provider password = swarmKey                                       (p2p.js connect)
 *   provider binds to the transportDoc when E2EE is on, else the doc   (p2p.js syncDoc)
 *
 * E2EE transport (engine.js setupE2EE): the transportDoc holds ONE top-level
 * Y.Array `encrypted_updates` of XChaCha20-Poly1305 blobs. Local plaintext
 * updates are encrypted and pushed; added blobs are decrypted and applied back.
 * AAD = docId. The `e2ee-sync` origin breaks the encrypt↔decrypt echo loop.
 */
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Awareness } from 'y-protocols/awareness';
import sodium from '../crypto/sodium';
import { e2eeManager } from './e2ee';
import { ICE_SERVERS } from '../config';

/** Must match desktop p2p.js `_deriveRoomName` exactly. */
export function deriveRoomName(swarmKey: string): string {
  const hash = sodium.crypto_generichash(32, sodium.from_string(swarmKey));
  return `notionless-${sodium.to_hex(hash)}`;
}

export type P2PStatus =
  | { kind: 'status'; connected: boolean }
  | { kind: 'peers'; webrtc: number }
  | { kind: 'synced' };

export type OpenOpts = {
  docId: string;
  swarmKey: string;
  e2eeKey?: string | null;
  signaling: string[];
  onStatus?: (s: P2PStatus) => void;
};

export type P2PHandle = {
  doc: any;
  transportDoc: any | null;
  provider: any;
  awareness: any;
  roomName: string;
  destroy: () => void;
};

export async function openP2PDoc(opts: OpenOpts): Promise<P2PHandle> {
  const { docId, swarmKey, e2eeKey, signaling, onStatus } = opts;

  // encryptUpdate/decryptUpdate throw if sodium isn't ready — gate the whole open.
  await e2eeManager.ensureReady();

  const doc = new Y.Doc({ guid: docId });
  // Awareness intentionally stays on the PLAINTEXT doc (matches desktop p2p.js).
  // We never set local presence state for v1; content sync is independent of it.
  const awareness = new Awareness(doc);

  let transportDoc: any = null;
  if (e2eeKey) {
    transportDoc = new Y.Doc();
    const arr = transportDoc.getArray('encrypted_updates');

    // local plaintext edit → AEAD blob on the wire
    doc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === 'e2ee-sync') return; // don't re-encrypt remote-applied updates
      try {
        const enc = e2eeManager.encryptUpdate(update, e2eeKey, docId);
        transportDoc.transact(() => {
          arr.push([enc]);
        }, 'e2ee-publish');
      } catch (_e) {
        /* never break sync on a single bad update */
      }
    });

    // wire AEAD blob → local plaintext (idempotent; Yjs dedups by CRDT semantics)
    arr.observe((event: any) => {
      event.changes.added.forEach((item: any) => {
        item.content.getContent().forEach((blob: any) => {
          if (blob instanceof Uint8Array) {
            const dec = e2eeManager.decryptUpdate(blob, e2eeKey, docId);
            if (dec) Y.applyUpdate(doc, dec, 'e2ee-sync');
          }
        });
      });
    });
  }

  const roomName = deriveRoomName(swarmKey);
  const syncDoc = transportDoc || doc;
  const provider = new WebrtcProvider(roomName, syncDoc, {
    signaling,
    password: swarmKey,
    awareness,
    maxConns: 20,
    filterBcConns: true,
    peerOpts: { config: { iceServers: ICE_SERVERS } },
  });

  if (onStatus) {
    provider.on('status', (e: any) => onStatus({ kind: 'status', connected: !!e.connected }));
    provider.on('peers', (e: any) =>
      onStatus({ kind: 'peers', webrtc: (e.webrtcPeers && e.webrtcPeers.length) || 0 }),
    );
    provider.on('synced', () => onStatus({ kind: 'synced' }));
  }

  const destroy = () => {
    try {
      provider.destroy();
    } catch (_e) {
      /* noop */
    }
    try {
      awareness.destroy();
    } catch (_e) {
      /* noop */
    }
    try {
      if (transportDoc) transportDoc.destroy();
    } catch (_e) {
      /* noop */
    }
    try {
      doc.destroy();
    } catch (_e) {
      /* noop */
    }
  };

  return { doc, transportDoc, provider, awareness, roomName, destroy };
}
