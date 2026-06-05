/**
 * Nested-page links for the CodeMirror 6 editor.
 *
 * Two link syntaxes render as clickable "page chips":
 *   - `[Title](doc:<docId>)`  — precise link to a document by its stable id
 *   - `[[Wiki Title]]`        — Obsidian-style link resolved by page title
 *
 * Clicking a chip dispatches a `cmd:open-page` window event; main.js resolves
 * the target (open existing / create missing) and opens it. The chip is only
 * shown when the cursor is outside the link, so the raw markdown stays editable.
 */
import { WidgetType, Decoration } from '@codemirror/view'

// [[Title]] | [[Title|alias]] | [[Title#section]]
export const WIKILINK_RE = /\[\[([^\[\]|#]+?)(?:#[^\[\]|]*)?(?:\|([^\[\]]+?))?\]\]/g

export class PageChipWidget extends WidgetType {
  /** @param {{kind:'doc'|'wiki', value:string, title:string}} target */
  constructor(target) {
    super()
    this.target = target
  }

  eq(other) {
    return other.target.kind === this.target.kind
      && other.target.value === this.target.value
      && other.target.title === this.target.title
  }

  toDOM() {
    const chip = document.createElement('span')
    chip.className = 'cm-pagelink'
    chip.innerHTML = `<span class="cm-pagelink-icon"><i class="far fa-file-alt"></i></span><span class="cm-pagelink-text"></span>`
    chip.querySelector('.cm-pagelink-text').textContent = this.target.title
    chip.title = this.target.kind === 'wiki'
      ? `Open “${this.target.title}”`
      : `Open page`
    chip.addEventListener('mousedown', (e) => { e.preventDefault() })
    chip.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      window.dispatchEvent(new CustomEvent('cmd:open-page', { detail: this.target }))
    })
    return chip
  }

  ignoreEvent() { return true }
}

/**
 * Collect wiki-link replace decorations for the whole document.
 * Skips matches that fall inside code ranges or where the cursor sits inside
 * the link (so it can be edited). `codeRanges` is an array of {from,to}.
 */
export function collectWikiLinkDecorations(state, codeRanges, cursorInRange) {
  const decos = []
  const text = state.doc.toString()
  WIKILINK_RE.lastIndex = 0
  let m
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const from = m.index
    const to = from + m[0].length
    if (codeRanges.some(r => from < r.to && to > r.from)) continue
    if (cursorInRange(state, from, to)) continue
    const title = (m[1] || '').trim()
    if (!title) continue
    decos.push(
      Decoration.replace({
        widget: new PageChipWidget({ kind: 'wiki', value: title, title }),
      }).range(from, to)
    )
  }
  return decos
}

/** Normalised candidate titles for a file name, for wiki-link matching. */
export function titleVariants(fileName) {
  const base = String(fileName).replace(/\.(md|note)$/i, '')
  const spaced = base.replace(/_/g, ' ')
  return Array.from(new Set([base, spaced]))
}
