/**
 * plugin-settings.js — the in-app "Plugins…" panel (account menu ▸ Developer ▸
 * Plugins…). The official MANAGEMENT surface for installed plugins; authoring
 * lives in the SDK + the `create-notionless-plugin` scaffolder, not here.
 *
 * This is a vanilla-DOM modal (no framework), matching the renderer's existing
 * dialog conventions (see team-dialogs.js) and reusing the plugin-system styles
 * already shipped in plugins.css (`.plugin-modal*`, `.plugin-list`, `.plugin-row*`,
 * `.plugin-btn`, `.plugin-empty*`). It owns NO plugin state — the orchestrator
 * passes a `controller` (built from the existing plugin host) and this file only
 * renders it and relays user actions back.
 *
 * Controller contract (design-to; the orchestrator implements it):
 *   controller.list()        → Array<{ id, name, version, enabled, description }>
 *   controller.enable(id)    → Promise              (resolves when enabled)
 *   controller.disable(id)   → Promise              (resolves when disabled)
 *   controller.reload(id)    → Promise              (hot-reload from disk)
 *   controller.openFolder()  → void | Promise       (reveal the plugins folder)
 *   controller.quickstartUrl → string               (SDK quickstart docs URL)
 *
 * Any method may be missing — every call is guarded and degrades gracefully. If
 * `controller` is absent/empty (or lists no plugins) the modal shows a friendly
 * "No plugins installed" state that still links to the SDK quickstart.
 *
 * Export: `openPluginSettings(controller)` → opens the modal, returns a handle
 * `{ close() }`. Close via Esc, backdrop click, or the ✕ button.
 */

const FALLBACK_QUICKSTART_URL = 'https://github.com/Naridon-Inc/paperus/blob/master/docs/PLUGIN_SYSTEM.md'

/* ------------------------------------------------------------------------- *
 * Tiny DOM helper (vanilla, mirrors the no-framework renderer style used in
 * plugin-lab.js so rows render identically).
 * ------------------------------------------------------------------------- */
function el(tag, attrs, children) {
  const node = document.createElement(tag)
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k]
      if (v == null) continue
      if (k === 'class') node.className = v
      else if (k === 'text') node.textContent = v
      else if (k === 'html') node.innerHTML = v
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v)
      } else node.setAttribute(k, v)
    }
  }
  if (children != null) {
    const list = Array.isArray(children) ? children : [children]
    for (const c of list) {
      if (c == null) continue
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    }
  }
  return node
}

/**
 * Inject the few styles this modal needs that aren't already in plugins.css:
 * a viewport-fixed overlay (plugins.css's `.plugin-modal-overlay` is
 * position:absolute, scoped to the lab view), a small enable/disable switch, and
 * the footer link row. Everything else reuses existing plugin-system classes.
 */
function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('plugin-settings-styles')) return
  const s = document.createElement('style')
  s.id = 'plugin-settings-styles'
  s.textContent = `
  .plugin-settings-overlay {
    position: fixed; inset: 0; z-index: 10000;
    display: flex; align-items: center; justify-content: center;
    padding: 40px; background: rgba(0, 0, 0, 0.32);
    animation: plugin-settings-fade 0.12s ease;
  }
  @keyframes plugin-settings-fade { from { opacity: 0; } to { opacity: 1; } }

  /* The enable/disable switch (checkbox-driven, accessible). */
  .plugin-switch { position: relative; display: inline-block; width: 38px; height: 21px; flex-shrink: 0; }
  .plugin-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
  .plugin-switch .plugin-switch-track {
    position: absolute; inset: 0; border-radius: 999px;
    background: var(--border, #d8d8d8); transition: background 0.14s ease; pointer-events: none;
  }
  .plugin-switch .plugin-switch-thumb {
    position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.25); transition: transform 0.14s ease; pointer-events: none;
  }
  .plugin-switch input:checked + .plugin-switch-track { background: var(--accent, #2383e2); }
  .plugin-switch input:checked + .plugin-switch-track + .plugin-switch-thumb { transform: translateX(17px); }
  .plugin-switch input:disabled { cursor: default; }
  .plugin-switch input:disabled + .plugin-switch-track { opacity: 0.55; }
  .plugin-switch input:focus-visible + .plugin-switch-track {
    outline: 2px solid var(--accent, #2383e2); outline-offset: 2px;
  }

  .plugin-settings-foot {
    flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 16px;
    align-items: center; padding: 13px 18px;
    border-top: 1px solid var(--border, #eaeaea);
  }
  .plugin-settings-foot a {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--accent, #2383e2);
    text-decoration: none; cursor: pointer; background: none; border: none; padding: 0;
  }
  .plugin-settings-foot a:hover { text-decoration: underline; }
  .plugin-settings-foot .spacer { flex: 1; }
  `
  document.head.appendChild(s)
}

/* ------------------------------------------------------------------------- *
 * Defensive controller calls — never throw out of a click handler.
 * ------------------------------------------------------------------------- */
async function callController(fn) {
  try {
    const res = await fn()
    if (res && res.ok === false) return { ok: false, error: res.error || 'unknown error' }
    return { ok: true, value: res }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) }
  }
}

/** Read controller.list() defensively → always an array of normalized records. */
function readList(controller) {
  if (!controller || typeof controller.list !== 'function') return []
  let raw
  try {
    raw = controller.list()
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p) => p && (p.id != null))
    .map((p) => ({
      id: String(p.id),
      name: p.name ? String(p.name) : String(p.id),
      version: p.version ? String(p.version) : '0.0.0',
      enabled: !!p.enabled,
      description: p.description ? String(p.description) : '',
    }))
}

/** Open the host's plugins folder in the OS file manager (via the controller). */
function openExternal(url) {
  if (!url) return
  if (window.api && typeof window.api.invoke === 'function') {
    window.api.invoke('shell:openExternal', url).catch(() => {})
  }
}

/* ------------------------------------------------------------------------- *
 * Public API
 * ------------------------------------------------------------------------- */

/**
 * Open the "Plugins…" management modal.
 * @param {object} [controller] see the controller contract in the file header.
 * @returns {{ close: () => void }}
 */
export function openPluginSettings(controller) {
  injectStyles()

  const quickstartUrl = (controller && typeof controller.quickstartUrl === 'string' && controller.quickstartUrl)
    || FALLBACK_QUICKSTART_URL

  // --- Overlay + shell -----------------------------------------------------
  const overlay = el('div', { class: 'plugin-settings-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Plugins' })
  const modal = el('div', { class: 'plugin-modal' })
  overlay.appendChild(modal)

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    document.removeEventListener('keydown', onKey, true)
    overlay.remove()
  }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  document.addEventListener('keydown', onKey, true)
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close() })

  // --- Header --------------------------------------------------------------
  const closeBtn = el('button', {
    class: 'plugin-modal-close',
    type: 'button',
    title: 'Close',
    'aria-label': 'Close',
    text: '✕',
    onClick: close,
  })
  modal.appendChild(el('div', { class: 'plugin-modal-head' }, [
    el('div', { class: 'plugin-modal-title' }, [
      el('i', { class: 'fa-solid fa-plug', 'aria-hidden': 'true' }),
      el('span', { text: 'Plugins' }),
    ]),
    closeBtn,
  ]))

  // --- Body (re-rendered after every action) -------------------------------
  const body = el('div', { class: 'plugin-modal-body' })
  modal.appendChild(body)

  /** Re-read the controller and rebuild the list area. */
  function render() {
    body.replaceChildren()
    const plugins = readList(controller)

    if (!controller || plugins.length === 0) {
      body.appendChild(buildEmptyState(quickstartUrl))
      return
    }

    const list = el('div', { class: 'plugin-list' })
    for (const rec of plugins) list.appendChild(buildRow(rec))
    body.appendChild(list)
  }

  /** Build one plugin row: meta + description, with a switch + Reload button. */
  function buildRow(rec) {
    const row = el('div', { class: 'plugin-row' + (rec.enabled ? ' enabled' : '') })

    const meta = el('div', { class: 'plugin-row-meta' }, [
      el('div', { class: 'plugin-row-title' }, [
        el('span', { class: 'plugin-row-name', text: rec.name }),
        el('span', { class: 'plugin-row-version', text: 'v' + rec.version }),
        el('span', {
          class: 'plugin-row-state ' + (rec.enabled ? 'on' : 'off'),
          text: rec.enabled ? 'enabled' : 'disabled',
        }),
      ]),
      el('div', { class: 'plugin-row-desc', text: rec.description || 'No description provided.' }),
    ])

    // Enable/disable switch (a styled checkbox — accessible + keyboard-toggleable).
    const checkbox = el('input', {
      type: 'checkbox',
      role: 'switch',
      'aria-label': (rec.enabled ? 'Disable ' : 'Enable ') + rec.name,
    })
    checkbox.checked = rec.enabled
    const sw = el('label', { class: 'plugin-switch', title: rec.enabled ? 'Disable' : 'Enable' }, [
      checkbox,
      el('span', { class: 'plugin-switch-track', 'aria-hidden': 'true' }),
      el('span', { class: 'plugin-switch-thumb', 'aria-hidden': 'true' }),
    ])

    const reloadBtn = el('button', {
      class: 'plugin-btn',
      type: 'button',
      title: 'Reload from disk',
    }, 'Reload')

    const setBusy = (busy) => {
      checkbox.disabled = busy
      reloadBtn.disabled = busy
      reloadBtn.classList.toggle('busy', busy)
    }

    checkbox.addEventListener('change', async () => {
      const wantEnabled = checkbox.checked
      const method = wantEnabled ? 'enable' : 'disable'
      if (!controller || typeof controller[method] !== 'function') {
        // No handler: revert the toggle so the UI stays truthful.
        checkbox.checked = !wantEnabled
        return
      }
      setBusy(true)
      const res = await callController(() => controller[method](rec.id))
      setBusy(false)
      if (!res.ok) checkbox.checked = !wantEnabled // revert on failure
      render() // re-read authoritative state from the controller
    })

    reloadBtn.addEventListener('click', async () => {
      if (!controller || typeof controller.reload !== 'function') return
      setBusy(true)
      await callController(() => controller.reload(rec.id))
      setBusy(false)
      render()
    })

    row.appendChild(meta)
    row.appendChild(el('div', { class: 'plugin-row-actions' }, [sw, reloadBtn]))
    return row
  }

  render()

  // --- Footer links --------------------------------------------------------
  const quickstartLink = el('a', {
    href: '#',
    title: 'Open the Plugin SDK quickstart',
    onClick: (e) => { e.preventDefault(); openExternal(quickstartUrl) },
  }, [
    el('i', { class: 'fa-solid fa-book', 'aria-hidden': 'true' }),
    el('span', { text: 'Plugin SDK quickstart' }),
  ])

  const foot = el('div', { class: 'plugin-settings-foot' }, [quickstartLink, el('span', { class: 'spacer' })])

  if (controller && typeof controller.openFolder === 'function') {
    foot.appendChild(el('a', {
      href: '#',
      title: 'Open the plugins folder',
      onClick: (e) => { e.preventDefault(); callController(() => controller.openFolder()) },
    }, [
      el('i', { class: 'fa-solid fa-folder-open', 'aria-hidden': 'true' }),
      el('span', { text: 'Open plugins folder' }),
    ]))
  }
  modal.appendChild(foot)

  document.body.appendChild(overlay)
  // Focus the close button so Esc/Enter and screen readers have a sane anchor.
  try { closeBtn.focus() } catch { /* ignore */ }

  return { close }
}

/** Friendly empty state shown when there's no controller or zero plugins. */
function buildEmptyState(quickstartUrl) {
  const wrap = el('div', { class: 'plugin-empty' })
  wrap.appendChild(el('div', { class: 'plugin-empty-icon' }, [
    el('i', { class: 'fa-solid fa-plug', 'aria-hidden': 'true' }),
  ]))
  wrap.appendChild(el('div', { class: 'plugin-empty-title', text: 'No plugins installed' }))
  wrap.appendChild(el('div', {
    class: 'plugin-empty-sub',
    text: 'Build one with the Plugin SDK, then drop its folder into your plugins directory and reload it here.',
  }))
  wrap.appendChild(el('div', { class: 'plugin-empty-sub', html: '&nbsp;' }))
  wrap.appendChild(el('a', {
    href: '#',
    style: 'color: var(--accent, #2383e2); font-size: 12px; text-decoration: none; cursor: pointer;',
    onClick: (e) => { e.preventDefault(); openExternal(quickstartUrl) },
    text: 'Open the Plugin SDK quickstart →',
  }))
  return wrap
}

export default openPluginSettings
