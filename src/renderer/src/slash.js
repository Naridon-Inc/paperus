import { defaultDatabaseMarkdown } from './database-widget'

/**
 * Slash command menu for CodeMirror 6.
 * Type "/" to open, filter by typing, navigate with arrows, select with Enter.
 */
export class SlashMenu {
  constructor(view, options = {}) {
    this.view = view
    this.options = options
    this.isOpen = false
    this.triggerPos = 0
    this.selectedIndex = 0
    this.menu = this.createMenu()
    this.items = [
      { label: 'Text', action: 'text', block: true, md: '', icon: '<i class="fas fa-paragraph"></i>' },
      { label: 'Heading 1', md: '# ', block: true, icon: '<span style="font-weight:700;font-family:serif;">H1</span>' },
      { label: 'Heading 2', md: '## ', block: true, icon: '<span style="font-weight:700;font-family:serif;">H2</span>' },
      { label: 'Heading 3', md: '### ', block: true, icon: '<span style="font-weight:700;font-family:serif;">H3</span>' },
      { label: 'Bulleted list', md: '- ', block: true, icon: '<i class="fas fa-list-ul"></i>' },
      { label: 'Numbered list', md: '1. ', block: true, icon: '<i class="fas fa-list-ol"></i>' },
      { label: 'To-do list', md: '- [ ] ', block: true, icon: '<i class="far fa-check-square"></i>' },
      { label: 'Code block', md: '```\n', mdAfter: '\n```', icon: '<i class="fas fa-code"></i>' },
      { label: 'Quote', md: '> ', block: true, icon: '<i class="fas fa-quote-right"></i>' },
      { label: 'Callout', md: '> [!note] ', icon: '<i class="far fa-lightbulb"></i>' },
      { label: 'Math block', md: '$$\n', mdAfter: '\n$$', icon: '<i class="fas fa-square-root-alt"></i>' },
      { label: 'Mermaid diagram', md: '```mermaid\ngraph TD;\n  A-->B;\n', mdAfter: '\n```', icon: '<i class="fas fa-project-diagram"></i>' },
      { label: 'Embed', md: '```embed\n', mdAfter: '\n```', icon: '<i class="fas fa-photo-video"></i>' },
      { label: 'Bookmark', md: 'bookmark: ', icon: '<i class="far fa-bookmark"></i>' },
      { label: 'Columns', md: '```columns\n', mdAfter: '\n---\n\n```', icon: '<i class="fas fa-columns"></i>' },
      { label: 'Highlight', md: '==', mdAfter: '==', icon: '<i class="fas fa-highlighter"></i>' },
      { label: 'Suggest insertion', md: '{++', mdAfter: '++}', icon: '<i class="fas fa-plus-circle"></i>' },
      { label: 'Suggest deletion', md: '{--', mdAfter: '--}', icon: '<i class="fas fa-minus-circle"></i>' },
      { label: 'Suggest replacement', md: '{~~', mdAfter: '~>~~}', icon: '<i class="fas fa-exchange-alt"></i>' },
      { label: 'Suggestion comment', md: '{>>', mdAfter: '<<}', icon: '<i class="far fa-comment-dots"></i>' },
      { label: 'Divider', md: '---\n', icon: '<i class="fas fa-minus"></i>' },
      { label: 'Table', md: '| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| | | |\n', icon: '<i class="fas fa-table"></i>' },
      { label: 'Table of contents', md: '[[toc]]\n', icon: '<i class="fas fa-list-alt"></i>' },
      { label: 'Database', action: 'database', icon: '<i class="fas fa-database"></i>' },
      { label: 'Board', action: 'database-board', icon: '<i class="fas fa-columns"></i>' },
      { label: 'Toggle', md: '<details><summary>Toggle</summary>\n\n', mdAfter: '\n\n</details>', icon: '<i class="fas fa-chevron-circle-right"></i>' },
      { label: 'Collapsible', md: '<details>\n<summary>Click to expand</summary>\n\n', mdAfter: '\n\n</details>\n', icon: '<i class="fas fa-chevron-circle-right"></i>' },
      { label: 'Image', action: 'image', icon: '<i class="far fa-image"></i>' },
      { label: 'Page', action: 'new-page', icon: '<i class="far fa-file-alt"></i>' },
      { label: 'Template', action: 'template', icon: '<i class="far fa-clone"></i>' },
    ]
    this.filteredItems = this.items

    document.body.appendChild(this.menu)
  }

  /** Call this when the EditorView changes (e.g. after rebindEditor) */
  setView(view) {
    this.view = view
  }

  createMenu() {
    const div = document.createElement('div')
    div.className = 'slash-menu'
    div.style.display = 'none'
    return div
  }

  /** Called from CM6 keydown handler or update listener */
  checkTrigger(state, pos) {
    if (pos > 0 && state.doc.sliceString(pos - 1, pos) === '/') {
      // Only trigger at start of line or after whitespace
      if (pos === 1 || /\s/.test(state.doc.sliceString(pos - 2, pos - 1))) {
        this.open(pos)
      }
    }
  }

  /** Called on each doc change while menu is open, to update filter */
  updateFilter(state, pos) {
    if (!this.isOpen) return
    if (pos < this.triggerPos) {
      this.close()
      return
    }
    const filterText = state.doc.sliceString(this.triggerPos, pos)
    // If user deleted the slash
    if (this.triggerPos > 0 && state.doc.sliceString(this.triggerPos - 1, this.triggerPos) !== '/') {
      this.close()
      return
    }
    this.filterItems(filterText)
  }

  open(pos) {
    this.isOpen = true
    this.triggerPos = pos // position right after the "/"
    this.selectedIndex = 0
    this.filterItems('')

    // Position the menu near the cursor
    const coords = this.view.coordsAtPos(pos)
    if (coords) {
      this.menu.style.display = 'block'

      const menuHeight = this.menu.offsetHeight
      const windowHeight = window.innerHeight

      if (coords.bottom + menuHeight > windowHeight - 10) {
        this.menu.style.top = `${coords.top - menuHeight - 5}px`
      } else {
        this.menu.style.top = `${coords.bottom + 5}px`
      }
      this.menu.style.left = `${coords.left}px`
    }
  }

  close() {
    this.isOpen = false
    this.menu.style.display = 'none'
  }

  filterItems(text) {
    if (!text) {
      this.filteredItems = this.items
    } else {
      const lower = text.toLowerCase()
      this.filteredItems = this.items.filter(item => item.label.toLowerCase().includes(lower))
    }
    this.selectedIndex = 0
    this.renderItems()

    if (this.filteredItems.length === 0) {
      this.menu.style.display = 'none'
    } else {
      this.menu.style.display = 'block'
    }
  }

  renderItems() {
    this.menu.innerHTML = ''
    this.filteredItems.forEach((item, index) => {
      const div = document.createElement('div')
      div.className = `slash-item ${index === this.selectedIndex ? 'selected' : ''}`
      div.innerHTML = `<span class="icon">${item.icon}</span> ${item.label}`

      div.addEventListener('mousedown', (e) => {
        e.preventDefault()
      })
      div.addEventListener('click', () => {
        this.selectedIndex = index
        this.selectItem()
      })
      this.menu.appendChild(div)
    })
  }

  moveSelection(offset) {
    if (this.filteredItems.length === 0) return
    this.selectedIndex = (this.selectedIndex + offset + this.filteredItems.length) % this.filteredItems.length
    this.renderItems()
  }

  /** Handle keydown — returns true if the event was consumed */
  handleKey(e) {
    if (!this.isOpen) return false

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.moveSelection(-1)
      return true
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      this.moveSelection(1)
      return true
    } else if (e.key === 'Enter') {
      e.preventDefault()
      this.selectItem()
      return true
    } else if (e.key === 'Escape') {
      e.preventDefault()
      this.close()
      return true
    }
    return false
  }

  selectItem() {
    if (this.filteredItems.length === 0) return
    const item = this.filteredItems[this.selectedIndex]
    const view = this.view
    const state = view.state
    const docLen = state.doc.length
    const cursor = state.selection.main.head
    const filterLength = cursor - this.triggerPos

    // Delete the "/" and filter text — clamp to document bounds
    const deleteFrom = Math.max(0, this.triggerPos - 1)
    const deleteTo = Math.min(docLen, this.triggerPos + filterLength)

    // Bail out if positions are invalid (stale after Yjs sync)
    if (deleteFrom >= deleteTo || deleteFrom > docLen) {
      this.close()
      return
    }

    // Block-type items (Text, Headings, lists, to-do, quote) CONVERT the current
    // line in place: strip any existing block prefix and apply the new one,
    // preserving the line's text. On an empty line this just inserts the prefix.
    // This is what makes "switch Heading 1 → Heading 2" work via the slash menu.
    if (item.block) {
      const line = state.doc.lineAt(deleteFrom)
      const a = deleteFrom - line.from
      const b = deleteTo - line.from
      // The line text with the "/filter" slash-command span removed.
      const lineText = line.text.slice(0, a) + line.text.slice(b)
      const m = lineText.match(/^(\s*)(#{1,6} |> \[![^\]]*\]\s*|> |[-*+] \[[ xX]\] |[-*+] |\d+\. )?([\s\S]*)$/)
      const indent = m ? m[1] : ''
      const rest = (m ? m[3] : lineText).replace(/\s+$/, '')
      const newLine = indent + item.md + rest
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: newLine },
        selection: { anchor: line.from + newLine.length }
      })
      this.close()
      return
    }

    if (item.action === 'text') {
      // Just remove the slash, leave plain text
      view.dispatch({ changes: { from: deleteFrom, to: deleteTo } })
    } else if (item.action === 'database' || item.action === 'database-board') {
      // Insert a Notion-style database block (fenced `database` JSON).
      let md = defaultDatabaseMarkdown()
      if (item.action === 'database-board') {
        try {
          const data = JSON.parse(md.replace(/^```database\n/, '').replace(/\n```$/, ''))
          data.views = [{ id: 'v1', type: 'board', name: 'Board', groupBy: 'c2' }]
          data.activeView = 'v1'
          md = '```database\n' + JSON.stringify(data, null, 2) + '\n```'
        } catch { /* fall back to default table view */ }
      }
      // Database blocks need their own line; surround with blank lines so the
      // markdown parser treats the fence as a standalone block.
      const line = state.doc.lineAt(deleteFrom)
      const before = state.doc.sliceString(line.from, deleteFrom).trim()
      const insert = (before.length > 0 ? '\n\n' : '') + md + '\n'
      view.dispatch({
        changes: { from: deleteFrom, to: deleteTo, insert },
        selection: { anchor: deleteFrom + insert.length }
      })
    } else if (item.action === 'new-page') {
      view.dispatch({ changes: { from: deleteFrom, to: deleteTo } })
      if (this.options.onCreatePage) {
        this.options.onCreatePage()
      }
    } else if (item.action === 'template') {
      view.dispatch({ changes: { from: deleteFrom, to: deleteTo } })
      if (this.options.onTemplate) {
        this.options.onTemplate()
      }
    } else if (item.action === 'image') {
      view.dispatch({ changes: { from: deleteFrom, to: deleteTo } })
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = (e) => {
        const file = e.target.files[0]
        if (file) {
          let src = file.path ? `file://${file.path}` : URL.createObjectURL(file)
          const imgMd = `![${file.name}](${src})`
          const pos = view.state.selection.main.head
          view.dispatch({
            changes: { from: pos, insert: imgMd },
            selection: { anchor: pos + imgMd.length }
          })
        }
      }
      input.click()
    } else if (item.md) {
      // Insert markdown prefix (and optional suffix)
      // Check if we're at the start of the line — if so, just replace; if not, add newline first
      const line = state.doc.lineAt(deleteFrom)
      const lineStart = line.from
      const textBefore = state.doc.sliceString(lineStart, deleteFrom).trim()

      let insert = item.md
      if (item.mdAfter) {
        insert = item.md + item.mdAfter
      }

      // If there's content before the slash on this line, add a newline prefix
      if (textBefore.length > 0) {
        insert = '\n' + insert
      }

      const cursorOffset = item.md.length + (textBefore.length > 0 ? 1 : 0)

      view.dispatch({
        changes: { from: deleteFrom, to: deleteTo, insert },
        selection: { anchor: deleteFrom + cursorOffset }
      })
    }

    this.close()
  }

  destroy() {
    this.close()
    if (this.menu.parentNode) {
      this.menu.parentNode.removeChild(this.menu)
    }
  }
}
