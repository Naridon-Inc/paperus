import Store from './store'

// Basic English Stop Words for TF-IDF Tokenizer
const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'cant', 'cannot', 'could',
  'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell', 'hes', 'her', 'here', 'heres',
  'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'ill', 'im', 'ive', 'if', 'in', 'into', 'is',
  'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt', 'my', 'myself', 'no', 'nor', 'not', 'of',
  'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same',
  'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so', 'some', 'such', 'than', 'that', 'thats',
  'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'theres', 'these', 'they', 'theyd', 'theyll',
  'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasnt',
  'we', 'wed', 'well', 'were', 'weve', 'werent', 'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which',
  'while', 'who', 'whos', 'whom', 'why', 'whys', 'with', 'wont', 'would', 'wouldnt', 'you', 'youd', 'youll',
  'youre', 'youve', 'your', 'yours', 'yourself', 'yourselves'
])

// ── Model catalogs for the in-composer model picker ──────────────────────────
// Per-backend *suggested* models. These are starting points only — every backend
// that allows a custom value lets the user type any model name, so the lists
// going stale never blocks anyone. Designed to extend: drop a new agent into
// CLI_MODELS / CLI_MODEL_FLAG and its models appear in the picker automatically.

// Claude Code rides the user's Claude sign-in; `--model` accepts these aliases.
const CLAUDE_MODELS = [
  { id: '', label: 'Default', desc: 'your plan' },
  { id: 'opus', label: 'Claude Opus', desc: 'most capable' },
  { id: 'sonnet', label: 'Claude Sonnet', desc: 'balanced' },
  { id: 'haiku', label: 'Claude Haiku', desc: 'fastest' },
]

// Other coding-agent CLIs we can pass a model to (main `ai:cli-run` adds the flag).
const CLI_MODELS = {
  gemini: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
  'cursor-agent': [
    { id: 'sonnet', label: 'Claude Sonnet' },
    { id: 'gpt-5', label: 'GPT-5' },
  ],
  opencode: [],
  aider: [],
}
// The CLI flag each agent uses to choose a model (default `-m`).
const CLI_MODEL_FLAG = { gemini: '-m', 'cursor-agent': '-m', opencode: '-m', aider: '--model' }

// API providers (OpenAI-compatible). Used as fallback/extra suggestions when the
// provider's live `/models` endpoint isn't reachable.
const API_MODELS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3'],
  anthropic: ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
  gemini: ['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-1.5-pro'],
  openrouter: ['anthropic/claude-3.7-sonnet', 'openai/gpt-4o', 'google/gemini-2.0-flash-001'],
}

// Reasoning-effort levels we can pass to an OpenAI-compatible provider via the
// `reasoning_effort` request field. Surfaced in the picker only for models that
// actually take it, and only wired on the `api` backend where we can send it.
const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high']

// Claude Code's own session effort levels (`claude --effort <level>`). Session-
// level, so they apply to whichever Claude model the CLI resolves.
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// Best-effort service identity for a model id, so the picker can show the real
// brand mark (Claude / OpenAI / Gemini / Ollama) next to each model name. Returns
// '' (caller falls back to the backend's own logo) when nothing matches.
function modelService(id) {
  const s = String(id || '').toLowerCase()
  if (/(claude|opus|sonnet|haiku)/.test(s)) return 'claude'
  if (/((^|[^a-z])o\d|gpt|chatgpt|davinci|openai)/.test(s)) return 'openai'
  if (/(gemini|gemma|bison|palm)/.test(s)) return 'gemini'
  if (/(llama|mistral|mixtral|qwen|phi\b|deepseek|codellama|vicuna|orca|gemma)/.test(s)) return 'ollama'
  return ''
}

// Which reasoning-effort levels a model id supports (empty ⇒ no effort control).
// OpenAI o-series & GPT-5 take minimal→high; Claude Opus/Sonnet & Gemini 2.5
// reason at low→high.
function modelEffortLevels(id) {
  const s = String(id || '').toLowerCase()
  if (/(^|[^a-z])o\d/.test(s) || /gpt-5/.test(s)) return ['minimal', 'low', 'medium', 'high']
  if (/(opus|sonnet)/.test(s)) return ['low', 'medium', 'high']
  if (/gemini-2\.5/.test(s)) return ['low', 'medium', 'high']
  return []
}

// A short capability/tier hint for a model id (shown faint on the right of a row).
function modelTier(id) {
  const s = String(id || '').toLowerCase()
  if (/opus/.test(s)) return 'most capable'
  if (/sonnet/.test(s)) return 'balanced'
  if (/haiku/.test(s)) return 'fastest'
  if (/(^|[^a-z])o\d|gpt-5/.test(s)) return 'reasoning'
  if (/(mini|flash|lite|small|8b|7b|3b)/.test(s)) return 'fast'
  if (/(pro|large|405b|70b|72b)/.test(s)) return 'capable'
  return ''
}

export class RAGEngine {
  constructor() {
    this.chunks = [] // Array of { id, docId, filePath, header, text, vector }
    this.status = 'idle' // 'idle' | 'indexing' | 'ready' | 'error'
    this.searchMode = 'hybrid' // 'hybrid' | 'tfidf'
    this.activeModel = 'nomic-embed-text' // fallback to nomic-embed-text
    this.llmModel = 'llama3' // fallback LLM model
    this.projectPath = null
    this.dfMap = new Map() // Document frequency for TF-IDF

    // Non-blocking queue controller
    this.indexQueue = []
    this.isProcessingQueue = false
    this.onStatusChange = null

    // In-memory cache for document vectors to prevent redundant Ollama calls.
    // Mirrors the per-file vectors of the persisted index so a restart can answer
    // semantic queries without re-embedding (the persistent index hydrates this).
    this.vectorCache = new Map() // Map<filePath, Array of vectors>

    // Persistent index bookkeeping (Electron only). We hash each file's text and
    // remember it so a relaunch can skip re-embedding files that haven't changed,
    // and only re-index the ones that did. Bump PERSIST_VERSION when the on-disk
    // record shape (or chunking) changes so old indexes are cleanly rebuilt.
    this.fileHashes = new Map() // Map<filePath, contentHash>
    this.PERSIST_VERSION = 1
    this._indexHydrated = false // true once a (re)index ran so we know it's safe to save

    // Pluggable answer backend. 'local' = Ollama on this machine (default),
    // 'api' = a user's OpenAI-compatible service + key, 'claude-code' = the
    // user's installed Claude Code CLI, 'cli' = any other coding-agent CLI driven
    // generically (`<cliCmd> <cliPromptFlag> "<prompt>"` → stdout). Retrieval
    // (finding relevant notes) always works offline via TF-IDF; only the final
    // answer uses the chosen backend.
    this.aiMode = 'local'
    this.apiEndpoint = ''
    this.apiModel = ''
    this.claudeModel = ''
    this.cliCmd = ''
    this.cliPromptFlag = '-p'
    // Model chosen in the composer picker. `localModel` overrides the auto-picked
    // Ollama generation model; `cliModel` (+ `cliModelFlag`) selects a model for a
    // coding-agent CLI. `apiModel`/`claudeModel` above double as the picked model.
    this.localModel = ''
    this.cliModel = ''
    this.cliModelFlag = ''
    // Reasoning effort for models that accept it (OpenAI o-series/GPT-5, Claude
    // Opus/Sonnet, Gemini 2.5). Sent as `reasoning_effort` on the api backend and
    // as `--effort` on Claude Code.
    this.modelEffort = ''
    // Exact model ids learned FROM the real agent (alias → 'claude-opus-4-8'),
    // captured from Claude Code's JSON output so the picker shows true versions.
    this.claudeResolved = {}
    // Token usage / cost from the most recent answer (for the usage readout).
    this.lastUsage = null

    // ── Agent context (set by the active "agent" persona before each ask) ──────
    // Extra system instructions prepended to the Brain prompt for this persona.
    this.agentInstructions = ''
    // Which tool GROUPS this agent may use (Set of 'docs'|'email'|'calendar'|
    // 'system'); null = all groups. Filters both the advertised catalogue and
    // dispatch, so a Calendar agent can't be coaxed into sending email.
    this.enabledToolGroups = null
    // Write/send autonomy: 'ask' = preview+approve every write, 'auto-reply' =
    // single sends go straight through but bulk/campaign still asks, 'autonomous'
    // = never asks. Default is the safe one. A persona can raise it.
    this.writePolicy = 'ask'
    // Injected by the UI: async ({kind,summary,detail,bulk}) => boolean. Shows the
    // approval modal and resolves true to proceed. Absent ⇒ writes fail safe.
    this.confirmAction = null

    // Tools the agent loop can call are data, not a hard-coded switch — built-ins
    // and plugin-provided tools live side by side here so _toolCatalog/runTool
    // discover them automatically. id → { id, description, parameters, handler, source }.
    this.toolRegistry = new Map()
    // Upper bound on how long the `build_plugin` rich path waits for the Studio
    // coding agent to finish one turn before moving on / giving up (ms). Generous
    // because a real agent edits files; bounded so the Brain loop can never hang.
    this.STUDIO_BUILD_TIMEOUT_MS = 180000
    this._registerBuiltinTools()
    this._registerWorkspaceTools()
  }

  /**
   * Register a callable tool for the Brain's agent loop. Built-ins register at
   * construction; plugins register theirs through the host bridge (Phase 4). All
   * share one registry, so the prompt catalogue + dispatch see every tool.
   * @param {{id:string, description:string, parameters?:object, handler:Function, source?:string}} d
   * @returns {boolean} true if it registered.
   */
  registerTool(d) {
    if (!d || typeof d.id !== 'string' || !/^[a-z][a-z0-9_]{1,48}$/i.test(d.id)) {
      console.warn('[RAG Engine] registerTool: invalid id', d && d.id); return false
    }
    if (typeof d.description !== 'string' || !d.description.trim()) {
      console.warn('[RAG Engine] registerTool: missing description for', d.id); return false
    }
    if (typeof d.handler !== 'function') {
      console.warn('[RAG Engine] registerTool: missing handler for', d.id); return false
    }
    const MAX_TOOLS = 256 // generous headroom for MCP servers that expose many tools
    if (!this.toolRegistry.has(d.id) && this.toolRegistry.size >= MAX_TOOLS) {
      console.warn('[RAG Engine] registerTool: tool cap reached, ignoring', d.id); return false
    }
    this.toolRegistry.set(d.id, {
      id: d.id,
      description: d.description.trim(),
      parameters: (d.parameters && typeof d.parameters === 'object') ? d.parameters : {},
      handler: d.handler,
      source: d.source || 'plugin',
      group: d.group || (d.source === 'builtin' ? 'docs' : 'system'),
      write: !!d.write,
    })
    return true
  }

  /** Remove a tool. Built-ins are protected. */
  unregisterTool(id) {
    const t = this.toolRegistry.get(id)
    if (t && t.source === 'builtin') return false
    return this.toolRegistry.delete(id)
  }

  /** Snapshot of registered tools (for UI / plugins). */
  listTools() {
    return Array.from(this.toolRegistry.values()).map((t) => ({
      id: t.id, description: t.description, parameters: t.parameters, source: t.source,
    }))
  }

  /**
   * Pull every connected MCP server's tools (via the main-process pool) and
   * register them as first-class Brain tools. Each becomes group `mcp:<server>`
   * so agents can be scoped to specific servers, and its handler dispatches back
   * over `mcp:call`. Servers flagged askFirst route through the approval modal.
   * Idempotent: drops previously-registered MCP tools first, so it doubles as the
   * refresh on a `mcp:changed` event.
   */
  async syncMcpTools() {
    this._mcpSynced = true
    if (!(typeof window !== 'undefined' && window.api && typeof window.api.invoke === 'function')) return 0
    let res
    try { res = await window.api.invoke('mcp:tools') } catch (_e) { return 0 }
    // Clear stale MCP tools (anything whose source is namespaced under "mcp").
    for (const [id, t] of Array.from(this.toolRegistry.entries())) {
      if (t.source && String(t.source).startsWith('mcp')) this.toolRegistry.delete(id)
    }
    if (!res || !res.ok || !Array.isArray(res.tools)) return 0
    const used = new Set(Array.from(this.toolRegistry.keys()))
    let n = 0
    for (const t of res.tools) {
      let id = this._mcpToolId(t.server, t.name)
      while (used.has(id)) id = `${id}_${n}`.slice(0, 49) // collision after truncation
      used.add(id)
      const server = t.server
      const toolName = t.name
      const serverName = t.serverName || t.server
      const askFirst = !!t.askFirst
      const okReg = this.registerTool({
        id,
        description: (t.description || `${toolName} — ${serverName} (MCP)`).slice(0, 400),
        parameters: this._mcpParams(t.inputSchema),
        source: `mcp:${server}`,
        group: `mcp:${server}`,
        write: askFirst,
        handler: async (args) => {
          if (askFirst && typeof this.confirmAction === 'function') {
            const proceed = await this.confirmAction({
              kind: 'mcp_call', bulk: false,
              summary: `Run ${toolName} via ${serverName}`,
              detail: { server: serverName, tool: toolName, args: args || {} },
            })
            if (!proceed) return { error: 'User declined this tool call.' }
          }
          let r
          try { r = await window.api.invoke('mcp:call', { server, tool: toolName, args: args || {} }) } catch (e) { return { error: e.message } }
          if (!r || !r.ok) return { error: (r && r.error) || 'MCP tool failed.' }
          return (r.text != null && r.text !== '') ? { result: r.text } : (r.raw || { ok: true })
        },
      })
      if (okReg) n += 1
    }
    return n
  }

  /** Sanitise server+tool into a registry-legal id: ^[a-z][a-z0-9_]{1,48}$. */
  _mcpToolId(server, name) {
    const s = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    let id = `mcp_${s(server)}_${s(name)}`.replace(/_+/g, '_').slice(0, 49)
    if (!/^[a-z]/.test(id)) id = `m_${id}`.slice(0, 49)
    return id
  }

  /** Compact a JSON-Schema inputSchema into the {name:'type?'} hint the catalog renders. */
  _mcpParams(schema) {
    try {
      if (!schema || schema.type !== 'object' || !schema.properties) return {}
      const req = new Set(Array.isArray(schema.required) ? schema.required : [])
      const out = {}
      for (const [k, v] of Object.entries(schema.properties)) {
        const type = (v && (Array.isArray(v.type) ? v.type[0] : v.type)) || 'string'
        out[k] = req.has(k) ? String(type) : `${type}?`
      }
      return out
    } catch (_e) { return {} }
  }

  /** The four read-only built-ins, wrapping the existing _tool* implementations. */
  _registerBuiltinTools() {
    this.registerTool({
      id: 'list_documents', source: 'builtin', parameters: {},
      description: 'list every indexed document with its section count.',
      handler: () => this._toolListDocuments(),
    })
    this.registerTool({
      id: 'search_documents', source: 'builtin', parameters: { query: 'string', k: 'number?' },
      description: 'keyword/semantic search across ALL docs; returns the top matching snippets with their file + section.',
      handler: (args) => this._toolSearch(args),
    })
    this.registerTool({
      id: 'read_document', source: 'builtin', parameters: { name: 'string' },
      description: 'return the FULL text of one document (match by name, title, or path).',
      handler: (args) => this._toolReadDocument(args),
    })
    this.registerTool({
      id: 'get_outline', source: 'builtin', parameters: { name: 'string' },
      description: "list a document's section headers (a cheap way to see what it covers).",
      handler: (args) => this._toolGetOutline(args),
    })
    this.registerTool({
      id: 'recent_changes', source: 'builtin', parameters: { limit: 'number?', days: 'number?' },
      description: 'list the most recently MODIFIED notes (newest first, with how long ago). Use this to answer "what changed/what did I work on recently?"; then read_document the top entries to summarize the actual edits.',
      handler: (args) => this._toolRecentChanges(args),
    })
    // Phase 6 — the Brain can author + install its own connector plugins. This is
    // the ONLY built-in that writes anything; it scaffolds files to disk but the
    // plugin lands DISABLED, so the user reviews the proposed capabilities before
    // it can ever run (sensitive caps like net:<host> are re-prompted at enable).
    this.registerTool({
      id: 'build_plugin', source: 'builtin', group: 'system', write: true,
      parameters: {
        name: 'string', description: 'string', capabilities: 'string[]', entry: 'string (index.js source)',
      },
      description: 'scaffold + install a new plugin from a spec {name, description, capabilities[], entry(JS source)}; it installs DISABLED so the user reviews capabilities before enabling.',
      handler: (args) => this._toolBuildPlugin(args),
    })
  }

  /**
   * Register the workspace-action tools — email + calendar — that let the Brain
   * act across the user's real accounts. Read tools (search/list/read) run freely;
   * WRITE tools (send_email, send_campaign, create_calendar_event) route through
   * `_gateWrite`, which honours the active agent's writePolicy + the approval modal
   * so real mail never leaves unattended unless the user chose autonomy. Every
   * handler is desktop-only (needs the IPC bridge) and NEVER throws — failures come
   * back as { error } so the agent loop stays alive.
   */
  _registerWorkspaceTools() {
    // ── Email (group 'email') ────────────────────────────────────────────────
    this.registerTool({
      id: 'list_email_accounts', source: 'builtin', group: 'email', parameters: {},
      description: 'list the connected email accounts (id, address, name, unread count). Use the id as accountId for the other email tools.',
      handler: () => this._toolEmail('email:accountsList', {}, (r) => ({ accounts: r.accounts || [] })),
    })
    this.registerTool({
      id: 'search_email', source: 'builtin', group: 'email',
      parameters: { query: 'string', accountId: 'string?', folder: 'string?' },
      description: 'search a mailbox for messages matching free text (subject/sender/snippet). Returns summaries with {accountId, folder, uid, from, subject, date, snippet}. accountId defaults to the first account.',
      handler: (a) => this._toolEmailSearch(a),
    })
    this.registerTool({
      id: 'list_recent_email', source: 'builtin', group: 'email',
      parameters: { limit: 'number?', accountId: 'string?', folder: 'string?' },
      description: 'list the most recent messages (newest first). Omit accountId for a UNIFIED view across every inbox. Returns summaries with {accountId, folder, uid, from, subject, date, snippet, seen}.',
      handler: (a) => this._toolEmailRecent(a),
    })
    this.registerTool({
      id: 'read_email', source: 'builtin', group: 'email',
      parameters: { accountId: 'string', folder: 'string', uid: 'number' },
      description: 'read ONE message in full (plain-text body + attachment names). Pass the accountId, folder and uid from a search/list result.',
      handler: (a) => this._toolEmailRead(a),
    })
    this.registerTool({
      id: 'send_email', source: 'builtin', group: 'email', write: true,
      parameters: { to: 'string|string[]', subject: 'string', body: 'string', cc: 'string?', bcc: 'string?', accountId: 'string?', inReplyTo: 'string?' },
      description: 'send ONE email from the user\'s real account. Subject + body required. Routed through approval unless the agent is autonomous. Use for replies and one-off messages.',
      handler: (a) => this._toolEmailSend(a),
    })
    this.registerTool({
      id: 'send_campaign', source: 'builtin', group: 'email', write: true,
      parameters: { messages: '[{to, subject, body}]', accountId: 'string?' },
      description: 'send a PERSONALISED batch (campaign): an array of {to, subject, body}, one per recipient — compose each body yourself for that person. The user approves the whole list once. Use for outreach/engagement campaigns.',
      handler: (a) => this._toolEmailCampaign(a),
    })
    // ── Calendar (group 'calendar') ──────────────────────────────────────────
    this.registerTool({
      id: 'list_calendars', source: 'builtin', group: 'calendar', parameters: {},
      description: 'list the connected calendars (id, name, color, visible). Use a calendar id when creating events.',
      handler: () => this._toolCal('calendar:calendars', {}, (r) => ({ calendars: r.calendars || [] })),
    })
    this.registerTool({
      id: 'list_calendar_events', source: 'builtin', group: 'calendar',
      parameters: { startISO: 'string', endISO: 'string' },
      description: 'list calendar events in a date range (ISO timestamps). Returns {title, startISO, endISO, allDay, location, calendarId}.',
      handler: (a) => this._toolCal('calendar:events', { startISO: a.startISO, endISO: a.endISO }, (r) => ({ events: r.events || [] })),
    })
    this.registerTool({
      id: 'create_calendar_event', source: 'builtin', group: 'calendar', write: true,
      parameters: { title: 'string', startISO: 'string', endISO: 'string?', calendarId: 'string?', location: 'string?', description: 'string?', allDay: 'boolean?' },
      description: 'create a calendar event. Routed through approval unless the agent is autonomous. calendarId defaults to the first writable calendar.',
      handler: (a) => this._toolCalCreate(a),
    })
  }

  /** True if `group` is allowed under the active agent (null set ⇒ all allowed). */
  _groupEnabled(group) {
    if (!this.enabledToolGroups) return true
    return this.enabledToolGroups.has(group)
  }

  /** Bridge guard: every workspace tool needs the Electron IPC bridge. */
  _hasBridge() {
    return typeof window !== 'undefined' && window.api && typeof window.api.invoke === 'function'
  }

  /** Generic read-only email IPC call → shaped result (never throws). */
  async _toolEmail(channel, payload, shape) {
    if (!this._hasBridge()) return { error: 'Email is only available in the desktop app.' }
    try {
      const r = await window.api.invoke(channel, payload || {})
      if (!r || r.ok === false) return { error: (r && r.error) || `${channel} failed` }
      return shape ? shape(r) : r
    } catch (e) { return { error: (e && e.message) || String(e) } }
  }

  /** Generic read-only calendar IPC call → shaped result (never throws). */
  async _toolCal(channel, payload, shape) {
    if (!this._hasBridge()) return { error: 'Calendar is only available in the desktop app.' }
    try {
      const r = await window.api.invoke(channel, payload || {})
      if (!r || r.ok === false) return { error: (r && r.error) || `${channel} failed` }
      return shape ? shape(r) : r
    } catch (e) { return { error: (e && e.message) || String(e) } }
  }

  /** Resolve a usable email accountId: explicit → first connected. */
  async _resolveEmailAccount(accountId) {
    if (accountId && accountId !== '*') return accountId
    const r = await window.api.invoke('email:accountsList', {})
    const first = r && r.accounts && r.accounts[0]
    return first ? first.id : null
  }

  async _toolEmailSearch(a = {}) {
    if (!this._hasBridge()) return { error: 'Email is only available in the desktop app.' }
    try {
      const accountId = await this._resolveEmailAccount(a.accountId)
      if (!accountId) return { error: 'No email account is connected. Add one in the Inbox first.' }
      const r = await window.api.invoke('email:search', { accountId, query: String(a.query || ''), folder: a.folder || undefined })
      if (!r || r.ok === false) return { error: (r && r.error) || 'search failed' }
      return { accountId, messages: (r.messages || []).slice(0, 25) }
    } catch (e) { return { error: (e && e.message) || String(e) } }
  }

  async _toolEmailRecent(a = {}) {
    if (!this._hasBridge()) return { error: 'Email is only available in the desktop app.' }
    try {
      const unified = !a.accountId
      const accountId = unified ? '*' : a.accountId
      const folder = a.folder || (unified ? '__ALL_INBOXES__' : 'INBOX')
      const limit = Math.min(Math.max(Number(a.limit) || 20, 1), 50)
      const r = await window.api.invoke('email:messages', { accountId, folder, offset: 0, limit })
      if (!r || r.ok === false) return { error: (r && r.error) || 'list failed' }
      return { messages: r.messages || [], total: r.total || 0 }
    } catch (e) { return { error: (e && e.message) || String(e) } }
  }

  async _toolEmailRead(a = {}) {
    if (!this._hasBridge()) return { error: 'Email is only available in the desktop app.' }
    if (!a.accountId || !a.folder || a.uid == null) return { error: 'read_email needs accountId, folder and uid (from a search/list result).' }
    try {
      const r = await window.api.invoke('email:message', { accountId: a.accountId, folder: a.folder, uid: Number(a.uid) })
      if (!r || r.ok === false) return { error: (r && r.error) || 'read failed' }
      const m = r.message || {}
      const text = (m.text && m.text.trim())
        ? m.text
        : String(m.html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return {
        subject: m.subject, from: m.from, to: m.to, date: m.date,
        body: text.slice(0, 6000),
        attachments: (m.attachments || []).map((x) => x.filename).filter(Boolean),
      }
    } catch (e) { return { error: (e && e.message) || String(e) } }
  }

  async _toolEmailSend(a = {}) {
    if (!this._hasBridge()) return { error: 'Email is only available in the desktop app.' }
    const to = a.to
    const subject = String(a.subject || '').trim()
    const body = String(a.body || '')
    if (!to || (Array.isArray(to) && !to.length)) return { error: 'send_email needs a "to" recipient.' }
    if (!subject) return { error: 'send_email needs a "subject".' }
    try {
      const accountId = await this._resolveEmailAccount(a.accountId)
      if (!accountId) return { error: 'No email account is connected.' }
      const recips = Array.isArray(to) ? to.join(', ') : String(to)
      const approved = await this._gateWrite({
        kind: 'send_email', bulk: Array.isArray(to) && to.length > 1,
        summary: `Send email to ${recips}`,
        detail: { to, cc: a.cc, bcc: a.bcc, subject, body },
      })
      if (!approved) return { cancelled: true, note: 'The user did not approve this send.' }
      const draft = { to, cc: a.cc || undefined, bcc: a.bcc || undefined, subject, text: body, inReplyTo: a.inReplyTo || undefined }
      const r = await window.api.invoke('email:send', { accountId, draft })
      if (!r || r.ok === false) return { error: (r && r.error) || 'send failed' }
      return { ok: true, sent: true, to, subject, messageId: r.messageId }
    } catch (e) { return { error: (e && e.message) || String(e) } }
  }

  async _toolEmailCampaign(a = {}) {
    if (!this._hasBridge()) return { error: 'Email is only available in the desktop app.' }
    const msgs = Array.isArray(a.messages) ? a.messages.filter((m) => m && m.to && m.subject) : []
    if (!msgs.length) return { error: 'send_campaign needs a non-empty "messages" array of {to, subject, body}.' }
    if (msgs.length > 200) return { error: 'Campaign too large (max 200 recipients per batch).' }
    try {
      const accountId = await this._resolveEmailAccount(a.accountId)
      if (!accountId) return { error: 'No email account is connected.' }
      const approved = await this._gateWrite({
        kind: 'send_campaign', bulk: true,
        summary: `Send a campaign to ${msgs.length} recipient${msgs.length === 1 ? '' : 's'}`,
        detail: { messages: msgs.map((m) => ({ to: m.to, subject: m.subject, body: m.body || '' })) },
      })
      if (!approved) return { cancelled: true, note: 'The user did not approve this campaign.' }
      const results = []
      for (const m of msgs) {
        try {
          const r = await window.api.invoke('email:send', { accountId, draft: { to: m.to, subject: String(m.subject), text: String(m.body || '') } })
          results.push({ to: m.to, ok: !!(r && r.ok !== false), error: (r && r.error) || undefined })
        } catch (e) { results.push({ to: m.to, ok: false, error: (e && e.message) || String(e) }) }
      }
      const sent = results.filter((r) => r.ok).length
      return { ok: true, sent, failed: results.length - sent, results }
    } catch (e) { return { error: (e && e.message) || String(e) } }
  }

  async _toolCalCreate(a = {}) {
    if (!this._hasBridge()) return { error: 'Calendar is only available in the desktop app.' }
    const title = String(a.title || '').trim()
    if (!title || !a.startISO) return { error: 'create_calendar_event needs a title and startISO.' }
    try {
      let calendarId = a.calendarId
      if (!calendarId) {
        const cr = await window.api.invoke('calendar:calendars', {})
        const cal = cr && cr.calendars && cr.calendars[0]
        calendarId = cal ? cal.id : null
      }
      if (!calendarId) return { error: 'No calendar is connected. Add a calendar account first.' }
      const approved = await this._gateWrite({
        kind: 'create_calendar_event', bulk: false,
        summary: `Create event "${title}"`,
        detail: { title, startISO: a.startISO, endISO: a.endISO, location: a.location, description: a.description },
      })
      if (!approved) return { cancelled: true, note: 'The user did not approve this event.' }
      const r = await window.api.invoke('calendar:eventCreate', {
        calendarId, title, startISO: a.startISO, endISO: a.endISO || undefined,
        allDay: !!a.allDay, location: a.location || undefined, description: a.description || undefined,
      })
      if (!r || r.ok === false) return { error: (r && r.error) || 'create failed' }
      return { ok: true, created: true, event: r.event }
    } catch (e) { return { error: (e && e.message) || String(e) } }
  }

  /**
   * Decide whether a WRITE tool may proceed, honouring the active agent's policy:
   *   autonomous  → always yes (no prompt)
   *   auto-reply  → yes for single sends; bulk/campaign still asks
   *   ask         → always asks
   * Asking delegates to the injected `confirmAction` (the approval modal). With no
   * confirmer wired, it fails safe (no send).
   * @returns {Promise<boolean>}
   */
  async _gateWrite({ kind, summary, detail, bulk }) {
    const policy = this.writePolicy || 'ask'
    if (policy === 'autonomous') return true
    if (policy === 'auto-reply' && !bulk) return true
    if (typeof this.confirmAction === 'function') {
      try { return !!(await this.confirmAction({ kind, summary, detail, bulk: !!bulk })) } catch (_) { return false }
    }
    return false
  }

  /**
   * Slugify a free-text plugin name into a stable reverse-DNS plugin id, mirroring
   * the Plugin Lab's `slugId()` so the Brain and the Lab agree on ids (lower-kebab
   * under the `com.local.` namespace). The registry's id regex governs TOOL ids,
   * not plugin ids — plugin ids are file/folder ids, so the dotted form is correct.
   */
  _slugPluginId(name) {
    const slug = String(name || 'plugin')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'plugin'
    return `com.local.${slug}`
  }

  /**
   * Author + install a plugin from a spec the Brain produces, then return STRUCTURED
   * data the agent loop can relay/cite. Mirrors the Lab's `writePlugin()` flow
   * (`plugin:scaffold` → `plugin:fs-write` for plugin.json + index.js) but is
   * self-contained here — no import of plugin-lab.js.
   *
   * SECURITY: the Brain authors against the SAME capability rules as a human in the
   * Lab. It may PROPOSE any caps (including `tools` and a sensitive `net:<host>`),
   * but the plugin is installed DISABLED by default (scaffolding never enables it),
   * so its handlers cannot run until the user reviews the caps and enables it — at
   * which point the existing pre-enable sensitive-cap confirmation still fires. The
   * Brain CANNOT silently grant egress or bypass any approval from here.
   *
   * NEVER throws — every failure path returns { error } so the agent loop stays
   * alive. Electron-only: without the IPC bridge there is nowhere to write files.
   * @param {{name?:string, description?:string, capabilities?:string[], entry?:string}} args
   * @returns {Promise<object>} { ok, id, name, capabilities, enabled:false, note } | { error }
   */
  async _toolBuildPlugin(args = {}) {
    // Gate on Electron: plugin authoring needs the main-process fs IPC channels.
    if (!(typeof window !== 'undefined' && window.api && typeof window.api.invoke === 'function')) {
      return { error: 'Plugin authoring is only available in the desktop app.' }
    }

    // --- Validate the spec (name required; caps = string[]; entry = JS source). ---
    const name = String((args && args.name) || '').trim()
    if (!name) return { error: 'A plugin "name" is required.' }

    const description = String((args && args.description) || '').trim()

    const rawCaps = (args && args.capabilities) || []
    if (!Array.isArray(rawCaps)) return { error: '"capabilities" must be an array of strings.' }
    const capabilities = rawCaps
      .filter((c) => typeof c === 'string' && c.trim())
      .map((c) => c.trim())

    const entry = (args && typeof args.entry === 'string') ? args.entry : ''
    if (!entry.trim()) return { error: '"entry" must be the index.js source as a string.' }

    // --- Build the manifest (matches the frozen v1 contract the Lab emits). ---
    const id = this._slugPluginId(name)
    const manifest = {
      id,
      name,
      apiVersion: '1',
      entry: 'index.js',
      description,
      capabilities,
    }

    // Rich path (behind Features.pluginStudio): hand the spec to a real coding
    // agent inside a Plugin Studio workspace seeded with the full context bundle
    // (CAPABILITIES.md, types.d.ts, examples), let it iterate, build-check it, and
    // install it DISABLED. Returns null when Studio is off, unavailable (web), or
    // no coding agent is installed — in which case we fall through to the
    // deterministic simple scaffold below (which writes `entry` verbatim). The
    // same disabled-by-default + sensitive-cap gate applies on both paths.
    const viaStudio = await this._buildPluginViaStudio({
      id, name, description, capabilities, entry,
    })
    if (viaStudio) return viaStudio

    try {
      // Scaffold ONLY when new. Tolerate an "already exists" response exactly like
      // the Lab's writePlugin() does (a re-author overwrites the files below).
      const scaffold = await window.api.invoke('plugin:scaffold', { template: 'blank', id, name })
      if (scaffold && scaffold.ok === false && !/exist/i.test(String(scaffold.error || ''))) {
        return { error: `Scaffold failed: ${scaffold.error || 'unknown error'}` }
      }

      const writeManifest = await window.api.invoke('plugin:fs-write', {
        id, path: 'plugin.json', data: JSON.stringify(manifest, null, 2),
      })
      const writeEntry = await window.api.invoke('plugin:fs-write', {
        id, path: 'index.js', data: entry,
      })
      if ((writeManifest && writeManifest.ok === false) || (writeEntry && writeEntry.ok === false)) {
        const err = (writeManifest && writeManifest.error) || (writeEntry && writeEntry.error) || 'write failed'
        return { error: `Could not write plugin files: ${err}` }
      }
    } catch (e) {
      return { error: (e && e.message) || String(e) }
    }

    // Installed but NOT enabled — we never auto-enable, so sensitive caps stay gated.
    return {
      ok: true,
      id,
      name,
      capabilities,
      enabled: false,
      note: 'Installed disabled — review capabilities, then enable in the Plugin Lab.',
    }
  }

  /**
   * Rich `build_plugin` path: drive the Plugin Studio agent harness to author the
   * plugin, instead of writing the Brain's first-draft `entry` verbatim. Gated by
   * `Features.pluginStudio` AND the desktop Studio surface being present AND a
   * coding agent being installed; any of those missing → returns null so the
   * caller falls back to the deterministic simple scaffold.
   *
   * Every Studio module is loaded with a LAZY dynamic import on purpose: it keeps
   * Studio (and its CodeMirror-touching transitive deps) out of rag-engine.js's
   * static module graph, so the Node brain unit test — which imports this file but
   * never calls this handler — stays fast and browser-free.
   *
   * NEVER throws: an infra failure returns null (→ simple path); a ran-but-imperfect
   * build returns structured data the agent loop can relay (it does NOT silently
   * fall back, since that would overwrite the agent's work with the cruder draft).
   * @param {{id:string,name:string,description:string,capabilities:string[],entry:string}} spec
   * @returns {Promise<object|null>}
   */
  async _buildPluginViaStudio(spec) {
    const isPosInt = (n) => Number.isInteger(n) && n > 0
    const {
      name, description, capabilities, entry,
    } = spec

    let Features; let studioClient; let buildCapabilitiesMarkdown
    try {
      Features = (await import('./features.js')).Features
      studioClient = (await import('./plugins/studio/studio-client.js')).studioClient
      buildCapabilitiesMarkdown = (await import('./plugins/studio/studio-capabilities-md.js')).buildCapabilitiesMarkdown
    } catch (_e) {
      return null // Studio modules unavailable → use the simple path
    }
    if (!Features || !Features.pluginStudio || !studioClient) return null

    try {
      if (!(await studioClient.isSupported())) return null

      // Need an actually-installed coding agent; otherwise the simple path is better.
      const det = await studioClient.agentDetect()
      const providers = (det && det.ok && Array.isArray(det.providers)) ? det.providers : []
      const provider = providers.find((p) => p && p.available)
      if (!provider) return null

      // 1) Workspace seeded with the LIVE capability catalog (degrades to '' on error).
      let capsMd = ''
      try { capsMd = buildCapabilitiesMarkdown(null) || '' } catch (_e) { capsMd = '' }
      const goal = `Build a Paperus plugin "${name}" — ${description || 'no description'}. Capabilities: ${capabilities.join(', ') || '(none)'}.`
      const ws = await studioClient.createWorkspace({ goal, capabilitiesMarkdown: capsMd })
      if (!ws || !ws.ok || !isPosInt(ws.buildId)) return null
      const { buildId } = ws

      // 2) Start the coding agent in that workspace.
      const start = await studioClient.agentStart({ buildId, providerId: provider.id, goal })
      if (!start || !start.ok || !isPosInt(start.sessionId)) {
        return {
          ok: true, installed: false, buildId, via: 'studio',
          note: `Created Plugin Studio build #${buildId} but couldn't start the ${provider.label || provider.id} agent. Open Plugin Studio to finish it.`,
        }
      }
      const { sessionId } = start

      // 3) One build turn from the spec, then at most one corrective turn if the
      //    build-check (node --check + manifest validation) reports issues.
      await studioClient.agentSend(sessionId, this._studioBuildInstruction({ name, description, capabilities, entry }))
      await this._studioWaitForTurn(studioClient, sessionId, this.STUDIO_BUILD_TIMEOUT_MS)

      let check = await studioClient.buildCheck(buildId)
      let issues = (check && Array.isArray(check.errors)) ? check.errors : []
      if (issues.length) {
        await studioClient.agentSend(sessionId, `The build did not pass checks. Fix these, editing ONLY the plugin/ dir:\n\n${issues.join('\n')}`)
        await this._studioWaitForTurn(studioClient, sessionId, this.STUDIO_BUILD_TIMEOUT_MS)
        check = await studioClient.buildCheck(buildId)
        issues = (check && Array.isArray(check.errors)) ? check.errors : []
      }
      try { await studioClient.agentCancel(sessionId) } catch (_e) { /* best-effort */ }

      if (issues.length) {
        return {
          ok: true, installed: false, buildId, via: 'studio', issues,
          note: `Drafted "${name}" with a coding agent in Plugin Studio (build #${buildId}), but it didn't pass checks yet. Open Plugin Studio to finish it.`,
        }
      }

      // 4) Install DISABLED — identical gate to the simple path.
      const inst = await studioClient.installBuild(buildId)
      if (!inst || !inst.ok || !inst.id) {
        return {
          ok: true, installed: false, buildId, via: 'studio',
          note: `Built "${name}" in Plugin Studio (build #${buildId}) but install failed${inst && inst.error ? `: ${inst.error}` : ''}. Open Plugin Studio to install it.`,
        }
      }
      return {
        ok: true, id: inst.id, name, capabilities, enabled: false, via: 'studio', buildId,
        note: 'Built with a coding agent in Plugin Studio and installed DISABLED — review capabilities, then enable in the Plugin Lab.',
      }
    } catch (_e) {
      return null // any infra failure → fall back to the simple scaffold path
    }
  }

  /**
   * Compose the instruction the Studio agent receives for a build turn: the spec,
   * the deliverable contract, and (when present) the Brain's draft `entry` as a
   * starting point. Kept terse — the heavy API reference lives in the workspace's
   * CAPABILITIES.md / types.d.ts that the agent is told to read.
   */
  _studioBuildInstruction({ name, description, capabilities, entry }) {
    const caps = (capabilities || []).join(', ') || '(none)'
    return [
      'Build a Paperus plugin and write it into the plugin/ subdirectory ONLY.',
      '',
      `Name: ${name}`,
      description ? `Description: ${description}` : null,
      `Capabilities: ${caps}`,
      '',
      'Deliverables:',
      '- plugin.json with: apiVersion "1", id, name, entry "index.js", description, and exactly the capabilities listed above.',
      '- index.js exporting `export default definePlugin({ async activate(ctx) { … } })`.',
      '- It must pass `node --check` and manifest validation.',
      (capabilities || []).includes('tools')
        ? '- This is a Company Brain connector: register tools with ctx.brain.registerTool({ id, description, parameters, handler }). Handlers must return STRUCTURED data and never throw.'
        : null,
      'Read CAPABILITIES.md, types.d.ts, docs/PLUGIN_API_CONTRACT.md and examples/ in this workspace for the exact API.',
      (entry && entry.trim())
        ? `\nUse this as a STARTING POINT for index.js (correct/improve as needed):\n\n${entry}`
        : null,
    ].filter(Boolean).join('\n')
  }

  /**
   * Await one Studio agent turn: resolve on the streamed `done` event or after
   * `timeoutMs`, whichever comes first. Always unsubscribes + clears its timer.
   * Returns `{ reason:'done'|'timeout', transcript, lastError }` (collected for
   * diagnostics; the caller relies on the subsequent build-check for truth).
   */
  _studioWaitForTurn(studioClient, sessionId, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false
      let unsub = () => {}
      let timer = null
      const transcript = []
      let lastError = null
      const finish = (reason) => {
        if (settled) return
        settled = true
        try { unsub() } catch (_e) { /* noop */ }
        if (timer) clearTimeout(timer)
        resolve({ reason, transcript: transcript.join(''), lastError })
      }
      unsub = studioClient.subscribe(sessionId, (ev) => {
        if (!ev || typeof ev.type !== 'string') return
        if (ev.type === 'text' && typeof ev.text === 'string') transcript.push(ev.text)
        else if (ev.type === 'error' && typeof ev.text === 'string') lastError = ev.text
        else if (ev.type === 'done') finish('done')
      })
      timer = setTimeout(() => finish('timeout'), timeoutMs)
    })
  }

  setStatus(newStatus) {
    this.status = newStatus
    if (this.onStatusChange) {
      this.onStatusChange(newStatus)
    }
  }

  /**
   * Persistence is Electron-only: the web build is dev-only and stays purely
   * in-memory. We detect Electron by the presence of the IPC bridge AND the
   * specific brain index channels — if either is missing we behave exactly as
   * before (rebuild in memory, never load or save). `window.api.invoke` exists in
   * Electron's preload; the web mock omits the brain:index-* channels.
   */
  _canPersistIndex() {
    return !!(typeof window !== 'undefined'
      && window.api
      && typeof window.api.invoke === 'function')
  }

  /**
   * Cheap, stable, dependency-free content hash (FNV-1a, 32-bit, hex). Used only
   * to decide whether a file changed since the last index — not for security — so
   * a fast non-cryptographic hash is exactly right. Same text → same hash on every
   * launch, so an unchanged file is skipped and never re-embedded.
   */
  _hashText(text) {
    let h = 0x811c9dc5
    const s = String(text || '')
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      // FNV prime multiply, kept in 32-bit range via Math.imul.
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16)
  }

  /**
   * Load the persisted vector index for the active project root (Electron only).
   * Returns the parsed record or null. NEVER throws — a missing or corrupt index
   * file degrades silently to a full rebuild, so init can't be wedged by bad data.
   * Staleness is enforced by the caller: a `version`/`model` mismatch is discarded.
   */
  async _loadPersistedIndex() {
    if (!this._canPersistIndex() || !this.projectPath) return null
    try {
      const res = await window.api.invoke('brain:index-load', this.projectPath)
      // The main handler returns { ok, record } (or { ok:false } when absent).
      if (!res || !res.ok || !res.record) return null
      const rec = res.record
      if (!rec || typeof rec !== 'object' || !Array.isArray(rec.chunks)) return null
      return rec
    } catch (e) {
      console.warn('[RAG Engine] Persisted index load failed; rebuilding from scratch:', e && e.message)
      return null
    }
  }

  /**
   * Write the current index to <root>/.notionless/brain-index.json (Electron only).
   * The versioned record carries per-file content hashes so the next launch can
   * decide what to re-embed. NEVER throws — a failed save just means we re-embed
   * next time. No-op on the web build.
   */
  async _savePersistedIndex() {
    if (!this._canPersistIndex() || !this.projectPath) return
    try {
      const record = {
        version: this.PERSIST_VERSION,
        model: this.activeModel || null, // the embedding model the vectors came from
        builtAt: new Date().toISOString(),
        // Per-file hashes live alongside chunks (one map, not per-chunk) so the
        // skip/re-index decision is a single cheap lookup per file.
        fileHashes: Object.fromEntries(this.fileHashes),
        chunks: this.chunks.map((c) => ({
          id: c.id, docId: c.docId, filePath: c.filePath, header: c.header, text: c.text, vector: c.vector,
        })),
      }
      const res = await window.api.invoke('brain:index-save', this.projectPath, record)
      if (res && res.ok) {
        console.log(`[RAG Engine] Persisted index saved (${this.chunks.length} chunks, model: ${record.model}).`)
      } else {
        console.warn('[RAG Engine] Persisted index save was rejected:', res && res.error)
      }
    } catch (e) {
      console.warn('[RAG Engine] Persisted index save failed (will rebuild next launch):', e && e.message)
    }
  }

  /**
   * Hydrate this.chunks + this.vectorCache + this.fileHashes from a loaded record,
   * keeping ONLY files that still exist on disk. Returns the set of filePaths that
   * were hydrated so the caller can avoid re-indexing them. The vectorCache mirror
   * (declared but previously unused) is finally populated here from the stored
   * vectors so semantic search works immediately after a restart.
   */
  _hydrateFromRecord(record, existingFiles) {
    const existing = existingFiles instanceof Set ? existingFiles : new Set(existingFiles || [])
    const hydrated = new Set()
    const keptChunks = []
    const vecByFile = new Map()

    for (const c of record.chunks) {
      if (!c || !existing.has(c.filePath)) continue // drop chunks for deleted files
      keptChunks.push({ id: c.id, docId: c.docId, filePath: c.filePath, header: c.header, text: c.text, vector: c.vector })
      hydrated.add(c.filePath)
      if (c.vector) {
        if (!vecByFile.has(c.filePath)) vecByFile.set(c.filePath, [])
        vecByFile.get(c.filePath).push(c.vector)
      }
    }

    this.chunks = keptChunks
    this.vectorCache = vecByFile
    // Restore per-file hashes, but only for files we actually kept.
    this.fileHashes = new Map()
    const storedHashes = (record.fileHashes && typeof record.fileHashes === 'object') ? record.fileHashes : {}
    for (const fp of hydrated) {
      if (storedHashes[fp]) this.fileHashes.set(fp, storedHashes[fp])
    }
    return hydrated
  }

  /**
   * Scans the active project and indexes all files.
   * Completely non-blocking using asynchronous slice-batch queue processing.
   */
  async indexProject(projectPath) {
    if (!projectPath) return
    this.projectPath = projectPath
    this.setStatus('indexing')
    console.log(`[RAG Engine] Starting non-blocking index for: ${projectPath}`)

    try {
      // 1. Load the chosen backend and (for local) detect Ollama models
      await this.configureBackend()

      // 2. Fetch all Markdown/Note files recursively via native IPC
      const files = await window.api.invoke('fs:listMarkdownFilesRecursive', projectPath)
      console.log(`[RAG Engine] Found ${files.length} markdown documents to index`)

      // 3. Reset transient state. Chunks/hashes are repopulated below — either
      //    hydrated from the persisted index (incremental) or rebuilt clean.
      this.chunks = []
      this.fileHashes = new Map()
      this.vectorCache = new Map()
      this.dfMap.clear()

      // 4. Try the persistent index (Electron only). On a clean match we hydrate
      //    from disk and queue ONLY the files that changed since last launch; on a
      //    version/model mismatch (or no index) we fall back to a full rebuild.
      this.indexQueue = await this._planIncrementalQueue(files)

      // 5. Trigger non-blocking processor (it saves the index when the queue drains)
      this.processNextBatch()
    } catch (e) {
      console.error('[RAG Engine] Project indexing setup failed:', e)
      this.setStatus('error')
    }
  }

  /**
   * Decide the indexing work-set for the current run. With a usable persisted
   * index we hydrate the unchanged files from disk (no re-embed) and return only
   * the files that are new or whose content hash changed; without one (or on a
   * version/model mismatch) we return every file for a full clean rebuild.
   *
   * `this.chunks`/`this.vectorCache`/`this.fileHashes` are populated here for the
   * skipped files; the returned queue covers exactly the files that still need to
   * be (re)embedded. NEVER throws — any failure falls back to "index everything".
   * @param {string[]} files absolute paths of every markdown file on disk now
   * @returns {Promise<string[]>} files to (re)index
   */
  async _planIncrementalQueue(files) {
    const allFiles = Array.isArray(files) ? files : []

    // No persistence (web build, or first launch with no index) → full rebuild.
    const record = await this._loadPersistedIndex()
    if (!record) {
      if (this._canPersistIndex()) console.log('[RAG Engine] No reusable index on disk — building a fresh one.')
      return [...allFiles]
    }

    // Staleness guard: a different record version or a different embedding model
    // means the stored vectors are not comparable to ones we'd compute now, so we
    // throw the whole index away and rebuild clean.
    const sameVersion = record.version === this.PERSIST_VERSION
    const sameModel = (record.model || null) === (this.activeModel || null)
    if (!sameVersion || !sameModel) {
      console.log(`[RAG Engine] Stored index is stale (version ${record.version}→${this.PERSIST_VERSION}, model ${record.model}→${this.activeModel}). Full rebuild.`)
      return [...allFiles]
    }

    // Usable index: hydrate the files that still exist, then diff by content hash.
    const existing = new Set(allFiles)
    const hydrated = this._hydrateFromRecord(record, existing)

    const toIndex = []
    let reused = 0
    for (const fp of allFiles) {
      let content = ''
      try { content = await window.api.readFile(fp) } catch (_) { content = '' }
      const hash = this._hashText(content)
      const stored = hydrated.has(fp) ? this.fileHashes.get(fp) : null
      // Unchanged AND we actually have chunks hydrated for it → keep as-is.
      if (stored && stored === hash) {
        this.fileHashes.set(fp, hash)
        reused++
        continue
      }
      // New or changed → drop any stale hydrated chunks and queue a re-embed.
      this.removeFileFromIndex(fp)
      this.fileHashes.delete(fp)
      toIndex.push(fp)
    }

    console.log(`[RAG Engine] Incremental index: reused ${reused} unchanged file(s) from disk, re-indexing ${toIndex.length}.`)
    return toIndex
  }

  /**
   * Helper to query Ollama service and find available embedding and generative models.
   * Gracefully degrades searchMode to 'tfidf' if Ollama is offline or unavailable.
   */
  async detectOllamaModels() {
    try {
      const response = await window.api.invoke('ai:ollama-request', {
        path: '/api/tags',
        method: 'GET'
      })

      if (response && response.ok && response.data && Array.isArray(response.data.models)) {
        const models = response.data.models.map(m => m.name)
        console.log('[RAG Engine] Available Ollama models:', models)

        // Find best embedding model (explicitly containing 'embed' or 'mxbai')
        const embeddingModel = models.find(m => m.toLowerCase().includes('embed') || m.toLowerCase().includes('mxbai'))
        
        if (embeddingModel) {
          this.activeModel = embeddingModel
          this.searchMode = 'hybrid'
          console.log(`[RAG Engine] Dedicated embedding model found: ${this.activeModel}. Running in Hybrid mode.`)
        } else {
          console.warn('[RAG Engine] No dedicated embedding model found (e.g. nomic-embed-text). Switching strictly to TF-IDF mode.')
          this.activeModel = null
          this.searchMode = 'tfidf'
        }

        // Find best LLM model (non-embed, non-mxbai). A user pick (localModel)
        // always wins over the auto-detected default.
        if (this.localModel) {
          this.llmModel = this.localModel
        } else {
          const llm = models.find(m => !m.toLowerCase().includes('embed') && !m.toLowerCase().includes('mxbai'))
          if (llm) {
            this.llmModel = llm
          } else {
            this.llmModel = models[0] || 'llama3'
          }
        }

        console.log(`[RAG Engine] Active LLM Model: ${this.llmModel}, Search Mode: ${this.searchMode}`)
      } else {
        console.warn('[RAG Engine] Ollama `/api/tags` returned invalid response. Defaulting to TF-IDF mode.')
        this.searchMode = 'tfidf'
      }
    } catch (e) {
      console.warn('[RAG Engine] Ollama connection failed. Running in Offline TF-IDF keyword-only mode:', e.message)
      this.searchMode = 'tfidf'
    }
  }

  /**
   * Loads the user's chosen answer backend, then prepares retrieval. Local mode
   * can do semantic (embedding) search via Ollama; API / Claude Code modes use
   * keyword (TF-IDF) retrieval, which needs no embedding service and works offline.
   */
  async configureBackend() {
    await this.loadAIConfig()
    if (this.aiMode === 'local') {
      await this.detectOllamaModels()
    } else {
      this.searchMode = 'tfidf'
      this.activeModel = null
    }
  }

  /** Reads the Brain's saved AI settings (non-secret). The key is loaded separately. */
  async loadAIConfig() {
    try {
      const raw = (window.api && window.api.getSettings) ? await window.api.getSettings('brain_ai') : null
      const cfg = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}
      this.aiMode = cfg.mode || 'local'
      this.apiEndpoint = cfg.endpoint || ''
      this.apiModel = cfg.model || ''
      this.claudeModel = cfg.claudeModel || ''
      this.cliCmd = cfg.cliCmd || ''
      this.cliPromptFlag = cfg.cliPromptFlag || '-p'
      this.localModel = cfg.localModel || ''
      this.cliModel = cfg.cliModel || ''
      this.cliModelFlag = cfg.cliModelFlag || ''
      this.modelEffort = cfg.effort || ''
      this.claudeResolved = (cfg.claudeResolved && typeof cfg.claudeResolved === 'object') ? cfg.claudeResolved : {}
      this._provider = cfg.provider || ''
      // A user-chosen local model wins over the auto-detected one.
      if (this.localModel) this.llmModel = this.localModel
    } catch (e) {
      this.aiMode = 'local'
    }
  }

  // ── In-composer model picker ────────────────────────────────────────────────

  /**
   * The models offered for the *active* backend, agent-aware:
   *   - local       → models installed in Ollama (live `/api/tags`)
   *   - api         → the provider's live `/models` list ∪ curated suggestions
   *   - claude-code → Claude aliases (opus/sonnet/haiku) — rides the Claude sign-in
   *   - cli         → the agent's known models (Gemini, Cursor, …), if any
   * Returns { backend, current, models:[{id,label}], allowCustom }. `allowCustom`
   * means the user may type any model name; the lists are only suggestions.
   */
  async listModels() {
    const m = this.aiMode
    let info
    if (m === 'local') {
      const names = await this._ollamaModelNames().catch(() => [])
      info = {
        backend: 'local',
        current: this.localModel || this.llmModel || '',
        models: names.map((n) => ({ id: n, label: n })),
        allowCustom: false,
        note: names.length ? 'Installed in Ollama on this computer' : 'No Ollama models found',
      }
    } else if (m === 'api') {
      const live = await this._apiModelNames().catch(() => [])
      const curated = API_MODELS[this._provider] || []
      const ids = Array.from(new Set([...(live || []), ...curated]))
      info = {
        backend: 'api',
        current: this.apiModel || '',
        models: ids.map((n) => ({ id: n, label: n })),
        allowCustom: true,
        note: `${this.providerName()} · ${(live && live.length) ? `${live.length} live` : 'suggested'}`,
      }
    } else if (m === 'claude-code') {
      info = {
        backend: 'claude-code',
        current: this.claudeModel || '',
        models: CLAUDE_MODELS.slice(),
        allowCustom: true,
        note: 'Claude Code',
      }
    } else if (m === 'cli') {
      info = {
        backend: 'cli',
        current: this.cliModel || '',
        models: (CLI_MODELS[this.cliCmd] || []).slice(),
        allowCustom: true,
        note: this.cliCmd || 'Coding agent',
      }
    } else {
      info = { backend: m, current: '', models: [], allowCustom: false }
    }
    // Decorate every entry with a brand logo, a tier hint, and effort capability,
    // then attach the current model's effort state for the picker's effort row.
    info.models = (info.models || []).map((e) => this._enrichModel(e, info.backend))
    // For Claude Code, replace the generic tier with the EXACT model id once the
    // real agent has told us (alias → 'claude-opus-4-8'), so versions are true.
    if (info.backend === 'claude-code') {
      info.models = info.models.map((mm) => {
        const exact = this.claudeResolved[mm.id || 'default']
        return exact ? { ...mm, desc: exact, exact } : mm
      })
    }
    // Effort is wired on the api backend (reasoning_effort) and Claude Code
    // (--effort). Claude's effort is session-level, so it applies to any model.
    info.effortApplies = info.backend === 'api' || info.backend === 'claude-code'
    if (info.backend === 'claude-code') {
      info.efforts = CLAUDE_EFFORTS.slice()
    } else {
      const cur = info.models.find((x) => x.id === info.current)
      info.efforts = cur ? cur.efforts : modelEffortLevels(info.current)
    }
    info.currentEffort = this.modelEffort || ''
    return info
  }

  /** Decorate a model entry ({id,label?,desc?}) with service/tier/effort metadata. */
  _enrichModel(entry, backend) {
    const id = typeof entry === 'string' ? entry : (entry.id || '')
    const label = (entry && entry.label) || this._prettyModel(id)
    const desc = (entry && entry.desc) || modelTier(id)
    return {
      id,
      label,
      desc,
      service: modelService(id) || this._backendLogoKind(backend),
      efforts: modelEffortLevels(id),
    }
  }

  /** Default service-logo kind for a backend when a model id reveals no brand. */
  _backendLogoKind(backend) {
    if (backend === 'local') return 'ollama'
    if (backend === 'claude-code') return 'claude'
    if (backend === 'cli') return this.cliCmd === 'gemini' ? 'gemini' : 'agent'
    if (backend === 'api') return ({ openai: 'openai', anthropic: 'claude', gemini: 'gemini', openrouter: 'openrouter' })[this._provider] || 'service'
    return 'service'
  }

  /** Light cleanup of a raw model id for display (keeps it recognizable). */
  _prettyModel(id) {
    if (!id) return 'Default'
    const s = String(id)
    return s.includes('/') ? s.split('/').pop() : s
  }

  providerName() {
    const p = this._provider
    const labels = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', openrouter: 'OpenRouter', custom: 'Custom API' }
    return labels[p] || 'AI service'
  }

  /** Set the active backend's model and persist it (merges into `brain_ai`). */
  async setActiveModel(id) {
    const model = String(id || '').trim()
    const m = this.aiMode
    if (m === 'local') { this.localModel = model; if (model) this.llmModel = model; await this._persistConfigPatch({ localModel: model }) }
    else if (m === 'api') { this.apiModel = model; await this._persistConfigPatch({ model }) }
    else if (m === 'claude-code') { this.claudeModel = model; await this._persistConfigPatch({ claudeModel: model }) }
    else if (m === 'cli') {
      this.cliModel = model
      this.cliModelFlag = CLI_MODEL_FLAG[this.cliCmd] || '-m'
      await this._persistConfigPatch({ cliModel: model, cliModelFlag: this.cliModelFlag })
    }
  }

  /** Set + persist the reasoning effort ('' clears it). */
  async setModelEffort(level) {
    this.modelEffort = String(level || '').trim()
    await this._persistConfigPatch({ effort: this.modelEffort })
  }

  /**
   * Extra request fields for the OpenAI-compatible `api` backend. Adds
   * `reasoning_effort` when the active model supports it and the user picked a
   * level — providers that don't reason simply ignore the field.
   */
  _apiExtra() {
    const lv = (this.modelEffort || '').trim()
    if (this.aiMode !== 'api' || !lv) return {}
    if (!modelEffortLevels(this.apiModel).includes(lv)) return {}
    return { reasoning_effort: lv }
  }

  /** The effort to pass to `claude --effort`, if it's a valid Claude level. */
  _claudeEffort() {
    const lv = (this.modelEffort || '').trim()
    return CLAUDE_EFFORTS.includes(lv) ? lv : ''
  }

  /**
   * Record the exact model id + token usage reported by Claude Code's JSON
   * envelope. Maps the chosen alias → the real id ('opus' → 'claude-opus-4-8')
   * and persists it so the picker shows true versions, even across restarts.
   */
  _recordClaudeResult(res) {
    if (!res || !res.model) return
    this.lastUsage = {
      model: res.model,
      input: res.usage && res.usage.input,
      output: res.usage && res.usage.output,
      costUSD: res.costUSD,
      contextWindow: res.contextWindow,
      maxOutputTokens: res.maxOutputTokens,
    }
    const alias = this.claudeModel || 'default'
    if (this.claudeResolved[alias] !== res.model) {
      this.claudeResolved = { ...this.claudeResolved, [alias]: res.model }
      this._persistConfigPatch({ claudeResolved: this.claudeResolved })
    }
  }

  /** Merge a patch into the saved `brain_ai` settings without disturbing the rest. */
  async _persistConfigPatch(patch) {
    try {
      if (!(window.api && window.api.getSettings && window.api.setSettings)) return
      const raw = await window.api.getSettings('brain_ai')
      const cfg = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}
      await window.api.setSettings('brain_ai', JSON.stringify({ ...cfg, ...patch }))
    } catch (_) { /* best-effort */ }
  }

  /** Non-embedding models installed in Ollama (for the local picker). */
  async _ollamaModelNames() {
    const res = await window.api.invoke('ai:ollama-request', { path: '/api/tags', method: 'GET' })
    if (!(res && res.ok && res.data && Array.isArray(res.data.models))) return []
    return res.data.models
      .map((x) => x.name)
      .filter((n) => n && !n.toLowerCase().includes('embed') && !n.toLowerCase().includes('mxbai'))
  }

  /** Best-effort live model list from an OpenAI-compatible `/models` endpoint. */
  async _apiModelNames() {
    const endpoint = (this.apiEndpoint || '').trim()
    if (!endpoint) return []
    const base = endpoint.replace(/\/chat\/completions.*$/i, '').replace(/\/+$/, '')
    const key = await this._loadApiKey()
    const res = await fetch(`${base}/models`, {
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    if (!res.ok) return []
    const j = await res.json().catch(() => ({}))
    const arr = j.data || j.models || []
    return arr.map((x) => x.id || x.name).filter(Boolean)
  }

  /** Loads the API key (OS keychain first, settings fallback for web). */
  async _loadApiKey() {
    try {
      if (window.api && window.api.invoke) {
        const v = await window.api.invoke('auth:secure-load', 'brain_api_key')
        if (v) return v
      }
    } catch (_) { /* fall through */ }
    try {
      const raw = await window.api.getSettings('brain_ai')
      const cfg = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}
      return cfg.apiKey || ''
    } catch (_) { return '' }
  }

  /**
   * Generation via a user-configured OpenAI-compatible Chat Completions endpoint
   * (OpenAI, OpenRouter, Anthropic/Gemini compat layers, LM Studio, …). Streams
   * tokens as they arrive.
   */
  async _generateApi(systemPrompt, query, onToken, onComplete, citations) {
    const key = await this._loadApiKey()
    const endpoint = (this.apiEndpoint || '').trim()
    if (!endpoint) throw new Error('No AI endpoint is set. Open Brain settings and pick a provider.')

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        // Some providers (Anthropic compat) want this to allow browser calls.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.apiModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        stream: true,
        ...this._apiExtra(),
      }),
    })

    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '')
      throw new Error(`Provider returned ${res.status}. ${t.slice(0, 180)}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let acc = ''
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        const s = line.trim()
        if (!s || !s.startsWith('data:')) continue
        const data = s.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const j = JSON.parse(data)
          const tok = j.choices?.[0]?.delta?.content || ''
          if (tok) { acc += tok; onToken(tok) }
        } catch (_) { /* ignore partial frames */ }
      }
    }
    if (onComplete) onComplete(acc, citations)
  }

  /**
   * Generation via the user's installed Claude Code CLI (no API key — uses their
   * existing Claude Code auth). Runs in the main process; returns the full answer.
   */
  async _generateClaudeCode(systemPrompt, query, onToken, onComplete, citations) {
    const prompt = `${systemPrompt}\n\n----\nUser question: ${query}`
    const res = await window.api.invoke('ai:claude-code', {
      prompt,
      model: this.claudeModel || undefined,
      effort: this._claudeEffort() || undefined,
    })
    if (!res || !res.ok) throw new Error(res?.error || 'Claude Code did not respond.')
    this._recordClaudeResult(res)
    const text = res.text || ''
    onToken(text)
    if (onComplete) onComplete(text, citations)
  }

  /**
   * Generation via any other installed coding-agent CLI (Gemini, Cursor Agent,
   * etc.) driven generically: the main process runs `<cliCmd> <cliPromptFlag>
   * "<prompt>"` and returns stdout. No API key — it rides the agent's own sign-in.
   */
  async _generateCli(systemPrompt, query, onToken, onComplete, citations) {
    const prompt = `${systemPrompt}\n\n----\nUser question: ${query}`
    const res = await window.api.invoke('ai:cli-run', {
      cmd: this.cliCmd,
      promptFlag: this.cliPromptFlag || '-p',
      prompt,
      ...this._cliModelArgs(),
    })
    if (!res || !res.ok) throw new Error(res?.error || `${this.cliCmd || 'The coding agent'} did not respond.`)
    const text = res.text || ''
    onToken(text)
    if (onComplete) onComplete(text, citations)
  }

  /** Model args for `ai:cli-run` when the user has picked a CLI model (else none). */
  _cliModelArgs() {
    if (!this.cliModel) return {}
    return { model: this.cliModel, modelFlag: this.cliModelFlag || CLI_MODEL_FLAG[this.cliCmd] || '-m' }
  }

  /** Mode-aware, friendly error text shown in the chat when generation fails. */
  _friendlyError(e) {
    const detail = e?.message ? `\n\n_${e.message}_` : ''
    if (this.aiMode === 'api') {
      return `I couldn't reach your AI provider. Double-check the key and model in Brain settings (the gear, top-right).${detail}`
    }
    if (this.aiMode === 'claude-code') {
      return `I couldn't run Claude Code. Make sure it's installed and you're signed in (\`claude\` in a terminal should work).${detail}`
    }
    if (this.aiMode === 'cli') {
      return `I couldn't run ${this.cliCmd || 'the coding agent'}. Make sure it's installed and signed in (\`${this.cliCmd || 'the command'}\` should work in a terminal).${detail}`
    }
    return `I couldn't reach the local AI. Make sure Ollama is running (open the Ollama app), then try again.${detail}`
  }

  /**
   * Process indexQueue in small batches using setTimeout loops
   * to ensure zero UI rendering blocks or thread freezes.
   */
  async processNextBatch() {
    if (this.indexQueue.length === 0) {
      this.isProcessingQueue = false
      this.buildTFIDFGlobalDF()
      this.setStatus('ready')
      console.log(`[RAG Engine] Indexing complete. Active chunks: ${this.chunks.length}. Mode: ${this.searchMode}`)
      // Persist the finished index so the next launch hydrates from disk instead
      // of re-embedding everything. No-op on the web build; never throws.
      this._indexHydrated = true
      this._savePersistedIndex()
      return
    }

    this.isProcessingQueue = true
    const batchSize = 3 // small batch size to maintain absolute high-speed UI framing
    const batch = this.indexQueue.splice(0, batchSize)

    for (const filePath of batch) {
      try {
        await this.indexFile(filePath)
      } catch (e) {
        console.error(`[RAG Engine] Failed to index file: ${filePath}`, e)
      }
    }

    // Yield control to UI thread before scheduling next batch
    setTimeout(() => this.processNextBatch(), 20)
  }

  /**
   * Chunks and indexes a single document.
   * Resolves stable UUID (docId) using ManifestManager via native IPC.
   */
  async indexFile(filePath) {
    if (!filePath) return

    // Resolve docId
    const docId = await window.api.invoke('fs:getDocId', filePath)
    if (!docId) return

    // Read file contents
    const content = await window.api.readFile(filePath)
    if (!content || content.trim().length === 0) {
      // Remove any existing chunks if file is cleared
      this.removeFileFromIndex(filePath)
      return
    }

    // 1. Chunk document
    const fileChunks = this.splitMarkdown(content, docId, filePath)

    // 2. Clear existing chunks for this specific file path to enable safe
    //    re-indexing. This also clears the old hash/vectors, so we (re)record the
    //    content hash AFTER, ensuring the next launch can detect changes.
    this.removeFileFromIndex(filePath)
    this.fileHashes.set(filePath, this._hashText(content))

    // 3. Compute Embeddings if model is online
    if (this.searchMode === 'hybrid') {
      try {
        const texts = fileChunks.map(c => c.text)
        // Call Ollama /api/embed
        const embedResponse = await window.api.invoke('ai:ollama-request', {
          path: '/api/embed',
          method: 'POST',
          body: {
            model: this.activeModel,
            input: texts
          }
        })

        if (embedResponse && embedResponse.ok && embedResponse.data && Array.isArray(embedResponse.data.embeddings)) {
          embedResponse.data.embeddings.forEach((embedding, idx) => {
            if (fileChunks[idx]) {
              fileChunks[idx].vector = embedding
            }
          })
        } else {
          console.warn(`[RAG Engine] Embedding call failed for ${filePath}. Downgrading file to TF-IDF.`)
        }
      } catch (e) {
        console.warn(`[RAG Engine] Ollama offline during indexing of ${filePath}. Using TF-IDF fallback.`)
      }
    }

    // 4. Add new chunks to active index
    this.chunks.push(...fileChunks)

    // 5. Mirror this file's freshly-computed vectors into the in-memory cache so
    //    it always reflects the live index (and matches what gets persisted).
    const vecs = fileChunks.map((c) => c.vector).filter(Boolean)
    if (vecs.length) this.vectorCache.set(filePath, vecs)
    else this.vectorCache.delete(filePath)
  }

  /**
   * Removes all chunks associated with a specific file path from the index,
   * plus its mirrored vectors and content hash so the file is fully forgotten.
   */
  removeFileFromIndex(filePath) {
    this.chunks = this.chunks.filter(c => c.filePath !== filePath)
    this.vectorCache.delete(filePath)
    this.fileHashes.delete(filePath)
  }

  /**
   * Helper to parse Markdown documents into semantic segments.
   * Splits based on header tokens (# Heading) and keeps a max character size limit.
   */
  splitMarkdown(content, docId, filePath) {
    const lines = content.split('\n')
    const chunks = []
    let currentHeader = 'Introduction'
    let currentLines = []
    let currentLength = 0
    let chunkIdx = 0

    const saveChunk = (text) => {
      const trimmed = text.trim()
      if (trimmed.length < 30) return // skip micro-snippets that carry no context

      chunks.push({
        id: `${docId}_${chunkIdx++}`,
        docId,
        filePath,
        header: currentHeader,
        text: trimmed,
        vector: null
      })
    }

    for (const line of lines) {
      // Regex header detection
      const headerMatch = line.match(/^(#{1,6})\s+(.*)$/)
      if (headerMatch) {
        if (currentLines.length > 0) {
          saveChunk(currentLines.join('\n'))
          currentLines = []
          currentLength = 0
        }
        currentHeader = headerMatch[2].trim()
        continue
      }

      currentLines.push(line)
      currentLength += line.length + 1

      // Hard block limits to avoid overly massive chunks
      if (currentLength >= 1000) {
        saveChunk(currentLines.join('\n'))
        currentLines = []
        currentLength = 0
      }
    }

    if (currentLines.length > 0) {
      saveChunk(currentLines.join('\n'))
    }

    return chunks
  }

  /**
   * Clean Tokenizer: lowercases, strips punctuation, removes stopwords.
   */
  tokenize(text) {
    if (!text) return []
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // remove punctuation
      .split(/[\s_]+/)
      .filter(token => token.length > 1 && !STOP_WORDS.has(token))
  }

  /**
   * Compiles the global Document Frequency (DF) map used for TF-IDF calculations.
   */
  buildTFIDFGlobalDF() {
    this.dfMap.clear()
    for (const chunk of this.chunks) {
      const tokens = new Set(this.tokenize(chunk.text))
      for (const token of tokens) {
        this.dfMap.set(token, (this.dfMap.get(token) || 0) + 1)
      }
    }
  }

  /**
   * Calculates TF-IDF relevance score for a given document chunk.
   */
  scoreTFIDF(tokens, chunk) {
    const chunkTokens = this.tokenize(chunk.text)
    if (chunkTokens.length === 0) return 0

    // Compute Term Frequencies in this chunk
    const tfMap = new Map()
    for (const token of chunkTokens) {
      tfMap.set(token, (tfMap.get(token) || 0) + 1)
    }

    let score = 0
    const totalChunks = this.chunks.length

    for (const token of tokens) {
      if (tfMap.has(token)) {
        const tf = tfMap.get(token) / chunkTokens.length
        const df = this.dfMap.get(token) || 1
        const idf = Math.log(1 + totalChunks / df)
        score += tf * idf
      }
    }

    return score
  }

  /**
   * Cosine Similarity calculation between two dense vectors.
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0
    let dotProduct = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i]
      normA += vecA[i] * vecA[i]
      normB += vecB[i] * vecB[i]
    }
    if (normA === 0 || normB === 0) return 0
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  /**
   * Fetches top-K relevant chunks matching a natural query.
   * Utilizes hybrid similarity reranking (Semantic Vector + TF-IDF Keyword matching).
   */
  async retrieveRelevantChunks(query, k = 4) {
    if (!query || this.chunks.length === 0) return []
    const tokens = this.tokenize(query)

    // Calculate baseline TF-IDF scores for all chunks
    const tfidfScores = new Map()
    for (const chunk of this.chunks) {
      tfidfScores.set(chunk.id, this.scoreTFIDF(tokens, chunk))
    }

    // 1. Keyword-only mode if Vector Search is offline
    if (this.searchMode === 'tfidf') {
      return [...this.chunks]
        .map(chunk => ({
          chunk,
          score: tfidfScores.get(chunk.id) || 0
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(item => item.chunk)
    }

    // 2. Hybrid Search (Dense Cosine Similarity + TF-IDF Keyword Match)
    try {
      // Fetch query vector
      const embedResponse = await window.api.invoke('ai:ollama-request', {
        path: '/api/embed',
        method: 'POST',
        body: {
          model: this.activeModel,
          input: query
        }
      })

      if (embedResponse && embedResponse.ok && embedResponse.data && Array.isArray(embedResponse.data.embeddings)) {
        const queryVector = embedResponse.data.embeddings[0]
        
        const scoredChunks = this.chunks.map(chunk => {
          let vectorScore = 0
          if (chunk.vector) {
            vectorScore = this.cosineSimilarity(queryVector, chunk.vector)
          }

          const keywordScore = tfidfScores.get(chunk.id) || 0
          
          // Hybrid search balance weight
          // 85% Semantic vector similarity + 15% keyword text mapping
          const hybridScore = (vectorScore * 0.85) + (keywordScore * 0.15)

          return { chunk, score: hybridScore }
        })

        return scoredChunks
          .sort((a, b) => b.score - a.score)
          .slice(0, k)
          .map(item => item.chunk)
      }
    } catch (e) {
      console.warn('[RAG Engine] Hybrid query failed. Falling back strictly to TF-IDF results:', e.message)
    }

    // Fallback to TF-IDF on vector retrieval failure
    return [...this.chunks]
      .map(chunk => ({
        chunk,
        score: tfidfScores.get(chunk.id) || 0
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(item => item.chunk)
  }

  /**
   * Watcher hook: adds or re-indexes a file dynamically when watcher fires a change event.
   */
  async handleFileChanged(filePath) {
    if (!this.projectPath || !filePath.startsWith(this.projectPath)) return
    console.log(`[RAG Engine] File watcher update detected for: ${filePath}`)
    try {
      await this.indexFile(filePath)
      this.buildTFIDFGlobalDF()
      console.log(`[RAG Engine] Dynamic indexing successfully completed for: ${filePath}`)
      // Persist the single-file update so a relaunch sees it without re-embedding.
      this._savePersistedIndex()
    } catch (e) {
      console.error('[RAG Engine] Dynamic indexing failed:', e)
    }
  }

  /**
   * Streams a natural answer to a RAG query word-by-word.
   * Compiles top-K context blocks, builds a secure system template, and calls the Ollama completion pipeline.
   *
   * @param {string} query - The prompt query
   * @param {function} onTokenCallback - Stream callback invoked per word chunk `(textToken)`
   * @param {function} onCompleteCallback - Invoked on end of stream, returning completed text and absolute citations `(fullText, citations)`
   */
  async askBrain(query, onTokenCallback, onCompleteCallback, history = [], onToolCallback = null, images = []) {
    try {
      // 1. Only short-circuit to a literal file LISTING when the user explicitly
      // wants the inventory ("list/show my files", "what docs do we have",
      // "which files are indexed"). Content questions about the docs ("what do
      // these docs do?", "summarize the notes", "what do they cover") must fall
      // through to the configured LLM backend — otherwise the backend looks dead.
      const q = query.trim()
      const D = '(docs?|files?|notes?|pages?|documents?|notebooks?)'
      const isListFilesQuery =
        new RegExp(`\\b(list|show me|show all|show my|display|enumerate)\\b.*\\b${D}\\b`, 'i').test(q)
        || new RegExp(`\\b(what|which|how many)\\b.*\\b${D}\\b.*\\b(have|here|there|loaded|indexed|available|exist|present|got|stored)\\b`, 'i').test(q)
        || new RegExp(`\\b${D}\\b.*\\b(do (i|we) have|are (here|there|loaded|indexed|available))\\b`, 'i').test(q)
        || new RegExp(`^\\s*${D}\\s*\\??\\s*$`, 'i').test(q)

      if (isListFilesQuery && this.chunks.length > 0) {
        // Collect all unique file paths from chunks
        const uniqueFiles = Array.from(new Set(this.chunks.map(c => c.filePath)))
        
        let filesMarkdown = `I have successfully scanned and indexed your workspace! Here is the complete list of documents currently under my secure local management:\n\n`
        
        uniqueFiles.forEach(file => {
          const relPath = this.getRelativePath(file)
          const cleanName = relPath.replace('.md', '').replace(/_/g, ' ')
          const chunkCount = this.chunks.filter(c => c.filePath === file).length
          filesMarkdown += `* **[${cleanName}](file://${file})** \`(${chunkCount} sections indexed)\`\n`
        })
        
        filesMarkdown += `\nFeel free to ask me any specific questions about the contents of these files!`
        
        onTokenCallback(filesMarkdown)
        if (onCompleteCallback) onCompleteCallback(filesMarkdown, [])
        return
      }

      // 2. Everything else → the agentic Brain. It gets grounded workspace
      // context up front (inventory + relevant excerpts + intro sections for
      // follow-ups), the recent conversation (so "these"/"them" resolve), AND a
      // set of tools (list/search/read/outline) it can call to pull more. No more
      // canned "I couldn't find anything" dead-ends — if grounding is thin, the
      // model is told to USE the tools instead of giving up.
      await this._agentAnswer({
        query: q,
        history: Array.isArray(history) ? history : [],
        onToken: onTokenCallback,
        onComplete: onCompleteCallback,
        onTool: typeof onToolCallback === 'function' ? onToolCallback : null,
        images: Array.isArray(images) ? images : [],
      })
    } catch (e) {
      console.error('[RAG Engine] Ask brain failed:', e)
      onTokenCallback(this._friendlyError(e))
      if (onCompleteCallback) onCompleteCallback('', [])
    }
  }

  /* ===================================================================== *
   * Agentic Brain: tools + a bounded tool-use loop over ANY backend.
   *
   * The loop is model-agnostic (a tiny JSON protocol) so it works the same on
   * Claude Code, a generic CLI agent, an OpenAI-compatible API, or local Ollama.
   * Tools are READ-ONLY over the local index + files, so the Brain can never
   * mutate the user's notes.
   * ===================================================================== */

  /** Human-readable tool catalogue injected into the system prompt (registry-driven). */
  _toolCatalog() {
    return Array.from(this.toolRegistry.values())
      .filter((t) => this._groupEnabled(t.group))
      .map((t) => {
        const params = (t.parameters && Object.keys(t.parameters).length)
          ? ` ${JSON.stringify(t.parameters)}`
          : ''
        const src = t.source && t.source !== 'builtin' ? ` (via ${t.source})` : ''
        return `- ${t.id}${params} — ${t.description}${src}`
      }).join('\n')
  }

  /** Tool ids the active agent may actually call (respects enabledToolGroups). */
  _enabledToolIds() {
    return Array.from(this.toolRegistry.values())
      .filter((t) => this._groupEnabled(t.group))
      .map((t) => t.id)
  }

  /** All unique indexed document paths. */
  _docPaths() {
    return Array.from(new Set(this.chunks.map((c) => c.filePath)))
  }

  /** Pretty doc name from a path. */
  _docName(filePath) {
    return this.getRelativePath(filePath).replace(/\.md$/i, '').replace(/_/g, ' ')
  }

  /** Fuzzy-resolve a free-text name/title/path to an indexed document path. */
  _resolveDocPath(q) {
    if (!q) return null
    const files = this._docPaths()
    if (files.includes(q)) return q
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
    const nq = norm(q)
    if (!nq) return null
    return (
      files.find((f) => norm(this.getRelativePath(f)) === nq)
      || files.find((f) => norm(this._docName(f)) === nq)
      || files.find((f) => norm(this.getRelativePath(f)).includes(nq))
      || files.find((f) => norm(f).includes(nq))
      || files.find((f) => nq.includes(norm(this._docName(f))) && norm(this._docName(f)).length > 4)
      || null
    )
  }

  _toolListDocuments() {
    const files = this._docPaths()
    return {
      count: files.length,
      documents: files.map((f) => ({
        name: this._docName(f),
        path: this.getRelativePath(f),
        sections: this.chunks.filter((c) => c.filePath === f).length,
      })),
    }
  }

  async _toolSearch(args = {}) {
    const k = Math.min(Math.max(parseInt(args.k, 10) || 5, 1), 10)
    const chunks = await this.retrieveRelevantChunks(String(args.query || ''), k)
    return {
      matches: chunks.map((c) => ({
        file: this.getRelativePath(c.filePath),
        section: c.header,
        snippet: String(c.text || '').slice(0, 700),
      })),
      _cite: chunks.map((c) => ({ filePath: c.filePath, header: c.header })),
    }
  }

  async _toolReadDocument(args = {}) {
    const target = this._resolveDocPath(args.path || args.name || args.file || args.title || '')
    if (!target) {
      return {
        error: 'No document matches that name.',
        available: this._toolListDocuments().documents.map((d) => d.name),
      }
    }
    let content = ''
    try {
      if (window.api && typeof window.api.readFile === 'function') {
        content = await window.api.readFile(target)
      }
    } catch (_) { /* fall through to reconstruction */ }
    if (!content) {
      content = this.chunks
        .filter((c) => c.filePath === target)
        .map((c) => (c.header ? `## ${c.header}\n` : '') + c.text)
        .join('\n\n')
    }
    return {
      file: this.getRelativePath(target),
      content: String(content || '').slice(0, 16000),
      _cite: [{ filePath: target, header: '' }],
    }
  }

  _toolGetOutline(args = {}) {
    const target = this._resolveDocPath(args.path || args.name || args.title || '')
    if (!target) return { error: 'No document matches that name.' }
    return {
      file: this.getRelativePath(target),
      headers: this.chunks.filter((c) => c.filePath === target).map((c) => c.header).filter(Boolean),
      _cite: [{ filePath: target, header: '' }],
    }
  }

  /**
   * Answer "what changed / what did I work on recently?" by ranking the indexed
   * notes on filesystem modification time (newest first). This is the recency
   * primitive the Brain was missing: it lists the freshly-touched files + how long
   * ago, and the agent loop is told (via the tool note) to read_document the top
   * entries to summarize the ACTUAL edits. Electron-only for real mtimes; without
   * the fs bridge it degrades to the indexed-doc list with unknown timestamps.
   * @param {{limit?:number, days?:number}} args
   * @returns {Promise<object>} { count, asOf, changes:[{name,path,modified,ago}], note }
   */
  async _toolRecentChanges(args = {}) {
    const limit = Math.min(Math.max(parseInt(args.limit, 10) || 10, 1), 50)
    const days = (args && args.days != null) ? Math.max(parseInt(args.days, 10) || 0, 0) : 0
    const files = this._docPaths()
    if (!files.length) return { count: 0, changes: [], note: 'No documents are indexed yet.' }
    const canStat = (typeof window !== 'undefined' && window.api && typeof window.api.invoke === 'function')
    const now = Date.now()
    const rows = []
    for (const f of files) {
      let mtimeMs = 0
      if (canStat) {
        try {
          const st = await window.api.invoke('fs:stat', f)
          mtimeMs = (st && (st.mtimeMs || (st.mtime ? new Date(st.mtime).getTime() : 0))) || 0
        } catch (_) { mtimeMs = 0 }
      }
      rows.push({ path: f, mtimeMs })
    }
    // Newest first; files we couldn't stat (mtimeMs 0) sink to the bottom.
    rows.sort((a, b) => b.mtimeMs - a.mtimeMs)
    let picked = rows
    if (days > 0) {
      const cutoff = now - days * 86400000
      const within = rows.filter((r) => r.mtimeMs >= cutoff)
      if (within.length) picked = within // ignore the window if it would hide everything
    }
    picked = picked.slice(0, limit)
    return {
      count: picked.length,
      asOf: new Date(now).toISOString(),
      changes: picked.map((r) => ({
        name: this._docName(r.path),
        path: this.getRelativePath(r.path),
        modified: r.mtimeMs ? new Date(r.mtimeMs).toISOString() : null,
        ago: r.mtimeMs ? this._humanAgo(now - r.mtimeMs) : 'unknown',
      })),
      note: 'These are file modification times. To summarize WHAT changed, call read_document on the top entries.',
      _cite: picked.map((r) => ({ filePath: r.path, header: '' })),
    }
  }

  /** Compact "N units ago" from a millisecond delta (coarsens as it grows). */
  _humanAgo(ms) {
    const s = Math.max(Math.floor(ms / 1000), 0)
    if (s < 60) return 'just now'
    const m = Math.floor(s / 60); if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
    const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
    const d = Math.floor(h / 24); if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`
    const w = Math.floor(d / 7); if (w < 5) return `${w} week${w === 1 ? '' : 's'} ago`
    const mo = Math.floor(d / 30); if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
    const y = Math.floor(d / 365); return `${y} year${y === 1 ? '' : 's'} ago`
  }

  /** Dispatch a tool call via the registry. Always resolves (errors are returned, not thrown). */
  async runTool(name, args) {
    const tool = this.toolRegistry.get(name)
    if (!tool) {
      return { error: `Unknown tool "${name}".`, _available: this._enabledToolIds() }
    }
    if (!this._groupEnabled(tool.group)) {
      return { error: `Tool "${name}" is not enabled for this agent.`, _available: this._enabledToolIds() }
    }
    try {
      return await tool.handler(args || {})
    } catch (e) {
      return { error: (e && e.message) || String(e) }
    }
  }

  /** Parse a model turn into a tool call, or null if it's a final answer. */
  _parseToolCall(raw) {
    if (!raw) return null
    const txt = String(raw).trim()
    const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidate = (fence ? fence[1] : txt).trim()
    if (!/"tool"\s*:/.test(candidate)) return null
    // Only treat it as a tool call if the JSON is essentially the WHOLE turn
    // (otherwise a normal answer that merely mentions JSON could be misread).
    try {
      const obj = JSON.parse(candidate)
      if (obj && typeof obj.tool === 'string') {
        return { tool: obj.tool, args: obj.args || obj.arguments || obj.input || {} }
      }
    } catch (_) { /* not valid JSON → treat as prose */ }
    return null
  }

  /** Strip any stray tool-call JSON from a final answer. */
  _stripToolJson(raw) {
    return String(raw || '')
      .replace(/```(?:json)?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*```/gi, '')
      .trim()
  }

  /** Flatten a chat-style message list into one prompt for single-shot CLIs. */
  _flattenMessages(messages) {
    const body = messages
      .map((m) => {
        const role = m.role === 'system' ? 'SYSTEM' : m.role === 'assistant' ? 'ASSISTANT' : 'USER'
        return `${role}:\n${m.content}`
      })
      .join('\n\n')
    return `${body}\n\nASSISTANT:`
  }

  /** One non-streaming completion against the configured backend. Returns text. */
  async _completeOnce(messages) {
    if (this.aiMode === 'api') {
      const key = await this._loadApiKey()
      const endpoint = (this.apiEndpoint || '').trim()
      if (!endpoint) throw new Error('No AI endpoint is set. Open Brain settings and pick a provider.')
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: this.apiModel || 'gpt-4o-mini', messages, stream: false, ...this._apiExtra() }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(`Provider returned ${res.status}. ${t.slice(0, 180)}`)
      }
      const j = await res.json()
      return j.choices?.[0]?.message?.content || ''
    }
    if (this.aiMode === 'claude-code') {
      // Pass the Brain prompt as the REAL session system prompt — not flattened
      // into the user turn, where Claude Code's own identity overrides it and it
      // refuses our tool contract as a "prompt injection". The conversation (and
      // any TOOL_RESULT turns) still ride in the -p prompt.
      const sys = messages.find((m) => m.role === 'system')
      const convo = messages.filter((m) => m.role !== 'system')
      const res = await window.api.invoke('ai:claude-code', {
        prompt: this._flattenMessages(convo),
        system: sys ? String(sys.content || '') : undefined,
        model: this.claudeModel || undefined,
        effort: this._claudeEffort() || undefined,
      })
      if (!res || !res.ok) throw new Error(res?.error || 'Claude Code did not respond.')
      this._recordClaudeResult(res)
      return res.text || ''
    }
    if (this.aiMode === 'cli') {
      const res = await window.api.invoke('ai:cli-run', {
        cmd: this.cliCmd,
        promptFlag: this.cliPromptFlag || '-p',
        prompt: this._flattenMessages(messages),
        ...this._cliModelArgs(),
      })
      if (!res || !res.ok) throw new Error(res?.error || `${this.cliCmd || 'The coding agent'} did not respond.`)
      return res.text || ''
    }
    // Local Ollama — chat endpoint with full message history.
    const res = await window.api.invoke('ai:ollama-request', {
      path: '/api/chat',
      method: 'POST',
      timeout: 120000,
      body: { model: this.llmModel, messages, stream: false },
    })
    if (res && res.ok && res.data && res.data.message) return res.data.message.content || ''
    throw new Error(res?.error || 'Ollama connection unreachable.')
  }

  /**
   * Like _completeOnce but streams tokens to `onToken` as they arrive, and returns
   * the full text. Used for the agent loop's final (answer) round so the drawer
   * types live. Backends that can't stream (Claude Code / generic CLI) emit the
   * whole answer once. Never used for tool-detection rounds' user-facing output —
   * the caller gates JSON tool calls out.
   */
  async _streamCompletion(messages, onToken) {
    const push = typeof onToken === 'function' ? onToken : () => {}

    // OpenAI-compatible API — true SSE token streaming.
    if (this.aiMode === 'api') {
      const key = await this._loadApiKey()
      const endpoint = (this.apiEndpoint || '').trim()
      if (!endpoint) throw new Error('No AI endpoint is set. Open Brain settings and pick a provider.')
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: this.apiModel || 'gpt-4o-mini', messages, stream: true, ...this._apiExtra() }),
      })
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '')
        throw new Error(`Provider returned ${res.status}. ${t.slice(0, 180)}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          const s = line.trim()
          if (!s || !s.startsWith('data:')) continue
          const data = s.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const j = JSON.parse(data)
            const tok = j.choices?.[0]?.delta?.content || ''
            if (tok) { acc += tok; push(tok) }
          } catch (_) { /* ignore partial frames */ }
        }
      }
      return acc
    }

    // Local Ollama — stream the chat endpoint straight from the renderer (same
    // proven path as streamFromRenderer), falling back to non-streaming IPC.
    if (this.aiMode === 'local') {
      try {
        const response = await fetch('http://127.0.0.1:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.llmModel, messages, stream: true }),
        })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let acc = ''
        let buffer = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() // keep the trailing partial line for the next chunk
          for (const line of lines) {
            const s = line.trim()
            if (!s) continue
            try {
              const j = JSON.parse(s)
              const tok = j.message?.content || ''
              if (tok) { acc += tok; push(tok) }
            } catch (_) { /* skip a partial/non-JSON line */ }
          }
        }
        if (acc) return acc
      } catch (e) {
        console.warn('[RAG Engine] Ollama chat stream failed, falling back:', e.message)
      }
      const full = await this._completeOnce(messages)
      push(full)
      return full
    }

    // Claude Code / generic CLI — single-shot; emit the whole answer at once.
    const full = await this._completeOnce(messages)
    push(full)
    return full
  }

  /**
   * Build the up-front grounding: workspace inventory + query-relevant excerpts +
   * (for follow-ups / empty retrieval) the intro section of every document so the
   * model can resolve "these"/"them" without a round-trip.
   */
  async _buildGrounding(query, history) {
    const inv = this._toolListDocuments()
    const inventory = inv.documents.map((d) => `- ${d.name} (${d.sections} sections)`).join('\n')

    let retrieved = []
    try { retrieved = await this.retrieveRelevantChunks(query, 5) } catch (_) { /* offline */ }

    const isFollowUp =
      /\b(these|those|them|they|it|its|that|this|above|each|all of them|the docs|the files|the notes)\b/i.test(query)
      || query.trim().length < 12
      || retrieved.length === 0
    let intros = []
    if (isFollowUp && this.chunks.length) {
      intros = this._docPaths().map((f) => this.chunks.find((c) => c.filePath === f)).filter(Boolean)
    }

    const blocks = []
    const cite = []
    const seen = new Set()
    for (const c of [...retrieved, ...intros]) {
      const key = `${c.filePath}|${c.header}`
      if (seen.has(key)) continue
      seen.add(key)
      blocks.push(`[${this.getRelativePath(c.filePath)} › ${c.header || 'intro'}]\n${String(c.text || '').slice(0, 900)}`)
      cite.push({ filePath: c.filePath, header: c.header })
    }

    const text = [
      `Documents in this workspace (${inv.count}):`,
      inventory || '(none indexed yet)',
      '',
      'Relevant excerpts:',
      blocks.slice(0, 12).join('\n\n') || '(no strong keyword match — use the search_documents or read_document tool to look closer)',
    ].join('\n')

    return { text, citations: Array.from(new Map(cite.map((c) => [c.filePath, c])).values()) }
  }

  _brainSystemPrompt(grounding) {
    const persona = (this.agentInstructions && this.agentInstructions.trim())
      ? `\n=== YOUR ROLE (follow these instructions) ===\n${this.agentInstructions.trim()}\n`
      : ''
    // Surface the active write-autonomy so the model knows whether a send needs
    // approval. The hard gate lives in code; this just keeps its narration honest.
    const policy = this.writePolicy || 'ask'
    const policyLine = policy === 'autonomous'
      ? 'You may send/create without asking — the user granted autonomy. Still be careful and accurate.'
      : policy === 'auto-reply'
        ? 'Single email replies and one-off sends go through automatically; campaigns and bulk sends are shown to the user for approval first.'
        : 'Every send/create is shown to the user for approval before it happens. Compose the full message, then call the tool — the app surfaces it for one click.'
    return `You are "Company Brain", the articulate, highly organized assistant for this user's LOCAL workspace. Everything stays on-device and private.
${persona}
You help with the user's documents AND can act across their connected EMAIL and CALENDAR. You have TOOLS — use them rather than guessing.

To CALL A TOOL, reply with ONLY a single JSON object and nothing else, e.g.:
{"tool":"read_document","args":{"name":"02-closed-loop-impact-tracking"}}

This app's runtime parses that JSON, EXECUTES the tool for you, and feeds the result back as TOOL_RESULT. Emitting the JSON IS how the action happens — there is no other mechanism and no shell. These are YOUR tools; never say a capability is "unavailable" or "not in this session" — if a tool fits the request, emit the call.

Available tools:
${this._toolCatalog()}

How to behave:
- Resolve pronouns from the conversation + grounding. If the user just saw a list of documents and asks "what do these have in it?", they mean THOSE documents — read or summarize them, do not ask which ones.
- Documents: prefer the grounding; call read_document for full contents, or search_documents across everything. NEVER claim you "couldn't find anything" without first searching.
- Email: to answer "is there an email about X", call search_email (or list_recent_email for "what's new"), then read_email for a specific message before acting on it. Carry accountId/folder/uid from the search result into read_email.
- Acting on email: when the user says "if there's an email about X, then do Y", actually do it — search, read, then reply with send_email or take the calendar action. Compose a complete, well-written message; don't ask the user to write it.
- Campaigns: for "run a campaign" / "email my customers", gather the recipient list (ask where it is if unknown — a note, the user's text), compose a PERSONALISED body per recipient, and call send_campaign with the full {to,subject,body} array. ${policyLine}
- Calendar: use list_calendar_events to check availability/agenda, create_calendar_event to schedule. Always pass ISO timestamps.
- Sending/creating: ${policyLine}
- When you have enough, reply in clear markdown PROSE (no JSON). Be specific and concise. After a send/create, confirm what you did (recipient, subject, time). If a tool returns {cancelled:true}, the user declined — acknowledge and stop, don't retry.
- Do not add citation links yourself — the app shows exact sources automatically.

=== WORKSPACE GROUNDING ===
${grounding.text}`
  }

  /**
   * Gate the per-round stream so tool-call JSON is withheld (and parsed at the
   * end) while a prose final answer streams to the user live. Returns helpers the
   * loop drives. Decision is made on the first non-whitespace content: a turn that
   * opens with `{` or a ```json fence is treated as a (hidden) tool call; anything
   * else is prose and is flushed + streamed token-by-token.
   */
  _makeStreamGate(onToken) {
    let buffer = ''
    let mode = 'pending' // 'pending' | 'prose' | 'json'
    return {
      push: (tok) => {
        if (mode === 'prose') { buffer += tok; onToken(tok); return }
        if (mode === 'json') { buffer += tok; return }
        buffer += tok
        const t = buffer.replace(/^\s+/, '')
        if (!t) return
        // A ```json fence may still be forming — wait before committing to prose,
        // so we don't leak the opening backticks of a fenced tool call.
        if (/^`{1,2}$/.test(t)) return
        if (/^```(?:j(?:s(?:o(?:n)?)?)?)?$/i.test(t)) return
        if (t[0] === '{' || /^```(?:json)?\s*\{?/i.test(t)) {
          mode = 'json' // withhold; the loop parses the full raw afterwards
        } else {
          mode = 'prose'
          onToken(buffer) // flush what we held back, then stream live
        }
      },
      streamed: () => mode === 'prose',
      raw: () => buffer,
    }
  }

  /**
   * Run the bounded tool-use loop. Tool-detection rounds withhold their JSON; the
   * final answer streams out via onToken so the drawer types live.
   * @param {{query, history, onToken, onComplete, onTool?}} a
   */
  async _agentAnswer({ query, history, onToken, onComplete, onTool, images = [] }) {
    console.log(`[RAG Engine] Agentic answer via backend: ${this.aiMode}`)
    // First-ask warm-up: make sure any configured MCP servers' tools are registered
    // before we advertise the catalog (subsequent refreshes come via mcp:changed).
    if (!this._mcpSynced) { try { await this.syncMcpTools() } catch (_e) { /* MCP optional */ } }
    const grounding = await this._buildGrounding(query, history)
    const messages = [{ role: 'system', content: this._brainSystemPrompt(grounding) }]

    // Recent conversation so follow-ups resolve (cap to keep prompts lean).
    for (const h of (history || []).slice(-6)) {
      const role = h.role === 'assistant' ? 'assistant' : 'user'
      const content = String(h.content || '').slice(0, 1500)
      if (content) messages.push({ role, content })
    }
    // Vision: when the user attached images AND the backend is an OpenAI-compatible
    // API, the question becomes a multi-part content array so the image bytes ride
    // along. Every other backend (Ollama/Claude-Code/CLI) takes string content only,
    // so images are dropped there (the drawer already warned the user).
    const visionParts = (Array.isArray(images) && images.length && this.aiMode === 'api') ? images : null
    messages.push({
      role: 'user',
      content: visionParts ? [{ type: 'text', text: query }, ...visionParts] : query,
    })

    const citations = [...(grounding.citations || [])]
    const toolsUsed = []
    const MAX_ROUNDS = 5

    const done = (rawText) => {
      const text = (this._stripToolJson(rawText) || rawText).trim()
        || "I looked but couldn't compose an answer. Try rephrasing, or ask me to read a specific document."
      if (onComplete) onComplete(text, this._dedupeCitations(citations), { toolsUsed: [...toolsUsed] })
      return text
    }

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const gate = this._makeStreamGate(onToken)
      const raw = await this._streamCompletion(messages, gate.push)
      const call = this._parseToolCall(raw)

      if (!call) {
        // Final answer. If the gate streamed it (prose), it's already on screen;
        // if it withheld (looked like JSON but wasn't a valid call), emit now.
        if (!gate.streamed()) onToken((this._stripToolJson(raw) || raw).trim())
        return done(raw)
      }

      // A tool call — nothing user-facing streamed. Surface a status + run it.
      if (onTool) { try { onTool(call.tool) } catch (_) { /* non-fatal */ } }
      toolsUsed.push(call.tool)
      const result = await this.runTool(call.tool, call.args || {})
      if (result && Array.isArray(result._cite)) {
        citations.push(...result._cite)
        delete result._cite
      }
      messages.push({ role: 'assistant', content: raw })
      messages.push({
        role: 'user',
        content: `TOOL_RESULT[${call.tool}]:\n${JSON.stringify(result).slice(0, 9000)}`,
      })
    }

    // Hit the tool cap — force a final answer (streamed) from what we gathered.
    messages.push({ role: 'user', content: 'Stop calling tools. Answer the original question now, in prose, using what you have.' })
    let acc = ''
    const finalText = await this._streamCompletion(messages, (tok) => { acc += tok; onToken(tok) })
    return done(finalText || acc)
  }

  _dedupeCitations(citations) {
    return Array.from(new Map((citations || []).map((c) => [c.filePath, { filePath: c.filePath, header: c.header || '' }])).values())
  }

  /**
   * Executes a native fetch request directly from the browser window context
   * to leverage readable streams and perform word-by-word streaming animation.
   */
  async streamFromRenderer(query, systemPrompt, onTokenCallback, onCompleteCallback, uniqueCitations) {
    const modelToUse = this.llmModel
    let accumulatedText = ''

    try {
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelToUse,
          prompt: query,
          system: systemPrompt,
          stream: true
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let isDone = false

      while (!isDone) {
        const { value, done } = await reader.read()
        if (done) {
          isDone = true
          break
        }

        const chunkText = decoder.decode(value, { stream: true })
        // Ollama streams JSON lines
        const lines = chunkText.split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line)
            if (parsed.response) {
              accumulatedText += parsed.response
              onTokenCallback(parsed.response)
            }
          } catch (_) {
            // Ignore partial lines
          }
        }
      }

      if (onCompleteCallback) {
        onCompleteCallback(accumulatedText, uniqueCitations)
      }
    } catch (e) {
      console.warn('[RAG Engine] Stream fetch failed, falling back to synchronous IPC invoke:', e.message)
      
      // Fallback: trigger synchronous IPC generate call
      const fallbackResponse = await window.api.invoke('ai:ollama-request', {
        path: '/api/generate',
        method: 'POST',
        timeout: 60000,
        body: {
          model: modelToUse,
          prompt: query,
          system: systemPrompt,
          stream: false
        }
      })

      if (fallbackResponse && fallbackResponse.ok && fallbackResponse.data && fallbackResponse.data.response) {
        const text = fallbackResponse.data.response
        onTokenCallback(text)
        if (onCompleteCallback) onCompleteCallback(text, uniqueCitations)
      } else {
        throw new Error(fallbackResponse?.error || 'Ollama connection unreachable.')
      }
    }
  }

  getRelativePath(filePath) {
    if (!this.projectPath) return filePath
    let rel = filePath.replace(this.projectPath, '')
    return rel.startsWith('/') || rel.startsWith('\\') ? rel.substring(1) : rel
  }
}
