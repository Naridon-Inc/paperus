import { RAGEngine } from './rag-engine'
import Store from './store'
import showdown from 'showdown'
import { serviceLogo, sparkIcon } from './brain-service-logos'

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
// Threaded conversations: each is a saved chat; capped so storage stays bounded.
const BRAIN_THREADS_KEY = 'brain_threads'
const BRAIN_ACTIVE_THREAD_KEY = 'brain_active_thread'
const BRAIN_THREADS_CAP = 60

// Starter prompts shown on the empty Brain — one click asks the question.
const BRAIN_SUGGESTIONS = [
  'Give me an overview of everything in my workspace',
  'What decisions have we made about the roadmap?',
  'Find every open question or TODO across my notes',
  'Summarize what changed in my notes recently',
]

// ── Agents ("personas") ──────────────────────────────────────────────────────
// An agent scopes the Brain: a name + look, extra instructions, which tool GROUPS
// it may use ('docs'|'email'|'calendar'|'system'; null = all), and how much send
// autonomy it has ('ask'|'auto-reply'|'autonomous'). Built-in presets ship below;
// the user can also create custom ones (persisted to BRAIN_AGENTS_KEY). The active
// agent's context is pushed into the engine before every ask.
const BRAIN_AGENTS_KEY = 'brain_agents'         // custom agents only
const BRAIN_ACTIVE_AGENT_KEY = 'brain_active_agent'
const PRESET_AGENTS = [
  {
    id: 'general', name: 'Company Brain', glyph: 'spark', color: '#6b7280', builtin: true,
    toolGroups: null, writePolicy: 'ask',
    instructions: '',
  },
  {
    id: 'inbox', name: 'Inbox', glyph: 'mail', color: '#2f6df6', builtin: true,
    toolGroups: ['email', 'docs'], writePolicy: 'ask',
    instructions: 'You are an email assistant. Help triage, search, summarize, and reply to the user\'s mail. When asked to act ("if there\'s an email about X, reply…"), search first, read the message, then draft a clear, professional reply and send it. Always be concise and accurate.',
  },
  {
    id: 'calendar', name: 'Scheduler', glyph: 'calendar', color: '#2e9e5b', builtin: true,
    toolGroups: ['calendar', 'docs'], writePolicy: 'ask',
    instructions: 'You are a scheduling assistant. Check the user\'s agenda and availability with the calendar tools before proposing times, and create events with precise ISO timestamps. Confirm the time zone implicitly by echoing the local time you scheduled.',
  },
  {
    id: 'campaign', name: 'Campaign', glyph: 'megaphone', color: '#8b5cf6', builtin: true,
    toolGroups: ['email', 'docs'], writePolicy: 'ask',
    instructions: 'You run email outreach campaigns. Find the recipient list (ask where it is if unknown), write a genuinely PERSONALISED message for each person — reference something specific about them, never a mass-blast template — and send the batch with send_campaign. Keep messages warm, human, and short.',
  },
]
// Tool groups a custom agent can toggle, with friendly labels for the builder.
const AGENT_TOOL_GROUPS = [
  { id: 'docs', label: 'Documents', hint: 'Search and read your notes' },
  { id: 'email', label: 'Email', hint: 'Read, search, send mail + campaigns' },
  { id: 'calendar', label: 'Calendar', hint: 'Check agenda, create events' },
]
const AGENT_WRITE_POLICIES = [
  { id: 'ask', label: 'Preview & approve', hint: 'Show me every send before it goes' },
  { id: 'auto-reply', label: 'Auto replies', hint: 'Send single replies automatically; ask for campaigns' },
  { id: 'autonomous', label: 'Fully autonomous', hint: 'Send without asking — use with care' },
]
// Inline line-icon glyphs for agent avatars (24×24, stroke currentColor).
const AGENT_GLYPHS = {
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v3m8-3v3"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5L6 10H4a1 1 0 0 0-1 1Z"/><path d="M18 8a4 4 0 0 1 0 8"/></svg>',
  robot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M12 4v4M9 13h.01M15 13h.01M2 13v2m20-2v2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6m0 6v6m9-9h-6m-6 0H3m13.5-6.5L15 7m-6 6-1.5 1.5m9 0L15 13m-6-6L7.5 5.5"/></svg>',
}

export class CompanyBrainCenter {
  constructor(appContext) {
    this.appContext = appContext
    this.engine = new RAGEngine()
    this.chatHistory = []
    this._configured = false
    // Threaded conversations + composer attachments (see #threads / #attachments).
    this.threads = []          // [{ id, title, createdAt, updatedAt, messages:[], agentId? }]
    this.activeThreadId = null
    this.attachments = []      // [{ id, name, kind:'text'|'image'|'pdf', text?, dataUrl?, mime, size }]
    this._mcpServers = []      // cached `mcp:list` records (config + live status), for the builder + manager

    // Agents ("personas"): presets + the user's custom ones. The active agent's
    // instructions/tool-scope/send-policy are pushed into the engine before each
    // ask. Custom agents load async in init(); presets are always available.
    this.agents = PRESET_AGENTS.slice()
    this.activeAgentId = 'general'

    // The engine asks US to approve a write (send_email / create_calendar_event /
    // send_campaign). We show the approval modal and resolve true to proceed.
    this.engine.confirmAction = (req) => this._approveWrite(req)

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
        <div class="brain-title">${sparkIcon()}<span>Brain</span></div>
        <div class="brain-topbar-actions">
          <span class="brain-status-mini" id="brain-status-mini"></span>
          <button class="brain-icon-btn" id="brain-mcp-btn" title="Connectors (MCP)"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 7V2m6 5V2"/><path d="M7 7h10v3a5 5 0 0 1-10 0Z"/></svg></button>
          <button class="brain-icon-btn" id="brain-threads-btn" title="Conversations"><i class="fas fa-comments"></i></button>
          <button class="brain-icon-btn" id="brain-new-chat" title="New conversation"><i class="fas fa-plus"></i></button>
          <button class="brain-ai-chip chip-unset" id="brain-ai-chip" title="Choose / change AI">
            <span class="chip-dot"></span>
            <span class="chip-label" id="brain-ai-label">Set up AI</span>
            <i class="fas fa-chevron-circle-down" style="font-size:9px;opacity:.55;"></i>
          </button>
        </div>
      </div>

      <div class="brain-body">
        <div class="brain-threads-panel" id="brain-threads-panel" aria-hidden="true">
          <div class="brain-threads-head">
            <span>Conversations</span>
            <button class="brain-icon-btn" id="brain-threads-new" title="New conversation"><i class="fas fa-plus"></i></button>
          </div>
          <div class="brain-threads-list" id="brain-threads-list"></div>
        </div>
        <div class="brain-threads-scrim" id="brain-threads-scrim" hidden></div>
        <div class="brain-chat-panel" id="brain-chat-list">${this.welcomeHTML()}</div>
        <div class="brain-setup" id="brain-setup" style="display:none;"></div>
      </div>

      <div class="brain-input-wrapper" id="brain-input-wrapper">
        <div class="brain-composer-card">
          <div class="brain-attachments" id="brain-attachments" style="display:none;"></div>
          <textarea id="brain-query-input" placeholder="Ask anything about your notes…" rows="1"></textarea>
          <div class="brain-composer-bar">
            <button class="brain-composer-btn brain-composer-attach" id="brain-attach-btn" title="Attach text, images, or PDF"><i class="fas fa-plus"></i></button>
            <span class="brain-composer-spacer"></span>
            <button class="brain-composer-btn brain-model-pill" id="brain-model-pill" title="Choose model">
              <span class="brain-model-logo" id="brain-model-logo"><i class="fas fa-microchip" style="font-size:10px;opacity:.6;"></i></span>
              <span id="brain-model-label">Model</span>
              <i class="fas fa-chevron-down" style="font-size:9px;opacity:.5;"></i>
            </button>
            <button class="brain-composer-btn brain-composer-clear" id="clear-brain-chat" title="Clear this conversation"><i class="fas fa-trash-alt"></i></button>
            <button class="brain-send-btn" id="brain-send-btn" title="Ask"><i class="fas fa-arrow-up"></i></button>
            <input type="file" id="brain-attach-input" multiple style="display:none;"
              accept=".md,.markdown,.txt,.text,.csv,.json,.log,.js,.ts,.jsx,.tsx,.py,.rb,.go,.rs,.java,.kt,.c,.h,.hpp,.cpp,.cc,.cs,.php,.sh,.bash,.zsh,.sql,.yml,.yaml,.toml,.ini,.html,.css,.scss,.xml,.svg,image/*,application/pdf">
          </div>
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
    this.updateModelPill()
    if (this._configured) this.showChat()
    else this.showSetup()
    // Personas (presets + saved custom agents) before threads, so a restored
    // thread can resolve its bound agent.
    await this.loadAgents()
    // Bring back saved conversations (threaded; survives re-index + restarts).
    await this.loadThreads()
    this.populateWelcomeRecents()
    this._syncComposerPlacement()
    this._syncComposerPlaceholder()
    this._updateTopbarTitle()
    // Register any configured MCP servers' tools into the agentic loop, and keep
    // them fresh when the user adds/removes a server (mcp:changed from main).
    try { await this.engine.syncMcpTools() } catch (_e) { /* MCP optional */ }
    this._mcpServers = await this._loadMcpServers()
    if (!this._mcpChangedWired) {
      this._mcpChangedWired = true
      window.addEventListener('mcp:changed', () => {
        Promise.resolve(this.engine.syncMcpTools()).then(async () => {
          this._mcpServers = await this._loadMcpServers()
          this._applyActiveAgent()
          if (this._mcpRefresh) try { this._mcpRefresh() } catch (_e) { /* dialog closed */ }
        }).catch(() => {})
      })
    }
  }

  /** Fetch the configured MCP servers (config + live status) for the UI. */
  async _loadMcpServers() {
    try {
      const r = await window.api.invoke('mcp:list')
      return (r && r.ok && Array.isArray(r.servers)) ? r.servers : []
    } catch (_e) { return [] }
  }

  welcomeHTML() {
    const ICONS = ['fa-layer-group', 'fa-flag', 'fa-tasks', 'fa-history']
    const suggests = BRAIN_SUGGESTIONS
      .map((s, i) => `<button class="brain-suggestion" type="button"><i class="fas ${ICONS[i] || 'fa-comment-dots'}"></i><span>${this.escapeHtml(s)}</span></button>`)
      .join('')
    return `
      <div class="brain-welcome">
        <div class="brain-welcome-logo">${sparkIcon('brain-welcome-spark')}</div>
        <h1 class="brain-welcome-title">What can I help you find?</h1>
        <p class="brain-welcome-sub">I read across your whole workspace and cite the exact notes I used.</p>
        <div class="brain-hero-slot" id="brain-hero-slot"></div>
        <div class="brain-welcome-cols">
          <div class="brain-welcome-col">
            <div class="brain-welcome-col-head">Recent chats</div>
            <div class="brain-welcome-list" id="brain-welcome-recents"><div class="brain-welcome-empty">No chats yet</div></div>
          </div>
          <div class="brain-welcome-col">
            <div class="brain-welcome-col-head">Suggested</div>
            <div class="brain-welcome-list">${suggests}</div>
          </div>
        </div>
      </div>
    `
  }

  /** Fill the empty-state "Recent chats" column from saved threads. */
  populateWelcomeRecents() {
    const host = document.getElementById('brain-welcome-recents')
    if (!host) return
    const recent = (this.threads || []).slice(0, 5)
    if (!recent.length) {
      host.innerHTML = '<div class="brain-welcome-empty">No chats yet</div>'
      return
    }
    host.innerHTML = recent
      .map((t) => `<button class="brain-welcome-recent" type="button" data-tid="${t.id}"><i class="far fa-comment"></i><span>${this.escapeHtml(t.title || 'Untitled')}</span></button>`)
      .join('')
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
        this._syncSendState()
      })
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submitQuery() }
      })
    }
    if (sendBtn) sendBtn.onclick = () => this.submitQuery()
    if (clearBtn) clearBtn.onclick = () => this.clearChat()
    if (chip) chip.onclick = () => this.toggleSetup()

    // Model picker (composer).
    const modelPill = document.getElementById('brain-model-pill')
    if (modelPill) modelPill.onclick = (e) => { e.stopPropagation(); this.openModelMenu(modelPill) }

    // Attachments (composer).
    const attachBtn = document.getElementById('brain-attach-btn')
    const attachInput = document.getElementById('brain-attach-input')
    if (attachBtn && attachInput) {
      attachBtn.onclick = () => attachInput.click()
      attachInput.onchange = () => { this.handleAttachFiles(attachInput.files); attachInput.value = '' }
    }

    // Conversations (threads) panel.
    const threadsBtn = document.getElementById('brain-threads-btn')
    const newChatBtn = document.getElementById('brain-new-chat')
    const threadsNew = document.getElementById('brain-threads-new')
    const scrim = document.getElementById('brain-threads-scrim')
    const mcpBtn = document.getElementById('brain-mcp-btn')
    if (mcpBtn) mcpBtn.onclick = () => this.openMcpManager()
    if (threadsBtn) threadsBtn.onclick = () => this.toggleThreadsPanel()
    if (newChatBtn) newChatBtn.onclick = () => this.newThread()
    if (threadsNew) threadsNew.onclick = () => this.newThread()
    if (scrim) scrim.onclick = () => this.toggleThreadsPanel(false)

    const chatList = document.getElementById('brain-chat-list')
    if (chatList) {
      chatList.addEventListener('click', (e) => {
        const sug = e.target.closest('.brain-suggestion')
        if (sug) {
          const box = document.getElementById('brain-query-input')
          const label = sug.querySelector('span')
          if (box) box.value = (label ? label.textContent : sug.textContent).trim()
          this.submitQuery()
          return
        }
        const rec = e.target.closest('.brain-welcome-recent')
        if (rec && rec.dataset.tid) { this.switchThread(rec.dataset.tid); return }
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
    this._syncComposerPlacement()
    this._updateTopbarTitle()
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
    this.updateModelPill()
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

  // ── Conversations (threaded history) ─────────────────────────────────────────
  // Past chats are real conversations: each is { id, title, createdAt, updatedAt,
  // messages[] }. `this.chatHistory` always references the ACTIVE thread's
  // messages, so the existing chat code (submitQuery/clearChat) needs no change
  // beyond calling saveHistory(), which now folds the transcript into its thread.

  _genId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  }

  _makeThread(messages = []) {
    const now = Date.now()
    return { id: this._genId('thr'), title: 'New conversation', createdAt: now, updatedAt: now, messages }
  }

  activeThread() {
    return this.threads.find((t) => t.id === this.activeThreadId) || null
  }

  /** First non-empty user line, truncated — used as a thread's display title. */
  _deriveTitle(messages) {
    const firstUser = (messages || []).find((m) => m && m.role === 'user' && (m.content || '').trim())
    if (!firstUser) return 'New conversation'
    const t = firstUser.content.trim().replace(/\s+/g, ' ')
    return t.length > 48 ? `${t.slice(0, 47)}…` : t
  }

  /** Load threads on launch; migrate a legacy single transcript into one thread. */
  async loadThreads() {
    try {
      if (window.api && typeof window.api.invoke === 'function') {
        const saved = await window.api.invoke('settings:get', BRAIN_THREADS_KEY)
        if (Array.isArray(saved) && saved.length) {
          this.threads = saved
        } else {
          // Migrate the old rolling transcript, if any, into a first thread.
          const legacy = await window.api.invoke('settings:get', BRAIN_HISTORY_KEY)
          if (Array.isArray(legacy) && legacy.length) {
            const t = this._makeThread(legacy.slice(-BRAIN_HISTORY_CAP))
            t.title = this._deriveTitle(t.messages)
            this.threads = [t]
          }
        }
        const activeSaved = await window.api.invoke('settings:get', BRAIN_ACTIVE_THREAD_KEY)
        if (typeof activeSaved === 'string' && this.threads.some((t) => t.id === activeSaved)) {
          this.activeThreadId = activeSaved
        }
      }
    } catch (_) { /* best-effort */ }

    if (!this.threads.length) this.threads = [this._makeThread()]
    if (!this.activeThread()) this.activeThreadId = this.threads[0].id
    this.chatHistory = this.activeThread().messages
    this.renderActiveThread()
    this.renderThreadsList()
    try { window.dispatchEvent(new CustomEvent('brain:threads-changed')) } catch (_) { /* no-op */ }
  }

  /** Persist all threads (each capped) + the active id. */
  saveThreads() {
    try {
      if (window.api && typeof window.api.invoke === 'function') {
        const trimmed = this.threads
          .slice(-BRAIN_THREADS_CAP)
          .map((t) => ({ ...t, messages: Array.isArray(t.messages) ? t.messages.slice(-BRAIN_HISTORY_CAP) : [] }))
        window.api.invoke('settings:set', BRAIN_THREADS_KEY, trimmed)
        window.api.invoke('settings:set', BRAIN_ACTIVE_THREAD_KEY, this.activeThreadId)
      }
    } catch (_) { /* best-effort */ }
    // Let the contextual sidebar's "Recent" list refresh from the new thread set.
    try { window.dispatchEvent(new CustomEvent('brain:threads-changed')) } catch (_) { /* no-op */ }
  }

  // ── Agents ("personas") ─────────────────────────────────────────────────────

  /** Merge saved custom agents with the presets; restore the active selection. */
  async loadAgents() {
    let custom = []
    let active = null
    try {
      if (window.api && typeof window.api.invoke === 'function') {
        const saved = await window.api.invoke('settings:get', BRAIN_AGENTS_KEY)
        if (Array.isArray(saved)) custom = saved.filter((a) => a && a.id && a.name).map((a) => ({ ...a, builtin: false }))
        active = await window.api.invoke('settings:get', BRAIN_ACTIVE_AGENT_KEY)
      }
    } catch (_) { /* defaults */ }
    // Presets first, then custom; drop any custom id that collides with a preset.
    const presetIds = new Set(PRESET_AGENTS.map((a) => a.id))
    this.agents = PRESET_AGENTS.slice().concat(custom.filter((a) => !presetIds.has(a.id)))
    this.activeAgentId = (active && this.agents.some((a) => a.id === active)) ? active : 'general'
    this._applyActiveAgent()
  }

  /** Persist only the user's custom agents (presets are code-defined). */
  saveAgents() {
    try {
      if (window.api && typeof window.api.invoke === 'function') {
        const custom = this.agents.filter((a) => !a.builtin)
        window.api.invoke('settings:set', BRAIN_AGENTS_KEY, custom)
        window.api.invoke('settings:set', BRAIN_ACTIVE_AGENT_KEY, this.activeAgentId)
      }
    } catch (_) { /* best-effort */ }
    try { window.dispatchEvent(new CustomEvent('brain:agents-changed')) } catch (_) { /* no-op */ }
  }

  agentById(id) { return this.agents.find((a) => a.id === id) || null }
  activeAgent() { return this.agentById(this.activeAgentId) || this.agents[0] || null }

  /** Push the active agent's instructions/tool-scope/send-policy into the engine. */
  _applyActiveAgent() {
    const a = this.activeAgent()
    if (!a) return
    this.engine.agentInstructions = a.instructions || ''
    this.engine.enabledToolGroups = Array.isArray(a.toolGroups) ? new Set(a.toolGroups) : null
    this.engine.writePolicy = a.writePolicy || 'ask'
  }

  /** Select an agent; optionally start a fresh chat bound to it (avatar click). */
  setActiveAgent(id, { newChat = false } = {}) {
    if (!this.agentById(id)) return
    this.activeAgentId = id
    this._applyActiveAgent()
    const th = this.activeThread()
    if (newChat && th && Array.isArray(th.messages) && th.messages.length) {
      this.newThread() // a populated convo stays with its old persona; open a new one
    } else if (th) {
      th.agentId = id
    }
    if (this.activeThread()) this.activeThread().agentId = id
    this.saveAgents()
    this.saveThreads()
    this._updateTopbarTitle()
    this._syncComposerPlaceholder()
  }

  /** Inline avatar markup (glyph SVG or the spark) tinted with the agent color. */
  agentAvatarHTML(agent, { size = 30 } = {}) {
    if (!agent) return ''
    const glyph = agent.glyph === 'spark'
      ? sparkIcon()
      : (AGENT_GLYPHS[agent.glyph] || AGENT_GLYPHS.sparkle)
    const c = agent.color || '#6b7280'
    return `<span class="brain-agent-av" style="--agent-c:${this.escapeHtml(c)};width:${size}px;height:${size}px">${glyph}</span>`
  }

  /** Create/replace a custom agent from the builder's collected definition. */
  upsertCustomAgent(def) {
    const id = def.id || this._genId('agent')
    const clean = {
      id, name: (def.name || 'New agent').slice(0, 40), builtin: false,
      glyph: def.glyph || 'sparkle', color: def.color || '#6b7280',
      instructions: (def.instructions || '').slice(0, 4000),
      toolGroups: Array.isArray(def.toolGroups) ? def.toolGroups.slice() : ['docs'],
      writePolicy: AGENT_WRITE_POLICIES.some((p) => p.id === def.writePolicy) ? def.writePolicy : 'ask',
    }
    const i = this.agents.findIndex((a) => a.id === id)
    if (i >= 0) this.agents[i] = clean
    else this.agents.push(clean)
    this.saveAgents()
    return clean
  }

  deleteAgent(id) {
    const a = this.agentById(id)
    if (!a || a.builtin) return
    this.agents = this.agents.filter((x) => x.id !== id)
    if (this.activeAgentId === id) { this.activeAgentId = 'general'; this._applyActiveAgent() }
    this.saveAgents()
  }

  /**
   * Approval gate for a WRITE the engine wants to perform. Renders a modal that
   * previews the exact action (recipient + subject + body, or campaign list, or
   * event), and resolves true only when the user clicks Approve. Cancel/ESC/scrim
   * resolve false. This is the safety wall in front of real sends.
   * @returns {Promise<boolean>}
   */
  _approveWrite({ kind, summary, detail, bulk }) {
    return new Promise((resolve) => {
      const esc = (s) => this.escapeHtml(String(s == null ? '' : s))
      let bodyHTML = ''
      let confirmLabel = 'Approve'
      if (kind === 'send_email') {
        const to = Array.isArray(detail.to) ? detail.to.join(', ') : detail.to
        bodyHTML = `
          <div class="brain-approve-field"><span>To</span><div>${esc(to)}</div></div>
          ${detail.cc ? `<div class="brain-approve-field"><span>Cc</span><div>${esc(Array.isArray(detail.cc) ? detail.cc.join(', ') : detail.cc)}</div></div>` : ''}
          <div class="brain-approve-field"><span>Subject</span><div>${esc(detail.subject)}</div></div>
          <div class="brain-approve-body">${esc(detail.body).replace(/\n/g, '<br>')}</div>`
        confirmLabel = 'Send email'
      } else if (kind === 'send_campaign') {
        const msgs = detail.messages || []
        const rows = msgs.slice(0, 20).map((m) => `<li><span class="brain-approve-to">${esc(Array.isArray(m.to) ? m.to.join(', ') : m.to)}</span><span class="brain-approve-sub">${esc(m.subject)}</span></li>`).join('')
        const more = msgs.length > 20 ? `<li class="brain-approve-more">+ ${msgs.length - 20} more…</li>` : ''
        const sample = msgs[0] ? `<div class="brain-approve-sample"><div class="brain-approve-sample-h">Preview · first message</div><div class="brain-approve-body">${esc(msgs[0].body).replace(/\n/g, '<br>')}</div></div>` : ''
        bodyHTML = `<ul class="brain-approve-list">${rows}${more}</ul>${sample}`
        confirmLabel = `Send to ${msgs.length}`
      } else if (kind === 'create_calendar_event') {
        const fmt = (iso) => { try { return new Date(iso).toLocaleString() } catch (_) { return iso } }
        bodyHTML = `
          <div class="brain-approve-field"><span>Event</span><div>${esc(detail.title)}</div></div>
          <div class="brain-approve-field"><span>Starts</span><div>${esc(fmt(detail.startISO))}</div></div>
          ${detail.endISO ? `<div class="brain-approve-field"><span>Ends</span><div>${esc(fmt(detail.endISO))}</div></div>` : ''}
          ${detail.location ? `<div class="brain-approve-field"><span>Where</span><div>${esc(detail.location)}</div></div>` : ''}
          ${detail.description ? `<div class="brain-approve-body">${esc(detail.description).replace(/\n/g, '<br>')}</div>` : ''}`
        confirmLabel = 'Create event'
      } else {
        bodyHTML = `<div class="brain-approve-body">${esc(JSON.stringify(detail, null, 2))}</div>`
      }

      const overlay = document.createElement('div')
      overlay.className = 'brain-approve-overlay'
      overlay.innerHTML = `
        <div class="brain-approve" role="dialog" aria-modal="true" aria-label="Confirm action">
          <div class="brain-approve-head">
            <div class="brain-approve-title">${esc(summary)}</div>
            <div class="brain-approve-sub2">${bulk ? 'Review the batch before it sends' : 'Review before it happens'} — nothing has been sent yet.</div>
          </div>
          <div class="brain-approve-detail">${bodyHTML}</div>
          <div class="brain-approve-actions">
            <button type="button" class="brain-approve-cancel">Cancel</button>
            <button type="button" class="brain-approve-ok">${esc(confirmLabel)}</button>
          </div>
        </div>`
      document.body.appendChild(overlay)

      let settled = false
      const close = (val) => {
        if (settled) return
        settled = true
        document.removeEventListener('keydown', onKey, true)
        overlay.remove()
        resolve(val)
      }
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false) } }
      document.addEventListener('keydown', onKey, true)
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(false) })
      overlay.querySelector('.brain-approve-cancel').onclick = () => close(false)
      overlay.querySelector('.brain-approve-ok').onclick = () => close(true)
      requestAnimationFrame(() => { const ok = overlay.querySelector('.brain-approve-ok'); if (ok) ok.focus() })
    })
  }

  /**
   * Open the "New agent" / edit-agent builder: name, look, instructions, the tool
   * groups it may use, and its send autonomy. Saving upserts a custom agent.
   */
  openAgentBuilder(existingId = null) {
    const editing = existingId ? this.agentById(existingId) : null
    const esc = (s) => this.escapeHtml(String(s == null ? '' : s))
    const COLORS = ['#6b7280', '#2f6df6', '#2e9e5b', '#8b5cf6', '#e0703a', '#d6457a', '#0e9aa7', '#b8893a']
    const GLYPHS = ['sparkle', 'mail', 'calendar', 'megaphone', 'robot', 'user']
    const draft = {
      glyph: editing ? editing.glyph : 'sparkle',
      color: editing ? editing.color : COLORS[0],
      toolGroups: editing && Array.isArray(editing.toolGroups) ? editing.toolGroups.slice() : ['docs'],
      writePolicy: editing ? (editing.writePolicy || 'ask') : 'ask',
    }
    const glyphBtns = GLYPHS.map((g) => `<button type="button" class="brain-builder-glyph${g === draft.glyph ? ' sel' : ''}" data-glyph="${g}">${g === 'spark' ? sparkIcon() : (AGENT_GLYPHS[g] || AGENT_GLYPHS.sparkle)}</button>`).join('')
    const colorBtns = COLORS.map((c) => `<button type="button" class="brain-builder-color${c === draft.color ? ' sel' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')
    const builtinToolRows = AGENT_TOOL_GROUPS.map((g) => `
      <label class="brain-builder-tool">
        <input type="checkbox" data-tool="${g.id}" ${draft.toolGroups.includes(g.id) ? 'checked' : ''}/>
        <span class="brain-builder-tool-l"><b>${esc(g.label)}</b><i>${esc(g.hint)}</i></span>
      </label>`).join('')
    const mcpToolRows = (this._mcpServers || []).map((s) => `
      <label class="brain-builder-tool">
        <input type="checkbox" data-tool="mcp:${esc(s.id)}" ${draft.toolGroups.includes(`mcp:${s.id}`) ? 'checked' : ''}/>
        <span class="brain-builder-tool-l"><b>${esc(s.name || s.id)}</b><i>Connector · ${s.status === 'connected' ? `${s.toolCount || 0} tools` : 'MCP server'}</i></span>
      </label>`).join('')
    const toolRows = `${builtinToolRows}${mcpToolRows}
      <button type="button" class="brain-builder-mcplink" id="brain-builder-mcp">+ Connect an MCP server…</button>`
    const policyRows = AGENT_WRITE_POLICIES.map((p) => `
      <label class="brain-builder-policy">
        <input type="radio" name="brain-builder-policy" data-policy="${p.id}" ${p.id === draft.writePolicy ? 'checked' : ''}/>
        <span class="brain-builder-tool-l"><b>${esc(p.label)}</b><i>${esc(p.hint)}</i></span>
      </label>`).join('')

    const overlay = document.createElement('div')
    overlay.className = 'brain-approve-overlay'
    overlay.innerHTML = `
      <div class="brain-builder" role="dialog" aria-modal="true" aria-label="${editing ? 'Edit agent' : 'New agent'}">
        <div class="brain-builder-head">
          <div class="brain-approve-title">${editing ? 'Edit agent' : 'New agent'}</div>
          <div class="brain-approve-sub2">A focused assistant with its own instructions, tools, and send rules.</div>
        </div>
        <div class="brain-builder-body">
          <label class="brain-builder-row"><span class="brain-builder-lbl">Name</span>
            <input type="text" class="brain-builder-name" maxlength="40" placeholder="e.g. Sales outreach" value="${editing ? esc(editing.name) : ''}"/>
          </label>
          <div class="brain-builder-row"><span class="brain-builder-lbl">Avatar</span>
            <div class="brain-builder-avatar">
              <div class="brain-builder-glyphs">${glyphBtns}</div>
              <div class="brain-builder-colors">${colorBtns}</div>
            </div>
          </div>
          <label class="brain-builder-row brain-builder-row--col"><span class="brain-builder-lbl">Instructions</span>
            <textarea class="brain-builder-instr" rows="4" placeholder="What should this agent do, and how should it sound?">${editing ? esc(editing.instructions) : ''}</textarea>
          </label>
          <div class="brain-builder-row brain-builder-row--col"><span class="brain-builder-lbl">Tools it can use</span>
            <div class="brain-builder-tools">${toolRows}</div>
          </div>
          <div class="brain-builder-row brain-builder-row--col"><span class="brain-builder-lbl">Sending</span>
            <div class="brain-builder-tools">${policyRows}</div>
          </div>
        </div>
        <div class="brain-approve-actions">
          ${editing && !editing.builtin ? '<button type="button" class="brain-builder-del">Delete</button>' : ''}
          <span style="flex:1"></span>
          <button type="button" class="brain-approve-cancel">Cancel</button>
          <button type="button" class="brain-approve-ok">${editing ? 'Save' : 'Create agent'}</button>
        </div>
      </div>`
    document.body.appendChild(overlay)

    const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove() }
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close() } }
    document.addEventListener('keydown', onKey, true)
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close() })
    overlay.querySelectorAll('.brain-builder-glyph').forEach((b) => { b.onclick = () => { draft.glyph = b.dataset.glyph; overlay.querySelectorAll('.brain-builder-glyph').forEach((x) => x.classList.toggle('sel', x === b)) } })
    overlay.querySelectorAll('.brain-builder-color').forEach((b) => { b.onclick = () => { draft.color = b.dataset.color; overlay.querySelectorAll('.brain-builder-color').forEach((x) => x.classList.toggle('sel', x === b)) } })
    overlay.querySelector('.brain-approve-cancel').onclick = () => close()
    const mcpLink = overlay.querySelector('#brain-builder-mcp')
    if (mcpLink) mcpLink.onclick = () => this.openMcpManager()
    const delBtn = overlay.querySelector('.brain-builder-del')
    if (delBtn) delBtn.onclick = () => { this.deleteAgent(existingId); close() }
    overlay.querySelector('.brain-approve-ok').onclick = () => {
      const name = overlay.querySelector('.brain-builder-name').value.trim()
      if (!name) { overlay.querySelector('.brain-builder-name').focus(); return }
      const toolGroups = Array.from(overlay.querySelectorAll('.brain-builder-tool input:checked')).map((i) => i.dataset.tool)
      const policyEl = overlay.querySelector('.brain-builder-policy input:checked')
      const saved = this.upsertCustomAgent({
        id: existingId || null, name, glyph: draft.glyph, color: draft.color,
        instructions: overlay.querySelector('.brain-builder-instr').value,
        toolGroups: toolGroups.length ? toolGroups : ['docs'],
        writePolicy: policyEl ? policyEl.dataset.policy : 'ask',
      })
      close()
      this.setActiveAgent(saved.id, { newChat: true })
    }
    requestAnimationFrame(() => { const n = overlay.querySelector('.brain-builder-name'); if (n) n.focus() })
  }

  // ── MCP connectors ──────────────────────────────────────────────────────────

  /** Parse "a\nb" or "a b c" into an args array. */
  _mcpParseArgs(str) {
    const raw = String(str || '').trim()
    if (!raw) return []
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length > 1) return lines
    return raw.split(/\s+/).filter(Boolean)
  }

  /** Parse "KEY=VALUE" lines into an object. */
  _mcpParseEnv(str) {
    const out = {}
    String(str || '').split('\n').forEach((l) => {
      const line = l.trim()
      if (!line || line.startsWith('#')) return
      const i = line.indexOf('=')
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    })
    return out
  }

  /** Parse "Key: value" lines into a headers object. */
  _mcpParseHeaders(str) {
    const out = {}
    String(str || '').split('\n').forEach((l) => {
      const line = l.trim()
      if (!line || line.startsWith('#')) return
      const i = line.indexOf(':')
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    })
    return out
  }

  /**
   * The connector manager: a single dialog to add any MCP server (local stdio
   * command or remote HTTP/SSE), watch its connection + tool count live, toggle
   * enable / "ask before each call", reconnect, or remove. Repaints in place when
   * a mcp:changed event arrives (via this._mcpRefresh).
   */
  openMcpManager() {
    const esc = (s) => this.escapeHtml(String(s == null ? '' : s))
    const overlay = document.createElement('div')
    overlay.className = 'brain-approve-overlay'
    overlay.innerHTML = `
      <div class="brain-mcp" role="dialog" aria-modal="true" aria-label="Connectors">
        <div class="brain-builder-head">
          <div class="brain-approve-title">Connectors</div>
          <div class="brain-approve-sub2">Add any MCP server — a local command or a remote URL — and the Brain can use its tools in chat.</div>
        </div>
        <div class="brain-mcp-body">
          <div class="brain-mcp-list" id="brain-mcp-list"></div>

          <div class="brain-mcp-add">
            <div class="brain-mcp-seg" role="tablist">
              <button type="button" class="brain-mcp-segbtn sel" data-mode="stdio">Local command</button>
              <button type="button" class="brain-mcp-segbtn" data-mode="http">Remote URL</button>
              <button type="button" class="brain-mcp-segbtn" data-mode="json">Paste JSON</button>
            </div>

            <div class="brain-mcp-form" data-form="stdio">
              <input type="text" class="brain-mcp-in" data-f="name" placeholder="Name (e.g. Filesystem)"/>
              <input type="text" class="brain-mcp-in" data-f="command" placeholder="Command (e.g. npx)"/>
              <textarea class="brain-mcp-in" data-f="args" rows="2" placeholder="Arguments — one per line or space-separated&#10;-y @modelcontextprotocol/server-filesystem /Users/me/Documents"></textarea>
              <textarea class="brain-mcp-in" data-f="env" rows="2" placeholder="Environment (optional) — KEY=VALUE per line"></textarea>
            </div>

            <div class="brain-mcp-form" data-form="http" hidden>
              <input type="text" class="brain-mcp-in" data-f="hname" placeholder="Name (e.g. Linear)"/>
              <input type="text" class="brain-mcp-in" data-f="url" placeholder="Server URL (https://… — Streamable HTTP or SSE)"/>
              <textarea class="brain-mcp-in" data-f="headers" rows="2" placeholder="Headers (optional) — Authorization: Bearer …"></textarea>
            </div>

            <div class="brain-mcp-form" data-form="json" hidden>
              <textarea class="brain-mcp-in" data-f="json" rows="5" placeholder='Paste a config block, e.g.&#10;{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y","@modelcontextprotocol/server-filesystem","/path"] } } }'></textarea>
            </div>

            <div class="brain-mcp-msg" id="brain-mcp-msg"></div>
            <div class="brain-mcp-addrow">
              <button type="button" class="brain-mcp-test" id="brain-mcp-test">Test</button>
              <span style="flex:1"></span>
              <button type="button" class="brain-mcp-addbtn" id="brain-mcp-add">Add connector</button>
            </div>
          </div>
        </div>
        <div class="brain-approve-actions">
          <span style="flex:1"></span>
          <button type="button" class="brain-approve-cancel" id="brain-mcp-close">Done</button>
        </div>
      </div>`
    document.body.appendChild(overlay)

    let mode = 'stdio'
    const $ = (sel) => overlay.querySelector(sel)
    const msg = $('#brain-mcp-msg')
    const setMsg = (text, kind) => { msg.textContent = text || ''; msg.className = `brain-mcp-msg${kind ? ` is-${kind}` : ''}` }

    const statusDot = (s) => {
      const cls = s === 'connected' ? 'ok' : (s === 'error' ? 'bad' : 'idle')
      return `<span class="brain-mcp-dot ${cls}"></span>`
    }

    const renderList = () => {
      const list = $('#brain-mcp-list')
      const servers = this._mcpServers || []
      if (!servers.length) {
        list.innerHTML = '<div class="brain-mcp-empty">No connectors yet. Add one below — try the filesystem or fetch server to start.</div>'
        return
      }
      list.innerHTML = servers.map((s) => {
        const sub = s.transport === 'http' ? esc(s.url || '') : esc([s.command, ...(s.args || [])].join(' '))
        const tools = s.status === 'connected' ? `<span class="brain-mcp-count">${s.toolCount || 0} tool${(s.toolCount || 0) === 1 ? '' : 's'}</span>` : ''
        const err = s.error ? `<div class="brain-mcp-err">${esc(s.error)}</div>` : ''
        return `
          <div class="brain-mcp-row" data-id="${esc(s.id)}">
            <div class="brain-mcp-row-main">
              <div class="brain-mcp-row-top">${statusDot(s.status)}<b>${esc(s.name || s.id)}</b>${tools}</div>
              <div class="brain-mcp-row-sub">${sub}</div>
              ${err}
            </div>
            <div class="brain-mcp-row-ctl">
              <label class="brain-mcp-chk" title="Ask before each tool call"><input type="checkbox" data-act="ask" ${s.askFirst ? 'checked' : ''}/><span>Ask first</span></label>
              <label class="brain-mcp-chk" title="Enable this connector"><input type="checkbox" data-act="enable" ${s.enabled !== false ? 'checked' : ''}/><span>On</span></label>
              <button type="button" class="brain-mcp-mini" data-act="reconnect" title="Reconnect">↻</button>
              <button type="button" class="brain-mcp-mini danger" data-act="remove" title="Remove">✕</button>
            </div>
          </div>`
      }).join('')
    }

    // Live repaint when main pushes mcp:changed (server connected, tools loaded…).
    this._mcpRefresh = () => renderList()
    renderList()

    // Segmented control: switch the visible add-form.
    overlay.querySelectorAll('.brain-mcp-segbtn').forEach((b) => {
      b.onclick = () => {
        mode = b.dataset.mode
        overlay.querySelectorAll('.brain-mcp-segbtn').forEach((x) => x.classList.toggle('sel', x === b))
        overlay.querySelectorAll('.brain-mcp-form').forEach((f) => { f.hidden = f.dataset.form !== mode })
        setMsg('')
      }
    })

    // Build a config object from whichever form is active. Returns null + sets a
    // message when required fields are missing.
    const buildConfig = () => {
      if (mode === 'json') {
        const json = $('[data-f="json"]').value.trim()
        if (!json) { setMsg('Paste a JSON config first.', 'bad'); return null }
        return { __json: json }
      }
      if (mode === 'http') {
        const name = $('[data-f="hname"]').value.trim()
        const url = $('[data-f="url"]').value.trim()
        if (!url) { setMsg('A server URL is required.', 'bad'); return null }
        return { name: name || url, transport: 'http', url, headers: this._mcpParseHeaders($('[data-f="headers"]').value) }
      }
      const name = $('[data-f="name"]').value.trim()
      const command = $('[data-f="command"]').value.trim()
      if (!command) { setMsg('A command is required (e.g. npx, uvx, node).', 'bad'); return null }
      return { name: name || command, transport: 'stdio', command, args: this._mcpParseArgs($('[data-f="args"]').value), env: this._mcpParseEnv($('[data-f="env"]').value) }
    }

    // Test: connect transiently and report the tool count without saving.
    $('#brain-mcp-test').onclick = async () => {
      const cfg = buildConfig()
      if (!cfg) return
      if (cfg.__json) { setMsg('Switch to a single Local/Remote form to test, or just Add the JSON.', 'bad'); return }
      setMsg('Testing…')
      try {
        const r = await window.api.invoke('mcp:test', { config: cfg })
        if (r && r.ok) setMsg(`Connected — ${r.toolCount} tool${r.toolCount === 1 ? '' : 's'} available.`, 'ok')
        else setMsg((r && r.error) || 'Could not connect.', 'bad')
      } catch (e) { setMsg(e.message || 'Test failed.', 'bad') }
    }

    // Add: persist + connect (stdio/http) or import a JSON map of servers.
    $('#brain-mcp-add').onclick = async () => {
      const cfg = buildConfig()
      if (!cfg) return
      setMsg('Adding…')
      try {
        let r
        if (cfg.__json) r = await window.api.invoke('mcp:import', { json: cfg.__json })
        else r = await window.api.invoke('mcp:add', { config: cfg })
        if (r && r.ok) {
          setMsg('Added. Connecting…', 'ok')
          this._mcpServers = await this._loadMcpServers()
          renderList()
          overlay.querySelectorAll('.brain-mcp-in').forEach((i) => { i.value = '' })
        } else { setMsg((r && r.error) || 'Could not add the connector.', 'bad') }
      } catch (e) { setMsg(e.message || 'Add failed.', 'bad') }
    }

    // Per-row controls (toggle enable / ask-first, reconnect, remove).
    $('#brain-mcp-list').addEventListener('click', async (e) => {
      const row = e.target.closest('.brain-mcp-row')
      if (!row) return
      const id = row.dataset.id
      const btn = e.target.closest('[data-act]')
      if (!btn) return
      const act = btn.dataset.act
      try {
        if (act === 'remove') {
          await window.api.invoke('mcp:remove', { id })
        } else if (act === 'reconnect') {
          setMsg('Reconnecting…')
          await window.api.invoke('mcp:reconnect', { id })
        } else if (act === 'enable') {
          await window.api.invoke('mcp:update', { id, patch: { enabled: btn.checked } })
        } else if (act === 'ask') {
          await window.api.invoke('mcp:update', { id, patch: { askFirst: btn.checked } })
        }
        this._mcpServers = await this._loadMcpServers()
        renderList()
      } catch (err) { setMsg(err.message || 'Action failed.', 'bad') }
    })

    const close = () => { document.removeEventListener('keydown', onKey, true); this._mcpRefresh = null; overlay.remove() }
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); close() } }
    document.addEventListener('keydown', onKey, true)
    overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) close() })
    $('#brain-mcp-close').onclick = () => close()
  }

  /** Update the composer placeholder to hint the active agent's focus. */
  _syncComposerPlaceholder() {
    const input = document.getElementById('brain-query-input')
    if (!input) return
    const a = this.activeAgent()
    const map = { inbox: 'Ask about or act on your email…', calendar: 'Ask about your schedule or create an event…', campaign: 'Describe the campaign to run…' }
    input.setAttribute('placeholder', (a && map[a.id]) || 'Ask anything about your workspace…')
  }

  /** Fold the live transcript into its thread, refresh its title/time, persist. */
  saveHistory() {
    const thread = this.activeThread()
    if (thread) {
      thread.messages = this.chatHistory
      thread.updatedAt = Date.now()
      if (!thread.title || thread.title === 'New conversation') thread.title = this._deriveTitle(thread.messages)
    }
    this.saveThreads()
    this.renderThreadsList()
  }

  /** Render the active thread's messages into the chat panel (or the welcome). */
  renderActiveThread() {
    const chatList = document.getElementById('brain-chat-list')
    if (!chatList) return
    // The composer may currently live inside the hero (a child of the chat list);
    // move it to safety BEFORE we wipe the list, else innerHTML='' destroys it.
    this._parkComposer()
    chatList.innerHTML = ''
    if (!this.chatHistory.length) {
      chatList.innerHTML = this.welcomeHTML()
      this.populateWelcomeRecents()
      this._syncComposerPlacement()
      this._updateTopbarTitle()
      return
    }
    for (const m of this.chatHistory) {
      if (!m || !m.role) continue
      if (m.role === 'user') this.appendMessage('user', m.content || '')
      else this.appendAssistantBubble(m.content || '', m.citations)
    }
    chatList.scrollTop = chatList.scrollHeight
    this._syncComposerPlacement()
    this._updateTopbarTitle()
  }

  /** Start a fresh conversation and switch to it. */
  newThread() {
    // Don't pile up empty threads — reuse the active one if it's already empty.
    const cur = this.activeThread()
    if (cur && (!cur.messages || !cur.messages.length)) {
      this.toggleThreadsPanel(false)
      const box = document.getElementById('brain-query-input'); if (box) box.focus()
      return
    }
    const t = this._makeThread()
    this.threads.push(t)
    this.activeThreadId = t.id
    this.chatHistory = t.messages
    this.clearAttachments()
    this.renderActiveThread()
    this.saveThreads()
    this.renderThreadsList()
    this.toggleThreadsPanel(false)
    const box = document.getElementById('brain-query-input'); if (box) box.focus()
  }

  switchThread(id) {
    const t = this.threads.find((x) => x.id === id)
    if (!t) return
    this.activeThreadId = id
    this.chatHistory = t.messages
    this.clearAttachments()
    this.renderActiveThread()
    this.saveThreads()
    this.renderThreadsList()
    this.toggleThreadsPanel(false)
  }

  renameThread(id) {
    const t = this.threads.find((x) => x.id === id)
    if (!t) return
    const next = prompt('Rename conversation', t.title || 'Conversation')
    if (next == null) return
    t.title = next.trim() || t.title
    this.saveThreads()
    this.renderThreadsList()
  }

  deleteThread(id) {
    const idx = this.threads.findIndex((x) => x.id === id)
    if (idx === -1) return
    if (!confirm('Delete this conversation?')) return
    this.threads.splice(idx, 1)
    if (!this.threads.length) this.threads = [this._makeThread()]
    if (this.activeThreadId === id) {
      this.activeThreadId = this.threads[0].id
      this.chatHistory = this.activeThread().messages
      this.renderActiveThread()
    }
    this.saveThreads()
    this.renderThreadsList()
  }

  toggleThreadsPanel(force) {
    const panel = document.getElementById('brain-threads-panel')
    const scrim = document.getElementById('brain-threads-scrim')
    if (!panel) return
    const open = typeof force === 'boolean' ? force : !panel.classList.contains('open')
    panel.classList.toggle('open', open)
    panel.setAttribute('aria-hidden', open ? 'false' : 'true')
    if (scrim) scrim.hidden = !open
    if (open) this.renderThreadsList()
  }

  /** Group threads into Today / Yesterday / Previous 7 days / Older buckets. */
  _bucketFor(ts) {
    const d = new Date(ts)
    const now = new Date()
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const day = 24 * 60 * 60 * 1000
    const diff = startOfDay(now) - startOfDay(d)
    if (diff <= 0) return 'Today'
    if (diff === day) return 'Yesterday'
    if (diff <= 7 * day) return 'Previous 7 days'
    if (diff <= 30 * day) return 'Previous 30 days'
    return 'Older'
  }

  renderThreadsList() {
    const list = document.getElementById('brain-threads-list')
    if (!list) return
    const ordered = this.threads.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    const order = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older']
    const groups = new Map()
    for (const t of ordered) {
      const b = this._bucketFor(t.updatedAt || t.createdAt || Date.now())
      if (!groups.has(b)) groups.set(b, [])
      groups.get(b).push(t)
    }
    list.innerHTML = ''
    for (const bucket of order) {
      const items = groups.get(bucket)
      if (!items || !items.length) continue
      const head = document.createElement('div')
      head.className = 'brain-thread-group'
      head.textContent = bucket
      list.appendChild(head)
      for (const t of items) {
        const row = document.createElement('div')
        row.className = `brain-thread-item${t.id === this.activeThreadId ? ' active' : ''}`
        row.innerHTML = `
          <span class="brain-thread-title">${this.escapeHtml(t.title || 'Conversation')}</span>
          <span class="brain-thread-actions">
            <button class="brain-thread-act" data-act="rename" title="Rename"><i class="fas fa-pen"></i></button>
            <button class="brain-thread-act" data-act="delete" title="Delete"><i class="fas fa-trash-alt"></i></button>
          </span>`
        row.querySelector('.brain-thread-title').onclick = () => this.switchThread(t.id)
        row.querySelector('[data-act="rename"]').onclick = (e) => { e.stopPropagation(); this.renameThread(t.id) }
        row.querySelector('[data-act="delete"]').onclick = (e) => { e.stopPropagation(); this.deleteThread(t.id) }
        list.appendChild(row)
      }
    }
  }

  async handleFileChanged(filePath) {
    await this.engine.handleFileChanged(filePath)
  }

  clearChatUI() {
    const list = document.getElementById('brain-chat-list')
    this._parkComposer()
    if (list) list.innerHTML = this.welcomeHTML()
    this.populateWelcomeRecents()
    this._syncComposerPlacement()
    this._updateTopbarTitle()
  }

  /** Clear the ACTIVE conversation's messages (keeps the thread). */
  clearChat() {
    this.chatHistory.length = 0
    this.clearChatUI()
    this.saveHistory()
  }

  // ── Chat ─────────────────────────────────────────────────────────────────────

  async submitQuery() {
    const input = document.getElementById('brain-query-input')
    const query = input.value.trim()
    const hasAttachments = Array.isArray(this.attachments) && this.attachments.length > 0
    if (!query && !hasAttachments) return
    input.value = ''
    input.style.height = 'auto'

    // Snapshot + fold in the composer's attachments, then clear the tray so the
    // next turn starts empty. Text/PDF files become extra context spliced into
    // the prompt; images become vision parts (API backend only).
    const sentAttachments = hasAttachments ? this.attachments.slice() : []
    const textContext = hasAttachments ? this._attachmentTextContext() : ''
    const images = hasAttachments ? this._attachmentImageParts() : []
    if (images.length && this.engine.aiMode !== 'api') {
      this._composerNote('Images need an API (vision) backend — sent the question without them.')
    }
    const augmentedQuery = textContext ? `${query}${textContext}` : query
    this.clearAttachments()

    // Scope the engine to the active agent (instructions, tool access, send policy)
    // and stamp the conversation with the persona that answered it.
    this._applyActiveAgent()
    const activeTh = this.activeThread()
    if (activeTh) activeTh.agentId = this.activeAgentId

    const chatList = document.getElementById('brain-chat-list')
    // The composer lives INSIDE the empty-state hero while a chat is new; dock it
    // back at the bottom BEFORE we tear the hero down (else we'd remove it too).
    const layout = document.querySelector('.brain-page-layout')
    const wrap = document.getElementById('brain-input-wrapper')
    if (wrap && layout && wrap.parentElement !== layout) { layout.appendChild(wrap); wrap.classList.remove('is-hero') }
    const welcome = chatList.querySelector('.brain-welcome')
    if (welcome) welcome.remove()

    const userBubble = this.createMessageBubble('user')
    userBubble.querySelector('.message-body').innerHTML = this.formatMarkdown(query || '(see attachments)')
    if (sentAttachments.length) this.renderUserAttachments(userBubble, sentAttachments)
    chatList.appendChild(userBubble)
    chatList.scrollTop = chatList.scrollHeight

    const assistantBubble = this.createMessageBubble('assistant')
    chatList.appendChild(assistantBubble)
    chatList.scrollTop = chatList.scrollHeight

    const responseContainer = assistantBubble.querySelector('.message-body')
    // Notion-style "Crafting…" line (spinner + live tool status) until tokens flow.
    const thinkingIndicator = document.createElement('div')
    thinkingIndicator.className = 'brain-crafting'
    thinkingIndicator.innerHTML = '<span class="brain-crafting-dot"></span><span class="thinking-label">Crafting…</span>'
    responseContainer.appendChild(thinkingIndicator)

    const cursor = document.createElement('span')
    cursor.className = 'streaming-cursor'
    cursor.style.display = 'none'
    responseContainer.appendChild(cursor)

    let accumulatedText = ''
    let isThinking = true
    let done = false

    // One finalize path shared by natural completion, a Stop click, and errors.
    const finalize = (text, citations) => {
      if (done) return
      done = true
      if (isThinking) { isThinking = false; thinkingIndicator.remove() }
      cursor.remove()
      const finalText = (text != null && text !== '') ? text : accumulatedText
      if (finalText) responseContainer.innerHTML = this.formatMarkdown(finalText)
      else if (!responseContainer.innerHTML.trim()) responseContainer.innerHTML = 'No answer came back. Try the AI chip (top-right) to check your setup.'

      this.attachCitations(assistantBubble, citations)
      this.chatHistory.push({ role: 'user', content: query || (sentAttachments.length ? `(${sentAttachments.length} attachment${sentAttachments.length > 1 ? 's' : ''})` : '') })
      this.chatHistory.push({ role: 'assistant', content: finalText, citations })
      this.saveHistory()
      // Real token/cost readout + refreshed model label (exact id learned now).
      this.renderUsageFooter(assistantBubble)
      this._renderAnswerActions(assistantBubble, finalText)
      this.updateModelPill()
      this._updateTopbarTitle()
      this._endStreaming()
      chatList.scrollTop = chatList.scrollHeight
    }

    // Stop click finalizes immediately with whatever streamed so far. (The agent
    // request itself can't be aborted yet — we just stop rendering its tokens.)
    this._stopRequested = false
    this._onStopStreaming = () => { this._stopRequested = true; finalize(accumulatedText, null) }
    this._beginStreaming()

    try {
      // Pass the running transcript so the Brain can resolve follow-ups
      // ("what do these have in it?") and keep context across turns.
      const priorHistory = Array.isArray(this.chatHistory) ? this.chatHistory.slice() : []
      // Reset usage so a footer only shows for a turn that actually reported it.
      this.engine.lastUsage = null
      await this.engine.askBrain(
        augmentedQuery,
        (token) => {
          if (done) return
          if (isThinking) { isThinking = false; thinkingIndicator.remove(); cursor.style.display = 'inline-block' }
          accumulatedText += token
          responseContainer.innerHTML = this.formatMarkdown(accumulatedText)
          responseContainer.appendChild(cursor)
          chatList.scrollTop = chatList.scrollHeight
        },
        (fullAnswer, citations) => { finalize(fullAnswer, citations) },
        priorHistory,
        (tool) => {
          // The agent is calling a tool — reflect it in the live status line.
          if (!isThinking) return
          const label = thinkingIndicator.querySelector('.thinking-label')
          if (label) label.textContent = this.toolStatusLabel(tool)
        },
        images,
      )
    } catch (e) {
      if (!done) {
        done = true
        cursor.remove()
        if (isThinking) { isThinking = false; thinkingIndicator.remove() }
        responseContainer.innerHTML = `Something went wrong: ${this.escapeHtml(e.message || String(e))}`
        this._endStreaming()
      }
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
      list_email_accounts: 'Checking your mail accounts…',
      search_email: 'Searching your email…',
      list_recent_email: 'Reading your inbox…',
      read_email: 'Opening a message…',
      send_email: 'Preparing an email…',
      send_campaign: 'Preparing your campaign…',
      list_calendars: 'Checking your calendars…',
      list_calendar_events: 'Looking at your schedule…',
      create_calendar_event: 'Preparing a calendar event…',
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
    this._renderAnswerActions(bubble, content || '')
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
      <div class="message-avatar">${role === 'user' ? '<i class="fas fa-user"></i>' : sparkIcon('brain-spark-avatar')}</div>
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

  // ── Model picker (composer) ──────────────────────────────────────────────────

  /** Current model id for the active backend (empty = backend default). */
  _currentModelId() {
    const m = this.engine.aiMode
    if (m === 'local') return this.engine.localModel || this.engine.llmModel || ''
    if (m === 'api') return this.engine.apiModel || ''
    if (m === 'claude-code') return this.engine.claudeModel || ''
    if (m === 'cli') return this.engine.cliModel || ''
    return ''
  }

  _modelShortLabel(id) {
    if (!id) return 'Default'
    let s = String(id)
    if (s.includes('/')) s = s.split('/').pop()
    return s.length > 22 ? `${s.slice(0, 21)}…` : s
  }

  updateModelPill() {
    const pill = document.getElementById('brain-model-pill')
    const label = document.getElementById('brain-model-label')
    if (!pill || !label) return
    if (!this._configured) { pill.style.display = 'none'; return }
    pill.style.display = ''
    const id = this._currentModelId()
    // For Claude Code, prefer the EXACT id the agent reported (alias → claude-opus-4-8).
    let display = id
    if (this.engine.aiMode === 'claude-code') {
      const exact = this.engine.claudeResolved && this.engine.claudeResolved[id || 'default']
      if (exact) display = exact
    }
    const base = this._modelShortLabel(display)
    // Append the effort only when it's a level the active backend actually sends.
    let eff = ''
    if (this.engine.aiMode === 'claude-code') eff = this.engine._claudeEffort()
    else if (this.engine.aiMode === 'api') eff = (this.engine._apiExtra().reasoning_effort) || ''
    label.textContent = eff ? `${base} · ${eff}` : base
    // Show the real brand mark for the chosen model on the pill.
    const logo = document.getElementById('brain-model-logo')
    if (logo) logo.innerHTML = serviceLogo(this._modelLogoKind(display))
    // Token/cost readout from the most recent answer, on the pill tooltip.
    const u = this.engine.lastUsage
    if (u && u.model) {
      const k = (n) => (n == null ? '?' : (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)))
      const cost = (typeof u.costUSD === 'number') ? ` · $${u.costUSD.toFixed(u.costUSD < 0.1 ? 4 : 2)}` : ''
      const ctx = u.contextWindow ? ` · ${k(u.contextWindow)} ctx` : ''
      pill.title = `${u.model} — ${k(u.input)} in / ${k(u.output)} out${cost}${ctx}`
    } else {
      pill.title = 'Choose model'
    }
  }

  /** Does this model expose a reasoning-effort control on the active backend? */
  _modelHasEffort(id) {
    // Claude Code effort is session-level — applies to any model it resolves.
    if (this.engine.aiMode === 'claude-code') return true
    if (this.engine.aiMode !== 'api') return false
    const s = String(id || '').toLowerCase()
    return /(^|[^a-z])o\d/.test(s) || /gpt-5/.test(s) || /(opus|sonnet)/.test(s) || /gemini-2\.5/.test(s)
  }

  /** Logo kind for a specific model id, falling back to the active backend's. */
  _modelLogoKind(id) {
    const s = String(id || '').toLowerCase()
    if (/(claude|opus|sonnet|haiku)/.test(s)) return 'claude'
    if (/((^|[^a-z])o\d|gpt|chatgpt|davinci)/.test(s)) return 'openai'
    if (/(gemini|gemma|bison|palm)/.test(s)) return 'gemini'
    if (/(llama|mistral|mixtral|qwen|phi|deepseek)/.test(s)) return 'ollama'
    return this.logoKindForBackend()
  }

  async openModelMenu(anchor) {
    if (this._modelMenuEl) { this._closeModelMenu(); return }
    const info = await this.engine.listModels().catch(() => ({ models: [], allowCustom: true, current: '' }))
    const cur = info.current || ''
    const menu = document.createElement('div')
    menu.className = 'brain-model-menu'
    const rows = []
    if (info.note) rows.push(`<div class="bmm-note">${this.escapeHtml(info.note)}</div>`)
    if (!info.models.length && !info.allowCustom) rows.push('<div class="bmm-empty">No models available.</div>')
    for (const mdl of info.models) {
      const sel = mdl.id === cur
      const logo = serviceLogo(mdl.service || this.logoKindForBackend())
      const tier = mdl.desc ? `<span class="bmm-tier">${this.escapeHtml(mdl.desc)}</span>` : ''
      const reason = (mdl.efforts && mdl.efforts.length) ? `<span class="bmm-reason" title="Supports reasoning effort">${sparkIcon('bmm-reason-spark')}</span>` : ''
      rows.push(`<button class="bmm-item${sel ? ' selected' : ''}" data-id="${this.escapeHtml(mdl.id)}">`
        + `<span class="bmm-logo">${logo}</span>`
        + `<span class="bmm-label">${this.escapeHtml(mdl.label || mdl.id || 'Default')}</span>`
        + `${reason}${tier}`
        + `${sel ? '<i class="fas fa-check bmm-check"></i>' : ''}</button>`)
    }
    // Reasoning-effort segment — only when the current model supports it AND the
    // backend can actually send the level (api → reasoning_effort).
    const efforts = (info.effortApplies && Array.isArray(info.efforts)) ? info.efforts : []
    if (efforts.length) {
      rows.push('<div class="bmm-sep"></div>')
      const segs = efforts.map((lv) => {
        const on = lv === (info.currentEffort || '')
        const lab = lv.charAt(0).toUpperCase() + lv.slice(1)
        return `<button class="bmm-effort${on ? ' on' : ''}" data-effort="${this.escapeHtml(lv)}">${this.escapeHtml(lab)}</button>`
      }).join('')
      rows.push(`<div class="bmm-effort-head">${sparkIcon('bmm-effort-spark')} Reasoning effort</div><div class="bmm-effort-row">${segs}</div>`)
    }
    if (info.allowCustom) {
      const customVal = (cur && !info.models.some((mm) => mm.id === cur)) ? cur : ''
      rows.push('<div class="bmm-sep"></div>')
      rows.push(`<div class="bmm-custom"><input type="text" id="bmm-custom-input" placeholder="Custom model name…" value="${this.escapeHtml(customVal)}"><button id="bmm-custom-set">Set</button></div>`)
    }
    menu.innerHTML = rows.join('')
    document.body.appendChild(menu)
    this._modelMenuEl = menu

    const r = anchor.getBoundingClientRect()
    const top = Math.max(8, r.top - menu.offsetHeight - 6)
    menu.style.left = `${Math.round(r.left)}px`
    menu.style.top = `${Math.round(top)}px`

    menu.querySelectorAll('.bmm-item').forEach((b) => {
      b.onclick = async () => {
        await this.engine.setActiveModel(b.dataset.id)
        this.updateModelPill()
        this._closeModelMenu()
        // Re-open to surface the effort row when the picked model reasons.
        if (this._modelHasEffort(b.dataset.id)) this.openModelMenu(anchor)
      }
    })
    // Effort pills: click to set, click the active one again to clear. Re-render
    // in place so the new selection (and any pill changes) reflect immediately.
    menu.querySelectorAll('.bmm-effort').forEach((b) => {
      b.onclick = async () => {
        const next = b.classList.contains('on') ? '' : b.dataset.effort
        await this.engine.setModelEffort(next)
        this.updateModelPill()
        this._closeModelMenu()
        this.openModelMenu(anchor)
      }
    })
    const setCustom = async () => {
      const inp = menu.querySelector('#bmm-custom-input')
      const v = inp ? inp.value.trim() : ''
      if (!v) return
      await this.engine.setActiveModel(v); this.updateModelPill(); this._closeModelMenu()
    }
    const setBtn = menu.querySelector('#bmm-custom-set'); if (setBtn) setBtn.onclick = setCustom
    const inp = menu.querySelector('#bmm-custom-input'); if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); setCustom() } }

    this._modelMenuDismiss = (e) => {
      if (this._modelMenuEl && !this._modelMenuEl.contains(e.target) && !anchor.contains(e.target)) this._closeModelMenu()
    }
    this._modelMenuKey = (e) => { if (e.key === 'Escape') this._closeModelMenu() }
    setTimeout(() => {
      document.addEventListener('mousedown', this._modelMenuDismiss)
      document.addEventListener('keydown', this._modelMenuKey)
    }, 0)
  }

  _closeModelMenu() {
    if (this._modelMenuEl) { this._modelMenuEl.remove(); this._modelMenuEl = null }
    if (this._modelMenuDismiss) { document.removeEventListener('mousedown', this._modelMenuDismiss); this._modelMenuDismiss = null }
    if (this._modelMenuKey) { document.removeEventListener('keydown', this._modelMenuKey); this._modelMenuKey = null }
  }

  // ── Attachments (composer) ───────────────────────────────────────────────────

  _attachKind(file) {
    const t = (file.type || '').toLowerCase()
    const name = (file.name || '').toLowerCase()
    if (t.startsWith('image/')) return 'image'
    if (t === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
    return 'text'
  }

  async handleAttachFiles(fileList) {
    const files = Array.from(fileList || [])
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) { this._composerNote(`${file.name} is too large (max 25 MB)`); continue }
      try {
        const kind = this._attachKind(file)
        const id = this._genId('att')
        if (kind === 'image') {
          const dataUrl = await this._readDataUrl(file)
          this.attachments.push({ id, name: file.name, kind, dataUrl, mime: file.type, size: file.size })
        } else if (kind === 'pdf') {
          const text = await this._readPdfText(file)
          this.attachments.push({ id, name: file.name, kind, text, mime: 'application/pdf', size: file.size })
        } else {
          const text = await file.text()
          this.attachments.push({ id, name: file.name, kind: 'text', text, mime: file.type || 'text/plain', size: file.size })
        }
      } catch (e) {
        console.warn('[Brain] attach failed:', file.name, e && e.message)
        this._composerNote(`Couldn't read ${file.name}`)
      }
    }
    this.renderAttachments()
  }

  _readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = () => reject(r.error || new Error('read error'))
      r.readAsDataURL(file)
    })
  }

  /** Extract text from a PDF in the renderer via pdfjs (lazy-loaded). */
  async _readPdfText(file) {
    const buf = await file.arrayBuffer()
    const pdfjs = await import('pdfjs-dist')
    try {
      if (!this._pdfWorkerSet) {
        const workerMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default
        this._pdfWorkerSet = true
      }
    } catch (_) { /* fall back to main-thread parsing */ }
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
    let out = ''
    const pages = Math.min(doc.numPages, 50)
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      out += content.items.map((i) => (i.str || '')).join(' ') + '\n\n'
    }
    if (doc.numPages > pages) out += `\n[Truncated — first ${pages} of ${doc.numPages} pages]`
    return out.trim()
  }

  renderAttachments() {
    const row = document.getElementById('brain-attachments')
    if (!row) return
    if (!this.attachments.length) { row.style.display = 'none'; row.innerHTML = ''; return }
    row.style.display = 'flex'
    row.innerHTML = ''
    for (const a of this.attachments) {
      const chip = document.createElement('div')
      chip.className = `brain-attach-chip kind-${a.kind}`
      const icon = a.kind === 'image' ? 'fa-image' : (a.kind === 'pdf' ? 'fa-file-pdf' : 'fa-file-lines')
      const thumb = a.kind === 'image' && a.dataUrl
        ? `<img class="brain-attach-thumb" src="${a.dataUrl}" alt="">`
        : `<i class="fas ${icon}"></i>`
      chip.innerHTML = `${thumb}<span class="brain-attach-name">${this.escapeHtml(a.name)}</span><button class="brain-attach-x" title="Remove"><i class="fas fa-times"></i></button>`
      chip.querySelector('.brain-attach-x').onclick = () => this.removeAttachment(a.id)
      row.appendChild(chip)
    }
    this._syncSendState()
  }

  /** Render a read-only attachment strip inside a sent user message bubble. */
  renderUserAttachments(bubble, attachments) {
    if (!bubble || !attachments || !attachments.length) return
    const content = bubble.querySelector('.message-content')
    if (!content) return
    const row = document.createElement('div')
    row.className = 'brain-msg-attachments'
    for (const a of attachments) {
      const chip = document.createElement('div')
      chip.className = `brain-msg-attach kind-${a.kind}`
      if (a.kind === 'image' && a.dataUrl) {
        chip.innerHTML = `<img class="brain-attach-thumb" src="${a.dataUrl}" alt=""><span class="brain-attach-name">${this.escapeHtml(a.name)}</span>`
      } else {
        const icon = a.kind === 'pdf' ? 'fa-file-pdf' : 'fa-file-lines'
        chip.innerHTML = `<i class="fas ${icon}"></i><span class="brain-attach-name">${this.escapeHtml(a.name)}</span>`
      }
      row.appendChild(chip)
    }
    // Above the grey bubble (the message column is right-aligned), like Notion.
    bubble.insertBefore(row, content)
  }

  /** Append a faint token/cost readout under an answer (when the agent reported it). */
  renderUsageFooter(bubble) {
    if (!bubble) return
    const u = this.engine.lastUsage
    if (!u || !u.model) return
    const content = bubble.querySelector('.message-content') || bubble
    content.querySelector('.brain-msg-usage')?.remove()
    const k = (n) => (n == null ? '?' : (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)))
    const cost = (typeof u.costUSD === 'number') ? ` · $${u.costUSD.toFixed(u.costUSD < 0.1 ? 4 : 2)}` : ''
    const eff = this.engine._claudeEffort ? this.engine._claudeEffort() : ''
    const effTxt = eff ? ` · ${eff} effort` : ''
    const row = document.createElement('div')
    row.className = 'brain-msg-usage'
    row.innerHTML = `<i class="fas fa-coins"></i> ${this.escapeHtml(u.model)} · ${k(u.input)} in / ${k(u.output)} out${this.escapeHtml(cost)}${this.escapeHtml(effTxt)}`
    content.appendChild(row)
  }

  removeAttachment(id) {
    this.attachments = this.attachments.filter((a) => a.id !== id)
    this.renderAttachments()
  }

  clearAttachments() {
    this.attachments = []
    this.renderAttachments()
  }

  /** Build the text block (from text+PDF attachments) folded into the question. */
  _attachmentTextContext() {
    const textual = this.attachments.filter((a) => a.kind === 'text' || a.kind === 'pdf')
    if (!textual.length) return ''
    const blocks = textual.map((a) => {
      const body = String(a.text || '').slice(0, 20000)
      return `--- Attached file: ${a.name} ---\n${body}`
    })
    return `\n\nThe user attached ${textual.length} file(s). Use their contents as context:\n\n${blocks.join('\n\n')}`
  }

  /** OpenAI-style image parts (api/vision backends only). */
  _attachmentImageParts() {
    return this.attachments
      .filter((a) => a.kind === 'image' && a.dataUrl)
      .map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl } }))
  }

  /** A short, transient hint shown under the composer. */
  _composerNote(msg) {
    const wrap = document.getElementById('brain-input-wrapper')
    if (!wrap) return
    let n = wrap.querySelector('.brain-composer-note')
    if (!n) { n = document.createElement('div'); n.className = 'brain-composer-note'; wrap.appendChild(n) }
    n.textContent = msg
    n.classList.add('show')
    clearTimeout(this._composerNoteTimer)
    this._composerNoteTimer = setTimeout(() => { n.classList.remove('show') }, 3200)
  }

  // ── Composer state: send button · placement · streaming · answer actions ────

  /** Send button reflects whether there's something to send (muted ↔ accent). */
  _syncSendState() {
    if (this._streaming) return
    const btn = document.getElementById('brain-send-btn')
    const input = document.getElementById('brain-query-input')
    if (!btn) return
    const has = (input && input.value.trim()) || (this.attachments && this.attachments.length)
    btn.classList.toggle('is-active', !!has)
  }

  /** Move the composer out of the chat list (to the docked slot) so a chat-list
   *  innerHTML reset can't destroy it. Always safe to call. */
  _parkComposer() {
    const wrap = document.getElementById('brain-input-wrapper')
    const layout = document.querySelector('.brain-page-layout')
    if (wrap && layout && wrap.parentElement !== layout) { layout.appendChild(wrap); wrap.classList.remove('is-hero') }
  }

  /** Empty chat → composer floats centered in the hero; active chat → docked bottom. */
  _syncComposerPlacement() {
    const wrap = document.getElementById('brain-input-wrapper')
    const layout = document.querySelector('.brain-page-layout')
    if (!wrap || !layout) return
    const slot = document.getElementById('brain-hero-slot')
    if (slot) {
      if (wrap.parentElement !== slot) slot.appendChild(wrap)
      wrap.classList.add('is-hero')
    } else {
      if (wrap.parentElement !== layout) layout.appendChild(wrap)
      wrap.classList.remove('is-hero')
    }
    this._syncSendState()
  }

  /** Topbar shows the active conversation's title once it has messages. */
  _updateTopbarTitle() {
    const el = document.querySelector('.brain-title span')
    if (!el) return
    const t = this.activeThread ? this.activeThread() : null
    const hasMsgs = t && Array.isArray(t.messages) && t.messages.length
    el.textContent = hasMsgs ? (t.title || 'Conversation') : 'Brain'
  }

  /** Swap the send button into a Stop control for the duration of a stream. */
  _beginStreaming() {
    this._streaming = true
    const btn = document.getElementById('brain-send-btn')
    if (!btn) return
    btn.classList.add('is-stop'); btn.classList.remove('is-active')
    btn.innerHTML = '<i class="fas fa-stop"></i>'
    btn.title = 'Stop'
    btn.onclick = () => { if (this._onStopStreaming) this._onStopStreaming() }
  }

  /** Restore the send button after a stream ends (completed, stopped, or errored). */
  _endStreaming() {
    this._streaming = false
    this._onStopStreaming = null
    const btn = document.getElementById('brain-send-btn')
    if (btn) {
      btn.classList.remove('is-stop')
      btn.innerHTML = '<i class="fas fa-arrow-up"></i>'
      btn.title = 'Ask'
      btn.onclick = () => this.submitQuery()
    }
    this._syncSendState()
  }

  /** Copy · thumbs-up · thumbs-down row under a finished assistant answer. */
  _renderAnswerActions(bubble, raw) {
    if (!bubble) return
    const content = bubble.querySelector('.message-content') || bubble
    content.querySelector('.brain-msg-actions')?.remove()
    const row = document.createElement('div')
    row.className = 'brain-msg-actions'
    row.innerHTML = `
      <button class="bma-btn" data-act="copy" title="Copy"><i class="far fa-copy"></i></button>
      <button class="bma-btn" data-act="up" title="Good answer"><i class="far fa-thumbs-up"></i></button>
      <button class="bma-btn" data-act="down" title="Needs work"><i class="far fa-thumbs-down"></i></button>`
    const copyBtn = row.querySelector('[data-act="copy"]')
    copyBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(raw || ''); this._composerNote('Copied to clipboard') } catch (_) { /* ignore */ }
    }
    const up = row.querySelector('[data-act="up"]')
    const down = row.querySelector('[data-act="down"]')
    up.onclick = () => { up.classList.toggle('on'); down.classList.remove('on') }
    down.onclick = () => { down.classList.toggle('on'); up.classList.remove('on') }
    content.appendChild(row)
  }
}
