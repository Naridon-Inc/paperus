# Bookmarks (custom-section example plugin)

Adds a **Bookmarks** section to the sidebar, a nav item, and a full **Bookmarks**
view that replaces the editor — bookmark the open note, list them, remove them.

## Surfaces exercised

- `ctx.ui.sidebarSection({ id, title, order, render, onEvent })` (cap: `sections`)
- `ctx.ui.view({ id, title, icon, render, onEvent })` (cap: `views`)
- `ctx.ui.navItem({ id, label, icon, target })` (cap: `ui`)
- `ctx.events.on('note:open', …)` to track the current note (no capability needed)
- `ctx.ui.notify(...)` for feedback
- vDOM `on:` action maps (§5.7) delivered to `onEvent`

## Capabilities

```json
["ui", "sections", "views"]
```

## How it works

The plugin keeps an in-memory bookmark list (a real plugin would declare
`storage` and persist via `ctx.storage`). It learns the current note from the
capability-free `note:open` lifecycle event, so it never needs the `editor`
capability.

Both the sidebar section and the full view return **vDOM** (never DOM). Buttons
declare actions via the `on:` map — `add-current` and `remove:<docId>` — which
the host delivers to the registration's `onEvent` handler. The plugin calls
`.update(vdom)` on the section/view handles to re-render after each change.

The nav item's `target` is the view id, so clicking it shows the Bookmarks view.
