/**
 * Plugin Studio — main-side AgentProvider registry.
 *
 * FROZEN CONTRACT (docs/PLUGIN_STUDIO_CONTRACT.md §5.1):
 *   Exports `listProviders(): AgentProvider[]` and `getProvider(id): AgentProvider|null`.
 *   Aggregates the CLI + external providers. (This is the MAIN-side registry only;
 *   the renderer-side `kind:'api'` built-in loop lives under the renderer and is
 *   aggregated by studio-manager / the renderer view — §4.)
 *
 * Also exports `detectAll()` → the availability list studio:agent-detect uses for
 * the CLI/external homes (the renderer adds its `kind:'api'` provider separately).
 *
 * The CLI providers need the electron `app` to discover binaries (resolveClaudeBin
 * / resolveGeminiBin use the home dir). studio-manager.js calls `configure({ app })`
 * once at registration; `listProviders`/`getProvider`/`detectAll` also accept an
 * optional `{ app }` override so they remain pure if called directly.
 *
 * Defensive: providers are constructed lazily and memoized; a provider that throws
 * during detect() is reported `available:false` (never crashes the registrar).
 */

import { createClaudeCodeProvider } from './claude-code.js'
import { createGeminiCliProvider } from './gemini-cli.js'
import { createGenericCliProvider } from './generic-cli.js'
import { createExternalProvider } from './external.js'

// Module-level app handle, set once by studio-manager via configure().
let _app = null

// Memoized provider instances, keyed by the app handle they were built with so a
// later configure() with a different app rebuilds them.
let _cacheKey = null
let _cache = null

export function configure({ app } = {}) {
  if (app) _app = app
  // Invalidate the cache so providers pick up the new app.
  _cacheKey = null
  _cache = null
}

function buildAll(app) {
  return [
    createClaudeCodeProvider({ app }),
    createGeminiCliProvider({ app }),
    createGenericCliProvider(),
    createExternalProvider(),
  ]
}

/**
 * @param {{ app?: any }} [opts]
 * @returns {Array<object>} the AgentProvider instances (main-side: cli + external)
 */
export function listProviders(opts = {}) {
  const app = opts.app || _app
  if (_cache && _cacheKey === app) return _cache
  let built
  try {
    built = buildAll(app)
  } catch (_) {
    built = []
  }
  _cache = built
  _cacheKey = app
  return built
}

/**
 * @param {string} id
 * @param {{ app?: any }} [opts]
 * @returns {object|null} the matching AgentProvider, or null
 */
export function getProvider(id, opts = {}) {
  if (!id) return null
  const list = listProviders(opts)
  for (const p of list) {
    if (p && p.id === id) return p
  }
  return null
}

/**
 * Run detect() on every main-side provider and return the availability rows
 * studio:agent-detect surfaces. Never throws; a provider whose detect() rejects
 * is reported available:false with the reason.
 *
 * @param {{ app?: any }} [opts]
 * @returns {Promise<Array<{ id, label, kind, available:boolean, version?:string, reason?:string }>>}
 */
export async function detectAll(opts = {}) {
  const list = listProviders(opts)
  const rows = await Promise.all(list.map(async (p) => {
    const base = { id: p?.id, label: p?.label, kind: p?.kind }
    if (!p || typeof p.detect !== 'function') {
      return { ...base, available: false, reason: 'provider has no detect()' }
    }
    try {
      const r = await p.detect()
      return {
        ...base,
        available: !!(r && r.available),
        version: r && r.version ? String(r.version) : undefined,
        reason: r && r.reason ? String(r.reason) : undefined,
      }
    } catch (e) {
      return { ...base, available: false, reason: e?.message || 'detect failed' }
    }
  }))
  return rows
}

export default { configure, listProviders, getProvider, detectAll }
