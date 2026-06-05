/**
 * contrib-ui.js — UI adapter (FROZEN CONTRACT v1, §5.6 / §5.7 / §6).
 *
 * Bridges `ctx.ui.*` to the host DOM. Owns the host-side vDOM sanitizer +
 * mounter (also handed to contrib-editor for block rendering). All plugin
 * UI is HTML-string/vDOM, sanitized by an allow-list (§5.7) BEFORE mounting.
 * No cross-realm DOM nodes; no inline scripts; no `javascript:`/`data:`
 * (except sanitized bounded `img` data URLs).
 *
 * Mounting targets (documented DOM ids in main.js):
 *   - sidebar sections  → `#sidebar-scroll-area` (mirrors `_ensureTopSection`)
 *   - views             → injected `#plugin-<id>-view` into `<main>`
 *   - nav items         → `.sidebar-nav-list`
 *   - toolbar items     → SelectionToolbar buttons (host pushes via hook)
 *   - status items      → `footer .stats` (location 'footer') / `#header-right`
 *   - settings sections → host-built overlay (team.js pattern)
 *   - notify            → a host toast container appended to <body>
 *   - panels            → docked `#plugin-panel-<location>` rails
 *
 * SECURITY: capability re-checked at every seam (`ui`; sections also `sections`;
 * views/settings also `views`; clipboard `clipboard`). Render errors degrade to
 * an inline error chip — never a white screen (§8.9).
 */

import * as Caps from './capabilities.js'

const C = Caps.CAPABILITIES || {}
const CAP_UI = C.UI || 'ui'
const CAP_SECTIONS = C.SECTIONS || 'sections'
const CAP_VIEWS = C.VIEWS || 'views'
const CAP_CLIPBOARD = C.CLIPBOARD || 'clipboard'

function hasCap(manifest, cap) {
  try {
    if (typeof Caps.requireCapability === 'function') {
      try { Caps.requireCapability(manifest, cap); return true } catch { return false }
    }
    const list = (manifest && Array.isArray(manifest.capabilities)) ? manifest.capabilities : []
    return list.includes(cap)
  } catch { return false }
}

// ── vDOM / HTML sanitizer (§5.7 — NORMATIVE allow-list) ──────────────────────

const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
  'a', 'button', 'input', 'textarea', 'select', 'option',
  'img', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'strong', 'em', 'br', 'hr', 'label', 'i', 'svg',
  // svg subset
  'path', 'g', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text',
])

const ALLOWED_ATTR_RE = /^(class|id|href|src|type|value|placeholder|title|role|aria-[a-z-]+|data-[a-z0-9-]+|width|height|viewBox|d|fill|stroke|stroke-width|x|y|x1|y1|x2|y2|cx|cy|r|points|rows|cols|disabled|checked|selected|name|for|alt)$/i

const URL_ATTRS = new Set(['href', 'src'])

/** True if a URL value is allowed (https / notionless / relative / bounded data img). */
function isSafeUrl(val, tag, attr) {
  const v = String(val || '').trim()
  if (v === '') return true
  const lower = v.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return false
  if (lower.startsWith('https:') || lower.startsWith('notionless:')) return true
  // relative URLs (no scheme, no protocol-relative //)
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith('//')) return true
  // bounded data: image only (on <img src>)
  if (tag === 'img' && attr === 'src' && lower.startsWith('data:image/')) {
    return v.length <= 200000 // ~200KB cap
  }
  return false
}

/** Escape text for safe textContent (DOM API already escapes; helper for strings). */
function escapeText(s) {
  return String(s == null ? '' : s)
}

/**
 * Build a sanitized DOM fragment from a vDOM node or HTML string.
 * @param {object|string} node vDOM VNode or HTML string
 * @param {(action:string, payload?:any)=>void} onEvent delegated event sink
 * @param {number} depth recursion guard
 * @returns {Node}
 */
function buildNode(node, onEvent, depth = 0) {
  if (depth > 64) return document.createTextNode('')
  if (node == null) return document.createTextNode('')
  if (typeof node === 'string') {
    // A bare string at this position is text content (§5.7: strings are escaped).
    return document.createTextNode(escapeText(node))
  }
  if (typeof node !== 'object') return document.createTextNode(escapeText(node))

  const tag = String(node.tag || '').toLowerCase()
  if (!ALLOWED_TAGS.has(tag)) {
    // Disallowed tag → render its children as text-bearing span (no drop of text).
    const span = document.createElement('span')
    appendChildren(span, node.children, onEvent, depth)
    return span
  }

  const isSvg = ['svg', 'path', 'g', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text'].includes(tag)
  const el = isSvg
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag)

  // attrs
  if (node.attrs && typeof node.attrs === 'object') {
    for (const [k, v] of Object.entries(node.attrs)) {
      if (!ALLOWED_ATTR_RE.test(k)) continue
      if (k.toLowerCase() === 'style') continue // no inline style
      if (URL_ATTRS.has(k.toLowerCase())) {
        if (!isSafeUrl(v, tag, k.toLowerCase())) continue
      }
      try {
        if (isSvg) el.setAttributeNS(null, k, String(v))
        else el.setAttribute(k, String(v))
      } catch { /* invalid attr name; skip */ }
    }
  }

  // event delegation: on:{ click:'action-id', ... } → delegated host listeners
  if (node.on && typeof node.on === 'object' && onEvent) {
    for (const [evt, action] of Object.entries(node.on)) {
      if (typeof action !== 'string') continue
      const safeEvt = String(evt).replace(/[^a-z]/gi, '')
      if (!safeEvt) continue
      el.addEventListener(safeEvt, (e) => {
        try {
          let payload
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
            payload = { value: el.value }
          }
          onEvent(action, payload)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[plugin ui] onEvent handler failed:', err)
        }
        // never let plugin events bubble into host shortcuts unexpectedly
        if (safeEvt === 'click') e.stopPropagation()
      })
    }
  }

  appendChildren(el, node.children, onEvent, depth)
  return el
}

function appendChildren(el, children, onEvent, depth) {
  if (!Array.isArray(children)) return
  for (const child of children) {
    try { el.appendChild(buildNode(child, onEvent, depth + 1)) } catch { /* skip bad child */ }
  }
}

/**
 * Mount sanitized vDOM/HTML into a host element. HTML strings are parsed and
 * re-sanitized through the same allow-list (DOMPurify-style). Exposed so
 * contrib-editor can reuse it for block widgets.
 * @param {object|string} out vDOM or HTML string
 * @param {HTMLElement} host mount target (cleared first)
 * @param {(action:string,payload?:any)=>void} [onEvent]
 */
export function mountVDOM(out, host, onEvent) {
  if (!host) return
  try {
    host.textContent = ''
    if (out == null) return
    if (typeof out === 'string') {
      // Parse HTML string in an inert template, then re-walk through sanitizer.
      const tmpl = document.createElement('template')
      tmpl.innerHTML = out
      const sanitized = sanitizeDomTree(tmpl.content, onEvent)
      host.appendChild(sanitized)
      return
    }
    if (out && out.__error) {
      const chip = document.createElement('div')
      chip.className = 'plugin-error-chip'
      chip.textContent = `Plugin render error: ${out.__error}`
      host.appendChild(chip)
      return
    }
    host.appendChild(buildNode(out, onEvent, 0))
  } catch (e) {
    host.textContent = ''
    const chip = document.createElement('div')
    chip.className = 'plugin-error-chip'
    chip.textContent = `Plugin render error: ${(e && e.message) || e}`
    host.appendChild(chip)
  }
}

/** Re-sanitize a parsed HTML tree (from a string render) against the allow-list. */
function sanitizeDomTree(srcRoot, onEvent) {
  const frag = document.createDocumentFragment()
  const walk = (srcNode, destParent) => {
    for (const child of Array.from(srcNode.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        destParent.appendChild(document.createTextNode(child.textContent))
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const tag = child.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed') continue
      if (!ALLOWED_TAGS.has(tag)) {
        // keep text content, drop the tag
        walk(child, destParent)
        continue
      }
      const el = document.createElement(tag)
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on')) continue // strip inline handlers
        if (!ALLOWED_ATTR_RE.test(name)) continue
        if (name === 'style') continue
        if (URL_ATTRS.has(name) && !isSafeUrl(attr.value, tag, name)) continue
        try { el.setAttribute(attr.name, attr.value) } catch { /* skip */ }
      }
      walk(child, el)
      destParent.appendChild(el)
    }
  }
  walk(srcRoot, frag)
  return frag
}

// ── Toast / notify container (lazy) ──────────────────────────────────────────
let _toastHost = null
function ensureToastHost() {
  if (_toastHost && document.body.contains(_toastHost)) return _toastHost
  _toastHost = document.createElement('div')
  _toastHost.className = 'plugin-toast-host'
  document.body.appendChild(_toastHost)
  return _toastHost
}

// ── Panel rails (lazy docked containers) ─────────────────────────────────────
function ensurePanelRail(location) {
  const loc = ['right', 'left', 'bottom'].includes(location) ? location : 'right'
  const id = `plugin-panel-rail-${loc}`
  let rail = document.getElementById(id)
  if (!rail) {
    rail = document.createElement('div')
    rail.id = id
    rail.className = `plugin-panel-rail plugin-panel-rail-${loc}`
    const mainEl = document.querySelector('.main') || document.body
    mainEl.appendChild(rail)
  }
  return rail
}

// ── Public adapter surface ───────────────────────────────────────────────────

/**
 * Initialize the UI adapter.
 * @param {object} hostHooks the §6 host hooks bag from main.js
 * @returns {object} adapter API
 */
export function initUIAdapter(hostHooks = {}) {
  const disposables = new Set()

  function track(d) { if (d && typeof d.dispose === 'function') disposables.add(d); return d }

  return {
    /** Exposed mounter for contrib-editor block widgets. */
    mount: mountVDOM,

    /**
     * ctx.ui.panel — capability `ui`. Docked panel (right/left/bottom).
     * `render(mountToken)` returns vDOM/HTML; delegated events → onEvent.
     */
    panel(manifest, p, bridge) {
      if (!hasCap(manifest, CAP_UI)) return denied('panel')
      if (!p || typeof p.id !== 'string') return noop()
      const rail = ensurePanelRail(p.location)
      const wrap = document.createElement('div')
      wrap.className = 'plugin-panel'
      wrap.id = `plugin-panel-${ns(manifest.id, p.id)}`
      const head = document.createElement('div')
      head.className = 'plugin-panel-header'
      head.textContent = safeText(p.title, 80)
      const body = document.createElement('div')
      body.className = 'plugin-panel-body'
      wrap.appendChild(head)
      wrap.appendChild(body)
      rail.appendChild(wrap)

      const onEvent = (action, payload) => safeCall(() => bridge && bridge.onEvent && bridge.onEvent({ action, payload }))
      renderInto(body, bridge, onEvent)

      const d = {
        update(vdom) { mountVDOM(vdom, body, onEvent) },
        dispose() { wrap.remove() },
      }
      return track(d)
    },

    /**
     * ctx.ui.sidebarSection — capability `sections` (+`ui`). Injects a top
     * sidebar section into `#sidebar-scroll-area` (mirrors `_ensureTopSection`).
     * The plugin may only touch its own `#<id>-list`.
     */
    sidebarSection(manifest, s, bridge) {
      if (!hasCap(manifest, CAP_UI) || !hasCap(manifest, CAP_SECTIONS)) return denied('sidebarSection')
      if (!s || typeof s.id !== 'string') return noop()
      const id = `plugin-section-${ns(manifest.id, s.id)}`
      // Prefer the host hook (wraps _ensureTopSection); fall back to direct DOM.
      let listEl = null
      if (hostHooks.sidebar && typeof hostHooks.sidebar.addSection === 'function') {
        safeCall(() => hostHooks.sidebar.addSection({
          id,
          title: safeText(s.title, 60),
          order: Number.isFinite(s.order) ? s.order : 5,
          mount: (el) => { listEl = el; renderSectionInto(el, bridge) },
        }))
      } else {
        listEl = injectSidebarSection(id, safeText(s.title, 60), Number.isFinite(s.order) ? s.order : 5, s.headerAction, manifest.id)
        renderSectionInto(listEl, bridge)
      }
      const d = {
        update() { if (listEl) renderSectionInto(listEl, bridge) },
        dispose() {
          if (hostHooks.sidebar && typeof hostHooks.sidebar.removeSection === 'function') {
            safeCall(() => hostHooks.sidebar.removeSection(id))
          } else {
            const node = document.getElementById(id)
            if (node) node.remove()
          }
        },
      }
      return track(d)
    },

    /**
     * ctx.ui.view — capability `views` (+`ui`). Full replace-the-editor view.
     * Injects `#plugin-<id>-view` into `<main>`; returns { show() } & Disposable.
     */
    view(manifest, v, bridge) {
      if (!hasCap(manifest, CAP_UI) || !hasCap(manifest, CAP_VIEWS)) return denied('view')
      if (!v || typeof v.id !== 'string') return noop()
      const viewId = `plugin-${ns(manifest.id, v.id)}-view`
      let container = null
      const onEvent = (action, payload) => safeCall(() => bridge && bridge.onEvent && bridge.onEvent({ action, payload }))

      if (hostHooks.addView && typeof hostHooks.addView === 'function') {
        const handle = safeCallReturn(() => hostHooks.addView({
          id: viewId,
          title: safeText(v.title, 60),
          icon: v.icon,
          mount: (el) => { container = el; renderInto(el, bridge, onEvent) },
          show: () => {},
          hide: () => {},
        }))
        const d = {
          show() { if (handle && handle.show) safeCall(() => handle.show()) },
          update(vdom) { if (container) mountVDOM(vdom, container, onEvent) },
          dispose() { if (hostHooks.removeView) safeCall(() => hostHooks.removeView(viewId)) },
        }
        return track(d)
      }

      // Fallback: direct injection into <main>.
      container = injectMainView(viewId)
      renderInto(container, bridge, onEvent)
      const d = {
        show() { showMainView(viewId) },
        update(vdom) { mountVDOM(vdom, container, onEvent) },
        dispose() { const n = document.getElementById(viewId); if (n) n.remove() },
      }
      return track(d)
    },

    /**
     * ctx.ui.navItem — capability `ui`. Appends to `.sidebar-nav-list`.
     * `target` = a view id (shows that view) or `command:<id>` (dispatches cmd).
     */
    navItem(manifest, n, onActivate) {
      if (!hasCap(manifest, CAP_UI)) return denied('navItem')
      if (!n || typeof n.id !== 'string') return noop()
      const id = `plugin-nav-${ns(manifest.id, n.id)}`
      const onClick = () => safeCall(() => onActivate && onActivate(n.target))
      if (hostHooks.addNavItem && typeof hostHooks.addNavItem === 'function') {
        safeCall(() => hostHooks.addNavItem({ id, label: safeText(n.label, 40), icon: n.icon, onClick }))
        return track({ dispose() { if (hostHooks.removeNavItem) safeCall(() => hostHooks.removeNavItem(id)) } })
      }
      const el = injectNavItem(id, safeText(n.label, 40), n.icon, onClick)
      return track({ dispose() { if (el) el.remove() } })
    },

    /**
     * ctx.ui.toolbarItem — capability `ui`. Pushes a button into the selection
     * toolbar. `run(sel)` receives { from, to, text }.
     */
    toolbarItem(manifest, t, run) {
      if (!hasCap(manifest, CAP_UI)) return denied('toolbarItem')
      if (!t || typeof t.id !== 'string') return noop()
      const id = `plugin-tb-${ns(manifest.id, t.id)}`
      const onClick = (sel) => safeCall(() => run && run(sel))
      if (hostHooks.addToolbarItem && typeof hostHooks.addToolbarItem === 'function') {
        safeCall(() => hostHooks.addToolbarItem({ id, icon: safeIcon(t.icon), title: safeText(t.title, 40), onClick }))
        return track({ dispose() { if (hostHooks.removeToolbarItem) safeCall(() => hostHooks.removeToolbarItem(id)) } })
      }
      return noop()
    },

    /**
     * ctx.ui.statusItem — capability `ui`. Appends a slot into `footer .stats`
     * (location 'footer') or `#header-right` ('header'). Returns { set }.
     */
    statusItem(manifest, st) {
      if (!hasCap(manifest, CAP_UI)) return denied('statusItem')
      if (!st || typeof st.id !== 'string') return noop()
      const id = `plugin-status-${ns(manifest.id, st.id)}`
      const location = st.location === 'header' ? 'header' : 'footer'
      let setter = null
      if (hostHooks.addStatusItem && typeof hostHooks.addStatusItem === 'function') {
        const handle = safeCallReturn(() => hostHooks.addStatusItem({ id, location }))
        setter = handle && typeof handle.set === 'function' ? handle.set : null
      }
      let el = setter ? null : injectStatusItem(id, location)
      const d = {
        set(text) {
          if (setter) { safeCall(() => setter(text)); return }
          if (!el) return
          if (text && typeof text === 'object' && typeof text.html === 'string') {
            mountVDOM(text.html, el)
          } else {
            el.textContent = safeText(text, 200)
          }
        },
        dispose() {
          if (hostHooks.removeStatusItem) safeCall(() => hostHooks.removeStatusItem(id))
          if (el) el.remove()
        },
      }
      return track(d)
    },

    /**
     * ctx.ui.settingsSection — capability `views` (+`ui`). Adds a settings
     * overlay section (team.js pattern). `render(mountToken)` → vDOM/HTML.
     */
    settingsSection(manifest, se, bridge) {
      if (!hasCap(manifest, CAP_UI) || !hasCap(manifest, CAP_VIEWS)) return denied('settingsSection')
      if (!se || typeof se.id !== 'string') return noop()
      const id = `plugin-settings-${ns(manifest.id, se.id)}`
      const onEvent = (action, payload) => safeCall(() => bridge && bridge.onEvent && bridge.onEvent({ action, payload }))
      if (hostHooks.addSettingsSection && typeof hostHooks.addSettingsSection === 'function') {
        safeCall(() => hostHooks.addSettingsSection({
          id,
          title: safeText(se.title, 60),
          mount: (pane) => renderInto(pane, bridge, onEvent),
        }))
      }
      return track({ dispose() { /* host removes via teardown */ } })
    },

    /** ctx.ui.notify — capability `ui`. Non-blocking toast. */
    notify(manifest, n) {
      if (!hasCap(manifest, CAP_UI)) { console.warn('[contrib-ui] notify denied'); return }
      if (!n || typeof n.message !== 'string') return
      const host = ensureToastHost()
      const toast = document.createElement('div')
      const kind = ['info', 'success', 'warn', 'error'].includes(n.kind) ? n.kind : 'info'
      toast.className = `plugin-toast plugin-toast-${kind}`
      toast.textContent = safeText(n.message, 300)
      host.appendChild(toast)
      const timeout = Number.isFinite(n.timeout) ? Math.min(Math.max(n.timeout, 500), 30000) : 4000
      setTimeout(() => { toast.classList.add('plugin-toast-out'); setTimeout(() => toast.remove(), 300) }, timeout)
    },

    /** ctx.ui.modal — capability `ui`. Resolves { button }. */
    modal(manifest, m, bridge) {
      if (!hasCap(manifest, CAP_UI)) return Promise.resolve({ button: '__denied' })
      return new Promise((resolve) => {
        try {
          const overlay = document.createElement('div')
          overlay.className = 'plugin-modal-overlay'
          const box = document.createElement('div')
          box.className = 'plugin-modal'
          const title = document.createElement('h3')
          title.className = 'plugin-modal-title'
          title.textContent = safeText(m.title, 120)
          const body = document.createElement('div')
          body.className = 'plugin-modal-body'
          const onEvent = (action, payload) => safeCall(() => bridge && bridge.onEvent && bridge.onEvent({ action, payload }))
          mountVDOM(m.body, body, onEvent)
          const actions = document.createElement('div')
          actions.className = 'plugin-modal-actions'
          const buttons = Array.isArray(m.buttons) && m.buttons.length
            ? m.buttons
            : [{ id: 'ok', label: 'OK', primary: true }]
          const finish = (btnId) => { overlay.remove(); resolve({ button: btnId }) }
          for (const b of buttons) {
            if (!b || typeof b.id !== 'string') continue
            const btn = document.createElement('button')
            btn.className = `plugin-modal-btn${b.primary ? ' primary' : ''}`
            btn.textContent = safeText(b.label, 40)
            btn.addEventListener('click', () => finish(b.id))
            actions.appendChild(btn)
          }
          overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish('__dismiss') })
          box.appendChild(title); box.appendChild(body); box.appendChild(actions)
          overlay.appendChild(box)
          document.body.appendChild(overlay)
        } catch (e) {
          resolve({ button: '__error' })
        }
      })
    },

    /** ctx.ui.clipboardWrite — capability `clipboard`. */
    async clipboardWrite(manifest, text) {
      if (!hasCap(manifest, CAP_CLIPBOARD)) return { ok: false, error: 'CAPABILITY_DENIED' }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(String(text == null ? '' : text))
          return { ok: true }
        }
        return { ok: false, error: 'NO_CLIPBOARD' }
      } catch (e) { return { ok: false, error: (e && e.message) || String(e) } }
    },

    /** ctx.ui.clipboardRead — capability `clipboard` (user-gesture bound). */
    async clipboardRead(manifest) {
      if (!hasCap(manifest, CAP_CLIPBOARD)) return ''
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          return await navigator.clipboard.readText()
        }
      } catch { /* user denied or no gesture */ }
      return ''
    },

    /** Dispose every tracked registration for this adapter instance. */
    disposeAll() {
      for (const d of disposables) { safeCall(() => d.dispose()) }
      disposables.clear()
    },
  }
}

// ── direct-DOM fallbacks (used when a host hook is absent) ────────────────────

function injectSidebarSection(id, title, order, headerAction, pluginId) {
  const scroll = document.getElementById('sidebar-scroll-area')
  if (!scroll) return null
  let section = document.getElementById(id)
  if (!section) {
    section = document.createElement('div')
    section.className = 'sidebar-section'
    section.id = id
    section.dataset.topOrder = String(order)
    const listId = `${id}-list`
    const header = document.createElement('div')
    header.className = 'sidebar-section-header'
    const span = document.createElement('span')
    span.textContent = title
    header.appendChild(span)
    if (headerAction && headerAction.icon && headerAction.command) {
      const act = document.createElement('i')
      act.className = `${sanitizeIconClass(headerAction.icon)} icon-btn`
      act.style.cursor = 'pointer'
      act.addEventListener('click', () => {
        try { window.dispatchEvent(new CustomEvent('cmd:' + headerAction.command, { detail: { pluginId } })) } catch { /* ignore */ }
      })
      header.appendChild(act)
    }
    const list = document.createElement('div')
    list.id = listId
    section.appendChild(header)
    section.appendChild(list)
    const tops = Array.from(scroll.children).filter(c => c.dataset && c.dataset.topOrder)
    let ref = null
    for (const c of tops) { if (Number(c.dataset.topOrder) > order) { ref = c; break } }
    if (!ref) ref = Array.from(scroll.children).find(c => !(c.dataset && c.dataset.topOrder)) || null
    scroll.insertBefore(section, ref)
  }
  return document.getElementById(`${id}-list`)
}

function injectMainView(viewId) {
  let view = document.getElementById(viewId)
  if (!view) {
    view = document.createElement('div')
    view.id = viewId
    view.className = 'plugin-view'
    view.style.display = 'none'
    const main = document.querySelector('main')
    if (main) main.appendChild(view)
    else document.body.appendChild(view)
  }
  return view
}

function showMainView(viewId) {
  // Hide the editor + sibling views; show ours (mirrors showCompanyBrainPage).
  const editor = document.querySelector('.editor-container')
  const home = document.getElementById('home-view')
  const brain = document.getElementById('brain-view')
  if (editor) editor.style.display = 'none'
  if (home) home.style.display = 'none'
  if (brain) brain.style.display = 'none'
  document.querySelectorAll('.plugin-view').forEach(v => { v.style.display = 'none' })
  const view = document.getElementById(viewId)
  if (view) view.style.display = 'flex'
  const main = document.querySelector('main')
  if (main) main.style.display = 'flex'
}

function injectNavItem(id, label, icon, onClick) {
  const navList = document.querySelector('.sidebar-nav-list')
  if (!navList) return null
  let item = document.getElementById(id)
  if (!item) {
    item = document.createElement('div')
    item.className = 'sidebar-item'
    item.id = id
    const iconHtml = safeIconHtml(icon)
    const labelSpan = document.createElement('span')
    labelSpan.textContent = label
    if (iconHtml) item.appendChild(iconHtml)
    item.appendChild(labelSpan)
    item.addEventListener('click', onClick)
    navList.appendChild(item)
  }
  return item
}

function injectStatusItem(id, location) {
  const target = location === 'header'
    ? (document.getElementById('header-right') || document.querySelector('.header-right'))
    : document.querySelector('footer .stats')
  if (!target) return null
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('div')
    el.id = id
    el.className = location === 'header' ? 'plugin-status-header' : 'plugin-status-footer'
    target.appendChild(el)
  }
  return el
}

// ── helpers ──────────────────────────────────────────────────────────────────

function renderInto(host, bridge, onEvent) {
  if (!host) return
  if (!bridge || typeof bridge.render !== 'function') { host.textContent = ''; return }
  Promise.resolve(safeCallReturn(() => bridge.render()))
    .then((out) => mountVDOM(out, host, onEvent))
    .catch((e) => mountVDOM({ __error: (e && e.message) || String(e) }, host, onEvent))
}

function renderSectionInto(list, bridge) {
  if (!list) return
  if (!bridge || typeof bridge.render !== 'function') { list.textContent = ''; return }
  Promise.resolve(safeCallReturn(() => bridge.render()))
    .then((out) => mountVDOM(out, list))
    .catch((e) => mountVDOM({ __error: (e && e.message) || String(e) }, list))
}

function ns(pluginId, localId) {
  return `${String(pluginId)}-${String(localId)}`.replace(/[^a-z0-9_-]/gi, '-').slice(0, 120)
}
function safeText(s, max) { return String(s == null ? '' : s).slice(0, max || 200) }
function safeIcon(icon) { return String(icon || '').replace(/[^a-z0-9 _-]/gi, '').slice(0, 60) }
function sanitizeIconClass(icon) { return String(icon || '').replace(/[^a-z0-9 _-]/gi, '').slice(0, 60) || 'fas fa-circle' }

/** Build an icon element from a FontAwesome class string or sanitized HTML. */
function safeIconHtml(icon) {
  if (!icon) return null
  const i = document.createElement('i')
  // accept "fa-x" / "fas fa-x" class strings only when no angle brackets
  if (/^[a-z0-9 _-]+$/i.test(String(icon))) {
    i.className = sanitizeIconClass(icon)
    return i
  }
  // otherwise treat as sanitized HTML string
  const span = document.createElement('span')
  mountVDOM(String(icon), span)
  return span
}

function safeCall(fn) { try { return fn() } catch (e) { console.warn('[contrib-ui] call failed:', e) } }
function safeCallReturn(fn) { try { return fn() } catch (e) { console.warn('[contrib-ui] call failed:', e); return null } }

function denied(method) {
  // eslint-disable-next-line no-console
  console.warn(`[contrib-ui] CAPABILITY_DENIED for ${method}`)
  return noop()
}
function noop() { return { dispose() {}, set() {}, show() {}, update() {} } }
