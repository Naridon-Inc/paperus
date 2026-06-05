// @ts-nocheck
/**
 * identity.ts — claim a team membership from the phone.
 *
 * The companion derives its OWN Ed25519 identity from a username + password
 * (Argon2id-MODERATE, ~1–2s on device), self-signs a roster "claim" op, and
 * appends it to the root doc's `rosterClaims` Y.Array. The desktop's
 * RosterManager.reconcile() then accepts it (first-claim-wins per username; the
 * signature is checked against the op's own public key). The parent cannot sign
 * for the phone — this is genuinely the phone's key.
 *
 * The private key is used only to sign and is NOT retained or persisted (session
 * model). We keep just the public key + username for presence labels.
 */
import { deriveCompanionIdentity, signDeviceClaim } from './device-link';

const COLORS = ['#2383e2', '#e2683c', '#3ca36a', '#a05cd6', '#d6a23c', '#d63c7a'];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export type ClaimedIdentity = { publicKey: string; username: string; color: string };

export async function claimIdentity(
  rootDoc: any,
  material: any,
  { username, password, deviceName = 'iPhone' }: { username: string; password: string; deviceName?: string },
): Promise<ClaimedIdentity> {
  const uname = String(username || '').trim();
  if (!uname) throw new Error('Username is required');
  if (!password) throw new Error('Password is required');

  const payload = { teamRootKey: material.teamRootKey, teamId: material.teamId };
  const id = await deriveCompanionIdentity(payload, { username: uname, password });
  if (!id) throw new Error('Could not derive identity from those credentials');

  const signed = await signDeviceClaim({ username: id.username, identity: id, deviceName });
  if (!signed) throw new Error('Could not sign the membership claim');

  if (!rootDoc) throw new Error('Not connected to the team');
  rootDoc.getArray('rosterClaims').push([signed]);

  return { publicKey: id.publicKey, username: id.username, color: colorFor(id.publicKey) };
}
