# @notionless/plugin-sdk

Authoring SDK for [Notionless](https://github.com/Naridon-Inc/Notionless) plugins.
Targets the **FROZEN Plugin API v1** (`apiVersion: "1"`). The authoritative
contract is `docs/PLUGIN_API_CONTRACT.md` in the Notionless repo.

## Install

```bash
npm install @notionless/plugin-sdk
# or scaffold a whole plugin:
npm create @notionless/plugin
```

## What it is

A Notionless plugin is a plain ESM module whose **default export** is an object
with `activate(ctx)` and an optional `deactivate()`. This SDK ships:

- `definePlugin(impl)` — a thin identity helper (with light shape validation)
  that gives you a stable export shape and full IntelliSense.
- `CAPABILITIES` / `netCapability(host)` — symbolic capability constants.
- `h(tag, attrs, children)` — an optional vDOM element builder.
- `types.d.ts` — the complete, authoritative TypeScript surface for the `ctx`
  API, the `plugin.json` manifest, the vDOM shape, and the RPC envelopes.

The SDK contains **no runtime host code**. It runs unchanged inside the plugin
sandbox and imports nothing from the host realm.

## Minimal plugin

```js
import { definePlugin } from '@notionless/plugin-sdk'

export default definePlugin({
  async activate(ctx) {
    const status = ctx.ui.statusItem({ id: 'wc', location: 'footer' })
    const off = ctx.editor.onChange(({ text }) => {
      const words = (text.trim().match(/\S+/g) || []).length
      status.set(`${words} words`)
    })
    // Disposables are auto-cleaned on deactivate, but you may track them too.
    this._disposables = [status, off]
  },
  async deactivate() {
    (this._disposables || []).forEach((d) => d.dispose())
  },
})
```

Pair it with a `plugin.json` (see `PluginManifest` in `types.d.ts`):

```json
{
  "id": "com.example.word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "apiVersion": "1",
  "description": "Live word count in the footer.",
  "author": "you@example.com",
  "license": "MIT",
  "entry": "index.js",
  "capabilities": ["editor", "ui"],
  "contributes": { "statusItems": [{ "id": "wc", "location": "footer" }] }
}
```

## Security model (short version)

Third-party plugins run sandboxed (`<iframe sandbox="allow-scripts">` → Worker).
There is no `window.api`, no `require`, no ambient `fetch`, and no host DOM
access. Everything in `ctx` is JSON-over-`postMessage`, capability-gated, and
re-checked by the host on every call. You never receive identity keys, the team
root key, a raw `Y.Doc`, or API keys. See §8 of the contract.

## License

MIT
