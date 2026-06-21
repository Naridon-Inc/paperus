// plugin-lab.js — the "Build with Claude" Plugin Lab view.
//
// A docked view (rendered into a host-provided `#plugin-lab-view` container) that:
//   • lists installed plugins with enable/disable/reload/uninstall controls,
//   • surfaces each plugin's declared capabilities and gates net/fs/auth behind an
//     explicit "this plugin requests X" approval before first enable,
//   • installs a plugin from a local folder (via the `plugin:install` IPC channel),
//   • hot-reloads plugins on demand,
//   • and a "Generate with Claude" box: a natural-language prompt seeded with the
//     plugin author guide that calls the EXISTING AI backend
//     (`window.api.invoke('ai:claude-code', …)` with a graceful fallback to the
//     rag-engine api/ollama path), scaffolds the result to disk via `plugin:scaffold`,
//     writes the generated files with `plugin:fs-write`, and hot-loads via the
//     controller returned by `initPluginSystem`.
//
// This module owns NO secrets. The Lab runs with elevated host trust (it is NOT a
// sandboxed plugin), so it may call `plugin:*` IPC directly. Every entry point is
// defensive: nothing thrown here is allowed to escape into the host app.
//
// Integration: the integrator mounts an empty `<div id="plugin-lab-view">` inside
// `<main>` and calls `createPluginLab({ controller, ragEngine }).mount(viewEl)`.
// See integrationNotes in the build report and §9 of docs/PLUGIN_API_CONTRACT.md.

import { PLUGIN_AUTHOR_GUIDE } from './author-guide.js'
import { Features } from '../features'

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

// Defensive IPC: never throw out of the Lab. Always resolve to a {ok,...} shape.
async function safeInvoke(channel, payload) {
  try {
    if (!(window.api && typeof window.api.invoke === 'function')) {
      return { ok: false, error: 'IPC unavailable (window.api.invoke missing).' }
    }
    const res = await window.api.invoke(channel, payload)
    if (res == null) return { ok: false, error: `No response from ${channel}.` }
    return res
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) }
  }
}

/* ------------------------------------------------------------------------- *
 * Capability classification — which caps need explicit user approval.
 * ------------------------------------------------------------------------- */

// Sensitive caps surface an explicit "this plugin requests X" confirmation before
// the FIRST enable (mirrors the contract §9 guardrail). fs/net/auth are sensitive.
function isSensitiveCap(cap) {
  if (typeof cap !== 'string') return false
  return (
    cap === 'fs:read' ||
    cap === 'fs:write' ||
    cap === 'auth' ||
    cap.startsWith('net:')
  )
}

function describeCap(cap) {
  const map = {
    commands: 'Register commands and keybindings',
    editor: 'Read and edit the active note, add editor blocks',
    ui: 'Add panels, toolbar items, status items, notifications',
    sections: 'Add a section to the sidebar',
    views: 'Add a full-page view and settings sections',
    ai: 'Use the AI backend (completions / embeddings)',
    auth: 'Add an alternate unlock method for your identity',
    teams: 'See team metadata (ids + public roster fields)',
    storage: 'Store its own settings (namespaced)',
    clipboard: 'Read and write the clipboard (on user gesture)',
    'fs:read': 'Read files inside this workspace',
    'fs:write': 'Write files inside this workspace',
  }
  if (map[cap]) return map[cap]
  if (typeof cap === 'string' && cap.startsWith('net:')) {
    const host = cap.slice(4)
    return `Make network requests to ${host || '(unspecified host)'}`
  }
  return cap
}

/* ------------------------------------------------------------------------- *
 * The Lab controller factory.
 * ------------------------------------------------------------------------- */

/**
 * @param {object} deps
 * @param {object} [deps.controller] - the controller from initPluginSystem:
 *        { list(), enable(id), disable(id), reload(id), dispose() }. Optional; the
 *        Lab degrades to IPC-only (plugin:* channels) if absent.
 * @param {object} [deps.ragEngine] - the RAGEngine instance for AI fallback. Optional.
 * @returns {{ mount(viewEl): void, refresh(): Promise<void>, dispose(): void }}
 */
export function createPluginLab(deps) {
  const controller = (deps && deps.controller) || null
  const ragEngine = (deps && deps.ragEngine) || null

  let root = null // the #plugin-lab-view container
  let listEl = null // plugins list body
  let genState = { busy: false } // generation in-flight guard
  let approvedSet = null // Set of plugin ids the user approved sensitive caps for
  let disposed = false

  // ── conversation state (the agent surface) ──────────────────────────────────
  // The Lab is a continuous, follow-up-driven builder: one plugin is refined
  // across many turns. `conversation` is the running transcript; `currentPlugin`
  // is the latest built artifact (so follow-ups iterate on it, not from scratch).
  let conversation = [] // [{ role:'user'|'assistant', text }]
  let currentPlugin = null // { id, name, manifest, entry } once a plugin exists
  let threadEl = null // scrollable message thread
  let composerInput = null // the follow-up textarea
  let sendBtn = null // composer send button
  let backendChipEl = null // shows which agent is answering
  let filesEl = null // right-pane files-preview card body
  let installedModal = null // overlay holding the installed-plugins list
  let installedCountEl = null // count badge on the header "Installed" button
  let onModalKeydown = null // Escape-to-close handler (registered while mounted)

  // Starter templates shown in the empty thread. Each is a card (icon + title +
  // one-line blurb) whose prompt seeds a GOOD, specific build request. Clicking
  // one sends it as the first turn (reusing the click-to-send wiring).
  const STARTER_TEMPLATES = [
    {
      icon: 'fa-terminal',
      title: 'Slash command',
      desc: 'Type a slash command to insert content.',
      prompt: 'Build a /callout slash command. When I type "/callout" in the editor and pick it, it inserts a Markdown blockquote callout block ("> [!note] …") at the cursor. Register it under the "commands" capability with a sensible keybinding suggestion.',
    },
    {
      icon: 'fa-stopwatch',
      title: 'Status-bar widget',
      desc: 'A live badge in the footer status bar.',
      prompt: 'Build a footer status-bar widget that shows the active note\'s reading time (words ÷ 200 wpm, rounded up to the nearest minute, e.g. "4 min read"). It reads the active note and updates live as I type. Use the "ui" and "editor" capabilities.',
    },
    {
      icon: 'fa-highlighter',
      title: 'Editor block / decoration',
      desc: 'Decorate or transform text in the editor.',
      prompt: 'Build an editor decoration that highlights TODO, FIXME and NOTE keywords inline in the active note with a colored pill, without changing the underlying Markdown. Use the "editor" capability and re-decorate on document changes.',
    },
    {
      icon: 'fa-columns',
      title: 'Sidebar panel',
      desc: 'A full view or panel in the sidebar.',
      prompt: 'Build a sidebar panel titled "Outline" that lists all Markdown headings in the active note as a clickable table of contents; clicking a heading scrolls the editor to it. Add it as a sidebar section using the "sections" and "editor" capabilities, and keep it in sync as the note changes.',
    },
    {
      icon: 'fa-magic',
      title: 'AI helper',
      desc: 'Summarize or rewrite with the AI backend.',
      prompt: 'Build an AI helper command "Summarize note". It reads the active note, sends the text to the AI backend for a concise 3-bullet summary, and inserts the summary as a callout at the top of the note. Use the "ai", "editor" and "commands" capabilities, and show a small status while it runs.',
    },
    {
      icon: 'fa-plug',
      title: 'Brain tool connector',
      desc: 'Let the Company Brain answer from an external system.',
      prompt: 'Build a Brain tool connector that lets the Company Brain answer questions from an external Confluence wiki. Register a tool (via the "tools" capability) named "search_confluence" that takes a query string, calls the Confluence REST search API over HTTPS, and returns the top matching page titles + excerpts + URLs so the Brain can cite them. Declare the "tools" capability and a "net:your-company.atlassian.net" network capability, and read the base URL + API token from plugin storage settings.',
    },
    {
      icon: 'fa-clock',
      title: 'Daily note command',
      desc: 'Open or create today\'s dated note.',
      prompt: 'Build a "Open today\'s daily note" command. When run, it creates (or opens if it exists) a note named with today\'s date (YYYY-MM-DD) seeded with a "## Notes" and "## Tasks" template. Use the "commands" and "fs:write" capabilities.',
    },
  ]

  /* ---- approvals persistence (non-secret; rides settings:get/set) -------- */

  async function loadApprovals() {
    try {
      if (window.api && typeof window.api.getSettings === 'function') {
        const raw = await window.api.getSettings('plugin_lab_approved')
        if (Array.isArray(raw)) return new Set(raw)
        if (typeof raw === 'string' && raw) return new Set(JSON.parse(raw))
      }
    } catch (_) { /* fall through */ }
    return new Set()
  }

  async function saveApprovals() {
    try {
      if (window.api && typeof window.api.setSettings === 'function') {
        await window.api.setSettings('plugin_lab_approved', Array.from(approvedSet || []))
      }
    } catch (_) { /* best-effort */ }
  }

  /* ---- plugin list -------------------------------------------------------- */

  async function fetchPlugins() {
    // Prefer the controller (already knows live runtime state); fall back to IPC.
    if (controller && typeof controller.list === 'function') {
      try {
        const recs = controller.list()
        if (Array.isArray(recs)) return recs
      } catch (_) { /* fall through to IPC */ }
    }
    const res = await safeInvoke('plugin:list', {})
    if (res && res.ok && Array.isArray(res.plugins)) return res.plugins
    return []
  }

  function capsOf(rec) {
    const m = (rec && rec.manifest) || {}
    return Array.isArray(m.capabilities) ? m.capabilities : []
  }

  function renderCapChip(cap) {
    const sensitive = isSensitiveCap(cap)
    return el('span', {
      class: 'plugin-cap-chip' + (sensitive ? ' sensitive' : ''),
      title: describeCap(cap),
      text: cap,
    })
  }

  // Ask the user to approve sensitive caps. Resolves true if approved (or none).
  async function ensureApproved(rec) {
    const id = rec && rec.id
    if (!id) return false
    const sensitive = capsOf(rec).filter(isSensitiveCap)
    if (sensitive.length === 0) return true
    if (approvedSet && approvedSet.has(id)) return true

    const lines = sensitive.map((c) => `  • ${c} — ${describeCap(c)}`).join('\n')
    const message =
      `"${(rec.name || id)}" requests elevated access:\n\n${lines}\n\n` +
      'Only enable plugins you trust. Grant these capabilities?'

    let approved = false
    try {
      if (window.api && typeof window.api.showMessageBox === 'function') {
        const r = await window.api.showMessageBox({
          type: 'warning',
          buttons: ['Cancel', 'Grant & Enable'],
          defaultId: 0,
          cancelId: 0,
          title: 'Plugin permission request',
          message: `${rec.name || id} requests access`,
          detail: lines,
        })
        approved = !!(r && (r.response === 1 || r === 1))
      } else {
        // Web/dev fallback.
        approved = typeof window.confirm === 'function' ? window.confirm(message) : false
      }
    } catch (_) {
      approved = false
    }

    if (approved) {
      if (!approvedSet) approvedSet = new Set()
      approvedSet.add(id)
      await saveApprovals()
    }
    return approved
  }

  async function doEnable(rec, btn) {
    if (!(await ensureApproved(rec))) {
      toast('Enable cancelled — permissions not granted.', 'warn')
      return
    }
    setBusy(btn, true, 'Enabling…')
    let res
    if (controller && typeof controller.enable === 'function') {
      res = await callController(() => controller.enable(rec.id))
    } else {
      res = await safeInvoke('plugin:enable', { id: rec.id })
    }
    setBusy(btn, false)
    if (res && res.ok === false) toast(`Could not enable: ${res.error || 'unknown error'}`, 'error')
    else toast(`Enabled ${rec.name || rec.id}.`, 'success')
    await refresh()
  }

  async function doDisable(rec, btn) {
    setBusy(btn, true, 'Disabling…')
    let res
    if (controller && typeof controller.disable === 'function') {
      res = await callController(() => controller.disable(rec.id))
    } else {
      res = await safeInvoke('plugin:disable', { id: rec.id })
    }
    setBusy(btn, false)
    if (res && res.ok === false) toast(`Could not disable: ${res.error || 'unknown error'}`, 'error')
    else toast(`Disabled ${rec.name || rec.id}.`, 'info')
    await refresh()
  }

  async function doReload(rec, btn) {
    setBusy(btn, true, 'Reloading…')
    let res
    if (controller && typeof controller.reload === 'function') {
      res = await callController(() => controller.reload(rec.id))
    } else {
      res = await safeInvoke('plugin:reload', { id: rec.id })
    }
    setBusy(btn, false)
    if (res && res.ok === false) toast(`Reload failed: ${res.error || 'unknown error'}`, 'error')
    else toast(`Reloaded ${rec.name || rec.id}.`, 'success')
    await refresh()
  }

  async function doUninstall(rec, btn) {
    let ok = true
    try {
      if (window.api && typeof window.api.showMessageBox === 'function') {
        const r = await window.api.showMessageBox({
          type: 'warning',
          buttons: ['Cancel', 'Uninstall'],
          defaultId: 0,
          cancelId: 0,
          title: 'Uninstall plugin',
          message: `Remove ${rec.name || rec.id}?`,
          detail: 'This deletes the plugin folder. Workspace (git-managed) plugins are kept.',
        })
        ok = !!(r && (r.response === 1 || r === 1))
      } else {
        ok = typeof window.confirm === 'function'
          ? window.confirm(`Uninstall ${rec.name || rec.id}?`)
          : true
      }
    } catch (_) { ok = false }
    if (!ok) return
    setBusy(btn, true, 'Removing…')
    const res = await safeInvoke('plugin:uninstall', { id: rec.id })
    setBusy(btn, false)
    if (res && res.ok === false) toast(`Uninstall failed: ${res.error || 'unknown error'}`, 'error')
    else toast(`Uninstalled ${rec.name || rec.id}.`, 'info')
    if (approvedSet && approvedSet.delete(rec.id)) await saveApprovals()
    await refresh()
  }

  function renderPluginRow(rec) {
    const enabled = !!rec.enabled
    const caps = capsOf(rec)
    const sensitive = caps.filter(isSensitiveCap)

    const meta = el('div', { class: 'plugin-row-meta' }, [
      el('div', { class: 'plugin-row-title' }, [
        el('span', { class: 'plugin-row-name', text: rec.name || rec.id }),
        el('span', { class: 'plugin-row-version', text: 'v' + (rec.version || '0.0.0') }),
        rec.source
          ? el('span', { class: 'plugin-row-source', text: rec.source })
          : null,
        el('span', {
          class: 'plugin-row-state ' + (enabled ? 'on' : 'off'),
          text: enabled ? 'enabled' : 'disabled',
        }),
      ]),
      el('div', {
        class: 'plugin-row-desc',
        text: (rec.manifest && rec.manifest.description) || rec.id,
      }),
      caps.length
        ? el('div', { class: 'plugin-row-caps' }, caps.map(renderCapChip))
        : el('div', { class: 'plugin-row-caps muted', text: 'no capabilities (inert)' }),
    ])

    const enableBtn = enabled
      ? el('button', {
        class: 'plugin-btn',
        text: 'Disable',
        title: 'Disable this plugin',
      })
      : el('button', {
        class: 'plugin-btn primary',
        text: 'Enable',
        title: sensitive.length ? 'Requests elevated access' : 'Enable this plugin',
      })
    enableBtn.addEventListener('click', () => {
      if (enabled) doDisable(rec, enableBtn)
      else doEnable(rec, enableBtn)
    })

    const reloadBtn = el('button', {
      class: 'plugin-btn',
      title: 'Hot-reload from disk',
      html: '<i class="fas fa-sync-alt"></i>',
    })
    reloadBtn.addEventListener('click', () => doReload(rec, reloadBtn))

    const uninstallBtn = el('button', {
      class: 'plugin-btn danger',
      title: 'Uninstall',
      html: '<i class="fas fa-trash"></i>',
    })
    uninstallBtn.addEventListener('click', () => doUninstall(rec, uninstallBtn))

    const actions = el('div', { class: 'plugin-row-actions' }, [
      enableBtn,
      reloadBtn,
      rec.source === 'workspace' ? null : uninstallBtn,
    ])

    return el('div', { class: 'plugin-row' + (enabled ? ' enabled' : '') }, [meta, actions])
  }

  async function refresh() {
    if (disposed || !listEl) return
    const recs = await fetchPlugins()
    if (installedCountEl) installedCountEl.textContent = String(recs.length)
    clear(listEl)
    if (!recs.length) {
      listEl.appendChild(
        el('div', { class: 'plugin-empty' }, [
          el('div', { class: 'plugin-empty-icon', html: '<i class="fas fa-puzzle-piece"></i>' }),
          el('div', { class: 'plugin-empty-title', text: 'No plugins yet' }),
          el('div', {
            class: 'plugin-empty-sub',
            text: 'Build one in the chat, or install from a folder.',
          }),
        ]),
      )
      return
    }
    // Sort: enabled first, then by name.
    recs.sort((a, b) => {
      if (!!a.enabled !== !!b.enabled) return a.enabled ? -1 : 1
      return String(a.name || a.id).localeCompare(String(b.name || b.id))
    })
    for (const rec of recs) {
      try {
        listEl.appendChild(renderPluginRow(rec))
      } catch (e) {
        listEl.appendChild(
          el('div', { class: 'plugin-row error', text: `Failed to render ${rec.id}: ${e.message}` }),
        )
      }
    }
  }

  /* ---- installed-plugins modal ------------------------------------------- */

  function openInstalledModal() {
    if (!installedModal) return
    installedModal.style.display = 'flex'
    refresh() // pull the freshest list each time it opens
  }

  function closeInstalledModal() {
    if (installedModal) installedModal.style.display = 'none'
  }

  /* ---- install from folder ----------------------------------------------- */

  async function installFromFolder() {
    let dir = null
    try {
      if (window.api && typeof window.api.showOpenDialog === 'function') {
        const r = await window.api.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Choose a plugin folder (must contain plugin.json)',
        })
        if (r && !r.canceled && Array.isArray(r.filePaths) && r.filePaths[0]) {
          dir = r.filePaths[0]
        }
      } else {
        toast('Folder install is only available in the desktop app.', 'warn')
        return
      }
    } catch (e) {
      toast(`Could not open the folder picker: ${e.message}`, 'error')
      return
    }
    if (!dir) return
    toast('Installing…', 'info')
    const res = await safeInvoke('plugin:install', { source: { type: 'folder', value: dir } })
    if (res && res.ok) {
      toast(`Installed ${res.id || 'plugin'} (disabled by default).`, 'success')
      await refresh()
    } else {
      toast(`Install failed: ${(res && res.error) || 'unknown error'}`, 'error')
    }
  }

  /* ---- generate with Claude ---------------------------------------------- */

  // Detect whether Claude Code CLI is available (host-side, via the existing IPC).
  async function claudeCodeAvailable() {
    const res = await safeInvoke('ai:claude-code-available', {})
    return !!(res && res.available)
  }

  // Build the system prompt: the author guide is the load-bearing context that
  // lets any agent build AND iteratively refine a plugin against the frozen contract.
  function buildSystemPrompt() {
    return [
      'You are an expert Paperus plugin author working as an INTERACTIVE coding agent.',
      'You build and iteratively refine ONE plugin with the user across multiple turns.',
      '',
      'How to respond each turn:',
      '  • Briefly (1–3 sentences) say what you built or changed.',
      '  • When you have a concrete plugin or change, output the FULL updated files as',
      '    EXACTLY two fenced blocks in this order: ```json (plugin.json) then ```js (index.js).',
      '    Always return the COMPLETE files — never a diff, never a fragment.',
      '  • If the request is genuinely ambiguous, ask ONE short clarifying question instead',
      '    and emit no code that turn.',
      '',
      'Hard rules for the code:',
      '  • Conform exactly to the frozen Plugin API (apiVersion "1").',
      '  • Declare ONLY the capabilities the plugin actually uses.',
      '  • Vanilla ESM JS. Import { definePlugin } from "@notionless/plugin-sdk".',
      '  • All work happens inside activate(ctx); never touch host globals.',
      '  • Render returns sanitized HTML strings or the vDOM shape — never DOM nodes.',
      '',
      '=== PLUGIN AUTHOR GUIDE (authoritative) ===',
      PLUGIN_AUTHOR_GUIDE,
    ].join('\n')
  }

  // Strip fenced code blocks from model text to get the conversational prose.
  function stripCode(text) {
    return String(text || '').replace(/```[a-zA-Z0-9_+-]*\s*\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim()
  }

  // Compose the per-turn user prompt: the CURRENT plugin (so the agent edits it
  // in place), a little conversation history (intent), then the new request.
  function buildTurnPrompt(userText) {
    const parts = []
    if (currentPlugin && currentPlugin.manifest && currentPlugin.entry) {
      parts.push('CURRENT PLUGIN — iterate on THIS and return the FULL updated files:')
      parts.push('```json\n' + JSON.stringify(currentPlugin.manifest, null, 2) + '\n```')
      parts.push('```js\n' + currentPlugin.entry + '\n```')
    }
    // Last few turns for intent (exclude the just-pushed user line; cap length).
    const hist = conversation.slice(-7, -1)
    if (hist.length) {
      const lines = hist.map((t) => {
        const who = t.role === 'user' ? 'User' : 'You'
        const body = t.role === 'assistant' ? stripCode(t.text).slice(0, 500) : t.text
        return body ? `${who}: ${body}` : null
      }).filter(Boolean)
      if (lines.length) parts.push('CONVERSATION SO FAR:\n' + lines.join('\n'))
    }
    parts.push((currentPlugin ? 'Change request: ' : 'Build request: ') + userText)
    return parts.join('\n\n')
  }

  // Pull the two fenced code blocks (json manifest + js entry) out of model output.
  function extractFiles(text) {
    const out = { manifest: null, entry: null }
    if (typeof text !== 'string') return out
    const blocks = []
    const re = /```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g
    let m
    while ((m = re.exec(text)) !== null) {
      blocks.push({ lang: (m[1] || '').toLowerCase(), body: m[2] })
    }
    for (const b of blocks) {
      if (!out.manifest && (b.lang === 'json' || /"apiVersion"|"capabilities"/.test(b.body))) {
        out.manifest = b.body.trim()
      } else if (!out.entry && (b.lang === 'js' || b.lang === 'javascript' || /definePlugin|export default/.test(b.body))) {
        out.entry = b.body.trim()
      }
    }
    // Last-resort: if exactly two blocks and not yet assigned, take them in order.
    if ((!out.manifest || !out.entry) && blocks.length >= 2) {
      if (!out.manifest) out.manifest = blocks[0].body.trim()
      if (!out.entry) out.entry = blocks[blocks.length - 1].body.trim()
    }
    return out
  }

  // Stream-or-block generation against the existing AI backend.
  // Returns { ok, text, error }.
  async function generate(systemPrompt, userPrompt, onToken) {
    // Path 1: Claude Code CLI (no API key, uses the user's existing auth).
    if (await claudeCodeAvailable()) {
      const res = await safeInvoke('ai:claude-code', {
        prompt: `${systemPrompt}\n\n----\nUser request: ${userPrompt}`,
      })
      if (res && res.ok) {
        const text = res.text || ''
        if (onToken && text) onToken(text)
        return { ok: true, text }
      }
      // Fall through to the rag-engine path on Claude Code failure.
    }

    // Path 2: the rag-engine api/ollama backend (streams tokens).
    if (ragEngine && typeof ragEngine._generateApi === 'function') {
      try {
        let acc = ''
        const onTok = (t) => { acc += t; if (onToken) onToken(t) }
        const noop = () => {}
        const mode = ragEngine.aiMode || 'local'
        if (mode === 'api' && typeof ragEngine._generateApi === 'function') {
          await ragEngine._generateApi(systemPrompt, userPrompt, onTok, noop, [])
        } else if (mode === 'cli' && typeof ragEngine._generateCli === 'function') {
          await ragEngine._generateCli(systemPrompt, userPrompt, onTok, noop, [])
        } else if (mode === 'claude-code' && typeof ragEngine._generateClaudeCode === 'function') {
          await ragEngine._generateClaudeCode(systemPrompt, userPrompt, onTok, noop, [])
        } else if (typeof ragEngine._generateLocal === 'function') {
          await ragEngine._generateLocal(systemPrompt, userPrompt, onTok, noop, [])
        } else if (typeof ragEngine._generateApi === 'function') {
          await ragEngine._generateApi(systemPrompt, userPrompt, onTok, noop, [])
        }
        return { ok: true, text: acc }
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) }
      }
    }

    return {
      ok: false,
      error:
        'No AI backend available. Sign in to Claude Code, or configure an API/Ollama provider in Brain settings.',
    }
  }

  // Derive a reverse-DNS plugin id from a free-text name.
  function slugId(name) {
    const slug = String(name || 'plugin')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'plugin'
    return `com.local.${slug}`
  }

  /* ---- conversation engine (the continuous, follow-up-driven builder) ----- */

  // Which backend will answer this turn (for the chip + transparency).
  async function describeBackend() {
    try {
      if (await claudeCodeAvailable()) return { id: 'claude-code', label: 'Claude Code' }
    } catch (_) { /* ignore */ }
    const mode = (ragEngine && ragEngine.aiMode) || 'local'
    if (mode === 'api') return { id: 'api', label: 'API backend' }
    if (mode === 'cli') return { id: 'cli', label: (ragEngine && ragEngine.cliCmd) || 'Coding agent' }
    if (mode === 'claude-code') return { id: 'claude-code', label: 'Claude Code' }
    return { id: 'local', label: 'Ollama (local)' }
  }

  async function refreshBackendChip() {
    if (!backendChipEl) return
    let b
    try { b = await describeBackend() } catch (_) { b = { label: 'an agent' } }
    if (!backendChipEl) return
    clear(backendChipEl)
    backendChipEl.appendChild(el('span', { class: 'plugin-chat-backend-dot' }))
    backendChipEl.appendChild(document.createTextNode('Building with ' + b.label))
  }

  function scrollThread() {
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight
  }

  function setComposerBusy(busy) {
    if (composerInput) composerInput.disabled = busy
    if (sendBtn) {
      sendBtn.disabled = busy
      sendBtn.classList.toggle('busy', busy)
    }
  }

  function renderError(parent, msg) {
    if (parent) parent.appendChild(el('div', { class: 'plugin-gen-error', text: msg }))
  }

  // Empty-thread state: a welcome + a grid of clickable starter template cards.
  function renderWelcome() {
    if (!threadEl) return

    const cards = STARTER_TEMPLATES.map((t) => {
      const card = el('button', { class: 'plugin-template-card', type: 'button' }, [
        el('div', { class: 'plugin-template-icon', html: `<i class="fas ${t.icon}"></i>` }),
        el('div', { class: 'plugin-template-text' }, [
          el('div', { class: 'plugin-template-title', text: t.title }),
          el('div', { class: 'plugin-template-desc', text: t.desc }),
        ]),
      ])
      card.title = t.prompt
      card.addEventListener('click', () => { if (!genState.busy) sendTurn(t.prompt) })
      return card
    })

    threadEl.appendChild(
      el('div', { class: 'plugin-chat-welcome' }, [
        el('div', { class: 'plugin-chat-welcome-icon', html: '<i class="fas fa-flask"></i>' }),
        el('div', { class: 'plugin-chat-welcome-title', text: 'Describe a plugin to build' }),
        el('div', {
          class: 'plugin-chat-welcome-sub',
          text: 'Pick a starter below, or describe your own — then keep chatting to refine it across turns.',
        }),
        el('div', { class: 'plugin-template-grid' }, cards),
      ]),
    )
  }

  // Start a fresh plugin: clear the transcript + current artifact.
  function newPlugin() {
    conversation = []
    currentPlugin = null
    if (threadEl) { clear(threadEl); renderWelcome() }
    renderFiles()
    if (composerInput) {
      composerInput.value = ''
      composerInput.placeholder = 'Describe a plugin to build…'
      try { composerInput.focus() } catch (_) { /* ignore */ }
    }
  }

  /* ---- message bubbles ---------------------------------------------------- */

  function appendUserBubble(text) {
    if (!threadEl) return null
    const welcome = threadEl.querySelector('.plugin-chat-welcome')
    if (welcome) welcome.remove()
    const bubble = el('div', { class: 'plugin-msg user' }, [
      el('div', { class: 'plugin-msg-role', text: 'You' }),
      el('div', { class: 'plugin-msg-body', text }),
    ])
    threadEl.appendChild(bubble)
    scrollThread()
    return bubble
  }

  function appendAssistantBubble() {
    const streamEl = el('div', { class: 'plugin-msg-body is-streaming', text: '' })
    const cardEl = el('div', { class: 'plugin-msg-card' })
    const bubble = el('div', { class: 'plugin-msg assistant streaming' }, [
      el('div', { class: 'plugin-msg-role', text: 'Plugin agent' }),
      streamEl,
      cardEl,
    ])
    if (threadEl) threadEl.appendChild(bubble)
    scrollThread()
    return { bubble, streamEl, cardEl }
  }

  /* ---- one conversational turn ------------------------------------------- */

  async function sendTurn(userText) {
    const text = String(userText || '').trim()
    if (!text || genState.busy) return
    genState.busy = true
    setComposerBusy(true)

    conversation.push({ role: 'user', text })
    appendUserBubble(text)
    if (composerInput) composerInput.value = ''

    const { bubble, streamEl, cardEl } = appendAssistantBubble()

    const systemPrompt = buildSystemPrompt()
    const turnPrompt = buildTurnPrompt(text)

    let streamed = ''
    const onToken = (t) => {
      streamed += t
      streamEl.textContent = streamed
      scrollThread()
    }

    let gen
    try {
      gen = await generate(systemPrompt, turnPrompt, onToken)
    } catch (e) {
      gen = { ok: false, error: (e && e.message) || String(e) }
    }

    bubble.classList.remove('streaming')
    streamEl.classList.remove('is-streaming')

    if (!gen || !gen.ok) {
      const msg = (gen && gen.error) || 'Generation failed.'
      streamEl.textContent = ''
      renderError(streamEl, msg)
      conversation.push({ role: 'assistant', text: msg })
      genState.busy = false
      setComposerBusy(false)
      return
    }

    const full = gen.text || streamed
    conversation.push({ role: 'assistant', text: full })
    await finalizeTurn(full, streamEl, cardEl)

    genState.busy = false
    setComposerBusy(false)
    if (composerInput) {
      composerInput.placeholder = currentPlugin
        ? 'Refine it… e.g. “add a setting”, “change the icon”, “fix the bug”.'
        : 'Describe a plugin to build…'
    }
  }

  // After the model answers: show prose, then (if it returned files) write them.
  async function finalizeTurn(fullText, streamEl, cardEl) {
    const prose = stripCode(fullText)
    streamEl.textContent = prose || 'Updated the plugin.'

    const files = extractFiles(fullText)
    if (!files.manifest || !files.entry) {
      // No code this turn — almost always a clarifying question. Leave the prose.
      if (!prose) streamEl.textContent = fullText
      scrollThread()
      return
    }

    let manifest
    try {
      manifest = JSON.parse(files.manifest)
    } catch (e) {
      renderError(cardEl, `The plugin.json wasn't valid JSON: ${e.message}. Ask me to fix it.`)
      scrollThread()
      return
    }

    // Keep iterating on the SAME id once a plugin exists (so follow-ups overwrite).
    const id = (currentPlugin && currentPlugin.id) || manifest.id || slugId(manifest.name || 'plugin')
    const name = manifest.name || (currentPlugin && currentPlugin.name) || id
    manifest.id = id
    manifest.name = name
    if (!manifest.apiVersion) manifest.apiVersion = '1'
    if (!manifest.entry) manifest.entry = 'index.js'

    cardEl.appendChild(el('div', { class: 'plugin-msg-status', text: currentPlugin ? 'Updating files…' : 'Writing files…' }))
    const wrote = await writePlugin({ id, name, manifest, entry: files.entry })
    clear(cardEl)
    if (!wrote.ok) {
      renderError(cardEl, wrote.error || 'Could not write the plugin.')
      scrollThread()
      return
    }

    currentPlugin = { id, name, manifest, entry: files.entry }
    renderResultCard(cardEl, { id, name, manifest, isUpdate: wrote.isUpdate })
    renderFiles()
    await refresh()
    scrollThread()
  }

  // Scaffold (only when new) + overwrite plugin.json/index.js. Hot-reload if live.
  async function writePlugin({ id, name, manifest, entry }) {
    const recs = await fetchPlugins()
    const existing = recs.find((r) => r.id === id)
    const isUpdate = !!existing

    if (!isUpdate) {
      const scaffold = await safeInvoke('plugin:scaffold', { template: 'blank', id, name })
      if (scaffold && scaffold.ok === false && !/exist/i.test(String(scaffold.error || ''))) {
        return { ok: false, error: `Scaffold failed: ${scaffold.error || 'unknown error'}` }
      }
    }

    const writeManifest = await safeInvoke('plugin:fs-write', {
      id, path: 'plugin.json', data: JSON.stringify(manifest, null, 2),
    })
    const writeEntry = await safeInvoke('plugin:fs-write', {
      id, path: manifest.entry || 'index.js', data: entry,
    })
    if ((writeManifest && writeManifest.ok === false) || (writeEntry && writeEntry.ok === false)) {
      const err = (writeManifest && writeManifest.error) || (writeEntry && writeEntry.error) || 'write failed'
      return { ok: false, error: `Could not write plugin files: ${err}` }
    }

    // If it's already enabled, hot-reload so the edit takes effect immediately.
    if (isUpdate && existing.enabled) {
      try { await safeInvoke('plugin:reload', { id }) } catch (_) { /* best-effort */ }
    }
    return { ok: true, id, name, isUpdate }
  }

  // The inline "what got built" card with a one-click enable.
  function renderResultCard(parent, { id, name, manifest, isUpdate }) {
    const caps = Array.isArray(manifest.capabilities) ? manifest.capabilities : []
    const card = el('div', { class: 'plugin-result-card' }, [
      el('div', { class: 'plugin-result-head' }, [
        el('span', { class: 'plugin-result-name', text: name }),
        el('span', { class: 'plugin-result-id', text: id }),
        isUpdate
          ? el('span', { class: 'plugin-result-badge', text: 'updated' })
          : el('span', { class: 'plugin-result-badge new', text: 'new' }),
      ]),
      el('div', { class: 'plugin-row-caps' }, caps.length ? caps.map(renderCapChip) : [el('span', { class: 'muted', text: 'no capabilities' })]),
    ])

    const enableBtn = el('button', { class: 'plugin-btn primary', text: 'Enable & hot-load' })
    enableBtn.addEventListener('click', async () => {
      const fresh = await fetchPlugins()
      const rec = fresh.find((r) => r.id === id) || { id, name, manifest }
      if (rec.enabled) { toast(`${name} is already enabled.`, 'info'); return }
      enableBtn.disabled = true
      await doEnable(rec, enableBtn)
      await refresh()
    })
    card.appendChild(el('div', { class: 'plugin-result-actions' }, [enableBtn]))
    card.appendChild(
      el('div', { class: 'plugin-result-hint', text: 'Keep chatting to refine it — it’s in the Installed list on the right.' }),
    )
    if (parent) parent.appendChild(card)
  }

  /* ---- toasts (uses the host notify pattern, degrades to console) -------- */

  function toast(message, kind) {
    try {
      const stack = root && root.querySelector('.plugin-lab-toasts')
      if (!stack) { console.log('[plugin-lab]', kind || 'info', message); return }
      const t = el('div', { class: 'plugin-lab-toast ' + (kind || 'info'), text: message })
      stack.appendChild(t)
      setTimeout(() => { try { t.remove() } catch (_) {} }, 4200)
    } catch (_) {
      console.log('[plugin-lab]', message)
    }
  }

  /* ---- small button-busy helper ------------------------------------------ */

  function setBusy(btn, busy, label) {
    if (!btn) return
    if (busy) {
      btn.dataset._label = btn.dataset._label || btn.textContent
      btn.disabled = true
      btn.classList.add('busy')
      if (label) btn.textContent = label
    } else {
      btn.disabled = false
      btn.classList.remove('busy')
      if (btn.dataset._label) { btn.textContent = btn.dataset._label; delete btn.dataset._label }
    }
  }

  // Normalize a controller call (which may return void or a promise) to {ok}.
  async function callController(fn) {
    try {
      const r = await fn()
      if (r && typeof r === 'object' && 'ok' in r) return r
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) }
    }
  }

  /* ---- right-pane files-preview card ------------------------------------- */

  // The right pane is a single, files-focused CARD: a compact header (plugin
  // name/id + capability chips + Enable & hot-load) above read-only code views
  // of the generated plugin.json + index.js. All currentPlugin changes
  // (build / refine / new) funnel through renderFiles() so it always mirrors the
  // latest artifact. Kept the historical name `renderInspector` as an alias so
  // any external/legacy reference still resolves.
  function renderFiles() {
    if (!filesEl) return
    clear(filesEl)

    if (!currentPlugin) {
      filesEl.appendChild(renderFilesEmpty())
      return
    }

    const { id, name, manifest, entry } = currentPlugin
    const caps = Array.isArray(manifest.capabilities) ? manifest.capabilities : []

    // Compact, non-card header: name/id, caps, and the Enable & hot-load action.
    const enableBtn = el('button', { class: 'plugin-btn primary plugin-files-enable', text: 'Enable & hot-load' })
    enableBtn.addEventListener('click', async () => {
      const fresh = await fetchPlugins()
      const rec = fresh.find((r) => r.id === id) || { id, name, manifest }
      if (rec.enabled) { toast(`${name} is already enabled.`, 'info'); return }
      enableBtn.disabled = true
      await doEnable(rec, enableBtn)
      await refresh()
    })

    const header = el('div', { class: 'plugin-files-header' }, [
      el('div', { class: 'plugin-files-headline' }, [
        el('div', { class: 'plugin-files-name', text: name }),
        el('div', { class: 'plugin-files-id', text: id }),
      ]),
      enableBtn,
    ])
    if (caps.length) {
      header.appendChild(el('div', { class: 'plugin-row-caps plugin-files-caps' }, caps.map(renderCapChip)))
    }
    filesEl.appendChild(header)

    // The dominant content: the generated files as read-only code views.
    const body = el('div', { class: 'plugin-files-body' }, [
      el('div', { class: 'plugin-files-file' }, [
        el('div', { class: 'plugin-files-file-name', text: 'plugin.json' }),
        el('pre', { class: 'plugin-code' }, [el('code', { text: JSON.stringify(manifest, null, 2) })]),
      ]),
      el('div', { class: 'plugin-files-file' }, [
        el('div', { class: 'plugin-files-file-name', text: manifest.entry || 'index.js' }),
        el('pre', { class: 'plugin-code' }, [el('code', { text: entry || '' })]),
      ]),
    ])
    filesEl.appendChild(body)
  }

  // Tidy empty state shown before the first plugin exists.
  function renderFilesEmpty() {
    return el('div', { class: 'plugin-files-empty' }, [
      el('div', { class: 'plugin-files-empty-icon', html: '<i class="fas fa-file-code"></i>' }),
      el('div', { class: 'plugin-files-empty-title', text: 'Your plugin’s files will appear here' }),
      el('div', {
        class: 'plugin-files-empty-sub',
        text: 'Describe a plugin in the chat. Once it builds, the generated plugin.json and index.js show up here, ready to enable.',
      }),
    ])
  }

  // Back-compat alias: callers/tests may still reference renderInspector().
  const renderInspector = renderFiles

  /* ---- build the view ----------------------------------------------------- */

  function build() {
    const container = el('div', { class: 'plugin-lab' })

    // ── Header (New plugin / Install from folder / Refresh / Studio) ────────
    const newBtn = el('button', { class: 'plugin-btn primary', html: '<i class="fas fa-plus"></i> New plugin' })
    newBtn.title = 'Start a fresh plugin conversation'
    newBtn.addEventListener('click', () => newPlugin())

    const installBtn = el('button', { class: 'plugin-btn', html: '<i class="fas fa-folder-open"></i> Install from folder' })
    installBtn.addEventListener('click', installFromFolder)

    const refreshBtn = el('button', { class: 'plugin-btn', html: '<i class="fas fa-sync-alt"></i> Refresh' })
    refreshBtn.addEventListener('click', () => refresh())

    // Installed plugins live in a modal (opened from here) so they don't clutter
    // the builder surface. The badge shows the live count.
    installedCountEl = el('span', { class: 'plugin-installed-count', text: '0' })
    const installedBtn = el('button', { class: 'plugin-btn' }, [
      el('i', { class: 'fas fa-puzzle-piece' }),
      ' Installed ',
      installedCountEl,
    ])
    installedBtn.title = 'View installed plugins'
    installedBtn.addEventListener('click', () => openInstalledModal())

    const headerActions = [newBtn, installBtn, refreshBtn, installedBtn]
    if (Features.pluginStudio) {
      const studioBtn = el('button', {
        class: 'plugin-btn plugin-open-studio-btn',
        html: 'Plugin Studio <i class="fas fa-arrow-right"></i>',
      })
      studioBtn.title = 'Open the agentic, multi-turn plugin builder'
      studioBtn.addEventListener('click', () => {
        try { window.dispatchEvent(new CustomEvent('plugin-studio:open')) } catch (_) { /* noop */ }
      })
      headerActions.push(studioBtn)
    }

    container.appendChild(
      el('div', { class: 'plugin-lab-header' }, [
        el('div', { class: 'plugin-lab-titles' }, [
          el('h1', { class: 'plugin-lab-title', text: 'Plugin Lab' }),
          el('div', {
            class: 'plugin-lab-subtitle',
            text: 'Build plugins by chatting — describe one, then refine it across turns. Everything runs sandboxed.',
          }),
        ]),
        el('div', { class: 'plugin-lab-header-actions' }, headerActions),
      ]),
    )

    // ── Two-pane body: builder chat (left) + installed plugins (right) ──────

    // Left pane: the continuous, follow-up-driven builder (the agent surface).
    backendChipEl = el('div', { class: 'plugin-chat-backend' })
    threadEl = el('div', { class: 'plugin-chat-thread' })

    composerInput = el('textarea', {
      class: 'plugin-chat-input',
      rows: '2',
      placeholder: 'Describe a plugin to build…',
    })
    composerInput.addEventListener('keydown', (e) => {
      // Enter sends; Shift+Enter inserts a newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendTurn(composerInput.value)
      }
    })

    sendBtn = el('button', { class: 'plugin-btn primary plugin-chat-send', html: '<i class="fas fa-arrow-up"></i>' })
    sendBtn.title = 'Send (Enter)'
    sendBtn.addEventListener('click', () => sendTurn(composerInput.value))

    // The builder lives directly IN THE BODY (no card chrome) — open and spacious.
    const builder = el('div', { class: 'plugin-lab-builder' }, [
      el('div', { class: 'plugin-chat-head' }, [
        el('div', { class: 'plugin-card-title', html: '<i class="fas fa-flask"></i> Build with an agent' }),
        backendChipEl,
      ]),
      threadEl,
      el('div', { class: 'plugin-chat-composer' }, [composerInput, sendBtn]),
    ])

    // Right pane: the single files-preview CARD for the current artifact.
    filesEl = el('div', { class: 'plugin-lab-files card' })

    container.appendChild(el('div', { class: 'plugin-lab-body' }, [builder, filesEl]))

    // Installed/built plugins live in a modal (opened from the header), keeping the
    // builder surface focused on the conversation + the files preview.
    listEl = el('div', { class: 'plugin-list' })
    const modalClose = el('button', { class: 'plugin-modal-close', html: '<i class="fas fa-times"></i>' })
    modalClose.title = 'Close'
    modalClose.addEventListener('click', () => closeInstalledModal())
    const modalCard = el('div', { class: 'plugin-modal' }, [
      el('div', { class: 'plugin-modal-head' }, [
        el('div', { class: 'plugin-modal-title', html: '<i class="fas fa-puzzle-piece"></i> Installed plugins' }),
        modalClose,
      ]),
      el('div', { class: 'plugin-modal-body' }, [
        el('div', {
          class: 'plugin-card-hint',
          text: 'Enable, hot-reload, or remove anything you’ve built or installed.',
        }),
        listEl,
      ]),
    ])
    installedModal = el('div', { class: 'plugin-modal-overlay' }, [modalCard])
    installedModal.style.display = 'none'
    // Click the backdrop (not the card) to dismiss.
    installedModal.addEventListener('click', (e) => { if (e.target === installedModal) closeInstalledModal() })
    container.appendChild(installedModal)

    // Toast stack.
    container.appendChild(el('div', { class: 'plugin-lab-toasts' }))

    // Seed the empty thread + the "which agent" chip + the files-preview card.
    renderWelcome()
    refreshBackendChip()
    renderFiles()

    return container
  }

  /* ---- public surface ----------------------------------------------------- */

  async function mount(viewEl) {
    try {
      if (!viewEl) {
        console.warn('[plugin-lab] mount() called with no container.')
        return
      }
      root = viewEl
      approvedSet = await loadApprovals()
      clear(root)
      root.appendChild(build())
      // Escape closes the installed-plugins modal when it's open.
      onModalKeydown = (e) => {
        if (e.key === 'Escape' && installedModal && installedModal.style.display !== 'none') closeInstalledModal()
      }
      document.addEventListener('keydown', onModalKeydown)
      await refresh()
    } catch (e) {
      console.error('[plugin-lab] mount failed:', e)
      try {
        if (viewEl) {
          clear(viewEl)
          viewEl.appendChild(el('div', { class: 'plugin-gen-error', text: `Plugin Lab failed to load: ${e.message}` }))
        }
      } catch (_) { /* ignore */ }
    }
  }

  function dispose() {
    disposed = true
    if (onModalKeydown) { document.removeEventListener('keydown', onModalKeydown); onModalKeydown = null }
    if (root) clear(root)
    root = null
    listEl = null
    threadEl = null
    composerInput = null
    sendBtn = null
    backendChipEl = null
    filesEl = null
    installedModal = null
    installedCountEl = null
  }

  return { mount, refresh, dispose }
}

export default createPluginLab
