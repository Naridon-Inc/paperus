/**
 * contrib-ai.js — AI adapter (FROZEN CONTRACT v1, §5.3 / §6).
 *
 * Bridges `ctx.ai.*`. `ctx.ai.complete/embed` run HOST-SIDE through the user's
 * existing rag-engine backend (`_generateApi`/`_generateClaudeCode`/local) — the
 * plugin NEVER sees the API key, endpoint, or model, only streamed tokens /
 * vectors. `ctx.ai.registerProvider(...)` registers into the rag-engine
 * generators map (the refactored 3-way if/else → `RAGEngine.registerProvider`).
 *
 * A provider whose `generate` does network egress MUST also declare `net:<host>`
 * and fetch via `ctx.net.fetch` (gated) — not ambient fetch. This adapter does
 * not police that (it can't see inside the sandbox); the net seam (main) does.
 *
 * AI streams abort after AI_STREAM_IDLE_MS (30s) between tokens (§4.4 / §8.8).
 */

import * as Caps from './capabilities.js'

const C = Caps.CAPABILITIES || {}
const CAP_AI = C.AI || 'ai'

const AI_STREAM_IDLE_MS = 30000

function hasCap(manifest, cap) {
  try {
    if (typeof Caps.requireCapability === 'function') {
      try { Caps.requireCapability(manifest, cap); return true } catch { return false }
    }
    const list = (manifest && Array.isArray(manifest.capabilities)) ? manifest.capabilities : []
    return list.includes(cap)
  } catch { return false }
}

function parseNet(str) {
  if (typeof Caps.parseNetCapability === 'function') {
    try { return Caps.parseNetCapability(str) } catch { return null }
  }
  const m = /^net:(\*\.)?([a-z0-9.-]+)$/i.exec(String(str || ''))
  if (!m) return null
  if (str === 'net:*') return null
  return { host: m[2], wildcard: !!m[1] }
}

/** Does the manifest declare ANY net:<host> capability? (provider egress hint) */
function declaresNet(manifest) {
  const list = (manifest && Array.isArray(manifest.capabilities)) ? manifest.capabilities : []
  return list.some(c => typeof c === 'string' && c.startsWith('net:') && parseNet(c))
}

/**
 * Initialize the AI adapter.
 * @param {object} hostHooks the §6 host hooks bag (expects hostHooks.ai.*).
 * @returns {object} adapter API
 */
export function initAIAdapter(hostHooks = {}) {
  const ai = hostHooks.ai || {}
  const registered = new Map() // providerId → { manifest }

  return {
    /**
     * ctx.ai.complete — capability `ai`. Runs host-side against the current
     * rag-engine backend; streams tokens back via `onToken` (callback bridge).
     * Resolves { text } on completion. Aborts on idle > AI_STREAM_IDLE_MS.
     *
     * @param {object} manifest
     * @param {object} opts { system?, prompt, citations? }
     * @param {(t:string)=>void} [onToken] streamed-token sink (bridge token)
     * @returns {Promise<{text:string}>}
     */
    async complete(manifest, opts, onToken) {
      if (!hasCap(manifest, CAP_AI)) {
        return { text: '', error: 'CAPABILITY_DENIED' }
      }
      if (!opts || typeof opts.prompt !== 'string') {
        return { text: '', error: 'BAD_PARAMS' }
      }
      if (typeof ai.complete !== 'function') {
        return { text: '', error: 'UNSUPPORTED' }
      }

      // Idle-abort wrapper: if no token arrives within AI_STREAM_IDLE_MS, reject.
      let idleTimer = null
      let aborted = false
      const armIdle = (reject) => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => { aborted = true; reject(new Error('AI stream idle timeout')) }, AI_STREAM_IDLE_MS)
      }

      try {
        const result = await new Promise((resolve, reject) => {
          armIdle(reject)
          const wrappedOnToken = (t) => {
            if (aborted) return
            armIdle(reject)
            if (typeof onToken === 'function') {
              try { onToken(String(t == null ? '' : t)) } catch (e) { console.warn('[contrib-ai] onToken failed:', e) }
            }
          }
          // The host's ai.complete signature: ({ system, prompt, onToken, citations }) → Promise<{text}>
          Promise.resolve(ai.complete({
            system: typeof opts.system === 'string' ? opts.system : '',
            prompt: opts.prompt,
            onToken: wrappedOnToken,
            citations: Array.isArray(opts.citations) ? opts.citations : [],
          }))
            .then((res) => resolve(res))
            .catch(reject)
        })
        return { text: (result && typeof result.text === 'string') ? result.text : '' }
      } catch (e) {
        return { text: '', error: (e && e.message) || String(e) }
      } finally {
        if (idleTimer) clearTimeout(idleTimer)
      }
    },

    /**
     * ctx.ai.embed — capability `ai`. Host-side embedding. The plugin gets only
     * vectors, never the key/endpoint.
     */
    async embed(manifest, textOrArr) {
      if (!hasCap(manifest, CAP_AI)) return { error: 'CAPABILITY_DENIED' }
      if (typeof ai.embed !== 'function') return { error: 'UNSUPPORTED' }
      try {
        return await ai.embed(textOrArr)
      } catch (e) {
        return { error: (e && e.message) || String(e) }
      }
    },

    /**
     * ctx.ai.registerProvider — capability `ai`. Registers a provider into the
     * rag-engine generators map. `generate` mirrors the rag-engine backend
     * signature: (system, prompt, onToken, onComplete, citations) → void.
     *
     * @param {object} manifest
     * @param {object} provider { id, label, icon?, retrievalMode?, ... }
     * @param {object} bridge host-mediated callbacks:
     *        bridge.generate(system, prompt, onToken, onComplete, citations)
     *        bridge.configure()
     *        bridge.friendlyError(msg) → string
     * @returns {{dispose():void}}
     */
    registerProvider(manifest, provider, bridge) {
      if (!hasCap(manifest, CAP_AI)) return denied('registerProvider')
      if (!provider || typeof provider.id !== 'string' || typeof provider.label !== 'string') {
        // eslint-disable-next-line no-console
        console.warn('[contrib-ai] invalid provider descriptor; ignored')
        return noop()
      }
      const providerId = `${manifest.id}.${provider.id}`.replace(/[^a-z0-9_.-]/gi, '-').slice(0, 120)
      const retrievalMode = provider.retrievalMode === 'hybrid' ? 'hybrid' : 'tfidf'
      const needsNet = declaresNet(manifest)

      // The impl object the rag-engine generators map expects. The host invokes
      // `generate` when `aiMode === providerId`. We wrap with an idle-abort and
      // pure try/catch so a throwing provider degrades to a friendly error and
      // never breaks the chat.
      const impl = {
        id: providerId,
        label: String(provider.label).slice(0, 60),
        icon: typeof provider.icon === 'string' ? provider.icon : undefined,
        retrievalMode,
        // declares-net flag lets the host surface a "requests network" notice.
        needsNet,

        generate(systemPrompt, query, onToken, onComplete, citations) {
          if (!bridge || typeof bridge.generate !== 'function') {
            try { onToken('[plugin provider has no generate()]') } catch { /* ignore */ }
            if (onComplete) onComplete('', citations || [])
            return
          }
          let idleTimer = null
          let done = false
          const finish = (text, cits) => {
            if (done) return
            done = true
            if (idleTimer) clearTimeout(idleTimer)
            if (onComplete) { try { onComplete(text || '', cits || citations || []) } catch (e) { console.warn('[contrib-ai] onComplete failed:', e) } }
          }
          const armIdle = () => {
            if (idleTimer) clearTimeout(idleTimer)
            idleTimer = setTimeout(() => {
              if (done) return
              try { onToken('\n\n_[provider timed out]_') } catch { /* ignore */ }
              finish('', citations)
            }, AI_STREAM_IDLE_MS)
          }
          const wrappedToken = (t) => {
            if (done) return
            armIdle()
            try { onToken(String(t == null ? '' : t)) } catch (e) { console.warn('[contrib-ai] provider onToken failed:', e) }
          }
          armIdle()
          try {
            const ret = bridge.generate(
              typeof systemPrompt === 'string' ? systemPrompt : '',
              typeof query === 'string' ? query : '',
              wrappedToken,
              (text) => finish(text, citations),
              Array.isArray(citations) ? citations : [],
            )
            // If the bridge returns a promise, settle on it too.
            if (ret && typeof ret.then === 'function') {
              ret.then((text) => finish(typeof text === 'string' ? text : '', citations))
                .catch((e) => {
                  try { onToken(`\n\n_[provider error: ${(e && e.message) || e}]_`) } catch { /* ignore */ }
                  finish('', citations)
                })
            }
          } catch (e) {
            try { onToken(`\n\n_[provider error: ${(e && e.message) || e}]_`) } catch { /* ignore */ }
            finish('', citations)
          }
        },

        configure() {
          if (bridge && typeof bridge.configure === 'function') {
            try { bridge.configure() } catch (e) { console.warn('[contrib-ai] provider configure failed:', e) }
          }
        },

        friendlyError(msg) {
          if (bridge && typeof bridge.friendlyError === 'function') {
            try { const out = bridge.friendlyError(msg); if (typeof out === 'string') return out } catch { /* fall through */ }
          }
          return `The "${impl.label}" AI provider couldn't complete the request.${msg ? `\n\n_${msg}_` : ''}`
        },
      }

      if (typeof ai.registerProvider === 'function') {
        try { ai.registerProvider(providerId, impl) } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[contrib-ai] host registerProvider failed:', e)
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn('[contrib-ai] host did not provide ai.registerProvider; provider inert')
      }
      registered.set(providerId, { manifest })

      return {
        dispose() {
          registered.delete(providerId)
          if (typeof ai.unregisterProvider === 'function') {
            try { ai.unregisterProvider(providerId) } catch { /* ignore */ }
          }
        },
      }
    },

    /** Dispose every provider registered through this adapter instance. */
    disposeAll() {
      for (const id of Array.from(registered.keys())) {
        if (typeof ai.unregisterProvider === 'function') {
          try { ai.unregisterProvider(id) } catch { /* ignore */ }
        }
      }
      registered.clear()
    },
  }
}

function denied(method) {
  // eslint-disable-next-line no-console
  console.warn(`[contrib-ai] CAPABILITY_DENIED for ${method}`)
  return noop()
}
function noop() { return { dispose() {} } }
