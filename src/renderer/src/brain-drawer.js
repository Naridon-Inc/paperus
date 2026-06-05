import { RAGEngine } from './rag-engine'
import Store from './store'
import showdown from 'showdown'
import { serviceLogo } from './brain-service-logos'

const converter = new showdown.Converter({
  tables: true,
  strikethrough: true,
  tasklists: true,
  simplifiedAutoLink: true,
  smoothLivePreview: true
})

// Friendly presets for "use an AI service with your own key". All are
// OpenAI-compatible Chat Completions endpoints, so one code path covers them.
const PROVIDERS = {
  openai: { label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', hint: 'sk-…', keysUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic (Claude)', endpoint: 'https://api.anthropic.com/v1/chat/completions', model: 'claude-3-5-haiku-latest', hint: 'sk-ant-…', keysUrl: 'https://console.anthropic.com/settings/keys' },
  gemini: { label: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.0-flash', hint: 'AIza…', keysUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter (any model)', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'anthropic/claude-3.5-sonnet', hint: 'sk-or-…', keysUrl: 'https://openrouter.ai/keys' },
  custom: { label: 'Custom (OpenAI-compatible)', endpoint: '', model: '', hint: 'optional', keysUrl: '' },
}

// Coding-agent CLIs Brain can drive directly (no API key — they ride the agent's
// own sign-in). Detection is live (main-process `ai:cli-available`); we show every
// one we find, plus a "Custom command" escape hatch for whatever else is installed.
// `mode` is the rag-engine backend: 'claude-code' (bespoke) or 'cli' (generic
// `<cmd> <promptFlag> "<prompt>"` → stdout). `promptFlag` is the headless form.
const CODING_AGENTS = [
  { id: 'claude-code', name: 'Claude Code', cmd: 'claude', mode: 'claude-code', icon: 'fa-terminal', tint: ['#f6efe9', '#c2742d'],
    desc: 'Rides your existing Claude sign-in — <b>no extra key needed</b>.', install: 'https://claude.com/code', installHint: 'claude.com/code' },
  { id: 'gemini', name: 'Gemini CLI', cmd: 'gemini', mode: 'cli', promptFlag: '-p', icon: 'fa-gem', tint: ['#eaf1fe', '#3367d6'],
    desc: 'Google’s Gemini CLI — uses your Gemini sign-in, no key.', install: 'https://github.com/google-gemini/gemini-cli', installHint: 'npm i -g @google/gemini-cli' },
  { id: 'cursor-agent', name: 'Cursor Agent', cmd: 'cursor-agent', mode: 'cli', promptFlag: '-p', icon: 'fa-i-cursor', tint: ['#eef0f2', '#111111'],
    desc: 'Cursor’s command-line agent.', install: 'https://cursor.com/cli', installHint: 'curl cursor.com/install | sh', experimental: true },
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode', mode: 'cli', promptFlag: 'run', icon: 'fa-code', tint: ['#f3eefb', '#7a3ff2'],
    desc: 'Open-source terminal coding agent.', install: 'https://opencode.ai', installHint: 'opencode.ai', experimental: true },
  { id: 'aider', name: 'Aider', cmd: 'aider', mode: 'cli', promptFlag: '--message', icon: 'fa-robot', tint: ['#eef6ef', '#3f9c52'],
    desc: 'Open-source AI pair programmer.', install: 'https://aider.chat', installHint: 'python -m pip install aider-install', experimental: true },
]

// Chat history is preserved across re-index and app restarts (persisted to
// electron-settings). Capped so the store never grows unbounded.
const BRAIN_HISTORY_KEY = 'brain_chat_history'
const BRAIN_HISTORY_CAP = 80

// Starter prompts shown on the empty Brain — one click asks the question.
const BRAIN_SUGGESTIONS = [
  'Give me an overview of everything in my workspace',
  'What decisions have we made about the roadmap?',
  'Find every open question or TODO across my notes',
  'Summarize what changed in my notes recently',
]

export class CompanyBrainCenter {
  constructor(appContext) {
    this.appContext = appContext
    this.engine = new RAGEngine()
    this.chatHistory = []
    this._configured = false

    this.engine.onStatusChange = (status) => this.updateStatusIndicator(status)
    this.render()
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  render() {
    const div = document.getElementById('brain-view')
    if (!div) {
      console.error('[Brain UI] #brain-view container not found in main DOM.')
      return
    }

    div.className = 'brain-page-layout'
    div.innerHTML = `
      <div class="brain-topbar">
        <div class="brain-title"><i class="fas fa-brain"></i><span>Brain</span></div>
        <div class="brain-topbar-actions">
          <span class="brain-status-mini" id="brain-status-mini"></span>
          <button class="brain-ai-chip chip-unset" id="brain-ai-chip" title="Choose / change AI">
            <span class="chip-dot"></span>
            <span class="chip-label" id="brain-ai-label">Set up AI</span>
            <i class="fas fa-chevron-circle-down" style="font-size:9px;opacity:.55;"></i>
          </button>
          <button class="brain-icon-btn" id="clear-brain-chat" title="Clear chat"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>

      <div class="brain-body">
        <div class="brain-chat-panel" id="brain-chat-list">${this.welcomeHTML()}</div>
        <div class="brain-setup" id="brain-setup" style="display:none;"></div>
      </div>

      <div class="brain-input-wrapper" id="brain-input-wrapper">
        <div class="brain-input-container">
          <textarea id="brain-query-input" placeholder="Ask anything about your notes…" rows="1"></textarea>
          <button class="brain-send-btn" id="brain-send-btn" title="Ask"><i class="fas fa-arrow-up"></i></button>
        </div>
      </div>
    `

    this.bindEvents()
    this.boot()
  }

  async boot() {
    await this.engine.loadAIConfig()
    this._configured = await this.hasSavedConfig()
    this.updateAIChip()
    if (this._configured) this.showChat()
    else this.showSetup()
    // Bring back the prior conversation (survives re-index + restarts).
    await this.restoreHistory()
  }

  welcomeHTML() {
    const chips = BRAIN_SUGGESTIONS
      .map((s) => `<button class="brain-suggestion" type="button">${this.escapeHtml(s)}</button>`)
      .join('')
    return `
      <div class="brain-welcome-msg">
        <div class="welcome-icon-wrapper"><i class="fas fa-brain"></i></div>
        <h3>Ask your notes anything</h3>
        <p>I read across your whole workspace and answer in plain language — and I always show you the exact notes I used.</p>
        <div class="brain-suggestions">${chips}</div>
      </div>
    `
  }

  bindEvents() {
    const input = document.getElementById('brain-query-input')
    const sendBtn = document.getElementById('brain-send-btn')
    const clearBtn = document.getElementById('clear-brain-chat')
    const chip = document.getElementById('brain-ai-chip')

    if (input) {
      input.addEventListener('input', () => {
        input.style.height = 'auto'
        input.style.height = `${Math.min(input.scrollHeight, 120)}px`
      })
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitQuery() }
      })
    }
    if (sendBtn) sendBtn.onclick = () => this.submitQuery()
    if (clearBtn) clearBtn.onclick = () => this.clearChat()
    if (chip) chip.onclick = () => this.toggleSetup()

    const chatList = document.getElementById('brain-chat-list')
    if (chatList) {
      chatList.addEventListener('click', (e) => {
        const sug = e.target.closest('.brain-suggestion')
        if (sug) {
          const box = document.getElementById('brain-query-input')
          if (box) box.value = sug.textContent
          this.submitQuery()
          return
        }
        const link = e.target.closest('.brain-md-link')
        if (link) {
          e.preventDefault()
          const url = link.getAttribute('data-url')
          if (url && url.startsWith('file://')) {
            window.dispatchEvent(new CustomEvent('cmd:open-brain-citation', { detail: url.replace('file://', '') }))
          }
        }
      })
    }
    window.addEventListener('cmd:open-brain-citation', (e) => {
      const filePath = e.detail
      if (filePath && this.appContext && typeof this.appContext.openFile === 'function') {
        this.appContext.openFile(filePath)
      }
    })
  }

  // ── View switching ──────────────────────────────────────────────────────────

  showChat() {
    const setup = document.getElementById('brain-setup')
    const chat = document.getElementById('brain-chat-list')
    const input = document.getElementById('brain-input-wrapper')
    if (setup) setup.style.display = 'none'
    if (chat) chat.style.display = 'flex'
    if (input) input.style.display = 'flex'
  }

  showSetup() {
    const setup = document.getElementById('brain-setup')
    const chat = document.getElementById('brain-chat-list')
    const input = document.getElementById('brain-input-wrapper')
    if (chat) chat.style.display = 'none'
    if (input) input.style.display = 'none'
    if (setup) { setup.style.display = 'block'; this.renderSetup() }
  }

  toggleSetup() {
    const setup = document.getElementById('brain-setup')
    if (setup && setup.style.display !== 'none') this.showChat()
    else this.showSetup()
  }

  // ── Provider setup UI ────────────────────────────────────────────────────────

  renderSetup() {
    const host = document.getElementById('brain-setup')
    if (!host) return
    const mode = this.engine.aiMode
    host.innerHTML = `
      <div class="setup-inner">
        <h2>How should Brain think?</h2>
        <p class="setup-sub">Brain finds the right notes on your device either way — this only sets who writes the answer. You can switch anytime.</p>

        <button class="setup-card ${mode === 'local' ? 'is-current' : ''}" data-pick="local">
          <div class="sc-ico" style="background:#eef6ef;color:#3f9c52;"><i class="fas fa-laptop"></i></div>
          <div class="sc-main">
            <div class="sc-title">On your computer <span class="sc-badge">Free · Private</span></div>
            <div class="sc-desc">Runs a free app called <b>Ollama</b> right on your Mac. Nothing ever leaves your device — no account, no key, no cost. Best for privacy.</div>
            <div class="sc-state" id="state-local"></div>
          </div>
        </button>

        <button class="setup-card ${mode === 'api' ? 'is-current' : ''}" data-pick="api">
          <div class="sc-ico" style="background:#eef1fb;color:#4f6bed;"><i class="fas fa-key"></i></div>
          <div class="sc-main">
            <div class="sc-title">Use an AI service or your own backend</div>
            <div class="sc-desc">Have a key for OpenAI, Claude, Gemini or OpenRouter — or your own OpenAI-compatible endpoint? Paste it once and Brain uses it. Stored securely on this device.</div>
          </div>
        </button>

        <div class="setup-section-label">Coding agents on your Mac</div>
        <p class="setup-section-sub">Brain can ask any agent CLI you already use directly — no extra key, it rides the agent’s own sign-in. Detected automatically.</p>
        <div class="coding-agents" id="coding-agents"></div>

        <div class="setup-forms" id="setup-forms"></div>
      </div>
    `
    host.querySelectorAll('.setup-card[data-pick]').forEach((card) => {
      card.onclick = () => this.pick(card.getAttribute('data-pick'))
    })
    // Live availability for Local + every coding agent.
    this.refreshLocalState()
    this.refreshCodingAgents()
  }

  /**
   * Probe every known coding-agent CLI (and any custom one the user added) and
   * render a selectable card per detected agent, plus install hints for the rest
   * and a "Custom command…" escape hatch. Detection is live via the main process.
   */
  async refreshCodingAgents() {
    const host = document.getElementById('coding-agents')
    if (!host) return
    host.innerHTML = '<div class="ca-checking"><i class="fas fa-circle-notch fa-spin"></i> Looking for coding agents…</div>'

    const mode = this.engine.aiMode
    const currentCmd = this.engine.cliCmd || ''
    const results = await Promise.all(CODING_AGENTS.map(async (a) => ({ a, det: await this.detectAgent(a) })))

    // Detected agents first, then the rest (so what they actually have floats up).
    results.sort((x, y) => (y.det.available - x.det.available))

    const isCurrent = (a) => (a.mode === 'claude-code' && mode === 'claude-code')
      || (a.mode === 'cli' && mode === 'cli' && currentCmd === a.cmd)

    const cards = results.map(({ a, det }) => {
      const stateHtml = det.available
        ? `<span class="sc-ok"><i class="fas fa-check-circle"></i> Detected${det.version ? ` — ${this.escapeHtml(det.version)}` : ''}</span>`
        : `<span class="sc-muted">Not installed — <code>${this.escapeHtml(a.cmd)}</code> not found</span>`
      const exp = a.experimental ? '<span class="sc-badge sc-badge-soft">experimental</span>' : ''
      return `
        <button class="setup-card ca-card ${det.available ? '' : 'is-missing'} ${isCurrent(a) ? 'is-current' : ''}" data-agent="${a.id}">
          <div class="sc-ico" style="background:${a.tint[0]};color:${a.tint[1]};">${this.agentIconHtml(a)}</div>
          <div class="sc-main">
            <div class="sc-title">${this.escapeHtml(a.name)} ${exp}</div>
            <div class="sc-desc">${a.desc}</div>
            <div class="sc-state">${stateHtml}</div>
          </div>
        </button>`
    }).join('')

    host.innerHTML = cards + `
      <button class="setup-card ca-card ca-custom" data-agent="__custom__">
        <div class="sc-ico" style="background:#f0f0f2;color:#555;"><i class="fas fa-plus"></i></div>
        <div class="sc-main">
          <div class="sc-title">Other coding agent…</div>
          <div class="sc-desc">Point Brain at any CLI by command name (e.g. <code>codex</code>, <code>amp</code>).</div>
        </div>
      </button>`

    host.querySelectorAll('.ca-card').forEach((card) => {
      card.onclick = () => {
        const id = card.getAttribute('data-agent')
        if (id === '__custom__') return this.pickCustomAgent()
        const agent = CODING_AGENTS.find((x) => x.id === id)
        if (agent) this.pickAgent(agent)
      }
    })
  }

  /** A real brand mark for known agents (Claude/Gemini), else the FA glyph. */
  agentIconHtml(a) {
    if (a.id === 'claude-code') return serviceLogo('claude')
    if (a.id === 'gemini') return serviceLogo('gemini')
    return `<i class="fas ${a.icon}"></i>`
  }

  /** Detect one agent. claude-code keeps its bespoke channel; others use the generic probe. */
  async detectAgent(agent) {
    const channel = agent.id === 'claude-code' ? 'ai:claude-code-available'
      : agent.id === 'gemini' ? 'ai:gemini-available'
        : 'ai:cli-available'
    try {
      const payload = channel === 'ai:cli-available' ? { name: agent.cmd } : undefined
      const r = await window.api.invoke(channel, payload)
      return { available: !!(r && r.available), version: r && r.version ? String(r.version) : '' }
    } catch (_) { return { available: false, version: '' } }
  }

  /** Select a detected coding agent as Brain's backend; if missing, show install help. */
  async pickAgent(agent) {
    const forms = document.getElementById('setup-forms')
    if (forms) forms.innerHTML = ''
    const det = await this.detectAgent(agent)
    if (det.available) {
      await this.saveConfig({ mode: agent.mode, cliCmd: agent.mode === 'cli' ? agent.cmd : '', cliPromptFlag: agent.promptFlag || '-p' })
      return this.finishSetup()
    }
    if (!forms) return
    forms.innerHTML = `
      <div class="setup-help">
        <div class="help-title">${this.escapeHtml(agent.name)} isn’t installed yet</div>
        <p class="help-note">Brain looks for the <code>${this.escapeHtml(agent.cmd)}</code> command on your Mac. Install it
          ${agent.installHint ? `(<code>${this.escapeHtml(agent.installHint)}</code>)` : ''} from
          <a href="#" class="ext-link" data-url="${agent.install}">${this.escapeHtml(agent.installHint || agent.install)}</a>, sign in once, then press Re-check.</p>
        <div class="setup-actions"><button class="btn-primary" id="agent-recheck">Re-check</button></div>
      </div>`
    this.wireExternalLinks(forms)
    forms.querySelector('#agent-recheck').onclick = () => { this.refreshCodingAgents(); this.pickAgent(agent) }
  }

  /** "Other coding agent…" — let the user name any installed CLI and use it. */
  async pickCustomAgent() {
    const forms = document.getElementById('setup-forms')
    if (!forms) return
    forms.innerHTML = `
      <div class="setup-help">
        <div class="help-title">Use any coding-agent CLI</div>
        <p class="help-note">Type the command name. Brain runs <code>&lt;command&gt; -p "your question"</code> and reads the answer from its output.</p>
        <div class="api-row"><label>Command</label><input type="text" id="custom-cli-cmd" placeholder="e.g. codex, amp, gemini" autocomplete="off"></div>
        <div class="api-row"><label>Prompt flag</label><input type="text" id="custom-cli-flag" placeholder="-p" value="-p"></div>
        <div class="setup-actions">
          <button class="btn-primary" id="custom-cli-save">Detect &amp; use</button>
        </div>
        <div class="sc-state" id="custom-cli-state"></div>
      </div>`
    forms.querySelector('#custom-cli-save').onclick = async () => {
      const cmd = (forms.querySelector('#custom-cli-cmd').value || '').trim()
      const flag = (forms.querySelector('#custom-cli-flag').value || '-p').trim() || '-p'
      const state = forms.querySelector('#custom-cli-state')
      if (!cmd) { state.innerHTML = '<span class="sc-muted">Enter a command name.</span>'; return }
      state.innerHTML = '<span class="sc-checking">Checking…</span>'
      let r
      try { r = await window.api.invoke('ai:cli-available', { name: cmd }) } catch (_) { r = null }
      if (r && r.available) {
        await this.saveConfig({ mode: 'cli', cliCmd: cmd, cliPromptFlag: flag })
        return this.finishSetup()
      }
      state.innerHTML = `<span class="sc-muted">Couldn’t find <code>${this.escapeHtml(cmd)}</code> on your Mac. Make sure it runs in a terminal.</span>`
    }
  }

  escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  async refreshLocalState() {
    const el = document.getElementById('state-local')
    if (!el) return
    el.innerHTML = '<span class="sc-checking">Checking…</span>'
    const r = await this.detectLocal()
    if (r.ok && r.models.length) {
      el.innerHTML = `<span class="sc-ok"><i class="fas fa-check-circle"></i> Ready — ${r.models.length} model${r.models.length === 1 ? '' : 's'} installed</span>`
    } else if (r.ok) {
      el.innerHTML = `<span class="sc-warn"><i class="fas fa-info-circle"></i> Ollama is running but has no model yet</span>`
    } else {
      el.innerHTML = `<span class="sc-muted">Not installed yet — that's fine, we'll show you how (2 min).</span>`
    }
  }

  async refreshClaudeState() {
    const el = document.getElementById('state-claude')
    if (!el) return
    el.innerHTML = '<span class="sc-checking">Checking…</span>'
    const r = await this.detectClaude()
    if (r && r.available) {
      el.innerHTML = `<span class="sc-ok"><i class="fas fa-check-circle"></i> Detected${r.version ? ` — ${r.version}` : ''}</span>`
    } else {
      el.innerHTML = `<span class="sc-muted">Not detected on this Mac.</span>`
    }
  }

  async pick(which) {
    const forms = document.getElementById('setup-forms')
    if (forms) forms.innerHTML = ''
    document.querySelectorAll('.setup-card').forEach((c) => c.classList.toggle('is-active', c.getAttribute('data-pick') === which))

    if (which === 'local') return this.pickLocal()
    if (which === 'claude-code') return this.pickClaude()
    if (which === 'api') return this.renderApiForm()
  }

  async pickLocal() {
    const forms = document.getElementById('setup-forms')
    const r = await this.detectLocal()
    if (r.ok && r.models.length) {
      await this.saveConfig({ mode: 'local' })
      return this.finishSetup()
    }
    // Not ready → plain-language install help. Still let them choose it.
    forms.innerHTML = `
      <div class="setup-help">
        <div class="help-title">Get the free local AI in two steps</div>
        <ol class="help-steps">
          <li>Download <b>Ollama</b> (free) from <a href="#" class="ext-link" data-url="https://ollama.com">ollama.com</a> and open it.</li>
          <li>Open the Mac <b>Terminal</b> app and paste this, then press Enter:
            <div class="help-code"><code>ollama run llama3.2</code><button class="copy-btn" data-copy="ollama run llama3.2">Copy</button></div>
          </li>
        </ol>
        <p class="help-note">That downloads a small model the first time. When it finishes, come back and press <b>Re-check</b>.</p>
        <div class="setup-actions">
          <button class="btn-primary" id="local-recheck">Re-check</button>
          <button class="btn-ghost" id="local-anyway">Use it anyway</button>
        </div>
      </div>
    `
    this.wireExternalLinks(forms)
    forms.querySelector('#local-recheck').onclick = () => this.pickLocal()
    forms.querySelector('#local-anyway').onclick = async () => { await this.saveConfig({ mode: 'local' }); this.finishSetup() }
    this.refreshLocalState()
  }

  async pickClaude() {
    const forms = document.getElementById('setup-forms')
    const r = await this.detectClaude()
    if (r && r.available) {
      await this.saveConfig({ mode: 'claude-code' })
      return this.finishSetup()
    }
    forms.innerHTML = `
      <div class="setup-help">
        <div class="help-title">Claude Code isn't installed yet</div>
        <p class="help-note">Brain looks for the <code>claude</code> command on your Mac. Install Claude Code from
          <a href="#" class="ext-link" data-url="https://claude.com/code">claude.com/code</a>, sign in once, then press Re-check.</p>
        <div class="setup-actions">
          <button class="btn-primary" id="claude-recheck">Re-check</button>
        </div>
      </div>
    `
    this.wireExternalLinks(forms)
    forms.querySelector('#claude-recheck').onclick = () => this.pickClaude()
    this.refreshClaudeState()
  }

  renderApiForm() {
    const forms = document.getElementById('setup-forms')
    const current = this.engine.aiMode === 'api' ? (this.engine._provider || 'openai') : 'openai'
    const opts = Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}" ${k === current ? 'selected' : ''}>${p.label}</option>`).join('')
    forms.innerHTML = `
      <div class="setup-help">
        <div class="api-row">
          <label>Provider</label>
          <select id="api-provider">${opts}</select>
        </div>
        <div class="api-row">
          <label>API key</label>
          <input type="password" id="api-key" placeholder="paste your key" autocomplete="off">
        </div>
        <div class="api-row">
          <label>Model</label>
          <input type="text" id="api-model" placeholder="model name">
        </div>
        <div class="api-row api-row-endpoint" id="api-endpoint-row" style="display:none;">
          <label>Endpoint</label>
          <input type="text" id="api-endpoint" placeholder="https://…/v1/chat/completions">
        </div>
        <div class="api-getkey" id="api-getkey"></div>
        <div class="setup-actions">
          <button class="btn-primary" id="api-save">Save & start</button>
        </div>
      </div>
    `
    const sel = forms.querySelector('#api-provider')
    const modelEl = forms.querySelector('#api-model')
    const endpRow = forms.querySelector('#api-endpoint-row')
    const endpEl = forms.querySelector('#api-endpoint')
    const getKey = forms.querySelector('#api-getkey')
    const apply = () => {
      const p = PROVIDERS[sel.value]
      modelEl.value = p.model
      endpEl.value = p.endpoint
      endpRow.style.display = sel.value === 'custom' ? 'flex' : 'none'
      getKey.innerHTML = p.keysUrl ? `Need a key? <a href="#" class="ext-link" data-url="${p.keysUrl}">Get one here</a>.` : ''
      this.wireExternalLinks(getKey)
    }
    sel.onchange = apply
    apply()
    forms.querySelector('#api-save').onclick = async () => {
      const provider = sel.value
      const endpoint = (provider === 'custom' ? endpEl.value : PROVIDERS[provider].endpoint).trim()
      const model = modelEl.value.trim() || PROVIDERS[provider].model
      const key = forms.querySelector('#api-key').value.trim()
      if (!endpoint) return this.toast('Please enter an endpoint URL.')
      await this.saveConfig({ mode: 'api', provider, endpoint, model }, key)
      this.finishSetup()
    }
  }

  async finishSetup() {
    this._configured = true
    this.updateAIChip()
    this.showChat()
    // Index the active project now that a backend is chosen.
    if (Store.projectPath && this.engine.status !== 'indexing') {
      this.engine.indexProject(Store.projectPath).catch(() => {})
    }
  }

  // ── Backend detection helpers ────────────────────────────────────────────────

  async detectLocal() {
    try {
      const r = await window.api.invoke('ai:ollama-request', { path: '/api/tags', method: 'GET' })
      const models = (r && r.data && Array.isArray(r.data.models)) ? r.data.models.map((m) => m.name) : []
      return { ok: !!(r && r.ok), models }
    } catch (_) { return { ok: false, models: [] } }
  }

  async detectClaude() {
    try { return (await window.api.invoke('ai:claude-code-available')) || { available: false } }
    catch (_) { return { available: false } }
  }

  // ── Config persistence ───────────────────────────────────────────────────────

  async hasSavedConfig() {
    try {
      if (window.api && window.api.getSettings) {
        const raw = await window.api.getSettings('brain_ai')
        return !!raw
      }
    } catch (_) { /* ignore */ }
    return false
  }

  async saveConfig(partial, apiKey) {
    const cfg = { mode: 'local', provider: '', endpoint: '', model: '', claudeModel: '', cliCmd: '', cliPromptFlag: '-p', ...partial }
    let keyInSettings = false
    if (typeof apiKey === 'string') {
      if (window.api && window.api.invoke) {
        if (apiKey) {
          try { await window.api.invoke('auth:secure-save', 'brain_api_key', apiKey) }
          catch (_) { keyInSettings = true }
        } else {
          try { await window.api.invoke('auth:secure-clear', 'brain_api_key') } catch (_) { /* ignore */ }
        }
      } else {
        keyInSettings = true
      }
    }
    const toStore = { mode: cfg.mode, provider: cfg.provider, endpoint: cfg.endpoint, model: cfg.model, claudeModel: cfg.claudeModel, cliCmd: cfg.cliCmd, cliPromptFlag: cfg.cliPromptFlag }
    if (keyInSettings && apiKey) toStore.apiKey = apiKey
    try { await window.api.setSettings('brain_ai', JSON.stringify(toStore)) } catch (_) { /* ignore */ }
    this.engine._provider = cfg.provider
    await this.engine.loadAIConfig()
  }

  updateAIChip() {
    const label = document.getElementById('brain-ai-label')
    const chip = document.getElementById('brain-ai-chip')
    if (!label || !chip) return
    const m = this.engine.aiMode
    const agentName = (this.engine.cliCmd && (CODING_AGENTS.find((a) => a.cmd === this.engine.cliCmd) || {}).name) || this.engine.cliCmd
    const names = { local: 'On your computer', api: this.providerLabel(), 'claude-code': 'Claude Code', cli: agentName || 'Coding agent' }
    label.textContent = this._configured ? (names[m] || 'AI') : 'Set up AI'
    chip.classList.toggle('chip-unset', !this._configured)
    chip.classList.toggle('chip-local', this._configured && m === 'local')
    chip.classList.toggle('chip-cloud', this._configured && m !== 'local')
    // Show the real service mark (Claude/Gemini/OpenAI/Ollama/…) in place of the dot.
    const dot = chip.querySelector('.chip-dot')
    if (dot) {
      if (this._configured) { dot.innerHTML = serviceLogo(this.logoKindForBackend()); dot.classList.add('has-logo') }
      else { dot.innerHTML = ''; dot.classList.remove('has-logo') }
    }
  }

  /** Map the active backend → a service-logo kind. */
  logoKindForBackend() {
    const m = this.engine.aiMode
    if (m === 'local') return 'ollama'
    if (m === 'claude-code') return 'claude'
    if (m === 'api') {
      const p = this.engine._provider
      if (p === 'openai') return 'openai'
      if (p === 'anthropic') return 'claude'
      if (p === 'gemini') return 'gemini'
      if (p === 'openrouter') return 'openrouter'
      return 'service'
    }
    if (m === 'cli') {
      const cmd = this.engine.cliCmd || ''
      if (cmd === 'gemini') return 'gemini'
      if (cmd === 'claude') return 'claude'
      return 'agent'
    }
    return 'service'
  }

  providerLabel() {
    const p = this.engine._provider
    return (p && PROVIDERS[p]) ? PROVIDERS[p].label : 'AI service'
  }

  // ── Small UI utilities ───────────────────────────────────────────────────────

  wireExternalLinks(scope) {
    if (!scope) return
    scope.querySelectorAll('.ext-link').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault()
        const url = a.getAttribute('data-url')
        if (window.api && window.api.invoke) window.api.invoke('shell:openExternal', url).catch(() => {})
        else window.open(url, '_blank')
      }
    })
    scope.querySelectorAll('.copy-btn').forEach((b) => {
      b.onclick = () => {
        const t = b.getAttribute('data-copy')
        try { navigator.clipboard.writeText(t) } catch (_) { /* ignore */ }
        const old = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = old }, 1200)
      }
    })
  }

  toast(msg) {
    const forms = document.getElementById('setup-forms')
    if (!forms) return
    let t = forms.querySelector('.setup-toast')
    if (!t) { t = document.createElement('div'); t.className = 'setup-toast'; forms.appendChild(t) }
    t.textContent = msg
  }

  // ── Indexing status (kept minimal) ───────────────────────────────────────────

  updateStatusIndicator(status) {
    const el = document.getElementById('brain-status-mini')
    if (!el) return
    if (status === 'indexing') el.textContent = 'Reading your notes…'
    else if (status === 'ready') el.textContent = `${this.engine.chunks.length} notes ready`
    else if (status === 'error') el.textContent = ''
    else el.textContent = ''
  }

  // ── Workspace lifecycle (public API used by main.js) ─────────────────────────

  async initializeWorkspace(projectPath) {
    if (!projectPath) return
    // Indexing the workspace must NOT erase the conversation — history is
    // preserved across re-index and restarts (restored in boot()).
    await this.engine.indexProject(projectPath)
  }

  // ── Chat history persistence ─────────────────────────────────────────────────

  /** Persist the running transcript (best-effort, capped). */
  saveHistory() {
    try {
      const trimmed = Array.isArray(this.chatHistory) ? this.chatHistory.slice(-BRAIN_HISTORY_CAP) : []
      if (window.api && typeof window.api.invoke === 'function') {
        window.api.invoke('settings:set', BRAIN_HISTORY_KEY, trimmed)
      }
    } catch (_) { /* best-effort */ }
  }

  /** Reload + re-render the prior transcript on launch. */
  async restoreHistory() {
    try {
      if (!(window.api && typeof window.api.invoke === 'function')) return
      const saved = await window.api.invoke('settings:get', BRAIN_HISTORY_KEY)
      if (!Array.isArray(saved) || !saved.length) return
      this.chatHistory = saved.slice(-BRAIN_HISTORY_CAP)
      const chatList = document.getElementById('brain-chat-list')
      if (!chatList) return
      const welcome = chatList.querySelector('.brain-welcome-msg')
      if (welcome) welcome.remove()
      for (const m of this.chatHistory) {
        if (!m || !m.role) continue
        if (m.role === 'user') this.appendMessage('user', m.content || '')
        else this.appendAssistantBubble(m.content || '', m.citations)
      }
      chatList.scrollTop = chatList.scrollHeight
    } catch (_) { /* best-effort */ }
  }

  async handleFileChanged(filePath) {
    await this.engine.handleFileChanged(filePath)
  }

  clearChatUI() {
    const list = document.getElementById('brain-chat-list')
    if (list) list.innerHTML = this.welcomeHTML()
  }

  clearChat() {
    this.chatHistory = []
    this.clearChatUI()
    this.saveHistory()
  }

  // ── Chat ─────────────────────────────────────────────────────────────────────

  async submitQuery() {
    const input = document.getElementById('brain-query-input')
    const query = input.value.trim()
    if (!query) return
    input.value = ''
    input.style.height = 'auto'

    const chatList = document.getElementById('brain-chat-list')
    const welcome = chatList.querySelector('.brain-welcome-msg')
    if (welcome) welcome.remove()

    this.appendMessage('user', query)

    const assistantBubble = this.createMessageBubble('assistant')
    chatList.appendChild(assistantBubble)
    chatList.scrollTop = chatList.scrollHeight

    const responseContainer = assistantBubble.querySelector('.message-body')
    const thinkingIndicator = document.createElement('div')
    thinkingIndicator.className = 'thinking-indicator'
    thinkingIndicator.innerHTML = `
      <i class="fas fa-spinner fa-spin" style="margin-right: 6px; color: #888;"></i>
      <span class="thinking-label" style="font-size: 12px; color: #888; font-style: italic;">Thinking…</span>
    `
    responseContainer.appendChild(thinkingIndicator)

    const cursor = document.createElement('span')
    cursor.className = 'streaming-cursor'
    cursor.style.display = 'none'
    responseContainer.appendChild(cursor)

    let accumulatedText = ''
    let isThinking = true

    try {
      // Pass the running transcript so the Brain can resolve follow-ups
      // ("what do these have in it?") and keep context across turns.
      const priorHistory = Array.isArray(this.chatHistory) ? this.chatHistory.slice() : []
      await this.engine.askBrain(
        query,
        (token) => {
          if (isThinking) { isThinking = false; thinkingIndicator.remove(); cursor.style.display = 'inline-block' }
          accumulatedText += token
          responseContainer.innerHTML = this.formatMarkdown(accumulatedText)
          responseContainer.appendChild(cursor)
          chatList.scrollTop = chatList.scrollHeight
        },
        (fullAnswer, citations) => {
          if (isThinking) { isThinking = false; thinkingIndicator.remove() }
          cursor.remove()
          if (fullAnswer) responseContainer.innerHTML = this.formatMarkdown(fullAnswer)
          else if (!responseContainer.innerHTML.trim()) responseContainer.innerHTML = 'No answer came back. Try the gear (top-right) to check your AI setup.'

          this.attachCitations(assistantBubble, citations)

          this.chatHistory.push({ role: 'user', content: query })
          this.chatHistory.push({ role: 'assistant', content: fullAnswer, citations })
          this.saveHistory()
          chatList.scrollTop = chatList.scrollHeight
        },
        priorHistory,
        (tool) => {
          // The agent is calling a tool — reflect it in the live status line.
          if (!isThinking) return
          const label = thinkingIndicator.querySelector('.thinking-label')
          if (label) label.textContent = this.toolStatusLabel(tool)
        },
      )
    } catch (e) {
      cursor.remove()
      responseContainer.innerHTML = `Something went wrong: ${e.message}`
    }
  }

  getRelativePath(filePath) {
    if (!this.engine.projectPath) return filePath
    const rel = filePath.replace(this.engine.projectPath, '')
    return rel.startsWith('/') || rel.startsWith('\\') ? rel.substring(1) : rel
  }

  /** Friendly status text for a tool the agent is calling mid-answer. */
  toolStatusLabel(tool) {
    const map = {
      list_documents: 'Looking over your documents…',
      search_documents: 'Searching your notes…',
      read_document: 'Reading a document…',
      get_outline: 'Scanning an outline…',
    }
    return map[tool] || `Using ${String(tool || 'a tool').replace(/_/g, ' ')}…`
  }

  appendMessage(role, content) {
    const chatList = document.getElementById('brain-chat-list')
    const bubble = this.createMessageBubble(role)
    bubble.querySelector('.message-body').innerHTML = this.formatMarkdown(content)
    chatList.appendChild(bubble)
    chatList.scrollTop = chatList.scrollHeight
  }

  /** Render a finished assistant message (used when restoring saved history). */
  appendAssistantBubble(content, citations) {
    const chatList = document.getElementById('brain-chat-list')
    if (!chatList) return null
    const bubble = this.createMessageBubble('assistant')
    bubble.querySelector('.message-body').innerHTML = this.formatMarkdown(content || '')
    chatList.appendChild(bubble)
    this.attachCitations(bubble, citations)
    return bubble
  }

  /** Attach a "Sources" block to an assistant bubble (shared live + on restore). */
  attachCitations(bubble, citations) {
    if (!bubble || !Array.isArray(citations) || citations.length === 0) return
    const citationsContainer = document.createElement('div')
    citationsContainer.className = 'citations-container'
    citationsContainer.innerHTML = `
      <div class="citations-header"><i class="fas fa-book-open"></i> Sources</div>
      <div class="citations-list"></div>
    `
    const list = citationsContainer.querySelector('.citations-list')
    citations.forEach((cit) => {
      const item = document.createElement('div')
      item.className = 'citation-item'
      const relPath = this.getRelativePath(cit.filePath)
      const displayHeader = cit.header ? ` › ${cit.header}` : ''
      item.innerHTML = `<i class="far fa-file-alt"></i><span class="citation-link" title="${cit.filePath}">${relPath}${displayHeader}</span>`
      item.onclick = () => window.dispatchEvent(new CustomEvent('cmd:open-brain-citation', { detail: cit.filePath }))
      list.appendChild(item)
    })
    const msgContent = bubble.querySelector('.message-content')
    if (msgContent) msgContent.appendChild(citationsContainer)
  }

  createMessageBubble(role) {
    const div = document.createElement('div')
    div.className = `brain-message ${role === 'user' ? 'msg-user' : 'msg-brain'}`
    div.innerHTML = `
      <div class="message-avatar"><i class="${role === 'user' ? 'fas fa-user' : 'fas fa-brain'}"></i></div>
      <div class="message-content">
        <div class="message-body"></div>
      </div>
    `
    return div
  }

  formatMarkdown(text) {
    if (!text) return ''
    let html = converter.makeHtml(text)
    html = html.replace(/href="file:\/\/([^"]+)"/g, 'href="#" class="brain-md-link" data-url="file://$1"')
    return html
  }
}
