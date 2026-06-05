/**
 * screen-home.js — the mobile companion's landing screen.
 *
 * Renders the active team's name as a header (with a left menu affordance that
 * opens the workspace slide-over and a right "+ New note" affordance), then lays
 * out that team's note tree (verbatim from P2PTeamManager.getNotesTree) as nested,
 * tappable ListRows. Tapping a non-restricted row opens the note via app.openNote
 * (which pushes the NoteScreen and owns its engine lifecycle); restricted/locked
 * rows are muted and show a notice instead of opening. A long-press on a row opens
 * an overflow menu (Rename / Delete) backed by teamManager.renameNote/deleteNote.
 *
 * It is a pure VIEW screen: it never constructs managers, never opens an engine,
 * never touches yCollab/openP2PDoc. All data + actions flow through the `app`
 * object frozen in app-shell.js. It is event-driven — p2pTeamManager.init() is
 * async and unawaited, so getTeams()/getNotesTree() can be empty at first paint;
 * the screen re-renders on 'team:list-updated' / 'team:tree-updated' while mounted.
 *
 * Engine-layer guard: every _get-backed manager call (createNote/renameNote/
 * deleteNote/openNote) THROWS for an unknown teamId (p2p-team.js:142-145). Because
 * activeTeamId can name a team init() hasn't loaded yet, those calls are guarded.
 * getNotesTree is the one safe call (returns [] for an unknown teamId).
 */

import {
  el, icon, Header, ListRow, IconButton,
} from './ui.js'

/**
 * Build the mobile Home screen.
 *
 * @param {object} app  the frozen app API from app-shell.js. Reads:
 *   app.teamManager, app.activeTeamId, app.openNote, app.newNote, app.openSlideOver,
 *   app.nav (unused here but part of the contract surface).
 * @returns {{ root: HTMLElement, onEnter: () => void, onLeave: () => void, onDestroy: () => void, title: string }}
 */
export function createHomeScreen({ app }) {
  const tm = app.teamManager

  // ── Header: left = menu (slide-over), right = + New note ──────────────────────
  const menuBtn = IconButton({
    icon: 'menu',
    label: 'Workspaces',
    onTap: () => app.openSlideOver(),
  })
  const newBtn = IconButton({
    icon: 'plus',
    label: 'New note',
    onTap: () => { app.newNote() },
  })
  const header = Header({ title: 'Notionless', left: menuBtn, right: newBtn })

  // ── Scrollable list region ────────────────────────────────────────────────────
  const listEl = el('div', { class: 'mob-home-list' })

  const root = el('div', { class: 'mob-screen-body mob-home' }, [header.root, listEl])

  // Track an open overflow menu so we can dismiss it on re-render / outside tap.
  let openMenu = null
  const closeMenu = () => {
    if (openMenu) {
      openMenu.remove()
      openMenu = null
    }
  }

  // Resolve the active team's display name from getTeams() (carries {teamId,name})
  // rather than getName(), which throws for an id init() hasn't loaded yet.
  const resolveTeamName = (teamId) => {
    if (!teamId) return 'Notionless'
    try {
      const match = tm.getTeams().find((t) => t.teamId === teamId)
      return (match && match.name) || 'Team'
    } catch (_e) {
      return 'Team'
    }
  }

  // ── Empty states ──────────────────────────────────────────────────────────────
  const renderNoTeams = () => {
    listEl.appendChild(
      el('div', { class: 'mob-empty' }, [
        el('div', { class: 'mob-empty-icon' }, [icon('team', 40)]),
        el('div', { class: 'mob-empty-title', text: 'No workspace yet' }),
        el('div', {
          class: 'mob-empty-sub',
          text: 'Create a team or join one with an invite link to start taking notes.',
        }),
        el('button', {
          class: 'mob-empty-btn',
          type: 'button',
          onclick: () => window.dispatchEvent(new CustomEvent('cmd:create-team')),
        }, ['Create or join a team']),
      ]),
    )
  }

  const renderNoNotes = () => {
    listEl.appendChild(
      el('div', { class: 'mob-empty' }, [
        el('div', { class: 'mob-empty-icon' }, [icon('note', 40)]),
        el('div', { class: 'mob-empty-title', text: 'No notes yet' }),
        el('div', {
          class: 'mob-empty-sub',
          text: 'Tap + to create your first note in this workspace.',
        }),
        el('button', {
          class: 'mob-empty-btn',
          type: 'button',
          onclick: () => { app.newNote() },
        }, ['New note']),
      ]),
    )
  }

  // ── Overflow (long-press) menu: Rename / Delete ───────────────────────────────
  const showRowMenu = (teamId, node, anchorEl) => {
    closeMenu()
    const rect = anchorEl.getBoundingClientRect()

    const renameItem = el('button', {
      class: 'mob-menu-item',
      type: 'button',
      onpointerup: async (e) => {
        e.preventDefault()
        closeMenu()
        const next = window.prompt('Rename note', node.title || 'Untitled')
        if (next == null) return
        const title = next.trim()
        if (!title || title === node.title) return
        try {
          await tm.renameNote(teamId, node.id, title)
          // 'team:tree-updated' fires from the rename transact -> re-render.
        } catch (err) {
          window.alert(`Couldn't rename: ${(err && err.message) || err}`)
        }
      },
    }, [icon('note', 18), el('span', { text: 'Rename' })])

    const deleteItem = el('button', {
      class: 'mob-menu-item mob-menu-item--danger',
      type: 'button',
      onpointerup: async (e) => {
        e.preventDefault()
        closeMenu()
        // eslint-disable-next-line no-alert
        if (!window.confirm(`Delete "${node.title || 'Untitled'}"? This removes it for the whole team.`)) return
        try {
          await tm.deleteNote(teamId, node.id)
        } catch (err) {
          window.alert(`Couldn't delete: ${(err && err.message) || err}`)
        }
      },
    }, [icon('close', 18), el('span', { text: 'Delete' })])

    const menu = el('div', { class: 'mob-menu', role: 'menu' }, [renameItem, deleteItem])
    const scrim = el('div', {
      class: 'mob-menu-scrim',
      onpointerup: (e) => { e.preventDefault(); closeMenu() },
    })

    // Position the menu near the row; clamp to the viewport bottom.
    const top = Math.min(rect.bottom + 4, window.innerHeight - 120)
    menu.style.top = `${Math.max(8, top)}px`

    const wrap = el('div', { class: 'mob-menu-layer' }, [scrim, menu])
    document.body.appendChild(wrap)
    openMenu = wrap
  }

  // ── Recursive note-tree rendering ─────────────────────────────────────────────
  const renderNodes = (teamId, nodes, depth) => {
    for (const node of nodes) {
      const locked = !!node.locked
      const row = ListRow({
        icon: locked ? 'lock' : 'note',
        title: node.title || 'Untitled',
        trailing: (node.children && node.children.length)
          ? icon('chevron-down', 18)
          : null,
        indent: depth,
        muted: locked,
        onTap: () => {
          if (locked) {
            // Restricted note we can't decrypt — never call openNote on it.
            window.dispatchEvent(new CustomEvent('cmd:note-no-access', {
              detail: { teamId, noteId: node.id },
            }))
            return
          }
          app.openNote(teamId, node.id, node.title || 'Untitled')
        },
        onLongPress: locked ? null : (ev) => {
          showRowMenu(teamId, node, (ev && ev.currentTarget) || row)
        },
      })
      listEl.appendChild(row)
      if (node.children && node.children.length) {
        renderNodes(teamId, node.children, depth + 1)
      }
    }
  }

  // ── Full render pass ──────────────────────────────────────────────────────────
  const render = () => {
    closeMenu()
    listEl.replaceChildren()

    let teams = []
    try { teams = tm.getTeams() } catch (_e) { teams = [] }

    const teamId = app.activeTeamId
    header.setTitle(resolveTeamName(teamId))

    if (!teams.length || !teamId) {
      renderNoTeams()
      return
    }

    // getNotesTree is the safe call — returns [] for an unknown/not-yet-loaded id.
    const tree = tm.getNotesTree(teamId)
    if (!tree.length) {
      renderNoNotes()
      return
    }
    renderNodes(teamId, tree, 0)
  }

  // ── Live re-render wiring (only while mounted) ────────────────────────────────
  const onTree = (e) => {
    if (!e || !e.detail || e.detail.teamId === app.activeTeamId) render()
  }
  const onList = () => render()

  let subscribed = false
  const subscribe = () => {
    if (subscribed) return
    window.addEventListener('team:tree-updated', onTree)
    window.addEventListener('team:list-updated', onList)
    window.addEventListener('team:identity-ready', onList)
    subscribed = true
  }
  const unsubscribe = () => {
    if (!subscribed) return
    window.removeEventListener('team:tree-updated', onTree)
    window.removeEventListener('team:list-updated', onList)
    window.removeEventListener('team:identity-ready', onList)
    subscribed = false
  }

  return {
    title: 'Home',
    root,
    onEnter() {
      subscribe()
      render()
    },
    onLeave() {
      closeMenu()
      unsubscribe()
    },
    onDestroy() {
      closeMenu()
      unsubscribe()
    },
  }
}
