// @ts-nocheck
/**
 * decorations.ts — LOCAL per-page icon + cover (the "Add icon / Add cover" affordances).
 *
 * Kept on-device only (AsyncStorage), keyed by `${teamId}:${noteId}`, so the
 * desktop's note CRDT schema is never touched (desktop replaces the whole note
 * object on its writes and would drop unknown fields). Icons are Ionicons names
 * + a color; covers are a solid color band — both chosen from theme palettes.
 */
import { getJSON, setJSON } from './persistence';

const KEY = 'decorations:v1';

export type Decoration = { icon?: string | null; iconColor?: string | null; cover?: string | null };

let map: Record<string, Decoration> = {};
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

export function onDecorationsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadDecorations(): Promise<void> {
  if (loaded) return;
  map = await getJSON(KEY, {});
  loaded = true;
  emit();
}

function k(teamId: string, noteId: string): string {
  return `${teamId}:${noteId}`;
}

export function getDecoration(teamId: string, noteId: string): Decoration {
  return map[k(teamId, noteId)] || {};
}

export async function setDecoration(teamId: string, noteId: string, patch: Decoration): Promise<void> {
  const key = k(teamId, noteId);
  map = { ...map, [key]: { ...(map[key] || {}), ...patch } };
  await setJSON(KEY, map);
  emit();
}
