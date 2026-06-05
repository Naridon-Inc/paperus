// @ts-nocheck
/**
 * subtle.ts — a minimal but BYTE-EXACT Web Crypto `crypto.subtle` for Hermes.
 *
 * y-webrtc's room-password layer (y-webrtc/src/crypto.js) calls the GLOBAL
 * `crypto.subtle` directly:
 *     importKey('raw', secret, 'PBKDF2') → deriveKey(PBKDF2 → AES-GCM-256)
 *     → encrypt/decrypt({ name: 'AES-GCM', iv })
 * Hermes ships no `subtle`, so without this the desktop's `password: swarmKey`
 * rooms are unreadable on RN and the two peers never connect (the announce/signal
 * messages are AES-GCM ciphertext). We implement exactly those operations with
 * audited pure-JS primitives (@noble) — verified byte-identical to WebCrypto
 * (same PBKDF2 key from secret+roomName, same AES-GCM ciphertext+tag), so an RN
 * peer interops with the desktop/browser peers' password layer unchanged.
 *
 * CryptoKey is an opaque holder here: every key this subtle produces is consumed
 * only by this same subtle, so we just carry the raw bytes.
 */
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { gcm } from '@noble/ciphers/aes';

class KeyHolder {
  constructor(raw, algorithm, usages) {
    this._raw = raw;
    this.type = 'secret';
    this.extractable = true;
    this.algorithm = algorithm;
    this.usages = usages || [];
  }
}

function toBytes(input) {
  if (input == null) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new Error('subtle: unsupported buffer type');
}

function toArrayBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function algoName(a) {
  return typeof a === 'string' ? a : a && a.name;
}

export const subtle = {
  // y-webrtc: importKey('raw', secret.buffer, 'PBKDF2', false, ['deriveKey'])
  async importKey(_format, keyData, algorithm, _extractable, keyUsages) {
    return new KeyHolder(toBytes(keyData), algorithm, keyUsages);
  },

  // y-webrtc: deriveKey({PBKDF2, salt=roomName, 100000, SHA-256}, km, {AES-GCM,256})
  async deriveKey(algorithm, baseKey, derivedKeyAlgorithm, _extractable, keyUsages) {
    const name = algoName(algorithm);
    if (name !== 'PBKDF2') throw new Error(`subtle.deriveKey: only PBKDF2, got ${name}`);
    const hash = algoName(algorithm.hash) || 'SHA-256';
    if (hash !== 'SHA-256') throw new Error(`subtle.deriveKey: only SHA-256 PRF, got ${hash}`);
    const iterations = algorithm.iterations >>> 0;
    const salt = toBytes(algorithm.salt);
    const bits = (derivedKeyAlgorithm && derivedKeyAlgorithm.length) || 256;
    const dk = pbkdf2(sha256, baseKey._raw, salt, { c: iterations, dkLen: bits / 8 });
    return new KeyHolder(dk, derivedKeyAlgorithm, keyUsages);
  },

  async deriveBits(algorithm, baseKey, length) {
    const name = algoName(algorithm);
    if (name !== 'PBKDF2') throw new Error('subtle.deriveBits: only PBKDF2 supported');
    const salt = toBytes(algorithm.salt);
    const iterations = algorithm.iterations >>> 0;
    return toArrayBuffer(pbkdf2(sha256, baseKey._raw, salt, { c: iterations, dkLen: length / 8 }));
  },

  // 'raw' export — used only by our own on-device self-test.
  async exportKey(_format, key) {
    return toArrayBuffer(key._raw);
  },

  async encrypt(algorithm, key, data) {
    const name = algoName(algorithm);
    if (name !== 'AES-GCM') throw new Error(`subtle.encrypt: only AES-GCM, got ${name}`);
    const iv = toBytes(algorithm.iv);
    const aad = algorithm.additionalData ? toBytes(algorithm.additionalData) : undefined;
    return toArrayBuffer(gcm(key._raw, iv, aad).encrypt(toBytes(data)));
  },

  async decrypt(algorithm, key, data) {
    const name = algoName(algorithm);
    if (name !== 'AES-GCM') throw new Error(`subtle.decrypt: only AES-GCM, got ${name}`);
    const iv = toBytes(algorithm.iv);
    const aad = algorithm.additionalData ? toBytes(algorithm.additionalData) : undefined;
    return toArrayBuffer(gcm(key._raw, iv, aad).decrypt(toBytes(data)));
  },

  async digest(algorithm, data) {
    const name = algoName(algorithm);
    if (name !== 'SHA-256') throw new Error(`subtle.digest: only SHA-256, got ${name}`);
    return toArrayBuffer(sha256(toBytes(data)));
  },
};

export default subtle;
