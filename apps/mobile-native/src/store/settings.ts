// @ts-nocheck
/**
 * settings.ts — small persisted app settings + per-team identity profile.
 *
 * Two things live here, both non-secret and safe in AsyncStorage:
 *   • signaling — the comma-separated relay list (editable in Settings).
 *   • identities — { [teamId]: { publicKey, username, color } }, the claimed
 *     membership label for presence. The PRIVATE key and password are never
 *     stored (session model); only the public key + username (both already public
 *     in the signed roster) are cached so the phone shows "you are <name>".
 */
import { getJSON, setJSON } from './persistence';
import { DEFAULT_SIGNALING } from '../config';

const SIG_KEY = 'settings:signaling:v1';
const ID_KEY = 'settings:identities:v1';

let signaling = DEFAULT_SIGNALING;
let identities: Record<string, { publicKey: string; username: string; color: string }> = {};
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (_e) {
      /* noop */
    }
  }
}

export function onSettingsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadSettings(): Promise<void> {
  if (loaded) return;
  signaling = await getJSON<string>(SIG_KEY, DEFAULT_SIGNALING);
  identities = await getJSON(ID_KEY, {});
  loaded = true;
  emit();
}

export function getSignaling(): string {
  return signaling;
}

export async function setSignaling(value: string): Promise<void> {
  signaling = value && value.trim() ? value : DEFAULT_SIGNALING;
  await setJSON(SIG_KEY, signaling);
  emit();
}

export function getIdentity(teamId: string) {
  return identities[teamId] || null;
}

export async function setIdentity(
  teamId: string,
  id: { publicKey: string; username: string; color: string },
): Promise<void> {
  identities = { ...identities, [teamId]: id };
  await setJSON(ID_KEY, identities);
  emit();
}

export async function clearIdentity(teamId: string): Promise<void> {
  if (!identities[teamId]) return;
  const next = { ...identities };
  delete next[teamId];
  identities = next;
  await setJSON(ID_KEY, identities);
  emit();
}
