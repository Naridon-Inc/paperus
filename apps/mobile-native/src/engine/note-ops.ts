// @ts-nocheck
/**
 * note-ops.ts — create / rename / delete / move notes in the team ROOT doc,
 * matching p2p-team.js's writes to the `notes` Y.Map. Each note value is a plain
 * JS object replaced wholesale (CRDT-safe last-writer-wins on the map key);
 * deletes are tombstones (`deleted: true`), never key removals.
 *
 * These write through the plaintext root doc, so the E2EE publish observer in
 * p2p-doc encrypts + broadcasts them to the desktop. No signature/identity is
 * required — this is the content CRDT, not the signed roster.
 *
 * Mobile creates NORMAL (unrestricted) notes only; restricted-note creation needs
 * the identity + ACL-wrap path, which is desktop-only for now.
 */

/** Stable, collision-resistant note id. Format is cosmetic — desktop reads by key. */
export function uid(prefix = 'note'): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${ts}_${rand}`;
}

function nextSiblingOrder(notes: any, parentId: string | null): number {
  let max = -1;
  notes.forEach((v: any) => {
    if (v && !v.deleted && (v.parentId || null) === (parentId || null)) {
      if (typeof v.order === 'number' && v.order > max) max = v.order;
    }
  });
  return max + 1;
}

export function createNote(doc: any, { title = 'Untitled', parentId = null } = {}): string {
  const notes = doc.getMap('notes');
  const id = uid('note');
  const order = nextSiblingOrder(notes, parentId);
  doc.transact(() => {
    notes.set(id, {
      id,
      parentId: parentId || null,
      order,
      createdAt: Date.now(),
      deleted: false,
      title,
    });
  }, 'mobile');
  return id;
}

export function renameNote(doc: any, noteId: string, title: string): void {
  const notes = doc.getMap('notes');
  const cur = notes.get(noteId);
  if (!cur || cur.restricted) return; // restricted titles live encrypted in encMeta
  doc.transact(() => notes.set(noteId, { ...cur, title }), 'mobile');
}

export function deleteNote(doc: any, noteId: string): void {
  const notes = doc.getMap('notes');
  const cur = notes.get(noteId);
  if (!cur) return;
  doc.transact(() => notes.set(noteId, { ...cur, deleted: true, deletedAt: Date.now() }), 'mobile');
}

export function moveNote(doc: any, noteId: string, parentId: string | null, order?: number): void {
  const notes = doc.getMap('notes');
  const cur = notes.get(noteId);
  if (!cur) return;
  doc.transact(
    () => notes.set(noteId, { ...cur, parentId: parentId || null, order: order ?? cur.order }),
    'mobile',
  );
}
