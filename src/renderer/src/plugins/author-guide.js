// author-guide.js — the compact, authoritative Notionless plugin author guide,
// exported as a string so the Plugin Lab can seed any AI backend (Claude Code,
// API, Ollama) to one-shot a conformant plugin against the frozen contract
// (docs/PLUGIN_API_CONTRACT.md, apiVersion "1").
//
// This is the SAME text shipped to authors in docs/llms.txt / AGENTS.md, kept here
// as a JS module so the renderer can import it without a filesystem read. Keep it
// in sync with those files when the contract changes (and bump apiVersion).

export const PLUGIN_AUTHOR_GUIDE = `# Notionless Plugin API — author guide (apiVersion "1")

A Notionless plugin is a folder with a plugin.json manifest and an ESM index.js.
It runs SANDBOXED (an iframe with a Worker): no window, no DOM, no require, no fetch.
The plugin talks to the host only through the \`ctx\` object passed to \`activate(ctx)\`.
Everything across the boundary is JSON-serializable. Callbacks you pass in (onToken,
render, run, onChange, authenticate) are kept locally and invoked by the host later.

## Entry shape
\`\`\`js
import { definePlugin } from '@notionless/plugin-sdk'
export default definePlugin({
  async activate(ctx) { /* register contributions, set listeners */ },
  async deactivate() { /* optional cleanup; host auto-disposes everything anyway */ }
})
\`\`\`

## plugin.json (manifest)
Required: id (reverse-DNS, lowercase, e.g. com.acme.word-count), name, version
(semver), apiVersion ("1"), description (<=200 chars), author, license (SPDX),
entry (default "index.js"), capabilities (array, subset below).
Optional: contributes (declarative descriptors shown BEFORE activate), minHostVersion,
icon.

## Capabilities (declare ONLY what you use; the host re-checks every call)
- commands        ctx.commands.register/execute/list
- editor          ctx.editor.registerBlock/registerDecoration/onChange/getActive/insert
- ui              ctx.ui.panel/navItem/toolbarItem/statusItem/notify/modal
- sections        ctx.ui.sidebarSection            (also needs ui)
- views           ctx.ui.view/settingsSection       (also needs ui)
- ai              ctx.ai.complete/embed/registerProvider
- auth            ctx.auth.registerLoginMethod
- teams           ctx.teams.onTeamOpen/registerTeamAction/list
- storage         ctx.storage.get/set/delete/keys   (namespaced to your plugin)
- clipboard       ctx.ui.clipboardWrite/clipboardRead (user-gesture bound)
- fs:read         ctx.fs.read/list                  (workspace root only)
- fs:write        ctx.fs.write                      (workspace, never .notionless/)
- net:<host>      ctx.net.fetch to exactly <host> (or net:*.host for a wildcard)
                  Bare net:* is REJECTED. AI providers that egress need a matching net:<host>.

## ctx API (all args/returns JSON-serializable; every register returns { dispose() })

ctx.commands.register({ id, title, key?, when?, run }) -> Disposable
ctx.commands.execute(id, payload?) -> Promise<any>
ctx.commands.list() -> Promise<[{ id, title }]>

ctx.editor.registerBlock({ type, fence?|match?, parseMarkdown(raw)->model,
  render(model)->vdom|html, toMarkdown(model)->md, interactive? }) -> Disposable
ctx.editor.registerDecoration({ scan(text)->[{ from,to,class,attrs? }] }) -> Disposable
ctx.editor.onChange(handler({ docId, text, changedRanges })) -> Disposable
ctx.editor.getActive() -> Promise<{ docId, text, selection:{from,to} }|null>
ctx.editor.insert({ text, at?, replaceSelection? }) -> Promise<{ ok }>

ctx.ai.complete({ system?, prompt, onToken?, citations? }) -> Promise<{ text }>
ctx.ai.embed(text|string[]) -> Promise<number[]|number[][]>
ctx.ai.registerProvider({ id, label, icon?, retrievalMode?, generate(system,prompt,
  onToken,onComplete,citations), configure?, friendlyError? }) -> Disposable

ctx.auth.registerLoginMethod({ id, label, isAvailable?(teamId), render?(token),
  authenticate({ teamId, username, profile }) ->
    { password } | { publicKey, privateKey } }) -> Disposable
  // A login method is an ALTERNATE UNLOCK of the SAME identity key, never a new
  // identity. The host verifies a returned publicKey equals the roster winner.

ctx.teams.onTeamOpen(handler({ teamId, teamName, members:[{username,displayName?,publicKey}] })) -> Disposable
ctx.teams.registerTeamAction({ id, label, icon?, run(teamId) }) -> Disposable
ctx.teams.list() -> Promise<[{ teamId, teamName }]>

ctx.storage.get(key) / set(key,value) / delete(key) / keys()   // namespaced
ctx.fs.read(path) / list(dir) / write(path,data)               // workspace-confined
ctx.net.fetch(url, init?) -> Promise<{ status, headers, body }> // declared host only

ctx.ui.panel({ id, title, location:'right'|'left'|'bottom', render(token)->vdom|html, onEvent? }) -> Disposable
ctx.ui.sidebarSection({ id, title, order, render()->vdom|html, headerAction? }) -> Disposable
ctx.ui.view({ id, title, icon?, render(token)->vdom|html }) -> { show() } & Disposable
ctx.ui.navItem({ id, label, icon, target }) -> Disposable
ctx.ui.toolbarItem({ id, icon, title, run(sel:{from,to,text}) }) -> Disposable
ctx.ui.statusItem({ id, location? }) -> { set(text|{html}) } & Disposable
ctx.ui.settingsSection({ id, title, render(token)->vdom|html }) -> Disposable
ctx.ui.notify({ message, kind?, timeout? })
ctx.ui.modal({ title, body, buttons? }) -> Promise<{ button }>
ctx.ui.clipboardWrite(text) / clipboardRead()

ctx.events.on('note:open'|'note:save'|'note:change'|'team:updated'|'file:changed', handler) -> Disposable

## vDOM (what render()/body returns — NEVER DOM nodes)
A sanitized HTML string OR:
{ tag, attrs?:{class,id,href,src,type,value,placeholder,title,role,aria-*,data-*},
  on?:{ click:'<actionId>', input:'<actionId>' },  // dispatched to onEvent
  children?: [VNode|string] }
Allowed tags: div,span,p,h1..h4,ul,ol,li,a,button,input,textarea,select,option,img,
pre,code,table,thead,tbody,tr,td,th,strong,em,br,hr,label,i,svg(subset).
No <script>, no inline event attrs, no javascript:/data: (except bounded img data URLs).

## Rules
- Deny-by-default: a call not covered by a declared capability is denied.
- Never expect window/DOM/secrets. You get plaintext text snapshots, opaque ids,
  AI tokens, and host-mediated operation results only.
- Be defensive; the host wraps every call in try/catch + timeouts. A hang/throw
  quarantines your plugin but never breaks the app.

## Minimal example — a status-bar word counter
plugin.json:
{
  "id": "com.example.word-count", "name": "Word Count", "version": "1.0.0",
  "apiVersion": "1", "description": "Live word and character count.",
  "author": "you", "license": "MIT", "entry": "index.js",
  "capabilities": ["editor","ui"],
  "contributes": { "statusItems": [{ "id":"wc","location":"footer" }] }
}
index.js:
import { definePlugin } from '@notionless/plugin-sdk'
export default definePlugin({
  async activate(ctx) {
    const item = ctx.ui.statusItem({ id: 'wc', location: 'footer' })
    const update = (text) => {
      const words = (text.trim().match(/\\S+/g) || []).length
      item.set(words + ' words · ' + text.length + ' chars')
    }
    const active = await ctx.editor.getActive()
    update(active ? active.text : '')
    ctx.editor.onChange((e) => update(e.text))
  }
})
`

export default PLUGIN_AUTHOR_GUIDE
