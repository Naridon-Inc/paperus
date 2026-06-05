/**
 * plugin-host.js — THE HOST (FROZEN CONTRACT v1, §6).
 *
 * Pure orchestration. Owns:
 *   - the in-memory REGISTRY of contributed surfaces (commands, slash, blocks,
 *     editorExtensions, panels, sections, views, navItems, toolbarItems,
 *     statusItems, settings, aiProviders, loginMethods, formats, teamHooks),
 *   - manifest LOAD + VALIDATE (mirrors the main-process check, §2),
 *   - plugin LIFECYCLE (enable / disable / reload / quarantine, §10),
 *   - the `ctx` FACTORY (§5) handed to each plugin's `activate(ctx)`, which
 *     routes EVERY surface registration into the registry and RE-CHECKS the
 *     declared capability at the seam (deny-by-default, §3, §8.4),
 *   - the CAPABILITY GATE that re-checks every privileged plugin→host call.
 *
 * Holds NO secrets. The host never hands a plugin a private key, the team root
 * key (or any derived key), a raw `Y.Doc`/`Awareness`/`transportDoc`, or an API
 * key — only plaintext snapshots, opaque ids, and host-mediated results (§8.3).
 *
 * `main.js` calls `initPluginSystem(hostHooks)` exactly once, behind
 * `if (Features.plugins) { … }`, AFTER the DOM exists and `window.p2pTeamManager`
 * is set. The adapters (`contrib-*.js`) and the sandbox (`plugin-sandbox.js`) are
 * loaded lazily/defensively so a missing or throwing sibling never crashes the
 * host app — the subsystem degrades, the editor keeps running (§8.9).
 */

import {
  CAPABILITIES,
  CapabilityError,
  assertCapability,
  hasCapability,
  normalizeCapabilities,
  capabilityForMethod,
  netHostAllowed,
  buildGrantDecision,
  GrantDecision
} from './capabilities'

const API_VERSION = '1'
const PLUGIN_ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const SETTINGS_ENABLED_KEY = 'plugin_enabled'
const SETTINGS_DECISION_KEY = 'plugin_grant_decision'

/** The declarative `contributes` sub-keys we wire pre-activate (§2.2). */
const CONTRIB_KEYS = Object.freeze([
  'commands', 'slash', 'blocks', 'panels', 'sections', 'views', 'navItems',
  'toolbarItems', 'statusItems', 'settings', 'aiProviders', 'loginMethods',
  'formats', 'teamHooks',
  // ADDITIVE v1 (Phase 4): a declarative `tools` slot so a Brain tool shows in
  // the manager pre-activate. The real handler binds on activate via ctx.brain.
  'tools'
])

/** Lifecycle event names the host bridges to plugins (§5.8). */
const LIFECYCLE_EVENTS = Object.freeze([
  'note:open', 'note:save', 'note:change', 'team:updated', 'file:changed'
])

/** Per-plugin state machine. */
const PluginState = Object.freeze({
  DISCOVERED: 'discovered',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  QUARANTINED: 'quarantined',
  ERROR: 'error'
})

// ── Manifest validation ──────────────────────────────────────────────────────

/**
 * Validate a raw `plugin.json` against the §2 schema. Mirrors the main-process
 * check; both reject on failure. Returns `{ ok, manifest?, errors }`. Never throws.
 *
 * Unknown top-level keys are ignored (forward-compatible, §2). Capabilities are
 * normalized; an invalid capability string is an error (a typo must not silently
 * grant nothing-or-something).
 *
 * @param {unknown} raw
 * @returns {{ ok: boolean, manifest?: object, errors: string[] }}
 */
export function validateManifest(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['manifest is not an object'] }
  }
  const m = raw

  const str = (k, max) => {
    const v = m[k]
    if (typeof v !== 'string' || !v.trim()) { errors.push(`'${k}' is required (string)`); return null }
    if (max && v.length > max) errors.push(`'${k}' exceeds ${max} chars`)
    return v
  }

  const id = str('id')
  if (id && !PLUGIN_ID_RE.test(id)) {
    errors.push(`'id' must be reverse-DNS lowercase (^[a-z0-9]+(\\.[a-z0-9-]+)+$), got '${id}'`)
  }
  str('name', 60)
  const version = str('version')
  if (version && !SEMVER_RE.test(version)) errors.push(`'version' must be semver x.y.z, got '${version}'`)
  const apiVersion = str('apiVersion')
  if (apiVersion && apiVersion !== API_VERSION) {
    errors.push(`'apiVersion' must be '${API_VERSION}', got '${apiVersion}'`)
  }
  str('description', 200)
  str('author')
  str('license')

  // entry: relative ESM path, no traversal.
  const entry = typeof m.entry === 'string' && m.entry.trim() ? m.entry : 'index.js'
  if (entry.includes('..') || entry.startsWith('/') || entry.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(entry)) {
    errors.push(`'entry' must be a relative path without traversal, got '${entry}'`)
  }

  // capabilities: required array, members validated.
  if (!Array.isArray(m.capabilities)) {
    errors.push("'capabilities' is required (array)")
  } else {
    const { rejected } = normalizeCapabilities(m.capabilities)
    if (rejected.length) errors.push(`invalid capabilities: ${rejected.join(', ')}`)
  }

  // optional semver-ish fields
  if (m.minHostVersion != null && (typeof m.minHostVersion !== 'string' || !SEMVER_RE.test(m.minHostVersion))) {
    errors.push("'minHostVersion' must be semver if present")
  }
  if (m.icon != null && typeof m.icon !== 'string') errors.push("'icon' must be a string path if present")

  // contributes (optional object; unknown sub-keys ignored).
  if (m.contributes != null && (typeof m.contributes !== 'object' || Array.isArray(m.contributes))) {
    errors.push("'contributes' must be an object if present")
  }

  if (errors.length) return { ok: false, errors }

  // Build a normalized, frozen-ish manifest the host carries around.
  const { granted } = normalizeCapabilities(m.capabilities)
  const manifest = {
    id,
    name: m.name,
    version: m.version,
    apiVersion: API_VERSION,
    description: m.description,
    author: m.author,
    license: m.license,
    entry,
    capabilities: granted,
    contributes: sanitizeContributes(m.contributes),
    minHostVersion: typeof m.minHostVersion === 'string' ? m.minHostVersion : null,
    icon: typeof m.icon === 'string' ? m.icon : null
  }
  return { ok: true, manifest, errors: [] }
}

/** Keep only known `contributes` sub-keys; never throw on a malformed sub-key. */
function sanitizeContributes(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of CONTRIB_KEYS) {
    if (Array.isArray(raw[key])) out[key] = raw[key]
  }
  return out
}

// ── The in-memory registry ───────────────────────────────────────────────────

/**
 * Holds the host's view of every contributed surface, keyed by registry name.
 * Each entry remembers which plugin owns it (for disposal on disable/quarantine)
 * and the `Disposable` the host can call to unwire it from the live UI.
 */
class Registry {
  constructor() {
    /** @type {Map<string, Map<string, { pluginId: string, value: any, dispose: ()=>void }>>} */
    this.surfaces = new Map()
    for (const name of [
      'commands', 'slash', 'blocks', 'editorExtensions', 'panels', 'sections',
      'views', 'navItems', 'toolbarItems', 'statusItems', 'settings',
      'aiProviders', 'loginMethods', 'formats', 'teamHooks',
      // ADDITIVE v1 (Phase 4): tools a plugin contributes to the Company Brain.
      'brainTools'
    ]) {
      this.surfaces.set(name, new Map())
    }
  }

  /**
   * Add a contribution to a surface. `key` is the per-surface unique id (already
   * namespaced under the plugin id). Returns a `Disposable`.
   */
  add(surface, key, pluginId, value, dispose) {
    const map = this.surfaces.get(surface)
    if (!map) throw new Error(`[plugins] unknown surface '${surface}'`)
    // Last-writer-wins within a plugin; dispose a prior same-key entry first.
    const prior = map.get(key)
    if (prior && typeof prior.dispose === 'function') {
      try { prior.dispose() } catch (_e) { /* ignore */ }
    }
    const entry = { pluginId, value, dispose: typeof dispose === 'function' ? dispose : () => {} }
    map.set(key, entry)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        const cur = map.get(key)
        if (cur === entry) map.delete(key)
        try { entry.dispose() } catch (_e) { /* ignore */ }
      }
    }
  }

  /** All contributions for a surface (values only). */
  list(surface) {
    const map = this.surfaces.get(surface)
    return map ? Array.from(map.values(), (e) => e.value) : []
  }

  /** Remove and dispose every contribution owned by a plugin across all surfaces. */
  disposePlugin(pluginId) {
    for (const map of this.surfaces.values()) {
      for (const [key, entry] of Array.from(map.entries())) {
        if (entry.pluginId === pluginId) {
          map.delete(key)
          try { entry.dispose() } catch (_e) { /* ignore */ }
        }
      }
    }
  }
}

// ── PluginRecord ─────────────────────────────────────────────────────────────

/** One loaded/known plugin and its runtime handles. */
class PluginRecord {
  constructor(manifest, source, dir) {
    this.manifest = manifest
    this.id = manifest.id
    this.source = source || 'user' // 'user' | 'workspace'
    this.dir = dir || null
    this.state = PluginState.DISCOVERED
    this.error = null
    /** the sandbox instance (plugin-sandbox.js) */
    this.sandbox = null
    /** Disposables the host tracks per plugin to tear down on disable/quarantine. */
    this.disposables = new Set()
    /** callback tokens the plugin registered, dispatched back via plugin.callback. */
    this.callbacks = new Map()
    /** standing grant decision (capabilities prompt). */
    this.decision = GrantDecision.PENDING
  }

  track(disposable) {
    if (disposable && typeof disposable.dispose === 'function') this.disposables.add(disposable)
    return disposable
  }

  disposeAll() {
    for (const d of Array.from(this.disposables)) {
      try { d.dispose() } catch (_e) { /* ignore */ }
    }
    this.disposables.clear()
    this.callbacks.clear()
  }
}

// ── The host singleton ───────────────────────────────────────────────────────

/**
 * PluginHost — the orchestrator singleton. `initPluginSystem` initializes it and
 * returns the public controller. Importers may also `import { PluginHost }` to
 * reach the live instance (e.g. the lab / manager UI).
 */
class PluginHostClass {
  constructor() {
    this.hooks = null
    this.registry = new Registry()
    /** @type {Map<string, PluginRecord>} */
    this.plugins = new Map()
    this.initialized = false
    this.disposed = false
    /** lazily-imported adapter modules (contrib-*). */
    this._adapters = null
    /** lazily-imported sandbox constructor. */
    this._SandboxCtor = null
    /** enabled-state cache loaded from settings. */
    this._enabledMap = {}
    /** grant-decision cache loaded from settings. */
    this._decisionMap = {}
  }

  // ── init ───────────────────────────────────────────────────────────────────

  /**
   * One-time init. Idempotent: a second call returns the existing controller.
   * @param {object} hostHooks  the §6 hostHooks contract from main.js
   * @returns {Promise<object>} the controller
   */
  async init(hostHooks) {
    if (this.initialized) return this._controller
    this.hooks = this._normalizeHooks(hostHooks)
    this.disposed = false

    // Subscribe to host lifecycle events and fan them out to plugins (§5.8).
    this._wireLifecycleEvents()

    // Load enabled-state + grant decisions (non-fatal if unavailable).
    await this._loadPersistedState()

    // Discover plugins from main (list IPC) — defensive.
    await this._discover()

    // Auto-enable plugins the user previously enabled.
    for (const rec of this.plugins.values()) {
      if (this._enabledMap[rec.id] === true) {
        // Fire-and-forget; one failing plugin must not block the rest.
        this.enable(rec.id).catch((e) => {
          console.warn(`[plugins] auto-enable '${rec.id}' failed:`, e)
        })
      }
    }

    this.initialized = true
    this._controller = this._buildController()
    return this._controller
  }

  /** Defensive defaulting of the hostHooks object so missing hooks no-op. */
  _normalizeHooks(h) {
    const noop = () => {}
    const asyncNoop = async () => ({ ok: false, error: 'host hook unavailable' })
    const hooks = h && typeof h === 'object' ? h : {}
    const sidebar = hooks.sidebar || {}
    const ai = hooks.ai || {}
    const brain = hooks.brain || {}
    const auth = hooks.auth || {}
    const teams = hooks.teams || {}
    const storage = hooks.storage || {}
    const fs = hooks.fs || {}
    const net = hooks.net || {}
    return {
      getEditorExtensions: typeof hooks.getEditorExtensions === 'function' ? hooks.getEditorExtensions : () => [],
      onEditorExtensionsChanged: typeof hooks.onEditorExtensionsChanged === 'function' ? hooks.onEditorExtensionsChanged : noop,
      registerCommand: typeof hooks.registerCommand === 'function' ? hooks.registerCommand : noop,
      unregisterCommand: typeof hooks.unregisterCommand === 'function' ? hooks.unregisterCommand : noop,
      registerSlash: typeof hooks.registerSlash === 'function' ? hooks.registerSlash : noop,
      unregisterSlash: typeof hooks.unregisterSlash === 'function' ? hooks.unregisterSlash : noop,
      sidebar: {
        addSection: typeof sidebar.addSection === 'function' ? sidebar.addSection : noop,
        removeSection: typeof sidebar.removeSection === 'function' ? sidebar.removeSection : noop
      },
      addView: typeof hooks.addView === 'function' ? hooks.addView : () => ({ show: noop }),
      removeView: typeof hooks.removeView === 'function' ? hooks.removeView : noop,
      addNavItem: typeof hooks.addNavItem === 'function' ? hooks.addNavItem : noop,
      removeNavItem: typeof hooks.removeNavItem === 'function' ? hooks.removeNavItem : noop,
      addToolbarItem: typeof hooks.addToolbarItem === 'function' ? hooks.addToolbarItem : noop,
      removeToolbarItem: typeof hooks.removeToolbarItem === 'function' ? hooks.removeToolbarItem : noop,
      addStatusItem: typeof hooks.addStatusItem === 'function' ? hooks.addStatusItem : () => ({ set: noop }),
      removeStatusItem: typeof hooks.removeStatusItem === 'function' ? hooks.removeStatusItem : noop,
      addSettingsSection: typeof hooks.addSettingsSection === 'function' ? hooks.addSettingsSection : noop,
      ai: {
        registerProvider: typeof ai.registerProvider === 'function' ? ai.registerProvider : noop,
        unregisterProvider: typeof ai.unregisterProvider === 'function' ? ai.unregisterProvider : noop,
        complete: typeof ai.complete === 'function' ? ai.complete : async () => ({ text: '' }),
        embed: typeof ai.embed === 'function' ? ai.embed : async () => []
      },
      // ADDITIVE v1 (Phase 4): the Company Brain tool-registration hooks. Default
      // to no-ops so a host that doesn't wire a RAGEngine just makes plugin tools
      // inert (deny/degrade, never crash).
      brain: {
        registerTool: typeof brain.registerTool === 'function' ? brain.registerTool : noop,
        unregisterTool: typeof brain.unregisterTool === 'function' ? brain.unregisterTool : noop,
        listTools: typeof brain.listTools === 'function' ? brain.listTools : () => []
      },
      auth: {
        registerLoginMethod: typeof auth.registerLoginMethod === 'function' ? auth.registerLoginMethod : noop,
        unregisterLoginMethod: typeof auth.unregisterLoginMethod === 'function' ? auth.unregisterLoginMethod : noop
      },
      teams: {
        list: typeof teams.list === 'function' ? teams.list : () => [],
        addTeamAction: typeof teams.addTeamAction === 'function' ? teams.addTeamAction : noop,
        removeTeamAction: typeof teams.removeTeamAction === 'function' ? teams.removeTeamAction : noop
      },
      storage: {
        get: typeof storage.get === 'function' ? storage.get : asyncNoop,
        set: typeof storage.set === 'function' ? storage.set : asyncNoop,
        delete: typeof storage.delete === 'function' ? storage.delete : asyncNoop,
        keys: typeof storage.keys === 'function' ? storage.keys : async () => []
      },
      fs: {
        read: typeof fs.read === 'function' ? fs.read : asyncNoop,
        list: typeof fs.list === 'function' ? fs.list : async () => [],
        write: typeof fs.write === 'function' ? fs.write : asyncNoop
      },
      net: { fetch: typeof net.fetch === 'function' ? net.fetch : asyncNoop },
      on: typeof hooks.on === 'function' ? hooks.on : noop
    }
  }

  /** Wire host lifecycle events → re-emit to every active plugin sandbox. */
  _wireLifecycleEvents() {
    for (const ev of LIFECYCLE_EVENTS) {
      try {
        this.hooks.on(ev, (payload) => this._emitToPlugins(ev, payload))
      } catch (_e) { /* a host that can't subscribe just means no events */ }
    }
  }

  /** Send a sanitized lifecycle event to all active plugins (§4.2). */
  _emitToPlugins(event, payload) {
    if (this.disposed) return
    for (const rec of this.plugins.values()) {
      if (rec.state !== PluginState.ENABLED || !rec.sandbox) continue
      try {
        this._sandboxNotify(rec, `host.event.${event}`, payload)
      } catch (e) {
        console.warn(`[plugins] emit '${event}' to '${rec.id}' failed:`, e)
      }
    }
  }

  // ── persistence ──────────────────────────────────────────────────────────

  async _loadPersistedState() {
    this._enabledMap = (await this._settingsGet(SETTINGS_ENABLED_KEY)) || {}
    this._decisionMap = (await this._settingsGet(SETTINGS_DECISION_KEY)) || {}
    if (typeof this._enabledMap !== 'object' || this._enabledMap === null) this._enabledMap = {}
    if (typeof this._decisionMap !== 'object' || this._decisionMap === null) this._decisionMap = {}
  }

  async _settingsGet(key) {
    try {
      if (typeof window !== 'undefined' && window.api && typeof window.api.invoke === 'function') {
        return await window.api.invoke('settings:get', key)
      }
    } catch (_e) { /* fall through */ }
    return null
  }

  async _settingsSet(key, value) {
    try {
      if (typeof window !== 'undefined' && window.api && typeof window.api.invoke === 'function') {
        await window.api.invoke('settings:set', key, value)
      }
    } catch (_e) { /* best-effort */ }
  }

  async _persistEnabled(id, enabled) {
    this._enabledMap[id] = !!enabled
    await this._settingsSet(SETTINGS_ENABLED_KEY, this._enabledMap)
  }

  async _persistDecision(id, decision) {
    this._decisionMap[id] = decision
    await this._settingsSet(SETTINGS_DECISION_KEY, this._decisionMap)
  }

  // ── discovery ──────────────────────────────────────────────────────────────

  /** Pull the plugin list from main (`plugin:list`) and validate each manifest. */
  async _discover() {
    let list = []
    try {
      if (typeof window !== 'undefined' && window.api && typeof window.api.invoke === 'function') {
        const res = await window.api.invoke('plugin:list', {})
        if (res && res.ok && Array.isArray(res.plugins)) list = res.plugins
      }
    } catch (e) {
      console.warn('[plugins] plugin:list unavailable:', e)
    }
    for (const raw of list) {
      try {
        const { ok, manifest } = validateManifest(raw && raw.manifest ? raw.manifest : raw)
        if (!ok || !manifest) continue
        if (!this.plugins.has(manifest.id)) {
          const rec = new PluginRecord(manifest, raw.source, raw.dir)
          rec.decision = this._decisionMap[manifest.id] || GrantDecision.PENDING
          rec.state = raw.enabled ? PluginState.DISABLED : PluginState.DISABLED
          this.plugins.set(manifest.id, rec)
        }
      } catch (e) {
        console.warn('[plugins] discovery skipped a malformed record:', e)
      }
    }
  }

  // ── lazy module loading (defensive) ─────────────────────────────────────────

  /** Lazily import the contrib adapters; tolerate a missing/partial sibling. */
  async _loadAdapters() {
    if (this._adapters) return this._adapters
    const adapters = {}
    const tryImport = async (name, path) => {
      try {
        // eslint-disable-next-line no-unsanitized/method
        adapters[name] = await import(/* @vite-ignore */ path)
      } catch (e) {
        console.warn(`[plugins] adapter '${name}' not available (${e && e.message}); its surfaces no-op`)
        adapters[name] = null
      }
    }
    await Promise.all([
      tryImport('editor', './contrib-editor'),
      tryImport('ui', './contrib-ui'),
      tryImport('auth', './contrib-auth'),
      tryImport('ai', './contrib-ai'),
      tryImport('brain', './contrib-brain'),
      tryImport('team', './contrib-team')
    ])
    this._adapters = adapters
    return adapters
  }

  /** Lazily import the sandbox constructor. */
  async _loadSandboxCtor() {
    if (this._SandboxCtor) return this._SandboxCtor
    try {
      const mod = await import(/* @vite-ignore */ './plugin-sandbox')
      this._SandboxCtor = mod.PluginSandbox || mod.default || null
    } catch (e) {
      console.warn('[plugins] plugin-sandbox unavailable:', e && e.message)
      this._SandboxCtor = null
    }
    return this._SandboxCtor
  }

  // ── lifecycle: enable / disable / reload ─────────────────────────────────────

  /**
   * Enable a plugin: read its source, spin a sandbox, apply declarative
   * `contributes` first (so UI shows pre-activate), then drive `plugin.activate`.
   * Never throws; returns `{ ok, error? }`.
   */
  async enable(id) {
    if (this.disposed) return { ok: false, error: 'host disposed' }
    const rec = this.plugins.get(id)
    if (!rec) return { ok: false, error: `unknown plugin '${id}'` }
    if (rec.state === PluginState.ENABLED) return { ok: true }

    try {
      // Apply declarative contributions immediately (pre-activate, §10).
      await this._applyContributes(rec)

      // Spin a sandbox + RPC channel.
      const ok = await this._spawnSandbox(rec)
      if (!ok) {
        // No sandbox available (sibling not built / failed). Declarative
        // contributions still applied; mark enabled-without-runtime so the host
        // app stays healthy and the plugin re-activates once sandbox lands.
        rec.state = PluginState.ENABLED
        rec.error = 'sandbox unavailable; declarative contributions only'
        await this._persistEnabled(id, true)
        return { ok: true, error: rec.error }
      }

      // Build the ctxDescriptor (JSON manifest of granted namespaces, §4.5).
      const ctxDescriptor = this._buildCtxDescriptor(rec)
      const result = await this._sandboxActivate(rec, ctxDescriptor)
      // The runtime may report which dynamic contributions it registered; the
      // ctx proxy already routed them through the registry, so this is advisory.
      void result

      rec.state = PluginState.ENABLED
      rec.error = null
      await this._persistEnabled(id, true)
      return { ok: true }
    } catch (e) {
      this._quarantine(rec, e && e.message ? e.message : String(e))
      return { ok: false, error: rec.error }
    }
  }

  /** Disable a plugin: deactivate, dispose the sandbox, unwire all contributions. */
  async disable(id, opts = {}) {
    const rec = this.plugins.get(id)
    if (!rec) return { ok: false, error: `unknown plugin '${id}'` }
    if (rec.state === PluginState.DISABLED && !rec.sandbox) {
      if (!opts.keepEnabledFlag) await this._persistEnabled(id, false)
      return { ok: true }
    }
    try {
      if (rec.sandbox) {
        // Best-effort deactivate; never block teardown on a hung plugin.
        try { await this._sandboxDeactivate(rec) } catch (_e) { /* ignore */ }
        try { rec.sandbox.dispose && rec.sandbox.dispose() } catch (_e) { /* ignore */ }
        rec.sandbox = null
      }
    } finally {
      // Always tear down contributions + tracked disposables.
      rec.disposeAll()
      this.registry.disposePlugin(id)
      rec.state = PluginState.DISABLED
      if (!opts.keepEnabledFlag) await this._persistEnabled(id, false)
    }
    return { ok: true }
  }

  /** Hot reload: disable (keeping the enabled flag) then re-enable from disk. */
  async reload(id) {
    const rec = this.plugins.get(id)
    if (!rec) {
      // Possibly a brand-new plugin appeared on disk — re-discover.
      await this._discover()
      const fresh = this.plugins.get(id)
      if (!fresh) return { ok: false, error: `unknown plugin '${id}'` }
    }
    const wasEnabled = this.plugins.get(id) && this.plugins.get(id).state === PluginState.ENABLED
    await this.disable(id, { keepEnabledFlag: true })
    // Re-read the manifest from disk so capability/contribution changes apply.
    try {
      const res = await this._readPlugin(id)
      if (res && res.ok && res.manifest) {
        const { ok, manifest } = validateManifest(res.manifest)
        if (ok && manifest) {
          const cur = this.plugins.get(id) || new PluginRecord(manifest, 'user', null)
          cur.manifest = manifest
          this.plugins.set(id, cur)
        }
      }
    } catch (_e) { /* keep prior manifest */ }
    if (wasEnabled || this._enabledMap[id]) return this.enable(id)
    return { ok: true }
  }

  /** Mark a plugin quarantined and tear it down without breaking the host (§4.4). */
  _quarantine(rec, reason) {
    try {
      if (rec.sandbox) {
        try { rec.sandbox.dispose && rec.sandbox.dispose('quarantined') } catch (_e) { /* ignore */ }
        rec.sandbox = null
      }
    } finally {
      rec.disposeAll()
      this.registry.disposePlugin(rec.id)
      rec.state = PluginState.QUARANTINED
      rec.error = reason || 'quarantined'
    }
    // Surface a non-blocking notification; the host app continues.
    this._safeNotify({
      message: `Plugin '${rec.manifest.name || rec.id}' was disabled: ${rec.error}`,
      kind: 'warn'
    })
    console.warn(`[plugins] QUARANTINED '${rec.id}': ${rec.error}`)
  }

  _safeNotify(n) {
    try {
      const adapters = this._adapters
      if (adapters && adapters.ui && typeof adapters.ui.notify === 'function') {
        adapters.ui.notify(n)
        return
      }
    } catch (_e) { /* ignore */ }
    // Fallback: a window CustomEvent the host UI may listen for.
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('plugin:notify', { detail: n }))
      }
    } catch (_e) { /* ignore */ }
  }

  // ── sandbox bridging (defensive shims if sandbox not yet present) ────────────

  async _spawnSandbox(rec) {
    const Ctor = await this._loadSandboxCtor()
    const readRes = await this._readPlugin(rec.id)
    if (!readRes || !readRes.ok) {
      console.warn(`[plugins] plugin:read for '${rec.id}' failed`)
      return false
    }
    if (!Ctor) return false
    try {
      // The sandbox owns the iframe + MessageChannel and exposes a PluginRpc-
      // compatible bridge. The host passes capability/dispatch callbacks so the
      // sandbox routes plugin→host requests back through `_dispatchHostCall`.
      const sandbox = new Ctor({
        pluginId: rec.id,
        manifest: rec.manifest,
        entrySource: readRes.entrySource,
        assets: readRes.assets || {},
        // Central, capability-gated dispatch for every plugin→host request.
        onHostCall: (method, params) => this._dispatchHostCall(rec, method, params),
        // Fire-and-forget plugin→host signals.
        onHostNotify: (method, params) => this._dispatchHostNotify(rec, method, params),
        // The host quarantines on misbehavior/timeout.
        onMisbehavior: (reason) => this._quarantine(rec, reason)
      })
      rec.sandbox = sandbox
      return true
    } catch (e) {
      console.warn(`[plugins] sandbox spawn failed for '${rec.id}':`, e)
      return false
    }
  }

  async _readPlugin(id) {
    try {
      if (typeof window !== 'undefined' && window.api && typeof window.api.invoke === 'function') {
        return await window.api.invoke('plugin:read', { id })
      }
    } catch (e) {
      console.warn(`[plugins] plugin:read('${id}') threw:`, e)
    }
    return { ok: false, error: 'plugin:read unavailable' }
  }

  /** Host→plugin request (activate). Tolerates sandbox API variance. */
  async _sandboxActivate(rec, ctxDescriptor) {
    const sb = rec.sandbox
    if (!sb) return null
    if (typeof sb.activate === 'function') return sb.activate(ctxDescriptor)
    if (typeof sb.request === 'function') return sb.request('plugin.activate', { ctxDescriptor })
    return null
  }

  async _sandboxDeactivate(rec) {
    const sb = rec.sandbox
    if (!sb) return null
    if (typeof sb.deactivate === 'function') return sb.deactivate()
    if (typeof sb.request === 'function') return sb.request('plugin.deactivate', {})
    return null
  }

  /** Host→plugin event/notify (lifecycle + callback dispatch). */
  _sandboxNotify(rec, method, params) {
    const sb = rec.sandbox
    if (!sb) return
    if (typeof sb.notify === 'function') sb.notify(method, params)
    else if (typeof sb.event === 'function') sb.event(method, params)
  }

  /**
   * Invoke a plugin-registered callback (e.g. command `run`, `onToken`) by token.
   * The host calls this; the sandbox routes `plugin.callback {token,args}` back to
   * the stored function (§5 boundary rule).
   */
  invokeCallback(rec, token, args) {
    if (!rec || rec.state !== PluginState.ENABLED || !rec.sandbox) return
    try {
      this._sandboxNotify(rec, 'plugin.callback', { token, args: Array.isArray(args) ? args : [] })
    } catch (e) {
      console.warn(`[plugins] callback ${token} → '${rec.id}' failed:`, e)
    }
  }

  // ── the capability-gated host-call dispatcher ────────────────────────────────

  /**
   * EVERY plugin→host request lands here. This is the central capability gate
   * (belt to the per-adapter braces): it re-checks the declared capability for
   * the method BEFORE routing to the adapter. Returns a JSON-serializable result
   * or throws an `RpcError`-shaped error the sandbox turns into an error reply.
   *
   * Deny-by-default: a method not in the capability map, or whose capability the
   * manifest didn't declare, is rejected (§3, §8.4).
   */
  async _dispatchHostCall(rec, method, params) {
    if (this.disposed) {
      throw makeRpcError('HOST_DISPOSED', 'plugin host disposed')
    }
    if (!rec || rec.state === PluginState.QUARANTINED) {
      throw makeRpcError('QUARANTINED', 'plugin quarantined')
    }

    const required = capabilityForMethod(method)
    if (required === '__unknown__') {
      throw makeRpcError('UNSUPPORTED_METHOD', `unknown host method '${method}'`)
    }

    // Capability RE-CHECK at the seam.
    if (required === 'net') {
      // Resolve the SPECIFIC net:<host> against the request URL.
      this._assertNet(rec, params)
    } else if (required) {
      try {
        assertCapability(rec.manifest, required, method)
      } catch (e) {
        if (e instanceof CapabilityError) {
          throw makeRpcError('CAPABILITY_DENIED', e.message)
        }
        throw makeRpcError('INTERNAL', e && e.message ? e.message : 'capability check failed')
      }
      // Sub-capability checks for ui.* variants are encoded in capabilityForMethod
      // already (sections/views/clipboard), so the single check above covers them.
    }

    // Route to the adapter. The adapter performs the actual host wiring and may
    // perform its own (redundant, intentional) capability check.
    try {
      return await this._route(rec, method, params)
    } catch (e) {
      // Normalize any adapter throw into a wire error; never leak a raw stack.
      if (e && e.code) throw e
      throw makeRpcError('INTERNAL', e && e.message ? e.message : 'host call failed')
    }
  }

  /** Resolve + enforce the per-host net:<host> grant for a fetch request. */
  _assertNet(rec, params) {
    let host = ''
    try {
      const u = new URL(params && params.url)
      host = (u.hostname || '').toLowerCase()
    } catch (_e) {
      throw makeRpcError('BAD_PARAMS', 'net.fetch requires a valid absolute URL')
    }
    if (!netHostAllowed(rec.manifest.capabilities, host)) {
      throw makeRpcError('CAPABILITY_DENIED', `network access to '${host}' not granted`)
    }
  }

  /** Route a (capability-cleared) host call to the owning adapter / hook. */
  async _route(rec, method, params) {
    const adapters = await this._loadAdapters()
    const ns = method.split('.')[1] // host.<ns>.<method>

    switch (ns) {
      case 'commands':
        return this._routeCommands(rec, method, params, adapters)
      case 'editor':
        return this._routeEditor(rec, method, params, adapters)
      case 'ui':
        return this._routeUi(rec, method, params, adapters)
      case 'ai':
        return this._routeAi(rec, method, params, adapters)
      case 'brain':
        return this._routeBrain(rec, method, params, adapters)
      case 'auth':
        return this._routeAuth(rec, method, params, adapters)
      case 'teams':
        return this._routeTeams(rec, method, params, adapters)
      case 'storage':
        return this._routeStorage(rec, method, params)
      case 'fs':
        return this._routeFs(rec, method, params)
      case 'net':
        return this.hooks.net.fetch(rec.id, params && params.url, params && params.init)
      case 'events':
        // Events are subscribe-only from the plugin side; nothing to do here.
        return { ok: true }
      default:
        throw makeRpcError('UNSUPPORTED_METHOD', `unrouted host namespace '${ns}'`)
    }
  }

  // ── per-namespace routing (registry + adapter/hook wiring) ──────────────────

  _routeCommands(rec, method, params, adapters) {
    const action = method.split('.')[2]
    const adapterFn = adapters.ui && adapters.ui[`command_${action}`]
    if (action === 'register') {
      const id = this._namespaceId(rec, params && params.id)
      const disp = this.registry.add('commands', id, rec.id, { ...params, id }, () => {
        this.hooks.unregisterCommand(id)
      })
      rec.track(disp)
      // Wire the live command: dispatch routes back to the plugin's run token.
      this.hooks.registerCommand(id, (detail) => {
        if (params && typeof params.runToken === 'number') {
          this.invokeCallback(rec, params.runToken, [detail])
        }
      })
      return { ok: true, id, disposableToken: this._issueDisposable(rec, disp) }
    }
    if (action === 'execute') {
      const raw = params && params.id
      // Resolve to the canonical command id WITHOUT blindly re-prefixing: a bare
      // id is the plugin's own; an already-qualified id is taken verbatim so a
      // foreign id can't be smuggled past ownership by double-prefixing.
      const target = this._resolveCommandTarget(rec, raw)
      // Deny cross-plugin execute by default: only own ids (or host-public ones,
      // which are off by default — deny-by-default policy, §5.1).
      if (!this._ownsId(rec, target)) {
        throw makeRpcError('CAPABILITY_DENIED', `cannot execute non-owned command '${target}'`)
      }
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(`cmd:${target}`, { detail: params && params.payload }))
        }
      } catch (_e) { /* ignore */ }
      return { ok: true }
    }
    if (action === 'list') {
      return this.registry.list('commands')
        .filter((c) => c.id && c.id.startsWith(`${rec.id}.`))
        .map((c) => ({ id: c.id, title: c.title }))
    }
    if (typeof adapterFn === 'function') return adapterFn(rec, params)
    throw makeRpcError('UNSUPPORTED_METHOD', method)
  }

  _routeEditor(rec, method, params, adapters) {
    const action = method.split('.')[2]
    const ed = adapters.editor
    // Registry-first: every editor registration is recorded; the adapter does the
    // CM6 wiring. If the adapter is absent, we still register (no-op surface).
    if (action === 'registerBlock' || action === 'registerDecoration') {
      const surface = action === 'registerBlock' ? 'blocks' : 'blocks'
      const key = this._namespaceId(rec, (params && params.type) || `${action}-${this._seq()}`)
      let adapterDisp = null
      if (ed && typeof ed[action] === 'function') {
        adapterDisp = safeCall(() => ed[action](rec, params))
      }
      const disp = this.registry.add(surface, key, rec.id, { ...params, _key: key }, () => {
        if (adapterDisp && typeof adapterDisp.dispose === 'function') adapterDisp.dispose()
      })
      rec.track(disp)
      // Editor extensions may have changed → let main.js trigger a rebind.
      try { this.hooks.onEditorExtensionsChanged(() => {}) } catch (_e) { /* ignore */ }
      return { ok: true, disposableToken: this._issueDisposable(rec, disp) }
    }
    if (action === 'onChange') {
      // Subscription handled adapter-side; host records it for disposal.
      let adapterDisp = null
      if (ed && typeof ed.onChange === 'function') {
        adapterDisp = safeCall(() => ed.onChange(rec, params))
      }
      const disp = { dispose: () => { if (adapterDisp) try { adapterDisp.dispose() } catch (_e) { /* ignore */ } } }
      rec.track(disp)
      return { ok: true, disposableToken: this._issueDisposable(rec, disp) }
    }
    if (action === 'getActive') {
      if (ed && typeof ed.getActive === 'function') return ed.getActive(rec)
      return null
    }
    if (action === 'insert') {
      if (ed && typeof ed.insert === 'function') return ed.insert(rec, params)
      return { ok: false }
    }
    throw makeRpcError('UNSUPPORTED_METHOD', method)
  }

  _routeUi(rec, method, params, adapters) {
    const action = method.split('.')[2]
    const ui = adapters.ui
    // Surfaces routed through the registry; the adapter mounts/sanitizes.
    const surfaceMap = {
      panel: 'panels',
      sidebarSection: 'sections',
      view: 'views',
      navItem: 'navItems',
      toolbarItem: 'toolbarItems',
      statusItem: 'statusItems',
      settingsSection: 'settings'
    }
    if (surfaceMap[action]) {
      const surface = surfaceMap[action]
      const key = this._namespaceId(rec, (params && params.id) || `${action}-${this._seq()}`)
      let adapterDisp = null
      if (ui && typeof ui[action] === 'function') {
        adapterDisp = safeCall(() => ui[action](rec, { ...params, id: key }))
      }
      const disp = this.registry.add(surface, key, rec.id, { ...params, id: key }, () => {
        if (adapterDisp && typeof adapterDisp.dispose === 'function') adapterDisp.dispose()
      })
      rec.track(disp)
      return { ok: true, id: key, disposableToken: this._issueDisposable(rec, disp) }
    }
    // Transient calls (no registry entry): notify / modal / clipboard.
    if (ui && typeof ui[action] === 'function') {
      return ui[action](rec, params)
    }
    if (action === 'notify') { this._safeNotify(params); return { ok: true } }
    throw makeRpcError('UNSUPPORTED_METHOD', method)
  }

  _routeAi(rec, method, params, adapters) {
    const action = method.split('.')[2]
    const ai = adapters.ai
    if (action === 'registerProvider') {
      const id = this._namespaceId(rec, params && params.id)
      let adapterDisp = null
      if (ai && typeof ai.registerProvider === 'function') {
        adapterDisp = safeCall(() => ai.registerProvider(rec, { ...params, id }))
      } else {
        // Fall back to the raw host hook (rag-engine generators map).
        safeCall(() => this.hooks.ai.registerProvider(id, params))
      }
      const disp = this.registry.add('aiProviders', id, rec.id, { ...params, id }, () => {
        if (adapterDisp && typeof adapterDisp.dispose === 'function') adapterDisp.dispose()
        else safeCall(() => this.hooks.ai.unregisterProvider(id))
      })
      rec.track(disp)
      return { ok: true, id, disposableToken: this._issueDisposable(rec, disp) }
    }
    if (action === 'complete') {
      if (ai && typeof ai.complete === 'function') return ai.complete(rec, params)
      return this.hooks.ai.complete(params)
    }
    if (action === 'embed') {
      if (ai && typeof ai.embed === 'function') return ai.embed(rec, params)
      return this.hooks.ai.embed(params && params.text)
    }
    throw makeRpcError('UNSUPPORTED_METHOD', method)
  }

  /**
   * Route a (capability-cleared, `tools`) Brain call. Mirrors `_routeAi`:
   * `registerTool` namespaces the id, builds a sandbox bridge for the tool's
   * handler, calls the adapter (or a raw-hook fallback), records the tool in the
   * `brainTools` registry with a disposer that unregisters it from the Brain, and
   * returns a disposable token. `listTools` reflects the Brain's tool list.
   *
   * The handler bridges INTO the sandbox: we invoke the plugin's marshaled run
   * token with `[args, callId]` and await a correlated `host.notify.brainToolResult`
   * notify (resolved in `_dispatchHostNotify`). This is the same callback-token
   * round-trip the AI streamers use, adapted to a single request/result tool call.
   */
  _routeBrain(rec, method, params, adapters) {
    const action = method.split('.')[2]
    const brain = adapters.brain
    if (action === 'registerTool') {
      // The tool's handler arrives marshaled as a `{ __cb__: <token> }` marker
      // (sandbox-runtime.js); keep that token so the bridge can invoke it.
      const runMarker = (params && (params.handler || params.run)) || null
      const runToken = runMarker && typeof runMarker === 'object' && typeof runMarker.__cb__ !== 'undefined'
        ? runMarker.__cb__
        : null
      // Bridge into the sandbox: invoke the plugin's tool handler and await the
      // result over a per-call channel. Degrade (not throw) if there is no token.
      const bridge = {
        run: (args) => new Promise((resolve) => {
          if (runToken == null) { resolve({ error: 'plugin tool has no handler' }); return }
          const callId = this._seq()
          this._pendingBrainCalls = this._pendingBrainCalls || new Map()
          this._pendingBrainCalls.set(callId, resolve)
          this.invokeCallback(rec, runToken, [args, callId])
        }),
      }
      let adapterDisp = null
      let toolId = null
      if (brain && typeof brain.registerTool === 'function') {
        adapterDisp = safeCall(() => brain.registerTool(rec, params, bridge))
      } else {
        // Fall back to the raw host hook (the RAGEngine tool registry). The host
        // hook namespaces under the plugin; we cannot know the final id here, so
        // we register a best-effort impl keyed by the plugin-prefixed raw id.
        toolId = this._namespaceId(rec, params && params.id)
        safeCall(() => this.hooks.brain.registerTool(toolId, {
          description: params && params.description,
          parameters: params && params.parameters,
          handler: (args) => bridge.run(args),
          source: 'plugin',
        }))
      }
      const key = this._namespaceId(rec, params && params.id)
      const disp = this.registry.add('brainTools', key, rec.id, { ...params, id: key }, () => {
        if (adapterDisp && typeof adapterDisp.dispose === 'function') adapterDisp.dispose()
        else if (toolId) safeCall(() => this.hooks.brain.unregisterTool(toolId))
      })
      rec.track(disp)
      return { ok: true, id: key, disposableToken: this._issueDisposable(rec, disp) }
    }
    if (action === 'listTools') {
      const raw = safeCall(() => this.hooks.brain.listTools()) || []
      // Sanitize to id/description/source only — never the live handler.
      return Array.isArray(raw)
        ? raw.map((t) => ({ id: t && t.id, description: t && t.description, source: t && t.source }))
        : []
    }
    throw makeRpcError('UNSUPPORTED_METHOD', method)
  }

  _routeAuth(rec, method, params, adapters) {
    const action = method.split('.')[2]
    const auth = adapters.auth
    if (action === 'registerLoginMethod') {
      const id = this._namespaceId(rec, params && params.id)
      let adapterDisp = null
      if (auth && typeof auth.registerLoginMethod === 'function') {
        adapterDisp = safeCall(() => auth.registerLoginMethod(rec, { ...params, id }))
      } else {
        safeCall(() => this.hooks.auth.registerLoginMethod({ ...params, id }))
      }
      const disp = this.registry.add('loginMethods', id, rec.id, { ...params, id }, () => {
        if (adapterDisp && typeof adapterDisp.dispose === 'function') adapterDisp.dispose()
        else safeCall(() => this.hooks.auth.unregisterLoginMethod(id))
      })
      rec.track(disp)
      return { ok: true, id, disposableToken: this._issueDisposable(rec, disp) }
    }
    throw makeRpcError('UNSUPPORTED_METHOD', method)
  }

  _routeTeams(rec, method, params, adapters) {
    const action = method.split('.')[2]
    const team = adapters.team
    if (action === 'onTeamOpen') {
      let adapterDisp = null
      if (team && typeof team.onTeamOpen === 'function') {
        adapterDisp = safeCall(() => team.onTeamOpen(rec, params))
      }
      const disp = { dispose: () => { if (adapterDisp) try { adapterDisp.dispose() } catch (_e) { /* ignore */ } } }
      rec.track(disp)
      return { ok: true, disposableToken: this._issueDisposable(rec, disp) }
    }
    if (action === 'registerTeamAction') {
      const id = this._namespaceId(rec, params && params.id)
      let adapterDisp = null
      if (team && typeof team.registerTeamAction === 'function') {
        adapterDisp = safeCall(() => team.registerTeamAction(rec, { ...params, id }))
      } else {
        safeCall(() => this.hooks.teams.addTeamAction({
          id,
          label: params && params.label,
          icon: params && params.icon,
          onClick: (teamId) => {
            if (params && typeof params.runToken === 'number') this.invokeCallback(rec, params.runToken, [teamId])
          }
        }))
      }
      const disp = this.registry.add('teamHooks', id, rec.id, { ...params, id }, () => {
        if (adapterDisp && typeof adapterDisp.dispose === 'function') adapterDisp.dispose()
        else safeCall(() => this.hooks.teams.removeTeamAction(id))
      })
      rec.track(disp)
      return { ok: true, id, disposableToken: this._issueDisposable(rec, disp) }
    }
    if (action === 'list') {
      const raw = safeCall(() => this.hooks.teams.list()) || []
      // Sanitize: ids + names only, never keys.
      return Array.isArray(raw)
        ? raw.map((t) => ({ teamId: t && t.teamId, teamName: t && t.teamName }))
        : []
    }
    throw makeRpcError('UNSUPPORTED_METHOD', method)
  }

  _routeStorage(rec, method, params) {
    const action = method.split('.')[2]
    const ns = rec.id // host prefixes with plugin:<id>:
    switch (action) {
      case 'get': return this.hooks.storage.get(ns, params && params.key)
      case 'set': return this.hooks.storage.set(ns, params && params.key, params && params.value)
      case 'delete': return this.hooks.storage.delete(ns, params && params.key)
      case 'keys': return this.hooks.storage.keys(ns)
      default: throw makeRpcError('UNSUPPORTED_METHOD', method)
    }
  }

  _routeFs(rec, method, params) {
    const action = method.split('.')[2]
    switch (action) {
      case 'read': return this.hooks.fs.read(rec.id, params && params.path)
      case 'list': return this.hooks.fs.list(rec.id, params && params.dir)
      case 'write': return this.hooks.fs.write(rec.id, params && params.path, params && params.data)
      default: throw makeRpcError('UNSUPPORTED_METHOD', method)
    }
  }

  /** Plugin→host fire-and-forget (`host.notify.<channel>`). */
  _dispatchHostNotify(rec, method, params) {
    if (this.disposed || !rec || rec.state === PluginState.QUARANTINED) return
    // Notifies are advisory; route ui-style notifies, drop the rest.
    if (method === 'host.notify.ui' || method === 'host.notify.notify') {
      this._safeNotify(params)
    }
    // Brain tool result: the sandbox posts a tool handler's return value back
    // here (correlated by callId), resolving the pending `bridge.run` promise the
    // Brain is awaiting (Phase 4). The result is UNTRUSTED data, relayed verbatim.
    if (method === 'host.notify.brainToolResult') {
      const callId = params && params.callId
      const pending = this._pendingBrainCalls
      if (pending && pending.has(callId)) {
        const resolve = pending.get(callId)
        pending.delete(callId)
        try {
          resolve(params && Object.prototype.hasOwnProperty.call(params, 'error')
            ? { error: params.error }
            : (params ? params.result : undefined))
        } catch (_e) { /* a settled/duplicate result is harmless */ }
      }
    }
    // (Future channels can be added without breaking the contract.)
  }

  // ── declarative contributions (pre-activate) ────────────────────────────────

  /**
   * Apply `contributes` BEFORE activate so the UI shows immediately (§10). These
   * are static descriptors; runtime impls (render/run callbacks) bind on activate
   * via the ctx proxies. We only wire the surfaces that are purely declarative
   * here (commands shell, slash, nav, status placeholders, settings, sections).
   */
  async _applyContributes(rec) {
    const c = rec.manifest.contributes || {}
    const declare = (cap) => hasCapability(rec.manifest, cap)

    // commands (shell; run binds on activate)
    if (Array.isArray(c.commands) && declare(CAPABILITIES.COMMANDS)) {
      for (const cmd of c.commands) {
        if (!cmd || typeof cmd.id !== 'string') continue
        const id = this._namespaceId(rec, cmd.id)
        const disp = this.registry.add('commands', id, rec.id, { ...cmd, id, declarative: true }, () => {
          safeCall(() => this.hooks.unregisterCommand(id))
        })
        rec.track(disp)
      }
    }
    // slash
    if (Array.isArray(c.slash) && declare(CAPABILITIES.EDITOR)) {
      for (const s of c.slash) {
        if (!s || typeof s.label !== 'string') continue
        const key = this._namespaceId(rec, s.label)
        const disp = this.registry.add('slash', key, rec.id, { ...s }, () => {
          safeCall(() => this.hooks.unregisterSlash(s.label))
        })
        rec.track(disp)
        safeCall(() => this.hooks.registerSlash({ ...s }))
      }
    }
    // sidebar sections
    if (Array.isArray(c.sections) && declare(CAPABILITIES.SECTIONS)) {
      for (const s of c.sections) {
        if (!s || typeof s.id !== 'string') continue
        const id = this._namespaceId(rec, s.id)
        const disp = this.registry.add('sections', id, rec.id, { ...s, id }, () => {
          safeCall(() => this.hooks.sidebar.removeSection(id))
        })
        rec.track(disp)
        safeCall(() => this.hooks.sidebar.addSection({
          id, title: s.title, order: s.order, mount: () => {}
        }))
      }
    }
    // views
    if (Array.isArray(c.views) && declare(CAPABILITIES.VIEWS)) {
      for (const v of c.views) {
        if (!v || typeof v.id !== 'string') continue
        const id = this._namespaceId(rec, v.id)
        const disp = this.registry.add('views', id, rec.id, { ...v, id }, () => {
          safeCall(() => this.hooks.removeView(id))
        })
        rec.track(disp)
        safeCall(() => this.hooks.addView({
          id, title: v.title, icon: v.icon, mount: () => {}, show: () => {}, hide: () => {}
        }))
      }
    }
    // nav items
    if (Array.isArray(c.navItems) && declare(CAPABILITIES.UI)) {
      for (const n of c.navItems) {
        if (!n || typeof n.id !== 'string') continue
        const id = this._namespaceId(rec, n.id)
        const disp = this.registry.add('navItems', id, rec.id, { ...n, id }, () => {
          safeCall(() => this.hooks.removeNavItem(id))
        })
        rec.track(disp)
        safeCall(() => this.hooks.addNavItem({
          id, label: n.label, icon: n.icon, onClick: () => this._onNavClick(rec, n.target)
        }))
      }
    }
    // toolbar items (run binds on activate; declarative just reserves the slot)
    if (Array.isArray(c.toolbarItems) && declare(CAPABILITIES.UI)) {
      for (const t of c.toolbarItems) {
        if (!t || typeof t.id !== 'string') continue
        const id = this._namespaceId(rec, t.id)
        const disp = this.registry.add('toolbarItems', id, rec.id, { ...t, id }, () => {
          safeCall(() => this.hooks.removeToolbarItem(id))
        })
        rec.track(disp)
      }
    }
    // status items
    if (Array.isArray(c.statusItems) && declare(CAPABILITIES.UI)) {
      for (const st of c.statusItems) {
        if (!st || typeof st.id !== 'string') continue
        const id = this._namespaceId(rec, st.id)
        const handle = safeCall(() => this.hooks.addStatusItem({ id, location: st.location })) || { set: () => {} }
        const disp = this.registry.add('statusItems', id, rec.id, { ...st, id, _handle: handle }, () => {
          safeCall(() => this.hooks.removeStatusItem(id))
        })
        rec.track(disp)
      }
    }
    // settings sections
    if (Array.isArray(c.settings) && declare(CAPABILITIES.VIEWS)) {
      for (const se of c.settings) {
        if (!se || typeof se.id !== 'string') continue
        const id = this._namespaceId(rec, se.id)
        const disp = this.registry.add('settings', id, rec.id, { ...se, id }, () => {})
        rec.track(disp)
        safeCall(() => this.hooks.addSettingsSection({ id, title: se.title, mount: () => {} }))
      }
    }
    // formats / aiProviders / loginMethods / teamHooks / blocks / panels are
    // declared here (so the manager can show them) but require runtime impls, so
    // they fully wire on activate via the ctx proxies.
    for (const decl of ['formats', 'blocks', 'panels', 'aiProviders', 'loginMethods']) {
      if (Array.isArray(c[decl])) {
        for (const item of c[decl]) {
          if (!item || typeof item.id !== 'string') {
            // blocks key on `type`, formats/providers/login on `id`
            if (decl === 'blocks' && item && typeof item.type === 'string') {
              const key = this._namespaceId(rec, item.type)
              rec.track(this.registry.add('blocks', key, rec.id, { ...item, declarative: true }, () => {}))
            }
            continue
          }
          const key = this._namespaceId(rec, item.id)
          rec.track(this.registry.add(decl, key, rec.id, { ...item, declarative: true }, () => {}))
        }
      }
    }
  }

  _onNavClick(rec, target) {
    if (typeof target !== 'string') return
    try {
      if (target.startsWith('command:')) {
        const cmdId = this._namespaceId(rec, target.slice('command:'.length))
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(`cmd:${cmdId}`, { detail: null }))
        }
      } else {
        // a view id; let the host show it.
        const viewId = this._namespaceId(rec, target)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('plugin:show-view', { detail: { id: viewId } }))
        }
      }
    } catch (_e) { /* ignore */ }
  }

  // ── ctxDescriptor (the JSON namespace manifest sent into the sandbox) ────────

  /**
   * Build the §4.5 `ctxDescriptor`: a PLAIN JSON manifest of the namespaces/
   * methods available to this plugin given its granted capabilities. NOT
   * functions — `sandbox-runtime.js` builds the real `ctx` proxies from it.
   */
  _buildCtxDescriptor(rec) {
    const caps = rec.manifest.capabilities
    const has = (c) => hasCapability(rec.manifest, c)
    const ns = {}
    if (has(CAPABILITIES.COMMANDS)) ns.commands = ['register', 'execute', 'list']
    if (has(CAPABILITIES.EDITOR)) ns.editor = ['registerBlock', 'registerDecoration', 'onChange', 'getActive', 'insert']
    if (has(CAPABILITIES.AI)) ns.ai = ['complete', 'embed', 'registerProvider']
    // ADDITIVE v1 (Phase 4): the Company Brain tool-registration namespace.
    if (has(CAPABILITIES.TOOLS)) ns.brain = ['registerTool', 'listTools']
    if (has(CAPABILITIES.AUTH)) ns.auth = ['registerLoginMethod']
    if (has(CAPABILITIES.TEAMS)) ns.teams = ['onTeamOpen', 'registerTeamAction', 'list']
    if (has(CAPABILITIES.STORAGE)) ns.storage = ['get', 'set', 'delete', 'keys']
    if (has(CAPABILITIES.FS_READ)) ns.fs = (ns.fs || []).concat(['read', 'list'])
    if (has(CAPABILITIES.FS_WRITE)) ns.fs = (ns.fs || []).concat(['write'])
    if (caps.some((c) => typeof c === 'string' && c.startsWith('net:'))) ns.net = ['fetch']
    // ui sub-namespaces
    const ui = []
    if (has(CAPABILITIES.UI)) ui.push('panel', 'navItem', 'toolbarItem', 'statusItem', 'notify', 'modal')
    if (has(CAPABILITIES.SECTIONS)) ui.push('sidebarSection')
    if (has(CAPABILITIES.VIEWS)) ui.push('view', 'settingsSection')
    if (has(CAPABILITIES.CLIPBOARD)) ui.push('clipboardWrite', 'clipboardRead')
    if (ui.length) ns.ui = ui
    // events are always available (no capability)
    ns.events = ['on']
    return {
      apiVersion: API_VERSION,
      pluginId: rec.id,
      capabilities: caps.slice(),
      namespaces: ns
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Namespace an id/key under the plugin id (idempotent). */
  _namespaceId(rec, raw) {
    const base = typeof raw === 'string' && raw ? raw : `anon-${this._seq()}`
    return base.startsWith(`${rec.id}.`) ? base : `${rec.id}.${base}`
  }

  _ownsId(rec, id) {
    return typeof id === 'string' && id.startsWith(`${rec.id}.`)
  }

  /**
   * Resolve a command id a plugin asked to `execute`. A bare id (`doThing`) is
   * its own → prefixed. An already-fully-qualified id (`com.other.x`) is taken
   * verbatim so ownership is checked against the REAL owner (preventing a foreign
   * id from being smuggled past `_ownsId` by double-prefixing).
   */
  _resolveCommandTarget(rec, raw) {
    if (typeof raw !== 'string' || !raw) return this._namespaceId(rec, raw)
    if (raw.startsWith(`${rec.id}.`)) return raw
    // Looks reverse-DNS qualified (contains a dot and a known plugin owns it,
    // or it simply isn't this plugin's own bare id) → treat as foreign verbatim.
    if (raw.includes('.') && this._looksQualified(raw)) return raw
    return `${rec.id}.${raw}`
  }

  /** Heuristic: does `id` look like a fully-qualified `<plugin>.<name>` id? */
  _looksQualified(id) {
    // A registered command from any plugin, or a reverse-DNS-shaped prefix.
    for (const other of this.plugins.keys()) {
      if (id.startsWith(`${other}.`)) return true
    }
    // Fallback shape check: at least two dot-segments before the command name.
    return /^[a-z0-9]+(\.[a-z0-9-]+){2,}$/.test(id)
  }

  /** Monotonic integer for synthesized keys (NOT for RPC ids — those live in rpc). */
  _seq() {
    this.__seq = (this.__seq || 0) + 1
    return this.__seq
  }

  /** Hand the plugin an opaque integer token mapping to a Disposable for ctx.dispose(). */
  _issueDisposable(rec, disposable) {
    const token = this._seq()
    rec.callbacks.set(`disp:${token}`, disposable)
    return token
  }

  // ── controller (returned from initPluginSystem) ─────────────────────────────

  _buildController() {
    const self = this
    return {
      /** PluginRecord summaries for the manager/lab UI. */
      list() {
        return Array.from(self.plugins.values(), (rec) => ({
          id: rec.id,
          name: rec.manifest.name,
          version: rec.manifest.version,
          enabled: rec.state === PluginState.ENABLED,
          state: rec.state,
          error: rec.error,
          source: rec.source,
          capabilities: rec.manifest.capabilities.slice(),
          decision: rec.decision,
          grant: buildGrantDecision(rec.manifest, rec.decision),
          contributes: rec.manifest.contributes
        }))
      },
      enable(id) { return self.enable(id) },
      disable(id) { return self.disable(id) },
      reload(id) { return self.reload(id) },
      /** Re-pull from main (after install/uninstall). */
      async refresh() { await self._discover(); return self._controller.list() },
      /** Record a user's grant decision for a plugin's sensitive capabilities. */
      async setGrantDecision(id, decision) {
        const rec = self.plugins.get(id)
        if (!rec) return { ok: false, error: 'unknown plugin' }
        if (!Object.values(GrantDecision).includes(decision)) return { ok: false, error: 'bad decision' }
        rec.decision = decision
        await self._persistDecision(id, decision)
        return { ok: true }
      },
      /** The live registry view, for the lab's RPC console / debug. */
      registrySnapshot() {
        const out = {}
        for (const [name] of self.registry.surfaces) out[name] = self.registry.list(name)
        return out
      },
      /** Re-point editor helpers across a CM6 rebuild (called from rebindEditor). */
      setEditorView(view) {
        try {
          const ed = self._adapters && self._adapters.editor
          if (ed && typeof ed.setView === 'function') ed.setView(view)
        } catch (e) { console.warn('[plugins] setEditorView failed:', e) }
      },
      /** Stable plugin-contributed CM6 extension array for rebindEditor to spread. */
      getEditorExtensions() {
        try {
          const ed = self._adapters && self._adapters.editor
          if (ed && typeof ed.getEditorExtension === 'function') {
            const ext = ed.getEditorExtension()
            return Array.isArray(ext) ? ext : [ext]
          }
        } catch (e) { console.warn('[plugins] getEditorExtensions failed:', e) }
        return []
      },
      dispose() { return self.dispose() }
    }
  }

  /** Full teardown: deactivate + dispose every plugin, drop the registry. */
  async dispose() {
    if (this.disposed) return
    this.disposed = true
    const ids = Array.from(this.plugins.keys())
    await Promise.all(ids.map((id) => this.disable(id, { keepEnabledFlag: true }).catch(() => {})))
    this.registry = new Registry()
    this.initialized = false
  }
}

// ── shared helpers ───────────────────────────────────────────────────────────

/** Run a fn, swallow throws, return its value or undefined. */
function safeCall(fn) {
  try { return fn() } catch (e) {
    console.warn('[plugins] host operation threw (suppressed):', e && e.message ? e.message : e)
    return undefined
  }
}

/** Build a wire-shaped error object the sandbox turns into an `error` reply. */
function makeRpcError(code, message, data) {
  const err = new Error(message || code)
  err.code = code
  if (data !== undefined) err.data = data
  return err
}

// ── singleton + public entry ─────────────────────────────────────────────────

/** The live host singleton (the lab / manager UI reach it directly). */
export const PluginHost = new PluginHostClass()

/**
 * THE ONE entry point `main.js` calls (§6). Initializes the host with the host
 * hooks and returns the controller `{ list, enable, disable, reload, dispose, … }`.
 * Idempotent and defensive: never throws out of this boundary.
 *
 * @param {object} hostHooks  the §6 contract object provided by main.js
 * @returns {Promise<object>} the controller
 */
export async function initPluginSystem(hostHooks) {
  try {
    return await PluginHost.init(hostHooks)
  } catch (e) {
    console.error('[plugins] initPluginSystem failed; subsystem disabled:', e)
    // Return an inert controller so callers never crash on a failed init.
    return {
      list: () => [],
      enable: async () => ({ ok: false, error: 'plugin system unavailable' }),
      disable: async () => ({ ok: false, error: 'plugin system unavailable' }),
      reload: async () => ({ ok: false, error: 'plugin system unavailable' }),
      refresh: async () => [],
      setGrantDecision: async () => ({ ok: false, error: 'plugin system unavailable' }),
      registrySnapshot: () => ({}),
      setEditorView: () => {},
      getEditorExtensions: () => [],
      dispose: () => {}
    }
  }
}

export default initPluginSystem
