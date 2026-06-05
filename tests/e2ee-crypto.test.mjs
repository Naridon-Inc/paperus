/**
 * E2EE crypto unit tests — run against the REAL renderer source (e2ee.js,
 * team-keys.js), no bundler, no browser. Covers the guarantees the team model
 * leans on: every member replicates every note's ciphertext, so confidentiality,
 * tamper-evidence, key isolation, and sealing-to-a-person must all hold.
 *
 *   node --import ./tests/ext-loader.mjs tests/e2ee-crypto.test.mjs
 */
import sodium from 'libsodium-wrappers-sumo';
import { e2eeManager } from '../src/renderer/src/e2ee.js';
import { deriveNoteKeys, deriveIdentity, deriveTeamId, deriveInboxKeys } from '../src/renderer/src/team-keys.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const enc = (s) => new TextEncoder().encode(s);
const dec = (u) => (u ? new TextDecoder().decode(u) : null);

await e2eeManager.ensureReady();
await sodium.ready;

console.log('\nAEAD content encryption');
{
  const key = await e2eeManager.generateDocumentKey();
  const blob = e2eeManager.encryptUpdate(enc('secret note body'), key, 'note-1');

  ok(dec(e2eeManager.decryptUpdate(blob, key, 'note-1')) === 'secret note body', 'round-trips with correct key + context');
  ok(blob[0] === 0xe2 && blob[1] === 0xee && blob[2] === 0x01, 'blob carries the v1 AEAD magic (versioned wire format)');

  // Tamper: flip one byte in the ciphertext body → Poly1305 rejects, returns null.
  const tampered = blob.slice(); tampered[tampered.length - 1] ^= 0x01;
  ok(e2eeManager.decryptUpdate(tampered, key, 'note-1') === null, 'a single flipped bit is rejected (auth tag)');

  // Wrong key → null, never throws.
  const other = await e2eeManager.generateDocumentKey();
  ok(e2eeManager.decryptUpdate(blob, other, 'note-1') === null, 'wrong key cannot decrypt');

  // AAD binding: same key, different note context → rejected.
  ok(e2eeManager.decryptUpdate(blob, key, 'note-2') === null, 'ciphertext bound to its note: wrong context rejected');
  ok(e2eeManager.decryptUpdate(blob, key, '') === null, 'missing context rejected when one was bound');
}

console.log('\nLegacy ciphertext still opens (smooth upgrade)');
{
  const key = await e2eeManager.generateDocumentKey();
  // Hand-build a pre-upgrade crypto_secretbox blob [nonce(24) || ct], no magic.
  const k = sodium.from_base64(key);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(enc('legacy body'), nonce, k);
  const legacy = new Uint8Array(nonce.length + ct.length);
  legacy.set(nonce); legacy.set(ct, nonce.length);
  ok(dec(e2eeManager.decryptUpdate(legacy, key)) === 'legacy body', 'falls back to legacy secretbox format');
}

console.log('\nPer-note key isolation (cross-note replay blocked)');
{
  const root = 'team-root-secret-abc123';
  const a = await deriveNoteKeys(root, 'noteA');
  const b = await deriveNoteKeys(root, 'noteB');
  ok(a.e2eeKey !== b.e2eeKey && a.swarmKey !== b.swarmKey, 'distinct notes derive distinct keys');
  const blobA = e2eeManager.encryptUpdate(enc('note A content'), a.e2eeKey, a.docId);
  ok(e2eeManager.decryptUpdate(blobA, b.e2eeKey, b.docId) === null, "note B's key cannot read note A's ciphertext");
  ok(dec(e2eeManager.decryptUpdate(blobA, a.e2eeKey, a.docId)) === 'note A content', "note A's own key still reads it");
}

console.log('\nSeal a key to a person (contacts / restricted grant)');
{
  const teamId = await deriveTeamId('root-xyz');
  const alice = await deriveIdentity(teamId, 'alice', 'correct horse battery');
  const bob = await deriveIdentity(teamId, 'bob', 'another good passphrase');
  const contentKey = await e2eeManager.generateDocumentKey();

  const sealed = await e2eeManager.wrapKeyForIdentity(contentKey, bob.publicKey);
  const unwrapped = await e2eeManager.unwrapKeyForIdentity(sealed, bob.publicKey, bob.privateKey);
  ok(unwrapped === contentKey, 'recipient (bob) unwraps the sealed key');

  let blocked = false;
  try { await e2eeManager.unwrapKeyForIdentity(sealed, alice.publicKey, alice.privateKey); }
  catch (_e) { blocked = true; }
  ok(blocked, 'a non-recipient (alice) cannot unwrap a key sealed to bob');
}

console.log('\nDeterministic identity (anti-impersonation)');
{
  const t1 = await deriveTeamId('team-one');
  const t2 = await deriveTeamId('team-two');
  const a1 = await deriveIdentity(t1, 'Sam', 'hunter2hunter2');
  const a1b = await deriveIdentity(t1, ' sam ', 'hunter2hunter2'); // case/space-normalized
  const a2 = await deriveIdentity(t2, 'Sam', 'hunter2hunter2');
  const aWrong = await deriveIdentity(t1, 'Sam', 'wrong-password');

  ok(a1.publicKey === a1b.publicKey, 'same username+password re-derives the same key (username normalized)');
  ok(a1.publicKey !== a2.publicKey, 'same credentials in a different team → different key (rosters independent)');
  ok(a1.publicKey !== aWrong.publicKey, 'a different password → different key');

  // The inbox address is derived from the PUBLIC key, deterministic + per-identity.
  const inA = await deriveInboxKeys(a1.publicKey);
  const inA2 = await deriveInboxKeys(a1.publicKey);
  const inB = await deriveInboxKeys(a2.publicKey);
  ok(inA.docId === inA2.docId && inA.swarmKey === inA2.swarmKey, 'inbox address is deterministic from the public key');
  ok(inA.docId !== inB.docId, 'different identities get different inbox addresses');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
