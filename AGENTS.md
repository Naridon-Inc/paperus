# AGENTS.md — building a Notionless plugin (for AI coding agents)

This file tells an AI agent (Claude Code, Cursor, Copilot, etc.) everything it needs
to **one-shot a working Notionless plugin**. Read this top to bottom, then output a
`plugin.json` + `index.js`. For the full author distillation see
[`docs/llms.txt`](docs/llms.txt); the frozen normative spec is
[`docs/PLUGIN_API_CONTRACT.md`](docs/PLUGIN_API_CONTRACT.md) (`apiVersion: "1"`).

---

## TL;DR for the agent

A plugin is a folder: `plugin.json` (manifest) + `index.js` (ESM entry). It runs
**sandboxed** (iframe + Worker): **no `window`, no DOM, no `require`, no `fetch`,
no Node**. It talks to the host only via the `ctx` passed to `activate(ctx)`.
Everything across the boundary is JSON-serializable.

```js
import { definePlugin } from '@notionless/plugin-sdk'

export default definePlugin({
  async activate(ctx) { /* register everything here */ },
  async deactivate() { /* optional — host auto-disposes anyway */ }
})
```

---

## Hard constraints (do NOT violate)

- **Declare only the capabilities you use** in `plugin.json.capabilities`. The host
  re-checks every privileged call; anything undeclared returns `CAPABILITY_DENIED`.
- **No secrets.** You never get identity private keys, the team root key or any
  derived swarm/E2EE key, a raw `Y.Doc`/`Y.Text`/`Awareness`, the E2EE transport doc,
  or the AI key/endpoint. You get plaintext snapshots, opaque `docId`/`teamId`,
  streamed AI tokens, and operation results.
- **No DOM nodes.** `render()` / `body` returns a sanitized **HTML string** or the
  **vDOM** shape (below). You have no document; you cannot create elements.
- **No ambient I/O.** Network only via `ctx.net.fetch` (and only to a declared
  `net:<host>`). Filesystem only via `ctx.fs.*` (workspace root, no `..`,
  never `.notionless/`).
- **Be defensive.** Every host call is wrapped in try/catch + a timeout. Throwing or
  hanging gets you **quarantined** — handle your own errors and keep callbacks fast.
- **`apiVersion` MUST be `"1"`.** The host refuses any other value.

---

## Manifest cheat-sheet (`plugin.json`)

Required: `id` (reverse-DNS, lowercase, e.g. `com.acme.word-count`), `name`,
`version` (semver), `apiVersion` (`"1"`), `description` (≤200), `author`,
`license` (SPDX), `entry` (default `index.js`), `capabilities` (array).
Optional: `contributes`, `minHostVersion`, `icon`.

`contributes` (declarative, shown before `activate`): `commands`, `slash`, `blocks`,
`panels`, `sections`, `views`, `navItems`, `toolbarItems`, `statusItems`, `settings`,
`aiProviders`, `loginMethods`, `formats`, `teamHooks`.

| Capability | Unlocks |
|---|---|
| `commands` | `ctx.commands.*` |
| `editor` | `ctx.editor.*` (blocks, decorations, onChange, getActive, insert) |
| `ui` | `ctx.ui.panel/navItem/toolbarItem/statusItem/notify/modal` |
| `sections` | `ctx.ui.sidebarSection` (+`ui`) |
| `views` | `ctx.ui.view/settingsSection` (+`ui`) |
| `ai` | `ctx.ai.complete/embed/registerProvider` |
| `auth` | `ctx.auth.registerLoginMethod` |
| `teams` | `ctx.teams.*` |
| `storage` | `ctx.storage.*` (namespaced to your id) |
| `clipboard` | `ctx.ui.clipboardWrite/clipboardRead` (user gesture) |
| `fs:read` | `ctx.fs.read/list` |
| `fs:write` | `ctx.fs.write` |
| `net:<host>` | `ctx.net.fetch` to that host (`net:*.host` wildcard; bare `net:*` rejected) |

---

## `ctx` quick reference

```ts
// commands
ctx.commands.register({ id, title, key?, when?, run })            // Disposable
ctx.commands.execute(id, payload?)                               // Promise<any>

// editor
ctx.editor.registerBlock({ type, fence?|match?, parseMarkdown, render, toMarkdown, interactive? })
ctx.editor.registerDecoration({ scan(text) -> [{ from,to,class,attrs? }] })
ctx.editor.onChange(({ docId, text, changedRanges }) => {})
ctx.editor.getActive()                                          // Promise<{docId,text,selection}|null>
ctx.editor.insert({ text, at?, replaceSelection? })             // Promise<{ ok }>

// ai (host runs the user's backend; you only see tokens/vectors)
ctx.ai.complete({ system?, prompt, onToken?, citations? })      // Promise<{ text }>
ctx.ai.embed(text|string[])                                     // Promise<number[]|number[][]>
ctx.ai.registerProvider({ id, label, generate, retrievalMode?, configure?, friendlyError? })

// auth — alternate UNLOCK of the same key, never a new identity
ctx.auth.registerLoginMethod({ id, label, isAvailable?, render?, authenticate })
//   authenticate(...) -> { password } | { publicKey, privateKey }

// teams — sanitized snapshots only (no keys, no Y.Doc)
ctx.teams.onTeamOpen(({ teamId, teamName, members }) => {})
ctx.teams.registerTeamAction({ id, label, icon?, run(teamId) })
ctx.teams.list()                                                // Promise<[{teamId,teamName}]>

// storage / fs / net
ctx.storage.get(key) / set(key,value) / delete(key) / keys()
ctx.fs.read(path) / list(dir) / write(path, data)
ctx.net.fetch(url, init?)                                       // Promise<{status,headers,body}>

// ui (returns vdom|html — never DOM nodes)
ctx.ui.panel({ id, title, location, render(token), onEvent? })
ctx.ui.sidebarSection({ id, title, order, render, headerAction? })   // +sections
ctx.ui.view({ id, title, icon?, render(token) })                     // +views; { show() }
ctx.ui.navItem({ id, label, icon, target })
ctx.ui.toolbarItem({ id, icon, title, run(sel) })
ctx.ui.statusItem({ id, location? })                                 // { set(text|{html}) }
ctx.ui.settingsSection({ id, title, render(token) })                 // +views
ctx.ui.notify({ message, kind?, timeout? })
ctx.ui.modal({ title, body, buttons? })                              // Promise<{ button }>
ctx.ui.clipboardWrite(text) / clipboardRead()                        // +clipboard

// events (no capability needed)
ctx.events.on('note:open'|'note:save'|'note:change'|'team:updated'|'file:changed', handler)
```

Every register returns a `Disposable { dispose() }`. The host auto-disposes all of
them on disable/deactivate.

---

## vDOM (the only way to render)

Return a sanitized HTML string, or:

```ts
{
  tag: 'div',                                  // allow-list: div,span,p,h1..h4,ul,ol,li,a,
                                               //  button,input,textarea,select,option,img,pre,
                                               //  code,table,thead,tbody,tr,td,th,strong,em,
                                               //  br,hr,label,i,svg(subset)
  attrs?: { class, id, href, src, ... },       // sanitized; aria-*/data-* allowed
  on?: { click: 'myAction', input: 'filter' }, // action ids dispatched to onEvent
  children?: [VNode | 'escaped text']
}
```

No `<script>`, no inline `on*=` attrs (use the `on` map), no `javascript:`/`data:`
(except small `img` data URLs).

---

## Minimal working example (copy this shape)

`plugin.json`:
```json
{
  "id": "com.example.word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "apiVersion": "1",
  "description": "Live word and character count in the status bar.",
  "author": "you@example.com",
  "license": "MIT",
  "entry": "index.js",
  "capabilities": ["editor", "ui"],
  "contributes": { "statusItems": [{ "id": "wc", "location": "footer" }] }
}
```

`index.js`:
```js
import { definePlugin } from '@notionless/plugin-sdk'

export default definePlugin({
  async activate(ctx) {
    const item = ctx.ui.statusItem({ id: 'wc', location: 'footer' })
    const update = (text) => {
      const words = (text.trim().match(/\S+/g) || []).length
      item.set(`${words} words · ${text.length} chars`)
    }
    const active = await ctx.editor.getActive()
    update(active ? active.text : '')
    ctx.editor.onChange((e) => update(e.text))
  }
})
```

---

## Pre-flight checklist (verify before you emit)

- [ ] `apiVersion` is exactly `"1"`.
- [ ] `id` is reverse-DNS lowercase; `entry` has no `..`.
- [ ] Every `ctx.*` namespace you call has a matching capability in `capabilities[]`.
- [ ] `sections` calls also declare `ui`; `views` calls also declare `ui`; an AI
      provider that egresses also declares a `net:<host>`.
- [ ] `render`/`body`/`toMarkdown`/`parseMarkdown` return JSON/strings/vDOM — never DOM.
- [ ] No `window`, `document`, `fetch`, `require`, `localStorage` references anywhere.
- [ ] Callbacks (`run`, `onToken`, `onChange`, `render`) are fast and self-contained;
      they wrap their own risky work in try/catch.
- [ ] Output is exactly two fenced blocks: a ```json manifest, then a ```js entry.

---

## Building inside the app

Open **Plugin Lab** (the "Build with Claude" view) to describe a plugin in natural
language; it seeds this guide into the AI backend, scaffolds the folder via
`plugin:scaffold`, writes the files, and hot-loads the result. You can also
`npm create @notionless/plugin` to scaffold locally, or install an existing folder
from the Lab's "Install from folder" button.
