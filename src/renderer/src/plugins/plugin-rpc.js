/**
 * plugin-rpc.js — Host side of the plugin wire (FROZEN CONTRACT §4).
 *
 * A transport-agnostic, typed `postMessage` JSON-RPC layer. The same envelope
 * shapes and id scheme are mirrored inside the sandbox by `sandbox-runtime.js`;
 * this module is the half that runs in the trusted host realm.
 *
 * Envelope types (exactly four — §4.1):
 *   request   { type:'request',  id, method, params }
 *   response  { type:'response', id, result }
 *   error     { type:'error',    id, error:{ code, message, data? } }
 *   event     { type:'event',    id, method, params }
 *
 * ID SCHEME (NORMATIVE — §4.3): each side owns ONE counter that starts at 0 and
 * increments by 1 per id. IDs are produced ONLY by `nextId()`. Never `Date.now()`,
 * never `performance.now()`, never `Math.random()`, never `crypto.randomUUID()`.
 * Request/response correlate by exact integer equality. `event` messages still
 * consume an id (for ordering/logging) but never expect a reply.
 *
 * This class is transport-agnostic: it takes a channel `{ post(msg), onMessage(cb) }`
 * (§4) so the same code drives a MessageChannel port, a Worker, or a test double.
 */

// ── Frozen constants (Appendix A) ───────────────────────────────────────────
export const RPC_TIMEOUT_MS = 8000 // default for plugin→host requests
export const ACTIVATE_TIMEOUT_MS = 5000
export const DEACTIVATE_TIMEOUT_MS = 2000
export const AI_STREAM_IDLE_MS = 30000

export const ENVELOPE_TYPES = Object.freeze({
  REQUEST: 'request',
  RESPONSE: 'response',
  ERROR: 'error',
  EVENT: 'event',
})

export const ERROR_CODES = Object.freeze({
  CAPABILITY_DENIED: 'CAPABILITY_DENIED',
  BAD_PARAMS: 'BAD_PARAMS',
  NOT_FOUND: 'NOT_FOUND',
  TIMEOUT: 'TIMEOUT',
  INTERNAL: 'INTERNAL',
  UNSUPPORTED_METHOD: 'UNSUPPORTED_METHOD',
  QUARANTINED: 'QUARANTINED',
  HOST_DISPOSED: 'HOST_DISPOSED',
})

const VALID_CODE_SET = new Set(Object.values(ERROR_CODES))

/**
 * A small typed error carrying a contract error `code` so it survives the wire
 * as `{ code, message, data? }`.
 */
export class RpcError extends Error {
  constructor(code, message, data) {
    super(message || code || 'RPC error')
    this.name = 'RpcError'
    this.code = VALID_CODE_SET.has(code) ? code : ERROR_CODES.INTERNAL
    if (data !== undefined) this.data = data
  }
}

/** Coerce anything thrown into the wire `{ code, message, data? }` shape. */
export function toWireError(err) {
  if (err instanceof RpcError) {
    const out = { code: err.code, message: err.message }
    if (err.data !== undefined) out.data = err.data
    return out
  }
  if (err && typeof err === 'object') {
    const code = VALID_CODE_SET.has(err.code) ? err.code : ERROR_CODES.INTERNAL
    const message = typeof err.message === 'string' ? err.message : String(err)
    const out = { code, message }
    if (err.data !== undefined) {
      try {
        // Only carry JSON-serializable data across the boundary.
        JSON.stringify(err.data)
        out.data = err.data
      } catch (_e) { /* drop non-serializable data */ }
    }
    return out
  }
  return { code: ERROR_CODES.INTERNAL, message: String(err) }
}

/**
 * PluginRpc — drives one channel (one sandbox) from the host side.
 *
 *   const rpc = new PluginRpc({ post, onMessage }, {
 *     handlers: { 'host.editor.insert': async (params) => ({ ok: true }) },
 *     onUnhandled: (method, params) => { ... },
 *     label: 'com.acme.toolkit',
 *   })
 *   await rpc.request('plugin.activate', { ctxDescriptor })
 *   rpc.notify('host.event.note:open', { docId })
 *   rpc.dispose()
 */
export class PluginRpc {
  /**
   * @param {{ post: (msg:any)=>void, onMessage: (cb:(msg:any)=>void)=>(void|(()=>void)) }} channel
   * @param {{
   *   handlers?: Record<string, (params:any)=>any|Promise<any>>,
   *   onUnhandled?: (method:string, params:any)=>any|Promise<any>,
   *   onEvent?: (method:string, params:any, id:number)=>void,
   *   label?: string,
   * }} [opts]
   */
  constructor(channel, opts = {}) {
    if (!channel || typeof channel.post !== 'function' || typeof channel.onMessage !== 'function') {
      throw new Error('[PluginRpc] channel must implement { post(msg), onMessage(cb) }')
    }
    this._channel = channel
    this._label = opts.label || 'plugin'
    // Inbound request dispatch table (plugin→host requests).
    this._handlers = new Map()
    if (opts.handlers) {
      for (const [method, fn] of Object.entries(opts.handlers)) {
        if (typeof fn === 'function') this._handlers.set(method, fn)
      }
    }
    this._onUnhandled = typeof opts.onUnhandled === 'function' ? opts.onUnhandled : null
    this._onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null

    // Pending host→plugin requests awaiting a response/error.
    // Map<id, { resolve, reject, timer }>
    this._pending = new Map()

    // Per-side monotonic integer id counter. NEVER time/random based.
    this._id = 0

    this._disposed = false

    // Subscribe to inbound messages. onMessage may return an unsubscribe fn.
    this._unsubscribe = this._channel.onMessage((msg) => {
      try {
        this._receive(msg)
      } catch (e) {
        // The host never breaks on a malformed inbound message.
        console.warn(`[PluginRpc:${this._label}] inbound dispatch failed:`, e)
      }
    }) || null
  }

  /** Monotonic integer id: 1,2,3,… Never reset within this instance's lifetime. */
  _nextId() {
    this._id += 1
    return this._id
  }

  /** Register/replace an inbound request handler for `method`. */
  setHandler(method, fn) {
    if (typeof fn === 'function') this._handlers.set(method, fn)
    else this._handlers.delete(method)
  }

  /**
   * Send a request and await its response.
   * @param {string} method
   * @param {any} params  (JSON-serializable)
   * @param {{ timeout?: number }} [options]
   * @returns {Promise<any>}
   */
  request(method, params, options = {}) {
    if (this._disposed) {
      return Promise.reject(new RpcError(ERROR_CODES.HOST_DISPOSED, 'RPC channel disposed'))
    }
    const id = this._nextId()
    const timeout = Number.isFinite(options.timeout) ? options.timeout : RPC_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Reap on timeout: reject and drop. A late response for this id is ignored.
        const entry = this._pending.get(id)
        if (entry) {
          this._pending.delete(id)
          entry.reject(new RpcError(
            ERROR_CODES.TIMEOUT,
            `RPC '${method}' (id ${id}) timed out after ${timeout}ms`,
          ))
        }
      }, timeout)
      // Allow Node-style unref so a stray timer never keeps a process alive (no-op in browser).
      if (timer && typeof timer.unref === 'function') timer.unref()

      this._pending.set(id, { resolve, reject, timer, method })
      this._safePost({
        type: ENVELOPE_TYPES.REQUEST, id, method, params: params === undefined ? null : params,
      })
    })
  }

  /**
   * Fire-and-forget event. Consumes an id (for ordering/logging) but no reply.
   * @param {string} method
   * @param {any} params
   * @returns {number} the id used
   */
  notify(method, params) {
    if (this._disposed) return -1
    const id = this._nextId()
    this._safePost({
      type: ENVELOPE_TYPES.EVENT, id, method, params: params === undefined ? null : params,
    })
    return id
  }

  _safePost(msg) {
    try {
      this._channel.post(msg)
    } catch (e) {
      console.warn(`[PluginRpc:${this._label}] post failed:`, e)
    }
  }

  /** Inbound message router. */
  _receive(msg) {
    if (!msg || typeof msg !== 'object') return
    const { type } = msg
    switch (type) {
      case ENVELOPE_TYPES.RESPONSE:
        this._resolvePending(msg.id, msg.result, null)
        break
      case ENVELOPE_TYPES.ERROR:
        this._resolvePending(msg.id, null, msg.error)
        break
      case ENVELOPE_TYPES.REQUEST:
        this._handleInboundRequest(msg)
        break
      case ENVELOPE_TYPES.EVENT:
        this._handleInboundEvent(msg)
        break
      default:
        // Unknown envelope type: ignore (forward-compatible).
        break
    }
  }

  _resolvePending(id, result, error) {
    if (typeof id !== 'number') return
    const entry = this._pending.get(id)
    if (!entry) return // late/duplicate/reaped — drop silently
    this._pending.delete(id)
    if (entry.timer) clearTimeout(entry.timer)
    if (error) {
      const code = error && VALID_CODE_SET.has(error.code) ? error.code : ERROR_CODES.INTERNAL
      entry.reject(new RpcError(code, (error && error.message) || 'plugin error', error && error.data))
    } else {
      entry.resolve(result)
    }
  }

  /** A plugin→host request: run a handler, reply with response or error. */
  async _handleInboundRequest(msg) {
    const { id, method } = msg
    const params = msg.params
    let handler = this._handlers.get(method)
    if (!handler && this._onUnhandled) {
      handler = (p) => this._onUnhandled(method, p)
    }
    if (!handler) {
      this._reply(id, null, new RpcError(
        ERROR_CODES.UNSUPPORTED_METHOD, `no handler for method '${method}'`,
      ))
      return
    }
    try {
      const result = await handler(params, method)
      this._reply(id, result === undefined ? null : result, null)
    } catch (e) {
      this._reply(id, null, e)
    }
  }

  _handleInboundEvent(msg) {
    if (!this._onEvent) return
    try {
      this._onEvent(msg.method, msg.params, msg.id)
    } catch (e) {
      console.warn(`[PluginRpc:${this._label}] event handler threw:`, e)
    }
  }

  _reply(id, result, error) {
    if (this._disposed) return
    if (error) {
      this._safePost({ type: ENVELOPE_TYPES.ERROR, id, error: toWireError(error) })
    } else {
      this._safePost({ type: ENVELOPE_TYPES.RESPONSE, id, result })
    }
  }

  /** True if there are still in-flight requests. */
  get pendingCount() {
    return this._pending.size
  }

  /**
   * Tear down: reject all pending with HOST_DISPOSED, unsubscribe, stop accepting.
   * Idempotent.
   */
  dispose(reason) {
    if (this._disposed) return
    this._disposed = true
    const err = new RpcError(
      ERROR_CODES.HOST_DISPOSED,
      typeof reason === 'string' ? reason : 'RPC channel disposed',
    )
    for (const [, entry] of this._pending) {
      if (entry.timer) clearTimeout(entry.timer)
      try { entry.reject(err) } catch (_e) { /* ignore */ }
    }
    this._pending.clear()
    if (typeof this._unsubscribe === 'function') {
      try { this._unsubscribe() } catch (_e) { /* ignore */ }
    }
    this._unsubscribe = null
  }
}

export default PluginRpc
