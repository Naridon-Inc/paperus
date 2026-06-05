# Custom Callout (example plugin)

Adds a `:::tip` / `:::warn` / `:::note` / `:::danger` **block** that renders as a
styled callout card in the live-preview editor and round-trips losslessly to
Markdown.

## Surfaces exercised

- `ctx.editor.registerBlock({ type, fence, parseMarkdown, render, toMarkdown })`
- `contributes.slash` to insert a starter `:::tip` block from the slash menu

## Capabilities

```json
["editor"]
```

## Markdown shape

```
:::tip Pro tip
You can nest **inline markdown** in the body.

Multiple paragraphs are supported.
:::
```

`kind` is one of `tip | note | warn | danger` (defaults to `note`). The first
line after the kind is an optional title.

## How it works

`registerBlock` is the host-mediated equivalent of a CM6 `WidgetType`:

- `parseMarkdown(raw)` turns the raw `:::…:::` source into a JSON model
  `{ kind, title, body }`.
- `render(model)` returns a sanitized vDOM card (no raw DOM crosses the boundary).
- `toMarkdown(model)` serializes the model back to canonical Markdown, so the
  block survives edit/reformat without drift.

The block is `interactive: false`, so it behaves like a native block: the card
shows when the cursor is elsewhere, and the raw Markdown is revealed for editing
when you click into its range.
