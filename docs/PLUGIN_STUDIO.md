# Plugin Studio — the native, agentic, multi-harness plugin builder

> Status: **DESIGN / RFC**. Builds on the shipped plugin system
> (`docs/PLUGIN_SYSTEM.md`, frozen contract `docs/PLUGIN_API_CONTRACT.md`,
> apiVersion `"1"`). This document specifies the **author-time** tool. It does
> **not** change the **run-time** sandbox or any capability/E2EE invariant.

## 0. One-paragraph pitch (what a user sees)

You open **Plugin Studio**, type *"add a Pomodoro timer to the sidebar that
pauses when I'm typing,"* pick your coding agent — **Claude Code, Gemini CLI,
your own API key, or anything you have installed** — and hit **Build**. The agent
writes a real plugin in a scratch workspace that already contains the full
Notionless plugin guide, the API types, and five working examples, so it gets it
right. The plugin **hot-loads live** into a preview pane as it's written; build
and runtime errors are fed **back to the agent automatically** so it fixes
itself. You can chat to refine it ("make the timer red"), edit the code by hand
in the built-in editor, then **Install** it or **Export** a `.nlplugin` to share.
Describe → agent builds → live preview → install. No terminal, no scaffolding by
hand, no leaving the app.

This is the agentic upgrade of the existing single-shot *"Generate with Claude"*
box in `src/renderer/src/plugins/plugin-lab.js`.

## 1. Goals / non-goals

**Goals**
1. **Any harness.** Claude Code, Gemini CLI, Codex, a BYO-API agent loop, Ollama,
   or *any* CLI the user configures — all behind one interface. "Use your own
   skills and Claude Code and all" is the headline.
2. **UI-based coding setup.** A real workbench (chat + transcript + code editor +
   live preview), not a terminal and not a one-shot text box.
3. **Full system context, automatically.** The agent is grounded in the frozen
   contract, the `ctx` types, a live catalog of extensible surfaces, and the five
   examples — without the user pasting anything.
4. **Agentic, self-healing.** Multi-turn tool use; build/lint/sandbox errors loop
   back to the agent until green.
5. **Easy is the product.** A non-coder gets a working plugin from one sentence; a
   coder can drop to the code editor or an external IDE at any point.

**Non-goals**
- Not a general IDE. Scope is *Notionless plugins* only.
- Does **not** relax the runtime sandbox or capability model (§6).
- No hosted build service — everything runs on the user's machine (local-first).

## 2. The trust split (read this first)

Plugin Studio has **two completely separate trust domains**. Conflating them is
the one dangerous mistake.

| | Author-time (the harness) | Run-time (the plugin it produces) |
|---|---|---|
| What runs | `claude` / `gemini` / a tool-loop / your editor | the finished plugin |
| Trust | **real machine access**, like you opening a terminal and typing `claude` | **sandboxed**: iframe + Worker, no DOM/`window.api`/`require`/`fetch` |
| Scope of FS access | the **studio workspace dir only** — never your notes vault, never identity keys | host-mediated `ctx.fs` to the vault, capability-gated |
| Consent | explicit, opt-in, off by default, `Features.pluginStudio` flag | declared capabilities, host re-checks every call |

**Author-time trust is exactly the trust of running a coding agent in a folder** —
nothing more, nothing less. We make that honest and bounded: a dedicated
workspace directory **outside** the notes root, an explicit one-time consent
("Plugin Studio will run *Claude Code* on your machine with file access to
`…/plugin-studio/build-7`"), and per-harness enable. The plugin the agent
produces is still just a folder that loads through the **unchanged** sandbox. The
Studio cannot grant a plugin any capability the user doesn't approve at install.

The harness receives the **public** contract, types, and examples — never the
user's notes, identity private key, team root key, or any derived key.

## 3. Architecture

```
┌───────────────────────── renderer (Plugin Studio view) ─────────────────────┐
│  chat + transcript/tool-log   │  live preview (real sandbox, scratch note)   │
│  harness picker / model       │  code editor (CodeMirror 6) + file tree      │
└───────────┬───────────────────┴──────────────────────────────────────────────┘
            │ studio:* IPC (request/response + streamed events)
┌───────────▼──────────────────────── main process ────────────────────────────┐
│  StudioManager                                                                │
│   • workspace lifecycle (create/list/delete build dirs)                       │
│   • context bundle writer (AGENTS.md/CLAUDE.md/GEMINI.md/types/examples/…)     │
│   • chokidar watch → debounced "files changed" event → renderer hot-reload    │
│   • AgentProvider registry  ◄── the "any harness" seam                        │
│        ├─ cli:      claude-code · gemini-cli · codex · generic-template        │
│        ├─ api:      anthropic · openai-compat · ollama   (built-in tool loop)  │
│        └─ external: open-in-editor (VS Code / Cursor / $EDITOR)               │
└───────────────────────────────────────────────────────────────────────────────┘
```

Reused from the shipped foundation (no reinvention):
- **Context source**: `author-guide.js` / `docs/llms.txt` / `AGENTS.md` (already
  shipped, kept in sync with the contract).
- **Scaffold + write + install IPC**: `plugin:scaffold`, `plugin:fs-write`,
  `plugin:install` (already in `src/main/plugin-manager.js`).
- **Hot-load controller**: the controller returned by `initPluginSystem`
  (`plugin-host.js`) — same one the Plugin Lab uses.
- **Runtime sandbox**: `plugin-sandbox.js` / `sandbox-runtime.js` / `plugin-rpc.js`
  — unchanged.
- **Surface catalog**: `capabilities.js` + the `contrib-*.js` registries — read to
  generate the live "what can I extend" catalog (§5).

## 4. The harness interface ("any harness")

A single small interface in `src/main/agent-providers/`. Adding a harness = adding
one file.

```js
// AgentProvider (main process)
{
  id,            // 'claude-code' | 'gemini-cli' | 'codex' | 'api-anthropic' | 'ollama' | 'external' | <custom>
  label,
  kind,          // 'cli' | 'api' | 'external'
  async detect(),                 // { available, version?, reason? } — binary on PATH? api key set?
  createSession({ workspaceDir, systemContext, goal, onEvent })  // → AgentSession
}

// AgentSession
{
  send(message),   // follow-up user turn
  cancel()
}

// onEvent payloads (streamed to the renderer transcript):
//   { type:'text',  text }            assistant prose
//   { type:'tool',  name, input }     a tool/command the harness ran
//   { type:'file',  path, action }    a file the harness wrote (drives hot-reload + code editor)
//   { type:'status', text }           "running build…", "thinking…"
//   { type:'error',  text }           surfaced to user AND fed back into the loop
//   { type:'done',   summary }
```

Three adapter strategies cover everything:

1. **CLI adapter** (`kind:'cli'`) — spawn the binary headless in `workspaceDir`,
   stream stdout into the transcript. The harness does its *own* file editing in
   the workspace; we just watch and hot-reload.
   - **Claude Code**: `claude -p "<goal>" --output-format stream-json
     --permission-mode acceptEdits` (or the Agent SDK). Reads `CLAUDE.md` +
     `AGENTS.md` from the workspace automatically.
   - **Gemini CLI**: non-interactive prompt in `workspaceDir`; reads
     `GEMINI.md` + `AGENTS.md`.
   - **Codex / generic**: a **command template** with `{goal}`, `{workspace}`
     placeholders the user fills once — this is the literal *"or anything"* slot.
     Any agent that edits files in a directory plugs in here with zero code.

2. **API adapter** (`kind:'api'`) — for users with only an API key or a local
   model and **no CLI installed**. Notionless runs its **own** minimal agent loop
   with a fixed toolset (`read_file`, `write_file`, `list_dir`, `run_build`,
   `run_lint`) over the workspace, system prompt = the author guide + surface
   catalog. Routes through the **existing** AI backend seam
   (`ai:claude-code` / `rag-engine` api/ollama path in `contrib-ai.js`), so no new
   key handling. This is what makes Studio work out-of-the-box with zero external
   tooling.

3. **External adapter** (`kind:'external'`) — "Open workspace in your editor."
   Opens the build dir in VS Code / Cursor / `$EDITOR`; Notionless keeps watching
   and hot-reloading. The escape hatch for power users and unsupported agents.

Harnesses are **auto-detected** (`detect()`); unavailable ones are shown disabled
with a one-line "install `gemini` / set an API key" hint. The picker remembers the
last choice per workspace.

## 5. Context bundle — grounding any agent, automatically

On new build, `StudioManager` scaffolds the workspace (from the closest example,
e.g. *remix `word-count`*) and writes a context bundle so **whichever** harness
runs is grounded the way that harness expects:

```
plugin-studio/build-7/
  plugin.json, index.js            ← the scaffold the agent edits
  AGENTS.md                        ← harness-agnostic guide (Claude/Gemini/Codex/Cursor all read it)
  CLAUDE.md   → AGENTS.md           (Claude Code)
  GEMINI.md   → AGENTS.md           (Gemini CLI)
  .cursorrules → AGENTS.md          (Cursor)
  CAPABILITIES.md                  ← LIVE catalog generated from capabilities.js + contrib-* registries
  docs/PLUGIN_API_CONTRACT.md      ← the frozen contract (copy)
  types.d.ts                       ← @notionless/plugin-sdk full ctx + manifest types
  examples/                        ← the five working plugins, for the agent to imitate
  llms.txt
```

`CAPABILITIES.md` is the differentiator: it's generated from the **running** host,
so it lists exactly what's extensible *right now* — sidebar sections, slash
commands, CM6 block types, status items, login/auth methods, AI providers,
import/export formats — each with the `ctx` call that registers it and the
capability string it needs. The agent never guesses the surface.

## 6. Invariants Studio must not break

1. **Runtime sandbox unchanged.** Studio produces a plugin folder; that folder
   loads through the existing sandbox with the existing capability checks. Studio
   adds **no** runtime privilege.
2. **No secrets to the harness.** Workspace dir is **outside** the notes vault and
   contains only public docs/types/examples. The harness never sees notes,
   identity keys, the team root key, any derived swarm/E2EE key, a `Y.Doc`,
   `Awareness`, or the `transportDoc`.
3. **Consent-gated, off by default.** `Features.pluginStudio` flag; first run shows
   the explicit author-time-trust dialog (§2); each CLI harness is enabled
   individually.
4. **Install is a separate, explicit act.** A built plugin is not active until the
   user clicks **Install**, which runs it through the normal capability-approval
   flow. "Built by an agent" grants nothing.
5. **Workspace is disposable and bounded.** Builds live under
   `plugin-studio/`, are listed/deletable, and never write outside their own dir.

## 7. UI

A dedicated **Plugin Studio** view (the Plugin Lab's "Generate with Claude" box
graduates into this; the Lab keeps the simple list/install/enable controls).

```
┌──────────────────────────── Plugin Studio ─────────────────────────────────┐
│ Harness: [ Claude Code ▾ ]   Model: …   ● build-7   [New] [Builds ▾]        │
├───────────────────────────┬─────────────────────────────────────────────────┤
│  CHAT                      │  PREVIEW  (live, real sandbox, scratch note)     │
│  ┌ goal ──────────────┐    │  ┌─────────────────────────────────────────┐    │
│  │ add a pomodoro …   │    │  │  [ 24:30 ▶ ]   ← the plugin, running     │    │
│  └────────────────────┘    │  └─────────────────────────────────────────┘    │
│  • wrote plugin.json       ├─────────────────────────────────────────────────┤
│  • wrote index.js          │  CODE   plugin.json · index.js · style.css       │
│  • ran build ✓             │  ┌─────────────────────────────────────────┐    │
│  • ⚠ sandbox error → fix   │  │ export default definePlugin({ … })  (CM6)│    │
│  …                          │  └─────────────────────────────────────────┘    │
├───────────────────────────┴─────────────────────────────────────────────────┤
│  [ Build ]  [ Fix errors ]  [ Reload ]  [ Install ]  [ Export .nlplugin ]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Chat / transcript** streams `onEvent`: prose, tool calls, file writes, errors.
- **Preview** runs the in-progress plugin in the real sandbox on a throwaway note
  so the user sees the actual contributed surface (status item / slash command /
  section / callout / login method).
- **Code** is a CodeMirror 6 editor (we already ship CM6) over the workspace files;
  hand-edits are picked up by the watcher and seen by the agent next turn.
- **Fix errors** is one-click: bundles the latest build/lint/sandbox error and
  sends it as the next agent turn (the self-heal loop, also runnable
  automatically).

## 8. Self-healing loop

```
agent writes files ─► chokidar ─► host validates manifest + builds
        ▲                                   │
        │ error text as next turn           ├─ ok ─► hot-load into preview sandbox
        └───────────────────────────────────┤            │
            (auto, capped retries)           └─ runtime error (sandbox-runtime.js) ─► capture ─┘
```

Errors come from three places, all already emitted by the foundation: manifest
validation (host), `node --check`/build, and the sandbox runtime channel. Studio
captures them, shows them in the transcript, and (optionally, on by default) feeds
them back to the agent with a small retry cap so a non-coder never sees a stack
trace they can't act on.

## 9. Distribution

- **Install** — workspace → installed plugins dir via `plugin:install`; runs the
  capability-approval flow; enables.
- **Export `.nlplugin`** — a zip of the folder, shareable as a file.
- **Remix** — "Start from an example" / "Remix this installed plugin" seeds the
  workspace from an existing plugin so the agent edits rather than starts blank.
- *(Future)* a community registry and share-link install, reusing the existing
  share mechanism.

## 10. Phased roadmap

- **Phase A — Workspace & grounding (works with ANY external harness on day 1).**
  `StudioManager`, workspace lifecycle, the context bundle writer (§5), chokidar
  hot-reload, and the **external** adapter ("open in your editor"). Even before any
  in-app agent, a user can run `claude`/`gemini` themselves in the grounded
  workspace and watch it hot-load.
- **Phase B — In-app agents.** `AgentProvider` registry + the Claude Code and
  Gemini CLI adapters + chat/transcript/tool-log UI. The single-shot Lab box is
  redirected here.
- **Phase C — Zero-tooling path + code editor.** The built-in **API** agent loop
  (Anthropic / OpenAI-compat / Ollama) so no CLI is required, plus the CM6 code
  editor and the live preview pane.
- **Phase D — Self-heal + ship.** Automatic error-feedback loop, diff view,
  Install / Export `.nlplugin`.
- **Phase E — "Anything" + polish.** The generic-CLI custom-harness template
  (`{goal}`/`{workspace}`), template/remix gallery, token/cost + duration display,
  multi-file diff review.

## 11. Open questions

1. **Default harness order** when several are detected (suggest: Claude Code →
   Gemini → built-in API → external).
2. **Auto-fix retry cap** before handing back to the user (suggest 3).
3. **Preview for non-visual plugins** (e.g. an import format) — fall back to a
   "capabilities exercised" checklist + a manual trigger button.
4. Whether **Studio itself** is eventually a (privileged, first-party) plugin vs.
   built-in host code — leaning built-in host, since it needs author-time machine
   access the sandbox is designed to forbid.
