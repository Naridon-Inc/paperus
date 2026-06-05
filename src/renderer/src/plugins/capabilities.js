/**
 * Plugin capability model — FROZEN CONTRACT v1 (§3, §8).
 *
 * Deny-by-default. A plugin's manifest `capabilities[]` only make a call
 * *eligible*; the host RE-CHECKS the capability at every privileged seam via
 * `requireCapability` / `assertCapability`. fs:* and net:* are re-checked AGAIN
 * in the main process (`plugin-manager.js`) — defense in depth.
 *
 * This module is PURE: no side effects, no DOM, no IPC. It is imported by the
 * host (`plugin-host.js`) and every adapter (`contrib-*.js`).
 */

/**
 * The frozen capability enum. `net:<host>` is dynamic and parsed by
 * `parseNetCapability`; it is intentionally NOT a member here.
 */
export const CAPABILITIES = Object.freeze({
  COMMANDS: 'commands',
  EDITOR: 'editor',
  UI: 'ui',
  SECTIONS: 'sections',
  VIEWS: 'views',
  AI: 'ai',
  AUTH: 'auth',
  TEAMS: 'teams',
  STORAGE: 'storage',
  FS_READ: 'fs:read',
  FS_WRITE: 'fs:write',
  // 'net:<host>' is dynamic, parsed by parseNetCapability
  CLIPBOARD: 'clipboard',
  // ADDITIVE v1 (Phase 4): lets a plugin contribute tools the Company Brain's
  // agent loop can call. Low-risk on its own — egress still needs a separate,
  // sensitive `net:<host>` grant (see isSensitiveCapability, unchanged).
  TOOLS: 'tools'
})

/** The set of fixed (non-net) capability strings, for fast membership tests. */
const FIXED_CAP_SET = Object.freeze(new Set(Object.values(CAPABILITIES)))

/**
 * Error code constants mirrored from the RPC contract (Appendix A). A capability
 * failure surfaces as `CAPABILITY_DENIED`.
 */
export const CAP_ERROR_CODE = 'CAPABILITY_DENIED'

/**
 * A typed error a capability gate throws/returns. Adapters catch this and turn
 * it into an `{ type:'error', error:{ code:'CAPABILITY_DENIED', ... } }` RPC
 * reply — it never escapes to the host app.
 */
export class CapabilityError extends Error {
  constructor(capability, pluginId, detail) {
    super(
      `[plugins] capability denied: '${capability}' not granted to '${pluginId || 'unknown'}'`
        + (detail ? ` (${detail})` : '')
    )
    this.name = 'CapabilityError'
    this.code = CAP_ERROR_CODE
    this.capability = capability
    this.pluginId = pluginId || null
    this.detail = detail || null
  }
}

/**
 * Parse a `net:<host>` capability string.
 *  - `net:api.acme.example`   → { host: 'api.acme.example', wildcard: false }
 *  - `net:*.acme.example`     → { host: 'acme.example',     wildcard: true  }
 *  - `net:*`                  → null (rejected: too broad)
 *  - anything else            → null
 *
 * The host (and main) match a request URL's host against the declared set:
 * exact equality when `wildcard:false`; suffix-match (`host` or `*.host`) when
 * `wildcard:true`.
 *
 * @param {string} str
 * @returns {{ host: string, wildcard: boolean } | null}
 */
export function parseNetCapability(str) {
  if (typeof str !== 'string') return null
  if (!str.startsWith('net:')) return null
  const rest = str.slice(4).trim().toLowerCase()
  if (!rest) return null
  // Bare net:* is explicitly rejected (deny-by-default, §3).
  if (rest === '*' || rest === '*.') return null
  if (rest.startsWith('*.')) {
    const host = rest.slice(2)
    if (!host || host.includes('*') || host.includes('/')) return null
    if (!isPlausibleHost(host)) return null
    return { host, wildcard: true }
  }
  // No other wildcard forms are allowed.
  if (rest.includes('*') || rest.includes('/')) return null
  if (!isPlausibleHost(rest)) return null
  return { host: rest, wildcard: false }
}

/** Minimal host-shape sanity check (not a full RFC validation). */
function isPlausibleHost(host) {
  if (!host || host.length > 253) return false
  // localhost or dotted name or IPv4-ish; reject spaces / protocol prefixes.
  if (/\s/.test(host)) return false
  if (host.includes('://') || host.includes('@')) return false
  return /^[a-z0-9.-]+$/.test(host) && !host.startsWith('.') && !host.endsWith('.')
}

/**
 * Does this URL's host match the plugin's declared `net:<host>` capability set?
 * Used by the renderer pre-check (main re-checks independently).
 *
 * @param {string[]} capabilities  the plugin's declared capability strings
 * @param {string} urlHost         lowercased hostname of the target URL
 * @returns {boolean}
 */
export function netHostAllowed(capabilities, urlHost) {
  if (!Array.isArray(capabilities) || typeof urlHost !== 'string') return false
  const host = urlHost.trim().toLowerCase()
  if (!host) return false
  for (const cap of capabilities) {
    const parsed = parseNetCapability(cap)
    if (!parsed) continue
    if (!parsed.wildcard) {
      if (host === parsed.host) return true
    } else if (host === parsed.host || host.endsWith(`.${parsed.host}`)) {
      return true
    }
  }
  return false
}

/**
 * Validate that a single capability string is well-formed (a known fixed cap, or
 * a parseable net cap). Unknown strings are rejected so a typo'd capability never
 * silently grants nothing-or-something.
 *
 * @param {string} cap
 * @returns {boolean}
 */
export function isValidCapability(cap) {
  if (typeof cap !== 'string' || !cap) return false
  if (FIXED_CAP_SET.has(cap)) return true
  if (cap.startsWith('net:')) return parseNetCapability(cap) !== null
  return false
}

/**
 * Normalize + validate a manifest's `capabilities[]`. Returns the cleaned list
 * (deduped, valid only) plus the list of rejected entries for surfacing in the
 * UI. Never throws.
 *
 * @param {unknown} raw
 * @returns {{ granted: string[], rejected: string[] }}
 */
export function normalizeCapabilities(raw) {
  const granted = []
  const rejected = []
  const seen = new Set()
  if (Array.isArray(raw)) {
    for (const c of raw) {
      if (typeof c !== 'string') { rejected.push(String(c)); continue }
      if (seen.has(c)) continue
      seen.add(c)
      if (isValidCapability(c)) granted.push(c)
      else rejected.push(c)
    }
  }
  return { granted, rejected }
}

/**
 * Does a manifest grant a capability? Accepts either a manifest object (reads
 * `.capabilities`) or a raw capabilities array, so adapters can pass whichever
 * they hold.
 *
 * @param {{ capabilities?: string[] } | string[]} manifestOrCaps
 * @param {string} cap
 * @returns {boolean}
 */
export function hasCapability(manifestOrCaps, cap) {
  const caps = Array.isArray(manifestOrCaps)
    ? manifestOrCaps
    : (manifestOrCaps && Array.isArray(manifestOrCaps.capabilities)
      ? manifestOrCaps.capabilities
      : null)
  if (!caps || typeof cap !== 'string') return false
  if (FIXED_CAP_SET.has(cap)) return caps.includes(cap)
  // For net:<host>, the caller passes the *requested* host as a net:cap string OR
  // we accept the literal declared string. Prefer netHostAllowed for URL checks.
  if (cap.startsWith('net:')) {
    const parsed = parseNetCapability(cap)
    if (parsed) return netHostAllowed(caps, parsed.host)
    return caps.includes(cap)
  }
  return caps.includes(cap)
}

/**
 * The grant-enforcement seam. Returns `true` if granted, else throws
 * `CapabilityError` (which adapters catch). Use `assertCapability` when you want
 * an exception; use `requireCapability` (alias) for the contract's spelling.
 *
 * @param {{ id?: string, capabilities?: string[] }} manifest
 * @param {string} cap
 * @param {string} [detail]  optional extra context for the error message
 * @returns {true}
 */
export function assertCapability(manifest, cap, detail) {
  const pluginId = manifest && manifest.id
  if (!hasCapability(manifest, cap)) {
    throw new CapabilityError(cap, pluginId, detail)
  }
  return true
}

/** Contract-spelled alias of {@link assertCapability}. */
export function requireCapability(manifest, cap, detail) {
  return assertCapability(manifest, cap, detail)
}

/**
 * Non-throwing variant: returns `{ ok, error? }`. Handy where an adapter wants to
 * short-circuit with an RPC error envelope rather than catch.
 *
 * @param {{ id?: string, capabilities?: string[] }} manifest
 * @param {string} cap
 * @returns {{ ok: true } | { ok: false, error: { code: string, message: string } }}
 */
export function checkCapability(manifest, cap) {
  try {
    assertCapability(manifest, cap)
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: { code: CAP_ERROR_CODE, message: e && e.message ? e.message : 'capability denied' }
    }
  }
}

/**
 * Maps an RPC method name (e.g. `host.editor.insert`) to the capability the host
 * must re-check before dispatching it. Used by the host's central dispatch as a
 * belt-and-suspenders gate in addition to the per-adapter checks. Methods absent
 * from this map require no capability (e.g. `host.events.*`).
 *
 * Net-egress (`host.net.fetch`) returns the sentinel `'net'`; the host then
 * resolves the *specific* `net:<host>` against the request URL via
 * `netHostAllowed`.
 */
export const METHOD_CAPABILITY = Object.freeze({
  // commands
  'host.commands.register': CAPABILITIES.COMMANDS,
  'host.commands.execute': CAPABILITIES.COMMANDS,
  'host.commands.list': CAPABILITIES.COMMANDS,
  // editor
  'host.editor.registerBlock': CAPABILITIES.EDITOR,
  'host.editor.registerDecoration': CAPABILITIES.EDITOR,
  'host.editor.onChange': CAPABILITIES.EDITOR,
  'host.editor.getActive': CAPABILITIES.EDITOR,
  'host.editor.insert': CAPABILITIES.EDITOR,
  // ai
  'host.ai.complete': CAPABILITIES.AI,
  'host.ai.embed': CAPABILITIES.AI,
  'host.ai.registerProvider': CAPABILITIES.AI,
  // brain (ADDITIVE v1, Phase 4): tool registration for the Company Brain.
  // Gated by the `tools` capability — the central dispatch re-checks this map,
  // so a plugin without `tools` is denied at the seam (defense in depth).
  'host.brain.registerTool': CAPABILITIES.TOOLS,
  'host.brain.listTools': CAPABILITIES.TOOLS,
  // auth
  'host.auth.registerLoginMethod': CAPABILITIES.AUTH,
  // teams
  'host.teams.onTeamOpen': CAPABILITIES.TEAMS,
  'host.teams.registerTeamAction': CAPABILITIES.TEAMS,
  'host.teams.list': CAPABILITIES.TEAMS,
  // storage
  'host.storage.get': CAPABILITIES.STORAGE,
  'host.storage.set': CAPABILITIES.STORAGE,
  'host.storage.delete': CAPABILITIES.STORAGE,
  'host.storage.keys': CAPABILITIES.STORAGE,
  // fs
  'host.fs.read': CAPABILITIES.FS_READ,
  'host.fs.list': CAPABILITIES.FS_READ,
  'host.fs.write': CAPABILITIES.FS_WRITE,
  // net (special: resolve specific host against URL)
  'host.net.fetch': 'net',
  // ui (sections/views/clipboard sub-checked by the adapter)
  'host.ui.panel': CAPABILITIES.UI,
  'host.ui.navItem': CAPABILITIES.UI,
  'host.ui.toolbarItem': CAPABILITIES.UI,
  'host.ui.statusItem': CAPABILITIES.UI,
  'host.ui.notify': CAPABILITIES.UI,
  'host.ui.modal': CAPABILITIES.UI,
  'host.ui.sidebarSection': CAPABILITIES.SECTIONS,
  'host.ui.view': CAPABILITIES.VIEWS,
  'host.ui.settingsSection': CAPABILITIES.VIEWS,
  'host.ui.clipboardWrite': CAPABILITIES.CLIPBOARD,
  'host.ui.clipboardRead': CAPABILITIES.CLIPBOARD
})

/**
 * Resolve the capability required for an RPC method. Returns `null` when the
 * method needs no capability (e.g. events) and `'net'` for the net-egress
 * sentinel (host then resolves the per-host grant). Unknown host.* methods
 * return `'__unknown__'` so dispatch can reject with UNSUPPORTED_METHOD.
 *
 * @param {string} method
 * @returns {string | null}
 */
export function capabilityForMethod(method) {
  if (typeof method !== 'string') return '__unknown__'
  if (Object.prototype.hasOwnProperty.call(METHOD_CAPABILITY, method)) {
    return METHOD_CAPABILITY[method]
  }
  // events + lifecycle need no capability
  if (method.startsWith('host.events.') || method.startsWith('host.notify.')) return null
  if (method === 'plugin.activate' || method === 'plugin.deactivate') return null
  return '__unknown__'
}

/**
 * Pretty, human-facing capability descriptions for the manager/lab "this plugin
 * requests X" confirmation UI. Net caps are described dynamically.
 *
 * @param {string} cap
 * @returns {string}
 */
export function describeCapability(cap) {
  switch (cap) {
    case CAPABILITIES.COMMANDS: return 'Register commands and keyboard shortcuts'
    case CAPABILITIES.EDITOR: return 'Read editor text, add blocks/decorations, insert text'
    case CAPABILITIES.UI: return 'Add panels, toolbar items, status items, and notifications'
    case CAPABILITIES.SECTIONS: return 'Add a section to the sidebar'
    case CAPABILITIES.VIEWS: return 'Add full-screen views and settings panes'
    case CAPABILITIES.AI: return 'Use the AI backend (tokens only — never your API key)'
    case CAPABILITIES.AUTH: return 'Add an alternate unlock method for your identity'
    case CAPABILITIES.TEAMS: return 'See team names and public roster fields (never keys)'
    case CAPABILITIES.STORAGE: return 'Store its own settings (namespaced to this plugin)'
    case CAPABILITIES.FS_READ: return 'Read files inside this workspace'
    case CAPABILITIES.FS_WRITE: return 'Write files inside this workspace'
    case CAPABILITIES.CLIPBOARD: return 'Read/write the clipboard (on a user action)'
    case CAPABILITIES.TOOLS: return 'Provide tools the Company Brain can call.'
    default: {
      const parsed = parseNetCapability(cap)
      if (parsed) {
        return parsed.wildcard
          ? `Make network requests to *.${parsed.host}`
          : `Make network requests to ${parsed.host}`
      }
      return cap
    }
  }
}

/**
 * Capabilities that warrant an explicit pre-enable confirmation (§9 guardrails):
 * anything that touches the network, the filesystem, or identity/auth.
 */
export function isSensitiveCapability(cap) {
  if (cap === CAPABILITIES.FS_READ || cap === CAPABILITIES.FS_WRITE) return true
  if (cap === CAPABILITIES.AUTH) return true
  if (typeof cap === 'string' && cap.startsWith('net:')) return true
  return false
}

/**
 * The grant/prompt-decision model. A small, serializable record describing what a
 * plugin asked for, what is sensitive, and the user's standing decision. The host
 * persists `{ pluginId, decision, decidedAt }` via `settings:set` so a confirmed
 * plugin isn't re-prompted every launch. Pure data + helpers; no persistence here.
 */
export const GrantDecision = Object.freeze({
  PENDING: 'pending', // requested, awaiting user confirmation (sensitive caps)
  GRANTED: 'granted', // user confirmed; sensitive caps usable
  DENIED: 'denied' //   user declined; plugin stays disabled
})

/**
 * Build the prompt-decision descriptor for a plugin from its (already-normalized)
 * manifest. The host uses `needsPrompt` to decide whether to show the
 * "this plugin requests X" gate before first enable.
 *
 * @param {{ id?: string, capabilities?: string[] }} manifest
 * @param {string} [priorDecision]  a persisted GrantDecision, if any
 * @returns {{
 *   pluginId: string|null,
 *   capabilities: string[],
 *   sensitive: string[],
 *   descriptions: Array<{ cap: string, label: string, sensitive: boolean }>,
 *   needsPrompt: boolean,
 *   decision: string
 * }}
 */
export function buildGrantDecision(manifest, priorDecision) {
  const caps = manifest && Array.isArray(manifest.capabilities) ? manifest.capabilities : []
  const sensitive = caps.filter(isSensitiveCapability)
  const descriptions = caps.map((c) => ({
    cap: c,
    label: describeCapability(c),
    sensitive: isSensitiveCapability(c)
  }))
  const decision = priorDecision && Object.values(GrantDecision).includes(priorDecision)
    ? priorDecision
    : GrantDecision.PENDING
  // Only prompt when there is at least one sensitive cap AND no prior GRANTED.
  const needsPrompt = sensitive.length > 0 && decision !== GrantDecision.GRANTED
  return {
    pluginId: (manifest && manifest.id) || null,
    capabilities: caps.slice(),
    sensitive,
    descriptions,
    needsPrompt,
    decision
  }
}
