/**
 * @notionless/plugin-sdk — authoring helper for Notionless plugins.
 *
 * FROZEN CONTRACT v1 (apiVersion "1"). See docs/PLUGIN_API_CONTRACT.md.
 *
 * This module is intentionally tiny. A Notionless plugin is a plain ESM module
 * whose default export is an object with `activate(ctx)` (and an optional
 * `deactivate()`). The host (`plugin-host.js` + `sandbox-runtime.js`) is what
 * actually drives that object — `definePlugin` exists ONLY so authors get a
 * stable shape and editor IntelliSense via `types.d.ts`. It is a pure identity
 * helper with light defensive validation; it never imports anything from the
 * host realm and runs unchanged inside the sandbox.
 *
 * Usage:
 *   import { definePlugin } from '@notionless/plugin-sdk'
 *   export default definePlugin({
 *     async activate(ctx) { ... },
 *     async deactivate() { ... }
 *   })
 */

/** The apiVersion this SDK targets. The host refuses to load a mismatch. */
export const API_VERSION = '1'

/**
 * Frozen capability constants — mirror §3 of the contract so authors can refer
 * to them symbolically instead of stringly. `net:<host>` is dynamic and not
 * listed here; build those with `netCapability(host)`.
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
  CLIPBOARD: 'clipboard',
})

/**
 * Build a `net:<host>` capability string. `{ wildcard: true }` yields
 * `net:*.<host>`. Bare `net:*` is intentionally NOT constructible here — the
 * host rejects it as too broad.
 * @param {string} host
 * @param {{ wildcard?: boolean }} [opts]
 * @returns {string}
 */
export function netCapability(host, opts = {}) {
  if (typeof host !== 'string' || host.length === 0 || host === '*') {
    throw new Error('netCapability(host): host must be a non-empty, non-"*" string')
  }
  return opts.wildcard ? `net:*.${host}` : `net:${host}`
}

/**
 * Identity helper that defines a plugin. Returns the impl object unchanged
 * (after a light, non-throwing-in-production shape check) so the host can pick
 * up `{ activate, deactivate }` from the module's default export.
 *
 * @template T
 * @param {T & { activate: Function, deactivate?: Function }} impl
 * @returns {T}
 */
export function definePlugin(impl) {
  if (impl == null || typeof impl !== 'object') {
    throw new TypeError('definePlugin(impl): impl must be an object with an activate() method')
  }
  if (typeof impl.activate !== 'function') {
    throw new TypeError('definePlugin(impl): impl.activate must be a function')
  }
  if (impl.deactivate != null && typeof impl.deactivate !== 'function') {
    throw new TypeError('definePlugin(impl): impl.deactivate, if present, must be a function')
  }
  return impl
}

/**
 * Convenience builder for a vDOM element node (see §5.7). Purely a typing/ergonomic
 * aid — the host accepts the plain object shape directly, so this is optional.
 *
 * @param {string} tag
 * @param {Record<string, string>|null} [attrs]
 * @param {Array<object|string>|object|string} [children]
 * @returns {{ tag: string, attrs?: object, children?: any[] }}
 */
export function h(tag, attrs, children) {
  /** @type {{ tag: string, attrs?: object, children?: any[] }} */
  const node = { tag: String(tag) }
  if (attrs && typeof attrs === 'object') {
    // Split an optional `on` map (event-action bindings) from plain attrs so
    // authors can write h('button', { class: 'x', on: { click: 'do' } }).
    const { on, ...rest } = attrs
    if (Object.keys(rest).length) node.attrs = rest
    if (on && typeof on === 'object') node.on = on
  }
  if (children != null) {
    node.children = Array.isArray(children) ? children : [children]
  }
  return node
}

export default definePlugin
