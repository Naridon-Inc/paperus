// @ts-nocheck
/**
 * notes.ts — read the team root doc's note tree, a faithful port of
 * p2p-team.js `getNotesTree`. The root doc's `notes` is a flat Y.Map keyed by
 * note id; each value is a plain JS object. Nesting is reconstructed from each
 * entry's `parentId`, tombstones (`deleted`) are filtered out, and siblings sort
 * by `order` then `createdAt`.
 *
 * Normal notes carry a PLAINTEXT `title` — readable from root-doc sync alone, no
 * per-note doc needed. Restricted notes have no plaintext title (it's AEAD'd in
 * `encMeta`, unlockable only with the team identity + ACL grant) so they surface
 * as a locked "Restricted" row. Identity-based unlock is deferred past v1.
 */

export type NoteNode = {
  id: string;
  parentId: string | null;
  order?: number;
  createdAt?: number;
  title: string;
  restricted?: boolean;
  locked?: boolean;
  children?: NoteNode[];
  depth?: number;
};

export function readNotesTree(doc: any): NoteNode[] {
  const notes = doc.getMap('notes');
  const all: NoteNode[] = [];
  notes.forEach((v: any, id: string) => {
    if (!v || v.deleted) return;
    if (v.restricted) {
      all.push({
        id,
        parentId: v.parentId || null,
        order: v.order,
        createdAt: v.createdAt,
        restricted: true,
        locked: true,
        title: 'Restricted',
      });
      return;
    }
    all.push({
      id,
      parentId: v.parentId || null,
      order: v.order,
      createdAt: v.createdAt,
      title: v.title || 'Untitled',
    });
  });

  const byParent = new Map<string | null, NoteNode[]>();
  for (const n of all) {
    const p = n.parentId || null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(n);
  }
  const sortFn = (a: NoteNode, b: NoteNode) =>
    (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0);
  const build = (parentId: string | null): NoteNode[] =>
    (byParent.get(parentId) || []).sort(sortFn).map((n) => ({ ...n, children: build(n.id) }));
  return build(null);
}

export function readTeamName(doc: any): string | null {
  try {
    return doc.getMap('teamMeta').get('name') || null;
  } catch (_e) {
    return null;
  }
}

/** Flatten the nested tree into indented rows for a simple list render. */
export function flattenTree(tree: NoteNode[], depth = 0, out: NoteNode[] = []): NoteNode[] {
  for (const node of tree) {
    out.push({ ...node, depth });
    if (node.children && node.children.length) flattenTree(node.children, depth + 1, out);
  }
  return out;
}

export function countNotes(tree: NoteNode[]): number {
  let n = 0;
  for (const node of tree) {
    n += 1;
    if (node.children) n += countNotes(node.children);
  }
  return n;
}
