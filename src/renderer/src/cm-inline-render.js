/**
 * Shared inline-markdown → HTML renderer for block-decoration widgets.
 *
 * Block widgets (callouts, toggles, columns) used to drop their body/title into
 * the DOM as plain `textContent`, so inline markdown — `**bold**`, `*italic*`,
 * `` `code` ``, `~~del~~`, `==mark==`, `[links](url)` — and inline math `$…$`
 * showed up as raw source. This module renders those inline constructs to safe
 * HTML so the widgets read like a document, matching the live-preview body.
 *
 * SAFETY: arbitrary HTML in the source is escaped first; only the markdown
 * constructs below are turned back into tags. Inline code and math are pulled
 * out into slots *before* escaping (their inner text must survive verbatim — math
 * is handed to KaTeX, code is escaped on its own) and spliced back in last, so
 * the emphasis passes never mangle them. Slot placeholders are wrapped in the C0
 * control chars U+0000 / U+0001 (illegal in Markdown source) so they can't be
 * forged from user text.
 *
 * SCOPE: inline only. Block constructs (lists, headings, fenced code, block math
 * `$$…$$`) are the host widget's concern — callers that want them render line by
 * line or handle headings themselves (see cm-columns.js).
 */
import { renderMath } from './cm-math'

// Display math `$$…$$` (single line — block widgets render one line at a time).
const DISPLAY_MATH_RE = /\$\$([^\n]+?)\$\$/g
// Inline math `$…$`: no space just inside the delimiters, single line, and not
// part of a `$$` block. Mirrors INLINE_MATH_RE in cm-math.js.
const INLINE_MATH_RE = /(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g
const INLINE_CODE_RE = /`([^`]+)`/g

// Slot sentinels: C0 control chars never present in real Markdown text.
const SLOT_OPEN = String.fromCharCode(0)
const SLOT_CLOSE = String.fromCharCode(1)
const SLOT_RE = new RegExp(`${SLOT_OPEN}(\\d+)${SLOT_CLOSE}`, 'g')

export function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Render a single span of inline markdown (+ inline math) to an HTML string.
 * @param {string} text raw markdown (one line / short span)
 * @returns {string} HTML safe to assign to innerHTML
 */
export function renderInline(text) {
  const slots = []
  const stash = (html) => `${SLOT_OPEN}${slots.push(html) - 1}${SLOT_CLOSE}`
  let s = String(text == null ? '' : text)

  // 1a) Display math `$$…$$` → KaTeX block. Done before inline so the doubled
  //     dollars are consumed first and never seen as two empty inline spans.
  s = s.replace(DISPLAY_MATH_RE, (m, tex) => {
    const t = (tex || '').trim()
    return t ? stash(renderMath(t, true)) : m
  })

  // 1b) Inline math `$…$` → KaTeX HTML. Extracted before escaping (tex is raw).
  s = s.replace(INLINE_MATH_RE, (m, tex) => {
    const t = (tex || '').trim()
    return t ? stash(renderMath(t, false)) : m
  })

  // 2) Inline code `…` → <code>. The code content is escaped on its own.
  s = s.replace(INLINE_CODE_RE, (_m, code) => stash(`<code>${escapeHtml(code)}</code>`))

  // 3) Escape the remaining plain text, THEN run emphasis on the escaped string.
  s = escapeHtml(s)
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => (
      /^(https?:|mailto:|doc:|#)/i.test(href) ? `<a href="${href}">${label}</a>` : label
    ))

  // 4) Splice the protected code/math slots back in.
  s = s.replace(SLOT_RE, (_m, i) => slots[Number(i)] ?? '')
  return s
}
