/**
 * Favorites / pinned items manager.
 *
 * Stores a flat list of favorited documents — both local files (by absolute
 * path) and cloud documents (by docId). Persisted via the cross-platform
 * settings bridge (`window.api.setSettings` / `getSettings`), which works on
 * both Electron (electron-settings) and the web build (localStorage mock).
 *
 * Each entry looks like:
 *   { id, type: 'local'|'cloud', path?, docId?, name }
 *
 * `id` is a stable key derived from the path/docId so toggles are idempotent.
 *
 * Rendering of the "⭐ Favorites" sidebar section is intentionally NOT done
 * here — `sidebar-manager.js` owns the sidebar DOM and calls into this manager
 * for the data. This module only owns persistence + the in-memory list, plus a
 * tiny one-time CSS injection for the star toggle affordance.
 */

const SETTINGS_KEY = 'favorites'

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('favorites-styles')) return
  const style = document.createElement('style')
  style.id = 'favorites-styles'
  style.textContent = `
    .fav-star-toggle {
      background: none;
      border: none;
      cursor: pointer;
      color: #f0ad4e;
      font-size: 12px;
      padding: 0 4px;
      line-height: 1;
      opacity: 0.85;
    }
    .fav-star-toggle:hover { opacity: 1; }
    .fav-star-toggle.is-empty { color: #bbb; }
    #favorites-list .sidebar-doc-item { cursor: pointer; }
    #favorites-list .sidebar-doc-item .fav-remove {
      margin-left: auto;
      color: #ccc;
      font-size: 11px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
      padding: 0 4px;
    }
    #favorites-list .sidebar-doc-item:hover .fav-remove { opacity: 1; }
    #favorites-list .fav-empty-msg {
      padding: 4px 16px;
      font-size: 12px;
      color: #bbb;
      font-style: italic;
    }
  `
  document.head.appendChild(style)
}

function makeId(item) {
  if (!item) return null
  if (item.type === 'cloud') return `cloud:${item.docId}`
  return `local:${item.path}`
}

export class Favorites {
  constructor() {
    /** @type {Array<{id:string,type:string,path?:string,docId?:string,name:string}>} */
    this.list = []
    this._loaded = false
    injectStyles()
  }

  /** Load persisted favorites. Tolerant of both JSON-string and array shapes. */
  async load() {
    try {
      const raw = await window.api.getSettings(SETTINGS_KEY)
      if (Array.isArray(raw)) {
        this.list = raw
      } else if (typeof raw === 'string' && raw) {
        try { this.list = JSON.parse(raw) } catch { this.list = [] }
      } else {
        this.list = []
      }
    } catch (e) {
      console.warn('[Favorites] load failed:', e)
      this.list = []
    }
    if (!Array.isArray(this.list)) this.list = []
    // Defensive: drop malformed entries, ensure ids.
    this.list = this.list
      .filter((it) => it && (it.path || it.docId))
      .map((it) => ({ ...it, id: it.id || makeId(it) }))
    this._loaded = true
    return this.list
  }

  async _persist() {
    try {
      await window.api.setSettings(SETTINGS_KEY, JSON.stringify(this.list))
    } catch (e) {
      console.warn('[Favorites] persist failed:', e)
    }
  }

  /** Return a shallow copy of the current favorites list. */
  getList() {
    return this.list.slice()
  }

  isFavorite(idOrItem) {
    const id = typeof idOrItem === 'string' ? idOrItem : makeId(idOrItem)
    if (!id) return false
    return this.list.some((it) => it.id === id)
  }

  /**
   * Add an item. `item` = { type, path?, docId?, name }.
   * Idempotent — re-adding an existing favorite is a no-op (refreshes name).
   */
  async add(item) {
    if (!item || (!item.path && !item.docId)) return false
    const entry = {
      id: makeId(item),
      type: item.type || (item.docId ? 'cloud' : 'local'),
      path: item.path,
      docId: item.docId,
      name: item.name || 'Untitled',
    }
    const existing = this.list.find((it) => it.id === entry.id)
    if (existing) {
      // Refresh name if it changed (rename), but keep position.
      if (item.name && existing.name !== item.name) {
        existing.name = item.name
        await this._persist()
      }
      return false
    }
    this.list.push(entry)
    await this._persist()
    return true
  }

  async remove(idOrItem) {
    const id = typeof idOrItem === 'string' ? idOrItem : makeId(idOrItem)
    if (!id) return false
    const before = this.list.length
    this.list = this.list.filter((it) => it.id !== id)
    if (this.list.length !== before) {
      await this._persist()
      return true
    }
    return false
  }

  /**
   * Toggle favorite state for `item`. Returns the new state (true = favorited).
   */
  async toggle(item) {
    if (!item || (!item.path && !item.docId)) return false
    if (this.isFavorite(item)) {
      await this.remove(item)
      return false
    }
    await this.add(item)
    return true
  }

  /**
   * Update a local favorite's path (and optionally name) after a file rename,
   * preserving its position in the list. No-op for non-local / missing entries.
   */
  async renamePath(oldPath, newPath, newName) {
    const entry = this.list.find((it) => it.type === 'local' && it.path === oldPath)
    if (!entry) return false
    entry.path = newPath
    entry.id = makeId(entry)
    if (newName) entry.name = newName
    await this._persist()
    return true
  }

  /** Dispatch the existing open event for a favorite entry. */
  open(entry) {
    if (!entry) return
    if (entry.type === 'cloud' && entry.docId) {
      window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', {
        detail: { id: entry.docId, name: entry.name },
      }))
    } else if (entry.path) {
      window.dispatchEvent(new CustomEvent('cmd:open-file', { detail: entry.path }))
    }
  }
}

// Static helper so other modules can compute the canonical id without an instance.
Favorites.makeId = makeId
