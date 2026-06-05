/**
 * Floating selection toolbar for CodeMirror 6.
 * Appears above selected text with formatting options that insert markdown syntax.
 */
export class SelectionToolbar {
  constructor() {
    this.view = null
    this.toolbar = this._create()
    this.isVisible = false
    this._onCommentClick = null
  }

  setView(view) { this.view = view }
  onComment(fn) { this._onCommentClick = fn }

  _create() {
    const div = document.createElement('div')
    div.className = 'selection-toolbar'
    div.style.display = 'none'

    const buttons = [
      { label: 'B', title: 'Bold', wrap: '**' },
      { label: 'I', title: 'Italic', wrap: '*' },
      { label: 'S', title: 'Strikethrough', wrap: '~~' },
      { label: '<>', title: 'Code', wrap: '`' },
      { label: 'H1', title: 'Heading 1', line: '# ' },
      { label: 'H2', title: 'Heading 2', line: '## ' },
      { label: 'H3', title: 'Heading 3', line: '### ' },
      { label: '"', title: 'Quote', line: '> ' },
      { label: '—', title: 'Divider', insert: '\n---\n' },
      { sep: true },
      { icon: 'fa-link', title: 'Link', action: 'link' },
      { icon: 'fa-comment', title: 'Comment (⌘⇧M)', action: 'comment' },
    ]

    buttons.forEach(btn => {
      if (btn.sep) {
        const sep = document.createElement('div')
        sep.className = 'toolbar-sep'
        div.appendChild(sep)
        return
      }

      const button = document.createElement('button')
      button.className = 'toolbar-btn'
      if (btn.icon) button.innerHTML = `<i class="fas ${btn.icon}"></i>`
      else button.textContent = btn.label
      button.title = btn.title

      button.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!this.view) return

        const { from, to } = this.view.state.selection.main
        if (from === to) return

        if (btn.wrap) {
          this._wrapSelection(from, to, btn.wrap)
        } else if (btn.line) {
          this._prefixLine(from, to, btn.line)
        } else if (btn.insert) {
          this._insertAfter(to, btn.insert)
        } else if (btn.action === 'link') {
          this._wrapAsLink(from, to)
        } else if (btn.action === 'comment') {
          if (this._onCommentClick) this._onCommentClick()
        }
      })

      div.appendChild(button)
    })

    document.body.appendChild(div)
    return div
  }

  _wrapSelection(from, to, marker) {
    const text = this.view.state.doc.sliceString(from, to)
    // Toggle: if already wrapped, unwrap
    const alreadyWrapped =
      from >= marker.length &&
      this.view.state.doc.sliceString(from - marker.length, from) === marker &&
      this.view.state.doc.sliceString(to, to + marker.length) === marker

    if (alreadyWrapped) {
      this.view.dispatch({
        changes: [
          { from: from - marker.length, to: from },
          { from: to, to: to + marker.length },
        ],
        selection: { anchor: from - marker.length, head: to - marker.length }
      })
    } else {
      this.view.dispatch({
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        selection: { anchor: from + marker.length, head: to + marker.length }
      })
    }
  }

  _prefixLine(from, to, prefix) {
    const doc = this.view.state.doc
    const startLine = doc.lineAt(from)
    const endLine = doc.lineAt(to)
    const multi = startLine.number !== endLine.number
    // Toggle: if every (non-blank) selected line already starts with this
    // prefix, remove it; otherwise switch each line to this prefix.
    let allHave = true
    for (let n = startLine.number; n <= endLine.number; n++) {
      const t = doc.line(n).text
      if (multi && t.trim() === '') continue
      if (!t.startsWith(prefix)) { allHave = false; break }
    }
    const changes = []
    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = doc.line(n)
      if (multi && line.text.trim() === '') continue
      if (allHave) {
        changes.push({ from: line.from, to: line.from + prefix.length })
      } else {
        // Strip any existing heading / quote prefix first so levels switch
        // cleanly (e.g. "# x" → "## x", not "## # x").
        const headingMatch = line.text.match(/^(#{1,6}\s|>\s)/)
        const removeLen = headingMatch ? headingMatch[0].length : 0
        changes.push({ from: line.from, to: line.from + removeLen, insert: prefix })
      }
    }
    if (changes.length) this.view.dispatch({ changes })
  }

  _insertAfter(pos, text) {
    this.view.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + text.length }
    })
  }

  _wrapAsLink(from, to) {
    const text = this.view.state.doc.sliceString(from, to)
    const replacement = `[${text}](url)`
    this.view.dispatch({
      changes: { from, to, insert: replacement },
      // Select "url" so user can type the actual URL
      selection: { anchor: from + text.length + 3, head: from + text.length + 6 }
    })
  }

  // ── Show/hide based on selection ──

  update(view) {
    const sel = view.state.selection.main
    if (sel.from !== sel.to && !sel.empty) {
      this._show(view, sel.from, sel.to)
    } else {
      this._hide()
    }
  }

  _show(view, from, to) {
    this.isVisible = true
    this.toolbar.style.display = 'flex'

    const startCoords = view.coordsAtPos(from)
    const endCoords = view.coordsAtPos(to)
    if (!startCoords || !endCoords) { this._hide(); return }

    const toolbarW = this.toolbar.offsetWidth
    const toolbarH = this.toolbar.offsetHeight

    // Center above the selection start
    let top = startCoords.top - toolbarH - 8
    let left = startCoords.left + ((endCoords.right - startCoords.left) / 2) - (toolbarW / 2)

    // If above viewport, show below
    if (top < 50) {
      top = endCoords.bottom + 8
    }

    // Clamp horizontal
    left = Math.max(8, Math.min(left, window.innerWidth - toolbarW - 8))

    this.toolbar.style.top = `${top}px`
    this.toolbar.style.left = `${left}px`
  }

  _hide() {
    if (!this.isVisible) return
    this.isVisible = false
    this.toolbar.style.display = 'none'
  }

  destroy() {
    this._hide()
    if (this.toolbar.parentNode) this.toolbar.parentNode.removeChild(this.toolbar)
  }
}
