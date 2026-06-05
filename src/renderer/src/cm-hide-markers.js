/**
 * Live Preview decorations for CodeMirror 6 markdown editor.
 * Uses StateField (not ViewPlugin) so we can provide block-level and
 * cross-line replace decorations (tables, horizontal rules, etc.).
 */
import { EditorView, Decoration, WidgetType } from '@codemirror/view'
import { StateField, RangeSet } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { DatabaseWidget, isDatabaseFence } from './database-widget'
import { PageChipWidget, collectWikiLinkDecorations, WIKILINK_RE } from './page-links'
import { ImageWidget } from './cm-image'
import { CalloutWidget, CALLOUT_RE } from './cm-callout'
import { BlockMathWidget, collectInlineMathDecorations } from './cm-math'
import { MermaidWidget, isMermaidFence } from './cm-mermaid'
import { ToggleWidget, isDetailsBlock } from './cm-toggle'
import { TocWidget, TOC_RE, tocSignature } from './cm-toc'
import { collectHighlightDecorations } from './cm-highlight'
import {
  EmbedWidget, resolveEmbedSrc, isEmbedUrlLine, isEmbedFence,
  extractFenceUrl, isIframeBlock, extractIframeSrc
} from './cm-embed'
import { BookmarkWidget, bookmarkUrlForLine } from './cm-bookmark'
import { TranscludeWidget, TRANSCLUDE_RE } from './cm-transclude'
import { ColumnsWidget, isColumnsFence } from './cm-columns'
import { collectDateDecorations, DATE_TOKEN_RE } from './cm-mention'
import { collectCriticDecorations } from './cm-suggest'

// Block math `$$ … $$` (may span lines). Used in a doc-wide regex pass.
const BLOCK_MATH_RE = /\$\$([\s\S]+?)\$\$/g

// ── Widgets ──────────────────────────────────────────────────────────────────

class HRWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('hr')
    hr.className = 'cm-hr'
    return hr
  }
  eq() { return true }
}

class CheckboxWidget extends WidgetType {
  constructor(checked) {
    super()
    this.checked = checked
  }
  eq(other) { return this.checked === other.checked }
  toDOM(view) {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.checked
    cb.className = 'cm-checkbox'
    cb.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const pos = view.posAtDOM(cb)
      const line = view.state.doc.lineAt(pos)
      const text = line.text
      const newText = this.checked
        ? text.replace('[x]', '[ ]').replace('[X]', '[ ]')
        : text.replace('[ ]', '[x]')
      view.dispatch({ changes: { from: line.from, to: line.to, insert: newText } })
    })
    return cb
  }
}

class TableWidget extends WidgetType {
  constructor(text, from, to) {
    super()
    this.text = text
    this.from = from
    this.to = to
    this._data = this._parse(text)
  }
  eq(other) { return this.text === other.text }
  ignoreEvent() { return true } // let clicks/input through to the widget

  _parse(text) {
    const lines = text.split('\n').filter(l => l.trim())
    const headers = []
    const rows = []
    let sepIdx = -1

    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) { sepIdx = i; continue }
      const cells = lines[i].split('|').slice(1, -1).map(c => c.trim())
      if (sepIdx === -1 && headers.length === 0) headers.push(...cells)
      else rows.push(cells)
    }
    return { headers, rows }
  }

  _toMarkdown(data) {
    const colCount = data.headers.length
    const pad = (arr) => arr.map((c, i) => {
      const s = c || ''
      return ` ${s} `
    })
    const headerLine = '|' + pad(data.headers).join('|') + '|'
    const sepLine = '|' + data.headers.map(() => ' --- ').join('|') + '|'
    const bodyLines = data.rows.map(row => {
      // Ensure row has correct column count
      const padded = Array.from({ length: colCount }, (_, i) => row[i] || '')
      return '|' + pad(padded).join('|') + '|'
    })
    return [headerLine, sepLine, ...bodyLines].join('\n')
  }

  toDOM(view) {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-table-wrapper'
    const data = this._data
    const table = document.createElement('table')
    table.className = 'cm-table'

    const commit = () => {
      const md = this._toMarkdown(data)
      view.dispatch({ changes: { from: this.from, to: this.to, insert: md } })
    }

    const makeCell = (tag, text, rowIdx, colIdx) => {
      const el = document.createElement(tag)
      el.textContent = text
      el.contentEditable = 'true'
      el.className = 'cm-table-cell'

      el.addEventListener('focus', () => el.classList.add('cm-cell-active'))
      el.addEventListener('blur', () => {
        el.classList.remove('cm-cell-active')
        const newVal = el.textContent.trim()
        if (rowIdx === -1) {
          if (data.headers[colIdx] === newVal) return
          data.headers[colIdx] = newVal
        } else {
          if ((data.rows[rowIdx]?.[colIdx] || '') === newVal) return
          if (!data.rows[rowIdx]) data.rows[rowIdx] = []
          data.rows[rowIdx][colIdx] = newVal
        }
        commit()
      })

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault()
          const allCells = [...table.querySelectorAll('.cm-table-cell')]
          const idx = allCells.indexOf(el)
          const next = e.shiftKey ? allCells[idx - 1] : allCells[idx + 1]
          if (next) next.focus()
        }
        if (e.key === 'Escape') {
          el.blur()
          view.focus()
        }
      })

      return el
    }

    // Column delete buttons row
    const colActions = document.createElement('tr')
    colActions.className = 'cm-table-col-actions'
    data.headers.forEach((_, ci) => {
      const td = document.createElement('td')
      const btn = document.createElement('button')
      btn.className = 'cm-table-del-col'
      btn.title = 'Delete column'
      btn.innerHTML = '×'
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        if (data.headers.length <= 1) return
        data.headers.splice(ci, 1)
        data.rows.forEach(row => row.splice(ci, 1))
        commit()
      })
      td.appendChild(btn)
      colActions.appendChild(td)
    })
    table.appendChild(colActions)

    // Header row
    const thead = document.createElement('tr')
    data.headers.forEach((h, ci) => thead.appendChild(makeCell('th', h, -1, ci)))
    table.appendChild(thead)

    // Body rows
    data.rows.forEach((row, ri) => {
      const tr = document.createElement('tr')
      const colCount = data.headers.length
      // Row delete button
      const delTd = document.createElement('td')
      delTd.className = 'cm-table-row-action'
      const delBtn = document.createElement('button')
      delBtn.className = 'cm-table-del-row'
      delBtn.title = 'Delete row'
      delBtn.innerHTML = '×'
      delBtn.addEventListener('click', (e) => {
        e.preventDefault()
        data.rows.splice(ri, 1)
        commit()
      })
      delTd.appendChild(delBtn)
      tr.appendChild(delTd)

      for (let ci = 0; ci < colCount; ci++) {
        tr.appendChild(makeCell('td', row[ci] || '', ri, ci))
      }
      table.appendChild(tr)
    })

    // Also add empty action cell to header and col-actions rows for alignment
    const emptyTh = document.createElement('td')
    emptyTh.className = 'cm-table-row-action'
    thead.insertBefore(emptyTh, thead.firstChild)
    const emptyColAct = document.createElement('td')
    emptyColAct.className = 'cm-table-row-action'
    colActions.insertBefore(emptyColAct, colActions.firstChild)

    wrapper.appendChild(table)

    // Table toolbar: add row / add column
    const toolbar = document.createElement('div')
    toolbar.className = 'cm-table-toolbar'

    const addRowBtn = document.createElement('button')
    addRowBtn.textContent = '+ Row'
    addRowBtn.className = 'cm-table-action'
    addRowBtn.addEventListener('click', (e) => {
      e.preventDefault()
      data.rows.push(Array(data.headers.length).fill(''))
      commit()
    })

    const addColBtn = document.createElement('button')
    addColBtn.textContent = '+ Column'
    addColBtn.className = 'cm-table-action'
    addColBtn.addEventListener('click', (e) => {
      e.preventDefault()
      data.headers.push('Header')
      data.rows.forEach(row => row.push(''))
      commit()
    })

    toolbar.appendChild(addRowBtn)
    toolbar.appendChild(addColBtn)
    wrapper.appendChild(toolbar)

    return wrapper
  }
}

function renderInline(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cursorInRange(state, from, to) {
  for (const r of state.selection.ranges) {
    const rFrom = state.doc.lineAt(r.from).number
    const rTo = state.doc.lineAt(r.to).number
    const nFrom = state.doc.lineAt(from).number
    const nTo = state.doc.lineAt(Math.min(to, state.doc.length)).number
    if (rFrom <= nTo && rTo >= nFrom) return true
  }
  return false
}

function parentRange(node) {
  const p = node.node.parent
  return p ? { from: p.from, to: p.to } : { from: node.from, to: node.to }
}

// ── Decoration builder ───────────────────────────────────────────────────────

function cursorInsideNode(state, from, to) {
  // Check if cursor is strictly inside (between markers), not just on the same line
  for (const r of state.selection.ranges) {
    if (r.from >= from && r.to <= to) return true
  }
  return false
}

function buildDecorations(state) {
  const decos = []
  const codeRanges = []
  // Ranges of "always-on" interactive widgets (tables, databases). These render
  // as the rich widget even while the cursor is inside — you edit through the
  // widget's own cells, never the raw markdown/JSON. We mark them atomic so the
  // caret skips over them with the arrow keys and Backspace at an edge removes
  // the whole block (instead of stranding the caret in an invisible range).
  const atomicRanges = []

  // End offset of the YAML front-matter block (0 if none) — used to keep the
  // bookmark/embed line pass from overlapping the front-matter replace, since a
  // `bookmark: <url>` line looks just like a YAML key.
  let frontMatterEnd = 0

  // ── Hide YAML front-matter (page icon/cover metadata) when not editing it ──
  {
    const head = state.doc.sliceString(0, Math.min(state.doc.length, 2000))
    const fm = head.match(/^---\n[\s\S]*?\n---\n?/)
    if (fm) {
      const end = fm[0].length
      frontMatterEnd = end
      // Reveal only when the cursor is placed inside the block (not at pos 0,
      // which is the default on open). Otherwise hide it entirely.
      const cursorInFm = state.selection.ranges.some(r => r.from > 0 && r.from < end)
      if (!cursorInFm) {
        decos.push(Decoration.replace({}).range(0, end))
      }
    }
  }

  // Raw [[wiki-link]] ranges, used to suppress overlapping inline decorations
  // (the markdown parser may treat the brackets as a link reference).
  const wikiRanges = []
  {
    const text = state.doc.toString()
    WIKILINK_RE.lastIndex = 0
    let wm
    while ((wm = WIKILINK_RE.exec(text)) !== null) {
      wikiRanges.push({ from: wm.index, to: wm.index + wm[0].length })
    }
  }
  const inWiki = (from, to) => wikiRanges.some(r => from < r.to && to > r.from)

  // ── Block math `$$ … $$` (doc-wide pass) ──────────────────────────────────
  // Collected before the tree walk so the tree handlers can skip nodes that
  // fall inside a math block (avoids overlapping replace decorations).
  const blockMathRanges = []
  {
    const docText = state.doc.toString()
    BLOCK_MATH_RE.lastIndex = 0
    let bm
    while ((bm = BLOCK_MATH_RE.exec(docText)) !== null) {
      const from = bm.index
      const to = from + bm[0].length
      const tex = (bm[1] || '').trim()
      if (!tex) continue
      blockMathRanges.push({ from, to })
      if (!cursorInRange(state, from, to)) {
        decos.push(
          Decoration.replace({ widget: new BlockMathWidget(tex), block: true }).range(from, to)
        )
      }
    }
  }
  const inBlockMath = (from, to) => blockMathRanges.some(r => from < r.to && to > r.from)

  // Inline math `$...$` ranges. Collected up-front (regex over doc text) purely
  // so the tree-walk inline-marker handlers can suppress overlaps; the actual
  // replace decorations are pushed AFTER the walk (alongside the wiki pass),
  // because they need the complete `codeRanges` set the walk fills in.
  const mathRanges = []
  {
    const docText = state.doc.toString()
    const re = /(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g
    let im
    while ((im = re.exec(docText)) !== null) {
      const tex = (im[1] || '').trim()
      if (!tex) continue
      mathRanges.push({ from: im.index, to: im.index + im[0].length })
    }
  }
  const inMath = (from, to) => mathRanges.some(r => from < r.to && to > r.from)

  // Transclusion `![[Page]]` whole-line ranges. Collected before the tree walk
  // because the parser emits Image/Link/LinkMark children for `![[…]]`, whose
  // inline `replace` decorations would overlap our block-level TranscludeWidget
  // replace (RangeSet throws on overlapping replaces). The actual widget decos
  // are pushed after the walk; here we only record ranges for the suppression
  // guard and the wiki-pass exclusion.
  const transcludeRanges = []
  {
    for (let i = 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i)
      if (TRANSCLUDE_RE.test(line.text)) {
        transcludeRanges.push({ from: line.from, to: line.to })
      }
    }
  }
  const inTransclude = (from, to) => transcludeRanges.some(r => from < r.to && to > r.from)

  // `@date(YYYY-MM-DD[|remind])` token ranges. Each renders as a chip via an
  // inline `Decoration.replace` (pushed after the walk), so inline-marker decos
  // inside the token must be suppressed to keep the non-overlapping invariant.
  const dateRanges = []
  {
    const docText = state.doc.toString()
    DATE_TOKEN_RE.lastIndex = 0
    let dm
    while ((dm = DATE_TOKEN_RE.exec(docText)) !== null) {
      dateRanges.push({ from: dm.index, to: dm.index + dm[0].length })
    }
  }
  const inDate = (from, to) => dateRanges.some(r => from < r.to && to > r.from)

  const INLINE_MARKS = new Set(['LinkMark', 'URL', 'EmphasisMark', 'StrikethroughMark', 'CodeMark'])

  // Block/inline `Decoration.replace` ranges produced by the tree walk that could
  // CONTAIN a `@date(…)` token (table cells, callouts, image alt, link titles).
  // The date-chip pass (also a replace) must skip these to keep the
  // non-overlapping-replace invariant. Marks aren't collected (they may overlap).
  const replaceBlockRanges = []

  syntaxTree(state).iterate({
    enter(node) {
      const { from, to, name } = node

      // Track code ranges (for wiki-link exclusion) and don't let inline marker
      // decorations land inside a wiki-link span (would overlap the chip).
      if (name === 'FencedCode' || name === 'InlineCode') codeRanges.push({ from, to })
      if (INLINE_MARKS.has(name) && (inWiki(from, to) || inMath(from, to) || inBlockMath(from, to) || inTransclude(from, to) || inDate(from, to))) return

      // ── Headings: always hide markers, apply line class ──
      if (/^ATXHeading([1-6])$/.test(name)) {
        const level = name.match(/\d/)[0]
        const line = state.doc.lineAt(from)
        decos.push(Decoration.line({ class: `cm-heading cm-heading-${level}` }).range(line.from))
      }

      if (name === 'HeaderMark') {
        const pr = parentRange(node)
        if (cursorInRange(state, pr.from, pr.to)) {
          // Cursor on this heading — show markers but subtle
          let end = to
          if (state.doc.sliceString(end, end + 1) === ' ') end++
          decos.push(Decoration.mark({ class: 'cm-subtle-mark' }).range(from, end))
        } else {
          let end = to
          if (state.doc.sliceString(end, end + 1) === ' ') end++
          decos.push(Decoration.replace({}).range(from, end))
        }
      }

      // ── Emphasis markers (**, *, ~~) — hide unless cursor is inside the span ──
      if (name === 'EmphasisMark') {
        const p = node.node.parent
        if (p && p.name !== 'FencedCode') {
          if (!cursorInsideNode(state, p.from, p.to)) {
            decos.push(Decoration.replace({}).range(from, to))
          }
        }
      }

      if (name === 'StrikethroughMark') {
        const p = node.node.parent
        if (p && !cursorInsideNode(state, p.from, p.to)) {
          decos.push(Decoration.replace({}).range(from, to))
        }
      }

      // ── Inline code backticks ──
      if (name === 'CodeMark') {
        const p = node.node.parent
        if (p && p.name === 'InlineCode') {
          if (!cursorInsideNode(state, p.from, p.to)) {
            decos.push(Decoration.replace({}).range(from, to))
          }
        }
      }

      // ── Blockquote > markers ──
      if (name === 'QuoteMark') {
        const line = state.doc.lineAt(from)
        let end = to
        if (state.doc.sliceString(end, end + 1) === ' ') end++
        if (cursorInRange(state, line.from, line.to)) {
          decos.push(Decoration.mark({ class: 'cm-subtle-mark' }).range(from, end))
        } else {
          decos.push(Decoration.replace({}).range(from, end))
        }
      }

      // ── Callout / Blockquote ──
      if (name === 'Blockquote') {
        const qText = state.doc.sliceString(from, to)
        const firstLine = (qText.split('\n')[0] || '')
        // Callout: first line is `[!TYPE]` optionally with a title. Render the
        // whole blockquote as a coloured box when the cursor isn't touching it.
        if (CALLOUT_RE.test(firstLine)) {
          if (!cursorInRange(state, from, to)) {
            decos.push(
              Decoration.replace({ widget: new CalloutWidget(qText), block: true }).range(from, to)
            )
            replaceBlockRanges.push({ from, to })
            return false // skip QuoteMark / inline children inside the callout
          }
        }

        // Plain blockquote: left border on each line (always shown).
        let pos = from
        while (pos <= to && pos < state.doc.length) {
          const line = state.doc.lineAt(pos)
          decos.push(Decoration.line({ class: 'cm-blockquote' }).range(line.from))
          if (line.to >= to) break
          pos = line.to + 1
        }
      }

      // ── Fenced code block ──
      if (name === 'FencedCode') {
        const firstLine = state.doc.lineAt(from)
        const lastLine = state.doc.lineAt(to)
        const active = cursorInRange(state, from, to)

        // Database block: render the interactive widget — you edit through its
        // own cells/controls, so the raw JSON fence is never exposed (it used to
        // flash into view the moment the caret entered the block).
        if (isDatabaseFence(firstLine.text)) {
          const text = state.doc.sliceString(from, to)
          // Guard: if the JSON body is corrupt, the widget would render an empty
          // default and a stray edit could overwrite the real data. In that case
          // fall back to the old behavior — reveal the raw fence while editing so
          // it can be repaired by hand. Well-formed JSON is always-on + atomic.
          const body = text.replace(/^\s*`{3,}\s*database\s*\n?/, '').replace(/\n?`{3,}\s*$/, '')
          let parses = true
          try { JSON.parse(body) } catch { parses = false }
          if (parses || !active) {
            const r = Decoration.replace({ widget: new DatabaseWidget(text, from, to) }).range(from, to)
            decos.push(r)
            if (parses) atomicRanges.push(r)
            replaceBlockRanges.push({ from, to })
            return false // skip default code-fence styling + children
          }
        }

        // Mermaid block: render the diagram as an SVG widget when not editing.
        if (isMermaidFence(firstLine.text)) {
          if (!active) {
            const text = state.doc.sliceString(from, to)
            decos.push(
              Decoration.replace({ widget: new MermaidWidget(text), block: true }).range(from, to)
            )
            return false // skip default code-fence styling + children
          }
        }

        // Embed block: ```embed\n<url>\n``` → responsive iframe when not editing.
        if (isEmbedFence(firstLine.text)) {
          if (!active) {
            const text = state.doc.sliceString(from, to)
            const src = resolveEmbedSrc(extractFenceUrl(text))
            if (src) {
              decos.push(
                Decoration.replace({ widget: new EmbedWidget(src), block: true }).range(from, to)
              )
              return false // skip default code-fence styling + children
            }
          }
        }

        // Columns block: ```columns … --- … ``` → side-by-side preview.
        if (isColumnsFence(firstLine.text)) {
          if (!active) {
            const text = state.doc.sliceString(from, to)
            decos.push(
              Decoration.replace({ widget: new ColumnsWidget(text), block: true }).range(from, to)
            )
            return false // skip default code-fence styling + children
          }
        }

        // Add line classes to all lines
        let pos = from
        while (pos <= to && pos < state.doc.length) {
          const line = state.doc.lineAt(pos)
          let cls = 'cm-codeblock'
          if (line.number === firstLine.number) cls += ' cm-codeblock-first'
          else if (line.number === lastLine.number) cls += ' cm-codeblock-last'
          decos.push(Decoration.line({ class: cls }).range(line.from))
          if (line.to >= to) break
          pos = line.to + 1
        }

        // When not editing, hide fence markers
        if (!active) {
          const openMatch = firstLine.text.match(/^(`{3,})/)
          if (openMatch) {
            decos.push(Decoration.replace({}).range(firstLine.from, firstLine.from + openMatch[1].length))
          }
          const closeMatch = lastLine.text.match(/^`{3,}\s*$/)
          if (closeMatch) {
            decos.push(Decoration.replace({}).range(lastLine.from, lastLine.to))
          }
        }
      }

      // ── Horizontal rule ──
      if (name === 'HorizontalRule') {
        if (!cursorInRange(state, from, to)) {
          decos.push(Decoration.replace({ widget: new HRWidget() }).range(from, to))
        }
      }

      // ── Task checkbox ──
      if (name === 'TaskMarker') {
        const line = state.doc.lineAt(from)
        if (!cursorInRange(state, line.from, line.to)) {
          const text = state.doc.sliceString(from, to)
          const checked = text.includes('x') || text.includes('X')
          decos.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(from, to))
        }
      }

      // ── List markers (-, *, +, 1.) — always hide, use styled bullet ──
      if (name === 'ListMark') {
        const p = node.node.parent
        // Don't hide inside code blocks
        if (p && p.name !== 'FencedCode') {
          const text = state.doc.sliceString(from, to)
          const line = state.doc.lineAt(from)
          // Check if this is a task list item (has TaskMarker sibling)
          const lineText = line.text.trimStart()
          const isTask = lineText.match(/^[-*+]\s+\[[ xX]\]/)
          if (!isTask) {
            const isOrdered = /^\d+[.)]$/.test(text)
            if (isOrdered) {
              decos.push(Decoration.mark({ class: 'cm-list-number' }).range(from, to))
            } else {
              decos.push(Decoration.mark({ class: 'cm-subtle-mark' }).range(from, to))
            }
          }
        }
      }

      // ── Image: ![alt](src) → inline <img> widget ──
      if (name === 'Image') {
        if (!state.selection.ranges.some(r => r.from <= to && r.to >= from)) {
          const text = state.doc.sliceString(from, to)
          const m = text.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/)
          if (m) {
            const alt = m[1] || ''
            const src = m[2]
            decos.push(Decoration.replace({ widget: new ImageWidget(alt, src) }).range(from, to))
            replaceBlockRanges.push({ from, to })
            return false // skip LinkMark/URL children
          }
        }
      }

      // ── Page link: [Title](doc:docId) → clickable chip ──
      if (name === 'Link') {
        const text = state.doc.sliceString(from, to)
        const m = text.match(/^\[([^\]]*)\]\(doc:([^)\s]+)\)$/)
        if (m && !state.selection.ranges.some(r => r.from <= to && r.to >= from)) {
          const title = (m[1] || 'Untitled').trim() || 'Untitled'
          decos.push(
            Decoration.replace({ widget: new PageChipWidget({ kind: 'doc', value: m[2], title }) }).range(from, to)
          )
          replaceBlockRanges.push({ from, to })
          return false // skip LinkMark/URL children
        }
      }

      // ── Link: hide brackets and URL ──
      if (name === 'LinkMark') {
        const p = node.node.parent
        if (p && !cursorInsideNode(state, p.from, p.to)) {
          decos.push(Decoration.replace({}).range(from, to))
        }
      }

      if (name === 'URL') {
        const p = node.node.parent
        if (p && p.name === 'Link') {
          if (!cursorInsideNode(state, p.from, p.to)) {
            // Hide the URL and the parens around it: (url)
            const hideFrom = Math.max(from - 1, p.from) // include (
            const hideTo = Math.min(to + 1, p.to)       // include )
            decos.push(Decoration.replace({}).range(hideFrom, hideTo))
          }
        }
      }

      // ── Table: ALWAYS render the editable HTML widget ──
      // You type directly into the cells (Tab between them, +Row/+Column,
      // delete row/col), so the raw `| … |` pipes never take over the moment the
      // caret lands in the table. Atomic so caret nav / whole-block delete work.
      if (name === 'Table') {
        const text = state.doc.sliceString(from, to)
        const r = Decoration.replace({ widget: new TableWidget(text, from, to) }).range(from, to)
        decos.push(r)
        atomicRanges.push(r)
        replaceBlockRanges.push({ from, to })
        return false // skip children
      }

      // ── Toggle: <details><summary>…</summary> … </details> HTML block ──
      if (name === 'HTMLBlock') {
        const text = state.doc.sliceString(from, to)
        if (isDetailsBlock(text) && !cursorInRange(state, from, to)) {
          decos.push(
            Decoration.replace({ widget: new ToggleWidget(text), block: true }).range(from, to)
          )
          return false // skip children
        }
        // Raw <iframe …></iframe> block → sandboxed responsive embed.
        if (isIframeBlock(text) && !cursorInRange(state, from, to)) {
          const src = extractIframeSrc(text)
          if (src) {
            decos.push(
              Decoration.replace({ widget: new EmbedWidget(src), block: true }).range(from, to)
            )
            return false // skip children
          }
        }
      }
    }
  })

  const cursorTouches = (s, f, t) => s.selection.ranges.some(r => r.from <= t && r.to >= f)

  // ── Table of contents: a line that is exactly [[toc]] or [TOC] ──
  // Done before wiki-links so the `[[toc]]` text isn't also turned into a chip.
  const tocRanges = []
  {
    const sig = tocSignature(state)
    for (let i = 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i)
      if (TOC_RE.test(line.text)) {
        tocRanges.push({ from: line.from, to: line.to })
        if (!cursorInRange(state, line.from, line.to)) {
          decos.push(
            Decoration.replace({ widget: new TocWidget(sig), block: true }).range(line.from, line.to)
          )
        }
      }
    }
  }
  const inToc = (from, to) => tocRanges.some(r => from < r.to && to > r.from)

  const inCode = (from, to) => codeRanges.some(r => from < r.to && to > r.from)

  // ── Transclusion `![[Page]]` → read-only page embed (ranges collected before
  // the tree walk; here we push the widget when the cursor isn't touching it). ──
  for (const r of transcludeRanges) {
    if (inCode(r.from, r.to)) continue
    if (cursorInRange(state, r.from, r.to)) continue
    const line = state.doc.lineAt(r.from)
    const m = line.text.match(TRANSCLUDE_RE)
    if (!m) continue
    decos.push(
      Decoration.replace({ widget: new TranscludeWidget(m[1]), block: true })
        .range(r.from, r.to)
    )
  }

  // ── Embeds (bare provider URL on its own line) + Bookmarks (bare URL or
  // `bookmark: <url>`). Both are whole-line BLOCK replaces; embeds win when a
  // line is an embeddable provider URL, otherwise a bare/labelled URL becomes a
  // bookmark card. Lines inside fenced code or claimed by ToC/transclude/math
  // blocks are skipped to preserve the non-overlapping replace invariant. ──
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    if (!line.text.trim()) continue
    if (line.from < frontMatterEnd) continue // don't touch YAML front-matter
    if (inCode(line.from, line.to)) continue
    if (inToc(line.from, line.to) || inTransclude(line.from, line.to)) continue
    if (inBlockMath(line.from, line.to)) continue // don't clash with `$$ … $$`
    if (cursorInRange(state, line.from, line.to)) continue

    if (isEmbedUrlLine(line.text)) {
      const src = resolveEmbedSrc(line.text.trim())
      if (src) {
        decos.push(
          Decoration.replace({ widget: new EmbedWidget(src), block: true })
            .range(line.from, line.to)
        )
        continue
      }
    }

    const bmUrl = bookmarkUrlForLine(line.text)
    if (bmUrl) {
      decos.push(
        Decoration.replace({ widget: new BookmarkWidget(bmUrl), block: true })
          .range(line.from, line.to)
      )
    }
  }

  // ── Inline math `$...$` → KaTeX (after tree pass; needs full codeRanges) ──
  for (const d of collectInlineMathDecorations(state, codeRanges, cursorTouches).decos) {
    decos.push(d)
  }

  // ── Highlight `==text==` / `==color:text==` → overlap-safe mark spans ──
  for (const d of collectHighlightDecorations(state, codeRanges, cursorTouches)) {
    decos.push(d)
  }

  // ── Wiki-links [[Page]] → clickable chips (after tree pass) ──
  // Reveal raw markdown only when the cursor overlaps the link span itself.
  // Skip [[toc]] / ![[transclude]] spans already claimed by their widgets above.
  for (const d of collectWikiLinkDecorations(state, codeRanges, cursorTouches)) {
    if (inToc(d.from, d.to) || inTransclude(d.from, d.to)) continue
    decos.push(d)
  }

  // ── @date(…) tokens → 📅/🔔 chips (inline replace, overlap-suppressed) ──
  // These are replaces, so guard against every other replace-producing span:
  // wiki/math/transclude/toc + the tree-walk block replaces (table/callout/
  // image/link) + the YAML front-matter replace.
  const dateSuppressed = (from, to) =>
    inWiki(from, to) || inMath(from, to) || inBlockMath(from, to)
    || inTransclude(from, to) || inToc(from, to)
    || (frontMatterEnd > 0 && from < frontMatterEnd)
    || replaceBlockRanges.some(r => from < r.to && to > r.from)
  for (const d of collectDateDecorations(state, codeRanges, cursorTouches, dateSuppressed).decos) {
    decos.push(d)
  }

  // ── CriticMarkup suggested edits → overlap-safe marks + accept/reject ──
  // Mark-only (plus a zero-width controls widget), so safe against every replace.
  for (const d of collectCriticDecorations(state, codeRanges, cursorTouches).decos) {
    decos.push(d)
  }

  return {
    deco: Decoration.set(decos, true),
    atomic: RangeSet.of(atomicRanges, true),
  }
}

// ── StateField export ────────────────────────────────────────────────────────
// StateField (not ViewPlugin) allows block-level and cross-line decorations.
// The field value is { deco, atomic }: `deco` is the live-preview decoration set,
// `atomic` is the range set of always-on widgets (tables/databases) provided to
// EditorView.atomicRanges so the caret treats each as one indivisible block.

export const livePreview = StateField.define({
  create(state) {
    return buildDecorations(state)
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection) {
      return buildDecorations(tr.state)
    }
    return value
  },
  provide: f => [
    EditorView.decorations.from(f, v => v.deco),
    EditorView.atomicRanges.of(view => view.state.field(f).atomic),
  ],
})
