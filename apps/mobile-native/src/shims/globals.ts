// @ts-nocheck
/**
 * globals.ts — install Node/browser globals BEFORE y-webrtc/simple-peer load.
 *
 * MUST be the first import in index.ts. simple-peer (via get-browser-rtc) reads
 * global.RTCPeerConnection; readable-stream needs Buffer/process; randombytes
 * needs global.crypto.getRandomValues. Order matters: set everything up here,
 * then the rest of the bundle (including y-webrtc) evaluates against it.
 */
import 'react-native-get-random-values'; // installs global.crypto.getRandomValues
import { Buffer } from 'buffer';
import process from 'process';
import { registerGlobals } from 'react-native-webrtc';
import { subtle } from './subtle';

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}
if (typeof global.process === 'undefined') {
  global.process = process;
}
if (typeof global.process.nextTick !== 'function') {
  global.process.nextTick = (fn, ...args) => setTimeout(() => fn(...args), 0);
}
if (typeof global.process.env === 'undefined') {
  global.process.env = {};
}
// RN pre-defines a BARE global.process (env only) — so the npm `process` shim
// above is never assigned, and it lacks the EventEmitter surface y-webrtc's Room
// uses: `process.on('exit', …)` on connect and `process.off('exit', …)` on
// destroy. Without these, `process.on` is undefined → "undefined is not a
// function" thrown inside `this.key.then(openRoom(...))` → unhandled rejection.
// RN has no real 'exit' event, so no-ops are correct (the handler is desktop-only
// unload cleanup).
const noop = () => {};
for (const m of ['on', 'off', 'once', 'addListener', 'removeListener', 'emit', 'prependListener']) {
  if (typeof global.process[m] !== 'function') {
    global.process[m] = noop;
  }
}

// RN defines a `window` (aliased to global) but WITHOUT DOM EventTarget methods.
// y-webrtc's Room sees `typeof window !== 'undefined'` (true on RN) and takes the
// browser branch `window.addEventListener('beforeunload', …)` — undefined on RN →
// "undefined is not a function" inside the Room ctor. 'beforeunload' never fires
// on RN, so no-ops are correct (the listener is desktop unload cleanup).
const win = (global as any).window || global;
for (const m of ['addEventListener', 'removeEventListener']) {
  if (typeof win[m] !== 'function') win[m] = noop;
  if (typeof (global as any)[m] !== 'function') (global as any)[m] = noop;
}

// y-webrtc's room-password layer (y-webrtc/src/crypto.js) calls the GLOBAL
// `crypto.subtle` directly — PBKDF2 importKey/deriveKey + AES-GCM encrypt/decrypt
// — to encrypt EVERY announce/signal/data message with a key derived from the
// room password (the desktop sets `password: swarmKey`). Hermes ships no
// `subtle`, so a password-protected desktop room is unreadable on RN and the two
// never connect. Install our byte-exact pure-JS subtle (verified identical to
// WebCrypto: same PBKDF2 key, same AES-GCM ciphertext+tag). The password-less
// transport spike didn't need this; real desktop interop does.
try {
  const cryptoObj: any = (global as any).crypto;
  if (cryptoObj && !cryptoObj.subtle) {
    try {
      Object.defineProperty(cryptoObj, 'subtle', { value: subtle, configurable: true });
    } catch (_e) {
      cryptoObj.subtle = subtle;
    }
    // eslint-disable-next-line no-console
    console.log('[globals] installed crypto.subtle (PBKDF2 + AES-GCM)');
  }
} catch (e: any) {
  // eslint-disable-next-line no-console
  console.log('[globals] crypto.subtle install failed:', e && e.message);
}

// lib0/buffer (a y-webrtc dep) base64s signaling messages with btoa/atob, which
// Hermes doesn't define. Back them with Buffer so y-webrtc can encode/decode.
if (typeof global.btoa === 'undefined') {
  global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
}
if (typeof global.atob === 'undefined') {
  global.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
}

// RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStream, etc.
registerGlobals();

// simple-peer detects react-native-webrtc via `typeof pc._peerConnectionId ===
// 'number'` (simple-peer/index.js:109). Current react-native-webrtc renamed that
// field to `_pcId`, so detection FAILS — and simple-peer then takes its legacy
// callback-style getStats path, passing a callback where rn-webrtc expects a
// MediaStreamTrack selector → "Invalid selector: could not find matching sender /
// receiver" thrown from `_maybeReady` right after the data channel opens, so
// simple-peer never emits `connect` and y-webrtc never syncs. Alias the old field
// to `_pcId` so simple-peer uses the promise getStats path. (Pure read alias; the
// numeric value is what the detection checks.)
try {
  const RPC: any = (global as any).RTCPeerConnection;
  if (RPC && RPC.prototype && !('_peerConnectionId' in RPC.prototype)) {
    Object.defineProperty(RPC.prototype, '_peerConnectionId', {
      configurable: true,
      get() {
        return this._pcId;
      },
    });
    // eslint-disable-next-line no-console
    console.log('[globals] aliased RTCPeerConnection._peerConnectionId -> _pcId');
  }
} catch (e: any) {
  // eslint-disable-next-line no-console
  console.log('[globals] _peerConnectionId alias failed:', e && e.message);
}

// DEBUG: surface full stacks for unhandled rejections. Hermes uses a NATIVE
// Promise (not the `promise` polyfill), so the only hook that fires is
// HermesInternal.enablePromiseRejectionTracker. This overrides RN's default
// LogBox tracker — fine for debugging the transport spike.
try {
  const HI = (global as any).HermesInternal;
  if (HI && typeof HI.enablePromiseRejectionTracker === 'function') {
    HI.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (id: any, err: any) => {
        const detail =
          err && typeof err === 'object'
            ? `${err.message || ''}\n${err.stack || ''}`
            : String(err);
        // eslint-disable-next-line no-console
        console.log('[hermes-rejection]', id, detail);
      },
      onHandled: () => {},
    });
    // eslint-disable-next-line no-console
    console.log('[globals] Hermes rejection tracker installed');
  } else {
    // eslint-disable-next-line no-console
    console.log('[globals] no HermesInternal.enablePromiseRejectionTracker');
  }
} catch (e: any) {
  // eslint-disable-next-line no-console
  console.log('[globals] rejection-tracking enable failed:', e && e.message);
}
