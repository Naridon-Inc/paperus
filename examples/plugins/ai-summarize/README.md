# AI Summarize (example plugin)

Summarizes the current note into bullet points, streamed live into a right-side
panel. Trigger it from the slash menu (`/Summarize note`), the command palette,
or `Mod-Shift-S`.

## Surfaces exercised

- `ctx.commands.register({ id, title, key, when, run })`
- `contributes.slash` (slash item that dispatches the command)
- `ctx.ai.complete({ system, prompt, onToken })` — host-side, streamed tokens
- `ctx.ui.panel({ ... }).update(vdom)` — re-render as tokens arrive
- `ctx.editor.getActive()` for the note text
- `ctx.ui.notify(...)` for user feedback

## Capabilities

```json
["commands", "ai", "ui", "editor"]
```

## How it works

The summarize routine reads the active note via `ctx.editor.getActive()`, then
calls `ctx.ai.complete({ system, prompt, onToken })`. The completion runs
**host-side** through the user's configured AI backend (rag-engine); the plugin
only ever receives streamed tokens — never the API key, endpoint, or model.

Each token appends to the panel state and triggers `panel.update(vdom)`, so the
summary fills in live. The panel's "↻" button re-runs the same routine via the
panel `onEvent` action `regenerate`.

All AI calls are wrapped in `try/catch`; failures degrade to an inline error in
the panel plus a toast, and never break the host.
