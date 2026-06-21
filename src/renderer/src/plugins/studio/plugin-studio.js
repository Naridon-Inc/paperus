// plugin-studio.js — the Plugin Studio view (Frozen Plugin Studio Contract v1).
//
// The agentic, multi-harness, UI-based plugin builder that graduates the
// single-shot "Generate with Claude" box in plugin-lab.js. It mounts:
//   • a harness picker (populated via studio:agent-detect),
//   • a goal/chat input + streaming transcript / tool-log (studio:event),
//   • a remix/template start gallery (Phase E),
//   • a CM6 code editor + live preview pane (Phase C, via sibling modules),
//   • a token/cost + duration readout (Phase E),
//   • the action bar Build / Fix errors / Reload / Install / Export (Phase D),
//   • a build lifecycle (studio:create-workspace on first Build).
//
// It owns NO secrets and talks to main ONLY through studio-client.js. Every entry
// point is defensive: nothing thrown here escapes into the host app. On the web
// build (no desktop), it degrades to a single "needs the desktop app" notice.
//
// Mirrors createPluginLab({ controller, ragEngine }) → { mount, refresh, dispose }.
// Integration: the integrator mounts an empty <div id="plugin-studio-view"> and
// constructs `createPluginStudio({ controller, ragEngine })` gated by
// `Features.pluginStudio`. See integrationNotes.

import './studio.css'

import { studioClient } from './studio-client.js'
import { mountTranscript } from './studio-transcript.js'
import { mountCodeEditor } from './studio-code-editor.js'
import { mountPreview } from './studio-preview.js'
import { buildCapabilitiesMarkdown } from './studio-capabilities-md.js'
import { createApiLoopProvider } from './providers/api-loop.js'

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

function clear(node) {
  if (!node) return
  while (node.firstChild) node.removeChild(node.firstChild)
}

/* ------------------------------------------------------------------------- *
 * Start-gallery templates / remix sources (Phase E). `template` seeds via the
 * scaffold map; `remixFrom` copies an example folder. Kept in lockstep with the
 * frozen template→capabilities map and the five shipped examples.
 * ------------------------------------------------------------------------- */

const TEMPLATES = Object.freeze([
  { key: 'blank', label: 'Blank', icon: 'fa-file', kind: 'template', hint: 'Start from an empty plugin scaffold.' },
  { key: 'word-count', label: 'Word count', icon: 'fa-calculator', kind: 'remix', hint: 'Status-bar word/reading-time item.' },
  { key: 'custom-callout', label: 'Custom callout', icon: 'fa-bullhorn', kind: 'remix', hint: 'A new fenced callout block.' },
  { key: 'ai-summarize', label: 'AI summarize', icon: 'fa-wand-magic-sparkles', kind: 'remix', hint: 'A command that summarizes the note.' },
  { key: 'magic-login', label: 'Magic login', icon: 'fa-key', kind: 'remix', hint: 'An alternate unlock method.' },
  { key: 'custom-section', label: 'Custom section', icon: 'fa-table-columns', kind: 'remix', hint: 'A sidebar section.' },
])

/* ------------------------------------------------------------------------- *
 * The Studio controller factory.
 *
 * @param {object} deps
 * @param {object} [deps.controller] - the live plugin controller (initPluginSystem).
 *        Only `registrySnapshot()` is read (for CAPABILITIES.md). Optional.
 * @param {object} [deps.ragEngine] - the RAGEngine instance; drives the built-in
 *        API loop provider. Optional (API loop reports unavailable without it).
 * @returns {{ mount(viewEl): Promise<void>, refresh(): Promise<void>, dispose(): void }}
 * ------------------------------------------------------------------------- */

export function createPluginStudio(deps) {
  const controller = (deps && deps.controller) || null
  const ragEngine = (deps && deps.ragEngine) || null

  const client = studioClient

  // Mutable view state.
  let root = null
  let disposed = false
  let supported = null // null=unknown, true=desktop, false=web/unsupported

  // DOM handles populated in build().
  let ui = null

  // Build/session state.
  let buildId = null // current workspace build id (number) or null
  let sessionId = null // active agent session id or null
  let unsubscribe = null // current session event unsubscribe
  let providers = [] // detected providers [{ id,label,kind,available,reason }]
  let selectedProviderId = null
  let lastErrors = [] // latest build-check / runtime errors (for "Fix errors")
  let busy = false
  let startedAt = 0 // session wall-clock start for the duration readout
  let durationTimer = null

  // Sub-mounts (transcript / editor / preview).
  let transcript = null
  let editor = null
  let preview = null
  let editorPath = 'plugin/index.js' // file currently open in the editor

  // The renderer-side API-loop provider (Phase C). Created lazily.
  const apiLoopProvider = createApiLoopProvider({ ragEngine, studioClient: client })

  // The active renderer-local (api-loop) AgentSession, when one is running.
  let apiSession = null

  /* ---- small helpers ---------------------------------------------------- */

  function toast(message, kind) {
    try {
      const stack = root && root.querySelector('.studio-toasts')
      if (!stack) { console.log('[plugin-studio]', kind || 'info', message); return }
      const t = el('div', { class: 'studio-toast ' + (kind || 'info'), text: message })
      stack.appendChild(t)
      setTimeout(() => { try { t.remove() } catch (_) {} }, 4200)
    } catch (_) { console.log('[plugin-studio]', message) }
  }

  function setBusy(b, label) {
    busy = b
    if (!ui) return
    const bar = ui.actionButtons || []
    for (const btn of bar) { if (btn) btn.disabled = b }
    if (ui.buildBtn) {
      ui.buildBtn.classList.toggle('busy', b)
      if (b && label) ui.buildBtn.textContent = label
      else if (!b && ui.buildBtn.dataset._label) ui.buildBtn.textContent = ui.buildBtn.dataset._label
    }
  }

  function setStatus(text) {
    if (ui && ui.statusLine) ui.statusLine.textContent = text || ''
  }

  function fmtDuration(ms) {
    if (!ms || ms < 0) return '0s'
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    return `${m}m ${s % 60}s`
  }

  function startDurationTicker() {
    startedAt = Date.now()
    stopDurationTicker()
    durationTimer = setInterval(() => {
      if (ui && ui.durationReadout) ui.durationReadout.textContent = fmtDuration(Date.now() - startedAt)
    }, 1000)
  }

  function stopDurationTicker() {
    if (durationTimer) { clearInterval(durationTimer); durationTimer = null }
  }

  /* ---- provider detection ----------------------------------------------- */

  async function detectProviders() {
    const out = []
    // Main-side providers (CLI + external) come from studio:agent-detect.
    try {
      const res = await client.agentDetect()
      if (res && res.ok && Array.isArray(res.providers)) {
        for (const p of res.providers) out.push(p)
      }
    } catch (_) { /* ignore — handled by supported check */ }
    // Renderer-side built-in API loop (declared here, surfaced directly).
    try {
      const d = await apiLoopProvider.detect()
      out.push({
        id: apiLoopProvider.id,
        label: apiLoopProvider.label,
        kind: apiLoopProvider.kind,
        available: !!(d && d.available),
        version: d && d.version,
        reason: d && d.reason,
      })
    } catch (_) { /* ignore */ }
    providers = out
    // Default selection: first available, preferring claude-code → gemini → api.
    if (!selectedProviderId || !providers.find((p) => p.id === selectedProviderId)) {
      const order = ['claude-code', 'gemini-cli', 'api-anthropic', 'generic-cli', 'external']
      const avail = providers.filter((p) => p.available)
      const pick = order.map((id) => avail.find((p) => p.id === id)).find(Boolean)
        || avail[0] || providers[0]
      selectedProviderId = pick ? pick.id : null
    }
    renderProviderPicker()
  }

  function renderProviderPicker() {
    if (!ui || !ui.providerSelect) return
    const sel = ui.providerSelect
    clear(sel)
    if (!providers.length) {
      sel.appendChild(el('option', { value: '', text: 'No harness detected' }))
      sel.disabled = true
      return
    }
    sel.disabled = false
    for (const p of providers) {
      const label = p.available
        ? `${p.label}${p.version ? ` (${p.version})` : ''}`
        : `${p.label} — unavailable`
      const opt = el('option', { value: p.id, text: label })
      if (!p.available) opt.disabled = false // keep selectable to show the reason
      if (p.id === selectedProviderId) opt.selected = true
      sel.appendChild(opt)
    }
    // Reason hint under the picker.
    const cur = providers.find((p) => p.id === selectedProviderId)
    if (ui.providerHint) {
      ui.providerHint.textContent = cur && !cur.available && cur.reason
        ? cur.reason
        : (cur && cur.available ? 'Ready.' : '')
    }
  }

  /* ---- transcript / event routing --------------------------------------- */

  function onAgentEvent(ev) {
    if (disposed || !ev) return
    try { if (transcript && typeof transcript.push === 'function') transcript.push(ev) } catch (_) {}
    switch (ev.type) {
      case 'status':
        setStatus(ev.text || '')
        break
      case 'error':
        lastErrors = [ev.text || 'Unknown error']
        if (ui && ui.fixBtn) ui.fixBtn.disabled = false
        setStatus('Error — see transcript.')
        break
      case 'file':
        // A file changed: refresh the editor (if it shows this file) and preview.
        void onFileChanged(ev.path)
        break
      case 'done':
        setStatus('Done.')
        setBusy(false)
        stopDurationTicker()
        void runBuildCheck(true)
        void refreshPreview()
        break
      default:
        break
    }
  }

  async function onFileChanged(path) {
    // Hot-reload the preview on any plugin/ change; refresh the editor if the
    // changed file is the one currently open.
    try {
      if (path && path === editorPath && editor && buildId != null) {
        const res = await client.fsRead(buildId, path)
        if (res && res.ok && typeof res.data === 'string' && typeof editor.setText === 'function') {
          editor.setText(res.data)
        }
      }
    } catch (_) {}
    await refreshPreview()
  }

  /* ---- workspace lifecycle ---------------------------------------------- */

  async function ensureWorkspace(template, remixFrom, goal) {
    if (buildId != null) return buildId
    setStatus('Creating workspace…')
    const capabilitiesMarkdown = (() => {
      try { return buildCapabilitiesMarkdown(controller) } catch (_) { return '' }
    })()
    const payload = { goal: goal || '', capabilitiesMarkdown }
    if (remixFrom) payload.remixFrom = remixFrom
    else if (template) payload.template = template
    const res = await client.createWorkspace(payload)
    if (!res || !res.ok || res.buildId == null) {
      toast(`Could not create workspace: ${(res && res.error) || 'unknown'}`, 'error')
      setStatus('Workspace creation failed.')
      return null
    }
    buildId = res.buildId
    if (ui && ui.buildBadge) ui.buildBadge.textContent = `build-${buildId}`
    setStatus(`Workspace build-${buildId} ready.`)
    await loadEditorFile('plugin/index.js')
    await refreshPreview()
    enableShipButtons(true)
    return buildId
  }

  function enableShipButtons(on) {
    if (!ui) return
    for (const b of [ui.reloadBtn, ui.installBtn, ui.exportBtn]) if (b) b.disabled = !on
  }

  /* ---- agent session ---------------------------------------------------- */

  async function startBuild() {
    if (busy) return
    const goal = (ui.goalInput.value || '').trim()
    if (!goal) { toast('Describe the plugin you want to build.', 'warn'); return }
    const provider = providers.find((p) => p.id === selectedProviderId)
    if (!provider) { toast('Pick a harness first.', 'warn'); return }
    if (!provider.available) {
      toast(provider.reason || `${provider.label} is unavailable.`, 'warn')
      return
    }

    setBusy(true, 'Building…')
    if (transcript && transcript.clear) transcript.clear()
    lastErrors = []
    if (ui.fixBtn) ui.fixBtn.disabled = true

    const id = await ensureWorkspace(
      ui.selectedTemplate || 'blank',
      ui.selectedRemix || null,
      goal,
    )
    if (id == null) { setBusy(false); return }

    startDurationTicker()
    setStatus('Starting agent…')

    // The renderer-side api provider runs in-process; CLI/external run in main.
    if (provider.kind === 'api') {
      await startApiSession(id, goal, provider)
    } else {
      await startMainSession(id, goal, provider)
    }
  }

  async function startMainSession(id, goal, provider) {
    const res = await client.agentStart({
      buildId: id,
      providerId: provider.id,
      goal,
      model: ui.modelInput ? (ui.modelInput.value || undefined) : undefined,
    })
    if (!res || !res.ok || res.sessionId == null) {
      toast(`Agent failed to start: ${(res && res.error) || 'unknown'}`, 'error')
      setBusy(false); stopDurationTicker()
      return
    }
    sessionId = res.sessionId
    if (unsubscribe) { try { unsubscribe() } catch (_) {} }
    unsubscribe = client.subscribe(sessionId, onAgentEvent)
    setStatus(`Agent running (${provider.label}).`)
  }

  async function startApiSession(id, goal, provider) {
    // The built-in API loop is a renderer-side provider; it streams the SAME
    // AgentEvent union directly into onAgentEvent (no IPC session id).
    const systemContext = await buildApiSystemContext(id)
    if (unsubscribe) { try { unsubscribe() } catch (_) {} ; unsubscribe = null }
    sessionId = -1 // sentinel: renderer-local session
    try {
      apiSession = provider.createSession({
        buildId: id,
        workspaceDir: '', // api loop addresses files by relative path via studio:fs-*
        systemContext,
        goal,
        onEvent: onAgentEvent,
      })
      setStatus(`Agent running (${provider.label}).`)
    } catch (e) {
      toast(`Agent failed to start: ${(e && e.message) || e}`, 'error')
      setBusy(false); stopDurationTicker()
    }
  }

  async function buildApiSystemContext(id) {
    // The api loop gets the author guide + CAPABILITIES.md text as system prompt.
    let caps = ''
    try {
      const r = await client.fsRead(id, 'CAPABILITIES.md')
      if (r && r.ok && typeof r.data === 'string') caps = r.data
    } catch (_) {}
    if (!caps) { try { caps = buildCapabilitiesMarkdown(controller) } catch (_) {} }
    return [
      'You are an expert Paperus plugin author building a plugin in this workspace.',
      'Conform exactly to the frozen Plugin API (apiVersion "1").',
      '',
      caps,
    ].join('\n')
  }

  async function sendFollowup(message) {
    if (!message) return
    if (apiSession) { try { apiSession.send(message) } catch (_) {} ; return }
    if (sessionId != null && sessionId >= 0) {
      const res = await client.agentSend(sessionId, message)
      if (res && res.ok === false) toast(`Could not send: ${res.error || 'unknown'}`, 'error')
    } else {
      toast('Start a build first.', 'warn')
    }
  }

  async function cancelSession() {
    if (apiSession) { try { apiSession.cancel() } catch (_) {} ; apiSession = null }
    if (sessionId != null && sessionId >= 0) {
      await client.agentCancel(sessionId)
    }
    setBusy(false)
    stopDurationTicker()
    setStatus('Cancelled.')
  }

  /* ---- self-heal: "Fix errors" (Phase D) -------------------------------- */

  async function fixErrors() {
    if (busy) return
    // Pull the freshest errors from a build-check so the fix turn is grounded.
    const fresh = await runBuildCheck(false)
    const errs = (fresh && fresh.length) ? fresh : lastErrors
    if (!errs || !errs.length) { toast('No errors to fix — the build is clean.', 'success'); return }
    const msg = [
      'The current build has the following errors. Fix them and re-run a build check:',
      '',
      ...errs.map((e) => `  • ${e}`),
    ].join('\n')
    if (transcript && transcript.push) {
      transcript.push({ type: 'status', text: 'Sending errors back to the agent…' })
    }
    setBusy(true, 'Fixing…')
    startDurationTicker()
    await sendFollowup(msg)
  }

  /* ---- build check ------------------------------------------------------ */

  async function runBuildCheck(announce) {
    if (buildId == null) return []
    const res = await client.buildCheck(buildId)
    if (!res || res.ok === false) {
      if (announce) toast(`Build check failed to run: ${(res && res.error) || 'unknown'}`, 'error')
      return []
    }
    const errs = Array.isArray(res.errors) ? res.errors : []
    lastErrors = errs
    if (ui && ui.fixBtn) ui.fixBtn.disabled = errs.length === 0
    if (announce) {
      if (errs.length === 0) toast('Build is clean.', 'success')
      else toast(`${errs.length} build error(s) — use "Fix errors".`, 'warn')
    }
    if (transcript && transcript.push) {
      transcript.push(errs.length
        ? { type: 'error', text: `Build check:\n${errs.map((e) => `  • ${e}`).join('\n')}` }
        : { type: 'status', text: 'Build check: clean ✓' })
    }
    return errs
  }

  /* ---- editor + preview ------------------------------------------------- */

  async function loadEditorFile(path) {
    if (!editor || buildId == null) return
    editorPath = path
    try {
      const res = await client.fsRead(buildId, path)
      const text = (res && res.ok && typeof res.data === 'string') ? res.data : ''
      if (typeof editor.setText === 'function') editor.setText(text)
    } catch (_) {
      if (typeof editor.setText === 'function') editor.setText('')
    }
  }

  // Persist hand-edits back to disk (the watcher then hot-reloads the preview).
  async function saveEditor() {
    if (!editor || buildId == null || typeof editor.getText !== 'function') return
    const text = editor.getText()
    const res = await client.fsWrite(buildId, editorPath, text)
    if (res && res.ok) {
      toast(`Saved ${editorPath}.`, 'success')
      await refreshPreview()
      await runBuildCheck(false)
    } else {
      toast(`Save failed: ${(res && res.error) || 'unknown'}`, 'error')
    }
  }

  async function refreshPreview() {
    if (!preview || buildId == null || typeof preview.render !== 'function') return
    try {
      const res = await client.readBuild(buildId)
      if (!res || !res.ok) return
      await preview.render({
        manifest: res.manifest || null,
        entrySource: res.entrySource || '',
        assets: res.assets || {},
      })
    } catch (e) {
      console.warn('[plugin-studio] preview refresh failed:', e && e.message)
    }
  }

  /* ---- ship: install / export ------------------------------------------- */

  async function installBuild() {
    if (buildId == null) { toast('Build something first.', 'warn'); return }
    setBusy(true, 'Installing…')
    const errs = await runBuildCheck(false)
    if (errs.length) {
      const proceed = typeof window.confirm === 'function'
        ? window.confirm(`The build has ${errs.length} error(s). Install anyway (disabled by default)?`)
        : true
      if (!proceed) { setBusy(false); return }
    }
    const res = await client.installBuild(buildId)
    setBusy(false)
    if (res && res.ok) {
      toast(`Installed ${res.id || 'plugin'} (disabled by default — enable it in Plugin Lab).`, 'success')
    } else {
      toast(`Install failed: ${(res && res.error) || 'unknown'}`, 'error')
    }
  }

  async function exportBuild() {
    if (buildId == null) { toast('Build something first.', 'warn'); return }
    setBusy(true, 'Exporting…')
    const res = await client.exportBuild(buildId)
    setBusy(false)
    if (res && res.ok && res.path) {
      toast(`Exported .nlplugin → ${res.path}`, 'success')
    } else {
      toast(`Export failed: ${(res && res.error) || 'unknown'}`, 'error')
    }
  }

  async function reloadBuild() {
    if (buildId == null) { toast('Nothing to reload.', 'warn'); return }
    await loadEditorFile(editorPath)
    await refreshPreview()
    await runBuildCheck(true)
  }

  /* ---- build the view --------------------------------------------------- */

  function buildUnsupported() {
    clear(root)
    root.appendChild(
      el('div', { class: 'studio-unsupported' }, [
        el('div', { class: 'studio-unsupported-icon', html: '<i class="fas fa-desktop"></i>' }),
        el('div', { class: 'studio-unsupported-title', text: 'Plugin Studio needs the desktop app' }),
        el('div', {
          class: 'studio-unsupported-sub',
          text: 'Studio runs coding agents on your machine inside a sandboxed workspace folder. '
            + 'Open Paperus on the desktop to build plugins here.',
        }),
      ]),
    )
  }

  function buildGallery() {
    const grid = el('div', { class: 'studio-gallery-grid' })
    for (const t of TEMPLATES) {
      const card = el('button', { class: 'studio-tpl', title: t.hint }, [
        el('i', { class: `fas ${t.icon}` }),
        el('span', { class: 'studio-tpl-label', text: t.label }),
      ])
      card.addEventListener('click', () => {
        // Select this template/remix for the next Build.
        ui.selectedTemplate = t.kind === 'template' ? t.key : 'blank'
        ui.selectedRemix = t.kind === 'remix' ? t.key : null
        for (const c of grid.querySelectorAll('.studio-tpl')) c.classList.remove('selected')
        card.classList.add('selected')
        ui.galleryHint.textContent = t.kind === 'remix'
          ? `Remix: ${t.label} — ${t.hint}`
          : `Template: ${t.label} — ${t.hint}`
      })
      grid.appendChild(card)
    }
    return el('div', { class: 'studio-gallery card' }, [
      el('div', { class: 'studio-card-title', html: '<i class="fas fa-shapes"></i> Start from a template or remix an example' }),
      grid,
      el('div', { class: 'studio-gallery-hint', text: 'Optional. Build from blank if you skip this.' }),
    ])
  }

  function build() {
    const container = el('div', { class: 'plugin-studio' })

    // ── Header: title + harness picker + build badge ─────────────────────
    const providerSelect = el('select', { class: 'studio-provider-select' })
    providerSelect.addEventListener('change', () => {
      selectedProviderId = providerSelect.value
      renderProviderPicker()
    })
    const providerHint = el('div', { class: 'studio-provider-hint' })
    const modelInput = el('input', { class: 'studio-model-input', type: 'text', placeholder: 'model (optional)' })
    const buildBadge = el('span', { class: 'studio-build-badge', text: 'no workspace' })

    container.appendChild(
      el('div', { class: 'studio-header' }, [
        el('div', { class: 'studio-titles' }, [
          el('h1', { class: 'studio-title', text: 'Plugin Studio' }),
          el('div', {
            class: 'studio-subtitle',
            text: 'Describe a plugin, pick a coding agent, and watch it build live. '
              + 'Author-time only — the plugin still loads sandboxed.',
          }),
        ]),
        el('div', { class: 'studio-header-controls' }, [
          el('label', { class: 'studio-field' }, [
            el('span', { class: 'studio-field-label', text: 'Harness' }),
            providerSelect,
          ]),
          el('label', { class: 'studio-field' }, [
            el('span', { class: 'studio-field-label', text: 'Model' }),
            modelInput,
          ]),
          buildBadge,
        ]),
      ]),
    )
    container.appendChild(providerHint)

    // ── Start gallery (Phase E) ──────────────────────────────────────────
    const galleryHint = el('div', { class: 'studio-selected-hint' })
    const gallery = buildGallery()
    container.appendChild(gallery)
    container.appendChild(galleryHint)

    // ── Goal input + action bar ──────────────────────────────────────────
    const goalInput = el('textarea', {
      class: 'studio-goal-input',
      rows: '3',
      placeholder: 'Describe the plugin… e.g. "a Pomodoro timer in the sidebar that pauses when I type".',
    })

    const buildBtn = el('button', { class: 'studio-btn primary', html: '<i class="fas fa-hammer"></i> Build' })
    buildBtn.dataset._label = 'Build'
    const fixBtn = el('button', { class: 'studio-btn', html: '<i class="fas fa-bolt"></i> Fix errors', title: 'Send the latest build/runtime errors back to the agent' })
    fixBtn.disabled = true
    const reloadBtn = el('button', { class: 'studio-btn', html: '<i class="fas fa-rotate"></i> Reload', title: 'Reload from disk + re-check' })
    reloadBtn.disabled = true
    const cancelBtn = el('button', { class: 'studio-btn', html: '<i class="fas fa-stop"></i> Stop' })
    const installBtn = el('button', { class: 'studio-btn', html: '<i class="fas fa-download"></i> Install', title: 'Install (disabled by default)' })
    installBtn.disabled = true
    const exportBtn = el('button', { class: 'studio-btn', html: '<i class="fas fa-file-export"></i> Export .nlplugin' })
    exportBtn.disabled = true

    buildBtn.addEventListener('click', () => { void startBuild() })
    fixBtn.addEventListener('click', () => { void fixErrors() })
    reloadBtn.addEventListener('click', () => { void reloadBuild() })
    cancelBtn.addEventListener('click', () => { void cancelSession() })
    installBtn.addEventListener('click', () => { void installBuild() })
    exportBtn.addEventListener('click', () => { void exportBuild() })

    const actionBar = el('div', { class: 'studio-action-bar' }, [
      buildBtn, fixBtn, reloadBtn, cancelBtn,
      el('span', { class: 'studio-action-spacer' }),
      installBtn, exportBtn,
    ])

    // Readouts (Phase E): status line + duration + token/cost.
    const statusLine = el('div', { class: 'studio-status-line' })
    const durationReadout = el('span', { class: 'studio-readout-duration', text: '0s' })
    const tokenReadout = el('span', { class: 'studio-readout-tokens', text: '—' })
    const readouts = el('div', { class: 'studio-readouts' }, [
      el('span', { class: 'studio-readout', html: '<i class="far fa-clock"></i> ' }),
      durationReadout,
      el('span', { class: 'studio-readout-sep', text: '·' }),
      el('span', { class: 'studio-readout', html: '<i class="fas fa-coins"></i> ' }),
      tokenReadout,
    ])

    container.appendChild(
      el('div', { class: 'studio-goal card' }, [
        goalInput,
        actionBar,
        el('div', { class: 'studio-status-row' }, [statusLine, readouts]),
      ]),
    )

    // ── Workbench: transcript | (editor / preview) ───────────────────────
    const transcriptEl = el('div', { class: 'studio-transcript' })
    const editorEl = el('div', { class: 'studio-editor' })
    const previewEl = el('div', { class: 'studio-preview' })

    // Editor file tabs (minimal: index.js / plugin.json + a Save).
    const tabIndex = el('button', { class: 'studio-file-tab selected', text: 'index.js' })
    const tabManifest = el('button', { class: 'studio-file-tab', text: 'plugin.json' })
    const saveBtn = el('button', { class: 'studio-file-save', html: '<i class="fas fa-save"></i> Save' })
    tabIndex.addEventListener('click', () => {
      tabIndex.classList.add('selected'); tabManifest.classList.remove('selected')
      void loadEditorFile('plugin/index.js')
    })
    tabManifest.addEventListener('click', () => {
      tabManifest.classList.add('selected'); tabIndex.classList.remove('selected')
      void loadEditorFile('plugin/plugin.json')
    })
    saveBtn.addEventListener('click', () => { void saveEditor() })

    const chatInput = el('input', { class: 'studio-chat-input', type: 'text', placeholder: 'Refine… e.g. "make the timer red"' })
    const chatSendBtn = el('button', { class: 'studio-btn small', html: '<i class="fas fa-paper-plane"></i>' })
    const doChatSend = () => {
      const m = (chatInput.value || '').trim()
      if (!m) return
      chatInput.value = ''
      if (transcript && transcript.push) transcript.push({ type: 'text', text: `▸ ${m}` })
      void sendFollowup(m)
    }
    chatSendBtn.addEventListener('click', doChatSend)
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doChatSend() })

    const workbench = el('div', { class: 'studio-workbench' }, [
      el('div', { class: 'studio-pane studio-pane-chat' }, [
        el('div', { class: 'studio-pane-title', html: '<i class="fas fa-comments"></i> Transcript' }),
        transcriptEl,
        el('div', { class: 'studio-chat-row' }, [
          el('div', { class: 'studio-chat-inputwrap' }, [chatInput, chatSendBtn]),
        ]),
      ]),
      el('div', { class: 'studio-pane studio-pane-right' }, [
        el('div', { class: 'studio-pane-title', html: '<i class="fas fa-eye"></i> Live preview' }),
        previewEl,
        el('div', { class: 'studio-editor-head' }, [
          el('div', { class: 'studio-file-tabs' }, [tabIndex, tabManifest]),
          saveBtn,
        ]),
        editorEl,
      ]),
    ])
    container.appendChild(workbench)

    // Toast stack.
    container.appendChild(el('div', { class: 'studio-toasts' }))

    ui = {
      providerSelect, providerHint, modelInput, buildBadge,
      gallery, galleryHint, selectedTemplate: 'blank', selectedRemix: null,
      goalInput,
      buildBtn, fixBtn, reloadBtn, cancelBtn, installBtn, exportBtn,
      actionButtons: [buildBtn, fixBtn, reloadBtn, installBtn, exportBtn],
      statusLine, durationReadout, tokenReadout,
      transcriptEl, editorEl, previewEl,
      chatInput,
    }

    return container
  }

  async function mountSubviews() {
    // Transcript.
    try {
      transcript = mountTranscript(ui.transcriptEl)
    } catch (e) {
      console.warn('[plugin-studio] transcript mount failed:', e && e.message)
      transcript = { push: () => {}, clear: () => {} }
    }
    // Code editor (plain text + markdown grammar by default; JS/JSON if present).
    try {
      editor = mountCodeEditor(ui.editorEl, {
        doc: '',
        language: 'javascript',
        onChange: () => {},
      })
    } catch (e) {
      console.warn('[plugin-studio] editor mount failed:', e && e.message)
      editor = { getText: () => '', setText: () => {}, dispose: () => {} }
    }
    // Live preview.
    try {
      preview = mountPreview(ui.previewEl)
    } catch (e) {
      console.warn('[plugin-studio] preview mount failed:', e && e.message)
      preview = { render: async () => {}, dispose: () => {} }
    }
  }

  /* ---- public surface --------------------------------------------------- */

  async function mount(viewEl) {
    try {
      if (!viewEl) { console.warn('[plugin-studio] mount() called with no container.'); return }
      root = viewEl
      disposed = false
      clear(root)

      // Feature-detect Studio support (web → unsupported).
      supported = await client.isSupported()
      if (!supported) { buildUnsupported(); return }

      root.appendChild(build())
      await mountSubviews()
      await detectProviders()
      setStatus('Ready. Describe a plugin and press Build.')
    } catch (e) {
      console.error('[plugin-studio] mount failed:', e)
      try {
        if (viewEl) {
          clear(viewEl)
          viewEl.appendChild(el('div', { class: 'studio-unsupported' }, [
            el('div', { class: 'studio-unsupported-title', text: 'Plugin Studio failed to load' }),
            el('div', { class: 'studio-unsupported-sub', text: (e && e.message) || String(e) }),
          ]))
        }
      } catch (_) {}
    }
  }

  async function refresh() {
    if (disposed || !supported) return
    try {
      await detectProviders()
      if (buildId != null) {
        await refreshPreview()
        await loadEditorFile(editorPath)
      }
    } catch (e) {
      console.warn('[plugin-studio] refresh failed:', e && e.message)
    }
  }

  function dispose() {
    disposed = true
    stopDurationTicker()
    try { if (unsubscribe) unsubscribe() } catch (_) {}
    unsubscribe = null
    try { if (apiSession) apiSession.cancel() } catch (_) {}
    apiSession = null
    try { if (editor && editor.dispose) editor.dispose() } catch (_) {}
    try { if (preview && preview.dispose) preview.dispose() } catch (_) {}
    editor = null; preview = null; transcript = null
    if (root) clear(root)
    root = null; ui = null
  }

  return { mount, refresh, dispose }
}

export default createPluginStudio
