/**
 * Table-of-contents block for the CodeMirror 6 editor.
 *
 * A line that is exactly `[[toc]]` or `[TOC]` (case-insensitive) renders as a
 * clickable, indented outline of the document's ATX headings (`#`–`######`).
 * Clicking an entry scrolls the editor to that heading.
 *
 * Detection lives in cm-hide-markers.js; raw markdown is shown on cursor-touch
 * so the marker stays editable. The widget receives the EditorView via the
 * standard `toDOM(view)` parameter and scrolls via EditorView.scrollIntoView —
 * fully self-contained, no main.js coupling.
 */
import { WidgetType, EditorView } from '@codemirror/view'

// A whole line that is just [[toc]] or [TOC] (case-insensitive).
export const TOC_RE = /^\s*(?:\[\[toc\]\]|\[toc\])\s*$/i

/** Scan the document for ATX headings → [{ level, text, pos }]. */
export function collectHeadings(state) {
  const headings = []
  const doc = state.doc
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const m = line.text.match(/^(#{1,6})\s+(.*)$/)
    if (m) {
      const text = m[2].replace(/\s+#*\s*$/, '').trim()
      if (text) headings.push({ level: m[1].length, text, pos: line.from })
    }
  }
  return headings
}

export class TocWidget extends WidgetType {
  // Re-render only when the heading outline actually changes.
  constructor(signature) {
    super()
    this.signature = signature
  }

  eq(other) { return other.signature === this.signature }

  toDOM(view) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-toc'

    const heading = document.createElement('div')
    heading.className = 'cm-toc-heading'
    heading.textContent = 'Table of Contents'
    wrap.appendChild(heading)

    const headings = collectHeadings(view.state)
    if (!headings.length) {
      const empty = document.createElement('div')
      empty.className = 'cm-toc-empty'
      empty.textContent = 'No headings yet'
      wrap.appendChild(empty)
      return wrap
    }

    const minLevel = headings.reduce((min, h) => Math.min(min, h.level), 6)
    const list = document.createElement('div')
    list.className = 'cm-toc-list'

    for (const h of headings) {
      const item = document.createElement('div')
      item.className = 'cm-toc-item'
      item.style.paddingLeft = `${(h.level - minLevel) * 16}px`
      item.textContent = h.text
      item.addEventListener('mousedown', (e) => { e.preventDefault() })
      item.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const pos = Math.min(h.pos, view.state.doc.length)
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'start' }),
        })
        view.focus()
      })
      list.appendChild(item)
    }

    wrap.appendChild(list)
    return wrap
  }

  ignoreEvent() { return true }
}

/** A signature string capturing the heading outline (for widget eq()). */
export function tocSignature(state) {
  return collectHeadings(state).map(h => `${h.level}:${h.text}`).join('|')
}
