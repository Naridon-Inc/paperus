/**
 * nav.js — the mobile companion's stack navigator.
 *
 * A "screen instance" is a plain object:
 *   { root: HTMLElement, onEnter?(), onLeave?(), onDestroy?(), title?: string }
 * (the older spelling `{ el, ... }` is also accepted — see _rootOf — so screens
 *  built against either brief integrate without churn).
 *
 * This file owns ONLY navigation: it renders screens into a host element, runs the
 * slide-in/out CSS transitions (classes provided by mobile-shell.css), and bridges
 * the browser/hardware Back gesture via history.pushState/popstate so popping the
 * stack — not leaving the PWA — is what Back does.
 *
 * It is engine-agnostic and screen-agnostic: NO CM6, NO managers, NO engine imports.
 * Screens are passed in as {root,...} objects by app-shell. The only DOM-creation
 * idiom mirrors team-dialogs.js / mobile-link-screen.js (vanilla, no framework).
 *
 * Exports (both names are real so parallel-built siblings resolve either):
 *   - createNav(containerEl)      — the name app-shell.js imports (BUILD CONTRACT)
 *   - createNavStack(rootEl)      — the name in this file's direct brief (alias)
 * Both return the same Nav API:
 *   push(screen) · pop() · replace(screen) · reset(screen) · top() · depth()
 *   · onBack(handler) · destroy()
 */

// ── CSS contract (mobile-shell.css) ──────────────────────────────────────────────
// .mob-screen          : position:absolute; inset:0; transform:translateX(0); transition
// .mob-screen--enter   : transform:translateX(100%)   (off-canvas to the right, pre-enter)
// .mob-screen--leave   : transform:translateX(100%)   (slide back off to the right)
// (prefers-reduced-motion disables the transform transition in CSS.)
const CLS_SCREEN = 'mob-screen'
const CLS_ENTER = 'mob-screen--enter'
const CLS_LEAVE = 'mob-screen--leave'

// Fallback so a missed transitionend (reduced-motion, display:none, interrupted
// gesture) never leaks a detached leaving node. Kept a touch above the .28s CSS
// transform so a real transitionend wins the race in the common case.
const TRANSITION_FALLBACK_MS = 360

// History marker so popstate can tell our own pushed states apart from page state.
const HISTORY_TAG = 'mobnav'

/** Accept either {root} (BUILD CONTRACT) or {el} (this file's direct brief). */
function _rootOf(screen) {
  if (!screen) return null
  return screen.root || screen.el || null
}

/** Safe call of an optional screen lifecycle hook. */
function _call(screen, hook) {
  if (!screen) return
  const fn = screen[hook]
  if (typeof fn === 'function') {
    try {
      fn.call(screen)
    } catch (e) {
      // A screen's lifecycle hook must never break navigation.
      // eslint-disable-next-line no-console
      console.error(`[MobileNav] screen.${hook}() threw`, e)
    }
  }
}

/**
 * Create a stack navigator that renders screens into `containerEl` (the
 * .mob-navhost viewport inside #mobile-root).
 *
 * @param {HTMLElement} containerEl
 * @returns {{
 *   push(screen): void,
 *   pop(): boolean,
 *   replace(screen): void,
 *   reset(screen): void,
 *   top(): object|null,
 *   depth(): number,
 *   onBack(handler): (() => void),
 *   destroy(): void,
 * }}
 */
export function createNav(containerEl) {
  if (!containerEl) throw new Error('createNav: containerEl is required')

  /** @type {Array<object>} screen instances, [0] = root (bottom), [n-1] = top. */
  const stack = []

  /** Back interceptors (app-shell registers the slide-over-first rule here). */
  const backHandlers = new Set()

  // Set true while we are popping in response to a popstate event so we DON'T
  // call history.back() again (which would pop a second time). The single most
  // important guard against the double-pop described in the nav contract.
  let poppingFromHistory = false

  let destroyed = false

  // ── history bridge ──────────────────────────────────────────────────────────
  // Seed a base state so the FIRST Back lands on our handler (and is intercepted)
  // rather than leaving the PWA.
  function seedBaseHistory() {
    try {
      history.replaceState({ [HISTORY_TAG]: true, navDepth: 0 }, '')
    } catch (_e) {
      /* history unavailable (rare) — Back simply falls back to the header button. */
    }
  }

  function pushHistory(navDepth) {
    try {
      history.pushState({ [HISTORY_TAG]: true, navDepth }, '')
    } catch (_e) {
      /* ignore — see seedBaseHistory */
    }
  }

  // ── transition helpers ──────────────────────────────────────────────────────
  function mountForEnter(rootEl) {
    rootEl.classList.add(CLS_SCREEN, CLS_ENTER)
    containerEl.appendChild(rootEl)
    // Force a reflow so the browser registers the --enter (off-canvas) start state
    // before we remove it; otherwise the transition is skipped.
    // eslint-disable-next-line no-unused-expressions
    rootEl.offsetWidth
    // Next frame: drop --enter so it slides in to translateX(0).
    requestAnimationFrame(() => {
      rootEl.classList.remove(CLS_ENTER)
    })
  }

  function mountInstant(rootEl) {
    rootEl.classList.add(CLS_SCREEN)
    rootEl.classList.remove(CLS_ENTER, CLS_LEAVE)
    containerEl.appendChild(rootEl)
  }

  function animateLeaveAndRemove(rootEl) {
    if (!rootEl) return
    let removed = false
    const finish = () => {
      if (removed) return
      removed = true
      rootEl.removeEventListener('transitionend', onEnd)
      if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl)
    }
    const onEnd = (ev) => {
      // Only react to the transform transition on the screen itself.
      if (ev.target === rootEl && (ev.propertyName === 'transform' || !ev.propertyName)) finish()
    }
    rootEl.addEventListener('transitionend', onEnd)
    // Trigger the slide-out.
    rootEl.classList.add(CLS_LEAVE)
    // Belt-and-suspenders: guaranteed cleanup if transitionend never fires.
    setTimeout(finish, TRANSITION_FALLBACK_MS)
  }

  // ── core stack ops ──────────────────────────────────────────────────────────
  function push(screen) {
    if (destroyed) return
    const rootEl = _rootOf(screen)
    if (!rootEl) {
      // eslint-disable-next-line no-console
      console.warn('[MobileNav] push() ignored: screen has no root/el')
      return
    }
    const prev = stack[stack.length - 1] || null
    if (prev) _call(prev, 'onLeave')

    stack.push(screen)
    mountForEnter(rootEl)
    _call(screen, 'onEnter')

    // Bridge Back: each push deepens history so the OS Back pops it.
    pushHistory(stack.length - 1)
  }

  /**
   * Internal pop shared by UI-pop and history-pop.
   * @param {boolean} fromHistory  true when triggered by a popstate event.
   * @returns {boolean} false if only the root screen remains (nothing popped).
   */
  function _pop(fromHistory) {
    if (destroyed) return false
    if (stack.length <= 1) return false // never pop the root

    const top = stack.pop()
    const revealed = stack[stack.length - 1] || null

    _call(top, 'onLeave')
    animateLeaveAndRemove(_rootOf(top))
    _call(top, 'onDestroy')

    if (revealed) _call(revealed, 'onEnter')

    // Only step history back when the pop came from UI (header back / app-shell).
    // When the pop was *caused by* a popstate the browser already moved back.
    if (!fromHistory) {
      poppingFromHistory = false
      try {
        history.back()
      } catch (_e) {
        /* ignore */
      }
    }
    return true
  }

  /** UI-initiated pop (header back IconButton, app-shell back signal). */
  function pop() {
    return _pop(false)
  }

  /** History-initiated pop (popstate) — pops WITHOUT calling history.back(). */
  function _popFromHistory() {
    return _pop(true)
  }

  function replace(screen) {
    if (destroyed) return
    const rootEl = _rootOf(screen)
    if (!rootEl) {
      // eslint-disable-next-line no-console
      console.warn('[MobileNav] replace() ignored: screen has no root/el')
      return
    }
    const old = stack.pop() || null
    if (old) {
      _call(old, 'onLeave')
      animateLeaveAndRemove(_rootOf(old))
      _call(old, 'onDestroy')
    }
    stack.push(screen)
    // No history depth change on replace (per contract): mount instantly.
    mountInstant(rootEl)
    _call(screen, 'onEnter')
  }

  function reset(screen) {
    if (destroyed) return
    const rootEl = _rootOf(screen)
    if (!rootEl) {
      // eslint-disable-next-line no-console
      console.warn('[MobileNav] reset() ignored: screen has no root/el')
      return
    }
    // Tear down EVERYTHING currently in the stack.
    while (stack.length) {
      const s = stack.pop()
      _call(s, 'onLeave')
      const sRoot = _rootOf(s)
      if (sRoot && sRoot.parentNode) sRoot.parentNode.removeChild(sRoot)
      _call(s, 'onDestroy')
    }
    // Mount the single new root.
    stack.push(screen)
    mountInstant(rootEl)
    _call(screen, 'onEnter')

    // Collapse history back to the base state so the next Back exits cleanly.
    seedBaseHistory()
  }

  function top() {
    return stack[stack.length - 1] || null
  }

  function depth() {
    return stack.length
  }

  /**
   * Register a Back interceptor. Handlers run (in registration order) BEFORE the
   * stack is popped; if any returns true the Back is considered "handled" and the
   * pop is swallowed (this is how app-shell makes the open slide-over absorb the
   * first Back). Returns an unsubscribe fn.
   *
   * @param {() => boolean} handler  return true to swallow the Back.
   * @returns {() => void}
   */
  function onBack(handler) {
    if (typeof handler === 'function') backHandlers.add(handler)
    return () => backHandlers.delete(handler)
  }

  /** Run interceptors; true means "swallowed, do not pop". */
  function _backIntercepted() {
    for (const h of backHandlers) {
      try {
        if (h() === true) return true
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[MobileNav] back handler threw', e)
      }
    }
    return false
  }

  // ── popstate (browser / hardware Back gesture) ──────────────────────────────
  function onPopState() {
    if (destroyed) return

    // 1. Interceptors first (slide-over / transient menus). If one swallows the
    //    Back, re-deepen history so the NEXT Back has a state to consume — without
    //    this the following Back would exit the PWA.
    if (_backIntercepted()) {
      pushHistory(stack.length - 1)
      return
    }

    // 2. Otherwise pop the screen stack WITHOUT calling history.back() (the
    //    browser already moved the history pointer for us).
    if (stack.length > 1) {
      poppingFromHistory = true
      _popFromHistory()
      poppingFromHistory = false
    } else {
      // At the root: nothing to pop. We've consumed the base state, so push it
      // back to keep absorbing Back (the app-shell decides if Back should exit).
      pushHistory(0)
    }
  }

  function destroy() {
    if (destroyed) return
    destroyed = true
    window.removeEventListener('popstate', onPopState)
    while (stack.length) {
      const s = stack.pop()
      _call(s, 'onLeave')
      const sRoot = _rootOf(s)
      if (sRoot && sRoot.parentNode) sRoot.parentNode.removeChild(sRoot)
      _call(s, 'onDestroy')
    }
    backHandlers.clear()
  }

  // ── wire up ─────────────────────────────────────────────────────────────────
  seedBaseHistory()
  window.addEventListener('popstate', onPopState)

  return {
    push,
    pop,
    replace,
    reset,
    top,
    depth,
    onBack,
    destroy,
    // exposed so app-shell can reason about the guard if ever needed (read-only-ish)
    get _poppingFromHistory() {
      return poppingFromHistory
    },
  }
}

/**
 * Alias matching this file's direct brief: createNavStack(rootEl).
 * Identical behavior + API to createNav (other siblings import `createNav`).
 */
export const createNavStack = createNav

export default createNav
