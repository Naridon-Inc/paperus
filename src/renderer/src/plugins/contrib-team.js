/**
 * contrib-team.js — Team adapter (FROZEN CONTRACT v1, §5.5 / §8.3).
 *
 * Bridges `ctx.teams.onTeamOpen` / `registerTeamAction` to the `team:*` window
 * CustomEvent bus and the team UI. The plugin receives ONLY sanitized snapshots:
 *   { teamId, teamName, members:[{ username, displayName, publicKey }] }
 * NEVER the teamRootKey, swarm/E2EE keys, the root Y.Doc, or Awareness.
 *
 * `registerTeamAction` adds a button (via the host hooks) that, on click,
 * dispatches a `cmd:*` event host-side and routes to the plugin's `run` token.
 * The plugin cannot call p2pTeamManager directly.
 *
 * Subscribes to: team:list-updated, team:tree-updated, team:roster-updated,
 * team:identity-ready (§5.5). All handler calls are wrapped in try/catch so a
 * throwing plugin handler never breaks the host event bus.
 */

import * as Caps from './capabilities.js'

const C = Caps.CAPABILITIES || {}
const CAP_TEAMS = C.TEAMS || 'teams'

function hasCap(manifest, cap) {
  try {
    if (typeof Caps.requireCapability === 'function') {
      try { Caps.requireCapability(manifest, cap); return true } catch { return false }
    }
    const list = (manifest && Array.isArray(manifest.capabilities)) ? manifest.capabilities : []
    return list.includes(cap)
  } catch { return false }
}

/**
 * Sanitize a roster member to the public, key-free shape the contract allows.
 * The roster member carries `idPublicKey` (the public signing key) — it IS a
 * public field and is exposed as `publicKey`. NO private key, NO derived keys.
 */
function sanitizeMember(m) {
  if (!m || typeof m !== 'object') return null
  return {
    username: typeof m.username === 'string' ? m.username : '',
    displayName: typeof m.displayName === 'string' ? m.displayName : undefined,
    // public signing key only; never the team root/swarm/E2EE key.
    publicKey: typeof m.idPublicKey === 'string' ? m.idPublicKey
      : (typeof m.publicKey === 'string' ? m.publicKey : ''),
  }
}

function sanitizeMembers(arr) {
  if (!Array.isArray(arr)) return []
  return arr.map(sanitizeMember).filter(Boolean)
}

/**
 * Initialize the team adapter.
 * @param {object} hostHooks the §6 host hooks bag (expects hostHooks.teams.*).
 * @returns {object} adapter API
 */
export function initTeamAdapter(hostHooks = {}) {
  const teams = hostHooks.teams || {}

  // Per-adapter-instance registrations.
  const openHandlers = new Set() // Set<fn(snapshot)>
  const updatedHandlers = new Set() // Set<fn(snapshot)>  (team:updated)
  const actions = new Map() // actionId → { manifest, dispose }
  const busDisposers = []

  // ── Wire the team:* CustomEvent bus exactly once per adapter instance ──
  const onListUpdated = (e) => {
    const detail = (e && e.detail) || {}
    // detail.teams = [{ teamId, name, rootKey }] — strip rootKey.
    const list = Array.isArray(detail.teams) ? detail.teams : []
    for (const t of list) {
      fanOpen({ teamId: t.teamId, teamName: t.name || t.teamName || '', members: membersFor(t.teamId) })
    }
    fanUpdated({ teamId: null, members: [] })
  }
  const onRosterUpdated = (e) => {
    const detail = (e && e.detail) || {}
    const teamId = detail.teamId
    const members = sanitizeMembers(detail.members)
    fanOpen({ teamId, teamName: nameFor(teamId), members })
    fanUpdated({ teamId, members })
  }
  const onTreeUpdated = (e) => {
    const detail = (e && e.detail) || {}
    fanUpdated({ teamId: detail.teamId, members: membersFor(detail.teamId) })
  }
  const onIdentityReady = (e) => {
    const detail = (e && e.detail) || {}
    const teamId = detail.teamId
    fanOpen({ teamId, teamName: nameFor(teamId), members: membersFor(teamId) })
  }

  function subscribe() {
    if (typeof window === 'undefined') return
    window.addEventListener('team:list-updated', onListUpdated)
    window.addEventListener('team:roster-updated', onRosterUpdated)
    window.addEventListener('team:tree-updated', onTreeUpdated)
    window.addEventListener('team:identity-ready', onIdentityReady)
    busDisposers.push(() => {
      window.removeEventListener('team:list-updated', onListUpdated)
      window.removeEventListener('team:roster-updated', onRosterUpdated)
      window.removeEventListener('team:tree-updated', onTreeUpdated)
      window.removeEventListener('team:identity-ready', onIdentityReady)
    })
  }
  subscribe()

  // Resolve team name / members via the host hooks (never via raw manager).
  function nameFor(teamId) {
    try {
      if (typeof teams.list === 'function') {
        const found = (teams.list() || []).find(t => t.teamId === teamId)
        if (found) return found.teamName || found.name || ''
      }
    } catch { /* ignore */ }
    return ''
  }
  function membersFor(teamId) {
    try {
      if (typeof teams.members === 'function') return sanitizeMembers(teams.members(teamId))
    } catch { /* ignore */ }
    return []
  }

  function fanOpen(snapshot) {
    for (const fn of openHandlers) {
      try { fn(snapshot) } catch (e) { console.warn('[contrib-team] onTeamOpen handler failed:', e) }
    }
  }
  function fanUpdated(snapshot) {
    for (const fn of updatedHandlers) {
      try { fn(snapshot) } catch (e) { console.warn('[contrib-team] team:updated handler failed:', e) }
    }
  }

  return {
    /**
     * ctx.teams.onTeamOpen — capability `teams`. Fires on roster/list/identity
     * events with a sanitized snapshot. Returns a Disposable.
     */
    onTeamOpen(manifest, handler) {
      if (!hasCap(manifest, CAP_TEAMS)) return denied('onTeamOpen')
      if (typeof handler !== 'function') return noop()
      const fn = (snapshot) => handler(snapshot)
      openHandlers.add(fn)
      return { dispose() { openHandlers.delete(fn) } }
    },

    /**
     * Internal: 'team:updated' event subscription for ctx.events.on('team:updated').
     * Returns a Disposable. (No capability gate — sanitized events are public,
     * §Appendix B; but we still only emit sanitized member fields.)
     */
    onTeamUpdated(handler) {
      if (typeof handler !== 'function') return noop()
      const fn = (snapshot) => handler(snapshot)
      updatedHandlers.add(fn)
      return { dispose() { updatedHandlers.delete(fn) } }
    },

    /**
     * ctx.teams.registerTeamAction — capability `teams`. Adds a button in the
     * team UI (via host hooks). On click the host dispatches `cmd:<id>` and we
     * route to the plugin's `run(teamId)` token. The plugin never touches the
     * manager.
     */
    registerTeamAction(manifest, action, run) {
      if (!hasCap(manifest, CAP_TEAMS)) return denied('registerTeamAction')
      if (!action || typeof action.id !== 'string') return noop()
      const id = `${manifest.id}.${action.id}`.replace(/[^a-z0-9_.-]/gi, '-').slice(0, 120)
      const onClick = (teamId) => {
        try { if (typeof run === 'function') run(teamId) } catch (e) { console.warn('[contrib-team] team action run failed:', e) }
      }
      if (teams && typeof teams.addTeamAction === 'function') {
        try {
          teams.addTeamAction({
            id,
            label: String(action.label || '').slice(0, 60),
            icon: typeof action.icon === 'string' ? action.icon : undefined,
            onClick,
          })
        } catch (e) { console.warn('[contrib-team] host addTeamAction failed:', e) }
      } else {
        // eslint-disable-next-line no-console
        console.warn('[contrib-team] host did not provide teams.addTeamAction; action inert')
      }
      const disposer = () => {
        actions.delete(id)
        if (teams && typeof teams.removeTeamAction === 'function') {
          try { teams.removeTeamAction(id) } catch { /* ignore */ }
        }
      }
      actions.set(id, { manifest, dispose: disposer })
      return { dispose: disposer }
    },

    /**
     * ctx.teams.list — capability `teams`. Sanitized list of { teamId, teamName }.
     */
    list(manifest) {
      if (!hasCap(manifest, CAP_TEAMS)) return []
      try {
        if (typeof teams.list === 'function') {
          return (teams.list() || []).map(t => ({ teamId: t.teamId, teamName: t.teamName || t.name || '' }))
        }
      } catch { /* ignore */ }
      return []
    },

    /** Dispose all registrations + the bus subscription for this instance. */
    disposeAll() {
      openHandlers.clear()
      updatedHandlers.clear()
      for (const { dispose } of actions.values()) { try { dispose() } catch { /* ignore */ } }
      actions.clear()
      for (const d of busDisposers) { try { d() } catch { /* ignore */ } }
      busDisposers.length = 0
    },
  }
}

function denied(method) {
  // eslint-disable-next-line no-console
  console.warn(`[contrib-team] CAPABILITY_DENIED for ${method}`)
  return noop()
}
function noop() { return { dispose() {} } }
