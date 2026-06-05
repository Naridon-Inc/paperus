// studio-client.js — the thin, defensive renderer wrapper over the `studio:*` IPC
// surface and the streamed `studio:event` messages. This is the SINGLE place in
// the renderer Studio view that talks to main.
//
// Frozen Plugin Studio Contract v1 (§3, §5.2, §7):
//   • Every method returns `{ ok:false, error:'unsupported' }` when `window.api.invoke`
//     is absent (web build) OR when the channel resolves to a non-`{ok}` value
//     (unregistered channel on web returns `null`). This is the canonical
//     "no desktop" signal builders must treat as such.
//   • Streamed events ride the existing `message` channel as
//     `window.api.onMessage((tag, payload) => …)`; `tag === 'studio:event'` carries
//     `{ sessionId:number, ev:AgentEvent }`. We multiplex a single `onMessage`
//     subscription out to per-session listeners registered via `subscribe()`.
//   • NEVER imports node/electron/fs/path — web-safe (§7).

/** The canonical "Studio is unavailable here (web / not registered)" envelope. */
export const UNSUPPORTED = Object.freeze({ ok: false, error: 'unsupported' })

/* ------------------------------------------------------------------------- *
 * Defensive IPC. Never throws; always resolves to a `{ ok, … }` shape.
 * A `null`/non-object reply (unregistered channel on web) → UNSUPPORTED.
 * ------------------------------------------------------------------------- */

function hasInvoke() {
  return !!(typeof window !== 'undefined'
    && window.api
    && typeof window.api.invoke === 'function')
}

async function studioInvoke(action, payload) {
  if (!hasInvoke()) return { ...UNSUPPORTED }
  try {
    const res = await window.api.invoke(action, payload || {})
    // Unregistered `studio:*` channel on the web mock resolves to `null`.
    if (res == null || typeof res !== 'object') return { ...UNSUPPORTED }
    // A real handler always returns `{ ok, … }`. If `ok` is missing, treat the
    // call as having succeeded only when it clearly carries data; otherwise
    // surface the raw object (handlers are contractually `{ ok, …, error? }`).
    if (!('ok' in res)) return { ok: true, ...res }
    return res
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) }
  }
}

/* ------------------------------------------------------------------------- *
 * The client factory. A module-level singleton (`studioClient`) is the default,
 * but `createStudioClient()` is exported for tests / isolated mounts.
 * ------------------------------------------------------------------------- */

export function createStudioClient() {
  // sessionId → Set<cb>. A single `onMessage` subscription fans out to these.
  const sessionListeners = new Map()
  // Listeners that want EVERY studio event regardless of session.
  const anyListeners = new Set()
  let wired = false
  let supportProbe = null // cached availability probe (null until first checked)

  function ensureWired() {
    if (wired) return
    wired = true
    try {
      if (typeof window !== 'undefined'
        && window.api
        && typeof window.api.onMessage === 'function') {
        window.api.onMessage((tag, payload) => {
          if (tag !== 'studio:event' || !payload || typeof payload !== 'object') return
          const { sessionId, ev } = payload
          if (!ev || typeof ev !== 'object') return
          // Fan out to per-session listeners.
          const set = sessionListeners.get(sessionId)
          if (set) {
            for (const cb of Array.from(set)) {
              try { cb(ev) } catch (_) { /* a listener throw never breaks the wire */ }
            }
          }
          // Fan out to any-session listeners.
          for (const cb of Array.from(anyListeners)) {
            try { cb(sessionId, ev) } catch (_) { /* ignore */ }
          }
        })
      }
    } catch (_) { /* onMessage unavailable (web no-op) — subscribe() becomes inert */ }
  }

  /**
   * Subscribe to the streamed `AgentEvent`s for one session.
   * @param {number} sessionId
   * @param {(ev:object)=>void} cb
   * @returns {() => void} unsubscribe
   */
  function subscribe(sessionId, cb) {
    if (typeof cb !== 'function') return () => {}
    ensureWired()
    let set = sessionListeners.get(sessionId)
    if (!set) { set = new Set(); sessionListeners.set(sessionId, set) }
    set.add(cb)
    return () => {
      const s = sessionListeners.get(sessionId)
      if (s) { s.delete(cb); if (s.size === 0) sessionListeners.delete(sessionId) }
    }
  }

  /**
   * Subscribe to EVERY studio event (any session). `cb(sessionId, ev)`.
   * @param {(sessionId:number, ev:object)=>void} cb
   * @returns {() => void} unsubscribe
   */
  function subscribeAll(cb) {
    if (typeof cb !== 'function') return () => {}
    ensureWired()
    anyListeners.add(cb)
    return () => { anyListeners.delete(cb) }
  }

  /**
   * Is the desktop Studio surface present at all? Probes `studio:agent-detect`
   * once and caches the boolean (an `unsupported` reply means "web / no main").
   * @returns {Promise<boolean>}
   */
  async function isSupported() {
    if (supportProbe != null) return supportProbe
    if (!hasInvoke()) { supportProbe = false; return false }
    const res = await studioInvoke('studio:agent-detect', {})
    supportProbe = !!(res && res.ok)
    return supportProbe
  }

  return {
    UNSUPPORTED,
    isSupported,
    subscribe,
    subscribeAll,

    // ── Workspace lifecycle (§3.1) ──────────────────────────────────────────
    createWorkspace: (opts) => studioInvoke('studio:create-workspace', opts || {}),
    listBuilds: () => studioInvoke('studio:list-builds', {}),
    readBuild: (buildId) => studioInvoke('studio:read-build', { buildId }),
    deleteBuild: (buildId) => studioInvoke('studio:delete-build', { buildId }),
    openExternal: (buildId) => studioInvoke('studio:open-external', { buildId }),

    // ── Confined filesystem (§3.2) — studio root only ───────────────────────
    fsRead: (buildId, path) => studioInvoke('studio:fs-read', { buildId, path }),
    fsWrite: (buildId, path, data) => studioInvoke('studio:fs-write', { buildId, path, data }),
    fsList: (buildId, dir) => studioInvoke('studio:fs-list', { buildId, dir }),

    // ── Build check, export, install (§3.3) ─────────────────────────────────
    buildCheck: (buildId) => studioInvoke('studio:build-check', { buildId }),
    exportBuild: (buildId) => studioInvoke('studio:export', { buildId }),
    installBuild: (buildId) => studioInvoke('studio:install-build', { buildId }),

    // ── Agent driver (§3.4) ─────────────────────────────────────────────────
    agentDetect: () => studioInvoke('studio:agent-detect', {}),
    agentStart: (opts) => studioInvoke('studio:agent-start', opts || {}),
    agentSend: (sessionId, message) => studioInvoke('studio:agent-send', { sessionId, message }),
    agentCancel: (sessionId) => studioInvoke('studio:agent-cancel', { sessionId }),

    // Escape hatch for the api-loop provider (it forwards arbitrary studio:* calls).
    invoke: studioInvoke,
  }
}

/** The shared renderer-wide Studio client. */
export const studioClient = createStudioClient()

export default studioClient
