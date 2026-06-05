# Plugin Studio — FROZEN INTERNAL CONTRACT v1 (`apiVersion: "1"`)

> Status: **FROZEN**. This is the single source of truth the Plugin Studio builders
> implement against. Every channel name, request/response shape, file path, file
> ownership, interface signature, and invariant below is **normative** and MUST NOT
> change without re-freezing this document. Builders receive **only** what this
> contract states; if something is not here, it is out of scope.
>
> Plugin Studio is the agentic, multi-harness, UI-based plugin **builder** that
> graduates the single-shot "Generate with Claude" box in
> `src/renderer/src/plugins/plugin-lab.js`. It builds **on top of** the shipped
> plugin system (frozen contract `docs/PLUGIN_API_CONTRACT.md`, `apiVersion "1"`).
> It changes **nothing** in the runtime sandbox, the capability model, or the E2EE
> invariants — it is purely an **author-time** tool.
>
> Conventions inherited from the host (verbatim): request/response IPC is
> `ipcMain.handle('studio:action', …)` returning a JSON-serializable
> `{ ok, …, error? }` and **never throwing across the boundary**; `window.api.invoke`
> is an un-allowlisted passthrough (`src/preload/index.js:7`) so new `studio:*`
> channels need **zero** preload edits; streamed events ride the existing `message`
> channel (`webContents.send('message','studio:event',{…})` → `window.api.onMessage`,
> preload `:41`); all numeric correlation ids are **monotonic integers**, never
> `Date.now()` / `Math.random()` / UUID.

---

## 0. Axioms (read first)

1. **Author-time ≠ run-time.** Plugin Studio has two completely separate trust
   domains (§1). The harness gets **real machine access scoped to one studio
   workspace dir**. The plugin it produces still loads through the **unchanged**
   runtime sandbox with the **unchanged** capability checks. Studio grants a plugin
   **nothing** at install that the user does not approve.
2. **Off by default, consent-gated.** The whole feature is behind
   `Features.pluginStudio = envFlag('VITE_FEATURE_PLUGINS_STUDIO', false)`. First run
   shows an explicit author-time-trust consent dialog before any harness can spawn.
3. **No secrets to the harness.** The workspace dir lives **outside the notes
   vault** (under `app.getPath('userData')`) and contains only **public** docs,
   types, and examples — never notes, the identity private key, the team root key
   or any derived swarm/E2EE key, a `Y.Doc`, `Awareness`, or the `transportDoc`. The
   API key for the built-in API loop lives only in **main**; it is never exposed to
   the renderer/iframe.
4. **The host never breaks.** Every `studio:*` handler catches and returns
   `{ ok:false, error }`; it never throws across the IPC boundary. A crashing /
   hanging agent kills its own child, never the app.
5. **Reuse, don't reinvent.** Studio reuses `plugin:install` (folder source),
   `plugin:scaffold` (`targetDir`), `validateManifest`, `PluginSandbox`,
   `resolveClaudeBin`/`claudeEnv`, and the capability catalog. It adds a **separate**
   `studio:*` surface; it MUST NOT reuse `plugin:fs-*` (those are vault-confined and
   require a plugin record).

---

## 1. The trust split (NORMATIVE — restated from PLUGIN_STUDIO.md §2)

| | Author-time (the harness) | Run-time (the plugin it produces) |
|---|---|---|
| What runs | `claude` / `gemini` / a built-in API tool-loop / your editor | the finished plugin |
| Trust | **real machine access**, exactly like opening a terminal and typing `claude` | **sandboxed**: iframe + Worker, no DOM / `window.api` / `require` / ambient `fetch` |
| FS scope | the **studio workspace dir only** — under `userData/plugin-studio/`, never the notes vault, never `.notionless/`, never identity keys | host-mediated `ctx.fs`, capability-gated, vault-confined |
| Consent | explicit, opt-in, **off by default** (`Features.pluginStudio`), per-harness enable | declared capabilities, host re-checks every call |

**Author-time trust is exactly the trust of running a coding agent in a folder.** We
make it honest and bounded: a dedicated workspace dir **outside** the notes root, an
explicit one-time consent, and per-harness enable. The harness receives the **public**
contract, types, and examples — nothing else.

`studio:fs-read`/`studio:fs-write`/`studio:fs-list` are confined to the studio root
with the **same rigor** as `plugin-manager.js`'s `resolveWorkspacePath`
(`src/main/plugin-manager.js:327`), but rooted at the studio dir, not the vault:
`path.resolve(root, target)` → reject if `!== root && !startsWith(root + path.sep)` →
reject `\0` and `..` → `realpath` the deepest existing ancestor and reject if it
escapes the real root (symlink guard). The studio root is computed **fresh** from
`app.getPath('userData')` on every call; it is never the vault and never
`settings.getSync('lastProject')`.

---

## 2. Workspace layout (EXACT)

Studio build dirs live under:

```
<userData>/plugin-studio/
  counter.json                     ← persisted monotonic build counter (see buildId)
  builds/
    build-<buildId>/
      AGENTS.md                    ← harness-agnostic guide (copy of repo-root AGENTS.md + PLUGIN_AUTHOR_GUIDE)
      CLAUDE.md                    ← copy of AGENTS.md (Claude Code reads it)
      GEMINI.md                    ← copy of AGENTS.md (Gemini CLI reads it)
      .cursorrules                 ← copy of AGENTS.md (Cursor reads it)
      CAPABILITIES.md              ← LIVE catalog (generated renderer-side, written in via studio:create-workspace)
      llms.txt                     ← copy of docs/llms.txt
      types.d.ts                   ← copy of packages/plugin-sdk/types.d.ts
      docs/
        PLUGIN_API_CONTRACT.md     ← copy of the frozen runtime contract
      examples/
        word-count/  custom-callout/  ai-summarize/  magic-login/  custom-section/
      plugin/                      ← THE PLUGIN the harness writes/edits
        plugin.json
        index.js
        <assets…>                  ← e.g. style.css, icon.svg
```

Rules:
- The harness's working tree is `build-<buildId>/` (so `CLAUDE.md`/`AGENTS.md` are
  auto-read). The **deliverable** is the `plugin/` subdir only — install/export
  operate on `plugin/`, never the grounding bundle.
- `<userData>` = `app.getPath('userData')`. The studio root is
  `path.join(app.getPath('userData'), 'plugin-studio')`. **NEVER** under
  `settings 'lastProject'` (the notes vault) and **NEVER** under `<vault>/.notionless`.
- **`buildId` is a persisted monotonic integer** read from / written to
  `plugin-studio/counter.json` (`{ "next": N }`), incremented atomically per
  `studio:create-workspace`. It MUST NOT be wall-clock (`Date.now()`) or randomness.
  (`process.hrtime.bigint()` is an acceptable fallback only if the counter file is
  unreadable; the persisted counter is the canonical source.) The dir name is
  literally `build-<buildId>` (e.g. `build-7`).
- Builds are **disposable, listable, deletable**. Delete uses
  `shell.trashItem(buildDir)`; reveal uses `shell.showItemInFolder` /
  `shell.openPath`.

**Context-bundle sources (all confirmed present):**
`AGENTS.md` (repo root), `docs/llms.txt`, `packages/plugin-sdk/types.d.ts`,
`docs/PLUGIN_API_CONTRACT.md`, `examples/plugins/{word-count,custom-callout,ai-summarize,magic-login,custom-section}`,
and `PLUGIN_AUTHOR_GUIDE` from `src/renderer/src/plugins/author-guide.js`.
`CAPABILITIES.md` is **generated renderer-side** (§6) and passed into
`studio:create-workspace` as `capabilitiesMarkdown`; main writes it verbatim.

---

## 3. `studio:*` IPC CHANNELS (EXACT)

All registered in main inside `registerStudioIpc(app, { getWorkspaceRoot, getMainWindow })`
via `ipcMain.handle('studio:action', async (_e, payload) => ({ ok, …, error? }))`.
Reachable from the renderer with **zero preload edits** as
`window.api.invoke('studio:action', payload)`. Every handler **catches and returns**
`{ ok:false, error }`; never throws. When `Features.pluginStudio` is off the registrar
is not invoked, so every channel returns `{ ok:false, error:'unsupported' }` from the
renderer's defensive wrapper (and on the web build, where no main exists, the same).

`StudioPath` is always **relative to the build dir** (e.g. `plugin/index.js`,
`CAPABILITIES.md`). Absolute paths are accepted only if they resolve under the studio
root (same rule as `resolveWorkspacePath`).

### 3.1 Workspace lifecycle

| Channel | Request | Response (`ok:true` shape) |
|---|---|---|
| `studio:create-workspace` | `{ goal?:string, template?:string, capabilitiesMarkdown?:string, remixFrom?:string }` | `{ ok, buildId:number, dir:string }` |
| `studio:list-builds` | `{}` | `{ ok, builds: Array<{ buildId:number, dir:string, name:string, createdAt:number, goal?:string }> }` |
| `studio:read-build` | `{ buildId:number }` | `{ ok, manifest:object\|null, entrySource:string, assets:Record<string,string>, files:Array<{ path:string, dir:boolean }> }` |
| `studio:delete-build` | `{ buildId:number }` | `{ ok }` (via `shell.trashItem`) |
| `studio:open-external` | `{ buildId:number }` | `{ ok }` (via `shell.openPath(buildDir)`) |

- `studio:create-workspace`: allocates the next `buildId` (persisted counter), makes
  `build-<id>/`, writes the full context bundle (§2), seeds `plugin/` by either
  `plugin:scaffold`-style scaffold (with `targetDir = build-<id>/plugin`, using
  `template` → the existing template→capabilities map: `word-count`, `custom-callout`,
  `ai-summarize`, `magic-login`, `custom-section`, `blank`) OR, when `remixFrom` is a
  known example id, copies `examples/plugins/<remixFrom>/` into `plugin/`. Writes
  `capabilitiesMarkdown` verbatim to `CAPABILITIES.md`. Returns the integer `buildId`
  and absolute `dir`.
- `studio:read-build`: `manifest` is `JSON.parse(plugin/plugin.json)` (or `null` +
  no throw if missing/invalid); `entrySource` is the text of the manifest's `entry`
  (default `plugin/index.js`); `assets` maps non-entry `plugin/` file paths → base64;
  `files` is the recursive `plugin/` listing. This is the read the live preview uses.

### 3.2 Confined filesystem (studio root only)

| Channel | Request | Response (`ok:true`) |
|---|---|---|
| `studio:fs-read` | `{ buildId:number, path:StudioPath }` | `{ ok, data:string }` |
| `studio:fs-write` | `{ buildId:number, path:StudioPath, data:string }` | `{ ok }` |
| `studio:fs-list` | `{ buildId:number, dir:StudioPath }` | `{ ok, entries:Array<{ name:string, path:string, dir:boolean }> }` |

All three resolve `path`/`dir` under `studio-root/builds/build-<buildId>/` with the
full `resolveWorkspacePath`-equivalent guard (traversal + symlink + `\0`). Writes are
size-capped (reuse the existing main-side bound). These are the channels the built-in
API agent loop and the hand-edit code editor use. **They never reach the vault.**

### 3.3 Build check, export, install

| Channel | Request | Response (`ok:true`) |
|---|---|---|
| `studio:build-check` | `{ buildId:number }` | `{ ok:boolean, errors:string[] }` |
| `studio:export` | `{ buildId:number }` | `{ ok, path:string }` |
| `studio:install-build` | `{ buildId:number }` | `{ ok, id:string }` |

- `studio:build-check`: runs `node --check` on every `.js` in `plugin/` (spawn
  `process.execPath`, `['--check', file]`, cwd = `plugin/`) **and** runs
  `validateManifest(JSON.parse(plugin/plugin.json))`. Returns `ok:false` with the
  concatenated `errors[]` (syntax errors + manifest errors). **Top-level `ok` is the
  channel result (true = handler ran); the `errors[]` array carries failures** — i.e.
  the response is `{ ok:true, errors:[…] }` when the handler ran but the build is
  dirty. (Builders MUST read `errors.length`, not just `ok`.) This is the self-heal
  loop's error source.
- `studio:export`: builds a `.nlplugin` zip of the `plugin/` subdir using
  `zlib.deflateRawSync` (mirror `extractZipBuffer`'s central-directory format in
  reverse; **no new dependency** — `extractZipBuffer` proves the format). Writes to
  `build-<id>/<plugin-id>.nlplugin` (or a user-chosen path via a future dialog) and
  returns its absolute `path`.
- `studio:install-build`: reuses the **existing** `plugin:install` path. It copies
  `plugin/` into a temp folder under the studio root and calls the same `handleInstall`
  body with `{ source: { type:'folder', value:<temp plugin dir> } }`, which stages,
  manifest-validates, moves into `userData/plugins/<id>`, and **defaults DISABLED** so
  the normal capability-approval/enable flow gates activation. Returns `{ ok, id }`.

### 3.4 Agent driver

| Channel | Request | Response (`ok:true`) |
|---|---|---|
| `studio:agent-detect` | `{}` | `{ ok, providers: Array<{ id, label, kind, available:boolean, version?:string, reason?:string }> }` |
| `studio:agent-start` | `{ buildId:number, providerId:string, goal:string, model?:string }` | `{ ok, sessionId:number }` |
| `studio:agent-send` | `{ sessionId:number, message:string }` | `{ ok }` |
| `studio:agent-cancel` | `{ sessionId:number }` | `{ ok }` |

- `sessionId` is a **monotonic integer** owned by `studio-manager.js`.
- `studio:agent-detect` aggregates `detect()` from **both** provider homes (main CLI/
  external providers + the renderer-declared built-in API loop, which main reports as
  available based on the configured AI backend reachability — see §4). Renderer-side
  providers are also surfaced by the renderer directly; main's list is authoritative
  for CLI/external.
- `studio:agent-start` resolves the provider by `providerId`, calls
  `createSession({ workspaceDir: build-<id>, systemContext, goal, onEvent })`, stores
  the session under a new `sessionId`, and returns it. `systemContext` is the path-aware
  grounding pointer (the bundle is already on disk; CLI harnesses read it themselves;
  the API loop gets the author guide + `CAPABILITIES.md` text as system prompt).
- `studio:agent-send` / `studio:agent-cancel` forward to `session.send(message)` /
  `session.cancel()` (which `child.kill()`s a CLI child).

### 3.5 Streamed events (the transcript wire)

Every agent event is pushed over the existing `message` channel:

```js
webContents.send('message', 'studio:event', { sessionId:number, ev:AgentEvent })
```

The renderer subscribes via `window.api.onMessage((tag, payload) => …)` and routes
`tag === 'studio:event'` to the live transcript / file-change → hot-reload pipeline.
`AgentEvent` (`ev`) is exactly the `onEvent` payload union in §4.

---

## 4. AgentProvider interface (TWO homes, SAME shape) — NORMATIVE

There are two provider homes. They implement the **identical** interface; only where
they run differs.

- **Main-side providers** (`kind:'cli'` and `kind:'external'`) live in
  `src/main/plugin-studio/agent-providers/` and run with real machine access.
- **Renderer-side provider** (`kind:'api'`, the built-in zero-CLI tool loop) lives in
  `src/renderer/src/plugins/studio/providers/` and drives `ragEngine` generate methods,
  routing all filesystem effects through `studio:*` IPC. **It never exposes an API key
  to the plugin or the iframe.**

### 4.1 Interface

```ts
interface AgentProvider {
  id: string,                 // 'claude-code' | 'gemini-cli' | 'generic-cli' | 'external' | 'api-anthropic' | …
  label: string,
  kind: 'cli' | 'api' | 'external',
  detect(): Promise<{ available: boolean, version?: string, reason?: string }>,
  createSession(opts: {
    workspaceDir: string,        // absolute build-<id>/ dir
    systemContext: string,       // grounding text/pointer the harness expects
    goal: string,
    onEvent: (ev: AgentEvent) => void
  }): AgentSession
}

interface AgentSession {
  send(message: string): void | Promise<void>,   // follow-up user turn
  cancel(): void                                  // CLI: child.kill(); API: abort the loop
}

type AgentEvent =
  | { type: 'text',   text: string }                       // assistant prose
  | { type: 'tool',   name: string, input: any }           // a tool/command the harness ran
  | { type: 'file',   path: string, action: 'write'|'create'|'delete' }  // drives hot-reload + code editor
  | { type: 'status', text: string }                       // "running build…", "thinking…"
  | { type: 'error',  text: string }                       // surfaced AND fed back into the self-heal loop
  | { type: 'done',   summary: string }
```

`path` in a `file` event is **relative to `workspaceDir`** (e.g. `plugin/index.js`).

### 4.2 Spawn command lines (EXACT)

- **Claude Code** (`id:'claude-code'`, `kind:'cli'`): discover the binary with the
  lifted `resolveClaudeBin()` (`src/main/index.js:630`), env from `claudeEnv()`
  (`:642`). Spawn:
  ```js
  spawn(bin, ['-p', goal, '--output-format', 'stream-json', '--permission-mode', 'acceptEdits'],
        { cwd: workspaceDir, env: claudeEnv() })
  ```
  Parse line-delimited `stream-json` from `child.stdout`; map message/tool/result
  frames to `AgentEvent`s. `send()` is a follow-up turn (a fresh `-p` spawn in the
  same `cwd`, or stdin if the chosen mode supports it); `cancel()` → `child.kill()`.
- **Gemini CLI** (`id:'gemini-cli'`, `kind:'cli'`): add a `resolveGeminiBin()` twin of
  `resolveClaudeBin()` (probe `~/.local/bin/gemini`, `/opt/homebrew/bin/gemini`,
  `/usr/local/bin/gemini`, `~/.npm-global/bin/gemini`). Spawn the non-interactive
  prompt form in `cwd: workspaceDir` (it reads `GEMINI.md` + `AGENTS.md`
  automatically); stream stdout to the transcript.
- **Generic CLI** (`id:'generic-cli'`, `kind:'cli'`): a user-provided **command
  template** with `{goal}` and `{workspace}` placeholders, e.g.
  `codex exec "{goal}"` run with `cwd: {workspace}`. Substituted **as argv tokens**
  (no shell string interpolation — split the template, replace tokens, `spawn(argv[0],
  argv.slice(1))`). This is the literal "or anything you have installed" slot.
- **External** (`id:'external'`, `kind:'external'`): `createSession` immediately fires
  `onEvent({type:'status', text:'Opened workspace in your editor'})` and calls
  `shell.openPath(workspaceDir)` (or `spawn('code'|'cursor'|process.env.EDITOR,
  [workspaceDir])`). `send()`/`cancel()` are no-ops; Studio keeps watching and
  hot-reloading via the studio chokidar watcher (§3 file events → renderer).

### 4.3 Built-in API loop (`kind:'api'`, renderer)

Runs a minimal tool loop with a fixed toolset — `read_file`, `write_file`, `list_dir`,
`build_check` — implemented over the `studio:*` IPC channels (`studio:fs-read`,
`studio:fs-write`, `studio:fs-list`, `studio:build-check`). It is driven by `ragEngine`
generate methods (`_generateApi` streaming SSE, `_generateClaudeCode` via
`ai:claude-code` IPC). System prompt = the author guide + `CAPABILITIES.md`. Each tool
call and each file write emits the matching `AgentEvent` into the same transcript. The
**API key never leaves main** (the renderer sends a prompt; main holds/forwards the
key). `detect()` returns `available:true` when `ragEngine.aiMode` is `'api'` or
`'claude-code'`; **there is no `_generateLocal` on `RAGEngine`**, so the `'local'`
(Ollama) path reports `available:false, reason:'local generation unsupported'` unless a
real local generator is added later. (Do **not** import `plugin-lab.generate()` — it is
a private closure; lift its three-path logic.)

---

## 5. FILE OWNERSHIP (every new file → exactly ONE builder)

Builders create **only the new files assigned to them** and MUST NOT edit any shared
file. For shared files they return `integrationNotes` (a precise patch description)
instead. **Shared files (DO NOT EDIT — integrationNotes only):**
`src/main/index.js`, `src/renderer/src/main.js`, `src/renderer/src/features.js`,
`src/renderer/src/plugins/plugin-lab.js`, `src/renderer/src/plugins/plugin-host.js`,
`src/renderer/src/plugins/plugin-sandbox.js`, `index.html`, `src/renderer/src/style.css`,
`package.json`.

### 5.1 MAIN builder — `src/main/plugin-studio/`

| File | Responsibility |
|---|---|
| `src/main/plugin-studio/studio-manager.js` | Exports `registerStudioIpc(app, { getWorkspaceRoot, getMainWindow })`. Implements **all** `studio:*` channels (§3): workspace lifecycle, `studio:fs-*` (studio-root-confined `resolveStudioPath`), `build-check`, `export`, `install-build` (delegates to `plugin:install` folder path), and the agent driver (sessionId map, event push). Owns the studio chokidar watcher (§3.5 file events) and the persisted build counter. Idempotent (`_registered` guard), mirroring `registerPluginIpc`. |
| `src/main/plugin-studio/agent-providers/index.js` | Exports `listProviders(): AgentProvider[]` and `getProvider(id): AgentProvider\|null`. Aggregates the CLI + external providers. |
| `src/main/plugin-studio/agent-providers/claude-code.js` | The Claude Code `kind:'cli'` provider (§4.2). |
| `src/main/plugin-studio/agent-providers/gemini-cli.js` | The Gemini CLI `kind:'cli'` provider + `resolveGeminiBin()`. |
| `src/main/plugin-studio/agent-providers/generic-cli.js` | The generic-template `kind:'cli'` provider (`{goal}`/`{workspace}`). |
| `src/main/plugin-studio/agent-providers/external.js` | The "open in editor" `kind:'external'` provider. |
| `src/main/plugin-studio/cli-discovery.js` | Lifted `resolveClaudeBin`/`claudeEnv` (moved out of the `registerIPCHandlers` closure) + new `resolveGeminiBin`. Exports `{ resolveClaudeBin, claudeEnv, resolveGeminiBin }`. The shared-file edit to `index.js` (importing these here) is an **integrationNote**, not an edit by this builder. |
| `src/main/plugin-studio/zip.js` | `buildNlpluginZip(srcDir, outPath)` using `zlib.deflateRawSync` (mirror of `extractZipBuffer`). |

Cross-file imports (within MAIN builder):
`studio-manager.js` imports `{ listProviders, getProvider }` from
`./agent-providers/index.js`, `{ buildNlpluginZip }` from `./zip.js`, and
`{ resolveClaudeBin, claudeEnv, resolveGeminiBin }` from `./cli-discovery.js`. Each
provider imports from `../cli-discovery.js` as needed.

### 5.2 RENDERER builder — `src/renderer/src/plugins/studio/`

| File | Responsibility |
|---|---|
| `src/renderer/src/plugins/studio/plugin-studio.js` | Exports `createPluginStudio({ controller, ragEngine })` → `{ mount(viewEl), refresh(), dispose() }` (mirrors `createPluginLab`). The Studio view: harness picker, chat/transcript, build toolbar (Build / Fix errors / Reload / Install / Export), and panes. Web-safe (§7). |
| `src/renderer/src/plugins/studio/studio-client.js` | Thin renderer wrapper over `window.api.invoke('studio:*', …)` + `window.api.onMessage` event routing. Every method returns `{ ok:false, error:'unsupported' }` when `window.api?.invoke` is absent or returns it (web). Exports `studioClient` (or `createStudioClient()`). |
| `src/renderer/src/plugins/studio/studio-transcript.js` | Renders the streamed `AgentEvent` log (text/tool/file/status/error/done). Exports `mountTranscript(el)` → `{ push(ev), clear() }`. |
| `src/renderer/src/plugins/studio/studio-code-editor.js` | Exports `mountCodeEditor(el, { doc, language, onChange })` → `{ getText, setText, dispose }`. A standalone CM6 `EditorView` (NOT `createEditor`, which is markdown-only). Default language is plain text + `@codemirror/lang-markdown` (present). If JS/JSON highlighting is wanted, declare the `@codemirror/lang-javascript`/`@codemirror/lang-json` dependency add as an **integrationNote** (neither is in `package.json` today); degrade gracefully to plain text when absent. |
| `src/renderer/src/plugins/studio/studio-preview.js` | Exports `mountPreview(el)` → `{ render({ manifest, entrySource, assets }), dispose() }`. Spins the live preview sandbox per §6. |
| `src/renderer/src/plugins/studio/studio-capabilities-md.js` | Exports `buildCapabilitiesMarkdown(controller)` → the LIVE `CAPABILITIES.md` string (§6.3 below). Generated from `METHOD_CAPABILITY` + `describeCapability` + `controller.registrySnapshot()` + `editorRegistry`. Passed to `studio:create-workspace`. |
| `src/renderer/src/plugins/studio/providers/api-loop.js` | The renderer-side `kind:'api'` built-in tool-loop provider (§4.3). Imports `studioClient` for fs/build tools and uses the in-scope `ragEngine`. Exports `createApiLoopProvider({ ragEngine, studioClient })`. |
| `src/renderer/src/plugins/studio/studio.css` | All Studio view styles. Imported once from `plugin-studio.js` (NOT from `style.css`). |

Cross-file imports (within RENDERER builder):
`plugin-studio.js` imports `{ studioClient }` from `./studio-client.js`,
`{ mountCodeEditor }` from `./studio-code-editor.js`, `{ mountPreview }` from
`./studio-preview.js`, `{ mountTranscript }` from `./studio-transcript.js`,
`{ buildCapabilitiesMarkdown }` from `./studio-capabilities-md.js`, and
`{ createApiLoopProvider }` from `./providers/api-loop.js`. `studio-capabilities-md.js`
imports `{ METHOD_CAPABILITY, describeCapability, isSensitiveCapability }` from
`../capabilities.js` and `{ editorRegistry }` from `../contrib-editor.js`.

### 5.3 Shared-file integration (INTEGRATE phase — done via integrationNotes only)

These edits are performed by the integrate step using each builder's
`integrationNotes`; **no builder edits these files**:

1. `src/renderer/src/features.js` — add inside `Features`:
   `pluginStudio: envFlag('VITE_FEATURE_PLUGINS_STUDIO', false),` (default **false**).
2. `src/main/index.js` — `import { execFile, spawn } from 'child_process'` (add
   `spawn`); lift/relocate `resolveClaudeBin`/`claudeEnv` to `cli-discovery.js` and
   import from there; add near the `registerPluginIpc` call (`:1376`), wrapped in
   try/catch and gated by the feature flag:
   `registerStudioIpc(app, { getWorkspaceRoot: () => settings.getSync('lastProject') || null, getMainWindow: () => mainWindow })`.
3. `src/renderer/src/main.js` — add `<div id="plugin-studio-view" style="display:none"></div>`
   after `#plugin-lab-view` (`:772`); add the `#plugin-studio-btn` sidebar item after
   `#plugin-lab-btn` (`:676`); add `showPluginStudioPage()` (clone of
   `showPluginLabPage`, `:1253`, guarded by `if (!Features.pluginStudio) return`);
   construct `pluginStudio = createPluginStudio({ controller: pluginController,
   ragEngine: companyBrainCenter?.engine })` in `initPlugins()` (`:1207`) gated by
   `Features.pluginStudio`; wire the button click + a `window` `plugin-studio:open`
   listener → `showPluginStudioPage()`; hide the button when the flag is off.
4. `src/renderer/src/plugins/plugin-lab.js` — add an "Open Plugin Studio" button in
   `build()` that does `window.dispatchEvent(new CustomEvent('plugin-studio:open'))`.
   (The single-shot generate box stays.)
5. If the host-mediated preview path (§6, Option B) is chosen, add
   `controller.preview(record)` to `plugin-host.js`. (Preferred path is Option A,
   which needs no shared edit — see §6.)

---

## 6. PREVIEW MECHANISM — chosen: **Option A (direct `PluginSandbox`, no shared edit)**

`plugin-sandbox.js` exports `class PluginSandbox` **and** `default PluginSandbox`
(confirmed: `src/renderer/src/plugins/plugin-sandbox.js:75,565`). Its constructor takes
`{ id, manifest, entrySource, moduleShims?, dispatch, onQuarantine?, container }` and it
knows **nothing** about capabilities — it routes every plugin→host call to the
caller-supplied `dispatch`. Therefore `studio-preview.js` spins the preview **directly**,
with **no edit to plugin-host.js**:

```js
import PluginSandbox from '../plugin-sandbox.js'
import { validateManifest } from '../plugin-host.js'        // exported
import { CAPABILITIES, hasCapability, capabilityForMethod } from '../capabilities.js' // exported

async function render({ manifest: raw, entrySource, assets }) {
  const { ok, manifest, errors } = validateManifest(raw)
  if (!ok) { showErrors(errors); return }
  const ctxDescriptor = buildPreviewCtxDescriptor(manifest)   // { apiVersion:'1', pluginId, capabilities, namespaces }
  const sb = new PluginSandbox({
    id: manifest.id, manifest, entrySource,
    container: hiddenHost,
    onQuarantine: (id, reason) => showErrors([reason]),
    dispatch: (ns, method, args) => {
      // re-check the capability EXACTLY like the host, using exported helpers
      const cap = capabilityForMethod(`${ns}.${method}`)
      if (cap && !hasCapability(manifest, cap)) {
        return { __error: { code: 'CAPABILITY_DENIED' } }
      }
      return previewDispatch(ns, method, args, manifest)      // minimal, preview-safe surface
    },
  })
  await sb.load()
  await sb.activate(ctxDescriptor)
}
```

Rules for Option A:
- `studio-preview.js` builds the `ctxDescriptor` itself in the shape
  `{ apiVersion:'1', pluginId, capabilities:string[], namespaces:Record<string,string[]> }`
  (the shape `PluginSandbox.activate` expects — it defaults to `{ namespaces:{} }`).
- The `dispatch` re-checks each call through the **exported** `capabilityForMethod` +
  `hasCapability` so the preview never grants more than the manifest declares (the
  security-critical gate is single-sourced from `capabilities.js`, not re-implemented).
- The preview may run against a **throwaway scratch note** snapshot; it MUST NOT pass
  any real note, key, `Y.Doc`, or `Awareness` into `dispatch`. UI-only surfaces
  (status item, slash, section, callout) render with a deny-most or stub `dispatch`.
- The preview is **disposable**: `dispose()` removes the iframe; it is recreated on
  every hot-reload (`studio:event` `file` events or the studio chokidar watcher).

**Option B (fallback, ONLY if Option A proves insufficient):** the INTEGRATE phase adds
a `controller.preview({ manifest, entrySource, assets, container })` to `plugin-host.js`
that reuses the host's private `_buildCtxDescriptor` + `_dispatchHostCall` and spins an
**ephemeral, non-persisted** `PluginRecord` (`source:'workspace'`, never written to
settings/enabledMap), returning a disposable handle. This is the only sanctioned
`plugin-host.js` edit, and it is recorded as an integrationNote — builders do not make
it. **Default to Option A.**

---

## 7. WEB-SAFETY (NORMATIVE)

The dev-only web build (`vite.web.config.mjs` → `dist-web`) has a mock `window.api`
with **no** real filesystem and **no** `child_process`. Therefore:

1. **No top-level `node`/`electron`/`child_process`/`fs`/`path` imports** in any
   `src/renderer/src/plugins/studio/**` file. All machine ops go through
   `window.api.invoke('studio:*', …)`.
2. `studio-client.js` MUST guard every call:
   `if (!window.api || typeof window.api.invoke !== 'function') return { ok:false, error:'unsupported' }`.
   On the web build the `studio:*` channels are not registered, so a real invoke also
   resolves to `{ ok:false, error:'unsupported' }` (or rejects — the client catches and
   normalizes to that shape). Builders MUST treat `{ ok:false, error:'unsupported' }` as
   the canonical "no desktop" signal.
3. `plugin-studio.js` **must be import-safe on web** (importing it must not throw). On
   mount, if Studio is unavailable (web, or `studioClient` returns `unsupported` from
   `studio:agent-detect`/`studio:list-builds`), the view degrades to a single notice:
   **"Plugin Studio needs the desktop app."** No CLI picker, no editor, no preview.
4. The renderer `kind:'api'` provider's tools call `studio:*` IPC, so it is inert on
   web by the same mechanism (it never has a workspace to write to).

---

## 8. PHASES A–E COVERAGE (which file delivers what)

| Phase | Deliverable | Primary file(s) |
|---|---|---|
| **A — Workspace & grounding (+ external + hot-reload)** | Workspace lifecycle, context-bundle writer, studio chokidar watcher → `studio:event` file events, the `external` "open in editor" provider. A user can run `claude`/`gemini` themselves in the grounded workspace and watch it hot-load. | `src/main/plugin-studio/studio-manager.js` (lifecycle, bundle, watcher, `studio:create/list/read/delete/open-external/fs-*`); `src/main/plugin-studio/agent-providers/external.js`; `src/renderer/src/plugins/studio/studio-capabilities-md.js` (CAPABILITIES.md); `studio-client.js`. |
| **B — In-app CLI agents + chat UI** | Claude Code + Gemini CLI adapters, `studio:agent-*` channels, the chat/transcript/tool-log UI. The single-shot Lab box redirects here. | `src/main/plugin-studio/agent-providers/{claude-code,gemini-cli,index}.js`; `src/main/plugin-studio/cli-discovery.js`; `studio-manager.js` (agent driver); `src/renderer/src/plugins/studio/{plugin-studio,studio-transcript}.js`. |
| **C — Zero-tooling API loop + code editor + live preview** | The built-in `kind:'api'` tool loop (no CLI required), the CM6 code editor, the live preview pane. | `src/renderer/src/plugins/studio/providers/api-loop.js`; `src/renderer/src/plugins/studio/studio-code-editor.js`; `src/renderer/src/plugins/studio/studio-preview.js` (Option A); `studio-manager.js` (`studio:build-check` + `studio:fs-*` for the loop's tools). |
| **D — Self-heal + ship** | Automatic error-feedback loop (feed `build-check`/sandbox errors back as the next agent turn, capped retries), diff view, Install / Export `.nlplugin`. | `src/main/plugin-studio/studio-manager.js` (`studio:build-check`, `studio:install-build`, `studio:export`); `src/main/plugin-studio/zip.js`; `src/renderer/src/plugins/studio/plugin-studio.js` (self-heal loop + "Fix errors" + diff view, wiring Install/Export buttons). |
| **E — "Anything" + polish** | The generic-CLI custom-harness template (`{goal}`/`{workspace}`), remix/template gallery, token/cost + duration display, multi-file diff review. | `src/main/plugin-studio/agent-providers/generic-cli.js`; `studio-manager.js` (`remixFrom` in `studio:create-workspace`); `src/renderer/src/plugins/studio/plugin-studio.js` (template/remix gallery, cost/usage display). |

---

## 9. Frozen constants & shapes (quick reference)

```js
// Feature flag (default OFF — consent-gated)
Features.pluginStudio = envFlag('VITE_FEATURE_PLUGINS_STUDIO', false)

// Studio root (NEVER the vault)
const STUDIO_ROOT = path.join(app.getPath('userData'), 'plugin-studio')   // builds/, counter.json
const buildDir = (id) => path.join(STUDIO_ROOT, 'builds', `build-${id}`)
// plugin deliverable = buildDir(id) + '/plugin'

// buildId: persisted MONOTONIC INTEGER from STUDIO_ROOT/counter.json ({ next:N }) — never Date.now(), never random
// sessionId: monotonic integer owned by studio-manager.js

// studio:* channels (all return { ok, …, error? }; never throw)
//   studio:create-workspace · studio:list-builds · studio:read-build · studio:delete-build · studio:open-external
//   studio:fs-read · studio:fs-write · studio:fs-list           (confined to STUDIO_ROOT/builds/build-<id>/)
//   studio:build-check · studio:export · studio:install-build
//   studio:agent-detect · studio:agent-start · studio:agent-send · studio:agent-cancel
// streamed events: webContents.send('message','studio:event',{ sessionId, ev })

// AgentEvent ev.type ∈ { 'text' | 'tool' | 'file' | 'status' | 'error' | 'done' }
// AgentProvider.kind ∈ { 'cli' | 'api' | 'external' }

// Claude Code spawn (cwd = buildDir):
//   spawn(claudeBin, ['-p', goal, '--output-format','stream-json','--permission-mode','acceptEdits'],
//         { cwd: workspaceDir, env: claudeEnv() })

// Reused, UNCHANGED:
//   plugin:install  { source:{ type:'folder', value:<temp plugin dir> } }   → install-build
//   plugin:scaffold { template, id, name, targetDir }                       → seed plugin/
//   validateManifest(raw) → { ok, manifest?, errors }                       → build-check + preview
//   PluginSandbox({ id, manifest, entrySource, dispatch, container, onQuarantine }) → live preview
//   capabilities.js: METHOD_CAPABILITY, capabilityForMethod, hasCapability, describeCapability, isSensitiveCapability
//   index.js: resolveClaudeBin (:630), claudeEnv (:642)  → lifted into cli-discovery.js
//   plugin-manager.js: resolveWorkspacePath (:327) confinement TECHNIQUE → mirror for studio root
//                      extractZipBuffer (:450) format → mirror in reverse for export
```

---

## 10. Invariants Studio MUST NOT break (NORMATIVE)

1. **Runtime sandbox unchanged.** Studio produces a `plugin/` folder; it loads through
   the existing sandbox with the existing capability checks. Studio adds **no** runtime
   privilege.
2. **No secrets to the harness or preview.** The workspace dir is outside the vault and
   contains only public docs/types/examples. The harness and the preview `dispatch`
   never see notes, identity keys, the team root key, any derived swarm/E2EE key, a
   `Y.Doc`, `Awareness`, or the `transportDoc`. The API key stays in **main**.
3. **`studio:fs-*` is studio-root-confined.** Traversal + symlink + `\0` guards, rooted
   at `userData/plugin-studio`, computed fresh per call. Never the vault, never
   `.notionless/`.
4. **Consent-gated, off by default.** `Features.pluginStudio` (default `false`); first
   run shows the explicit author-time-trust dialog; each CLI harness is enabled
   individually. When off, `registerStudioIpc` is not invoked and the view is hidden.
5. **Install is a separate, explicit act.** `studio:install-build` defaults the plugin
   **DISABLED**; activation goes through the normal capability-approval/enable flow.
   "Built by an agent" grants nothing.
6. **Workspace is disposable and bounded.** Builds live under `plugin-studio/builds/`,
   are listable and deletable, and the harness only ever writes inside its own
   `build-<id>/`.
7. **Web-safe.** No renderer Studio file imports node/electron at module top level;
   machine ops go through `studio:*` IPC; the view degrades to a desktop-only notice on
   web.
8. **Never throw across IPC.** Every `studio:*` handler catches and returns
   `{ ok:false, error }`. Every agent child kill / loop abort is bounded.
9. **Builders touch only their own new files.** Shared files (§5, header list) are
   changed only by the integrate step via `integrationNotes`.

— END OF FROZEN PLUGIN STUDIO CONTRACT v1 —
