/**
 * slide-over.js — the left drawer that REPLACES the desktop sidebar on mobile.
 *
 * It is the workspace switcher + roster viewer: lists the teams from
 * `window.p2pTeamManager` (switching the active team), offers New/Join team
 * actions (reusing the desktop dialogs via `cmd:*` window events), and shows the
 * active team's roster. There is exactly ONE drawer in the mobile shell and it
 * genuinely goes off-canvas (`transform: translateX(-100%)` under the
 * `#mobile-root` scope owned by mobile-shell.css) — no ID-specificity war with
 * the desktop `#sidebar` rule.
 *
 * View-only: it NEVER instantiates SidebarManager, never opens an engine, never
 * touches openP2PDoc/yCollab/roster crypto. It reads the seams off `app`
 * (app.teamManager / app.activeTeamId / app.setActiveTeam / app.closeSlideOver)
 * and re-renders on the live team:* window events.
 *
 * IMPORTANT seam discipline (from the build contract's adversarial review):
 *   - getRoster(teamId)/getName(teamId) THROW for an unknown/not-yet-loaded team
 *     (P2PTeamManager._get). p2pTeamManager.init() is async + unawaited, so
 *     activeTeamId can name a team that isn't in _teams yet at first paint. We
 *     therefore (a) read the team NAME from the getTeams() entry (it carries
 *     {teamId,name,rootKey}) and (b) wrap every getRoster() call in try/catch.
 *   - getTeams() returns rootKey (the team secret) — never render or log it.
 */

import { el, icon, ListRow } from './ui.js'

const SWIPE_CLOSE_THRESHOLD = 60 // px of leftward drag before a swipe closes
const SWIPE_LOCK_SLOP = 10 // px before we decide a gesture is horizontal

/**
 * Create the left slide-over.
 *
 * @param {object} app  the frozen app API from app-shell.js. Reads:
 *   app.teamManager (P2PTeamManager), app.activeTeamId, app.setActiveTeam(id),
 *   app.closeSlideOver().
 * @returns {{ el: HTMLElement, root: HTMLElement, open(): void, close(): void,
 *             isOpen(): boolean, render(): void, destroy(): void }}
 */
export function createSlideOver(app) {
  let open = false

  // ── DOM scaffold ────────────────────────────────────────────────────────────
  const scrim = el('div', {
    class: 'mob-slideover-scrim',
    attrs: { 'aria-hidden': 'true' },
    onpointerup: () => doClose(),
  })

  const headerLabel = el('div', { class: 'mob-slideover__label', text: 'Workspaces' })
  const header = el('div', { class: 'mob-slideover__header' }, [
    headerLabel,
  ])

  const body = el('div', { class: 'mob-slideover__body' })

  const panel = el('div', {
    class: 'mob-slideover__panel',
    attrs: { role: 'dialog', 'aria-label': 'Workspaces and teams', 'aria-modal': 'true' },
  }, [header, body])

  const root = el('div', { class: 'mob-slideover' }, [scrim, panel])

  // ── Section builders ─────────────────────────────────────────────────────────

  function section(title) {
    return el('div', { class: 'mob-slideover__section-title', text: title })
  }

  function renderTeams(teams, activeId) {
    const frag = document.createDocumentFragment()
    frag.appendChild(section('Teams'))

    if (!teams.length) {
      frag.appendChild(el('div', {
        class: 'mob-slideover__empty',
        text: 'No teams yet. Create or join one to get started.',
      }))
    } else {
      for (const team of teams) {
        const isActive = team.teamId === activeId
        const row = ListRow({
          icon: 'team',
          title: team.name || 'Team',
          trailing: isActive ? checkMark() : null,
          onTap: () => {
            if (team.teamId === app.activeTeamId) { doClose(); return }
            // setActiveTeam closes the slide-over + resets Home (per the contract).
            app.setActiveTeam(team.teamId)
          },
        })
        if (isActive) row.classList.add('mob-listrow--active')
        frag.appendChild(row)
      }
    }

    // New / Join actions — reuse the desktop dialogs via window cmd:* events.
    frag.appendChild(ListRow({
      icon: 'plus',
      title: 'New team',
      onTap: () => {
        doClose()
        window.dispatchEvent(new CustomEvent('cmd:create-team'))
      },
    }))
    frag.appendChild(ListRow({
      icon: 'key',
      title: 'Join team',
      onTap: () => {
        doClose()
        window.dispatchEvent(new CustomEvent('cmd:join-team'))
      },
    }))

    return frag
  }

  function renderRoster(activeId, teams) {
    const frag = document.createDocumentFragment()
    if (!activeId) return frag

    // Only attempt getRoster() if the team is actually loaded (getTeams membership).
    const loaded = teams.some((t) => t.teamId === activeId)
    if (!loaded) return frag

    let members = []
    try {
      const roster = app.teamManager.getRoster(activeId)
      members = (roster && typeof roster.getMembers === 'function') ? roster.getMembers() : []
    } catch (_e) {
      // Unknown/not-yet-synced team — render nothing for the roster (no throw).
      members = []
    }
    if (!members.length) return frag

    frag.appendChild(section('Members'))
    for (const m of members) {
      const display = m.displayName || m.username || 'Member'
      const sub = m.username ? `@${m.username}` : null
      const dot = m.color
        ? el('span', { class: 'mob-slideover__dot', style: { color: m.color } }, [icon('dot', 10)])
        : null
      frag.appendChild(ListRow({
        icon: 'team',
        title: display,
        subtitle: sub,
        trailing: dot,
      }))
    }
    return frag
  }

  function checkMark() {
    const wrap = el('span', { class: 'mob-slideover__active-dot', attrs: { 'aria-label': 'Active' } })
    wrap.appendChild(icon('chevron-right', 18))
    return wrap
  }

  // ── render() — rebuild content from the live seams ───────────────────────────
  function render() {
    const teams = safeGetTeams()
    const activeId = app.activeTeamId

    // Header label = active team name (from the getTeams() entry — never getName(),
    // which throws for an unloaded team).
    const activeTeam = teams.find((t) => t.teamId === activeId)
    headerLabel.textContent = activeTeam ? (activeTeam.name || 'Team') : 'Workspaces'

    body.replaceChildren()
    body.appendChild(renderTeams(teams, activeId))
    body.appendChild(renderRoster(activeId, teams))
  }

  function safeGetTeams() {
    try {
      const tm = app.teamManager
      return (tm && typeof tm.getTeams === 'function') ? (tm.getTeams() || []) : []
    } catch (_e) {
      return []
    }
  }

  // ── open / close ─────────────────────────────────────────────────────────────
  function doOpen() {
    if (open) return
    render()
    open = true
    root.classList.add('mob-slideover--open')
    scrim.setAttribute('aria-hidden', 'false')
  }

  function doClose() {
    if (!open) return
    open = false
    root.classList.remove('mob-slideover--open')
    scrim.setAttribute('aria-hidden', 'true')
    resetSwipe()
    // Delegate to app so app-shell can keep its Back-interception state in sync.
    if (app && typeof app.closeSlideOver === 'function') {
      // Guard against re-entrancy: app.closeSlideOver() may call back into close().
      // open is already false above, so the early-return makes this safe.
      app.closeSlideOver()
    }
  }

  // ── swipe-left to close (pointer tracking, never hover) ───────────────────────
  let swipe = null

  function resetSwipe() {
    if (swipe) {
      panel.style.transition = ''
      panel.style.transform = ''
    }
    swipe = null
  }

  panel.addEventListener('pointerdown', (e) => {
    if (!open) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    swipe = { x: e.clientX, y: e.clientY, dx: 0, locked: null, id: e.pointerId }
  })

  panel.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.id) return
    const dx = e.clientX - swipe.x
    const dy = e.clientY - swipe.y
    if (swipe.locked === null) {
      if (Math.abs(dx) < SWIPE_LOCK_SLOP && Math.abs(dy) < SWIPE_LOCK_SLOP) return
      swipe.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      if (swipe.locked === 'h') panel.style.transition = 'none'
    }
    if (swipe.locked !== 'h') return
    // Only track leftward (closing) movement; ignore rightward overscroll.
    swipe.dx = Math.min(0, dx)
    panel.style.transform = `translateX(${swipe.dx}px)`
  })

  function endSwipe(e) {
    if (!swipe || (e && e.pointerId !== swipe.id)) return
    const shouldClose = swipe.locked === 'h' && swipe.dx <= -SWIPE_CLOSE_THRESHOLD
    panel.style.transition = ''
    panel.style.transform = ''
    swipe = null
    if (shouldClose) doClose()
  }

  panel.addEventListener('pointerup', endSwipe)
  panel.addEventListener('pointercancel', endSwipe)

  // ── live re-render on team lifecycle events (only while open) ─────────────────
  const onTeams = () => { if (open) render() }
  const onRoster = (e) => {
    if (!open) return
    const tid = e && e.detail && e.detail.teamId
    if (!tid || tid === app.activeTeamId) render()
  }
  const onIdentity = () => { if (open) render() }

  window.addEventListener('team:list-updated', onTeams)
  window.addEventListener('team:roster-updated', onRoster)
  window.addEventListener('team:identity-ready', onIdentity)

  function destroy() {
    window.removeEventListener('team:list-updated', onTeams)
    window.removeEventListener('team:roster-updated', onRoster)
    window.removeEventListener('team:identity-ready', onIdentity)
    root.remove()
  }

  return {
    el: root,
    root,
    open: doOpen,
    close: doClose,
    isOpen: () => open,
    render,
    destroy,
  }
}
