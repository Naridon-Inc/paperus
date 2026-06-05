/**
 * Soft-delete (Trash) manager.
 *
 * Instead of hard-deleting a file, `trashFile()` MOVES it into a `.trash/`
 * folder under the workspace root (using the existing `fs:rename` IPC, which
 * works on both Electron and the web localStorage mock) and records a trash
 * entry { id, originalPath, trashedPath, name, deletedAt } persisted via the
 * cross-platform settings bridge under `trashEntries`.
 *
 * `restore()` moves the file back to its original path (uniquifying if needed).
 * `deletePermanently()` is the ONLY path that actually destroys data — it calls
 * `fs:delete`. Nothing is ever hard-deleted unless the user explicitly chooses
 * "Delete permanently".
 *
 * Rendering of the Trash view (overlay) lives here so the feature is fully
 * self-contained; main.js / sidebar only need to dispatch `cmd:open-trash`.
 *
 * Web note: the cloud filesystem proxy is NOT wired here. On the web build the
 * `window.api.invoke('fs:rename' | 'fs:delete')` mock operates on the local
 * (localStorage) virtual FS, so trash works for LOCAL drafts on web exactly as
 * it does on Electron. Cloud documents (opened via `cmd:open-cloud-doc`) are not
 * file-backed and are out of scope for this soft-delete implementation.
 */

const SETTINGS_KEY = 'trashEntries'
const TRASH_DIRNAME = '.trash'

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('trash-styles')) return
  const style = document.createElement('style')
  style.id = 'trash-styles'
  style.textContent = `
    .trash-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.35);
      display: flex; align-items: center; justify-content: center; z-index: 4000;
    }
    .trash-modal {
      background: #fff; border-radius: 10px; width: 560px; max-width: 92vw;
      max-height: 80vh; display: flex; flex-direction: column;
      box-shadow: 0 12px 40px rgba(0,0,0,0.25); overflow: hidden;
    }
    .trash-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: 1px solid #eee;
    }
    .trash-modal-title { font-size: 16px; font-weight: 600; }
    .trash-modal-close { cursor: pointer; color: #999; font-size: 20px; line-height: 1; }
    .trash-list { overflow: auto; padding: 8px 0; }
    .trash-empty { padding: 40px 20px; text-align: center; color: #999; }
    .trash-item {
      display: flex; align-items: center; gap: 10px; padding: 10px 20px;
    }
    .trash-item:hover { background: #f7f7f7; }
    .trash-item-info { flex: 1; min-width: 0; }
    .trash-item-name {
      font-size: 13px; color: #333; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .trash-item-meta { font-size: 11px; color: #999; margin-top: 2px; }
    .trash-item-actions { display: flex; gap: 6px; flex-shrink: 0; }
    .trash-modal-footer {
      padding: 12px 20px; border-top: 1px solid #eee;
      display: flex; justify-content: flex-end; gap: 8px;
    }
  `
  document.head.appendChild(style)
}

function uid() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export class TrashManager {
  constructor({ getProjectRoot, reloadProject } = {}) {
    // getProjectRoot(): returns the absolute workspace root (sync or async).
    this.getProjectRoot = getProjectRoot || (() => null)
    // reloadProject(): refresh the file tree after trash/restore.
    this.reloadProject = reloadProject || (async () => {})
    this.entries = []
    this.overlay = null
    injectStyles()
  }

  async load() {
    try {
      const raw = await window.api.getSettings(SETTINGS_KEY)
      if (Array.isArray(raw)) this.entries = raw
      else if (typeof raw === 'string' && raw) {
        try { this.entries = JSON.parse(raw) } catch { this.entries = [] }
      } else this.entries = []
    } catch (e) {
      console.warn('[Trash] load failed:', e)
      this.entries = []
    }
    if (!Array.isArray(this.entries)) this.entries = []
    return this.entries
  }

  async _persist() {
    try {
      await window.api.setSettings(SETTINGS_KEY, JSON.stringify(this.entries))
    } catch (e) {
      console.warn('[Trash] persist failed:', e)
    }
  }

  async _resolveRoot(forPath) {
    let root = null
    try { root = await this.getProjectRoot() } catch { root = null }
    if (root) return root
    // Fallback: derive the root from the file's own location (parent dir).
    if (forPath && window.api && window.api.invoke) {
      try { return await window.api.invoke('path:dirname', forPath) } catch { /* ignore */ }
    }
    return null
  }

  /**
   * Soft-delete a file: move it into `<root>/.trash/<id>__<name>` and record an
   * entry. Returns the created entry, or null on failure.
   */
  async trashFile(originalPath) {
    if (!originalPath || !(window.api && window.api.invoke)) return null
    if (typeof originalPath === 'string' && originalPath.startsWith('cloud:')) {
      // Cloud docs are not file-backed; not handled by soft-delete.
      return null
    }
    await this.load()
    const root = await this._resolveRoot(originalPath)
    if (!root) return null

    let name = originalPath
    try { name = await window.api.basename(originalPath) } catch { /* ignore */ }

    const id = uid()
    const trashDir = `${root}/${TRASH_DIRNAME}`
    const trashedPath = `${trashDir}/${id}__${name}`

    try {
      // Ensure the trash directory exists (Electron). The web mock no-ops.
      try { await window.api.invoke('fs:ensureDir', trashDir) } catch { /* web/no-op */ }
      await window.api.invoke('fs:rename', originalPath, trashedPath)
    } catch (e) {
      console.error('[Trash] move to trash failed:', e)
      return null
    }

    const entry = { id, originalPath, trashedPath, name, deletedAt: Date.now() }
    this.entries.unshift(entry)
    await this._persist()
    return entry
  }

  async restore(id) {
    await this.load()
    const entry = this.entries.find((e) => e.id === id)
    if (!entry || !(window.api && window.api.invoke)) return false

    // Resolve a non-clobbering destination at the original path.
    let dest = entry.originalPath
    try {
      if (await window.api.pathExists(dest)) {
        const dir = await window.api.invoke('path:dirname', dest)
        const base = await window.api.basename(dest)
        const dot = base.lastIndexOf('.')
        const stem = dot > 0 ? base.slice(0, dot) : base
        const ext = dot > 0 ? base.slice(dot) : ''
        let n = 1
        do {
          dest = `${dir}/${stem}_restored${n > 1 ? n : ''}${ext}`
          n += 1
        } while (await window.api.pathExists(dest))
      }
    } catch { /* best-effort */ }

    try {
      await window.api.invoke('fs:rename', entry.trashedPath, dest)
    } catch (e) {
      console.error('[Trash] restore failed:', e)
      return false
    }

    this.entries = this.entries.filter((e) => e.id !== id)
    await this._persist()
    await this.reloadProject().catch(() => {})
    return true
  }

  async deletePermanently(id) {
    await this.load()
    const entry = this.entries.find((e) => e.id === id)
    if (!entry) return false
    if (window.api && window.api.invoke) {
      try { await window.api.invoke('fs:delete', entry.trashedPath) } catch (e) {
        console.warn('[Trash] permanent delete failed (removing entry anyway):', e)
      }
    }
    this.entries = this.entries.filter((e) => e.id !== id)
    await this._persist()
    return true
  }

  async emptyTrash() {
    await this.load()
    for (const entry of this.entries.slice()) {
      if (window.api && window.api.invoke) {
        try { await window.api.invoke('fs:delete', entry.trashedPath) } catch { /* ignore */ }
      }
    }
    this.entries = []
    await this._persist()
    return true
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  async open() {
    await this.load()
    this.close()
    const overlay = document.createElement('div')
    overlay.className = 'trash-overlay'
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close() })

    const modal = document.createElement('div')
    modal.className = 'trash-modal'
    modal.innerHTML = `
      <div class="trash-modal-header">
        <div class="trash-modal-title"><i class="fas fa-trash-alt"></i> Trash</div>
        <div class="trash-modal-close" title="Close">&times;</div>
      </div>
      <div class="trash-list" id="trash-list"></div>
      <div class="trash-modal-footer">
        <button class="btn btn-secondary" id="trash-empty-btn">Empty Trash</button>
      </div>
    `
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    this.overlay = overlay

    modal.querySelector('.trash-modal-close').onclick = () => this.close()
    modal.querySelector('#trash-empty-btn').onclick = async () => {
      if (!this.entries.length) return
      if (!confirm('Permanently delete ALL items in Trash? This cannot be undone.')) return
      await this.emptyTrash()
      this._renderList()
    }

    this._onKey = (e) => { if (e.key === 'Escape') this.close() }
    document.addEventListener('keydown', this._onKey)

    this._renderList()
  }

  _renderList() {
    if (!this.overlay) return
    const list = this.overlay.querySelector('#trash-list')
    if (!list) return
    list.innerHTML = ''
    if (!this.entries.length) {
      list.innerHTML = '<div class="trash-empty">Trash is empty.</div>'
      return
    }
    this.entries.forEach((entry) => {
      const row = document.createElement('div')
      row.className = 'trash-item'
      const display = (entry.name || 'Untitled').replace(/\.(md|txt|markdown)$/i, '').replace(/_/g, ' ')
      const when = entry.deletedAt ? new Date(entry.deletedAt).toLocaleString() : ''
      row.innerHTML = `
        <i class="far fa-file-alt" style="color:#999;"></i>
        <div class="trash-item-info">
          <div class="trash-item-name" title="${entry.originalPath || ''}">${display}</div>
          <div class="trash-item-meta">Deleted ${when}</div>
        </div>
        <div class="trash-item-actions">
          <button class="btn btn-secondary trash-restore">Restore</button>
          <button class="btn trash-delete" style="background:#d9534f;color:#fff;border-color:#d9534f;">Delete</button>
        </div>
      `
      row.querySelector('.trash-restore').onclick = async () => {
        const ok = await this.restore(entry.id)
        if (!ok) alert('Could not restore this item.')
        this._renderList()
      }
      row.querySelector('.trash-delete').onclick = async () => {
        if (!confirm(`Permanently delete "${display}"? This cannot be undone.`)) return
        await this.deletePermanently(entry.id)
        this._renderList()
      }
      list.appendChild(row)
    })
  }

  close() {
    if (this.overlay && this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay)
    this.overlay = null
    if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null }
  }
}
