/**
 * app-shell.js — the composition root of the from-scratch mobile view layer.
 *
 * THE PRINCIPLE (locked): reuse the ENGINE/MANAGER layer, rebuild the VIEW.
 * This file NEVER constructs managers, NEVER calls openP2PDoc / yCollab / roster
 * directly, and NEVER touches the desktop DOM beyond hiding it via CSS. It only
 * READS the live `window.p2pTeamManager` singleton that main.js installed during
 * the companion boot (main.js:1599) and the `identity` singleton from
 * ../src/identity, and it composes the nav stack + bottom bar + slide-over + the
 * three v1 screens (Home / Note / Search).
 *
 * It exposes the FROZEN `app` API that every screen is coded against (built in
 * parallel by sibling agents). The shape here is the contract — do not drift it.
 *
 * Boot ordering reality (a flagged risk): p2pTeamManager.init() is async and
 * fire-and-forgotten in main.js (line 1600), so getTeams()/getNotesTree() can be
 * empty at mount time. Everything here is event-driven: we render whatever the
 * manager returns NOW and re-derive the active team + re-render on
 * 'team:list-updated' / 'team:tree-updated' / 'team:identity-ready'.
 *
 * Every _get-backed manager call (openNote/createNote/renameNote/deleteNote/
 * getRoster/getName) THROWS 'Unknown team' for a teamId not yet in _teams, so we
 * guard each one (try/catch or membership check) — activeTeamId can name a team
 * that init() has not loaded yet.
 */

import { el, BottomBar } from './ui.js'
import { createNav } from './nav.js'
import { createSlideOver } from './slide-over.js'
import { createHomeScreen } from './screen-home.js'
import { createSearchScreen } from './screen-search.js'
import { createNoteScreen } from './screen-note.js'
import { identity } from '../../src/identity'

/**
 * Mount the from-scratch mobile shell as the primary UI.
 *
 * Steps:
 *   1. Ensure body.is-mobile (the CSS scope that hides the desktop .window-layout
 *      and turns on the mobile-shell rules). mobile-shell.css owns the actual hide.
 *   2. Create #mobile-root and append it to <body> (a SIBLING of the now-hidden
 *      desktop .window-layout — we hide, never remove, so main.js still owns
 *      #editor/doc-title etc.).
 *   3. Build the nav viewport, the persistent BottomBar (Home/Search + New FAB),
 *      and the left slide-over; append them into #mobile-root.
 *   4. Push the Home screen.
 *   5. Wire BottomBar tabs/FAB + the slide-over trigger + Back interception.
 *   6. Subscribe to the team lifecycle events to re-derive activeTeamId and
 *      refresh Home/SlideOver.
 *
 * Idempotent: a window.__mobileShellMounted guard prevents a double-mount.
 *
 * @param {object} [deps]
 * @param {object} [deps.teamManager]  defaults to window.p2pTeamManager
 * @param {object} [deps.identity]     defaults to the imported identity singleton
 * @param {HTMLElement} [deps.root]    defaults to document.body
 * @returns {object} the frozen `app` API
 */
export function mountMobileApp(deps = {}) {
  // Idempotency guard — a second boot must not stack two shells.
  if (typeof window !== 'undefined' && window.__mobileShellMounted) {
    return window.__mobileApp || null
  }

  const teamManager = deps.teamManager || (typeof window !== 'undefined' ? window.p2pTeamManager : null)
  const ident = deps.identity || identity
  const hostRoot = deps.root || document.body

  // (1) Mobile scope — mobile-shell.css keys every rule (and the desktop-hide)
  // off body.is-mobile. mobile-main.js already adds it, but be defensive.
  document.body.classList.add('is-mobile')

  // (2) #mobile-root — the column shell. The desktop .window-layout is hidden by
  // CSS (body.is-mobile .window-layout{display:none!important}); we never remove it.
  const navHost = el('div', { class: 'mob-navhost' })
  const root = el('div', { id: 'mobile-root' }, [navHost])
  hostRoot.appendChild(root)

  // ── Active-team state ───────────────────────────────────────────────────────
  // Defaults to the first team, but getTeams() can be [] at mount (init() is
  // unawaited). We re-derive on every 'team:list-updated' (see below), so a team
  // that reconnects after mount becomes active without a reload.
  let activeTeamId = null
  const firstTeamId = () => {
    if (!teamManager || typeof teamManager.getTeams !== 'function') return null
    const teams = teamManager.getTeams() || []
    return teams[0] ? teams[0].teamId : null
  }
  const teamExists = (teamId) => {
    if (!teamId || !teamManager || typeof teamManager.getTeams !== 'function') return false
    return (teamManager.getTeams() || []).some((t) => t && t.teamId === teamId)
  }
  activeTeamId = firstTeamId()

  // ── Bottom-bar editing class (the frozen hide/show seam) ────────────────────
  // navModel + mobile-shell.css require app.hideBottomBar()/showBottomBar() to
  // toggle #mobile-root.is-editing (which CSS uses to hide the bottom bar while a
  // NoteScreen is focused). This was flagged as the #1 cross-file break — it MUST
  // be on the frozen API because screen-note.js (built before this file) calls it.
  const hideBottomBar = () => root.classList.add('is-editing')
  const showBottomBar = () => root.classList.remove('is-editing')

  // ── Navigator ───────────────────────────────────────────────────────────────
  const nav = createNav(navHost)

  // ── Slide-over (left workspace/team switcher + roster) ──────────────────────
  // Built before `app` is fully assembled but only READS `app` lazily at
  // open()/render() time, so the late binding below is safe.
  let slideOver = null

  // ── Bottom bar (persistent; Home/Search tabs + centered New FAB) ────────────
  let bottomBar = null

  // ── Home screen factory (re-used by goHome / setActiveTeam reset) ───────────
  const makeHome = () => createHomeScreen({ app })

  // ════════════════════════════════════════════════════════════════════════════
  //  The FROZEN `app` API — every screen + the slide-over is coded against this.
  // ════════════════════════════════════════════════════════════════════════════
  const app = {
    // Live manager + identity (screens never re-resolve them from window).
    teamManager,
    identity: ident,

    // Navigator instance (screens call app.nav.push/pop/...).
    nav,

    // Active team selector.
    get activeTeamId() { return activeTeamId },

    /**
     * Open a note: push a screen-local NoteScreen (which owns the engine lifecycle
     * via openNote/closeNote). Centralized so Home + Search share one path. We
     * deliberately do NOT dispatch cmd:open-team-note — that desktop handler would
     * open a SECOND engine + yCollab binding in the hidden #editor.
     */
    openNote(teamId, noteId, title) {
      if (!teamExists(teamId)) return
      nav.push(createNoteScreen({
        app, teamId, noteId, title: title || 'Untitled',
      }))
    },

    /**
     * Open the per-note engine for a screen. Thin guard around the throwing
     * manager seam — the caller (NoteScreen) still handles err.code==='NO_ACCESS'.
     */
    async openEngine(teamId, noteId) {
      if (!teamManager || typeof teamManager.openNote !== 'function') {
        throw new Error('Team manager unavailable')
      }
      return teamManager.openNote(teamId, noteId) // may throw {code:'NO_ACCESS'} or 'Unknown team'
    },

    /** Tell the manager a note tab closed (re-forms the background replica). */
    closeEngine(teamId, noteId) {
      try {
        if (teamManager && typeof teamManager.closeNote === 'function') {
          teamManager.closeNote(teamId, noteId)
        }
      } catch (_e) { /* unknown team / already closed — nothing to do */ }
    },

    /**
     * Create a note in `teamId` (defaults to the active team), then open it.
     * Routes to the reused desktop create/join + claim flow when there is no team
     * or identity yet — never builds a new dialog.
     */
    async newNote(teamId = activeTeamId) {
      // No team yet → reuse the desktop create/join dialog (cmd:create-team).
      if (!teamExists(teamId)) {
        window.dispatchEvent(new CustomEvent('cmd:create-team'))
        return
      }
      // First write claims an identity (presence + roster 'me'); editing itself
      // works locked, but prompting here is the natural moment. Reuse the desktop
      // claim dialog — do not build a new claim screen.
      if (ident && typeof ident.isUnlocked === 'function' && !ident.isUnlocked(teamId)) {
        try {
          const { openClaimDialog } = await import('../../src/team-dialogs')
          openClaimDialog(teamManager, teamId, { afterClaim: () => app.createNote(teamId) })
          return
        } catch (_e) {
          // Claim dialog unavailable — fall through and create anyway (locked).
        }
      }
      await app.createNote(teamId)
    },

    /**
     * Create a note (no identity gating here — newNote handles the prompt). Guards
     * the throwing seam, then opens the returned note.
     */
    async createNote(teamId = activeTeamId, opts = {}) {
      if (!teamExists(teamId) || !teamManager || typeof teamManager.createNote !== 'function') return
      const title = opts.title || 'Untitled'
      let noteId = null
      try {
        noteId = await teamManager.createNote(teamId, { title })
      } catch (e) {
        console.warn('[Mobile] createNote failed', e)
        return
      }
      if (noteId) app.openNote(teamId, noteId, title)
    },

    /** Switch the active team: close the slide-over and reset Home to its tree. */
    setActiveTeam(teamId) {
      if (!teamExists(teamId)) return
      activeTeamId = teamId
      app.closeSlideOver()
      nav.reset(makeHome())
    },

    // Slide-over open/close (delegates to the instance; Back consults isOpen()).
    openSlideOver() { if (slideOver) slideOver.open() },
    closeSlideOver() { if (slideOver) slideOver.close() },
    isSlideOverOpen() { return !!(slideOver && slideOver.isOpen()) },

    // Bottom-bar tab navigation (the frozen goHome/goSearch seam).
    goHome() {
      nav.reset(makeHome())
      if (bottomBar) bottomBar.setActive('home')
    },
    goSearch() {
      // No-op if Search is already the top screen (avoid stacking duplicates).
      const top = nav.top()
      if (!top || !top.__isSearch) nav.push(createSearchScreen({ app }))
      if (bottomBar) bottomBar.setActive('search')
    },

    // Bottom-bar editing visibility (frozen seam consumed by screen-note.js).
    hideBottomBar,
    showBottomBar,
  }

  // ── Build the slide-over now that `app` exists ──────────────────────────────
  slideOver = createSlideOver({ app })
  if (slideOver && slideOver.root) root.appendChild(slideOver.root)

  // ── Build the bottom bar ────────────────────────────────────────────────────
  bottomBar = BottomBar({
    tabs: [
      { id: 'home', icon: 'home', label: 'Home' },
      { id: 'search', icon: 'search', label: 'Search' },
    ],
    fab: { icon: 'plus', onTap: () => app.newNote() },
    onTab: (id) => {
      if (id === 'home') app.goHome()
      else if (id === 'search') app.goSearch()
    },
  })
  if (bottomBar && bottomBar.root) root.appendChild(bottomBar.root)

  // ── Mount the initial Home screen ───────────────────────────────────────────
  nav.push(makeHome())
  if (bottomBar) bottomBar.setActive('home')

  // ════════════════════════════════════════════════════════════════════════════
  //  Back interception (priority order from navModel):
  //    1. slide-over open  -> close it, swallow.
  //    2. nav.depth() > 1  -> nav.pop().
  //    3. at Home root     -> allow default (PWA may background/exit).
  //
  //  nav.js drives browser/hardware Back via history.pushState/popstate and pops
  //  WITHOUT a double-pop. The slide-over rule is layered on top: we intercept
  //  popstate FIRST; if the slide-over is open we re-seed a history state and
  //  close it instead of letting nav pop a screen.
  // ════════════════════════════════════════════════════════════════════════════
  const onPopState = (e) => {
    if (app.isSlideOverOpen()) {
      // Swallow this Back: close the slide-over and restore the depth so the next
      // Back still pops a screen (re-push the state popstate just consumed).
      app.closeSlideOver()
      try { history.pushState(e && e.state ? e.state : { navDepth: nav.depth() }, '') } catch (_err) { /* ignore */ }
    }
    // Otherwise nav.js's own popstate listener handles the screen pop.
  }
  window.addEventListener('popstate', onPopState)

  // ════════════════════════════════════════════════════════════════════════════
  //  Team lifecycle: re-derive activeTeamId + refresh the live screens.
  //  (Risk #2: lists must be event-driven — getTeams() can be empty at mount.)
  // ════════════════════════════════════════════════════════════════════════════
  const onListUpdated = () => {
    // Re-derive the active team if we have none yet, or the current one vanished.
    if (!activeTeamId || !teamExists(activeTeamId)) {
      const next = firstTeamId()
      if (next && next !== activeTeamId) {
        activeTeamId = next
        // Re-render Home for the newly-resolved team (only when Home is at root,
        // so we never blow away a NoteScreen/Search the user is on).
        if (nav.depth() === 1) nav.reset(makeHome())
      } else {
        activeTeamId = next
      }
    }
    if (slideOver && typeof slideOver.render === 'function' && app.isSlideOverOpen()) {
      slideOver.render()
    }
  }
  const onIdentityReady = () => {
    if (slideOver && typeof slideOver.render === 'function' && app.isSlideOverOpen()) {
      slideOver.render()
    }
  }
  window.addEventListener('team:list-updated', onListUpdated)
  window.addEventListener('team:identity-ready', onIdentityReady)
  // Tree updates are consumed by the Home/Search screens themselves (they
  // subscribe in onEnter and unsubscribe in onDestroy), so the shell does not
  // re-render the whole stack on every 'team:tree-updated'.

  // Run one derivation pass now in case teams already exist (init() may have
  // populated _teams synchronously before mount, or a deep-link pre-seeded one).
  onListUpdated()

  // ── Expose + guard ──────────────────────────────────────────────────────────
  if (typeof window !== 'undefined') {
    window.__mobileShellMounted = true
    window.__mobileApp = app
  }

  return app
}

export default mountMobileApp
