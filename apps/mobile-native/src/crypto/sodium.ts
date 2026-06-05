/**
 * sodium.ts — libsodium adapter for React Native (Hermes).
 *
 * The desktop engine (`e2ee.js`) imports `libsodium-wrappers-sumo`, a WASM build
 * Hermes can't run. This shim exposes the SAME `sodium.*` API surface backed by
 * `react-native-libsodium` (the same C libsodium via JSI), so the engine code
 * runs byte-for-byte identically — same Argon2id seed, same BLAKE2b hashes, same
 * Ed25519 keys, same base64 variant — which is what makes desktop interop work.
 *
 * react-native-libsodium is a near drop-in for libsodium-wrappers, but is missing
 * four names the engine uses. We fill exactly those and pass everything else
 * through untouched:
 *   - crypto_pwhash_OPSLIMIT_MODERATE / _MEMLIMIT_MODERATE — the engine derives
 *     identity with the MODERATE profile (deriveIdentityKeyPair moderate=true);
 *     RN only ships the INTERACTIVE constants. Values are libsodium's canonical
 *     MODERATE: opslimit=3, memlimit=256 MiB. The native crypto_pwhash accepts
 *     any valid numeric limits, so these produce the identical Argon2id seed.
 *   - from_string — UTF-8 encode (hashConcat builds its buffer with it).
 *   - from_hex — hex decode (parity; engine only emits hex here, but keep the
 *     surface complete).
 *
 * to_base64 / from_base64 default to URLSAFE_NO_PADDING in react-native-libsodium,
 * matching libsodium-wrappers' default and the golden interop vectors.
 */
import * as rnsodium from 'react-native-libsodium';

// libsodium canonical Argon2id MODERATE profile (crypto_pwhash_*_MODERATE).
const CRYPTO_PWHASH_OPSLIMIT_MODERATE = 3;
const CRYPTO_PWHASH_MEMLIMIT_MODERATE = 268435456; // 256 MiB

function from_string(str: string): Uint8Array {
  // UTF-8 encode, identical to libsodium's sodium.from_string.
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  // Manual UTF-8 fallback (covers full BMP + surrogate pairs).
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

function from_hex(hex: string): Uint8Array {
  const clean = hex.length % 2 ? `0${hex}` : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

// Pass through everything react-native-libsodium provides, then fill the gaps.
// Spreading the module namespace copies the already-resolved JSI constants
// (numbers) and the function references.
const sodium: any = {
  ...(rnsodium as any),
  crypto_pwhash_OPSLIMIT_MODERATE: CRYPTO_PWHASH_OPSLIMIT_MODERATE,
  crypto_pwhash_MEMLIMIT_MODERATE: CRYPTO_PWHASH_MEMLIMIT_MODERATE,
  from_string,
  from_hex,
};

export default sodium;
