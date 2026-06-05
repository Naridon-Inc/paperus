/**
 * contrib-brain.js — Brain-tools adapter (ADDITIVE to FROZEN CONTRACT v1, Phase 4).
 *
 * Bridges `ctx.brain.registerTool(...)`. A plugin with the `tools` capability
 * contributes tools the Company Brain's agent loop can call. Each tool's handler
 * runs INSIDE the plugin sandbox: we register an `impl.handler(args)` into the
 * host's `hostHooks.brain.registerTool(toolId, impl)` (which lands in the
 * `RAGEngine.toolRegistry` the loop already reads), and that handler bridges the
 * call into the sandbox via `bridge.run(args)` — the SAME callback-token pattern
 * `contrib-ai`'s `bridge.generate` uses. The Brain never sees the plugin's code,
 * only the structured result the tool returns.
 *
 * A tool whose handler does network egress MUST also declare `net:<host>` and
 * fetch via `ctx.net.fetch` (gated) — not ambient fetch. This adapter does not
 * police that (it can't see inside the sandbox); the net seam (main) does. `tools`
 * is low-risk alone; egress requires the separate, sensitive `net:<host>` grant.
 *
 * Tool calls abort after AI_STREAM_IDLE_MS (30s) of no result, and a throwing or
 * slow tool degrades to `{ error }` and never breaks the chat (§4.4 / §8.8).
 */

import * as Caps from './capabilities.js'

const C = Caps.CAPABILITIES || {}
const CAP_TOOLS = C.TOOLS || 'tools'

// Mirror contrib-ai's idle budget: a tool that produces no result within this
// window is aborted so a hung sandbox can't wedge the agent loop.
const AI_STREAM_IDLE_MS = 30000

// The RAGEngine's registerTool validates id as ^[a-z][a-z0-9_]{1,48}$ (no dots /
// dashes) and caps the name length. Plugin ids are reverse-DNS (dots + dashes),
// so we cannot use them verbatim: we sanitize the namespaced id to that charset
// and length, which also prevents a plugin from shadowing a built-in tool.
const TOOL_ID_RE = /^[a-z][a-z0-9_]{1,48}$/i
const MAX_TOOL_ID = 49

function hasCap(manifest, cap) {
  try {
    if (typeof Caps.requireCapability === 'function') {
      try { Caps.requireCapability(manifest, cap); return true } catch { return false }
    }
    const list = (manifest && Array.isArray(manifest.capabilities)) ? manifest.capabilities : []
    return list.includes(cap)
  } catch { return false }
}

/** Does the manifest declare ANY net:<host> capability? (egress hint for the UI). */
function declaresNet(manifest) {
  const list = (manifest && Array.isArray(manifest.capabilities)) ? manifest.capabilities : []
  return list.some((c) => typeof c === 'string' && c.startsWith('net:') && c !== 'net:*')
}

/**
 * Build the Brain-registry tool id, namespaced under the plugin so two plugins
 * (or a plugin and a built-in) never collide. Format `<pluginId>__<toolId>`,
 * sanitized to the RAGEngine id charset/length. Returns null if nothing usable
 * survives sanitization.
 */
function namespaceToolId(manifest, rawId) {
  const pid = (manifest && typeof manifest.id === 'string') ? manifest.id : ''
  const base = `${pid}__${String(rawId == null ? '' : rawId)}`
  // Collapse anything outside the registry charset to `_`, trim leading non-alpha
  // (the regex requires a leading letter), and cap the length.
  let id = base.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+/, '')
  id = id.slice(0, MAX_TOOL_ID)
  if (!TOOL_ID_RE.test(id)) return null
  return id
}

/**
 * Initialize the Brain-tools adapter.
 * @param {object} hostHooks the §6 host hooks bag (expects hostHooks.brain.*).
 * @returns {object} adapter API
 */
export function initBrainAdapter(hostHooks = {}) {
  const brain = hostHooks.brain || {}
  const registered = new Map() // namespacedToolId → { manifest }

  return {
    /**
     * ctx.brain.registerTool — capability `tools`. Registers a tool into the
     * Company Brain's registry. The tool's handler bridges into the sandbox via
     * `bridge.run(args)`; we wrap it with an idle-abort and pure try/catch so a
     * throwing or slow tool degrades to `{ error }` and never breaks the chat.
     *
     * @param {object} manifest
     * @param {object} descriptor { id, description, parameters? }
     * @param {object} bridge host-mediated callback: bridge.run(args) → Promise<any>
     * @returns {{dispose():void}}
     */
    registerTool(manifest, descriptor, bridge) {
      if (!hasCap(manifest, CAP_TOOLS)) return denied('registerTool')
      if (!descriptor || typeof descriptor.id !== 'string'
        || typeof descriptor.description !== 'string' || !descriptor.description.trim()) {
        // eslint-disable-next-line no-console
        console.warn('[contrib-brain] invalid tool descriptor; ignored')
        return noop()
      }
      const toolId = namespaceToolId(manifest, descriptor.id)
      if (!toolId) {
        // eslint-disable-next-line no-console
        console.warn(`[contrib-brain] tool id '${descriptor.id}' is unusable after namespacing; ignored`)
        return noop()
      }
      // JSON-schema-ish params are advisory hints for the prompt catalogue; keep
      // only a plain object (the Brain renders it, never executes it).
      const parameters = (descriptor.parameters && typeof descriptor.parameters === 'object'
        && !Array.isArray(descriptor.parameters)) ? descriptor.parameters : {}
      const needsNet = declaresNet(manifest)

      // The impl object the RAGEngine.toolRegistry expects. The Brain invokes
      // `handler(args)` when its loop calls this tool. We bridge into the sandbox
      // and treat the sandbox's return value as UNTRUSTED external data.
      const impl = {
        id: toolId,
        description: String(descriptor.description).trim().slice(0, 400),
        parameters,
        // declares-net flag lets the host surface a "requests network" notice.
        needsNet,

        async handler(args) {
          if (!bridge || typeof bridge.run !== 'function') {
            return { error: 'plugin tool has no run() bridge' }
          }
          // Idle-abort: if the sandbox produces no result within the budget, we
          // resolve to an error rather than hang the agent loop.
          let idleTimer = null
          try {
            const result = await new Promise((resolve) => {
              idleTimer = setTimeout(() => {
                resolve({ error: 'plugin tool timed out' })
              }, AI_STREAM_IDLE_MS)
              Promise.resolve(bridge.run(args))
                .then((res) => resolve(res))
                .catch((e) => resolve({ error: (e && e.message) || String(e) }))
            })
            // Never let a non-serializable / throwing result escape: tool output
            // is data the Brain relays into the prompt, so coerce defensively.
            return (result === undefined || result === null) ? {} : result
          } catch (e) {
            return { error: (e && e.message) || String(e) }
          } finally {
            if (idleTimer) clearTimeout(idleTimer)
          }
        },
      }

      if (typeof brain.registerTool === 'function') {
        try { brain.registerTool(toolId, impl) } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[contrib-brain] host registerTool failed:', e)
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn('[contrib-brain] host did not provide brain.registerTool; tool inert')
      }
      registered.set(toolId, { manifest })

      return {
        dispose() {
          registered.delete(toolId)
          if (typeof brain.unregisterTool === 'function') {
            try { brain.unregisterTool(toolId) } catch { /* ignore */ }
          }
        },
      }
    },

    /** Dispose every tool registered through this adapter instance. */
    disposeAll() {
      for (const id of Array.from(registered.keys())) {
        if (typeof brain.unregisterTool === 'function') {
          try { brain.unregisterTool(id) } catch { /* ignore */ }
        }
      }
      registered.clear()
    },
  }
}

function denied(method) {
  // eslint-disable-next-line no-console
  console.warn(`[contrib-brain] CAPABILITY_DENIED for ${method}`)
  return noop()
}
function noop() { return { dispose() {} } }
