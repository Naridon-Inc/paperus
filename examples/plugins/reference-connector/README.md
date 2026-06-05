# Reference Support Connector (example plugin)

The reference **external-integration connector** for the Company Brain. It
registers two Brain tools that fetch structured "support ticket" data from a
public, read-only API and hand it back to the Brain's agent loop, which can then
answer from — and cite — that external system. This is the canonical shape every
real connector (Zendesk, Intercom, Linear, …) follows; only the host and auth
header change.

## What it demonstrates (the Phase 5 pattern, end-to-end)

1. **Declare caps** → `tools` + `net:<host>` + `storage`.
2. **Store a secret** → read an optional `apiToken` from `ctx.storage` (never the
   manifest, never seen by the Brain), fall back to anonymous when unset.
3. **Register tools** → `ctx.brain.registerTool({ id, description, parameters, handler })`.
4. **Fetch over gated egress** → `ctx.net.fetch(...)`, allowed only for the
   declared host (host re-checked in main; 8 MB / 15 s caps).
5. **Return structured data the Brain cites** → each result carries
   `source: plugin:notionless.reference-connector`.

## Capabilities

```json
["tools", "net:jsonplaceholder.typicode.com", "storage"]
```

- **`tools`** — lets the plugin contribute tools to the Company Brain. Low-risk
  on its own.
- **`net:jsonplaceholder.typicode.com`** — gated egress to exactly this host.
  This is a **sensitive** capability, so enabling the plugin triggers the
  pre-enable **sensitive-cap prompt** ("This plugin requests: Make network
  requests to jsonplaceholder.typicode.com"). Egress is re-checked in the main
  process on every fetch; revoking the grant disables the tools' network access.
- **`storage`** — namespaced per-plugin key/value store, used here for the
  optional `apiToken`.

### Why this host?

`jsonplaceholder.typicode.com` is a stable, **public, read-only** mock JSON API
with no key and no rate-limit surprises, so the demo runs out of the box. Its
`/posts` collection is treated as mock **tickets** (`{ id, title, body }`). A
real connector points `net:` at e.g. `api.zendesk.com` and attaches the stored
auth token — the plugin's structure is otherwise identical.

## Tools registered

| Tool id          | Parameters         | Returns                                                                 |
| ---------------- | ------------------ | ----------------------------------------------------------------------- |
| `search_tickets` | `{ query: string }`| `{ source, query, count, tickets: [{ id, title, body, source }] }`      |
| `get_ticket`     | `{ id: number }`   | `{ source, ticket: { id, title, body, source } }`                       |

The host namespaces these under the plugin id, so the Brain sees
`notionless_reference_connector__search_tickets` and
`notionless_reference_connector__get_ticket` in its tool catalogue.

Both handlers are wrapped so any network/parse error returns `{ error, source }`
and never throws; results are capped (≤ 5 tickets, fields clipped) to stay within
the prompt budget.

## Secret / token flow

Real connectors authenticate. The token **never** lives in `plugin.json` (the
manifest is world-readable) and the **Brain never sees it** (tools run
host-mediated). This plugin reads an `apiToken` from `ctx.storage` and attaches it
as a `Bearer` header **only if present**; for the public demo API it is unset and
the plugin proceeds anonymously. To exercise the authenticated path, set the token
from a settings UI or a sibling command:

```js
await ctx.storage.set('apiToken', '…')   // host-side; never enters a tool result
```

A production connector would instead keep the secret in the OS keychain via the
host's `auth:secure-*` seam.

## Enable it

1. Drop this folder into your plugins directory (or install it via the Plugin
   Manager / Lab the same way as the other `examples/plugins/*`).
2. Enable it. Because it declares a sensitive `net:<host>` capability, you get the
   **sensitive-cap prompt** — confirm the network grant to activate.
3. Open the Company Brain and ask a question that needs a ticket lookup.

## Sample Brain question

> "Search our support tickets for anything about **rerum** and summarize what they
> say."

The agent loop discovers `…__search_tickets` in the catalogue, calls it with
`{ query: "rerum" }`, receives the structured tickets, and answers — citing
`source: plugin:notionless.reference-connector`. A follow-up like *"open ticket 1"*
routes to `get_ticket` with `{ id: 1 }`.

## Surfaces exercised

- `ctx.brain.registerTool({ id, description, parameters, handler })` (×2)
- `ctx.net.fetch(url, { method, headers })` — gated egress, structured JSON
- `ctx.storage.get(key)` — optional, namespaced secret
- `deactivate()` disposes both tools so the Brain's registry drops them on unload
