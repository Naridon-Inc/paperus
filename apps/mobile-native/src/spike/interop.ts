// @ts-nocheck
/**
 * interop.ts — the P0 existential-risk gate.
 *
 * Re-derives keys/identity/signatures on the RN runtime using the UNMODIFIED
 * desktop engine (`../engine/e2ee.js`, `../engine/team-keys.js`, only the
 * libsodium backend swapped) and byte-compares every output against the golden
 * vectors the desktop produced (`./vectors.json`). If these all pass, an RN
 * client derives the same identity, joins the same swarm topics, and decrypts
 * the same content the desktop does — i.e. native↔desktop P2P interop is real.
 */
import sodium from '../crypto/sodium';
import { e2eeManager } from '../engine/e2ee';
import { deriveTeamKeys, deriveNoteKeys, deriveIdentity } from '../engine/team-keys';
import vectors from './vectors.json';

export type Check = {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
};

function check(name: string, expected: string, actual: string): Check {
  return { name, expected, actual, pass: expected === actual };
}

export async function runInterop(): Promise<{ checks: Check[]; allPass: boolean; error?: string }> {
  const checks: Check[] = [];
  try {
    await sodium.ready;
    await e2eeManager.ensureReady();

    const { inputs } = vectors;

    // 1. base64 / hex variant probe — proves URLSAFE_NO_PADDING + hex encoding.
    const probe = Uint8Array.from(vectors.base64_variant_probe.input_bytes);
    checks.push(check('base64 variant (URLSAFE_NO_PADDING)', vectors.base64_variant_probe.expect_to_base64, sodium.to_base64(probe)));
    checks.push(check('hex encoding', vectors.base64_variant_probe.expect_to_hex, sodium.to_hex(probe)));

    // 2. Team keys — BLAKE2b domain-separated derivations.
    const tk = await deriveTeamKeys(inputs.teamRootKey);
    checks.push(check('teamId', vectors.teamKeys.teamId, tk.teamId));
    checks.push(check('teamDocId', vectors.teamKeys.teamDocId, tk.teamDocId));
    checks.push(check('team swarmKey', vectors.teamKeys.swarmKey, tk.swarmKey));
    checks.push(check('team e2eeKey', vectors.teamKeys.e2eeKey, tk.e2eeKey));

    // 3. Per-note keys.
    const nk = await deriveNoteKeys(inputs.teamRootKey, inputs.noteId);
    checks.push(check('note docId', vectors.noteKeys.docId, nk.docId));
    checks.push(check('note swarmKey', vectors.noteKeys.swarmKey, nk.swarmKey));
    checks.push(check('note e2eeKey', vectors.noteKeys.e2eeKey, nk.e2eeKey));

    // 4. Identity — Argon2id(MODERATE) -> Ed25519. The load-bearing one.
    const id = await deriveIdentity(vectors.teamKeys.teamId, inputs.username, inputs.password);
    checks.push(check('identity publicKey (Argon2id MODERATE)', vectors.identity_publicKey, id.publicKey));

    // 5. Ed25519 detached signature over sigMessage with the derived private key.
    const msg = sodium.from_string(inputs.sigMessage);
    const sk = sodium.from_base64(id.privateKey);
    const pk = sodium.from_base64(id.publicKey);
    const sig = sodium.crypto_sign_detached(msg, sk);
    checks.push(check('ed25519 detached signature', vectors.ed25519_detached_signature_b64, sodium.to_base64(sig)));
    const verifies = sodium.crypto_sign_verify_detached(sig, msg, pk);
    checks.push(check('signature verifies', String(vectors.signature_verifies), String(verifies)));

    return { checks, allPass: checks.every((c) => c.pass) };
  } catch (e: any) {
    return { checks, allPass: false, error: e?.message ? `${e.message}\n${e.stack || ''}` : String(e) };
  }
}
