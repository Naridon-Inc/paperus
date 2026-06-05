/**
 * "Linked references" panel — shows every page that links to the current page,
 * via `(doc:docId)` markdown links or `[[Wiki Title]]` references. Rendered at
 * the bottom of the editor, collapsible, refreshed when a document opens.
 */
import Store from './store'
import { titleVariants } from './page-links'

export class BacklinksPanel {
  constructor(container, { openFile } = {}) {
    this.openFile = openFile || (() => {})
    this.collapsed = false
    this.el = document.createElement('div')
    this.el.className = 'backlinks-panel'
    this.el.style.display = 'none'
    container.appendChild(this.el)
    this._token = 0
  }

  clear() {
    this.el.style.display = 'none'
    this.el.innerHTML = ''
  }

  /**
   * @param {string} path absolute path of the current file
   * @param {string} docId stable doc id of the current file (optional)
   */
  async update(path, docId) {
    const token = ++this._token
    this.clear()
    if (!path || (typeof path === 'string' && path.startsWith('cloud:'))) return

    const root = Store.projectPath || (await window.api.getSettings('knownProjects').catch(() => null) || [])[0]
    if (!root) return

    const fileName = await window.api.basename(path).catch(() => '')
    const titles = titleVariants(fileName)

    let results = []
    try {
      results = await window.api.invoke('fs:findBacklinks', root, { docId, titles, excludePath: path }) || []
    } catch {
      results = []
    }
    // A newer open superseded this scan.
    if (token !== this._token) return
    if (!results.length) return

    this._render(results)
  }

  _render(results) {
    this.el.innerHTML = ''
    this.el.style.display = 'block'

    const header = document.createElement('div')
    header.className = 'backlinks-header'
    header.innerHTML = `<i class="fas fa-link"></i> <span>Linked references</span> <span class="backlinks-count">${results.length}</span>`
    const chevron = document.createElement('i')
    chevron.className = 'fas fa-chevron-circle-down backlinks-chevron'
    header.appendChild(chevron)

    const list = document.createElement('div')
    list.className = 'backlinks-list'

    header.addEventListener('click', () => {
      this.collapsed = !this.collapsed
      list.style.display = this.collapsed ? 'none' : 'block'
      chevron.className = this.collapsed
        ? 'fas fa-chevron-circle-right backlinks-chevron'
        : 'fas fa-chevron-circle-down backlinks-chevron'
    })

    results.forEach((r) => {
      const item = document.createElement('div')
      item.className = 'backlink-item'
      const title = (r.name || '').replace(/\.(md|note)$/i, '').replace(/_/g, ' ')
      const titleEl = document.createElement('div')
      titleEl.className = 'backlink-title'
      titleEl.innerHTML = '<span class="page-icon"><i class="far fa-file-alt"></i></span>'
      titleEl.appendChild(document.createTextNode(' ' + title))
      const snippet = document.createElement('div')
      snippet.className = 'backlink-snippet'
      snippet.textContent = r.snippet || ''
      item.appendChild(titleEl)
      if (r.snippet) item.appendChild(snippet)
      item.addEventListener('click', () => this.openFile(r.path))
      list.appendChild(item)
    })

    this.el.appendChild(header)
    this.el.appendChild(list)
  }
}
