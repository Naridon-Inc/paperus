// @ts-nocheck
/**
 * sessions.ts — process-wide registry of live TeamSession instances, keyed by
 * teamId. Screens reach the one live connection for a team (so Notes → Editor →
 * back doesn't tear down + re-handshake the P2P mesh). The session is created and
 * connect()-ed lazily on first request and reused thereafter.
 */
import { TeamSession } from '../engine/session';
import { getSignaling } from './settings';
import { parseSignalingList } from '../config';
import { getTeam } from './teams';

const sessions = new Map<string, TeamSession>();

/** Get (creating + connecting if needed) the live session for a stored team. */
export function getSession(teamId: string): TeamSession | null {
  let s = sessions.get(teamId);
  if (s) return s;
  const team = getTeam(teamId);
  if (!team) return null;
  const material = {
    teamRootKey: team.teamRootKey,
    teamId: team.teamId,
    teamDocId: team.teamDocId,
    swarmKey: team.swarmKey,
    e2eeKey: team.e2eeKey,
    teamName: team.teamName,
  };
  s = new TeamSession(material, parseSignalingList(getSignaling()));
  sessions.set(teamId, s);
  // fire-and-forget; screens render off status + subscribe()
  s.connect();
  return s;
}

export function peekSession(teamId: string): TeamSession | null {
  return sessions.get(teamId) || null;
}

export function dropSession(teamId: string): void {
  const s = sessions.get(teamId);
  if (!s) return;
  try {
    s.disconnect();
  } catch (_e) {
    /* noop */
  }
  sessions.delete(teamId);
}

export function dropAllSessions(): void {
  for (const id of [...sessions.keys()]) dropSession(id);
}
