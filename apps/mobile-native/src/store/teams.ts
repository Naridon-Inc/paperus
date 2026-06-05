// @ts-nocheck
/**
 * teams.ts — the list of teams this phone has joined, persisted across launches.
 *
 * Each entry is the full team material derived from a link (teamRootKey + the
 * derived ids/keys + a display name). teamRootKey is the team's whole secret;
 * persisting it is what keeps the phone "linked" (see docs/MOBILE_COMPANION.md).
 * v1 stores it via AsyncStorage (plaintext) — moving the secret to
 * expo-secure-store (Keychain) is the planned hardening.
 *
 * Simple observable store: components subscribe with `onTeamsChange`.
 */
import { getJSON, setJSON } from './persistence';
import { clearPersistence } from '../engine/yjs-persist';

export type Team = {
  teamRootKey: string;
  teamId: string;
  teamDocId: string;
  swarmKey: string;
  e2eeKey: string;
  teamName: string | null;
  addedAt: number;
};

const KEY = 'teams:v1';

let teams: Team[] = [];
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

export function onTeamsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getTeams(): Team[] {
  return teams;
}

export function getTeam(teamId: string): Team | undefined {
  return teams.find((t) => t.teamId === teamId);
}

export async function loadTeams(): Promise<Team[]> {
  if (loaded) return teams;
  teams = await getJSON<Team[]>(KEY, []);
  loaded = true;
  emit();
  return teams;
}

/** Upsert a team from derived material; returns the stored entry. */
export async function addTeam(material: any): Promise<Team> {
  const existing = teams.find((t) => t.teamId === material.teamId);
  if (existing) {
    Object.assign(existing, {
      teamRootKey: material.teamRootKey,
      teamDocId: material.teamDocId,
      swarmKey: material.swarmKey,
      e2eeKey: material.e2eeKey,
      teamName: material.teamName ?? existing.teamName,
    });
    teams = [...teams];
  } else {
    teams = [
      ...teams,
      {
        teamRootKey: material.teamRootKey,
        teamId: material.teamId,
        teamDocId: material.teamDocId,
        swarmKey: material.swarmKey,
        e2eeKey: material.e2eeKey,
        teamName: material.teamName ?? null,
        addedAt: Date.now(),
      },
    ];
  }
  await setJSON(KEY, teams);
  emit();
  return teams.find((t) => t.teamId === material.teamId)!;
}

export async function setTeamName(teamId: string, name: string): Promise<void> {
  const t = teams.find((x) => x.teamId === teamId);
  if (!t) return;
  t.teamName = name;
  teams = [...teams];
  await setJSON(KEY, teams);
  emit();
}

export async function removeTeam(teamId: string): Promise<void> {
  const t = teams.find((x) => x.teamId === teamId);
  teams = teams.filter((x) => x.teamId !== teamId);
  await setJSON(KEY, teams);
  if (t) {
    try {
      await clearPersistence(t.teamDocId);
    } catch (_e) {
      /* noop */
    }
  }
  emit();
}
