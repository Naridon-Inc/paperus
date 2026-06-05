// @ts-nocheck
/**
 * transport.ts — the second P0 gate: WebRTC transport interop.
 *
 * Proves the existential transport risk — that y-webrtc + simple-peer actually
 * run on Hermes and that a React Native peer can join a y-webrtc swarm through
 * the relay and exchange Yjs CRDT updates with a non-RN peer (a browser tab).
 *
 * This uses FIXED room+password literals (not desktop key-derivation, which the
 * crypto gate already proved) so the test is self-contained: any peer that joins
 * room ROOM with password PASSWORD on the same signaling relay will sync. The
 * companion browser peer is `tests/rn-transport-peer.html`.
 */
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';

export type TransportState = {
  status: string;
  peers: number;
  synced: boolean;
  map: Record<string, any>;
  log: string[];
  error?: string;
};

const ROOM = 'notionless-rn-interop-v1';
// No y-webrtc password: this gate proves transport+CRDT interop, not y-webrtc's
// optional password layer (the app's real confidentiality is the E2EE
// transportDoc). Both peers run password-less so they sync in plaintext.
const SIGNALING = ['ws://localhost:4455'];

export function startTransport(onState: (patch: Partial<TransportState>) => void): () => void {
  let provider: any;
  const log: string[] = [];
  const push = (m: string) => {
    log.push(m);
    onState({ log: [...log] });
  };

  const C = (m: string) => {
    // eslint-disable-next-line no-console
    console.log('[transport]', m);
    push(m);
  };

  try {
    // ---- preflight: which globals does y-webrtc/simple-peer need? ----
    C(
      `globals atob=${typeof (global as any).atob} btoa=${typeof (global as any).btoa} ` +
        `WS=${typeof (global as any).WebSocket} RTC=${typeof (global as any).RTCPeerConnection} ` +
        `BC=${typeof (global as any).BroadcastChannel} grv=${typeof ((global as any).crypto && (global as any).crypto.getRandomValues)}`,
    );
    try {
      const pc = new (global as any).RTCPeerConnection({ iceServers: [] });
      C('RTCPeerConnection ctor OK');
      if (pc.close) pc.close();
    } catch (e: any) {
      C(`RTCPeerConnection ctor FAIL: ${e && e.message}`);
    }
    try {
      C(`btoa roundtrip: ${(global as any).atob((global as any).btoa('hi'))}`);
    } catch (e: any) {
      C(`btoa/atob FAIL: ${e && e.message}`);
    }
    // ---- probe each Room-constructor op (stack pins fault to Room ctor) ----
    try {
      const wc = require('lib0/webcrypto');
      C(`webcrypto grv u32: ${wc.getRandomValues(new Uint32Array(1))[0]}`);
    } catch (e: any) {
      C(`webcrypto grv FAIL: ${e && e.message}`);
    }
    try {
      const rnd = require('lib0/random');
      C(`lib0 uuidv4: ${rnd.uuidv4()}`);
    } catch (e: any) {
      C(`lib0 uuidv4 FAIL: ${e && e.message}`);
    }
    try {
      const mtx = require('lib0/mutex');
      const m = mtx.createMutex();
      C(`lib0 createMutex: ${typeof m}`);
    } catch (e: any) {
      C(`lib0 createMutex FAIL: ${e && e.message}`);
    }
    try {
      C(`process.on=${typeof (global as any).process.on} window=${typeof (global as any).window}`);
      (global as any).process.on('exit', () => {});
      C('process.on(exit) ok');
    } catch (e: any) {
      C(`process.on FAIL: ${e && e.message}`);
    }

    const doc = new Y.Doc();
    C(`joining "${ROOM}" via ${SIGNALING[0]}`);

    provider = new WebrtcProvider(ROOM, doc, {
      signaling: SIGNALING,
      maxConns: 20,
      filterBcConns: true,
      peerOpts: { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } },
    });

    const map = doc.getMap('m');
    const stamp = new Date().toISOString().slice(11, 19);
    map.set('fromRN', `hello from iOS @ ${stamp}`);

    const emit = () => onState({ map: map.toJSON() });
    map.observeDeep(() => {
      emit();
      C(`map updated: ${JSON.stringify(map.toJSON())}`);
    });

    provider.on('status', (e: any) => {
      onState({ status: e.connected ? 'signaling connected' : 'signaling connecting…' });
      C(`status: ${JSON.stringify(e)}`);
    });
    provider.on('synced', (e: any) => {
      onState({ synced: true });
      C(`synced: ${JSON.stringify(e)}`);
    });
    provider.on('peers', (e: any) => {
      const n = e.webrtcPeers?.length || 0;
      onState({ peers: n, status: `webrtc peers: ${n}` });
      C(`peers: webrtc=${e.webrtcPeers?.length || 0} bc=${e.bcPeers?.length || 0} added=${JSON.stringify(e.added || [])}`);
    });

    emit();
    onState({ status: 'provider started' });
    C('provider constructed — waiting for peer');
  } catch (e: any) {
    onState({ error: e?.message ? `${e.message}\n${e.stack || ''}` : String(e) });
  }

  return () => {
    try {
      provider?.destroy();
    } catch {
      /* noop */
    }
  };
}
