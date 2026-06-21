/**
 * daily-notes.js — pure helpers for the Daily Notes feature (Obsidian/Roam style).
 *
 * A daily note is a note titled with the ISO date (e.g. `2026-06-20`). The
 * orchestration (create-or-open, local vault vs P2P team) lives in main.js where
 * the note helpers are in scope; this module holds only the pure, testable bits:
 * date formatting, the seed template, and a tree title lookup.
 */

/** Today's date as a local `YYYY-MM-DD` string (local, not UTC, so it doesn't
 * roll a day near midnight). */
export function todayISO(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Human-friendly form of a `YYYY-MM-DD` string, e.g. "Friday, June 20, 2026".
 * Parsed at noon so the weekday/day never shifts due to timezone. */
export function prettyDate(dateStr) {
  try {
    const d = new Date(`${dateStr}T12:00:00`)
    return d.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch (_e) {
    return dateStr
  }
}

/** The Markdown body a fresh daily note is seeded with. The first line is an H1
 * equal to the date — createNewNote() derives the filename from it, so the file
 * lands as `<date>.md` and resolveWikiTitle() can find it again tomorrow. */
export function buildDailyNoteBody(dateStr) {
  return `# ${dateStr}

*${prettyDate(dateStr)}*

## Focus
-

## Notes


## Wins
-
`
}

/** Depth-first search of a (possibly nested) notes tree for a node whose title
 * matches `title` exactly. Returns the node or null. Tolerates both flat arrays
 * and `{ children: [...] }` nesting. */
export function findNoteByTitle(tree, title) {
  const wanted = String(title).trim()
  const stack = Array.isArray(tree) ? [...tree] : (tree ? [tree] : [])
  while (stack.length) {
    const node = stack.shift()
    if (!node) continue
    if (!node.deleted && String(node.title || '').trim() === wanted) return node
    if (Array.isArray(node.children) && node.children.length) stack.push(...node.children)
  }
  return null
}
