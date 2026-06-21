/**
 * Obsidian / Notion-style callouts (admonitions) for the CodeMirror 6 editor.
 *
 * A Blockquote whose first line is `[!TYPE]` (optionally `[!TYPE] Title`)
 * renders as a coloured box with an icon, a title, and the remaining quote
 * lines as the body:
 *
 *   > [!warning] Heads up
 *   > Be careful here.
 *
 * Detection lives in cm-hide-markers.js (the `Blockquote` handler). Raw
 * markdown is shown when the cursor touches the block so it stays editable.
 * Body lines are rendered as plain text (leading `> ` stripped) — full nested
 * markdown rendering is intentionally not attempted, to keep this robust.
 */
import { WidgetType } from '@codemirror/view'
import { renderInline } from './cm-inline-render'

// Matches the first line of a callout blockquote.
export const CALLOUT_RE = /^>\s*\[!(\w+)\]\s*(.*)$/i

// type aliases → canonical kind
const TYPE_ALIAS = {
  note: 'note',
  tip: 'tip',
  info: 'info',
  warning: 'warning',
  caution: 'warning',
  danger: 'danger',
  error: 'danger',
  success: 'success',
}

const META = {
  note: { icon: '📝', label: 'Note' },
  tip: { icon: '💡', label: 'Tip' },
  info: { icon: 'ℹ️', label: 'Info' },
  warning: { icon: '⚠️', label: 'Warning' },
  danger: { icon: '🛑', label: 'Danger' },
  success: { icon: '✅', label: 'Success' },
}

/** Resolve a raw type token (any case / alias) to a canonical kind. */
export function calloutKind(rawType) {
  return TYPE_ALIAS[String(rawType).toLowerCase()] || 'note'
}

/** Parse a blockquote's full text into { kind, title, body[] } or null. */
export function parseCallout(text) {
  const lines = text.split('\n')
  const first = lines[0] || ''
  const m = first.match(CALLOUT_RE)
  if (!m) return null
  const kind = calloutKind(m[1])
  const title = (m[2] || '').trim() || META[kind].label
  const body = lines.slice(1).map(l => l.replace(/^>\s?/, ''))
  // Drop trailing empty body lines for a tidy box.
  while (body.length && body[body.length - 1].trim() === '') body.pop()
  return { kind, title, body }
}

export class CalloutWidget extends WidgetType {
  /** @param {string} text full blockquote text (raw, with `> ` prefixes) */
  constructor(text) {
    super()
    this.text = text
    this.parsed = parseCallout(text) || { kind: 'note', title: 'Note', body: [] }
  }

  eq(other) { return other.text === this.text }

  toDOM() {
    const { kind, title, body } = this.parsed
    const meta = META[kind] || META.note
    const box = document.createElement('div')
    box.className = `cm-callout cm-callout-${kind}`

    const head = document.createElement('div')
    head.className = 'cm-callout-title'
    const icon = document.createElement('span')
    icon.className = 'cm-callout-icon'
    icon.textContent = meta.icon
    const titleText = document.createElement('span')
    titleText.className = 'cm-callout-title-text'
    titleText.innerHTML = renderInline(title)
    head.appendChild(icon)
    head.appendChild(titleText)
    box.appendChild(head)

    if (body.length) {
      const bodyEl = document.createElement('div')
      bodyEl.className = 'cm-callout-body'
      for (const line of body) {
        const p = document.createElement('div')
        p.className = 'cm-callout-line'
        // Render inline markdown + math; preserve blank lines as a gap.
        if (line.trim() === '') p.innerHTML = '&nbsp;'
        else p.innerHTML = renderInline(line)
        bodyEl.appendChild(p)
      }
      box.appendChild(bodyEl)
    }

    return box
  }

  ignoreEvent() { return true }
}
