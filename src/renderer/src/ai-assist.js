/**
 * ai-assist.js — Optional, opt-in AI writing assistant for Notionless.
 *
 * ETHOS: open-source + local-first.
 *   - OFF by default. Nothing is ever sent anywhere until the user explicitly
 *     configures an endpoint + key AND invokes an action.
 *   - No hardcoded keys, no telemetry, no background calls.
 *   - Uses a USER-CONFIGURED OpenAI-compatible Chat Completions endpoint
 *     (OpenAI, OpenRouter, local llama.cpp / Ollama proxies, etc.).
 *
 * Self-mounting: import { initAIAssist } from './ai-assist'; initAIAssist()
 * It injects its own UI + styles and wires itself to the globals
 * `window.cmView` (CodeMirror EditorView) and `window.docEngine`.
 *
 * The module never throws uncaught: all network/IO is wrapped.
 */

const SETTINGS_KEY = 'ai_config'
const SECURE_KEY_ID = 'ai_api_key'
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'

// ---------------------------------------------------------------------------
// Settings persistence (cross-platform: Electron IPC or web fallback)
// ---------------------------------------------------------------------------

function hasApi() {
  return typeof window !== 'undefined' && window.api && typeof window.api.getSettings === 'function'
}

function hasSecureStore() {
  return typeof window !== 'undefined' && window.api && typeof window.api.invoke === 'function'
}

// Non-secret config (endpoint, model, enabled flag). The API key is stored
// separately (OS keychain on Electron, settings fallback on web).
async function loadConfig() {
  const fallback = {
    enabled: false,
    endpoint: '',
    model: DEFAULT_MODEL,
    apiKey: '',
    // when true, the key lives in settings (web / no-keychain). When false,
    // the key lives in the OS keychain via auth:secure-save (Electron).
    keyInSettings: false,
  }
  if (!hasApi()) return fallback
  try {
    const raw = await window.api.getSettings(SETTINGS_KEY)
    if (!raw) return fallback
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return { ...fallback, ...parsed, apiKey: '' }
  } catch (e) {
    console.warn('[ai-assist] failed to load config:', e)
    return fallback
  }
}

async function loadApiKey(config) {
  // Prefer the OS keychain when available and not explicitly in settings.
  if (!config.keyInSettings && hasSecureStore()) {
    try {
      const v = await window.api.invoke('auth:secure-load', SECURE_KEY_ID)
      if (v) return v
    } catch (e) {
      console.warn('[ai-assist] secure-load failed, falling back:', e)
    }
  }
  // Fallback: read from settings (web, or keychain unavailable).
  if (hasApi()) {
    try {
      const raw = await window.api.getSettings(SETTINGS_KEY)
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (parsed && parsed.apiKey) return parsed.apiKey
      }
    } catch (e) {
      // ignore
    }
  }
  return ''
}

async function saveConfig(config, apiKey) {
  if (!hasApi()) {
    console.warn('[ai-assist] no window.api; cannot persist config')
    return { ok: false, keyInSettings: false }
  }

  let keyInSettings = true

  // Try to stash the key in the OS keychain first (Electron).
  if (apiKey && hasSecureStore()) {
    try {
      const ok = await window.api.invoke('auth:secure-save', SECURE_KEY_ID, apiKey)
      if (ok) keyInSettings = false
    } catch (e) {
      console.warn('[ai-assist] secure-save failed, storing in settings:', e)
    }
  } else if (!apiKey && hasSecureStore()) {
    // No key supplied; clear any previously-stored secure key.
    try {
      await window.api.invoke('auth:secure-clear', SECURE_KEY_ID)
    } catch (e) {
      // ignore
    }
    keyInSettings = false
  }

  const toStore = {
    enabled: !!config.enabled,
    endpoint: config.endpoint || '',
    model: config.model || DEFAULT_MODEL,
    keyInSettings,
    // Only persist the key in plain settings when the keychain wasn't used.
    apiKey: keyInSettings ? (apiKey || '') : '',
  }

  try {
    await window.api.setSettings(SETTINGS_KEY, JSON.stringify(toStore))
    return { ok: true, keyInSettings }
  } catch (e) {
    console.warn('[ai-assist] setSettings failed:', e)
    return { ok: false, keyInSettings }
  }
}

// ---------------------------------------------------------------------------
// CodeMirror helpers — robust against a missing/recreated view
// ---------------------------------------------------------------------------

function getView() {
  return (typeof window !== 'undefined' && window.cmView) ? window.cmView : null
}

// Returns { text, from, to, hasSelection }. Falls back to the whole doc when
// there is no selection.
function getContext() {
  const view = getView()
  if (!view) return { text: '', from: 0, to: 0, hasSelection: false, ok: false }
  try {
    const sel = view.state.selection.main
    if (sel.from !== sel.to) {
      return {
        text: view.state.sliceDoc(sel.from, sel.to),
        from: sel.from,
        to: sel.to,
        hasSelection: true,
        ok: true,
      }
    }
    const full = view.state.doc.toString()
    return { text: full, from: 0, to: full.length, hasSelection: false, ok: true }
  } catch (e) {
    console.warn('[ai-assist] getContext failed:', e)
    return { text: '', from: 0, to: 0, hasSelection: false, ok: false }
  }
}

// Replace the current selection (or, with no selection, the cursor position).
function replaceSelection(text) {
  const view = getView()
  if (!view) return false
  try {
    const sel = view.state.selection.main
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length },
    })
    view.focus()
    return true
  } catch (e) {
    console.warn('[ai-assist] replaceSelection failed:', e)
    return false
  }
}

// Insert at the cursor / end of selection without removing existing text.
function insertAtCursor(text) {
  const view = getView()
  if (!view) return false
  try {
    const sel = view.state.selection.main
    const pos = sel.to
    const prefix = pos > 0 && view.state.sliceDoc(pos - 1, pos) !== '\n' ? '\n\n' : ''
    const insert = prefix + text
    view.dispatch({
      changes: { from: pos, to: pos, insert },
      selection: { anchor: pos + insert.length },
    })
    view.focus()
    return true
  } catch (e) {
    console.warn('[ai-assist] insertAtCursor failed:', e)
    return false
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

const SYSTEM_BASE =
  'You are a concise writing assistant embedded in a Markdown note editor. ' +
  'Return only the requested text in Markdown, with no preamble, no explanations, ' +
  'and no surrounding code fences unless the content itself is code.'

function buildMessages(action, text, extra) {
  let instruction
  switch (action) {
    case 'continue':
      instruction = 'Continue writing from where the following text leaves off. ' +
        'Match the tone and style. Output only the continuation:'
      break
    case 'summarize':
      instruction = 'Summarize the following text concisely:'
      break
    case 'improve':
      instruction = 'Improve the writing of the following text: clarity, flow, and word choice. ' +
        'Keep the meaning and language the same. Output only the improved text:'
      break
    case 'fix':
      instruction = 'Fix spelling, grammar, and punctuation in the following text. ' +
        'Do not change meaning or style. Output only the corrected text:'
      break
    case 'shorter':
      instruction = 'Rewrite the following text to be shorter while keeping the key points:'
      break
    case 'longer':
      instruction = 'Expand the following text with more detail and elaboration, keeping the same tone:'
      break
    case 'translate':
      instruction = `Translate the following text into ${extra || 'English'}. Output only the translation:`
      break
    case 'ask':
      // Free-form: the user's prompt becomes the instruction; selected text (if any) is context.
      if (text && text.trim()) {
        return [
          { role: 'system', content: SYSTEM_BASE },
          { role: 'user', content: `${extra}\n\n---\nRelevant text:\n${text}` },
        ]
      }
      return [
        { role: 'system', content: SYSTEM_BASE },
        { role: 'user', content: extra },
      ]
    default:
      instruction = 'Process the following text:'
  }
  return [
    { role: 'system', content: SYSTEM_BASE },
    { role: 'user', content: `${instruction}\n\n---\n${text}` },
  ]
}

// ---------------------------------------------------------------------------
// Network — OpenAI-compatible Chat Completions
// ---------------------------------------------------------------------------

// Non-streaming request. Returns { ok, content?, error? }.
async function callChat(config, apiKey, messages) {
  const endpoint = (config.endpoint || '').trim()
  if (!endpoint) return { ok: false, error: 'No endpoint configured.' }

  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model || DEFAULT_MODEL,
        messages,
        stream: false,
      }),
    })
  } catch (e) {
    return { ok: false, error: `Network error: ${e && e.message ? e.message : e}` }
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.text()
      detail = body ? ` — ${body.slice(0, 300)}` : ''
    } catch (e) {
      // ignore
    }
    if (res.status === 401) return { ok: false, error: `Unauthorized (401). Check your API key.${detail}` }
    if (res.status === 404) return { ok: false, error: `Not found (404). Check the endpoint URL / model.${detail}` }
    if (res.status === 429) return { ok: false, error: `Rate limited (429). Try again shortly.${detail}` }
    return { ok: false, error: `Request failed (${res.status}).${detail}` }
  }

  let data
  try {
    data = await res.json()
  } catch (e) {
    return { ok: false, error: 'Invalid JSON in response.' }
  }
  const content = data
    && data.choices
    && data.choices[0]
    && data.choices[0].message
    && data.choices[0].message.content
  if (typeof content !== 'string') return { ok: false, error: 'No content in response.' }
  return { ok: true, content: content.trim() }
}

// Streaming request via SSE. Calls onChunk(deltaText) as tokens arrive.
// Returns { ok, content?, error? }. Falls back to non-streaming by the caller.
async function callChatStream(config, apiKey, messages, onChunk) {
  const endpoint = (config.endpoint || '').trim()
  if (!endpoint) return { ok: false, error: 'No endpoint configured.' }

  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model || DEFAULT_MODEL,
        messages,
        stream: true,
      }),
    })
  } catch (e) {
    return { ok: false, error: `Network error: ${e && e.message ? e.message : e}` }
  }

  if (!res.ok || !res.body || typeof res.body.getReader !== 'function') {
    // Let the caller fall back to non-streaming.
    return { ok: false, error: `stream-unavailable:${res ? res.status : 'no-body'}` }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json.choices
            && json.choices[0]
            && json.choices[0].delta
            && json.choices[0].delta.content
          if (delta) {
            full += delta
            if (onChunk) onChunk(delta)
          }
        } catch (e) {
          // partial JSON across chunks — skip; remaining buffered content handles it
        }
      }
    }
  } catch (e) {
    if (full) return { ok: true, content: full.trim() }
    return { ok: false, error: `Stream error: ${e && e.message ? e.message : e}` }
  }

  if (!full) return { ok: false, error: 'Empty stream response.' }
  return { ok: true, content: full.trim() }
}

// ---------------------------------------------------------------------------
// Styles (injected once)
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('ai-assist-styles')) return
  const style = document.createElement('style')
  style.id = 'ai-assist-styles'
  style.textContent = `
.ai-fab {
  position: fixed; right: 20px; bottom: 20px; z-index: 9000;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 999px; border: 1px solid var(--border, #eaeaea);
  background: #fff; color: var(--text, #333); cursor: pointer;
  font-size: 13px; font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,0.12);
  transition: transform .12s ease, box-shadow .12s ease;
}
.ai-fab:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.18); }
.ai-panel {
  position: fixed; right: 20px; bottom: 70px; z-index: 9001;
  width: 360px; max-width: calc(100vw - 40px); max-height: 70vh;
  display: none; flex-direction: column; overflow: hidden;
  background: #fff; color: var(--text, #333);
  border: 1px solid var(--border, #eaeaea); border-radius: 10px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.18); font-size: 13px;
}
.ai-panel.open { display: flex; }
.ai-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 1px solid var(--border, #eaeaea); font-weight: 600;
}
.ai-panel-head .ai-head-actions { display: flex; gap: 6px; }
.ai-icon-btn {
  background: none; border: none; cursor: pointer; color: var(--text-muted, #888);
  font-size: 14px; padding: 2px 6px; border-radius: 4px;
}
.ai-icon-btn:hover { background: var(--bg, #f5f5f5); color: var(--text, #333); }
.ai-panel-body { padding: 12px; overflow-y: auto; }
.ai-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.ai-action {
  padding: 7px 9px; border: 1px solid var(--border, #eaeaea); border-radius: 6px;
  background: #fff; color: var(--text, #333); cursor: pointer; font-size: 12px;
  text-align: left;
}
.ai-action:hover { border-color: var(--accent, #007bff); color: var(--accent, #007bff); }
.ai-action[disabled] { opacity: .5; cursor: not-allowed; }
.ai-ask-row { display: flex; gap: 6px; margin-top: 8px; }
.ai-ask-row input {
  flex: 1; padding: 7px 9px; border: 1px solid var(--border, #eaeaea);
  border-radius: 6px; font-size: 12px; color: var(--text, #333);
}
.ai-primary {
  padding: 7px 12px; border: none; border-radius: 6px; cursor: pointer;
  background: var(--accent, #007bff); color: #fff; font-size: 12px; font-weight: 600;
}
.ai-primary[disabled] { opacity: .5; cursor: not-allowed; }
.ai-note { color: var(--text-muted, #888); font-size: 11px; margin: 8px 0 0; line-height: 1.4; }
.ai-ctx { color: var(--text-muted, #888); font-size: 11px; margin-bottom: 8px; }
.ai-field { margin-bottom: 10px; }
.ai-field label { display: block; font-size: 11px; color: var(--text-muted, #888); margin-bottom: 3px; }
.ai-field input {
  width: 100%; padding: 7px 9px; border: 1px solid var(--border, #eaeaea);
  border-radius: 6px; font-size: 12px; color: var(--text, #333); box-sizing: border-box;
}
.ai-toggle-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.ai-result {
  margin-top: 10px; padding: 10px; border: 1px solid var(--border, #eaeaea);
  border-radius: 6px; background: var(--bg, #f7f7f7); white-space: pre-wrap;
  word-break: break-word; max-height: 220px; overflow-y: auto; font-size: 12px;
  line-height: 1.45;
}
.ai-result-actions { display: flex; gap: 6px; margin-top: 8px; }
.ai-result-actions button {
  padding: 6px 10px; border: 1px solid var(--border, #eaeaea); border-radius: 6px;
  background: #fff; color: var(--text, #333); cursor: pointer; font-size: 12px;
}
.ai-result-actions button:hover { border-color: var(--accent, #007bff); color: var(--accent, #007bff); }
.ai-error { color: #cc0000; font-size: 12px; margin-top: 10px; white-space: pre-wrap; }
.ai-status { color: var(--text-muted, #888); font-size: 12px; margin-top: 10px; }
.ai-disabled-hint { color: var(--text-muted, #888); font-size: 12px; line-height: 1.5; }
.ai-link { background: none; border: none; color: var(--accent, #007bff); cursor: pointer;
  padding: 0; font-size: 12px; text-decoration: underline; }
`
  document.head.appendChild(style)
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function el(tag, attrs, children) {
  const node = document.createElement(tag)
  if (attrs) {
    Object.keys(attrs).forEach((k) => {
      if (k === 'class') node.className = attrs[k]
      else if (k === 'text') node.textContent = attrs[k]
      else if (k === 'html') node.innerHTML = attrs[k]
      else if (k.startsWith('on') && typeof attrs[k] === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), attrs[k])
      } else if (attrs[k] !== false && attrs[k] != null) {
        node.setAttribute(k, attrs[k])
      }
    })
  }
  if (children) {
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    })
  }
  return node
}

const ACTIONS = [
  { id: 'continue', label: 'Continue writing' },
  { id: 'summarize', label: 'Summarize' },
  { id: 'improve', label: 'Improve writing' },
  { id: 'fix', label: 'Fix spelling & grammar' },
  { id: 'shorter', label: 'Make shorter' },
  { id: 'longer', label: 'Make longer' },
  { id: 'translate', label: 'Translate…' },
]

function createUI() {
  injectStyles()

  const state = {
    config: null,
    apiKey: '',
    busy: false,
    lastResult: '',
  }

  // --- Floating button ---
  const fab = el('button', {
    class: 'ai-fab',
    title: 'AI writing assistant (optional, opt-in)',
    'aria-label': 'AI writing assistant',
  })
  fab.innerHTML = '<span>✨</span><span>AI</span>'

  // --- Panel shell ---
  const body = el('div', { class: 'ai-panel-body' })
  const panel = el('div', { class: 'ai-panel', role: 'dialog', 'aria-label': 'AI assistant' })

  const gearBtn = el('button', { class: 'ai-icon-btn', title: 'Settings', text: '⚙' })
  const closeBtn = el('button', { class: 'ai-icon-btn', title: 'Close', text: '✕' })
  const head = el('div', { class: 'ai-panel-head' }, [
    el('span', { text: '✨ AI assistant' }),
    el('div', { class: 'ai-head-actions' }, [gearBtn, closeBtn]),
  ])
  panel.appendChild(head)
  panel.appendChild(body)
  document.body.appendChild(fab)
  document.body.appendChild(panel)

  function open() {
    panel.classList.add('open')
    renderMain()
  }
  function close() {
    panel.classList.remove('open')
  }
  function toggle() {
    if (panel.classList.contains('open')) close()
    else open()
  }

  // ----- Settings view -----
  function renderSettings() {
    body.innerHTML = ''
    const cfg = state.config || {}

    const enabled = el('input', { type: 'checkbox' })
    enabled.checked = !!cfg.enabled
    const toggleRow = el('div', { class: 'ai-toggle-row' }, [
      enabled,
      el('label', { text: 'Enable AI assistant' }),
    ])

    const endpoint = el('input', {
      type: 'text', value: cfg.endpoint || '', placeholder: DEFAULT_ENDPOINT,
    })
    const model = el('input', {
      type: 'text', value: cfg.model || DEFAULT_MODEL, placeholder: DEFAULT_MODEL,
    })
    const key = el('input', {
      type: 'password', value: state.apiKey || '', placeholder: 'sk-… (leave blank for local/no-auth)',
      autocomplete: 'off',
    })

    const status = el('div', { class: 'ai-status', text: '' })
    status.style.display = 'none'

    const saveBtn = el('button', {
      class: 'ai-primary',
      text: 'Save',
      onClick: async () => {
        saveBtn.disabled = true
        const newCfg = {
          enabled: enabled.checked,
          endpoint: endpoint.value.trim() || DEFAULT_ENDPOINT,
          model: model.value.trim() || DEFAULT_MODEL,
        }
        const result = await saveConfig(newCfg, key.value)
        saveBtn.disabled = false
        if (!result.ok) {
          status.style.display = ''
          status.className = 'ai-error'
          status.textContent = 'Could not save settings (no storage available).'
          return
        }
        state.config = { ...newCfg, keyInSettings: result.keyInSettings }
        state.apiKey = key.value
        status.style.display = ''
        status.className = 'ai-status'
        status.textContent = result.keyInSettings
          ? 'Saved. Key stored in app settings (no OS keychain available).'
          : 'Saved. Key stored in your OS keychain.'
        setTimeout(() => { renderMain() }, 700)
      },
    })

    const keyStorageNote = hasSecureStore()
      ? 'The API key is stored in your OS keychain when available (encrypted), otherwise in local app settings.'
      : 'The API key is stored in local app settings on this device.'

    body.appendChild(el('div', {}, [
      toggleRow,
      field('Endpoint URL', endpoint),
      field('Model', model),
      field('API key', key),
      el('p', {
        class: 'ai-note',
        text: 'Privacy: when you run an action, the selected text (or the whole '
          + 'document if nothing is selected) is sent to the endpoint above. '
          + 'No data is sent until you configure this and invoke an action. ' + keyStorageNote,
      }),
      el('div', { style: 'margin-top:10px;display:flex;gap:8px;align-items:center;' }, [saveBtn, status]),
    ]))
  }

  function field(label, input) {
    return el('div', { class: 'ai-field' }, [el('label', { text: label }), input])
  }

  // ----- Main (actions) view -----
  function renderMain() {
    body.innerHTML = ''
    const cfg = state.config || {}
    const viewReady = !!getView()
    const configured = cfg.enabled && (cfg.endpoint && cfg.endpoint.trim())

    if (!hasApi()) {
      body.appendChild(el('div', {
        class: 'ai-disabled-hint',
        text: 'AI settings storage is unavailable in this environment.',
      }))
      return
    }

    if (!configured) {
      const link = el('button', { class: 'ai-link', text: 'Open settings', onClick: renderSettings })
      body.appendChild(el('div', { class: 'ai-disabled-hint' }, [
        el('p', { text: cfg.enabled
          ? 'Add an endpoint to start. '
          : 'AI is off. Enable it and add an endpoint to start. ' }),
        link,
      ]))
      return
    }

    if (!viewReady) {
      body.appendChild(el('div', {
        class: 'ai-disabled-hint',
        text: 'Open a document to use the AI assistant.',
      }))
      return
    }

    const ctx = getContext()
    body.appendChild(el('div', {
      class: 'ai-ctx',
      text: ctx.hasSelection
        ? `Acting on your selection (${ctx.text.length} chars).`
        : `No selection — acting on the whole document (${ctx.text.length} chars).`,
    }))

    const grid = el('div', { class: 'ai-actions' })
    ACTIONS.forEach((a) => {
      const btn = el('button', {
        class: 'ai-action',
        text: a.label,
        onClick: () => runAction(a.id),
      })
      if (state.busy) btn.disabled = true
      grid.appendChild(btn)
    })
    body.appendChild(grid)

    // Free-form Ask AI
    const askInput = el('input', { type: 'text', placeholder: 'Ask AI…' })
    const askBtn = el('button', {
      class: 'ai-primary',
      text: 'Ask',
      onClick: () => {
        const q = askInput.value.trim()
        if (q) runAction('ask', q)
      },
    })
    askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = askInput.value.trim()
        if (q) runAction('ask', q)
      }
    })
    if (state.busy) { askInput.disabled = true; askBtn.disabled = true }
    body.appendChild(el('div', { class: 'ai-ask-row' }, [askInput, askBtn]))

    body.appendChild(el('p', {
      class: 'ai-note',
      text: 'Text is sent to your configured endpoint when you run an action.',
    }))

    // status / result mount points
    const mount = el('div', { id: 'ai-result-mount' })
    body.appendChild(mount)
    if (state.lastResult) renderResult(state.lastResult, mount)
  }

  function renderResult(text, mountArg) {
    const mount = mountArg || document.getElementById('ai-result-mount')
    if (!mount) return
    mount.innerHTML = ''
    const result = el('div', { class: 'ai-result' })
    result.textContent = text
    const actions = el('div', { class: 'ai-result-actions' }, [
      el('button', {
        text: 'Insert',
        title: 'Insert at cursor without removing selection',
        onClick: () => { insertAtCursor(text) },
      }),
      el('button', {
        text: 'Replace',
        title: 'Replace the current selection',
        onClick: () => { replaceSelection(text) },
      }),
      el('button', {
        text: 'Copy',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(text)
          } catch (e) {
            console.warn('[ai-assist] clipboard failed:', e)
          }
        },
      }),
    ])
    mount.appendChild(result)
    mount.appendChild(actions)
  }

  function renderError(message) {
    const mount = document.getElementById('ai-result-mount')
    if (!mount) return
    mount.innerHTML = ''
    mount.appendChild(el('div', { class: 'ai-error', text: message }))
  }

  function renderStatus(message) {
    const mount = document.getElementById('ai-result-mount')
    if (!mount) return
    mount.innerHTML = ''
    mount.appendChild(el('div', { class: 'ai-status', text: message }))
  }

  async function runAction(action, extra) {
    if (state.busy) return
    const cfg = state.config
    if (!cfg || !cfg.enabled || !cfg.endpoint) { renderSettings(); return }

    const view = getView()
    if (!view) { renderMain(); return }

    let target = extra
    if (action === 'translate') {
      // eslint-disable-next-line no-alert
      const lang = window.prompt('Translate to which language?', 'English')
      if (!lang) return
      target = lang.trim()
    }

    const ctx = getContext()
    if (!ctx.ok) { renderError('Could not read editor content.'); return }
    if (action !== 'ask' && !ctx.text.trim()) {
      renderError('Nothing to work with — the document is empty.')
      return
    }

    state.busy = true
    state.lastResult = ''
    renderMain()
    renderStatus('Thinking…')

    const messages = buildMessages(action, ctx.text, target)

    // Try streaming first; fall back to non-streaming on any stream failure.
    let acc = ''
    let result = await callChatStream(cfg, state.apiKey, messages, (delta) => {
      acc += delta
      renderResult(acc)
    })

    if (!result.ok && (!result.error || result.error.startsWith('stream-unavailable'))) {
      renderStatus('Thinking…')
      result = await callChat(cfg, state.apiKey, messages)
    }

    state.busy = false

    if (!result.ok) {
      renderError(result.error || 'Unknown error.')
      // re-enable buttons
      const grid = body.querySelector('.ai-actions')
      if (grid) grid.querySelectorAll('button').forEach((b) => { b.disabled = false })
      return
    }

    state.lastResult = result.content
    renderMain()
  }

  // --- Wire shell events ---
  fab.addEventListener('click', toggle)
  closeBtn.addEventListener('click', close)
  gearBtn.addEventListener('click', renderSettings)

  // --- Async init: load config + key, then refresh if panel open ---
  ;(async () => {
    state.config = await loadConfig()
    state.apiKey = await loadApiKey(state.config)
    if (panel.classList.contains('open')) renderMain()
  })()

  return { open, close, toggle }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

let mounted = false

export function initAIAssist() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  if (mounted || document.querySelector('.ai-fab')) return null
  try {
    mounted = true
    return createUI()
  } catch (e) {
    console.warn('[ai-assist] init failed:', e)
    mounted = false
    return null
  }
}

export default initAIAssist
