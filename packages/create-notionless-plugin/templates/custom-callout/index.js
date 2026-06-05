import { definePlugin } from '@notionless/plugin-sdk'

/**
 * Custom Callout — exercises `ctx.editor.registerBlock`, the host-mediated
 * equivalent of hand-writing a CM6 `WidgetType`. It owns a `:::<kind>` fenced
 * block and round-trips it: raw Markdown → JSON model → vDOM card → Markdown.
 *
 * Capabilities: ["editor"]
 *
 * Markdown shape this block owns:
 *
 *   :::tip Optional title
 *   body line one
 *   body line two
 *   :::
 *
 * `kind` is one of tip | warn | note | danger (defaults to note).
 */

const KINDS = {
  tip: { icon: '💡', label: 'Tip', cls: 'callout-tip' },
  note: { icon: '📝', label: 'Note', cls: 'callout-note' },
  warn: { icon: '⚠️', label: 'Warning', cls: 'callout-warn' },
  danger: { icon: '🚫', label: 'Danger', cls: 'callout-danger' },
}

/** Parse the raw block source (including the ::: fences) into a JSON model. */
function parseMarkdown(raw) {
  const lines = String(raw).replace(/\r\n/g, '\n').split('\n')
  // First line: ":::kind optional title"
  const first = lines[0] || ':::'
  const m = first.match(/^:::\s*([a-zA-Z]+)?\s*(.*)$/)
  const kindRaw = (m && m[1] ? m[1] : 'note').toLowerCase()
  const kind = Object.prototype.hasOwnProperty.call(KINDS, kindRaw) ? kindRaw : 'note'
  const title = (m && m[2] ? m[2].trim() : '')

  // Body = everything between the opening fence and the closing ":::".
  let end = lines.length
  for (let i = lines.length - 1; i >= 1; i -= 1) {
    if (lines[i].trim() === ':::') { end = i; break }
  }
  const body = lines.slice(1, end).join('\n')
  return { kind, title, body }
}

/** Serialize a model back to its canonical Markdown (round-trip). */
function toMarkdown(model) {
  const kind = Object.prototype.hasOwnProperty.call(KINDS, model.kind) ? model.kind : 'note'
  const titlePart = model.title ? ` ${model.title}` : ''
  const body = model.body != null ? String(model.body) : ''
  return `:::${kind}${titlePart}\n${body}\n:::`
}

/** Render a model into host-mounted vDOM (sanitized + mounted by the host). */
function render(model) {
  const meta = KINDS[model.kind] || KINDS.note
  const heading = model.title || meta.label
  // Split body into paragraphs so the card reads nicely.
  const paragraphs = String(model.body || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  /** @type {Array<object>} */
  const children = [
    {
      tag: 'div',
      attrs: { class: 'callout-head' },
      children: [
        { tag: 'span', attrs: { class: 'callout-icon', 'aria-hidden': 'true' }, children: [meta.icon] },
        { tag: 'strong', attrs: { class: 'callout-title' }, children: [heading] },
      ],
    },
  ]
  for (const p of paragraphs.length ? paragraphs : ['']) {
    children.push({ tag: 'p', attrs: { class: 'callout-body' }, children: [p] })
  }

  return {
    tag: 'div',
    attrs: {
      class: `plugin-callout ${meta.cls}`,
      role: 'note',
      'data-kind': model.kind,
    },
    children,
  }
}

export default definePlugin({
  async activate(ctx) {
    this._disposables = []

    // Register the callout block. `fence: ':::'` tells the host this block owns
    // FencedCode-style `:::` regions; the host synthesizes a PluginBlockWidget
    // whose eq() compares by raw source and toDOM() mounts render(model).
    const block = ctx.editor.registerBlock({
      type: 'callout',
      fence: ':::',
      parseMarkdown,
      render,
      toMarkdown,
      interactive: false, // read-only card; click into the raw Markdown to edit
    })
    this._disposables.push(block)
  },

  async deactivate() {
    for (const d of this._disposables || []) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this._disposables = []
  },
})
