/**
 * Highlight & text-colour marks for the CodeMirror 6 markdown editor.
 *
 * Syntax (detected by a doc-wide regex pass, independent of the markdown
 * parser — same approach as inline math):
 *   - `==text==`            → yellow highlight (class `cm-hl`)
 *   - `==color:text==`      → coloured highlight (class `cm-hl-<color>`),
 *                             color ∈ {yellow,green,blue,red,pink,orange,purple,gray}
 *
 * IMPLEMENTATION NOTE (overlap-safety): everything here uses `Decoration.mark`
 * (adds a CSS class, never replaces). Mark decorations may freely overlap other
 * marks AND replace ranges, so this is fully safe against the
 * INLINE_MARKS / wiki / math suppression machinery and never participates in the
 * non-overlapping replace invariant.
 *
 * The `==` markers themselves are hidden with a tiny `Decoration.mark`
 * (`cm-hl-marker`) that shrinks them to zero width via CSS when the cursor is
 * outside the span — we deliberately do NOT use `Decoration.replace` on the
 * markers, to avoid any chance of overlapping an existing inline replace widget.
 * When the cursor touches the span the markers render normally so the raw
 * markdown stays editable.
 */
import { Decoration } from '@codemirror/view'

// ==text== or ==color:text==  (no leading/trailing space directly inside ==)
// Group 1 = optional "color:" prefix word, Group 2 = the highlighted text.
export const HIGHLIGHT_RE = /==(?!\s)(?:(yellow|green|blue|red|pink|orange|purple|gray):)?([^\n=]+?)(?<!\s)==/gi

const COLORS = new Set(['yellow', 'green', 'blue', 'red', 'pink', 'orange', 'purple', 'gray'])

/**
 * Collect highlight mark decorations for the whole document.
 * Mirrors collectInlineMathDecorations' shape but emits ONLY mark decorations
 * (overlap-safe). Skips matches inside code ranges so `==` inside code stays raw.
 *
 * @param {EditorState} state
 * @param {{from:number,to:number}[]} codeRanges  inline/fenced code spans
 * @param {(state, from, to) => boolean} cursorInRange  reveal predicate
 * @returns {{from:number,to:number}[]} decoration ranges (already pushed via cb)
 */
export function collectHighlightDecorations(state, codeRanges, cursorInRange) {
  const decos = []
  const text = state.doc.toString()
  HIGHLIGHT_RE.lastIndex = 0
  let m
  while ((m = HIGHLIGHT_RE.exec(text)) !== null) {
    const from = m.index
    const to = from + m[0].length
    if (codeRanges.some(r => from < r.to && to > r.from)) continue
    const color = (m[1] || '').toLowerCase()
    const inner = m[2] || ''
    if (!inner.trim()) continue
    const cls = color && COLORS.has(color) ? `cm-hl cm-hl-${color}` : 'cm-hl'

    // Body span (between the == markers).
    const markerLen = color ? 2 + color.length + 1 : 2 // == or ==color:
    const bodyFrom = from + markerLen
    const bodyTo = to - 2
    if (bodyTo > bodyFrom) {
      decos.push(Decoration.mark({ class: cls }).range(bodyFrom, bodyTo))
    }

    // Hide the == markers (and color: prefix) unless the cursor touches the span.
    if (!cursorInRange(state, from, to)) {
      decos.push(Decoration.mark({ class: 'cm-hl-marker' }).range(from, bodyFrom))
      decos.push(Decoration.mark({ class: 'cm-hl-marker' }).range(bodyTo, to))
    }
  }
  return decos
}
