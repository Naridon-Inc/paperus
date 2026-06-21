/**
 * Collapsible toggle lists for the CodeMirror 6 editor.
 *
 * An HTML `<details><summary>…</summary> … </details>` block (parsed by the CM
 * markdown grammar as an HTMLBlock) renders as a Notion-style toggle: a
 * clickable disclosure header (▸ / ▾) that expands or collapses its body.
 *
 * APPROACH (chosen): replace the whole `<details>` block with a single
 * self-contained ToggleWidget. The summary becomes the clickable header and the
 * inner content is shown as plain-text body lines inside an expandable div.
 * Raw markdown is shown on cursor-touch (handled in cm-hide-markers.js) so the
 * block stays fully editable.
 *
 * LIMITATION: the body is rendered as plain text (HTML tags stripped, inner
 * markdown not re-rendered). This keeps the widget robust and avoids fragile
 * fold-state integration. Expand/collapse is widget-local UI state, lost on
 * re-render (which only happens when the doc text actually changes).
 */
import { WidgetType } from '@codemirror/view'
import { renderInline } from './cm-inline-render'

// Whole `<details>…</details>` block (case-insensitive, spans multiple lines).
export const DETAILS_RE = /^<details>[\s\S]*?<\/details>\s*$/i

/** True if a block of text is a `<details>` toggle block. */
export function isDetailsBlock(text) {
  return /^\s*<details>/i.test(text) && /<\/details>\s*$/i.test(text)
}

/** Parse a `<details>` block into { summary, body } (both plain text). */
export function parseDetails(text) {
  const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i)
  const summary = summaryMatch ? stripTags(summaryMatch[1]).trim() : 'Toggle'
  // Everything between </summary> (or <details>) and </details>.
  let inner = text
    .replace(/^[\s\S]*?<\/summary>/i, '')
    .replace(/<\/details>\s*$/i, '')
  if (!summaryMatch) {
    inner = text.replace(/^\s*<details>/i, '').replace(/<\/details>\s*$/i, '')
  }
  const body = stripTags(inner).replace(/^\n+/, '').replace(/\n+$/, '')
  return { summary: summary || 'Toggle', body }
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, '')
}

export class ToggleWidget extends WidgetType {
  constructor(text, open = false) {
    super()
    this.text = text
    this.open = open
    this.parsed = parseDetails(text)
  }

  eq(other) { return other.text === this.text && other.open === this.open }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-toggle'

    const header = document.createElement('div')
    header.className = 'cm-toggle-header'

    const tri = document.createElement('span')
    tri.className = 'cm-toggle-triangle'
    tri.textContent = this.open ? '▾' : '▸'

    const summary = document.createElement('span')
    summary.className = 'cm-toggle-summary'
    summary.innerHTML = renderInline(this.parsed.summary)

    header.appendChild(tri)
    header.appendChild(summary)

    const body = document.createElement('div')
    body.className = 'cm-toggle-body'
    body.style.display = this.open ? 'block' : 'none'
    if (this.parsed.body) {
      for (const line of this.parsed.body.split('\n')) {
        const p = document.createElement('div')
        p.className = 'cm-toggle-line'
        if (line.trim() === '') p.innerHTML = '&nbsp;'
        else p.innerHTML = renderInline(line)
        body.appendChild(p)
      }
    }

    header.addEventListener('mousedown', (e) => { e.preventDefault() })
    header.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.open = !this.open
      tri.textContent = this.open ? '▾' : '▸'
      body.style.display = this.open ? 'block' : 'none'
    })

    wrap.appendChild(header)
    wrap.appendChild(body)
    return wrap
  }

  ignoreEvent() { return true }
}
