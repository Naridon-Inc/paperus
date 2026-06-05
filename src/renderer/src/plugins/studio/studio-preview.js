/**
 * studio-preview.js — the Plugin Studio LIVE preview pane.
 *
 * Loads the in-progress plugin (the `plugin/` deliverable of a Studio build) into an
 * isolated runtime sandbox so the author sees the ACTUAL contributed surface as the
 * agent writes it. It uses the FROZEN-CONTRACT preview mechanism — **Option A**
 * (§6): it spins a `PluginSandbox` DIRECTLY (no edit to plugin-host.js), builds the
 * `ctxDescriptor` itself, and re-checks every plugin→host call through the EXPORTED
 * `capabilityForMethod` + `hasCapability` so the preview never grants more than the
 * manifest declares. The dispatch is a minimal, preview-safe stub surface backed by a
 * throwaway scratch context — it NEVER receives a real note, key, `Y.Doc`, or
 * `Awareness` (FROZEN CONTRACT §6, §10.2).
 *
 * Phase-D non-visual fallback: many plugins contribute no visible surface (an
 * import/export format, an AI provider, a command). For those the preview shows a
 * "capabilities exercised" checklist (which host namespaces the plugin called during
 * activation) plus a manual trigger button to fire the plugin's primary command /
 * format so the author can confirm it runs.
 *
 * Web-safety (FROZEN CONTRACT §7): NO top-level node/electron imports. The build
 * source is fetched through the renderer `studioClient` (→ `studio:read-build` IPC);
 * on web that returns `{ ok:false, error:'unsupported' }` and the pane degrades to a
 * single desktop-only notice. `PluginSandbox` itself is renderer-only (iframe) and is
 * already shipped, so importing it is web-safe.
 *
 * Public surface (per the studio-editor-preview task contract):
 *   mountPreview({ el, client, buildId, controller }) → { reload(), destroy() }
 *
 * Class names belong to studio.css (owned by the studio-ui builder); this file only
 * references them.
 */

import PluginSandbox from '../plugin-sandbox.js'
import { validateManifest } from '../plugin-host.js'
import { capabilityForMethod, hasCapability, describeCapability } from '../capabilities.js'

/* ------------------------------------------------------------------------- *
 * Tiny DOM helpers (vanilla, matches the no-framework renderer style).
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
      else if (k === 'dataset') Object.assign(node.dataset, v)
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

function clearEl(node) {
  if (!node) return
  while (node.firstChild) node.removeChild(node.firstChild)
}

/* ------------------------------------------------------------------------- *
 * ctxDescriptor — the shape PluginSandbox.activate expects:
 *   { apiVersion:'1', pluginId, capabilities:string[], namespaces:Record<string,string[]> }
 * We grant only the namespaces implied by the declared capabilities; the dispatch
 * re-checks per call regardless (single-sourced gate, never re-implemented).
 * ------------------------------------------------------------------------- */

// Which host namespaces a capability unlocks, used only to populate the descriptor's
// `namespaces` hint (the per-call gate in dispatch is the real enforcement).
const CAP_NAMESPACES = {
  commands: ['commands'],
  editor: ['editor'],
  ui: ['ui'],
  sections: ['ui'],
  views: ['ui'],
  ai: ['ai'],
  auth: ['auth'],
  teams: ['teams'],
  storage: ['storage'],
  'fs:read': ['fs'],
  'fs:write': ['fs'],
  clipboard: ['ui'],
}

// A throwaway scratch document the editor namespace reads — never a real note.
const SCRATCH_TEXT = '# Scratch note\n\nThis is a throwaway preview document. Nothing here is real.\n'

function buildPreviewCtxDescriptor(manifest) {
  const caps = Array.isArray(manifest.capabilities) ? manifest.capabilities : []
  const nsSet = new Set(['events', 'notify'])
  for (const c of caps) {
    const list = CAP_NAMESPACES[c]
    if (list) for (const n of list) nsSet.add(n)
    else if (typeof c === 'string' && c.startsWith('net:')) nsSet.add('net')
  }
  const namespaces = {}
  for (const ns of nsSet) namespaces[ns] = ['*']
  return {
    apiVersion: '1',
    pluginId: manifest.id,
    capabilities: caps.slice(),
    namespaces,
  }
}

/* ------------------------------------------------------------------------- *
 * The preview factory.
 * ------------------------------------------------------------------------- */

/**
 * @param {object} opts
 * @param {HTMLElement} opts.el        host-provided container
 * @param {object} opts.client         the renderer studioClient (studio-client.js)
 * @param {number} opts.buildId        the integer build id
 * @param {object} [opts.controller]   the plugin-host controller (unused for Option A;
 *                                      accepted for forward-compat / Option B fallback)
 * @returns {{ reload(): Promise<void>, destroy(): void }}
 */
export function mountPreview(optsOrEl, maybeOpts) {
  // Accept BOTH call shapes:
  //   • contract §5.2 (consumer-driven): mountPreview(el) → { render({manifest,entrySource,assets}), dispose() }
  //     — plugin-studio.js reads the build itself and hands the record to render().
  //   • builder shape (self-driving): mountPreview({ el, client, buildId, controller })
  //     — the preview reads the build itself via studioClient and reload()s.
  let opts
  let consumerDriven = false
  if (optsOrEl && (optsOrEl.nodeType === 1 || typeof optsOrEl.appendChild === 'function')) {
    const o2 = maybeOpts || {}
    opts = { el: optsOrEl, client: o2.client || null, buildId: o2.buildId, controller: o2.controller }
    consumerDriven = !o2.client
  } else {
    opts = optsOrEl || {}
  }
  const root = opts && opts.el
  const client = (opts && opts.client) || null
  const buildId = opts && opts.buildId
  // controller is accepted but Option A does not use it (no shared-file edit needed).

  const inert = { reload: async () => {}, destroy: () => {}, render: async () => {}, dispose: () => {} }
  if (!root || typeof document === 'undefined') return inert

  // Last record handed in via render() (consumer-driven mode). When present, reload()
  // re-activates from it instead of reading the build through studioClient.
  let suppliedRecord = null

  let disposed = false
  let sandbox = null // active PluginSandbox
  let hiddenHost = null // off-screen container the sandbox iframe lives in
  let exercised = null // Set<string> of host namespaces the plugin called this activation
  let lastManifest = null
  let reloadSeq = 0 // guards against overlapping reloads

  // ── DOM scaffold ───────────────────────────────────────────────────────────
  clearEl(root)
  const wrap = el('div', { class: 'studio-preview' })
  const stage = el('div', { class: 'studio-preview-stage' }) // where visible surfaces render
  const info = el('div', { class: 'studio-preview-info' }) // checklist / status / errors
  wrap.appendChild(stage)
  wrap.appendChild(info)
  root.appendChild(wrap)

  // The sandbox iframe is hidden; visible plugin DOM is mounted into `stage` by the
  // adapters' mount path. We keep a separate hidden host so the iframe never leaks
  // layout into the preview pane.
  hiddenHost = el('div', { class: 'studio-preview-sandbox-host' })
  hiddenHost.style.position = 'absolute'
  hiddenHost.style.width = '0'
  hiddenHost.style.height = '0'
  hiddenHost.style.overflow = 'hidden'
  hiddenHost.style.left = '-9999px'
  wrap.appendChild(hiddenHost)

  function setInfo(node) {
    clearEl(info)
    if (node) info.appendChild(node)
  }

  function showErrors(errors) {
    const list = Array.isArray(errors) ? errors : [String(errors)]
    setInfo(
      el('div', { class: 'studio-preview-errors' }, [
        el('div', { class: 'studio-preview-errors-title', text: 'Preview could not run this plugin' }),
        el('ul', { class: 'studio-preview-errors-list' }, list.map((e) => el('li', { text: String(e) }))),
      ]),
    )
  }

  function showUnsupported() {
    clearEl(stage)
    setInfo(el('div', { class: 'studio-preview-unsupported', text: 'Plugin Studio needs the desktop app.' }))
  }

  function showStatus(text) {
    setInfo(el('div', { class: 'studio-preview-status', text }))
  }

  // ── preview-safe dispatch ──────────────────────────────────────────────────
  // Re-checks each plugin→host call EXACTLY like the host (exported helpers), then
  // returns a minimal, side-effect-free stub. It NEVER touches a real note, key,
  // Y.Doc, or Awareness. Visible render results (ui.statusItem / panel / section /
  // slash callout) are mounted into `stage` via the sandbox's host-mediated mount.
  function makeDispatch(manifest) {
    return (ns, method, args, sb) => {
      const full = `host.${ns}.${method}`
      const cap = capabilityForMethod(full)
      // Record which namespaces the plugin actually exercised (for the checklist).
      if (exercised) exercised.add(ns)
      if (cap === '__unknown__') {
        return { __error: { code: 'UNSUPPORTED_METHOD', message: `unknown method ${full}` } }
      }
      // Capability gate — single-sourced from capabilities.js. `null` = no cap needed;
      // 'net' is resolved per-host but the preview denies all egress outright.
      if (cap === 'net') {
        return { __error: { code: 'CAPABILITY_DENIED', message: 'network egress is disabled in preview' } }
      }
      if (cap && !hasCapability(manifest, cap)) {
        return { __error: { code: 'CAPABILITY_DENIED', message: `'${cap}' not granted` } }
      }
      return previewDispatch(ns, method, args, manifest, sb)
    }
  }

  // Minimal, preview-safe surface. Returns benign stubs and renders the few VISIBLE
  // surfaces into `stage`. Everything else is a no-op that the author can still see in
  // the "capabilities exercised" checklist.
  function previewDispatch(ns, method, args, manifest, sb) {
    try {
      // Visible UI surfaces: render the plugin's vDOM/HTML into the stage so the author
      // sees the real contributed widget. We give each a labeled slot.
      if (ns === 'ui') {
        if (method === 'statusItem' || method === 'panel' || method === 'toolbarItem'
            || method === 'navItem' || method === 'sidebarSection' || method === 'view'
            || method === 'settingsSection' || method === 'modal') {
          const spec = (args && args[0]) || {}
          const slotName = `${ns}.${method}`
          const slot = ensureStage(slotName, method)
          const render = spec && spec.render
          // A render result may be a static vDOM/HTML; mount it. (Callback-style
          // renders that need host events are mounted with a no-op onEvent.)
          if (render && typeof sb.mount === 'function' && (typeof render === 'object' || typeof render === 'string')) {
            sb.mount(slot, render, () => {})
          } else {
            slot.appendChild(el('div', { class: 'studio-preview-slot-note', text: `${slotName} registered` }))
          }
          // Hand back an opaque dispose token so the plugin's Disposable wrapper is happy.
          const tok = typeof sb.allocDisposeToken === 'function'
            ? sb.allocDisposeToken({ kind: slotName, dispose: () => { try { clearEl(slot) } catch (_e) { /* ignore */ } } })
            : 1
          return { disposeToken: tok }
        }
        if (method === 'notify') return { ok: true }
        if (method === 'clipboardRead') return { ok: true, value: '' }
        if (method === 'clipboardWrite') return { ok: true }
        return { ok: true }
      }

      // Commands / slash: acknowledge registration so the manual-trigger button can
      // later fire them. The plugin's `run` callback arrives marshaled as a
      // `{ __cb__: <token> }` marker (sandbox-runtime.js); we keep that token so the
      // non-visual fallback can invoke it via sb.invokePluginCallback (the same path
      // the real host uses), NOT a fabricated event the runtime would ignore.
      if (ns === 'commands' && method === 'register') {
        const spec = (args && args[0]) || {}
        const tok = typeof sb.allocDisposeToken === 'function' ? sb.allocDisposeToken({ kind: 'command' }) : 1
        if (spec && spec.id && !manifest.__previewPrimaryCommand) {
          const runMarker = spec.run
          const runToken = runMarker && typeof runMarker === 'object' && typeof runMarker.__cb__ !== 'undefined'
            ? runMarker.__cb__
            : null
          manifest.__previewPrimaryCommand = {
            id: spec.id,
            title: spec.title || spec.id,
            runToken,
          }
        }
        return { disposeToken: tok }
      }

      // editor: return an inert scratch snapshot (NEVER a real note). The plugin reads
      // a fake document; nothing it writes leaves the preview.
      if (ns === 'editor') {
        if (method === 'getActive') {
          return { id: 'preview-scratch', title: 'Scratch (preview)', text: SCRATCH_TEXT, selection: { from: 0, to: 0 } }
        }
        if (method === 'insert' || method === 'registerBlock' || method === 'registerDecoration' || method === 'onChange') {
          const tok = typeof sb.allocDisposeToken === 'function' ? sb.allocDisposeToken({ kind: 'editor' }) : 1
          return { disposeToken: tok }
        }
        return { ok: true }
      }

      // storage: an in-memory, per-preview namespace. Disposable on reload.
      if (ns === 'storage') {
        const store = manifest.__previewStore || (manifest.__previewStore = new Map())
        if (method === 'get') return { value: store.has(args[0]) ? store.get(args[0]) : null }
        if (method === 'set') { store.set(args[0], args[1]); return { ok: true } }
        if (method === 'delete') { store.delete(args[0]); return { ok: true } }
        if (method === 'keys') return { keys: Array.from(store.keys()) }
        return { ok: true }
      }

      // ai / auth / teams / fs / net: deny-most stubs. The author sees that the surface
      // was exercised in the checklist; the preview grants nothing real.
      if (ns === 'ai') {
        if (method === 'complete') return { text: '(preview: AI is stubbed)' }
        if (method === 'embed') return { vector: [] }
        if (method === 'registerProvider') {
          const tok = typeof sb.allocDisposeToken === 'function' ? sb.allocDisposeToken({ kind: 'ai' }) : 1
          return { disposeToken: tok }
        }
        return { ok: true }
      }
      if (ns === 'auth') {
        const tok = typeof sb.allocDisposeToken === 'function' ? sb.allocDisposeToken({ kind: 'auth' }) : 1
        return { disposeToken: tok }
      }
      if (ns === 'teams') {
        if (method === 'list') return { teams: [] }
        const tok = typeof sb.allocDisposeToken === 'function' ? sb.allocDisposeToken({ kind: 'teams' }) : 1
        return { disposeToken: tok }
      }
      if (ns === 'fs') {
        if (method === 'list') return { entries: [] }
        if (method === 'read') return { data: '' }
        if (method === 'write') return { ok: true }
        return { ok: true }
      }

      // Everything else: a benign acknowledgement.
      return { ok: true }
    } catch (e) {
      return { __error: { code: 'INTERNAL', message: (e && e.message) || 'preview dispatch failed' } }
    }
  }

  // Get (or create) a labeled slot in the stage for a given surface.
  function ensureStage(slotName, label) {
    let slot = stage.querySelector(`[data-slot="${cssEsc(slotName)}"]`)
    if (!slot) {
      const block = el('div', { class: 'studio-preview-surface', dataset: { slot: slotName } }, [
        el('div', { class: 'studio-preview-surface-label', text: label || slotName }),
      ])
      slot = el('div', { class: 'studio-preview-surface-body' })
      block.appendChild(slot)
      stage.appendChild(block)
    }
    return slot
  }

  function cssEsc(s) {
    return String(s).replace(/["\\]/g, '\\$&')
  }

  // ── read the build, validate, spin the sandbox ─────────────────────────────
  // The studioClient may expose a named `readBuild` method OR a generic
  // `invoke(channel, payload)` passthrough; support both and normalize the "no
  // desktop" signal to { ok:false, error:'unsupported' }.
  async function readBuild() {
    try {
      if (client && typeof client.readBuild === 'function') {
        const res = await client.readBuild(buildId)
        return res || { ok: false, error: 'unsupported' }
      }
      if (client && typeof client.invoke === 'function') {
        const res = await client.invoke('studio:read-build', { buildId })
        return res || { ok: false, error: 'unsupported' }
      }
      return { ok: false, error: 'unsupported' }
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) }
    }
  }

  async function teardownSandbox() {
    const sb = sandbox
    sandbox = null
    if (sb) {
      try { await sb.deactivate() } catch (_e) { /* deactivate must not throw out */ }
      try { sb.dispose() } catch (_e) { /* ignore */ }
    }
  }

  async function reload() {
    if (disposed) return
    const myReload = (reloadSeq += 1)
    await teardownSandbox()
    if (disposed || myReload !== reloadSeq) return

    clearEl(stage)
    showStatus('Loading preview…')

    // Consumer-driven mode (plugin-studio.js): use the record handed to render().
    // Self-driving mode: read the build through studioClient.
    let res
    if (suppliedRecord) {
      res = { ok: true, manifest: suppliedRecord.manifest, entrySource: suppliedRecord.entrySource }
    } else {
      res = await readBuild()
    }
    if (disposed || myReload !== reloadSeq) return
    if (!res.ok) {
      if (res.error === 'unsupported') { showUnsupported(); return }
      showErrors([res.error || 'could not read build'])
      return
    }

    const { manifest: validated, errors } = validateManifest(res.manifest)
    if (!validated) {
      showErrors(errors && errors.length ? errors : ['plugin.json is missing or invalid'])
      return
    }
    const entrySource = typeof res.entrySource === 'string' ? res.entrySource : ''
    if (!entrySource.trim()) {
      showErrors(['the plugin entry (index.js) is empty'])
      return
    }
    lastManifest = validated
    // assets from studio:read-build are base64 maps; the preview does not need to wire
    // them into the iframe (style.css etc. are inert here), so we ignore them safely.

    exercised = new Set()
    const ctxDescriptor = buildPreviewCtxDescriptor(validated)

    let sb
    try {
      sb = new PluginSandbox({
        id: validated.id,
        manifest: validated,
        entrySource,
        container: hiddenHost,
        onQuarantine: (id, reason) => {
          if (disposed || myReload !== reloadSeq) return
          showErrors([`Plugin quarantined: ${reason || 'misbehaved'}`])
        },
        dispatch: makeDispatch(validated),
      })
    } catch (e) {
      showErrors([`Could not create sandbox: ${(e && e.message) || String(e)}`])
      return
    }

    sandbox = sb
    try {
      await sb.load()
      if (disposed || myReload !== reloadSeq) { try { sb.dispose() } catch (_e) { /* ignore */ } return }
      await sb.activate(ctxDescriptor)
    } catch (e) {
      // activate() already quarantines on failure; surface it.
      if (!disposed && myReload === reloadSeq) {
        showErrors([`Activation failed: ${(e && e.message) || String(e)}`])
      }
      return
    }
    if (disposed || myReload !== reloadSeq) return

    renderInfoPanel(validated)
  }

  // ── info panel: visible-surface note OR the non-visual fallback checklist ────
  function renderInfoPanel(manifest) {
    const hasVisible = !!stage.querySelector('.studio-preview-surface')
    const caps = Array.isArray(manifest.capabilities) ? manifest.capabilities : []

    if (hasVisible) {
      // Visible plugin: a small status line under the rendered surface(s).
      setInfo(el('div', { class: 'studio-preview-status', text: `Rendered live surface for "${manifest.name || manifest.id}".` }))
      return
    }

    // Phase-D non-visual fallback: capabilities-exercised checklist + manual trigger.
    clearEl(stage)
    const box = el('div', { class: 'studio-preview-nonvisual' })
    box.appendChild(el('div', { class: 'studio-preview-nonvisual-title', text: 'No visible surface' }))
    box.appendChild(el('div', {
      class: 'studio-preview-nonvisual-sub',
      text: 'This plugin contributes no on-screen widget. It activated cleanly. Capabilities it can use:',
    }))

    const checklist = el('ul', { class: 'studio-preview-checklist' })
    if (!caps.length) {
      checklist.appendChild(el('li', { class: 'studio-preview-check muted', text: 'no capabilities (inert plugin)' }))
    }
    for (const c of caps) {
      const usedNs = capToNamespaces(c).some((n) => exercised && exercised.has(n))
      checklist.appendChild(
        el('li', { class: 'studio-preview-check' + (usedNs ? ' used' : '') }, [
          el('span', { class: 'studio-preview-check-mark', text: usedNs ? '✓' : '○' }),
          el('span', { class: 'studio-preview-check-cap', text: c }),
          el('span', { class: 'studio-preview-check-desc', text: describeCapability(c) }),
        ]),
      )
    }
    box.appendChild(checklist)

    // Manual trigger: fire the plugin's primary registered command, if any.
    const primary = manifest.__previewPrimaryCommand
    const triggerRow = el('div', { class: 'studio-preview-trigger-row' })
    const triggerBtn = el('button', {
      class: 'studio-btn primary',
      text: primary ? `Run "${primary.title}"` : 'Run primary command',
    })
    triggerBtn.disabled = !primary
    triggerBtn.title = primary
      ? `Execute ${primary.id} against the scratch preview`
      : 'This plugin registered no command to trigger'
    triggerBtn.addEventListener('click', () => { void runPrimary(manifest) })
    triggerRow.appendChild(triggerBtn)
    box.appendChild(triggerRow)

    const triggerOut = el('div', { class: 'studio-preview-trigger-out' })
    box.appendChild(triggerOut)
    box._out = triggerOut

    setInfo(box)
  }

  // Map a capability to the host namespace(s) that, when exercised, satisfy it.
  function capToNamespaces(cap) {
    if (cap === 'sections' || cap === 'views' || cap === 'clipboard') return ['ui']
    if (cap === 'fs:read' || cap === 'fs:write') return ['fs']
    if (typeof cap === 'string' && cap.startsWith('net:')) return ['net']
    return [cap]
  }

  // Manually fire the plugin's primary command into the live sandbox. The command's
  // `run` callback was marshaled at registration as a callback token; we invoke it via
  // sb.invokePluginCallback — the exact path the real host uses to run a command —
  // rather than a fabricated event the runtime would ignore.
  async function runPrimary(manifest) {
    const sb = sandbox
    const primary = manifest && manifest.__previewPrimaryCommand
    if (!sb || !primary) return
    const box = info.querySelector('.studio-preview-nonvisual')
    const out = box && box._out
    try {
      if (primary.runToken == null || typeof sb.invokePluginCallback !== 'function') {
        if (out) {
          clearEl(out)
          out.appendChild(el('div', { class: 'studio-preview-trigger-err', text: 'This command has no runnable handler to trigger.' }))
        }
        return
      }
      // Invoke the plugin's command handler with a benign empty args list. The plugin
      // runs against the scratch context; any host calls it makes route back through
      // the same capability-checked dispatch.
      sb.invokePluginCallback(primary.runToken, [])
      // The visible surfaces (if the command renders one) appear in the stage; re-scan
      // so a command that DID produce a widget surfaces it.
      if (out) {
        clearEl(out)
        out.appendChild(el('div', { class: 'studio-preview-trigger-ok', text: `Triggered ${primary.id}. Any output appears above or in the transcript.` }))
      }
    } catch (e) {
      if (out) {
        clearEl(out)
        out.appendChild(el('div', { class: 'studio-preview-trigger-err', text: `Trigger failed: ${(e && e.message) || String(e)}` }))
      }
    }
  }

  // ── boot ───────────────────────────────────────────────────────────────────
  // Self-driving mode reads the build immediately. Consumer-driven mode waits for
  // the first render({ manifest, entrySource, assets }) call from plugin-studio.js.
  if (!consumerDriven) void reload()
  else showStatus('Build a plugin to see a live preview.')

  // Consumer-driven render: accept the build record directly and (re)activate.
  async function render(record) {
    suppliedRecord = record && typeof record === 'object' ? record : null
    if (!suppliedRecord || suppliedRecord.manifest == null) {
      clearEl(stage)
      showStatus('Build a plugin to see a live preview.')
      return
    }
    await reload()
  }

  function destroy() {
    if (disposed) return
    disposed = true
    reloadSeq += 1
    // Fire-and-forget teardown; never throw out of destroy().
    void teardownSandbox()
    try { clearEl(root) } catch (_e) { /* ignore */ }
    sandbox = null
    hiddenHost = null
    lastManifest = null
  }

  return {
    reload: () => reload(),
    destroy,
    // Contract §5.2 consumer-driven surface (used by plugin-studio.js):
    render: (record) => render(record),
    dispose: destroy,
  }
}

export default mountPreview
