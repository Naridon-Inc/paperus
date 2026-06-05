/**
 * KaTeX math rendering for the CodeMirror 6 markdown editor.
 *
 * Two syntaxes render as math in live preview:
 *   - inline `$...$`   → MathWidget (displayMode false)
 *   - block  `$$...$$` → BlockMathWidget (displayMode true)
 *
 * Raw markdown is shown (and editable) when the cursor touches the span — the
 * detection / cursor-touch logic lives in cm-hide-markers.js. Inline math is
 * collected through the same suppression machinery the wiki-links use so it
 * never overlaps emphasis/code marker decorations (RangeSet throws on overlap).
 */
import { WidgetType, Decoration } from '@codemirror/view'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/** Render a TeX string to an HTML string. Never throws (errors render inline). */
export function renderMath(tex, displayMode) {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode: !!displayMode,
    })
  } catch (err) {
    const safe = String(tex).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    return `<span class="cm-math-error">${safe}</span>`
  }
}

// Inline `$...$`: no spaces directly inside the delimiters, single line, and
// not part of a `$$` block (negative look-arounds guard the doubled dollars).
export const INLINE_MATH_RE = /(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g

export class MathWidget extends WidgetType {
  constructor(tex) {
    super()
    this.tex = tex
  }

  eq(other) { return other.tex === this.tex }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-math-inline'
    span.innerHTML = renderMath(this.tex, false)
    return span
  }

  ignoreEvent() { return true }
}

export class BlockMathWidget extends WidgetType {
  constructor(tex) {
    super()
    this.tex = tex
  }

  eq(other) { return other.tex === this.tex }

  toDOM() {
    const div = document.createElement('div')
    div.className = 'cm-math-block'
    div.innerHTML = renderMath(this.tex, true)
    return div
  }

  ignoreEvent() { return true }
}

/**
 * Collect inline-math replace decorations for the whole document.
 * Mirrors collectWikiLinkDecorations: skips matches inside code ranges or where
 * the cursor overlaps the span. `cursorInRange(state, from, to)` decides reveal.
 * Returns { decos, ranges } — ranges feed the inline-marker suppression guard.
 */
export function collectInlineMathDecorations(state, codeRanges, cursorInRange) {
  const decos = []
  const ranges = []
  const text = state.doc.toString()
  INLINE_MATH_RE.lastIndex = 0
  let m
  while ((m = INLINE_MATH_RE.exec(text)) !== null) {
    const from = m.index
    const to = from + m[0].length
    const tex = (m[1] || '').trim()
    if (!tex) continue
    if (codeRanges.some(r => from < r.to && to > r.from)) continue
    ranges.push({ from, to })
    if (cursorInRange(state, from, to)) continue
    decos.push(Decoration.replace({ widget: new MathWidget(tex) }).range(from, to))
  }
  return { decos, ranges }
}
