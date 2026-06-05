/**
 * Notion-style page header: an emoji icon and a cover image shown above the
 * editor. Both are stored in the document's YAML front-matter (`icon`, `cover`)
 * so they travel with the .md file (git sync) and work on web.
 *
 * The header writes a minimal edit to the top of the Yjs text; the front-matter
 * block itself is hidden in the editor by the live-preview decorations.
 */
import { parseFrontmatter, applyFrontmatter } from './frontmatter'

const EMOJI_CHOICES = [
  '📄', '📝', '📌', '✅', '⭐', '🔥', '💡', '📚', '📁', '🗂️',
  '📅', '🎯', '🚀', '🧠', '💼', '🏠', '❤️', '🎨', '🔧', '🐛',
  '📊', '💰', '🌱', '☕', '🎵', '🔬', '🗺️', '✏️', '📎', '🏷️',
  '🤝', '🧪', '⚙️', '📦', '🌍', '🎉', '⚡', '🔒', '👋', '💬',
]

export class PageHeader {
  constructor(container, { getEngine } = {}) {
    this.getEngine = getEngine || (() => null)
    this.el = document.createElement('div')
    this.el.className = 'page-header'
    this.el.style.display = 'none'
    // Insert at the very top of the editor container.
    container.insertBefore(this.el, container.firstChild)
    this._picker = null
  }

  clear() {
    this.el.style.display = 'none'
    this.el.innerHTML = ''
    this._titleEl = null
    // Restore the compact top-bar title input we hid while the big title showed.
    const hub = document.getElementById('doc-title')
    if (hub) hub.style.display = ''
    this._closePicker()
  }

  /**
   * Keep the big page title in sync after a *programmatic* change to the
   * top-bar `#doc-title` hub (e.g. the deferred Yjs title sync on open, or a
   * rename from elsewhere). Setting `.value` doesn't fire input events, so the
   * open/rename paths call this explicitly.
   */
  syncTitle() {
    if (!this._titleEl) return
    const hub = document.getElementById('doc-title')
    const v = hub ? hub.value : ''
    if (this._titleEl.value !== v) {
      this._titleEl.value = v
      this._autoGrowTitle()
    }
  }

  _autoGrowTitle() {
    const t = this._titleEl
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${t.scrollHeight}px`
  }

  /** Render the header from the current document's front-matter. */
  render() {
    const engine = this.getEngine()
    if (!engine || !engine.text) { this.clear(); return }
    const { data } = parseFrontmatter(engine.text.toString())
    this._data = data
    this.el.innerHTML = ''
    this.el.style.display = 'block'

    // ── Cover ──
    if (data.cover) {
      const cover = document.createElement('div')
      cover.className = 'page-cover'
      this._applyCoverImage(cover, data.cover)
      const actions = document.createElement('div')
      actions.className = 'page-cover-actions'
      const change = document.createElement('button')
      change.textContent = 'Change cover'
      change.onclick = () => this._pickCover()
      const remove = document.createElement('button')
      remove.textContent = 'Remove'
      remove.onclick = () => this._set({ cover: '' })
      actions.appendChild(change); actions.appendChild(remove)
      cover.appendChild(actions)
      this.el.appendChild(cover)
    }

    // ── Icon + add-buttons row ──
    const bar = document.createElement('div')
    bar.className = 'page-header-bar' + (data.cover ? ' has-cover' : '')

    if (data.icon) {
      const icon = document.createElement('button')
      icon.className = 'page-icon-display'
      icon.textContent = data.icon
      icon.title = 'Change icon'
      icon.onclick = (e) => { e.stopPropagation(); this._openEmojiPicker(icon) }
      bar.appendChild(icon)
    }

    const controls = document.createElement('div')
    controls.className = 'page-header-controls'
    if (!data.icon) {
      const addIcon = document.createElement('button')
      addIcon.className = 'page-header-add'
      addIcon.innerHTML = '<i class="far fa-smile"></i> Add icon'
      addIcon.onclick = (e) => { e.stopPropagation(); this._openEmojiPicker(addIcon) }
      controls.appendChild(addIcon)
    }
    if (!data.cover) {
      const addCover = document.createElement('button')
      addCover.className = 'page-header-add'
      addCover.innerHTML = '<i class="far fa-image"></i> Add cover'
      addCover.onclick = () => this._pickCover()
      controls.appendChild(addCover)
    }
    bar.appendChild(controls)
    this.el.appendChild(bar)

    // ── Big page title (mirrors #doc-title / the filename) ──
    // The filename is the title. We render a large editable title here and keep
    // the small top-bar `#doc-title` input as the data hub: typing mirrors into
    // it live, and committing (blur / Enter) dispatches its `change` event so
    // the existing rename flow (local file rename or team-note rename) runs
    // unchanged. The redundant top-bar input is hidden while this is shown.
    const hub = document.getElementById('doc-title')
    const title = document.createElement('textarea')
    title.className = 'page-title'
    title.rows = 1
    title.spellcheck = false
    title.placeholder = 'Untitled'
    title.value = hub ? hub.value : ''
    title.addEventListener('input', () => {
      if (hub) {
        hub.value = title.value.replace(/\n/g, ' ')
        hub.dispatchEvent(new Event('input', { bubbles: true }))
      }
      this._autoGrowTitle()
    })
    const commit = () => { if (hub) hub.dispatchEvent(new Event('change', { bubbles: true })) }
    title.addEventListener('blur', commit)
    title.addEventListener('keydown', (e) => {
      // Title is single-line: Enter commits and drops focus into the body.
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
        const cm = document.querySelector('#editor .cm-content')
        if (cm) cm.focus()
      }
    })
    this.el.appendChild(title)
    this._titleEl = title
    if (hub) hub.style.display = 'none'
    requestAnimationFrame(() => this._autoGrowTitle())
  }

  /**
   * Set the cover element's background. Remote URLs (http/https/data) are used
   * directly; local files are read via IPC into a data: URL so they display
   * even when the page is served over http (webSecurity blocks file://).
   */
  async _applyCoverImage(el, cover) {
    const isRemote = /^(https?:|data:)/i.test(cover)
    if (isRemote) {
      el.style.backgroundImage = `url("${cover.replace(/"/g, '%22')}")`
      return
    }
    if (window.api && window.api.invoke) {
      const dataUrl = await window.api.invoke('fs:readFileDataUrl', cover).catch(() => null)
      if (dataUrl) { el.style.backgroundImage = `url("${dataUrl}")`; return }
    }
    // Last resort: try the raw value (works in packaged file:// builds).
    el.style.backgroundImage = `url("${cover.replace(/"/g, '%22')}")`
  }

  // ── Persistence ──
  _set(updates) {
    const engine = this.getEngine()
    if (!engine || !engine.text) return
    const current = engine.text.toString()
    const { fm, oldEnd } = applyFrontmatter(current, updates)
    engine.doc.transact(() => {
      engine.text.delete(0, oldEnd)
      if (fm) engine.text.insert(0, fm)
    }, 'page-frontmatter')
    this.render()
  }

  // ── Emoji picker ──
  _openEmojiPicker(anchor) {
    this._closePicker()
    const pop = document.createElement('div')
    pop.className = 'emoji-picker'
    const grid = document.createElement('div')
    grid.className = 'emoji-grid'
    EMOJI_CHOICES.forEach((e) => {
      const b = document.createElement('button')
      b.textContent = e
      b.onclick = () => { this._set({ icon: e }); this._closePicker() }
      grid.appendChild(b)
    })
    pop.appendChild(grid)

    const row = document.createElement('div')
    row.className = 'emoji-picker-custom'
    const input = document.createElement('input')
    input.placeholder = 'Type any emoji…'
    input.maxLength = 8
    input.onkeydown = (ev) => {
      if (ev.key === 'Enter' && input.value.trim()) { this._set({ icon: input.value.trim() }); this._closePicker() }
    }
    const rm = document.createElement('button')
    rm.textContent = 'Remove'
    rm.onclick = () => { this._set({ icon: '' }); this._closePicker() }
    row.appendChild(input); row.appendChild(rm)
    pop.appendChild(row)

    document.body.appendChild(pop)
    const r = anchor.getBoundingClientRect()
    pop.style.top = `${r.bottom + 6}px`
    pop.style.left = `${r.left}px`
    this._picker = pop
    setTimeout(() => {
      this._outside = (ev) => { if (this._picker && !this._picker.contains(ev.target)) this._closePicker() }
      document.addEventListener('mousedown', this._outside)
    }, 0)
  }

  _closePicker() {
    if (this._picker && this._picker.parentNode) this._picker.parentNode.removeChild(this._picker)
    this._picker = null
    if (this._outside) { document.removeEventListener('mousedown', this._outside); this._outside = null }
  }

  // ── Cover picker ──
  async _pickCover() {
    // Electron: native image picker → file:// path. Web/fallback: URL prompt.
    if (window.api && window.api.invoke && window.api.onMessage) {
      try {
        const result = await window.api.invoke('dialog:showOpenDialog', {
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }],
        })
        if (result && !result.canceled && result.filePaths && result.filePaths[0]) {
          this._set({ cover: `file://${result.filePaths[0]}` })
          return
        }
        return
      } catch { /* fall through to prompt */ }
    }
    const url = window.prompt('Cover image URL')
    if (url && url.trim()) this._set({ cover: url.trim() })
  }
}
