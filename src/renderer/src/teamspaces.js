/**
 * Teamspaces (local-first workspaces).
 *
 * A "teamspace" is a named, top-level grouping used to organise notes in the
 * sidebar — purely a local-first organisational layer, NOT cloud team
 * membership (which is handled separately by team.js). Each teamspace just holds
 * a list of file paths (or cloud docIds) that the user has assigned to it.
 *
 * Model (persisted under settings key `teamspaces`):
 *   [{ id, name, icon, collapsed, items: [{ type:'local'|'cloud', path?, docId?, name }] }]
 *
 * This module owns persistence + the in-memory model + rendering of the
 * teamspace groups into a host container in the sidebar. It is ADDITIVE: the
 * normal file tree continues to render unassigned notes as before. Assigning a
 * note to a teamspace does NOT move it on disk — it only adds a reference, so
 * nothing about the underlying filesystem changes.
 */

const SETTINGS_KEY = 'teamspaces'

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('teamspaces-styles')) return
  const style = document.createElement('style')
  style.id = 'teamspaces-styles'
  style.textContent = `
    #teamspaces-host { margin-bottom: 4px; }
    .ts-group { margin-bottom: 2px; }
    .ts-group-header {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 12px 4px 14px; cursor: pointer; user-select: none;
      font-size: 13px; color: #333; border-radius: 4px;
    }
    .ts-group-header:hover { background: #f0f0f0; }
    .ts-group-header .ts-caret {
      font-size: 10px; color: #999; transition: transform 0.15s; width: 10px;
    }
    .ts-group-header.expanded .ts-caret { transform: rotate(90deg); }
    .ts-group-icon { font-size: 13px; }
    .ts-group-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ts-group-actions { display: none; gap: 2px; }
    .ts-group-header:hover .ts-group-actions { display: flex; }
    .ts-group-actions .icon-btn { font-size: 11px; opacity: 0.6; padding: 2px; cursor: pointer; }
    .ts-group-actions .icon-btn:hover { opacity: 1; }
    .ts-group-children { display: none; padding-left: 0; }
    .ts-group-children.expanded { display: block; }
    .ts-empty { font-size: 11px; color: #bbb; font-style: italic; padding: 4px 12px 4px 28px; }
    .ts-doc-item .ts-remove {
      margin-left: auto; color: #ccc; font-size: 11px; cursor: pointer;
      opacity: 0; transition: opacity 0.15s; padding: 0 4px;
    }
    .ts-doc-item:hover .ts-remove { opacity: 1; }
  `
  document.head.appendChild(style)
}

function uid() {
  return `ts_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function itemKey(item) {
  if (!item) return null
  if (item.type === 'cloud' || item.docId) return `cloud:${item.docId}`
  return `local:${item.path}`
}

export class TeamspacesManager {
  constructor({ openFile, reloadProject } = {}) {
    this.openFile = openFile || ((p) => window.dispatchEvent(new CustomEvent('cmd:open-file', { detail: p })))
    this.reloadProject = reloadProject || (async () => {})
    this.spaces = []
    injectStyles()
  }

  async load() {
    try {
      const raw = await window.api.getSettings(SETTINGS_KEY)
      if (Array.isArray(raw)) this.spaces = raw
      else if (typeof raw === 'string' && raw) {
        try { this.spaces = JSON.parse(raw) } catch { this.spaces = [] }
      } else this.spaces = []
    } catch (e) {
      console.warn('[Teamspaces] load failed:', e)
      this.spaces = []
    }
    if (!Array.isArray(this.spaces)) this.spaces = []
    // Defensive normalisation.
    this.spaces = this.spaces
      .filter((s) => s && s.id)
      .map((s) => ({
        id: s.id,
        name: s.name || 'Untitled space',
        icon: s.icon || '<i class="fas fa-folder"></i>',
        collapsed: !!s.collapsed,
        items: Array.isArray(s.items) ? s.items.filter((it) => it && (it.path || it.docId)) : [],
      }))
    return this.spaces
  }

  async _persist() {
    try {
      await window.api.setSettings(SETTINGS_KEY, JSON.stringify(this.spaces))
    } catch (e) {
      console.warn('[Teamspaces] persist failed:', e)
    }
  }

  getList() { return this.spaces.slice() }

  async create(name, icon = '<i class="fas fa-folder"></i>') {
    const space = { id: uid(), name: name || 'New space', icon, collapsed: false, items: [] }
    this.spaces.push(space)
    await this._persist()
    return space
  }

  async rename(id, name) {
    const s = this.spaces.find((x) => x.id === id)
    if (!s) return false
    s.name = name || s.name
    await this._persist()
    return true
  }

  async setIcon(id, icon) {
    const s = this.spaces.find((x) => x.id === id)
    if (!s) return false
    s.icon = icon || s.icon
    await this._persist()
    return true
  }

  async remove(id) {
    const before = this.spaces.length
    this.spaces = this.spaces.filter((x) => x.id !== id)
    if (this.spaces.length !== before) { await this._persist(); return true }
    return false
  }

  async toggleCollapsed(id) {
    const s = this.spaces.find((x) => x.id === id)
    if (!s) return
    s.collapsed = !s.collapsed
    await this._persist()
  }

  /** Add an item ({type, path?, docId?, name}) to a teamspace. Idempotent. */
  async addItem(id, item) {
    const s = this.spaces.find((x) => x.id === id)
    if (!s || !item || (!item.path && !item.docId)) return false
    const key = itemKey(item)
    if (s.items.some((it) => itemKey(it) === key)) return false
    s.items.push({
      type: item.type || (item.docId ? 'cloud' : 'local'),
      path: item.path,
      docId: item.docId,
      name: item.name || 'Untitled',
    })
    await this._persist()
    return true
  }

  async removeItem(id, item) {
    const s = this.spaces.find((x) => x.id === id)
    if (!s) return false
    const key = itemKey(item)
    const before = s.items.length
    s.items = s.items.filter((it) => itemKey(it) !== key)
    if (s.items.length !== before) { await this._persist(); return true }
    return false
  }

  _openItem(item) {
    if (item.type === 'cloud' && item.docId) {
      window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: { id: item.docId, name: item.name } }))
    } else if (item.path) {
      this.openFile(item.path)
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  /**
   * Render all teamspace groups into `host`. Each group is a collapsible header
   * with its assigned notes nested underneath. Re-render is cheap (full redraw).
   */
  render(host) {
    if (!host) return
    injectStyles()
    host.innerHTML = ''
    if (!this.spaces.length) return

    this.spaces.forEach((space) => {
      const group = document.createElement('div')
      group.className = 'ts-group'

      const header = document.createElement('div')
      header.className = 'ts-group-header' + (space.collapsed ? '' : ' expanded')
      header.innerHTML = `
        <i class="fas fa-chevron-circle-right ts-caret"></i>
        <span class="ts-group-icon">${space.icon}</span>
        <span class="ts-group-name">${this._esc(space.name)}</span>
        <span class="ts-group-actions">
          <i class="fas fa-pen icon-btn ts-rename" title="Rename"></i>
          <i class="fas fa-trash icon-btn ts-delete" title="Delete teamspace"></i>
        </span>
      `

      const children = document.createElement('div')
      children.className = 'ts-group-children' + (space.collapsed ? '' : ' expanded')

      if (!space.items.length) {
        children.innerHTML = '<div class="ts-empty">No notes yet — right-click a note → "Add to teamspace".</div>'
      } else {
        space.items.forEach((item) => {
          const row = document.createElement('div')
          row.className = 'sidebar-doc-item ts-doc-item'
          if (item.type === 'cloud') row.dataset.docId = item.docId
          else if (item.path) row.dataset.path = item.path
          const name = (item.name || 'Untitled').replace(/\.(md|txt|markdown)$/i, '').replace(/_/g, ' ')
          row.innerHTML = `
            <div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;margin-left:0px;margin-right:0;">
              <i class="far fa-file-alt" style="font-size:12px;color:#999;"></i>
            </div>
            <span class="doc-name-label" style="font-size:13px;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${this._esc(name)}</span>
            <i class="fas fa-times ts-remove" title="Remove from teamspace"></i>
          `
          row.onclick = (e) => {
            if (e.target.classList && e.target.classList.contains('ts-remove')) return
            this._openItem(item)
          }
          const rm = row.querySelector('.ts-remove')
          if (rm) {
            rm.onclick = async (e) => {
              e.stopPropagation()
              await this.removeItem(space.id, item)
              this.render(host)
            }
          }
          children.appendChild(row)
        })
      }

      header.onclick = async (e) => {
        if (e.target.closest('.ts-group-actions')) return
        await this.toggleCollapsed(space.id)
        header.classList.toggle('expanded')
        children.classList.toggle('expanded')
      }

      const renameBtn = header.querySelector('.ts-rename')
      if (renameBtn) {
        renameBtn.onclick = async (e) => {
          e.stopPropagation()
          const next = prompt('Rename teamspace', space.name)
          if (next && next.trim()) { await this.rename(space.id, next.trim()); this.render(host) }
        }
      }
      const delBtn = header.querySelector('.ts-delete')
      if (delBtn) {
        delBtn.onclick = async (e) => {
          e.stopPropagation()
          if (!confirm(`Delete teamspace "${space.name}"? Your notes are not deleted — only this grouping.`)) return
          await this.remove(space.id)
          this.render(host)
        }
      }

      group.appendChild(header)
      group.appendChild(children)
      host.appendChild(group)
    })
  }

  /** Prompt to create a new teamspace, then re-render the host. */
  async promptCreate(host) {
    const name = prompt('New teamspace name')
    if (!name || !name.trim()) return null
    const space = await this.create(name.trim())
    if (host) this.render(host)
    return space
  }

  /**
   * Show a small picker letting the user assign `item` to one of the teamspaces
   * (or create a new one). Used from the sidebar "Add to teamspace" affordance.
   */
  async promptAssign(item, host) {
    if (!item || (!item.path && !item.docId)) { alert('Open or select a note first.'); return }
    await this.load()
    if (!this.spaces.length) {
      if (confirm('No teamspaces yet. Create one now?')) {
        const space = await this.promptCreate(host)
        if (space) await this.addItem(space.id, item)
        if (host) this.render(host)
      }
      return
    }
    const lines = this.spaces.map((s, i) => `${i + 1}. ${s.icon} ${s.name}`).join('\n')
    const choice = prompt(`Add to which teamspace?\n${lines}\n\n(Enter a number, or "new" to create one)`)
    if (!choice) return
    if (choice.trim().toLowerCase() === 'new') {
      const space = await this.promptCreate(host)
      if (space) await this.addItem(space.id, item)
    } else {
      const idx = parseInt(choice.trim(), 10) - 1
      const space = this.spaces[idx]
      if (space) await this.addItem(space.id, item)
      else { alert('Invalid choice.'); return }
    }
    if (host) this.render(host)
  }

  _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
