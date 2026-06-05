/**
 * `[[` page autocomplete (Obsidian-style). When the user types `[[`, a popup
 * lists existing pages; selecting one inserts `[[Title]]`. Filters as you type.
 *
 * Reuses the slash-menu styling (.slash-menu / .slash-item).
 */
import Store from './store'

export class WikiAutocomplete {
  constructor(view, { getRoot } = {}) {
    this.view = view
    this.getRoot = getRoot || (async () => Store.projectPath)
    this.isOpen = false
    this.triggerPos = 0
    this.selectedIndex = 0
    this.pages = []          // [{ title, path }]
    this.filtered = []
    this.menu = document.createElement('div')
    this.menu.className = 'slash-menu wiki-autocomplete'
    this.menu.style.display = 'none'
    document.body.appendChild(this.menu)
  }

  setView(view) { this.view = view }

  async _loadPages() {
    try {
      const root = await this.getRoot()
      if (!root) { this.pages = []; return }
      const files = await window.api.invoke('fs:listMarkdownFilesRecursive', root).catch(() => [])
      const pages = []
      for (const p of files) {
        const base = (await window.api.basename(p)).replace(/\.(md|note)$/i, '')
        pages.push({ title: base.replace(/_/g, ' '), path: p })
      }
      this.pages = pages
    } catch { this.pages = [] }
  }

  /** Called on doc changes — detect a fresh `[[` immediately before the cursor. */
  checkTrigger(state, pos) {
    if (this.isOpen) return
    if (pos >= 2 && state.doc.sliceString(pos - 2, pos) === '[[') {
      this.open(pos)
    }
  }

  async open(pos) {
    this.isOpen = true
    this.triggerPos = pos
    this.selectedIndex = 0
    await this._loadPages()
    if (!this.isOpen) return // closed while loading
    this.filter('')
    const coords = this.view.coordsAtPos(pos)
    if (coords) {
      this.menu.style.display = 'block'
      const h = this.menu.offsetHeight
      this.menu.style.top = (coords.bottom + h > window.innerHeight - 10)
        ? `${coords.top - h - 5}px` : `${coords.bottom + 5}px`
      this.menu.style.left = `${coords.left}px`
    }
  }

  updateFilter(state, pos) {
    if (!this.isOpen) return
    if (pos < this.triggerPos) { this.close(); return }
    // The `[[` must still be there.
    if (state.doc.sliceString(this.triggerPos - 2, this.triggerPos) !== '[[') { this.close(); return }
    const q = state.doc.sliceString(this.triggerPos, pos)
    if (/[\]\n]/.test(q)) { this.close(); return }
    this.filter(q)
  }

  filter(text) {
    const q = text.trim().toLowerCase()
    this.filtered = q
      ? this.pages.filter(p => p.title.toLowerCase().includes(q)).slice(0, 50)
      : this.pages.slice(0, 50)
    this.selectedIndex = 0
    this.render(q)
  }

  render(query) {
    this.menu.innerHTML = ''
    if (this.filtered.length === 0) {
      // Offer to create a new page with the typed name.
      if (query) {
        const div = document.createElement('div')
        div.className = 'slash-item selected'
        div.innerHTML = `<span class="icon"><i class="fas fa-plus"></i></span> Create “${query}”`
        div.addEventListener('mousedown', (e) => e.preventDefault())
        div.addEventListener('click', () => this.select())
        this.menu.appendChild(div)
        this.menu.style.display = 'block'
      } else {
        this.menu.style.display = 'none'
      }
      return
    }
    this.filtered.forEach((p, i) => {
      const div = document.createElement('div')
      div.className = `slash-item ${i === this.selectedIndex ? 'selected' : ''}`
      div.innerHTML = `<span class="icon"><i class="far fa-file-alt"></i></span> <span></span>`
      div.querySelector('span:last-child').textContent = p.title
      div.addEventListener('mousedown', (e) => e.preventDefault())
      div.addEventListener('click', () => { this.selectedIndex = i; this.select() })
      this.menu.appendChild(div)
    })
    this.menu.style.display = 'block'
  }

  move(offset) {
    const n = this.filtered.length || 1
    this.selectedIndex = (this.selectedIndex + offset + n) % n
    this.render()
  }

  handleKey(e) {
    if (!this.isOpen) return false
    if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); return true }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); return true }
    if (e.key === 'Enter') { e.preventDefault(); this.select(); return true }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true }
    return false
  }

  select() {
    const view = this.view
    const state = view.state
    const cursor = state.selection.main.head
    const query = state.doc.sliceString(this.triggerPos, cursor)
    const chosen = this.filtered[this.selectedIndex]
    const title = chosen ? chosen.title : query.trim()
    if (!title) { this.close(); return }

    // closeBrackets may have already inserted the trailing `]]`.
    const after = state.doc.sliceString(cursor, cursor + 2)
    const insert = after === ']]' ? title : `${title}]]`
    const to = after === ']]' ? cursor : cursor
    view.dispatch({
      changes: { from: this.triggerPos, to, insert },
      selection: { anchor: this.triggerPos + insert.length + (after === ']]' ? 2 : 0) },
    })
    this.close()
    view.focus()
  }

  close() {
    this.isOpen = false
    this.menu.style.display = 'none'
  }

  destroy() {
    this.close()
    if (this.menu.parentNode) this.menu.parentNode.removeChild(this.menu)
  }
}
