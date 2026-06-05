# Notionless Plugin API — FROZEN CONTRACT v1 (`apiVersion: "1"`)

> Status: **FROZEN**. This document is the single source of truth every engineer
> builds against. Method signatures, message shapes, channel names, manifest
> keys, capability strings, and file paths in this document are **normative** and
> MUST NOT change without bumping `apiVersion` to `"2"`.
>
> This is **greenfield** wiring. There is no existing plugin system in the
> codebase. Every "extension point" referenced here is a host-owned registry we
> ADD; we then route the existing hardcoded code paths (the giant `app.innerHTML`
> in `main.js`, the `rebindEditor` per-doc rebuild, `buildDecorations` in
> `cm-hide-markers.js`, the slash array, the `cmd:*` event bus, `openClaimDialog`,
> the `rag-engine` if/else, etc.) through those registries.
>
> Conventions referenced verbatim from the host: secrets ride
> `auth:secure-save` / `auth:secure-load` (safeStorage, base64 under `secure_<key>`);
> non-secret config rides `settings:get` / `settings:set`; request/response IPC is
> `ipcMain.handle('namespace:action', …)` returning a JSON-serializable
> `{ ok, …, error? }` and never throwing across the boundary; `window.api.invoke`
> is an un-allowlisted passthrough so new `plugin:*` handlers need **zero** preload
> edits.

---

## 0. Design axioms (read first)

1. **Deny-by-default.** A plugin gets nothing it did not declare in
   `capabilities[]`, and the host **re-checks** every privileged call at the seam
   (declare ≠ allow). A capability in the manifest only makes a call *eligible*;
   the host still verifies it on each invocation.
2. **Third-party plugins are sandboxed.** They run in an
   `<iframe sandbox="allow-scripts">` whose document hosts a `Worker`. They have
   **no** `window.api`, **no** `require`, **no** ambient `fetch`, **no** DOM access
   to the host page. All host interaction is JSON over `postMessage` (§4).
3. **No secret ever crosses the boundary.** Plugins NEVER receive identity private
   keys, the team root key (or any derived swarm/E2EE key), a raw `Y.Doc`, the
   `Awareness` object, or the E2EE `transportDoc`. They receive plaintext text
   snapshots, opaque ids, and the results of host-mediated operations only (§8).
4. **DOM is host-mediated.** A sandboxed plugin cannot touch the host DOM. Any
   "render" returns an **HTML string** or a **small vDOM** (§5.7) that the host
   sanitizes and mounts. Raw cross-realm DOM nodes are forbidden.
5. **The host never breaks.** Every adapter call into plugin code is wrapped in
   `try/catch` and a timeout. A throwing, hanging, or malformed plugin is
   disabled/quarantined; the host app keeps running. `Features.plugins` (default
   `true`) gates the whole subsystem; with it off, none of this code path runs.
6. **IDs are integers.** Every RPC `id` is a process-monotonic incrementing
   integer counter. **Never** `Date.now()`, **never** `Math.random()`,
   **never** a UUID. (Determinism + collision-freedom + easy correlation.)

---

## 1. MODULE LAYOUT (exact paths — create every file)

### 1.1 Renderer host + adapters — `src/renderer/src/plugins/`

| File | Responsibility |
|---|---|
| `src/renderer/src/plugins/plugin-host.js` | **The host.** Owns the registries (`commands`, `slash`, `blocks`, `editorExtensions`, `panels`, `sections`, `views`, `navItems`, `toolbarItems`, `statusItems`, `settings`, `aiProviders`, `loginMethods`, `formats`, `teamHooks`). Exposes `initPluginSystem(hostHooks)` (§6) that `main.js` calls exactly once. Loads enabled plugins (via `plugin:list`/`plugin:read` IPC), spins up one sandbox per plugin (`plugin-sandbox.js`), drives `activate`/`deactivate`, and fans plugin contributions into the host hooks. Pure orchestration; holds **no** secrets. |
| `src/renderer/src/plugins/plugin-rpc.js` | **Host side of the wire.** `PluginRpc` class: monotonic integer id counter, `request(method, params, {timeout})` → `Promise`, `notify(method, params)` (fire-and-forget event), inbound dispatch table for plugin→host requests, timeout reaper. Transport-agnostic: takes a `{ post(msg), onMessage(cb) }` channel (§4). |
| `src/renderer/src/plugins/plugin-sandbox.js` | **Iframe lifecycle.** Creates the `<iframe sandbox="allow-scripts">` (no `allow-same-origin`), writes the bootstrap HTML (`srcdoc`) that injects `sandbox-runtime.js` + the plugin entry, owns the `MessageChannel`/`postMessage` bridge, enforces per-call timeouts and a hard "kill" (remove iframe) on misbehavior. One instance per loaded plugin. Appends the iframe (hidden, `display:none`) to `document.body`. |
| `src/renderer/src/plugins/sandbox-runtime.js` | **Code that runs INSIDE the sandbox** (iframe → Worker). Implements the plugin-facing `ctx` (§5) as thin proxies that serialize to RPC requests, plus the inbound handler for host→plugin `activate`/`deactivate`/`event`/`invoke` (callback dispatch). Bundled as a string and injected via `srcdoc`; it is the ONLY code in the sandbox besides the third-party plugin. It imports nothing from the host realm. |
| `src/renderer/src/plugins/capabilities.js` | **Capability constants + enforcement.** Exports `CAPABILITIES` (frozen enum, §3), `parseNetCapability(str)`, and `requireCapability(manifest, cap)` / `assertCapability(...)` used by every adapter at the call seam. Pure, no side effects. |
| `src/renderer/src/plugins/contrib-editor.js` | **Editor adapter.** Bridges `ctx.editor.*` to the CM6 surfaces. Owns the host-side block registry; turns each registered block into a `WidgetType` + detector + a branch fed into a single **plugin decoration StateField** (§6.4) that `buildDecorations` consults. Owns the `editorExtensions` array that `rebindEditor` appends on the next doc open. |
| `src/renderer/src/plugins/contrib-ui.js` | **UI adapter.** Bridges `ctx.ui.*` to `_ensureTopSection`, the `<main>` view containers, `.sidebar-nav-list`, `selection-toolbar` buttons, `footer .stats`, the settings overlay, `notify`, and `modal`. Mounts host-mediated vDOM/HTML. |
| `src/renderer/src/plugins/contrib-auth.js` | **Auth adapter.** Bridges `ctx.auth.registerLoginMethod(...)` into the `loginMethods` registry that `openClaimDialog` renders (§5.4). Enforces the "alternate unlock of the SAME key" invariant. |
| `src/renderer/src/plugins/contrib-ai.js` | **AI adapter.** Bridges `ctx.ai.*`. `ctx.ai.complete/embed` call the **existing** `rag-engine` backends host-side (the plugin never gets the API key). `ctx.ai.registerProvider(...)` registers into the `rag-engine` generators map (§5.3, §6). |
| `src/renderer/src/plugins/contrib-team.js` | **Team adapter.** Bridges `ctx.teams.onTeamOpen` / `registerTeamAction` to the `team:*` window CustomEvent bus and the `openP2PDoc` chokepoint. Never exposes keys or the `Y.Doc`; only ids + sanitized snapshots. |
| `src/renderer/src/plugins/plugin-lab.js` | **"Build with Claude" lab.** A docked view (`#plugin-lab-view`, §1-pattern) that calls the existing AI backend (`window.api.invoke('ai:claude-code', …)` or the rag-engine api/ollama path) with this contract as context to scaffold a plugin into a local folder, then hot-loads it via `plugin:scaffold` + `plugin:reload`. |
| `src/renderer/src/plugins/plugins.css` | All plugin-system styles (lab, manager list, sandbox host iframe hidden, settings cards, status item slots). Imported once from `main.js` alongside `style.css`. |

### 1.2 Main process

| File | Responsibility |
|---|---|
| `src/main/plugin-manager.js` | Exports `registerPluginIPC(mainWindow)` — called **from within** `registerIPCHandlers(mainWindow)` in `src/main/index.js` so registration happens exactly once after `app.whenReady`. Implements every `plugin:*` channel (§7): list/install/read/enable/disable/uninstall, gated `plugin:fs-read`/`plugin:fs-write`/`plugin:net-fetch` (capability + path/host re-check in main), `plugin:scaffold`, `plugin:reload`. Owns the plugins dir(s), the enabled-state store, and the chokidar watcher for dev hot-reload. |

### 1.3 SDK — `packages/plugin-sdk/` (license **MIT**)

| File | Responsibility |
|---|---|
| `packages/plugin-sdk/index.js` | The `definePlugin(impl)` helper + `ctx` typedefs re-export. Tiny: it exists so plugin authors get IntelliSense and a stable `export default definePlugin({ activate, deactivate })` shape. Ships as ESM. |
| `packages/plugin-sdk/types.d.ts` | Full TypeScript declarations for `PluginManifest`, `Capability`, `PluginContext` (all `ctx.*` namespaces), `Block`, `Panel`, `View`, `LoginMethod`, `AIProvider`, vDOM, RPC envelopes. Authoritative types mirror §2–§5. |
| `packages/plugin-sdk/package.json` | `name: "@notionless/plugin-sdk"`, `version: "1.0.0"`, `license: "MIT"`, `type: "module"`, `main: "index.js"`, `types: "types.d.ts"`, `exports`. |

### 1.4 Scaffolder — `packages/create-notionless-plugin/`

| File | Responsibility |
|---|---|
| `packages/create-notionless-plugin/index.js` | `npm create @notionless/plugin` CLI. Prompts id/name/template, copies a template tree (manifest + entry + `plugins.css`-free assets) into the target dir, installs `@notionless/plugin-sdk`. Also exposed programmatically so `plugin-lab.js`/`plugin:scaffold` reuses the same template engine. |
| `packages/create-notionless-plugin/templates/*` | Template trees mirroring the examples in §1.5 (one per surface). |
| `packages/create-notionless-plugin/package.json` | `name: "@notionless/create-notionless-plugin"`, `bin: { "create-notionless-plugin": "index.js" }`, `license: "MIT"`. |

### 1.5 Examples — `examples/plugins/`

| Folder | Demonstrates |
|---|---|
| `examples/plugins/word-count/` | `statusItem` + `ctx.editor.onChange` → live word/char count in `footer .stats`. Capabilities: `["editor","ui"]`. |
| `examples/plugins/custom-callout/` | `ctx.editor.registerBlock` round-tripping a `:::tip` fenced/`>`-callout to Markdown. Capabilities: `["editor"]`. |
| `examples/plugins/ai-summarize/` | `command` + `view`/`panel` that calls `ctx.ai.complete({system,prompt,onToken})`. Capabilities: `["commands","ai","ui","editor"]`. |
| `examples/plugins/magic-login/` | `ctx.auth.registerLoginMethod` (Touch ID → unlock a `safeStorage` password blob → unchanged `deriveIdentity`). Capabilities: `["auth"]`. |
| `examples/plugins/custom-section/` | `ctx.ui.sidebarSection` + `navItem` + `view`. Capabilities: `["ui","sections","views"]`. |

Each example folder contains `plugin.json`, `index.js`, and a `README.md`.

---

## 2. `plugin.json` MANIFEST SCHEMA

Every plugin ships a `plugin.json` at its root. Unknown top-level keys are ignored
(forward-compatible). Validation runs in `plugin-manager.js` (main) on install AND
in `plugin-host.js` (renderer) on load; both reject on schema failure.

### 2.1 Field reference

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | ✓ | **Reverse-DNS**, lowercase, `^[a-z0-9]+(\.[a-z0-9-]+)+$`, e.g. `com.acme.word-count`. Globally unique; the install dir is named `<id>`. |
| `name` | string | ✓ | Human display name. ≤ 60 chars. |
| `version` | string | ✓ | Semver `x.y.z`. |
| `apiVersion` | string | ✓ | MUST be `"1"` for this contract. Host refuses to load a mismatch. |
| `description` | string | ✓ | ≤ 200 chars. |
| `author` | string | ✓ | Free text / email / url. |
| `license` | string | ✓ | SPDX id (e.g. `MIT`). |
| `entry` | string | ✓ | Relative path to the ESM entry module (default `index.js`). Resolved inside the plugin dir; path traversal (`..`) rejected. |
| `capabilities` | string[] | ✓ | Subset of §3 capability strings. `[]` is allowed (a no-capability plugin can still register commands? **No** — `commands` is itself a capability; `[]` ⇒ inert). |
| `contributes` | object | – | Static, declarative contributions the host can wire **before** `activate` (so the UI shows even pre-activation). All sub-keys optional; see §2.3. Dynamic registration in `activate(ctx)` is also allowed and is re-checked the same way. |
| `minHostVersion` | string | – | Semver; host refuses older. |
| `icon` | string | – | Relative path to a PNG/SVG in the plugin dir. |

### 2.2 `contributes` sub-keys (all arrays/objects of declarative descriptors)

```
contributes: {
  commands:     Array<{ id, title, key?, when? }>,
  slash:        Array<{ label, icon, md?, mdAfter?, block?, command? }>,
  blocks:       Array<{ type, fence?, match? }>,            // detection hints; impl supplied at runtime
  panels:       Array<{ id, title, location: 'right'|'left'|'bottom' }>,
  sections:     Array<{ id, title, order }>,                 // sidebar top sections
  views:        Array<{ id, title, icon? }>,                 // full replace-the-editor views
  navItems:     Array<{ id, label, icon, target }>,          // target = view id or 'command:<id>'
  toolbarItems: Array<{ id, icon, title }>,                  // selection toolbar
  statusItems:  Array<{ id, location: 'footer'|'header' }>,
  settings:     Array<{ id, title }>,                        // settings overlay sections
  aiProviders:  Array<{ id, label, icon?, retrievalMode?: 'tfidf'|'hybrid' }>,
  loginMethods: Array<{ id, label }>,
  formats:      Array<{ id, label, ext, direction: 'import'|'export'|'both' }>,
  teamHooks:    Array<'open'|'updated'>                      // which team lifecycle events it wants
}
```

### 2.3 FULL EXAMPLE

```json
{
  "id": "com.acme.toolkit",
  "name": "Acme Toolkit",
  "version": "1.2.0",
  "apiVersion": "1",
  "description": "Word count, a custom callout block, an AI summary command, and a Touch-ID login.",
  "author": "Acme Corp <dev@acme.example>",
  "license": "MIT",
  "entry": "index.js",
  "icon": "icon.svg",
  "minHostVersion": "1.0.0",
  "capabilities": [
    "commands",
    "editor",
    "ui",
    "sections",
    "views",
    "ai",
    "auth",
    "storage",
    "fs:read",
    "net:api.acme.example"
  ],
  "contributes": {
    "commands": [
      { "id": "acme.summarize", "title": "Summarize note", "key": "Mod-Shift-S", "when": "editorFocus" }
    ],
    "slash": [
      { "label": "Tip callout", "icon": "<i class=\"fas fa-lightbulb\"></i>", "md": ":::tip\n", "mdAfter": "\n:::" }
    ],
    "blocks": [
      { "type": "acme-tip", "fence": ":::tip" }
    ],
    "panels": [
      { "id": "acme.summary", "title": "Summary", "location": "right" }
    ],
    "sections": [
      { "id": "acme.bookmarks", "title": "Bookmarks", "order": 3 }
    ],
    "views": [
      { "id": "acme.dashboard", "title": "Acme", "icon": "<i class=\"fas fa-cubes\"></i>" }
    ],
    "navItems": [
      { "id": "acme.nav", "label": "Acme", "icon": "<i class=\"fas fa-cubes\"></i>", "target": "acme.dashboard" }
    ],
    "toolbarItems": [
      { "id": "acme.highlight", "icon": "fa-highlighter", "title": "Highlight" }
    ],
    "statusItems": [
      { "id": "acme.wc", "location": "footer" }
    ],
    "settings": [
      { "id": "acme.settings", "title": "Acme Toolkit" }
    ],
    "aiProviders": [
      { "id": "acme-cloud", "label": "Acme Cloud", "retrievalMode": "hybrid" }
    ],
    "loginMethods": [
      { "id": "acme.touchid", "label": "Unlock with Touch ID" }
    ],
    "formats": [
      { "id": "acme.opml", "label": "OPML", "ext": "opml", "direction": "both" }
    ],
    "teamHooks": ["open", "updated"]
  }
}
```

---

## 3. CAPABILITIES — enum, grant, and host RE-CHECK (declare ≠ allow)

`capabilities.js` exports the frozen set. Each capability gates a namespace/method.
The manifest list makes calls *eligible*; the host re-checks on **every** call via
`requireCapability(manifest, cap)` at the adapter seam (renderer) AND, for `fs:*` /
`net:*`, again in `plugin-manager.js` (main) — defense in depth, because the
renderer is the less-trusted half.

```js
export const CAPABILITIES = Object.freeze({
  COMMANDS:   'commands',
  EDITOR:     'editor',
  UI:         'ui',
  SECTIONS:   'sections',
  VIEWS:      'views',
  AI:         'ai',
  AUTH:       'auth',
  TEAMS:      'teams',
  STORAGE:    'storage',
  FS_READ:    'fs:read',
  FS_WRITE:   'fs:write',
  // 'net:<host>' is dynamic, parsed by parseNetCapability
  CLIPBOARD:  'clipboard',
})
```

| Capability | Grants | Host RE-CHECK at the seam |
|---|---|---|
| `commands` | `ctx.commands.register/execute`; `contributes.commands`. | `contrib-ui`/host verifies `commands` before adding to the registry and before `execute`. Command ids are namespaced to the plugin id; cross-plugin `execute` of another plugin's id is denied unless that id is public (host policy: deny by default). |
| `editor` | `ctx.editor.*` (registerBlock, registerDecoration, onChange, getActive, insert). | `contrib-editor` checks `editor` on each registration and on each `insert`. `insert` is range-validated host-side (clamped to current doc length); the plugin never gets the `EditorView`. |
| `ui` | `ctx.ui.panel/navItem/toolbarItem/statusItem/notify/modal`. | `contrib-ui` checks `ui`. All HTML/vDOM sanitized (§5.7) regardless. |
| `sections` | `ctx.ui.sidebarSection(...)`. | Separate from `ui` so a plugin can add toolbar items without owning sidebar real estate. Checked in `contrib-ui` before `_ensureTopSection`. Section id namespaced; plugin may only touch its own `#<id>-list`. |
| `views` | `ctx.ui.view(...)` (full replace-the-editor view) + `settingsSection`. | Checked before injecting the `#plugin-<id>-view` container and before show/hide. |
| `ai` | `ctx.ai.complete/embed/registerProvider`. | `contrib-ai` checks `ai`. `complete`/`embed` run host-side against the user's configured rag-engine backend; the plugin gets only streamed tokens / vectors, never the key/endpoint. `registerProvider` requires `ai`; a provider that needs network egress ALSO needs a matching `net:<host>`. |
| `auth` | `ctx.auth.registerLoginMethod(...)`. | `contrib-auth` checks `auth`. The method may only return `{password}` or `{publicKey, privateKey}` that the host feeds into the **unchanged** `deriveIdentity`/roster tail; it cannot mutate roster ops. The host validates that a returned keypair pubkey matches the canonical roster winner before accepting (§8). |
| `teams` | `ctx.teams.onTeamOpen/registerTeamAction`; `contributes.teamHooks`. | `contrib-team` checks `teams`. Plugin receives `{teamId, teamName, members:[{username,displayName,publicKey}]}` — **never** keys or the `Y.Doc`. Team actions are dispatched as `cmd:*` events host-side; the plugin cannot call `p2pTeamManager` directly. |
| `storage` | `ctx.storage.get/set/delete` (namespaced). | Host prefixes every key with `plugin:<id>:` and persists via `settings:get/set`. A plugin cannot read another plugin's or the host's settings. No `auth:secure-*` (secrets are host-only). |
| `fs:read` | `ctx.fs.read(path)`, `ctx.fs.list(dir)`. | **Main re-check.** `plugin-manager` resolves the path under the **workspace root only**, rejects `..`/symlink escapes, and verifies the calling plugin declared `fs:read`. Renderer also pre-checks. |
| `fs:write` | `ctx.fs.write(path, data)`. | Same as `fs:read` plus write allow-list: only inside the workspace, never inside `.notionless/` (manifest/identity), never inside another plugin's dir. Double-checked in main. |
| `net:<host>` | `ctx.net.fetch(url, init)` to exactly `<host>` (and subpaths). Multiple `net:*` allowed. | **Main re-check.** `plugin:net-fetch` parses the URL host and matches it against the plugin's declared `net:<host>` set (exact host, or `*.host` wildcard if declared). No allow-list match ⇒ `{ok:false}`. Method/size/timeout bounded. Localhost-only AI egress allow-list (`ALLOWED_AI_HOSTS`) is unaffected — plugin net is a separate, per-plugin allow-list. |
| `clipboard` | `ctx.ui.clipboardWrite(text)` / `clipboardRead()`. | Checked in `contrib-ui`; routed through a host-mediated, user-gesture-bound clipboard call (no silent reads). |

`parseNetCapability('net:api.acme.example')` → `{ host: 'api.acme.example', wildcard:false }`;
`net:*.acme.example` → `{ host: 'acme.example', wildcard:true }`. Bare `net:*` is **rejected** (too broad).

---

## 4. RPC PROTOCOL (host ⇄ sandboxed plugin, `postMessage` JSON)

Transport: `MessageChannel`. The host posts on its port; `sandbox-runtime.js` posts
back. Every message is a plain JSON object (structured-clone-safe; no functions, no
DOM, no class instances). `plugin-rpc.js` implements both directions.

### 4.1 Envelope types

There are exactly four message `type`s:

```ts
// request: caller expects a matching response with the same id
type Request = {
  type: 'request',
  id: number,           // monotonic integer (see §4.3)
  method: string,       // e.g. 'host.editor.insert', or 'plugin.activate'
  params: any           // JSON-serializable
}

// response: success reply to a request
type Response = {
  type: 'response',
  id: number,           // echoes the request id
  result: any           // JSON-serializable
}

// error: failure reply to a request
type ErrorMsg = {
  type: 'error',
  id: number,           // echoes the request id
  error: { code: string, message: string, data?: any }
}

// event: fire-and-forget; NO response expected; id is informational only
type EventMsg = {
  type: 'event',
  id: number,           // still a monotonic int, for logging/ordering
  method: string,       // e.g. 'host.event.note:open' or 'plugin.callback'
  params: any
}
```

Error `code` is one of:
`CAPABILITY_DENIED`, `BAD_PARAMS`, `NOT_FOUND`, `TIMEOUT`, `INTERNAL`,
`UNSUPPORTED_METHOD`, `QUARANTINED`, `HOST_DISPOSED`.

### 4.2 Direction & methods

- **Host → plugin requests:** `plugin.activate` (params: `{ ctxDescriptor }`),
  `plugin.deactivate` (params: `{}`). Plugin must respond within
  `ACTIVATE_TIMEOUT_MS` (5000) / `DEACTIVATE_TIMEOUT_MS` (2000).
- **Host → plugin events:** `host.event.<name>` (note:open, note:save, note:change,
  team:updated, file:changed — §5.8) and `plugin.callback` (params:
  `{ token: number, args: any[] }`) used to invoke a callback the plugin previously
  registered (e.g. an `onToken` for AI streaming, or a `render()` re-render request).
- **Plugin → host requests:** `host.<namespace>.<method>` — every `ctx` method (§5)
  that returns data. Each carries an implicit `capability` the host re-checks.
- **Plugin → host events:** `host.notify.<channel>` for fire-and-forget signals the
  plugin emits (rare; most plugin→host is request/response).

### 4.3 ID scheme (NORMATIVE)

Each side owns ONE counter:

```js
// plugin-rpc.js (host side) AND sandbox-runtime.js (plugin side) each:
let _id = 0
function nextId() { _id += 1; return _id }   // 1,2,3,…  monotonic integer
```

- IDs MUST be produced **only** by `nextId()`. Using `Date.now()`, `performance.now()`,
  `Math.random()`, `crypto.randomUUID()`, or any non-deterministic / time-based value
  is a **contract violation** and will fail review.
- Request and response correlate by exact integer equality.
- Counters are independent per side and per channel; they never reset within a
  sandbox lifetime. A fresh sandbox starts again at `1`.
- `event` messages still consume an id from the same counter (for ordering/logging)
  but never expect a reply.

### 4.4 Timeouts

```js
const RPC_TIMEOUT_MS       = 8000   // default for host.<...> plugin→host requests
const ACTIVATE_TIMEOUT_MS  = 5000
const DEACTIVATE_TIMEOUT_MS= 2000
const AI_STREAM_IDLE_MS    = 30000  // max gap between onToken callbacks before abort
```

`plugin-rpc.js` keeps a `Map<id, {resolve, reject, timer}>`. On send it arms a
`setTimeout` that rejects with `{code:'TIMEOUT'}` and removes the entry. A late
response for a reaped id is dropped. If a plugin misses `ACTIVATE_TIMEOUT_MS`, the
host marks it **QUARANTINED**, calls `plugin-sandbox.dispose()` (removes the iframe),
and surfaces a non-blocking `notify` — the host app continues.

### 4.5 Activate / deactivate handshake

```
host                                   plugin (sandbox-runtime.js)
 │  request {id:1, method:'plugin.activate',                       │
 │            params:{ ctxDescriptor }}  ───────────────────────►  │
 │                                       (builds ctx proxies,      │
 │                                        runs plugin.activate(ctx))│
 │  ◄───────────────  response {id:1, result:{ ok:true,            │
 │                              registered:{commands:[...],...} }}  │
 │  …steady state: events + plugin→host requests…                  │
 │  request {id:N, method:'plugin.deactivate', params:{}} ──────►  │
 │  ◄───────────────  response {id:N, result:{ ok:true }}          │
 │  host disposes the sandbox iframe                               │
```

`ctxDescriptor` is a **plain JSON manifest of available namespaces/methods** (per the
plugin's granted capabilities) — NOT functions. `sandbox-runtime.js` builds the real
`ctx` proxy objects locally from that descriptor; each proxy method just packages a
`host.<ns>.<method>` request. This is how "JSON-only boundary" + "ergonomic `ctx` API"
coexist.

---

## 5. THE `ctx` API handed to `activate(ctx)`

Plugin entry shape (via SDK):

```js
// packages/plugin-sdk/index.js
export function definePlugin(impl) { return impl }  // { activate, deactivate }

// a plugin's index.js
import { definePlugin } from '@notionless/plugin-sdk'
export default definePlugin({
  async activate(ctx) { /* register contributions, set listeners */ },
  async deactivate() { /* optional cleanup */ }
})
```

> **Boundary rule (applies to every signature below):** all arguments and return
> values are JSON-serializable. Functions passed in (callbacks like `onToken`,
> `render`, `onChange`, `authenticate`, event handlers) are **not** sent across the
> wire; `sandbox-runtime.js` stores them in a local `Map<token:number, fn>` and
> sends the host a `token`. The host invokes them later via a
> `plugin.callback {token, args}` event, which `sandbox-runtime.js` dispatches back
> to the stored function. Tokens use the same monotonic integer scheme.

### 5.1 `ctx.commands` — capability `commands`

```ts
ctx.commands.register(cmd: {
  id: string,                          // namespaced under plugin id by host
  title: string,
  key?: string,                        // CM6 keybinding, e.g. 'Mod-Shift-S'
  when?: 'editorFocus' | 'always',
  run: () => void | Promise<void>      // callback token under the hood
}): Disposable
ctx.commands.execute(id: string, payload?: any): Promise<any>   // only own/public ids
ctx.commands.list(): Promise<Array<{ id: string, title: string }>>  // own + public
```

Host wiring: `register` → adds to the command registry; if `key` present and
capability `editor` granted, also emits a `keymap.of([...])` into the editor
extensions array (§6.4). `execute` dispatches `window.dispatchEvent(new CustomEvent('cmd:'+id, {detail}))` host-side; the registry handler (added in `main.js init()` via `initPluginSystem`) routes back to the plugin's `run` token.

### 5.2 `ctx.editor` — capability `editor`

```ts
ctx.editor.registerBlock(block: {
  type: string,                                   // unique within plugin
  // detection: which Markdown the block owns. Provide ONE:
  fence?: string,                                 // e.g. ':::tip'  → matches a ```/::: fence line
  match?: { node: 'FencedCode'|'Blockquote'|'HTMLBlock'|'Table', test: RegExp|string },
  parseMarkdown: (raw: string) => any,            // raw block source → JSON model
  render: (model: any) => VDOM | string,          // JSON model → host-mounted vDOM/HTML (§5.7)
  toMarkdown: (model: any) => string,             // JSON model → Markdown (round-trip)
  interactive?: boolean                           // false ⇒ ignoreEvent; true ⇒ edits dispatch via host
}): Disposable

ctx.editor.registerDecoration(dec: {
  // overlap-SAFE Decoration.mark only (cm-suggest/cm-highlight style)
  scan: (text: string) => Array<{ from: number, to: number, class: string, attrs?: object }>
}): Disposable

ctx.editor.onChange(handler: (e: {
  docId: string, text: string, changedRanges: Array<{from:number,to:number}>
}) => void): Disposable

ctx.editor.getActive(): Promise<{
  docId: string | null, text: string, selection: { from: number, to: number }
} | null>

ctx.editor.insert(payload: {
  text: string,
  at?: number,                  // default = current cursor; host clamps to [0, docLen]
  replaceSelection?: boolean
}): Promise<{ ok: boolean }>
```

**Round-trip mechanism (mirrors `cm-hide-markers.js`):** `registerBlock` is the
host-mediated equivalent of hand-writing a `WidgetType`. `contrib-editor` synthesizes,
host-side, a `class PluginBlockWidget extends WidgetType` whose:
- `eq(other)` compares by `raw` source text (re-render only on text change),
- `toDOM(view)` mounts the sanitized vDOM returned by the plugin's `render(model)`
  (called via the callback bridge; the result is cached and only re-requested when
  `raw` changes — synchronous DOM is built from the **last** vDOM, async refreshes
  re-trigger a decoration recompute),
- `ignoreEvent()` returns `!interactive`.

Detection (`fence`/`match`) is compiled into a branch the host adds to its **single
plugin decoration StateField** (§6.4), which is itself consulted by
`buildDecorations`/the plugin extension. The widget is `Decoration.replace({widget, block:true})` gated on `!cursorInRange` so raw Markdown is revealed for editing — identical to native blocks. The plugin's `toMarkdown(model)` is the on-edit serializer for `interactive` blocks; the host dispatches the `view.dispatch({changes})` (the plugin never holds the view) and registers the range in `atomicRanges`. The host enforces the **overlap invariant** by registering plugin replace-ranges into the same `replaceBlockRanges` guard set; a plugin block that would overlap a native/another-plugin replace is **skipped** (logged), never thrown.

### 5.3 `ctx.ai` — capability `ai`

```ts
ctx.ai.complete(opts: {
  system?: string,
  prompt: string,
  onToken?: (t: string) => void,         // streamed; callback token
  citations?: Array<{ id: string, text: string }>
}): Promise<{ text: string }>            // resolves on completion

ctx.ai.embed(text: string | string[]): Promise<number[] | number[][]>

ctx.ai.registerProvider(provider: {
  id: string,
  label: string,
  icon?: string,
  retrievalMode?: 'tfidf' | 'hybrid',
  generate: (system: string, prompt: string,
             onToken: (t:string)=>void,
             onComplete: ()=>void,
             citations: any[]) => void,   // mirrors rag-engine backend signature
  configure?: () => void,
  friendlyError?: (msg: string) => string
}): Disposable
```

`complete`/`embed` run **host-side** through the user's existing `rag-engine`
backend (`_generateApi`/`_generateClaudeCode`/local). The plugin never sees the API
key, endpoint, or model — only tokens/vectors. `registerProvider` registers into the
rag-engine **generators map** (we refactor the 3-way if/else into
`this._generators[aiMode]` and add `RAGEngine.registerProvider(id, impl)` — §6). A
provider's `generate` callback is invoked via the bridge with the streamed-token
callback marshaled back. A provider declaring `retrievalMode:'hybrid'` overrides the
`configureBackend()` `searchMode='tfidf'` default for non-local modes. A provider
that does network egress MUST also declare a `net:<host>` capability; its `generate`
fetches via `ctx.net.fetch` (gated), not ambient `fetch`.

### 5.4 `ctx.auth` — capability `auth`

```ts
ctx.auth.registerLoginMethod(method: {
  id: string,
  label: string,
  isAvailable?: (teamId: string) => Promise<boolean>,
  render?: (mountToken: number) => VDOM | string,   // optional custom card body
  authenticate: (ctxArg: {
    teamId: string,
    username: string,
    profile: { username: string, displayName?: string, publicKey?: string } | null
  }) => Promise<
    | { password: string }                 // (a) credential-source: feed unchanged deriveIdentity
    | { publicKey: string, privateKey: string }  // (b) key-at-rest restore
  >
}): Disposable
```

**Invariant (NORMATIVE):** a login method is an *alternate unlock of the SAME key*,
never an alternate identity proof. `openClaimDialog`'s post-unlock tail is unchanged:
the host runs `deriveIdentity` (case a) or skips derivation (case b), then
`roster.login/claim` → `identity.setIdentity` → `manager.refreshPresence` →
`'team:identity-ready'`. In case (b) the host **verifies** the returned `publicKey`
equals the roster's canonical winner before accepting; mismatch ⇒ rejected. The
plugin never touches `team-roster.js` op formats. Secrets (the password blob / cached
private key) live behind `auth:secure-save`/`auth:secure-load` + `auth:prompt-touch-id`
— invoked **host-side** on the plugin's behalf; the plugin only triggers the flow and
receives the unlocked credential transiently (never persisted in plugin storage).

### 5.5 `ctx.teams` — capability `teams`

```ts
ctx.teams.onTeamOpen(handler: (t: {
  teamId: string,
  teamName: string,
  members: Array<{ username: string, displayName?: string, publicKey: string }>
}) => void): Disposable

ctx.teams.registerTeamAction(action: {
  id: string,
  label: string,
  icon?: string,
  run: (teamId: string) => void | Promise<void>
}): Disposable

ctx.teams.list(): Promise<Array<{ teamId: string, teamName: string }>>
```

`onTeamOpen` fires from `contrib-team`'s subscription to the `team:*` window
CustomEvent bus (`team:list-updated`, `team:tree-updated`, `team:roster-updated`,
`team:identity-ready`) — the plugin receives **sanitized** snapshots (ids + public
roster fields). NEVER the `teamRootKey`, swarm/E2EE keys, the root `Y.Doc`, or
`Awareness`. `registerTeamAction` adds a button in the team UI that, on click,
dispatches a `cmd:*` event host-side and routes to the plugin's `run` token.

### 5.6 `ctx.storage` — capability `storage`; `ctx.fs` — `fs:read`/`fs:write`; `ctx.net` — `net:<host>`; `ctx.ui`

```ts
// storage — namespaced; host prefixes keys with `plugin:<id>:`, persists via settings:get/set
ctx.storage.get(key: string): Promise<any>
ctx.storage.set(key: string, value: any): Promise<{ ok: boolean }>   // value JSON-serializable
ctx.storage.delete(key: string): Promise<{ ok: boolean }>
ctx.storage.keys(): Promise<string[]>                                // own namespace only

// fs — gated; main re-checks path under workspace root, rejects '..'/symlink escape
ctx.fs.read(path: string): Promise<string>                           // requires fs:read
ctx.fs.list(dir: string): Promise<Array<{ name: string, path: string, dir: boolean }>>  // fs:read
ctx.fs.write(path: string, data: string): Promise<{ ok: boolean }>   // requires fs:write

// net — gated; main re-checks URL host against declared net:<host> set
ctx.net.fetch(url: string, init?: {
  method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE',
  headers?: Record<string,string>,
  body?: string
}): Promise<{ status: number, headers: Record<string,string>, body: string }>
```

```ts
// ui — capability ui (sections also needs `sections`, views also needs `views`)
ctx.ui.panel(p: {
  id: string, title: string, location: 'right'|'left'|'bottom',
  render: (mountToken: number) => VDOM | string,
  onEvent?: (e: { action: string, payload?: any }) => void   // delegated DOM events (§5.7)
}): Disposable

ctx.ui.sidebarSection(s: {                                    // requires `sections`
  id: string, title: string, order: number,
  render: () => VDOM | string,
  headerAction?: { icon: string, command: string }           // dispatches cmd:<command>
}): Disposable

ctx.ui.view(v: {                                              // requires `views`
  id: string, title: string, icon?: string,
  render: (mountToken: number) => VDOM | string
}): { show(): void } & Disposable

ctx.ui.navItem(n: { id: string, label: string, icon: string, target: string }): Disposable
ctx.ui.toolbarItem(t: { id: string, icon: string, title: string,
  run: (sel: { from:number, to:number, text:string }) => void }): Disposable
ctx.ui.statusItem(st: { id: string, location?: 'footer'|'header' }): {
  set(text: string | { html: string }): void
} & Disposable
ctx.ui.settingsSection(se: { id: string, title: string,    // requires `views`
  render: (mountToken: number) => VDOM | string }): Disposable

ctx.ui.notify(n: { message: string, kind?: 'info'|'success'|'warn'|'error', timeout?: number }): void
ctx.ui.modal(m: { title: string, body: VDOM | string,
  buttons?: Array<{ id: string, label: string, primary?: boolean }> }): Promise<{ button: string }>

ctx.ui.clipboardWrite(text: string): Promise<{ ok: boolean }>   // requires `clipboard`
ctx.ui.clipboardRead(): Promise<string>                          // requires `clipboard`, user-gesture
```

### 5.7 vDOM (the host-mounted render shape) — NORMATIVE

Plugins **never** return DOM nodes. `render()`/`body` returns EITHER a sanitized HTML
string OR this minimal vDOM (the host mounts and sanitizes it; event handlers are
declared as `on:<event>` strings dispatched back to the plugin via `onEvent`):

```ts
type VNode = {
  tag: string,                                   // allow-list: div,span,p,h1..h4,ul,ol,li,
                                                  //   a,button,input,textarea,select,option,
                                                  //   img,pre,code,table,thead,tbody,tr,td,th,
                                                  //   strong,em,br,hr,label,i,svg(subset)
  attrs?: Record<string, string>,                // class,id,href,src,type,value,placeholder,
                                                  //   title,role,aria-*,data-* ; sanitized
  on?: Record<string, string>,                   // { click:'acme.summarize', input:'filter' }
                                                  //   value = action id sent to onEvent
  children?: Array<VNode | string>               // strings are textContent (escaped)
}
type VDOM = VNode | string
```

Sanitization (host, `contrib-ui`): tag/attr allow-list, `href`/`src` restricted to
`https:`/`notionless:`/relative; NO `<script>`, NO inline event attrs (only the `on`
map → delegated host listeners), NO `style` with `url()`/`expression`. HTML-string
renders go through the same DOMPurify-style allow-list. `mountToken` lets the plugin
re-render later via `ctx.ui.panel(...).update(vdom)` (the returned Disposable also
exposes `update(vdom)` for panels/views/settings).

### 5.8 `ctx.events`

```ts
ctx.events.on(event:
  'note:open' | 'note:save' | 'note:change' | 'team:updated' | 'file:changed',
  handler: (payload: any) => void
): Disposable
```

| Event | Payload (sanitized) | Host source |
|---|---|---|
| `note:open` | `{ docId, path, title }` | `rebindEditor` / tab open |
| `note:save` | `{ docId, path }` | `ProjectionManager` write |
| `note:change` | `{ docId, text, changedRanges }` | CM6 updateListener (debounced) |
| `team:updated` | `{ teamId, members }` | `team:roster-updated` / `team:list-updated` |
| `file:changed` | `{ path, type:'add'|'change'|'unlink' }` | main chokidar watcher → `message` push |

Every `Disposable` is `{ dispose(): void }`. The host auto-disposes ALL of a plugin's
registrations on `deactivate`/disable/quarantine.

---

## 6. INTERNAL REGISTRY — `initPluginSystem(hostHooks)` (the ONE entry `main.js` calls)

`plugin-host.js` exports a single function. `main.js` calls it once during `init()`
**after** the DOM (`app.innerHTML`) exists and `window.p2pTeamManager` is set, behind
`if (Features.plugins) { … }`.

```js
// src/renderer/src/plugins/plugin-host.js
export async function initPluginSystem(hostHooks) { /* … */ }

// hostHooks shape (provided by main.js; the host calls back INTO main.js through these):
{
  // ── editor ──────────────────────────────────────────────────────────────
  getEditorExtensions(): Extension[],     // returns the CURRENT plugin-contributed
                                          //   CM6 extension array; rebindEditor spreads
                                          //   this into its local `extensions` array on
                                          //   EVERY doc open (§6.4). MUST be cheap & sync.
  onEditorExtensionsChanged(cb: ()=>void),// host calls cb when a plugin (de)registers an
                                          //   extension so main.js can trigger a rebind.

  // ── commands ────────────────────────────────────────────────────────────
  registerCommand(id: string, handler: (detail:any)=>void),  // adds window 'cmd:<id>' listener
  unregisterCommand(id: string),

  // ── slash ───────────────────────────────────────────────────────────────
  registerSlash(item: SlashItem),         // pushes into SlashMenu.items (re-pointed across rebinds)
  unregisterSlash(label: string),

  // ── sidebar ─────────────────────────────────────────────────────────────
  sidebar: {
    addSection({ id, title, order, mount(listEl) }): void,  // wraps _ensureTopSection (idempotent)
    removeSection(id): void
  },

  // ── views / nav ─────────────────────────────────────────────────────────
  addView({ id, title, icon, mount(viewEl), show, hide }): { show(): void },  // injects #plugin-<id>-view
  removeView(id): void,
  addNavItem({ id, label, icon, onClick }): void,           // appends to .sidebar-nav-list
  removeNavItem(id): void,

  // ── selection toolbar / status ───────────────────────────────────────────
  addToolbarItem({ id, icon, title, onClick }): void,       // pushes into SelectionToolbar buttons
  removeToolbarItem(id): void,
  addStatusItem({ id, location }): { set(v): void },         // appends div into footer .stats / #header-right
  removeStatusItem(id): void,
  addSettingsSection({ id, title, mount(paneEl) }): void,    // builds its own overlay (team.js pattern)

  // ── ai ──────────────────────────────────────────────────────────────────
  ai: {
    registerProvider(id, impl): void,     // → RAGEngine.registerProvider (generators map)
    unregisterProvider(id): void,
    complete(opts): Promise<{text}>,       // host runs current rag-engine backend
    embed(textOrArr): Promise<number[]|number[][]>
  },

  // ── auth ────────────────────────────────────────────────────────────────
  auth: {
    registerLoginMethod(method): void,    // pushes into loginMethods[] that openClaimDialog renders
    unregisterLoginMethod(id): void
  },

  // ── teams ───────────────────────────────────────────────────────────────
  teams: {
    list(): Array<{teamId,teamName}>,
    addTeamAction({ id, label, icon, onClick }): void,
    removeTeamAction(id): void
  },

  // ── storage / fs / net (renderer→main IPC façade; host re-checks caps) ────
  storage: { get(ns,key), set(ns,key,val), delete(ns,key), keys(ns) },
  fs:      { read(pluginId, path), list(pluginId, dir), write(pluginId, path, data) },
  net:     { fetch(pluginId, url, init) },

  // ── lifecycle event bus the host subscribes to and re-emits to plugins ────
  on(event: 'note:open'|'note:save'|'note:change'|'team:updated'|'file:changed', cb): void
}
```

`initPluginSystem` returns a controller:
`{ list(): PluginRecord[], enable(id), disable(id), reload(id), dispose() }` that
`plugin-lab.js` and the plugin-manager UI drive.

### 6.4 How dynamically-registered CM6 extensions reach the rebuilt editor

The editor `EditorView` is **destroyed and recreated on every doc open** (`rebindEditor`
in `main.js`), and there is **no Compartment for feature extensions**. Therefore:

1. **Stable container extension.** `contrib-editor.js` owns a **single, stable
   CM6 extension** `pluginEditorExtension` = `[ pluginDecoField, pluginKeymap.of(...) ]`
   where `pluginDecoField` is a `StateField<DecorationSet>` that, on each recompute,
   asks the host block/decoration registry for ranges (synchronously, from cached
   render output) and provides them via `EditorView.decorations`. Registered
   `Decoration.mark` decorations (overlap-safe) and plugin block widgets all flow
   through this ONE field — so adding/removing a plugin block does **not** require a
   new extension object, only invalidating the field (a no-op transaction effect).
2. **Reaching `rebindEditor`.** `hostHooks.getEditorExtensions()` returns
   `[pluginEditorExtension]` (stable identity). `main.js` `rebindEditor` spreads it
   into its local `extensions` array **before** calling
   `createEditor(editorParent, { doc, extensions })`. Because it is part of the array
   passed on the next open, it survives the rebuild — this is the documented
   "dynamically added = included in the array rebindEditor passes" rule.
3. **Forcing a rebind for an already-open doc.** When a plugin registers an extension
   that must apply to the *currently open* document immediately (not just the next
   open), the host calls `onEditorExtensionsChanged(cb)`; `main.js`'s `cb` re-invokes
   `rebindEditor(currentYText, currentEngine)`. For plugin block/mark decorations,
   no rebind is needed — they live inside `pluginDecoField` and update via a state
   effect (`view.dispatch({ effects: pluginRecomputeEffect.of(null) })`), the only
   live-reconfigure-free dynamic seam available.
4. **Keymaps.** Plugin command keybindings are merged into `pluginKeymap` (also inside
   the stable extension). Overriding a default binding uses
   `Prec.highest(keymap.of([...]))` (host imports `Prec` from `@codemirror/state`).
5. **Slash / toolbar / comment-style helpers** are re-pointed across rebinds exactly
   like `slashMenu.setView(cmView)` — `contrib-editor` exposes `setView(view)` and is
   added to `rebindEditor`'s re-point block (lines ~229-261) so any plugin helper that
   holds a view reference is re-pointed, never recreated.

---

## 7. MAIN-PROCESS IPC CHANNELS (`plugin-manager.js`)

All registered inside `registerIPCHandlers(mainWindow)` via
`ipcMain.handle('plugin:action', async (_e, …args) => ({ ok, …, error? }))`. Reachable
from the renderer with zero preload edits as `window.api.invoke('plugin:action', …)`.
Handlers **catch and return** `{ ok:false, error }`; they never throw across the boundary.

**Plugin dirs (resolved at load):**
- User: `app.getPath('userData') + '/plugins/<id>/'`
- Workspace: `<workspaceRoot>/.notionless/plugins/<id>/`
Workspace plugins take precedence on id collision; both are listed.

| Channel | Params | Returns | Notes |
|---|---|---|---|
| `plugin:list` | `{}` | `{ ok, plugins: PluginRecord[] }` | `PluginRecord = { id, name, version, enabled, source:'user'\|'workspace', manifest, dir }`. |
| `plugin:install` | `{ source: { type:'folder'\|'url'\|'zip', value:string } }` | `{ ok, id }` | Folder copy / URL download / zip extract into user plugins dir. Validates manifest, rejects `..`, enforces size cap, scans for forbidden `entry` traversal. URL/zip default **disabled** after install. |
| `plugin:read` | `{ id }` | `{ ok, manifest, entrySource:string, assets?:{path:base64} }` | Returns the **source text** the renderer injects into the sandbox `srcdoc`; main never executes plugin code. |
| `plugin:enable` | `{ id }` | `{ ok }` | Flips enabled flag (persisted in `settings:set('plugin_enabled', …)`), host loads sandbox. |
| `plugin:disable` | `{ id }` | `{ ok }` | Host disposes sandbox, removes contributions. |
| `plugin:uninstall` | `{ id }` | `{ ok }` | Disables, then removes the install dir (user dir only; workspace plugins are git-managed). |
| `plugin:fs-read` | `{ id, path }` | `{ ok, data }` | **Re-checks** `fs:read` in manifest, resolves under workspace root, rejects escape/symlink. |
| `plugin:fs-write` | `{ id, path, data }` | `{ ok }` | **Re-checks** `fs:write`, write allow-list (no `.notionless/`, no other plugin dirs). |
| `plugin:net-fetch` | `{ id, url, init }` | `{ ok, status, headers, body }` | **Re-checks** URL host vs declared `net:<host>` set; bounds method/size/timeout. |
| `plugin:scaffold` | `{ template, id, name, targetDir? }` | `{ ok, dir }` | Runs the `create-notionless-plugin` template engine into user plugins dir (or `targetDir`). Used by the Lab. |
| `plugin:reload` | `{ id }` | `{ ok }` | Re-reads from disk and re-emits to host (hot reload). Dev: a chokidar watcher on the plugins dirs pushes `webContents.send('message','plugin:changed',{id})` consumed via `window.api.onMessage`, which calls `controller.reload(id)`. |

---

## 8. SECURITY INVARIANTS (NORMATIVE)

1. **Sandbox.** Third-party plugins run in `<iframe sandbox="allow-scripts">` (NO
   `allow-same-origin`, NO `allow-popups`, NO `allow-top-navigation`) whose document
   spawns a `Worker` for the plugin body. No `allow-same-origin` ⇒ the iframe is a
   unique opaque origin and cannot reach `window.parent.api`, cookies, or storage of
   the host. The iframe is `display:none`, appended to `document.body`.
2. **No host globals.** Inside the sandbox there is **no** `window.api`, **no**
   `require`/`module`, **no** Node, **no** ambient `fetch`/`XMLHttpRequest`/`WebSocket`
   (the runtime deletes/over-shadows them), **no** access to host DOM. The only I/O is
   `postMessage` to the host (mediated by `sandbox-runtime.js`).
3. **No secrets, ever.** Plugins NEVER receive: identity private keys, any public key
   beyond sanitized roster fields, the team root key or ANY derived swarm/E2EE key, a
   raw `Y.Doc`/`Y.Text`/`Awareness`, the E2EE `transportDoc`, the API key/endpoint, or
   `safeStorage` blobs. They get plaintext text snapshots, opaque `docId`/`teamId`,
   streamed AI tokens, and host-mediated operation results.
4. **Deny-by-default + re-check.** Manifest `capabilities` only make a call eligible.
   The renderer adapter re-checks the capability on **every** call; `fs:*`/`net:*` are
   re-checked AGAIN in main. Anything not granted → `{code:'CAPABILITY_DENIED'}`.
5. **Path & host confinement.** `fs:*` is confined to the workspace root (no `..`, no
   symlink escape, never `.notionless/` or other plugins' dirs). `net:*` is confined to
   exactly the declared host(s); bare `net:*` is rejected.
6. **DOM mediation.** All plugin-produced UI is HTML-string/vDOM, sanitized by the host
   allow-list (§5.7) before mounting. No cross-realm DOM nodes; no inline scripts; no
   `javascript:`/`data:` (except sanitized `img` data URLs of bounded size).
7. **Auth confinement.** A login method can only produce `{password}` or a
   `{publicKey,privateKey}` that satisfies the **unchanged** roster gate (pubkey ==
   canonical winner). It cannot alter roster op formats, cannot read other members'
   keys, and the unlocked secret is transient (never written to plugin storage).
8. **Resource bounds.** Per-call timeouts (§4.4); a hung/misbehaving plugin is
   QUARANTINED and its sandbox disposed. AI streams abort after `AI_STREAM_IDLE_MS`.
   `net`/`fs` payloads are size-capped in main.
9. **Defensive host.** Every adapter→plugin and plugin→adapter call is wrapped in
   `try/catch`; a throwing/rejecting/timed-out plugin NEVER breaks the host app. All
   plugin DOM mounts are wrapped so a render error degrades to an inline error chip,
   not a white screen.
10. **Feature flag.** `Features.plugins` (default **true**) gates the entire subsystem
    in `config.js`. When `false`, `initPluginSystem` is not called, no sandbox is
    created, and no `plugin:*` IPC is exercised. Add to `config.js`:
    ```js
    export const Features = { plugins: true, cloudSync: false /* …existing… */ }
    ```
11. **No legacy seams.** Plugins integrate only via `docEngine`/`p2pTeamManager`/
    `openP2PDoc` and the documented hooks — never via `teamManager` (forced `null`),
    `auth-client`, or the `CloudFileSystem` web branch (all legacy/slated for removal).

---

## 9. "BUILD WITH CLAUDE" — Plugin Lab flow (`plugin-lab.js`)

A docked view (`#plugin-lab-view`, injected into `<main>` and shown via a
`showPluginLabPage()` mirroring `showCompanyBrainPage()`), reachable from a nav item
`#plugin-lab-btn`. It turns a natural-language request into a working, hot-loaded
plugin using the **existing** AI backend — no new model wiring.

**Flow:**
1. **Prompt.** User types e.g. *"a status-bar item showing reading time"*.
2. **Context assembly.** The Lab loads this contract (`docs/PLUGIN_API_CONTRACT.md`)
   + the matching example from `examples/plugins/*` + the target `plugin.json` schema
   (§2) as the system/context payload.
3. **Generate.** The Lab calls the existing backend through `rag-engine`:
   - If Claude Code is available (`window.api.invoke('ai:claude-code-available')` →
     true): `window.api.invoke('ai:claude-code', { prompt, systemPrompt, files })`
     following the `ai:claude-code` safety pattern (absolute bin, `execFile`, argv,
     `cwd=temp`, timeout/maxBuffer).
   - Else the api/ollama path via `rag-engine` (`_generateApi`/local), streaming tokens
     into the Lab's preview pane.
   The model is instructed to emit a `plugin.json` + `index.js` (and optional CSS) that
   conforms to §2–§5, using only declared capabilities.
4. **Scaffold to disk.** The Lab calls
   `window.api.invoke('plugin:scaffold', { template, id, name })` to create the folder,
   then writes the generated `plugin.json`/`index.js` via `plugin:fs-write` (Lab runs
   with elevated host trust, not as a sandboxed plugin) into the user plugins dir.
5. **Hot-load.** The Lab calls `controller.enable(id)` → host reads via `plugin:read`,
   spins a sandbox, runs `activate(ctx)`, and the contribution appears live. A chokidar
   watcher (`plugin:reload`) keeps it hot on subsequent edits.
6. **Iterate.** The Lab shows the manifest, the granted/denied capabilities, a live
   console of the plugin's RPC traffic (method + integer id), and a "Regenerate" button
   that re-prompts with the previous output + any runtime error as additional context.

**Guardrails:** generated plugins are sandboxed like any other (§8); the Lab cannot
grant a capability the manifest doesn't declare; net/fs/auth capabilities surface an
explicit "this plugin requests X" confirmation before first enable.

---

## 10. Disposables, lifecycle, and ordering (summary)

- Load order per plugin: `plugin:read` → create sandbox iframe → inject runtime+entry →
  `plugin.activate` (host applies declarative `contributes` first so UI shows before
  activate resolves) → steady state → `plugin.deactivate` on disable/uninstall/quarantine
  → dispose sandbox → host auto-disposes every Disposable the plugin returned.
- Every `ctx.*` registration returns a `Disposable { dispose() }`. The host tracks them
  per plugin and disposes all on teardown; a plugin need not clean up manually (but may).
- Re-point on editor rebuild: `contrib-editor.setView(cmView)` is called from
  `rebindEditor`'s re-point block alongside `slashMenu.setView` etc.; plugin block
  widgets/decorations live in the stable `pluginDecoField`, so they survive the rebuild
  automatically and refresh via `pluginRecomputeEffect`.

---

### Appendix A — frozen constants

```js
// plugin-rpc.js
let _id = 0; const nextId = () => (_id += 1)        // monotonic integer ONLY
const RPC_TIMEOUT_MS = 8000
const ACTIVATE_TIMEOUT_MS = 5000
const DEACTIVATE_TIMEOUT_MS = 2000
const AI_STREAM_IDLE_MS = 30000

// envelope types: 'request' | 'response' | 'error' | 'event'
// error codes: CAPABILITY_DENIED | BAD_PARAMS | NOT_FOUND | TIMEOUT |
//              INTERNAL | UNSUPPORTED_METHOD | QUARANTINED | HOST_DISPOSED
```

### Appendix B — capability → namespace map (quick reference)

| Namespace/method | Required capability |
|---|---|
| `ctx.commands.*` | `commands` |
| `ctx.editor.*` | `editor` |
| `ctx.ui.panel/navItem/toolbarItem/statusItem/notify/modal` | `ui` |
| `ctx.ui.sidebarSection` | `sections` (+`ui`) |
| `ctx.ui.view`, `ctx.ui.settingsSection` | `views` (+`ui`) |
| `ctx.ui.clipboard*` | `clipboard` |
| `ctx.ai.*` | `ai` (provider net egress also needs `net:<host>`) |
| `ctx.auth.registerLoginMethod` | `auth` |
| `ctx.teams.*` | `teams` |
| `ctx.storage.*` | `storage` |
| `ctx.fs.read/list` | `fs:read` |
| `ctx.fs.write` | `fs:write` |
| `ctx.net.fetch` | `net:<host>` |
| `ctx.events.on` | (none — sanitized events available to all) |

— END OF FROZEN CONTRACT v1 —
