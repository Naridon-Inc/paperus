/**
 * Multi-column layout for the CodeMirror 6 markdown editor.
 *
 * A fenced block tagged `columns` renders its body side-by-side. Columns are
 * separated by a line containing only `---` (or `:::`):
 *
 *   ```columns
 *   Left column text
 *   ---
 *   Right column text
 *   ```
 *
 * Detection lives in the FencedCode branch of cm-hide-markers.js; raw markdown
 * is shown on cursor-touch so the block stays editable.
 *
 * APPROACH / LIMITATION: this is a READ-PREVIEW widget. Side-by-side *editing*
 * inside a single CM document is not attempted (it would require interleaving
 * column text, which is fragile); instead the columns render as lightly-
 * formatted plain text and the raw fenced source is revealed for editing the
 * moment the cursor enters the block. Each column's lines get minimal inline
 * formatting (bullets, bold/italic/code markers stripped).
 */
import { WidgetType } from '@codemirror/view'
import { renderInline } from './cm-inline-render'

/** True if a FencedCode block's opening line declares the `columns` language. */
export function isColumnsFence(firstLineText) {
  return /^\s*`{3,}\s*columns\s*$/i.test(firstLineText)
}

/** Strip the fence lines, returning the inner body. */
function extractBody(text) {
  return text
    .replace(/^\s*`{3,}\s*columns\s*\n?/i, '')
    .replace(/\n?`{3,}\s*$/, '')
}

/** Split body into columns on lines that are only `---` or `:::`. */
function splitColumns(body) {
  const cols = [[]]
  for (const line of body.split('\n')) {
    if (/^\s*(?:---|:::)\s*$/.test(line)) {
      cols.push([])
    } else {
      cols[cols.length - 1].push(line)
    }
  }
  return cols.map(lines => lines.join('\n').trim()).filter((c, i, a) => c !== '' || a.length === 1)
}

function renderLine(line) {
  const trimmed = line.trim()
  const div = document.createElement('div')
  div.className = 'cm-columns-line'
  if (trimmed === '') { div.innerHTML = '&nbsp;'; return div }
  const heading = line.match(/^(#{1,6})\s+(.*)$/)
  if (heading) {
    div.className = `cm-columns-h cm-columns-h${heading[1].length}`
    div.innerHTML = renderInline(heading[2])
    return div
  }
  // Render inline markdown + math; turn list markers into a bullet glyph.
  const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
  div.innerHTML = bullet ? `• ${renderInline(bullet[1])}` : renderInline(line)
  return div
}

export class ColumnsWidget extends WidgetType {
  constructor(text) {
    super()
    this.text = text
    this.columns = splitColumns(extractBody(text))
  }

  eq(other) { return other.text === this.text }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-columns'
    for (const col of this.columns) {
      const colEl = document.createElement('div')
      colEl.className = 'cm-columns-col'
      for (const line of col.split('\n')) colEl.appendChild(renderLine(line))
      wrap.appendChild(colEl)
    }
    return wrap
  }

  ignoreEvent() { return true }
}
