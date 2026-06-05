/**
 * Recently-opened documents tracker.
 *
 * Maintains a most-recent-first, de-duplicated list of the last ~10 opened
 * documents (local files and cloud docs). Persisted via the cross-platform
 * settings bridge so it survives reloads on both Electron and web.
 *
 * Entries mirror the Favorites shape:
 *   { id, type: 'local'|'cloud', path?, docId?, name, ts }
 *
 * Note: this is a separate key from the legacy `recentFiles` setting (which is
 * a flat array of local paths used elsewhere in main.js). We use `recentDocs`
 * to avoid clobbering that and to support cloud docs.
 *
 * Sidebar rendering of the "🕘 Recent" section lives in `sidebar-manager.js`;
 * this module owns persistence + the in-memory list only.
 */

const SETTINGS_KEY = 'recentDocs'
const MAX = 10

function makeId(item) {
  if (!item) return null
  if (item.type === 'cloud' || item.docId) return `cloud:${item.docId}`
  return `local:${item.path}`
}

export class Recents {
  constructor() {
    /** @type {Array<{id:string,type:string,path?:string,docId?:string,name:string,ts:number}>} */
    this.list = []
    this._loaded = false
  }

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
      console.warn('[Recents] load failed:', e)
      this.list = []
    }
    if (!Array.isArray(this.list)) this.list = []
    this.list = this.list
      .filter((it) => it && (it.path || it.docId))
      .map((it) => ({ ...it, id: it.id || makeId(it) }))
      .slice(0, MAX)
    this._loaded = true
    return this.list
  }

  async _persist() {
    try {
      await window.api.setSettings(SETTINGS_KEY, JSON.stringify(this.list))
    } catch (e) {
      console.warn('[Recents] persist failed:', e)
    }
  }

  getList() {
    return this.list.slice()
  }

  /**
   * Record that a document was opened. De-dupes by id and moves it to the
   * front (most recent). `item` = { type, path?, docId?, name }.
   */
  async push(item) {
    if (!item || (!item.path && !item.docId)) return
    const id = makeId(item)
    const entry = {
      id,
      type: item.type || (item.docId ? 'cloud' : 'local'),
      path: item.path,
      docId: item.docId,
      name: item.name || 'Untitled',
      ts: Date.now(),
    }
    this.list = this.list.filter((it) => it.id !== id)
    this.list.unshift(entry)
    if (this.list.length > MAX) this.list = this.list.slice(0, MAX)
    await this._persist()
  }

  async clear() {
    this.list = []
    await this._persist()
  }

  /**
   * Update a local recent entry's path (and optionally name) after a file
   * rename, preserving its position. No-op for non-local / missing entries.
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

Recents.makeId = makeId
