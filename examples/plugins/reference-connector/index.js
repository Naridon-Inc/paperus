import { definePlugin } from '@notionless/plugin-sdk'

/**
 * Reference Support Connector — the Phase 5 reference external-integration plugin.
 *
 * Capabilities: ["tools", "net:jsonplaceholder.typicode.com", "storage"]
 *
 * This is the canonical end-to-end pattern for a CONNECTOR plugin: it registers
 * tools the Company Brain's agent loop can call (`ctx.brain.registerTool`), whose
 * handlers reach an external system over gated egress (`ctx.net.fetch`, allowed
 * only for the host declared in `net:<host>`), and return STRUCTURED data the
 * Brain cites as `source: plugin:notionless.reference-connector`.
 *
 * Why jsonplaceholder.typicode.com? It is a stable, PUBLIC, read-only mock API
 * (no key, no rate-limit surprises) so the demo actually runs. We treat its
 * `/posts` collection as mock "support tickets": each post's `{ id, title, body }`
 * stands in for a ticket. A real connector would point `net:` at e.g.
 * `api.zendesk.com` / `api.intercom.io` and send an auth header (see SECRET FLOW
 * below) — the SHAPE of this plugin would be identical.
 *
 * ── SECRET / TOKEN FLOW (read this) ────────────────────────────────────────
 * Real connectors authenticate. The token NEVER lives in plugin.json (the
 * manifest is world-readable) and the Brain NEVER sees it: tools run host-
 * mediated, so secrets stay on the host side. We keep the token in `ctx.storage`
 * (namespaced to this plugin) — or, for a real product, the OS keychain via the
 * host's auth:secure-* seam. Below we READ an `apiToken` from `ctx.storage` and
 * attach it as a Bearer header IF present, and fall back gracefully (anonymous,
 * read-only) when it is unset — which is the case for this public demo API. To
 * try the authenticated path, a settings UI (or another plugin command) would do
 * `ctx.storage.set('apiToken', '...')`; the value never crosses into a tool
 * result, so it can never leak into a Brain answer.
 *
 * ── DEFENSIVE CONTRACT ──────────────────────────────────────────────────────
 * Every handler is wrapped so a network/parse error returns `{ error }` and never
 * throws (a throwing tool would otherwise degrade to a timeout in the adapter).
 * Egress is bounded by the host (8 MB / 15 s on `ctx.net.fetch`) and gated to the
 * declared host; we additionally cap result size. Every successful result carries
 * a `source` / `provenance` label so the Brain can cite the external origin.
 */

const API_BASE = 'https://jsonplaceholder.typicode.com'
const SOURCE = 'plugin:notionless.reference-connector'
const STORAGE_TOKEN_KEY = 'apiToken'

// Bound how much external data we relay into the Brain prompt. The host already
// caps the response at 8 MB; this is a second, prompt-budget-friendly cap on the
// number of structured rows we hand back.
const MAX_RESULTS = 5
const MAX_FIELD_CHARS = 600

/** Trim a string field so a single ticket can't blow the prompt budget. */
function clip(value, max = MAX_FIELD_CHARS) {
  const s = value == null ? '' : String(value)
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** Normalize one upstream "post" into our ticket shape. */
function toTicket(post) {
  if (!post || typeof post !== 'object') return null
  return {
    id: post.id,
    title: clip(post.title, 200),
    body: clip(post.body),
    source: SOURCE, // provenance per-row so a cited answer points back here
  }
}

export default definePlugin({
  async activate(ctx) {
    this._disposables = []

    // ── SECRET FLOW: read an optional API token from namespaced plugin storage.
    // For this public demo it is normally unset, and we proceed anonymously.
    // Real connectors store the token here (or in the OS keychain) — NEVER in the
    // manifest — and it is never surfaced to the Brain.
    this._readToken = async () => {
      try {
        const token = await ctx.storage.get(STORAGE_TOKEN_KEY)
        return typeof token === 'string' && token.trim() ? token.trim() : null
      } catch {
        return null
      }
    }

    // Build request headers, attaching auth ONLY if a token is stored. The token
    // value stays host-side; it is never returned in a tool result.
    this._authHeaders = async () => {
      const headers = { Accept: 'application/json' }
      const token = await this._readToken()
      if (token) headers.Authorization = `Bearer ${token}`
      return headers
    }

    // Gated egress helper. `ctx.net.fetch` only reaches the host declared in
    // `net:jsonplaceholder.typicode.com`; any other host is denied in main. We
    // parse JSON defensively and convert non-2xx into `{ error }`.
    this._getJSON = async (url) => {
      const res = await ctx.net.fetch(url, {
        method: 'GET',
        headers: await this._authHeaders(),
      })
      if (!res || typeof res.status !== 'number') {
        return { error: 'no response from connector host' }
      }
      if (res.status < 200 || res.status >= 300) {
        return { error: `connector host returned HTTP ${res.status}` }
      }
      try {
        return { data: JSON.parse(res.body || 'null') }
      } catch {
        return { error: 'connector host returned non-JSON' }
      }
    }

    // ── TOOL 1: search_tickets {"query": string} ────────────────────────────
    // Returns a structured list of matching tickets the Brain can cite. We fetch
    // the collection and filter locally (the mock API has no real search param);
    // a real connector would forward the query to the upstream search endpoint.
    const searchTool = ctx.brain.registerTool({
      id: 'search_tickets',
      description:
        'Search support tickets by keyword. Returns matching tickets (id, title, body) '
        + 'from the connected support system. Use when the user asks about tickets/issues.',
      parameters: { query: 'string' },
      handler: async (args) => {
        try {
          const query = (args && typeof args.query === 'string' ? args.query : '').trim()
          const out = await this._getJSON(`${API_BASE}/posts`)
          if (out.error) return { error: out.error, source: SOURCE }

          const rows = Array.isArray(out.data) ? out.data : []
          const q = query.toLowerCase()
          const matched = rows
            .map(toTicket)
            .filter(Boolean)
            .filter((t) => {
              if (!q) return true
              const hay = `${t.title} ${t.body}`.toLowerCase()
              return hay.includes(q)
            })
            .slice(0, MAX_RESULTS)

          // STRUCTURED result. `source` lets the Brain attribute the answer; the
          // Brain treats this whole object as untrusted external data, not code.
          return {
            source: SOURCE,
            query,
            count: matched.length,
            tickets: matched,
          }
        } catch (err) {
          // Never throw out of a tool handler.
          return { error: (err && err.message) ? err.message : 'search_tickets failed', source: SOURCE }
        }
      },
    })
    this._disposables.push(searchTool)

    // ── TOOL 2: get_ticket {"id": number} ───────────────────────────────────
    // Fetch a single ticket by id and return its full record.
    const getTool = ctx.brain.registerTool({
      id: 'get_ticket',
      description:
        'Fetch one support ticket by its numeric id and return its full record (id, title, body). '
        + 'Use after search_tickets, or when the user names a specific ticket id.',
      parameters: { id: 'number' },
      handler: async (args) => {
        try {
          const rawId = args && (args.id != null ? args.id : args.ticketId)
          const id = Number(rawId)
          if (!Number.isFinite(id) || id <= 0) {
            return { error: 'get_ticket requires a positive numeric "id"', source: SOURCE }
          }
          const out = await this._getJSON(`${API_BASE}/posts/${encodeURIComponent(String(id))}`)
          if (out.error) return { error: out.error, source: SOURCE }

          const ticket = toTicket(out.data)
          if (!ticket || ticket.id == null) {
            return { error: `no ticket found for id ${id}`, source: SOURCE }
          }
          return { source: SOURCE, ticket }
        } catch (err) {
          return { error: (err && err.message) ? err.message : 'get_ticket failed', source: SOURCE }
        }
      },
    })
    this._disposables.push(getTool)
  },

  async deactivate() {
    // Dispose every registered tool so the Brain's registry drops them on unload.
    for (const d of this._disposables || []) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this._disposables = []
  },
})
