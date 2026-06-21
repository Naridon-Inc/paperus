// McpManager — the app's Model Context Protocol client pool. Lives in the MAIN
// process (stdio servers spawn child processes; the browser sandbox can't).
//
// It owns the user's configured MCP servers, keeps a live SDK Client per enabled
// server, aggregates their tools, and dispatches tool calls. The renderer's
// Company Brain registers these tools into its agentic loop over IPC, so any MCP
// server the user adds becomes callable from chat.
//
// Config lives at <userData>/mcp/servers.json (plaintext, user-managed — same
// posture as Claude Desktop's claude_desktop_config.json; it never leaves the
// device). Each server:
//   { id, name, transport:'stdio'|'http', command, args[], env{},   // stdio
//     url, headers{},                                                // http/sse
//     enabled, askFirst }
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

const CONNECT_TIMEOUT_MS = 20000
const CALL_TIMEOUT_MS = 120000

// GUI-launched apps inherit a truncated PATH (no Homebrew, ~/.local, cargo…), so
// stdio commands like `npx`/`uvx`/`node` won't resolve. Prepend the usual dirs.
function loginPath() {
  const home = os.homedir()
  const extra = [
    '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin',
    '/usr/sbin', '/sbin', path.join(home, '.local/bin'), path.join(home, '.cargo/bin'),
    path.join(home, '.bun/bin'), '/opt/local/bin',
  ]
  const cur = (process.env.PATH || '').split(':').filter(Boolean)
  return Array.from(new Set([...extra, ...cur])).join(':')
}

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_r, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
])

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server'

export class McpManager {
  constructor() {
    this.dir = path.join(app.getPath('userData'), 'mcp')
    this.file = path.join(this.dir, 'servers.json')
    this.servers = [] // config records
    this.live = new Map() // id -> { client, transport, tools, status, error }
    this._load()
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const j = JSON.parse(raw)
      this.servers = Array.isArray(j.servers) ? j.servers : []
    } catch (_e) { this.servers = [] }
  }

  _save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify({ servers: this.servers }, null, 2), 'utf8')
    } catch (e) { console.warn('[MCP] save failed:', e.message) }
  }

  _byId(id) { return this.servers.find((s) => s.id === id) || null }

  _uniqueId(base) {
    let id = slug(base); let n = 2
    while (this.servers.some((s) => s.id === id)) { id = `${slug(base)}-${n}`; n += 1 }
    return id
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────
  _makeTransport(cfg) {
    if (cfg.transport === 'http' || cfg.url) {
      const url = new URL(String(cfg.url))
      const requestInit = (cfg.headers && Object.keys(cfg.headers).length) ? { headers: { ...cfg.headers } } : undefined
      // Prefer Streamable HTTP (current spec); SSE is tried as a fallback in connect().
      return new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined)
    }
    return new StdioClientTransport({
      command: String(cfg.command),
      args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
      env: { ...getDefaultEnvironment(), PATH: loginPath(), ...(cfg.env || {}) },
      stderr: 'pipe',
    })
  }

  async _open(cfg) {
    const client = new Client({ name: 'paperus-brain', version: '1.0.0' }, { capabilities: {} })
    let transport = this._makeTransport(cfg)
    try {
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'MCP connect')
    } catch (e) {
      // Remote servers that only speak the older SSE protocol fail Streamable; retry.
      if ((cfg.transport === 'http' || cfg.url)) {
        try { await client.close() } catch (_) { /* ignore */ }
        transport = new SSEClientTransport(new URL(String(cfg.url)),
          (cfg.headers && Object.keys(cfg.headers).length) ? { requestInit: { headers: { ...cfg.headers } } } : undefined)
        const c2 = new Client({ name: 'paperus-brain', version: '1.0.0' }, { capabilities: {} })
        await withTimeout(c2.connect(transport), CONNECT_TIMEOUT_MS, 'MCP connect (SSE)')
        return { client: c2, transport }
      }
      throw e
    }
    return { client, transport }
  }

  async connect(id) {
    const cfg = this._byId(id)
    if (!cfg) return { ok: false, error: 'Unknown server.' }
    await this.disconnect(id)
    try {
      const { client, transport } = await this._open(cfg)
      const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, 'listTools')
      const tools = Array.isArray(listed?.tools) ? listed.tools : []
      this.live.set(id, { client, transport, tools, status: 'connected', error: null })
      return { ok: true, status: 'connected', toolCount: tools.length }
    } catch (e) {
      this.live.set(id, { client: null, transport: null, tools: [], status: 'error', error: e.message })
      return { ok: false, status: 'error', error: e.message }
    }
  }

  async disconnect(id) {
    const l = this.live.get(id)
    if (l && l.client) { try { await l.client.close() } catch (_) { /* ignore */ } }
    this.live.delete(id)
    return { ok: true }
  }

  async connectAll() {
    await Promise.all(this.servers.filter((s) => s.enabled !== false).map((s) => this.connect(s.id).catch(() => {})))
    return { ok: true }
  }

  // ── queries ──────────────────────────────────────────────────────────────────
  list() {
    return this.servers.map((s) => {
      const l = this.live.get(s.id)
      return {
        id: s.id,
        name: s.name || s.id,
        transport: s.transport || (s.url ? 'http' : 'stdio'),
        command: s.command || '',
        args: s.args || [],
        env: s.env || {},
        url: s.url || '',
        headers: s.headers || {},
        enabled: s.enabled !== false,
        askFirst: !!s.askFirst,
        status: l ? l.status : (s.enabled === false ? 'disabled' : 'idle'),
        error: l ? l.error : null,
        toolCount: l ? l.tools.length : 0,
      }
    })
  }

  // Aggregate every connected server's tools, flattened for the renderer to
  // register. askFirst rides along so the Brain can gate per-server.
  tools() {
    const out = []
    for (const s of this.servers) {
      const l = this.live.get(s.id)
      if (!l || l.status !== 'connected') continue
      for (const t of l.tools) {
        out.push({
          server: s.id,
          serverName: s.name || s.id,
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || null,
          askFirst: !!s.askFirst,
        })
      }
    }
    return out
  }

  // ── tool dispatch (the Brain calls this over IPC) ──────────────────────────────
  async callTool(serverId, name, args) {
    const l = this.live.get(serverId)
    if (!l || !l.client || l.status !== 'connected') {
      // Lazy (re)connect — the server may have been added since startup.
      const r = await this.connect(serverId)
      if (!r.ok) return { ok: false, error: r.error || 'Server not connected.' }
    }
    const live = this.live.get(serverId)
    if (!live || !live.client) return { ok: false, error: 'Server not connected.' }
    try {
      const res = await withTimeout(
        live.client.callTool({ name: String(name), arguments: (args && typeof args === 'object') ? args : {} }),
        CALL_TIMEOUT_MS, `MCP tool ${name}`,
      )
      return { ok: !res?.isError, text: this._flattenContent(res), isError: !!res?.isError, raw: res }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  // MCP returns content blocks; collapse to text the model can read.
  _flattenContent(res) {
    const content = Array.isArray(res?.content) ? res.content : []
    const parts = content.map((c) => {
      if (c == null) return ''
      if (c.type === 'text') return String(c.text || '')
      if (c.type === 'resource' && c.resource) return String(c.resource.text || c.resource.uri || JSON.stringify(c.resource))
      if (c.type === 'image') return `[image ${c.mimeType || ''}]`
      return JSON.stringify(c)
    }).filter(Boolean)
    let text = parts.join('\n').trim()
    if (!text && res?.structuredContent) text = JSON.stringify(res.structuredContent)
    return text.slice(0, 12000)
  }

  // ── mutations ──────────────────────────────────────────────────────────────────
  _normalize(cfg = {}) {
    const transport = cfg.transport === 'http' || cfg.url ? 'http' : 'stdio'
    const rec = {
      id: cfg.id && this._byId(cfg.id) ? cfg.id : this._uniqueId(cfg.name || cfg.command || cfg.url || 'server'),
      name: String(cfg.name || cfg.id || cfg.command || cfg.url || 'MCP server').slice(0, 80),
      transport,
      enabled: cfg.enabled !== false,
      askFirst: !!cfg.askFirst,
    }
    if (transport === 'http') {
      rec.url = String(cfg.url || '')
      rec.headers = (cfg.headers && typeof cfg.headers === 'object') ? cfg.headers : {}
    } else {
      rec.command = String(cfg.command || '')
      rec.args = Array.isArray(cfg.args) ? cfg.args.map(String) : []
      rec.env = (cfg.env && typeof cfg.env === 'object') ? cfg.env : {}
    }
    return rec
  }

  async add(cfg) {
    const rec = this._normalize(cfg)
    if (rec.transport === 'stdio' && !rec.command) return { ok: false, error: 'A launch command is required.' }
    if (rec.transport === 'http' && !rec.url) return { ok: false, error: 'A server URL is required.' }
    this.servers.push(rec)
    this._save()
    const conn = rec.enabled ? await this.connect(rec.id) : { ok: true, status: 'disabled' }
    return { ok: true, id: rec.id, status: conn.status, error: conn.error, toolCount: conn.toolCount || 0 }
  }

  async update(id, patch = {}) {
    const cfg = this._byId(id)
    if (!cfg) return { ok: false, error: 'Unknown server.' }
    Object.assign(cfg, this._normalize({ ...cfg, ...patch, id }))
    this._save()
    if (cfg.enabled === false) { await this.disconnect(id); return { ok: true, status: 'disabled' } }
    const conn = await this.connect(id)
    return { ok: true, status: conn.status, error: conn.error, toolCount: conn.toolCount || 0 }
  }

  async remove(id) {
    await this.disconnect(id)
    this.servers = this.servers.filter((s) => s.id !== id)
    this._save()
    return { ok: true }
  }

  // Dry-run a config without persisting — powers the "Test connection" button.
  async test(cfg) {
    let client = null
    try {
      const opened = await this._open(this._normalize({ ...cfg, enabled: true }))
      client = opened.client
      const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, 'listTools')
      const tools = Array.isArray(listed?.tools) ? listed.tools : []
      return { ok: true, toolCount: tools.length, tools: tools.map((t) => t.name) }
    } catch (e) {
      return { ok: false, error: e.message }
    } finally {
      if (client) { try { await client.close() } catch (_) { /* ignore */ } }
    }
  }

  // Import the Claude-Desktop / .mcp.json `mcpServers` map: { name: {command,args,env} | {url,headers} }.
  async importJson(json) {
    let obj = json
    if (typeof json === 'string') { try { obj = JSON.parse(json) } catch (e) { return { ok: false, error: `Invalid JSON: ${e.message}` } } }
    const map = (obj && obj.mcpServers) || obj
    if (!map || typeof map !== 'object') return { ok: false, error: 'Expected an mcpServers object.' }
    const added = []
    for (const [name, def] of Object.entries(map)) {
      if (!def || typeof def !== 'object') continue
      const r = await this.add({ ...def, name })
      if (r.ok) added.push(r.id)
    }
    return { ok: true, added }
  }

  async dispose() {
    await Promise.all(Array.from(this.live.keys()).map((id) => this.disconnect(id)))
  }
}
