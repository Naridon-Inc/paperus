# Word Count (example plugin)

A minimal Paperus plugin that shows a live **word · char** count in the
footer status bar.

## Surfaces exercised

- `ctx.ui.statusItem({ id, location: 'footer' })` → `.set(text)`
- `ctx.editor.onChange(({ text }) => …)` for live updates
- `ctx.editor.getActive()` to seed the count
- `ctx.events.on('note:open', …)` to re-count on document switch

## Capabilities

```json
["editor", "ui"]
```

## How it works

On `activate(ctx)` the plugin creates a footer status item (declared in
`plugin.json` under `contributes.statusItems`) and subscribes to editor changes.
Each change recomputes the word/character counts and calls `status.set(...)`.
All host callbacks are wrapped so a counting error degrades to a placeholder
instead of breaking the host.

The plugin holds no DOM and no secrets — it only ever receives plaintext text
snapshots from the host.
