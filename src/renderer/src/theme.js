// theme.js — single source of truth for app theming (light / dark / system).
//
// Responsibilities:
//   • Persist the user's *preference* ('light' | 'dark' | 'system') in
//     localStorage under `paperus_theme`.
//   • Resolve 'system' against the OS via matchMedia, and live-update when the
//     OS appearance flips while the app is open.
//   • Reflect the *resolved* theme ('light' | 'dark') onto <html> in two ways so
//     both styling worlds react:
//       1. `document.documentElement.dataset.theme = 'light' | 'dark'`  → the
//          vanilla CSS (theme-dark.css scopes its overrides under
//          `:root[data-theme="dark"]`).
//       2. a `dark` class on <html> → a familiar hook (Tailwind `darkMode:
//          'class'` style) for anything that prefers a class.
//   • Broadcast a `theme:changed` CustomEvent on `window` carrying
//     `{ theme, preference }` so islands (React) and the CodeMirror editor can
//     swap their own palettes.
//
// applyStoredTheme() is called once, synchronously, at the very top of main.js
// (before first paint) to avoid a light flash on launch.

const STORAGE_KEY = 'paperus_theme'
const VALID = ['light', 'dark', 'system']

let mql = null            // the matchMedia('(prefers-color-scheme: dark)') handle
let mqlListener = null     // bound OS-change handler (so we can detach/re-attach)
let current = 'system'     // last-applied *preference*

function getMql() {
  if (mql) return mql
  try {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
  } catch (_e) {
    mql = null
  }
  return mql
}

/** True when the OS currently prefers a dark appearance. */
export function systemPrefersDark() {
  const m = getMql()
  return !!(m && m.matches)
}

/** Read the persisted preference. Defaults to 'system'. */
export function getStoredPreference() {
  let v
  try { v = localStorage.getItem(STORAGE_KEY) } catch (_e) { v = null }
  return VALID.includes(v) ? v : 'system'
}

/** The preference currently in effect this session. */
export function getThemePreference() {
  return current
}

/** Resolve a preference to a concrete theme. */
export function resolveTheme(pref = current) {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  return systemPrefersDark() ? 'dark' : 'light'
}

/** The concrete theme ('light' | 'dark') in effect right now. */
export function getResolvedTheme() {
  const ds = document.documentElement.dataset.theme
  if (ds === 'dark' || ds === 'light') return ds
  return resolveTheme()
}

// Reflect a resolved theme onto <html> and broadcast it. Idempotent.
function reflect(resolved, preference) {
  const root = document.documentElement
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved
  root.classList.toggle('dark', resolved === 'dark')
  // Hint native form controls / scrollbars to match.
  try { root.style.colorScheme = resolved } catch (_e) { /* noop */ }
  try {
    window.dispatchEvent(new CustomEvent('theme:changed', {
      detail: { theme: resolved, preference },
    }))
  } catch (_e) { /* CustomEvent unsupported — ignore */ }
}

// Keep 'system' live: attach an OS-appearance listener only while the
// preference is 'system'; detach for explicit light/dark so we don't thrash.
function syncSystemListener() {
  const m = getMql()
  if (!m) return
  if (mqlListener) {
    if (m.removeEventListener) m.removeEventListener('change', mqlListener)
    else if (m.removeListener) m.removeListener(mqlListener)
    mqlListener = null
  }
  if (current !== 'system') return
  mqlListener = () => { reflect(resolveTheme('system'), 'system') }
  if (m.addEventListener) m.addEventListener('change', mqlListener)
  else if (m.addListener) m.addListener(mqlListener)
}

/**
 * Set (and persist) the theme preference. `'light' | 'dark' | 'system'`.
 * Returns the resolved concrete theme.
 */
export function setTheme(pref) {
  const next = VALID.includes(pref) ? pref : 'system'
  current = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch (_e) { /* private mode */ }
  const resolved = resolveTheme(next)
  reflect(resolved, next)
  syncSystemListener()
  return resolved
}

/**
 * Initialise theming from the persisted preference. Call ONCE, as early as
 * possible (top of main.js module body) so the correct palette is on <html>
 * before the first paint. Safe to call again — it just re-applies.
 */
export function applyStoredTheme() {
  // Light-only for now (product decision): always boot in light regardless of
  // any stored/system preference. Revert to `getStoredPreference()` to restore
  // full light/dark/system theming.
  current = 'light'
  reflect('light', 'light')
  syncSystemListener()
  return 'light'
}

/** Convenience: subscribe to resolved-theme changes. Returns an unsubscribe fn. */
export function onThemeChange(handler) {
  const wrapped = (e) => handler(e.detail && e.detail.theme, e.detail && e.detail.preference)
  window.addEventListener('theme:changed', wrapped)
  return () => window.removeEventListener('theme:changed', wrapped)
}
