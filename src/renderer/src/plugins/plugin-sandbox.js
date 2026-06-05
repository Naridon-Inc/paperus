/**
 * plugin-sandbox.js — host-side iframe lifecycle (FROZEN CONTRACT §1.1, §4, §8).
 *
 * One `PluginSandbox` instance per loaded plugin. It:
 *   - creates an `<iframe sandbox="allow-scripts">` (NO allow-same-origin, NO
 *     allow-popups, NO allow-top-navigation) ⇒ a unique opaque origin that cannot
 *     reach `window.parent.api`, host cookies, or host storage (§8.1). Hidden
 *     (`display:none`), appended to `document.body`.
 *   - writes the bootstrap `srcdoc` (hardened `sandbox-runtime.js` + the plugin
 *     entry as a data: module) so the plugin has NO `window.api`, NO `require`,
 *     NO ambient `fetch`/`WebSocket` (§8.2).
 *   - bridges via a transferred `MessageChannel` port + `PluginRpc`.
 *   - drives `plugin.activate` / `plugin.deactivate` with the §4.4 timeouts and a
 *     hard kill (remove iframe) on misbehavior → QUARANTINED.
 *   - mediates plugin→host `host.<ns>.<method>` requests by handing them to the
 *     host-provided `dispatch(ns, method, args, sandbox)` (the adapters live in
 *     contrib-*.js; this file does NOT know capabilities — it only routes).
 *   - mounts host-controlled DOM for render() outputs: it owns a sanitizer for the
 *     §5.7 vDOM/HTML and gives adapters `sandbox.mount(el, renderResult, onEvent)`.
 *
 * The host (`plugin-host.js`) constructs this with `{ id, manifest, entrySource,
 * moduleShims, dispatch, onQuarantine }` and calls `activate()` / `deactivate()`.
 */

import {
  PluginRpc,
  RpcError,
  ERROR_CODES,
  ACTIVATE_TIMEOUT_MS,
  DEACTIVATE_TIMEOUT_MS,
} from './plugin-rpc.js'
import { buildSandboxSrcdoc } from './sandbox-runtime.js'

const SANDBOX_FLAGS = 'allow-scripts' // intentionally NOT allow-same-origin

// vDOM tag/attr allow-list (§5.7). Kept here so adapters can reuse the same
// sanitizer via sandbox.sanitizeVDom / sandbox.mount.
const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
  'a', 'button', 'input', 'textarea', 'select', 'option',
  'img', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'strong', 'em', 'br', 'hr', 'label', 'i', 'svg', 'path', 'g', 'circle',
  'rect', 'line', 'polyline', 'polygon',
])

const ALLOWED_ATTR_PREFIXES = ['aria-', 'data-']
const ALLOWED_ATTRS = new Set([
  'class', 'id', 'href', 'src', 'type', 'value', 'placeholder',
  'title', 'role', 'alt', 'name', 'for', 'checked', 'disabled', 'selected',
  'rows', 'cols', 'min', 'max', 'step', 'width', 'height',
  // svg subset
  'viewbox', 'fill', 'stroke', 'stroke-width', 'd', 'cx', 'cy', 'r', 'x', 'y',
  'x1', 'y1', 'x2', 'y2', 'points', 'transform',
])

function attrAllowed(name) {
  const lower = name.toLowerCase()
  if (ALLOWED_ATTRS.has(lower)) return true
  return ALLOWED_ATTR_PREFIXES.some((p) => lower.startsWith(p))
}

function sanitizeUrl(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  // Allow relative, https:, notionless:, and bounded data: images.
  if (/^https:\/\//i.test(v)) return v
  if (/^notionless:/i.test(v)) return v
  if (/^\.{0,2}\//.test(v)) return v // relative path
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(v) && v.length < 200000) return v
  return null
}

let _sandboxSeq = 0

export class PluginSandbox {
  /**
   * @param {{
   *   id: string,
   *   manifest: object,
   *   entrySource: string,
   *   moduleShims?: Record<string,string>,
   *   dispatch: (ns:string, method:string, args:any[], sandbox:PluginSandbox)=>any|Promise<any>,
   *   onQuarantine?: (id:string, reason:string)=>void,
   *   container?: HTMLElement,
   * }} opts
   */
  constructor(opts) {
    if (!opts || !opts.id) throw new Error('[PluginSandbox] id required')
    this.id = opts.id
    this.manifest = opts.manifest || {}
    this._entrySource = String(opts.entrySource || '')
    this._moduleShims = opts.moduleShims || {}
    this._dispatch = typeof opts.dispatch === 'function' ? opts.dispatch : null
    this._onQuarantine = typeof opts.onQuarantine === 'function' ? opts.onQuarantine : null
    this._container = opts.container || (typeof document !== 'undefined' ? document.body : null)

    this._seq = (_sandboxSeq += 1)
    this.iframe = null
    this.rpc = null
    this._channel = null // MessageChannel
    this._readyResolve = null
    this._readyPromise = null
    this.state = 'idle' // idle | loading | ready | activating | active | disposing | quarantined | disposed
    this._mounts = new Set() // DOM elements we created, for cleanup

    // disposeToken → { kind, onEvent } so we can route delegated DOM events and
    // status/update calls back to the right contribution. Adapters fill this.
    this._registrations = new Map()
    this._disposeTokenSeq = 0
  }

  /** Allocate an integer dispose-token an adapter can hand back to the plugin. */
  allocDisposeToken(meta) {
    this._disposeTokenSeq += 1
    const tok = this._disposeTokenSeq
    this._registrations.set(tok, meta || {})
    return tok
  }

  getRegistration(token) {
    return this._registrations.get(token)
  }

  releaseRegistration(token) {
    this._registrations.delete(token)
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Create the iframe + channel and wait for the in-sandbox runtime's `ready`. */
  async load() {
    if (this.state !== 'idle') return
    if (typeof document === 'undefined') {
      throw new Error('[PluginSandbox] no document (renderer-only)')
    }
    this.state = 'loading'

    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', SANDBOX_FLAGS)
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('tabindex', '-1')
    iframe.dataset.pluginId = this.id
    iframe.className = 'plugin-sandbox-frame'
    iframe.style.display = 'none'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.srcdoc = buildSandboxSrcdoc(this._entrySource, this._moduleShims)
    this.iframe = iframe

    // Ready handshake: resolved when the runtime posts host.notify.ready over the port.
    this._readyPromise = new Promise((resolve) => { this._readyResolve = resolve })

    // The MessageChannel: we keep port1, transfer port2 into the iframe.
    const channel = new MessageChannel()
    this._channel = channel

    this.rpc = new PluginRpc(
      {
        post: (msg) => {
          try { channel.port1.postMessage(msg) } catch (_e) { /* port closed */ }
        },
        onMessage: (cb) => {
          channel.port1.onmessage = (ev) => cb(ev.data)
          if (typeof channel.port1.start === 'function') channel.port1.start()
          return () => { try { channel.port1.onmessage = null } catch (_e) { /* ignore */ } }
        },
      },
      {
        label: this.id,
        // plugin→host requests: host.<ns>.<method>
        onUnhandled: (method, params) => this._handlePluginRequest(method, params),
        // plugin→host fire-and-forget signals (e.g. host.notify.ready)
        onEvent: (method, params) => this._handlePluginEvent(method, params),
      },
    )

    this._container.appendChild(iframe)

    // Once the iframe document loads, transfer the port to it.
    await new Promise((resolve) => {
      let done = false
      const finish = () => { if (!done) { done = true; resolve() } }
      iframe.addEventListener('load', finish, { once: true })
      // Fallback in case 'load' already fired (srcdoc can be synchronous).
      setTimeout(finish, 0)
    })

    try {
      // Hand the transferable port to the sandbox via window.postMessage('*').
      // The opaque-origin frame can only read the port, nothing of ours.
      iframe.contentWindow.postMessage({ kind: 'notionless:port' }, '*', [channel.port2])
    } catch (e) {
      this.state = 'idle'
      throw new Error(`[PluginSandbox:${this.id}] failed to transfer port: ${e && e.message}`)
    }

    // Wait for the runtime's ready beacon (bounded so a broken frame can't hang).
    await this._waitReady(ACTIVATE_TIMEOUT_MS)
    this.state = 'ready'
  }

  _waitReady(timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new RpcError(ERROR_CODES.TIMEOUT, `sandbox '${this.id}' never signaled ready`))
      }, timeoutMs)
      if (timer && typeof timer.unref === 'function') timer.unref()
      this._readyPromise.then(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Drive plugin.activate with the ctx descriptor (granted-namespace manifest). */
  async activate(ctxDescriptor) {
    if (this.state === 'idle') await this.load()
    if (this.state !== 'ready') {
      throw new RpcError(ERROR_CODES.INTERNAL, `cannot activate from state '${this.state}'`)
    }
    this.state = 'activating'
    try {
      const res = await this.rpc.request(
        'plugin.activate',
        { ctxDescriptor: ctxDescriptor || { namespaces: {} } },
        { timeout: ACTIVATE_TIMEOUT_MS },
      )
      this.state = 'active'
      return res
    } catch (e) {
      // Activation failure/timeout ⇒ quarantine + dispose (host app keeps running).
      this.quarantine(`activate failed: ${e && e.message}`)
      throw e
    }
  }

  /** Drive plugin.deactivate (best-effort), then dispose the iframe. */
  async deactivate() {
    if (this.state === 'active' || this.state === 'activating') {
      this.state = 'disposing'
      try {
        await this.rpc.request('plugin.deactivate', {}, { timeout: DEACTIVATE_TIMEOUT_MS })
      } catch (_e) {
        // A hung/throwing deactivate must not block teardown.
      }
    }
    this.dispose()
  }

  /**
   * Deliver a host→plugin event (e.g. host.event.note:open) or invoke a previously
   * registered plugin callback token (plugin.callback). Fire-and-forget.
   */
  emitEvent(method, params) {
    if (!this.rpc || this.state === 'disposed' || this.state === 'quarantined') return
    this.rpc.notify(method, params)
  }

  /** Invoke a plugin callback token with args (e.g. AI onToken, render onEvent). */
  invokePluginCallback(token, args) {
    if (token == null) return
    this.emitEvent('plugin.callback', { token, args: Array.isArray(args) ? args : [] })
  }

  // ── Plugin → host routing ────────────────────────────────────────────────

  async _handlePluginRequest(method, params) {
    // Built-in host meta-methods that the runtime's Disposable wrapper uses.
    if (method === 'host.host.dispose') {
      this._disposeRegistration(params && params.disposeToken)
      return { ok: true }
    }
    if (method === 'host.host.update' || method === 'host.host.statusSet' || method === 'host.host.show') {
      return this._invokeRegistrationOp(method, params)
    }

    // host.<ns>.<rest> → adapter dispatch.
    const m = /^host\.([a-zA-Z0-9_]+)\.(.+)$/.exec(method || '')
    if (!m) {
      throw new RpcError(ERROR_CODES.UNSUPPORTED_METHOD, `bad method '${method}'`)
    }
    const ns = m[1]
    const sub = m[2]
    if (!this._dispatch) {
      throw new RpcError(ERROR_CODES.UNSUPPORTED_METHOD, 'no dispatcher wired')
    }
    const args = (params && Array.isArray(params.args)) ? params.args : []
    // The adapter (contrib-*.js) does the capability re-check and the real work.
    // It throws RpcError(CAPABILITY_DENIED/...) which PluginRpc serializes.
    return this._dispatch(ns, sub, args, this)
  }

  _handlePluginEvent(method, params) {
    if (method === 'host.notify.ready') {
      if (this._readyResolve) {
        const r = this._readyResolve
        this._readyResolve = null
        r()
      }
      return
    }
    // Other host.notify.* signals are advisory; adapters may subscribe later.
    if (this._dispatch && method && method.indexOf('host.notify.') === 0) {
      try {
        this._dispatch('notify', method.slice('host.notify.'.length), [params], this)
      } catch (_e) { /* notifications never throw out */ }
    }
  }

  _disposeRegistration(token) {
    const reg = this._registrations.get(token)
    if (reg && typeof reg.dispose === 'function') {
      try { reg.dispose() } catch (_e) { /* defensive */ }
    }
    this._registrations.delete(token)
  }

  _invokeRegistrationOp(method, params) {
    const reg = this._registrations.get(params && params.disposeToken)
    if (!reg) return { ok: false }
    try {
      if (method === 'host.host.update' && typeof reg.update === 'function') {
        reg.update(params.vdom)
        return { ok: true }
      }
      if (method === 'host.host.statusSet' && typeof reg.set === 'function') {
        reg.set(params.value)
        return { ok: true }
      }
      if (method === 'host.host.show' && typeof reg.show === 'function') {
        reg.show()
        return { ok: true }
      }
    } catch (e) {
      throw new RpcError(ERROR_CODES.INTERNAL, (e && e.message) || 'registration op failed')
    }
    return { ok: false }
  }

  // ── Host-mediated DOM mount (§5.7) ────────────────────────────────────────

  /**
   * Mount a plugin render result (vDOM node OR sanitized HTML string) into `el`.
   * Event handlers are NOT cross-realm: a vNode's `on:{ event: actionId }` map is
   * wired to a delegated host listener that calls `onEvent({action, payload})`.
   *
   * @param {HTMLElement} el  host-owned container
   * @param {object|string} result  vDOM or HTML string from the plugin
   * @param {(e:{action:string,payload?:any})=>void} [onEvent]
   */
  mount(el, result, onEvent) {
    if (!el) return
    el.textContent = ''
    try {
      if (typeof result === 'string') {
        const frag = this._sanitizeHtmlString(result)
        el.appendChild(frag)
      } else if (result && typeof result === 'object') {
        const node = this._buildVNode(result, onEvent)
        if (node) el.appendChild(node)
      }
      this._mounts.add(el)
    } catch (e) {
      // A render error degrades to an inline error chip, never a white screen (§8.9).
      el.textContent = ''
      const chip = document.createElement('span')
      chip.className = 'plugin-render-error'
      chip.textContent = `⚠ ${this.id}: render failed`
      chip.title = (e && e.message) || String(e)
      el.appendChild(chip)
    }
  }

  /** Public sanitizer so adapters can pre-validate a render result if needed. */
  sanitizeVDom(result, onEvent) {
    if (typeof result === 'string') return this._sanitizeHtmlString(result)
    return this._buildVNode(result, onEvent)
  }

  _buildVNode(vnode, onEvent, depth = 0) {
    if (depth > 64) return null
    if (vnode == null) return null
    if (typeof vnode === 'string' || typeof vnode === 'number') {
      return document.createTextNode(String(vnode))
    }
    if (typeof vnode !== 'object') return null

    const tag = typeof vnode.tag === 'string' ? vnode.tag.toLowerCase() : ''
    if (!ALLOWED_TAGS.has(tag)) {
      // Disallowed tag: render its children as a plain span (don't drop content).
      const span = document.createElement('span')
      this._appendChildren(span, vnode.children, onEvent, depth)
      return span
    }

    const isSvg = ['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon'].includes(tag)
    const el = isSvg
      ? document.createElementNS('http://www.w3.org/2000/svg', tag)
      : document.createElement(tag)

    // Attributes (allow-listed + url-sanitized).
    if (vnode.attrs && typeof vnode.attrs === 'object') {
      for (const [name, raw] of Object.entries(vnode.attrs)) {
        if (!attrAllowed(name)) continue
        let value = raw == null ? '' : String(raw)
        const lower = name.toLowerCase()
        if (lower === 'href' || lower === 'src') {
          const safe = sanitizeUrl(value)
          if (!safe) continue
          value = safe
        }
        // Never allow style (url()/expression vectors) or inline event attrs.
        if (lower === 'style' || lower.startsWith('on')) continue
        try { el.setAttribute(name, value) } catch (_e) { /* invalid name */ }
      }
    }

    // Delegated events: `on: { click: 'actionId', ... }` → host listeners.
    if (vnode.on && typeof vnode.on === 'object' && typeof onEvent === 'function') {
      for (const [evName, actionId] of Object.entries(vnode.on)) {
        if (typeof evName !== 'string' || typeof actionId !== 'string') continue
        // Only attach standard, safe DOM event names.
        if (!/^[a-z]+$/.test(evName)) continue
        el.addEventListener(evName, (domEvent) => {
          try {
            const payload = this._extractEventPayload(domEvent)
            onEvent({ action: actionId, payload })
          } catch (_e) { /* host never breaks on a plugin event handler */ }
        })
      }
    }

    this._appendChildren(el, vnode.children, onEvent, depth)
    return el
  }

  _appendChildren(el, children, onEvent, depth) {
    if (!Array.isArray(children)) return
    for (const child of children) {
      const childNode = (typeof child === 'string' || typeof child === 'number')
        ? document.createTextNode(String(child))
        : this._buildVNode(child, onEvent, depth + 1)
      if (childNode) el.appendChild(childNode)
    }
  }

  _extractEventPayload(domEvent) {
    const t = domEvent && domEvent.target
    if (!t) return {}
    const payload = {}
    if ('value' in t) payload.value = t.value
    if ('checked' in t) payload.checked = t.checked
    if (t.dataset) {
      payload.dataset = {}
      for (const k of Object.keys(t.dataset)) payload.dataset[k] = t.dataset[k]
    }
    return payload
  }

  _sanitizeHtmlString(html) {
    // Parse in an inert document so no scripts run, then walk + re-build through
    // the same allow-list as the vDOM path.
    const frag = document.createDocumentFragment()
    let template
    try {
      template = document.createElement('template')
      template.innerHTML = String(html)
    } catch (_e) {
      frag.appendChild(document.createTextNode(String(html)))
      return frag
    }
    const walk = (srcNode) => {
      if (srcNode.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(srcNode.textContent || '')
      }
      if (srcNode.nodeType !== Node.ELEMENT_NODE) return null
      const tag = srcNode.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object'
          || tag === 'embed' || tag === 'link' || tag === 'meta') {
        return null
      }
      const container = ALLOWED_TAGS.has(tag) ? document.createElement(tag) : document.createElement('span')
      if (ALLOWED_TAGS.has(tag)) {
        for (const attr of Array.from(srcNode.attributes || [])) {
          const name = attr.name
          if (!attrAllowed(name)) continue
          const lower = name.toLowerCase()
          if (lower === 'style' || lower.startsWith('on')) continue
          let value = attr.value
          if (lower === 'href' || lower === 'src') {
            const safe = sanitizeUrl(value)
            if (!safe) continue
            value = safe
          }
          try { container.setAttribute(name, value) } catch (_e) { /* ignore */ }
        }
      }
      for (const child of Array.from(srcNode.childNodes)) {
        const built = walk(child)
        if (built) container.appendChild(built)
      }
      return container
    }
    for (const node of Array.from(template.content.childNodes)) {
      const built = walk(node)
      if (built) frag.appendChild(built)
    }
    return frag
  }

  // ── Teardown / quarantine ─────────────────────────────────────────────────

  /** Hard kill: mark quarantined, surface to host, dispose the iframe. */
  quarantine(reason) {
    if (this.state === 'quarantined' || this.state === 'disposed') return
    this.state = 'quarantined'
    const r = typeof reason === 'string' ? reason : 'plugin quarantined'
    if (this._onQuarantine) {
      try { this._onQuarantine(this.id, r) } catch (_e) { /* never break the host */ }
    }
    this._teardown(r)
  }

  /** Remove the iframe + channel and clear mounts. Idempotent. */
  dispose() {
    if (this.state === 'disposed') return
    if (this.state !== 'quarantined') this.state = 'disposed'
    this._teardown('disposed')
  }

  _teardown(reason) {
    // Dispose every registration (clears mounted DOM, listeners, etc.).
    for (const [token] of this._registrations) {
      this._disposeRegistration(token)
    }
    this._registrations.clear()

    for (const el of this._mounts) {
      try { el.textContent = '' } catch (_e) { /* ignore */ }
    }
    this._mounts.clear()

    if (this.rpc) {
      try { this.rpc.dispose(reason) } catch (_e) { /* ignore */ }
      this.rpc = null
    }
    if (this._channel) {
      try { this._channel.port1.close() } catch (_e) { /* ignore */ }
      this._channel = null
    }
    if (this.iframe && this.iframe.parentNode) {
      try { this.iframe.parentNode.removeChild(this.iframe) } catch (_e) { /* ignore */ }
    }
    this.iframe = null
    if (this.state !== 'quarantined') this.state = 'disposed'
  }
}

export default PluginSandbox
