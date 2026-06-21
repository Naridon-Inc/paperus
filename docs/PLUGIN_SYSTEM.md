# Paperus Plugin System & Integration Surface

> Status: **design / RFC**. This document specifies the plugin architecture before
> implementation. It is the contract third-party authors (and AI agents) build against.

## 1. Goals

1. **Anyone can extend the app** — add a block type, a slash command, a sidebar
   panel, an AI provider, or an import/export format — without forking.
2. **Safe by default.** Paperus is local-first and **end-to-end encrypted**. A
   plugin must never be able to exfiltrate plaintext note content, identity keys,
   or the team root key. Untrusted plugins run **sandboxed** with explicitly
   granted capabilities.
3. **Trivial to author with an AI agent.** A user should be able to describe a
   plugin in plain English to Claude (Claude Code or any agent), point it at the
   `@notionless/plugin-sdk` types and the LLM-native docs, and get a working,
   hot-loadable plugin. The whole API is documented in an LLM-friendly,
   machine-readable form.
4. **Stays local-first.** Plugins are plain files. Install from a folder, a file, a
   URL, or an optional registry — no mandatory store, no account.

### Non-goals (v1)
Native code plugins, a paid marketplace, remote plugin execution, and auto-update
of third-party plugins. (Hooks are reserved; see §10.)

## 2. Architecture overview

```
┌─────────────────────────── Renderer (host) ───────────────────────────┐
│  PluginHost                                                            │
│   ├─ loads manifests, resolves capabilities, owns the public API       │
│   ├─ first-party plugins  → run in-process (trusted)                   │
│   └─ third-party plugins  → run in a sandboxed <iframe>/Worker         │
│                              talking JSON-RPC over postMessage         │
│                                                                        │
│  Host API (versioned, JSON-serializable):                              │
│   notionless.editor / commands / ui / ai / fs / storage / events / net │
│                                                                        │
│  Everything routes THROUGH the host — plugins never touch Yjs, the     │
│  E2EE transportDoc, P2P providers, or the openP2PDoc chokepoint.       │
└────────────────────────────────────────────────────────────────────────┘
            │ ipc (capability-checked)                  ▲ events
            ▼                                           │
┌──────────────────────────── Main process ─────────────────────────────┐
│  PluginManager: discovers plugin dirs, reads manifests, enforces       │
│  filesystem/network grants, brokers `plugin:*` IPC. Never auto-runs    │
│  third-party code in the main process.                                 │
└────────────────────────────────────────────────────────────────────────┘
```

The key invariant: **the E2EE chokepoint stays untouched.** Plugins get plaintext
*only* for the blocks/notes the host hands them, and only with the `editor`/`fs`
capability. Network and filesystem are deny-by-default.

## 3. Trust tiers & sandbox

| Tier | Who | Execution | DOM | fs / net |
|---|---|---|---|---|
| **Core** | bundled first-party (the `cm-*` blocks, Company Brain) | in-process | full | full |
| **Trusted** | user explicitly marks "trusted" | in-process | scoped mount | granted caps |
| **Sandboxed** (default for 3rd-party) | anything installed | `<iframe sandbox>` + Worker | **none direct** — only a mounted view element + RPC | only granted caps |

Sandboxed plugins:
- Run from a `blob:`/`plugin://` origin with `sandbox="allow-scripts"` (no
  same-origin, no top navigation).
- Have **no** `window.api`, no `require`, no `fetch` to arbitrary hosts.
- Communicate only via a typed `postMessage` JSON-RPC channel to the host.
- Render UI by sending a vDOM-ish description **or** by being handed a single
  mounted DOM node the host controls (host mediates events). No raw DOM access to
  the rest of the app.

This is the same model browsers/VS Code use: capability prompts on install, hard
process/iframe boundary, stable serializable API.

## 4. Capability model

A plugin **declares** the capabilities it needs in its manifest; the user
**approves** them on install (one screen, like browser-extension permissions).
Nothing is granted implicitly.

| Capability | Grants | Risk surface |
|---|---|---|
| `commands` | register commands / slash entries / palette items | low |
| `editor` | register block types, decorations, read/transform the **active** doc's text | medium (sees plaintext of opened note) |
| `ui` | contribute panels, toolbar items, settings sections, status items | low |
| `ai` | call the configured AI backend (Ollama / BYO-key / Claude Code) via the host | medium (prompt content) |
| `storage` | per-plugin key-value store (namespaced, sandboxed) | low |
| `fs:read` / `fs:write` | read/write within a **user-chosen scope** (a folder) | high |
| `net:<host>` | fetch only listed hosts | high |
| `clipboard` | read/write clipboard | medium |

Rules:
- Capabilities are **least-privilege and enumerated**; `net:*` wildcard requires an
  extra confirmation and a banner.
- The host re-checks every privileged call against the grant — a manifest claim is
  necessary but not sufficient.
- Plugins **cannot** request: identity keys, the team root key, raw Yjs docs, the
  E2EE transport doc, or other plugins' storage. These are not in the API at all.

## 5. Plugin package & manifest

A plugin is a folder (or a single bundled `.js` + `plugin.json`, or an npm package
`notionless-plugin-*`). ESM only.

```jsonc
// plugin.json
{
  "id": "com.acme.wordcount",          // reverse-DNS, unique
  "name": "Word Count",
  "version": "0.1.0",
  "apiVersion": "1",                    // host API major it targets
  "description": "Live word/character count in the status bar.",
  "author": "Acme",
  "license": "MIT",
  "entry": "index.js",                  // ESM module exporting activate()/deactivate()
  "capabilities": ["ui", "editor"],
  "contributes": {                      // declarative, shown before code runs
    "commands":   [{ "id": "wc.toggle", "title": "Toggle Word Count" }],
    "slash":      [{ "id": "wc.insert", "title": "Word count badge", "keywords": ["count"] }],
    "statusItems":[{ "id": "wc.status", "align": "right" }],
    "blocks":     [],                   // custom editor block types
    "panels":     [],                   // sidebar/right-dock panels
    "aiProviders":[],                   // register an AI generation/embedding backend
    "formats":    []                    // import/export converters
  }
}
```

`contributes` is **declarative** so the host can show the user what a plugin adds
*before* executing any of its code.

## 6. Host API (the surface plugins build against)

Lifecycle entry:

```js
// index.js
export async function activate(ctx) {
  const item = ctx.ui.statusItem('wc.status')
  ctx.editor.onChange((doc) => {
    item.text = `${doc.text.split(/\s+/).filter(Boolean).length} words`
  })
  ctx.commands.register('wc.toggle', () => item.toggle())
}
export function deactivate() {}        // optional cleanup; host also auto-disposes
```

`ctx` is the versioned API, fully JSON-serializable across the sandbox boundary:

- `ctx.editor` — `getActive()`, `onChange(cb)`, `insert(text)`, `replaceSelection`,
  `registerBlock({type, parse, render, toMarkdown})` (a thin wrapper over the same
  CodeMirror 6 decoration mechanism `cm-callout.js`/`cm-toggle.js` already use),
  `registerDecoration(...)`. **Markdown in, Markdown out** — blocks must round-trip
  to plain Markdown so files stay portable.
- `ctx.commands` — `register(id, fn)`, `execute(id)`; auto-surfaced in the command
  palette and (if `contributes.slash`) the slash menu.
- `ctx.ui` — `statusItem`, `panel({id, title, mount})` (sidebar/right dock like
  Company Brain), `toolbarItem` (selection toolbar), `settingsSection`, `notify`,
  `modal`.
- `ctx.ai` — `complete({system, prompt, onToken})` and `embed(texts)` routed to the
  **user's** configured backend (Ollama / OpenAI-compat / Claude Code). Plugins
  never see the API key; the host injects it. This is the same dispatch
  `rag-engine.js` already does.
- `ctx.storage` — `get/set/delete`, namespaced per plugin id (IndexedDB-backed).
- `ctx.fs` — only present with `fs:*`; scoped to the granted folder; goes through
  the existing `filesystem-proxy` so Electron/web behave identically.
- `ctx.net` — `fetch(url, opts)` allowed only for `net:<host>` grants.
- `ctx.events` — `on('note:open' | 'note:save' | 'note:change' | 'team:updated' |
  'file:changed', cb)`. A curated, safe subset of internal events.

API is **semver'd** via `apiVersion`. The host keeps one major back-compat shim.

## 7. Extension points (mapped to today's code)

| Surface | Plugin hook | Mirrors existing module |
|---|---|---|
| Editor block / decoration | `ctx.editor.registerBlock` | `cm-callout.js`, `cm-toggle.js`, `cm-columns.js` |
| Slash command | `contributes.slash` + `ctx.commands` | `slash.js`, `cm-suggest.js` |
| Command palette / keybinding | `ctx.commands.register` | `command-palette.js` |
| Sidebar / right-dock panel | `ctx.ui.panel` | Company Brain (`brain-drawer.js`) |
| Selection toolbar action | `ctx.ui.toolbarItem` | `selection-toolbar.js` |
| Status bar item | `ctx.ui.statusItem` | page footer |
| AI provider | `contributes.aiProviders` | `rag-engine.js` backend dispatch |
| Import/export format | `contributes.formats` | `import.js`, `export.js`, `markdown.js` |
| Lifecycle hooks | `ctx.events` | engine/projection observers |

**Dogfooding goal:** over time, migrate first-party features (callouts, math,
mermaid, Company Brain) to *be* plugins on this API. If the built-ins can't be
expressed as plugins, the API is incomplete. This is the acceptance test.

## 8. Distribution (local-first)

- **Install from:** a folder you point at, a single `.js`/`.zip` file, a Git URL,
  or `npm i notionless-plugin-foo` into a `plugins/` dir.
- **Discovery:** `~/Library/Application Support/Notionless/plugins/` (Electron) and
  a workspace-local `.notionless/plugins/`. Both scanned on launch.
- **Optional registry:** a *static* `registry.json` (a curated list of plugin Git
  repos) — no server, no account, mirrors the project's ethos. Browsable in-app.
- **Integrity:** plugins may ship an Ed25519 signature; the host shows
  verified/unverified and warns on capability escalation across updates.

## 9. Developer experience — the plugin authoring path

Authoring is a first-class, **SDK + CLI** workflow. There is no in-app authoring
IDE; the app surfaces installed plugins (enable/disable/reload) and links out to
the SDK. You write plugins in your own editor against the typed SDK.

1. **`@notionless/plugin-sdk`** (npm, **permissively licensed**, see §11) — TypeScript
   types + `definePlugin()` and a typed `ctx`. Authors get full autocomplete in
   their own editor (VS Code, etc.). This is the canonical surface to build against.
2. **`npm create @notionless/plugin`** (the `create-notionless-plugin` scaffolder) —
   writes a working plugin from a template (word-count, custom-callout, ai-summarize,
   magic-login, custom-section, blank), each pre-wired to the SDK with a valid
   `plugin.json`. This is the recommended way to start a new plugin.
3. **LLM-native docs.** Ship `docs/llms.txt` and an `AGENTS.md` that describe the
   *entire* plugin API in a compact, paste-into-an-agent form, plus the JSON
   schema for `plugin.json` and the `.d.ts` for `ctx`. Point any agent (Claude
   Code, etc.) at these plus the SDK and it writes a correct plugin in one shot.
4. **In-app "Plugins…" panel** (account menu ▸ Developer ▸ Plugins…): the
   management surface — lists installed plugins, toggles enable/disable, reloads a
   plugin from disk, opens the plugins folder, and links to the SDK quickstart. It
   is **not** an authoring IDE: you scaffold with the CLI and edit in your own
   editor, then drop the folder into the plugins dir and reload it here.
5. **Example plugins** in `examples/plugins/` (word-count, a custom callout, an "AI
   summarize selection" command, a CSV→table importer) double as templates and
   integration tests, and mirror the `create-notionless-plugin` templates.

## 10. Roadmap (phased)

- **Phase 1 — Core host (MVP).** PluginHost + manifest loader + capability model +
  iframe/Worker sandbox + RPC; three surfaces: `commands`, `slash`, `editor blocks`;
  `@notionless/plugin-sdk` types; one example plugin; `node --check` + a sandbox
  escape test in CI.
- **Phase 2 — UI & integration surfaces.** `ui.panel`/`toolbarItem`/`statusItem`,
  `ctx.events`, `ctx.ai` provider registration, import/export formats, per-plugin
  `storage`.
- **Phase 3 — DX & AI authoring.** `@notionless/plugin-sdk`, the
  `create-notionless-plugin` scaffolder, `llms.txt`/`AGENTS.md`, and the in-app
  "Plugins…" panel (install/enable/disable/reload + SDK quickstart link).
- **Phase 4 — Trust & ecosystem.** Signature verification, the static registry,
  capability-diff on update, optional `fs:*`/`net:*` with stricter prompts.

## 11. Licensing — core vs. plugin boundary (important)

The app and the signaling relay are **AGPL-3.0** (strong copyleft: a hosted fork
must publish its source — anti-SaaS, matches the local-first ethos).

Pure AGPL on the core would create friction for a plugin ecosystem: a third-party
plugin that links into AGPL code could be deemed a derivative work and forced to be
AGPL too — discouraging authors (including commercial ones). We resolve this **by
design**:

- Third-party plugins run **sandboxed**, communicating only over a stable,
  documented RPC API — they are **not linked** into the core and are independent
  works. (This is the FSF-recognized "separate process / arms-length interface"
  distinction.)
- **`@notionless/plugin-sdk` is licensed Apache-2.0/MIT**, so building against the
  API never pulls in AGPL obligations.
- A short **plugin exception** in the repo states explicitly that plugins using the
  documented plugin API are not considered derivative works of the AGPL core.

Result: the core stays strongly protected from closed SaaS forks, while **anyone —
including for-profit authors — can write and license plugins however they want.**

Contributions to the core use a **DCO** (`Signed-off-by`) sign-off, leaving the
door open to a future commercial dual-license held by Naridon Inc.
