/**
 * screen-search.js — the mobile companion Search screen.
 *
 * v1 SCOPE: title-only search across the ACTIVE team's note tree. A back
 * affordance + a sticky search input (>=16px font so iOS does not zoom on
 * focus) + a results list. Tap a result -> app.openNote(teamId, id, title).
 *
 * WHY title-only (and NOT the desktop Indexer): src/renderer/src/indexer.js
 * builds its index from `window.api.invoke('fs:getDirectoryTree' / 'fs:readFile')`
 * — i.e. filesystem paths. On the companion, P2P team notes live inside CRDT
 * docs (Y.Text), NOT in the VFS, so Indexer.buildIndex() walks an empty tree and
 * Indexer.search() returns nothing. The correct, dependency-free source for
 * companion notes is P2PTeamManager.getNotesTree(teamId), which returns the
 * already-nested, already-sorted, tombstone-filtered title tree synchronously.
 * Content search would require opening every per-note engine — explicitly out of
 * v1 scope.
 *
 * This file is a pure VIEW screen: it reads only through the passed `app` object
 * (app.teamManager / app.activeTeamId / app.openNote / app.nav). It never touches
 * openP2PDoc, yCollab, the roster, identity, or constructs any manager.
 */

import {
  el, icon, Header, ListRow, IconButton,
} from './ui.js'

const DEBOUNCE_MS = 120

/**
 * Flatten the nested note tree (from getNotesTree) into a flat array, depth-first,
 * preserving the visual order. Each entry carries the node plus its depth so a
 * future slice could indent; v1 results are flat rows.
 *
 * @param {Array} nodes  array of { id, title, children, locked?, ... }
 * @param {Array} out    accumulator
 * @returns {Array<{ id, title, locked?, restricted?, hasAccess? }>}
 */
function flattenTree(nodes, out = []) {
  if (!Array.isArray(nodes)) return out
  for (const n of nodes) {
    if (!n) continue
    out.push(n)
    if (n.children && n.children.length) flattenTree(n.children, out)
  }
  return out
}

/**
 * Case-insensitive substring match of `query` against a note title.
 * Locked (restricted-no-access) notes have title 'Restricted' (see
 * p2p-team.js:229); we still surface them on a matching query so the user knows
 * the note exists, but they are rendered muted and are not openable.
 *
 * @param {Array} flat   flattened notes
 * @param {string} query trimmed lowercase query
 * @returns {Array} matching notes
 */
function matchNotes(flat, query) {
  if (!query) return []
  return flat.filter((n) => {
    const title = typeof n.title === 'string' ? n.title : ''
    return title.toLowerCase().includes(query)
  })
}

/**
 * Create the Search screen.
 *
 * @param {object} args
 * @param {object} args.app  the frozen app API (teamManager, activeTeamId, openNote, nav)
 * @returns {{ root: HTMLElement, onEnter: Function, onLeave: Function, onDestroy: Function, title: string }}
 */
export function createSearchScreen({ app }) {
  // ── Header: back + static title. Back goes through the nav stack so the
  //    slide-over / history rules in app-shell still apply. ───────────────────
  const backBtn = IconButton({
    icon: 'back',
    label: 'Back',
    onTap: () => app.nav.pop(),
  })
  const header = Header({ title: 'Search', left: backBtn })

  // ── Sticky search input. font-size 16px is load-bearing: <16px triggers iOS
  //    focus-zoom. autocapitalize/autocorrect off so search behaves like search,
  //    not prose. type=search gives the clear (x) affordance on most engines. ──
  const input = el('input', {
    class: 'mob-search-input',
    type: 'search',
    placeholder: 'Search notes…',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    attrs: {
      'aria-label': 'Search notes',
      enterkeyhint: 'search',
      inputmode: 'search',
    },
  })
  const searchBar = el('div', { class: 'mob-search-bar' }, [input])

  // ── Results region (scrollable, momentum/contain handled by CSS). ───────────
  const results = el('div', { class: 'mob-search-results' })

  const root = el('div', { class: 'mob-screen mob-search-screen' }, [
    header.root,
    searchBar,
    results,
  ])

  // ── Rendering ──────────────────────────────────────────────────────────────

  function renderMessage(text) {
    results.replaceChildren(
      el('div', { class: 'mob-search-empty', text }),
    )
  }

  function renderResults(query) {
    const teamId = app.activeTeamId
    // getNotesTree is the ONE _get-backed-adjacent call that is safe: it uses
    // _teams.get and returns [] for an unknown / not-yet-loaded teamId (no throw).
    // Still guard defensively in case the shape ever changes.
    let tree = []
    try {
      tree = teamId ? (app.teamManager.getNotesTree(teamId) || []) : []
    } catch (_e) {
      tree = []
    }

    if (!teamId) {
      renderMessage('No workspace selected.')
      return
    }
    if (!query) {
      renderMessage('Type to search this workspace.')
      return
    }

    const flat = flattenTree(tree)
    const matches = matchNotes(flat, query)

    if (matches.length === 0) {
      renderMessage(`No notes matching “${query}”.`)
      return
    }

    const rows = matches.map((node) => {
      const locked = !!node.locked || (node.restricted && node.hasAccess === false)
      return ListRow({
        icon: locked ? 'lock' : 'note',
        title: typeof node.title === 'string' && node.title ? node.title : 'Untitled',
        muted: locked,
        onTap: () => {
          if (locked) {
            // Restricted, no key — surface the existing no-access path rather
            // than attempting openNote (which would throw NO_ACCESS).
            window.dispatchEvent(new CustomEvent('cmd:note-no-access', {
              detail: { teamId, noteId: node.id },
            }))
            return
          }
          app.openNote(teamId, node.id, node.title)
        },
      })
    })
    results.replaceChildren(...rows)
  }

  // ── Debounced input handling ────────────────────────────────────────────────
  let debounceTimer = null
  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      renderResults(input.value.trim().toLowerCase())
    }, DEBOUNCE_MS)
  }

  function onInput() {
    scheduleRender()
  }

  function onKeydown(e) {
    if (e.key === 'Enter') {
      // Commit immediately on Enter (skip the debounce) + drop the keyboard.
      e.preventDefault()
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
      renderResults(input.value.trim().toLowerCase())
    }
  }

  input.addEventListener('input', onInput)
  input.addEventListener('keydown', onKeydown)

  // Re-render live while this screen is mounted and the active team's tree
  // changes (e.g. a note created/renamed/deleted on another device).
  function onTreeUpdated(e) {
    if (!e || !e.detail || e.detail.teamId !== app.activeTeamId) return
    renderResults(input.value.trim().toLowerCase())
  }

  return {
    title: 'Search',
    root,
    onEnter() {
      window.addEventListener('team:tree-updated', onTreeUpdated)
      // Paint the initial prompt, then focus so the keyboard rises.
      renderResults(input.value.trim().toLowerCase())
      // Defer focus a tick so the slide-in transition has begun (focusing
      // mid-transform can be dropped by some mobile browsers).
      setTimeout(() => { try { input.focus() } catch (_e) { /* noop */ } }, 80)
    },
    onLeave() {
      try { input.blur() } catch (_e) { /* noop */ }
    },
    onDestroy() {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
      window.removeEventListener('team:tree-updated', onTreeUpdated)
      input.removeEventListener('input', onInput)
      input.removeEventListener('keydown', onKeydown)
    },
  }
}
