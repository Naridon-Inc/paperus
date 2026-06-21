// host-bridge.js — the single contract object passed from the vanilla app into
// every React island. Built once in main.js (`buildHostBridge(deps)`) and handed
// to `mountReactSurface(container, key, host)`.
//
// Design rules:
//   - Defensive: every dep is optional so the bridge can be built early and the
//     surfaces degrade gracefully (null-safe) rather than throwing.
//   - One-directional: islands read from here; they never reach back into vanilla
//     modules. Cross-cutting actions go out as `cmd:*` CustomEvents that main.js
//     listens for, OR as direct dep callbacks when provided.
//   - The AI layer is the SAME Company Brain engine (rag-engine) that powers the
//     Brain drawer — no second AI stack, no new credentials.

/** Wrap the rag-engine into a small, stable AI surface for islands. */
function buildAi(getBrain) {
  const engine = () => {
    try { return getBrain ? getBrain() : null } catch (_e) { return null }
  }
  return {
    available() {
      const e = engine()
      return !!(e && typeof e.askBrain === 'function')
    },
    /**
     * Stream a brain completion. Returns a cancel() fn.
     * opts: { onToken, onDone, onError, history, onTool }
     */
    ask(prompt, opts = {}) {
      const e = engine()
      const { onToken, onDone, onError, history = [], onTool = null } = opts
      if (!e || typeof e.askBrain !== 'function') {
        if (onError) onError(new Error('AI brain unavailable. Open the Brain once to initialize it.'))
        return () => {}
      }
      let cancelled = false
      try {
        e.askBrain(
          prompt,
          (tok) => { if (!cancelled && onToken) onToken(tok) },
          (full, meta) => { if (!cancelled && onDone) onDone(full, meta) },
          history,
          onTool,
        )
      } catch (err) {
        if (onError) onError(err)
      }
      return () => { cancelled = true }
    },
    /** Register an email__* tool on the shared brain (no-op if engine absent). */
    registerTool(def) {
      const e = engine()
      if (e && typeof e.registerTool === 'function') {
        try { return e.registerTool(def) } catch (_e) { return null }
      }
      return null
    },
    /** Current model/effort metadata, best-effort. */
    info() {
      const e = engine()
      if (!e) return null
      return {
        activeModel: e.activeModel || (e.getActiveModel && e.getActiveModel()) || null,
        lastUsage: e.lastUsage || null,
      }
    },
  }
}

export function buildHostBridge(deps = {}) {
  const bus = deps.bus || window

  const dispatch = (event, detail) => {
    try { bus.dispatchEvent(new CustomEvent(event, { detail })) } catch (_e) { /* noop */ }
  }

  const host = {
    // raw singletons (read-only use)
    api: deps.api || (typeof window !== 'undefined' ? window.api : null),
    identity: deps.identity || null,
    tabManager: deps.tabManager || null,
    p2p: deps.p2p || null,

    // navigation — prefer direct callbacks, fall back to cmd:* events
    openFile: deps.openFile || ((path) => dispatch('cmd:open-local', { path })),
    openTeamNote: deps.openTeamNote || ((teamId, noteId) => dispatch('cmd:open-team-note', { teamId, noteId })),
    openDailyNote: (iso) => {
      const day = iso || (host.dates.todayISO ? host.dates.todayISO() : null)
      if (deps.daily && deps.daily.openDailyNote) return deps.daily.openDailyNote(day)
      return dispatch('cmd:open-daily', { iso: day })
    },

    // derived-data engines (filled by WS3/WS4)
    dates: deps.dates || {},   // { parseISODate, formatDateLabel, todayISO }
    daily: deps.daily || {},   // { openTodaysDailyNote, openDailyNote }
    scan: deps.scan || {},     // { getScan, requestScan, toggleTask }
    inbox: deps.inbox || {},   // { getItems, accept, dismiss, markAllRead, unreadCount }
    events: deps.events || {   // calendar event creation (writes a dated task line)
      create: () => Promise.reject(new Error('event creation unavailable')),
    },

    // email IPC passthrough (no preload change — uses the generic invoke channel)
    email: deps.email || {
      invoke: (channel, payload) => {
        // Dev/demo seam: a stub may answer email:* without a live IMAP account
        // (used to preview the inbox). Dead code unless the global is set.
        if (typeof window !== 'undefined' && typeof window.__EMAIL_DEMO__ === 'function') {
          const demo = window.__EMAIL_DEMO__(channel, payload)
          if (demo !== undefined) return Promise.resolve(demo)
        }
        const api = host.api
        if (api && typeof api.invoke === 'function') return api.invoke(channel, payload)
        return Promise.reject(new Error('email IPC unavailable'))
      },
    },

    // calendar (external CalDAV) IPC passthrough — built exactly like `email`
    // above: the generic invoke channel, with a parallel dev/demo seam.
    calendar: deps.calendar || {
      invoke: (channel, payload) => {
        // Dev/demo seam: a stub may answer calendar:* without a live CalDAV
        // account. Dead code unless the global is set.
        if (typeof window !== 'undefined' && typeof window.__CAL_DEMO__ === 'function') {
          const demo = window.__CAL_DEMO__(channel, payload)
          if (demo !== undefined) return Promise.resolve(demo)
        }
        const api = host.api
        if (api && typeof api.invoke === 'function') return api.invoke(channel, payload)
        return Promise.reject(new Error('calendar IPC unavailable'))
      },
    },

    // the shared Company Brain (rag-engine)
    ai: buildAi(deps.getBrain),
    getBrain: () => { try { return deps.getBrain ? deps.getBrain() : null } catch (_e) { return null } },

    // misc app affordances
    toast: deps.toast || ((message, kind) => dispatch('cmd:toast', { message, kind })),
    openExternal: deps.openExternal || ((url) => {
      const api = host.api
      if (api && typeof api.invoke === 'function') return api.invoke('shell:openExternal', url)
      window.open(url, '_blank', 'noopener')
      return null
    }),

    // app event bus — subscribe to CustomEvents (scan:updated, inbox:items-updated,
    // fs:file-changed, email:new, …). Returns an unsubscribe fn.
    on(event, cb) {
      const handler = (e) => cb(e && e.detail, e)
      bus.addEventListener(event, handler)
      return () => bus.removeEventListener(event, handler)
    },
    emit: dispatch,
  }

  return host
}
