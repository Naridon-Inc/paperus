/**
 * device-link.js unit tests — the mobile-companion pairing protocol, run against
 * the REAL renderer source under plain Node (no bundler, no browser). device-link
 * is pure delegation (crypto lives in team-keys.js / e2ee.js), so we cover:
 *   - the copy/paste link codec (build → serialize → parse round-trip),
 *   - the deep-link variant + graceful team-link degrade,
 *   - the lossless numeric short-code codec,
 *   - the never-throws parse contract on garbage/tampered input,
 *   - verifyPairingPayload's pre-crypto branches (invalid / expired),
 *   - and ONE real-crypto round-trip (teamId re-derive + companion key material).
 *
 *   node --import ./tests/ext-loader.mjs tests/device-link.test.mjs
 */
import {
  PAIR_PREFIX,
  PAIR_DEEPLINK_PREFIX,
  generateDeviceId,
  buildPairingPayload,
  serializePairingLink,
  parsePairingLink,
  serializeNumericCode,
  parseNumericCode,
  verifyPairingPayload,
  deriveCompanionTeamMaterial,
} from '../src/renderer/src/device-link.js';
import { e2eeManager } from '../src/renderer/src/e2ee.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

const NOW = 1_700_000_000_000; // fixed clock for deterministic expiry math

console.log('\nDevice id');
{
  const id = generateDeviceId();
  ok(/^dev_[0-9a-f]{12}$/.test(id), 'generateDeviceId mints a "dev_" + 12-hex token');
  ok(generateDeviceId() !== generateDeviceId(), 'two device ids differ');
}

console.log('\nLink codec — round-trip (no crypto; explicit teamId)');
{
  const payload = await buildPairingPayload({
    teamRootKey: 'ROOTKEY_base64url',
    teamId: 'team_abc',
    teamName: 'Acme',
    deviceName: 'Pixel',
    suggestedUsername: 'ash',
    now: NOW,
    ttlMs: 1000,
  });
  ok(payload.v === 1 && payload.teamRootKey === 'ROOTKEY_base64url', 'payload carries version + the one secret');
  ok(payload.teamId === 'team_abc', 'explicit teamId is preserved (no derivation needed)');
  ok(payload.expiresAt === NOW + 1000, 'expiresAt = now + ttl');
  ok(/^dev_[0-9a-f]{12}$/.test(payload.deviceId), 'a deviceId is minted when omitted');

  const link = serializePairingLink(payload);
  ok(link.startsWith(`${PAIR_PREFIX}v1.`), 'serializes to "notionless-pair:v1.<b64url>"');

  const parsed = parsePairingLink(link);
  ok(parsed && parsed.teamRootKey === 'ROOTKEY_base64url', 'parse recovers the secret');
  ok(parsed.teamId === 'team_abc' && parsed.teamName === 'Acme', 'parse recovers non-secret hints');
  ok(parsed.deviceName === 'Pixel' && parsed.suggestedUsername === 'ash', 'parse recovers device + username hints');
  ok(parsed.deviceId === payload.deviceId && parsed.expiresAt === payload.expiresAt, 'deviceId + expiry survive the round-trip');

  const deep = serializePairingLink(payload, { deepLink: true });
  ok(deep.startsWith(`${PAIR_DEEPLINK_PREFIX}#v1.`), 'deep-link variant uses notionless://pair#v1.…');
  const pd = parsePairingLink(deep);
  ok(pd && pd.teamRootKey === 'ROOTKEY_base64url', 'deep-link variant parses back');

  // A URL carrying ?pair= / #pair= is also accepted.
  const body = link.slice(PAIR_PREFIX.length);
  ok(parsePairingLink(`https://x.dev/open#pair=${body}`)?.teamRootKey === 'ROOTKEY_base64url',
    'a #pair=<body> carrier is accepted');
}

console.log('\nNumeric short-code codec — lossless round-trip');
{
  const payload = await buildPairingPayload({ teamRootKey: 'K2', teamId: 't2', now: NOW });
  const code = serializeNumericCode(payload);
  ok(/^[0-9 ]+$/.test(code), 'numeric code is digits + grouping spaces only');
  const back = parseNumericCode(code);
  ok(back && back.teamRootKey === 'K2' && back.teamId === 't2', 'numeric code parses back to the payload');
  ok(parseNumericCode(code.replace(/ /g, ''))?.teamRootKey === 'K2', 'spacing is irrelevant to decode');
  // It is an alternate rendering of the SAME body as the link.
  ok(serializeNumericCode(serializePairingLink(payload)) === code, 'code(link) === code(payload) — same body');
}

console.log('\nGraceful degrade — a bare team link is a minimal payload');
{
  const a = parsePairingLink('notionless-team:TEAMROOT');
  ok(a && a.teamRootKey === 'TEAMROOT' && !a.expiresAt, 'notionless-team:<key> → {teamRootKey} (no expiry)');
  const b = parsePairingLink('https://app/#team=TEAMROOT');
  ok(b && b.teamRootKey === 'TEAMROOT', '#team=<key> degrades the same way');
}

console.log('\nParse never throws — garbage in, null out');
{
  ok(parsePairingLink(null) === null, 'null → null');
  ok(parsePairingLink('') === null, 'empty → null');
  ok(parsePairingLink('just some prose') === null, 'random prose → null');
  ok(parsePairingLink(`${PAIR_PREFIX}v1.@@@not-base64@@@`) === null, 'invalid base64 body → null');
  ok(parsePairingLink(`${PAIR_PREFIX}v1.eyJ9`) === null, 'b64 that is not a valid payload object → null');
  ok(parseNumericCode('abc') === null, 'non-numeric code → null');
  ok(parseNumericCode('123') === null, 'odd-length digit run → null');
  // Tamper: truncating the body must not yield a usable payload.
  const link = serializePairingLink(await buildPairingPayload({ teamRootKey: 'X', teamId: 'tx', now: NOW }));
  ok(parsePairingLink(link.slice(0, link.length - 6)) === null, 'a truncated link → null (no partial trust)');
}

console.log('\nverifyPairingPayload — pre-crypto branches');
{
  ok((await verifyPairingPayload(null)).reason === 'invalid', 'null payload → invalid');
  ok((await verifyPairingPayload({})).reason === 'invalid', 'no teamRootKey → invalid');
  const expired = { teamRootKey: 'k', expiresAt: NOW - 1 };
  ok((await verifyPairingPayload(expired, { now: NOW })).reason === 'expired', 'past expiresAt → expired');
}

console.log('\nReal-crypto round-trip (teamId re-derive + companion material)');
{
  await e2eeManager.readyPromise; // libsodium ready (same gate as e2ee-crypto test)
  const ROOT = 'mZ3kP9qR2sT5uV8wX1yA4bC7'; // any non-empty string; derivation hashes its bytes

  // Build WITHOUT teamId so buildPairingPayload derives + embeds it.
  const payload = await buildPairingPayload({ teamRootKey: ROOT, now: NOW });
  ok(typeof payload.teamId === 'string' && payload.teamId.length > 0, 'teamId is derived when omitted');

  const parsed = parsePairingLink(serializePairingLink(payload));
  const v = await verifyPairingPayload(parsed, { now: NOW });
  ok(v.ok && v.reason === 'ok', 'a fresh link verifies ok');
  ok(v.teamId === payload.teamId, 'verify re-derives the SAME teamId from the secret');

  // A forged teamId hint that does not match the secret is caught.
  const forged = await verifyPairingPayload({ teamRootKey: ROOT, teamId: 'deadbeef', expiresAt: NOW + 1000 }, { now: NOW });
  ok(forged.reason === 'team-id-mismatch', 'a teamId that does not derive from the secret → team-id-mismatch');

  // The companion can derive joinable team material (swarm + e2ee) from the payload.
  const mat = await deriveCompanionTeamMaterial(parsed);
  ok(mat && mat.teamRootKey === ROOT && mat.teamId === payload.teamId, 'companion material carries team identity');
  ok(typeof mat.swarmKey === 'string' && typeof mat.e2eeKey === 'string', 'companion material includes swarm + e2ee keys');
  ok(deriveCompanionTeamMaterial({}) instanceof Promise, 'deriveCompanionTeamMaterial is async');
  ok((await deriveCompanionTeamMaterial(null)) === null, 'deriveCompanionTeamMaterial(null) → null (never throws)');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
