// inbox-store.js — the Inbox engine (singleton).
//
// A single notification surface that merges four kinds of "things waiting for
// you" into one newest-first feed:
//
//   • share    — a note another peer sealed into your P2P inbox (contacts.js).
//   • invite    — a pending team invite stashed in settings (v1 has no live feed).
//   • mention  — you were @-mentioned somewhere, from the latest task scan.
//   • assigned — an open task assigned to one of your handles, from the scan.
//
// The store owns no UI. It exposes a small async API + emits a single coarse
// `inbox:items-updated` event (carrying the live unread count) whenever the feed
// could have changed, so the React surface and the sidebar badge can refresh off
// one signal. Providers (`getMyHandles`, `getScan`) are injected by the
// orchestrator in main.js — the store never reaches into vanilla app modules for
// identity or scan data.
//
// Persistence:
//   • seen-store → settings key `paperus_inbox_seen` = { [itemId]: true }
//   • invites    → settings key `paperus_pending_invites` = [{id,rootKey,teamName,at}]
//   • shares are owned by contacts.js (getReceivedOffers / removeReceivedOffer).
//
// Read semantics: mentions + assigned are auto-marked seen the moment they're
// surfaced (they're ambient, they shouldn't nag forever). Shares + invites stay
// unread until you Accept or Dismiss them.
//
// Every public method is defensive: it catches and returns a safe default rather
// than throwing, so a flaky provider or storage read can never break the surface.

import { getReceivedOffers, removeReceivedOffer } from './contacts'

const SEEN_KEY = 'paperus_inbox_seen'            // { [itemId]: true }
const INVITES_KEY = 'paperus_pending_invites'    // [{ id, rootKey, teamName, at }]

// ── tiny utils ───────────────────────────────────────────────────────────────
function _now() { return Date.now() }

function _emit(name, detail) {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent(name, { detail }))
    }
  } catch (_e) { /* ignore */ }
}

// Settings I/O. window.api.getSettings/setSettings are async; values may come
// back as already-parsed objects (Electron store) or JSON strings — handle both.
async function _getSetting(key) {
  try {
    if (typeof window !== 'undefined' && window.api && window.api.getSettings) {
      const v = await window.api.getSettings(key)
      if (v && typeof v === 'object') return v
      if (typeof v === 'string' && v) { try { return JSON.parse(v) } catch { return null } }
      return null
    }
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(key)
      return v ? JSON.parse(v) : null
    }
  } catch (_e) { /* ignore */ }
  return null
}

async function _setSetting(key, value) {
  try {
    if (typeof window !== 'undefined' && window.api && window.api.setSettings) {
      await window.api.setSettings(key, JSON.stringify(value))
      return
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value))
  } catch (_e) { /* ignore */ }
}

// Normalize a provider's "my handles" into a lowercased Set for case-insensitive
// membership tests against mention/assignee names.
function _handleSet(raw) {
  const out = new Set()
  try {
    const arr = raw instanceof Set ? Array.from(raw) : (Array.isArray(raw) ? raw : [])
    for (const h of arr) {
      if (h == null) continue
      const s = String(h).trim().toLowerCase()
      if (s) out.add(s)
    }
  } catch (_e) { /* ignore */ }
  return out
}

function _noteTitleOf(obj, fallback) {
  if (!obj) return fallback
  return obj.noteTitle || obj.title || obj.note || obj.source || fallback
}

// ── the singleton ────────────────────────────────────────────────────────────
class InboxStore {
  constructor() {
    this._getMyHandles = () => []
    this._getScan = () => null
    this._seen = null              // cached seen-store map (lazy-loaded)
    this._snapshot = []            // last computed InboxItem[] (newest-first)
    this._wired = false            // listeners attached only once
    this._recomputing = false
  }

  /**
   * Provider injection by the orchestrator (main.js).
   * @param {object}   opts
   * @param {()=>Set<string>|string[]} [opts.getMyHandles] current user's usernames across teams.
   * @param {()=>({tasks,mentions}|null)} [opts.getScan]   latest task-scan result.
   */
  init({ getMyHandles, getScan } = {}) {
    try {
      if (typeof getMyHandles === 'function') this._getMyHandles = getMyHandles
      if (typeof getScan === 'function') this._getScan = getScan
      this._wire()
    } catch (_e) { /* ignore */ }
    return this
  }

  // Subscribe to upstream change signals exactly once. On either, recompute the
  // snapshot and broadcast the coarse `inbox:items-updated` with the new count.
  _wire() {
    if (this._wired || typeof window === 'undefined' || !window.addEventListener) return
    this._wired = true
    const onChange = () => { this._recomputeAndEmit() }
    window.addEventListener('inbox:received-updated', onChange)
    window.addEventListener('scan:updated', onChange)
  }

  async _recomputeAndEmit() {
    if (this._recomputing) return
    this._recomputing = true
    try {
      await this.getItems()       // refreshes this._snapshot + auto-marks ambient items
    } catch (_e) { /* ignore */ } finally {
      this._recomputing = false
    }
    _emit('inbox:items-updated', { unread: this.unreadCount() })
  }

  // ── seen-store ───────────────────────────────────────────────────────────
  async _loadSeen() {
    if (this._seen) return this._seen
    const raw = await _getSetting(SEEN_KEY)
    this._seen = (raw && typeof raw === 'object') ? raw : {}
    return this._seen
  }

  isSeen(id) {
    try { return !!(this._seen && this._seen[id]) } catch (_e) { return false }
  }

  async markSeen(id) {
    try {
      if (!id) return
      const seen = await this._loadSeen()
      if (!seen[id]) { seen[id] = true; await _setSetting(SEEN_KEY, seen) }
    } catch (_e) { /* ignore */ }
  }

  async markSeenMany(ids) {
    try {
      const list = Array.isArray(ids) ? ids : []
      if (!list.length) return
      const seen = await this._loadSeen()
      let changed = false
      for (const id of list) {
        if (id && !seen[id]) { seen[id] = true; changed = true }
      }
      if (changed) await _setSetting(SEEN_KEY, seen)
    } catch (_e) { /* ignore */ }
  }

  // ── feed assembly ─────────────────────────────────────────────────────────
  /**
   * @returns {Promise<InboxItem[]>} merged feed, newest-first. Never throws.
   */
  async getItems() {
    try {
      await this._loadSeen()
      const items = []

      // 1) shares — sealed note-offers received from contacts.
      let offers = []
      try { offers = await getReceivedOffers() } catch (_e) { offers = [] }
      for (const offer of (offers || [])) {
        if (!offer || offer.id == null) continue
        const id = `share:${offer.id}`
        items.push({
          id,
          kind: 'share',
          title: offer.name || offer.title || 'Shared note',
          subtitle: offer.fromName
            ? `${offer.fromName} shared a note with you`
            : 'Someone shared a note with you',
          at: offer.at || offer.receivedAt || _now(),
          seen: this.isSeen(id),
          payload: { offer },
        })
      }

      // 2) invites — pending team invites stashed in settings (usually empty).
      let invites = []
      try { invites = await _getSetting(INVITES_KEY) } catch (_e) { invites = [] }
      for (const inv of (Array.isArray(invites) ? invites : [])) {
        if (!inv || inv.id == null) continue
        const id = `invite:${inv.id}`
        items.push({
          id,
          kind: 'invite',
          title: inv.teamName ? `Join “${inv.teamName}”` : 'Team invite',
          subtitle: 'You were invited to a team',
          at: inv.at || _now(),
          seen: this.isSeen(id),
          payload: { rootKey: inv.rootKey, teamName: inv.teamName },
        })
      }

      // 3 + 4) mention / assigned — derived from the latest scan, scoped to me.
      let scan = null
      try { scan = this._getScan ? this._getScan() : null } catch (_e) { scan = null }
      const myHandles = _handleSet(this._getMyHandles ? this._getMyHandles() : [])
      const ambientIds = []     // mentions + assigned → auto-mark seen on surface

      if (scan && myHandles.size) {
        // mentions
        for (const m of (Array.isArray(scan.mentions) ? scan.mentions : [])) {
          if (!m) continue
          const handles = Array.isArray(m.handles)
            ? m.handles
            : (m.handle != null ? [m.handle] : (m.username != null ? [m.username] : []))
          const hit = handles.some((h) => myHandles.has(String(h).trim().toLowerCase()))
          if (!hit) continue
          const source = m.source || m.path || m.note || ''
          const line = (m.line != null) ? m.line : 0
          const id = `mention:${source}:${line}`
          const noteTitle = _noteTitleOf(m, 'a note')
          items.push({
            id,
            kind: 'mention',
            title: `Mentioned in ${noteTitle}`,
            subtitle: m.text || m.snippet || m.context || '',
            at: m.at || m.modified || m.mtime || _now(),
            seen: this.isSeen(id),
            payload: { source, line, noteTitle },
          })
          ambientIds.push(id)
        }

        // assigned — open tasks assigned to one of my handles.
        for (const task of (Array.isArray(scan.tasks) ? scan.tasks : [])) {
          if (!task || task.done) continue
          const assignees = Array.isArray(task.assignees) ? task.assignees : []
          const mine = assignees.some((a) => myHandles.has(String(a).trim().toLowerCase()))
          if (!mine) continue
          const tid = (task.id != null) ? task.id : `${task.source || ''}:${task.line != null ? task.line : ''}`
          const id = `assigned:${tid}`
          const noteTitle = _noteTitleOf(task, 'a note')
          items.push({
            id,
            kind: 'assigned',
            title: task.text || 'Assigned task',
            subtitle: `Assigned in ${noteTitle}`,
            at: task.at || task.modified || task.mtime || _now(),
            seen: this.isSeen(id),
            payload: { task },
          })
          ambientIds.push(id)
        }
      }

      // Newest-first.
      items.sort((a, b) => (b.at || 0) - (a.at || 0))

      // Ambient items (mention/assigned) are marked seen as soon as they surface
      // so they don't nag. Reflect that in this returned snapshot too.
      const unseenAmbient = ambientIds.filter((id) => !this.isSeen(id))
      if (unseenAmbient.length) {
        await this.markSeenMany(unseenAmbient)
        const set = new Set(unseenAmbient)
        for (const it of items) { if (set.has(it.id)) it.seen = true }
      }

      this._snapshot = items
      return items
    } catch (_e) {
      return Array.isArray(this._snapshot) ? this._snapshot : []
    }
  }

  // ── actions ────────────────────────────────────────────────────────────────
  /**
   * Accept an item. share → join the shared room; invite → join the team.
   * Marks the item seen and clears the underlying offer for shares.
   */
  async accept(item) {
    try {
      if (!item) return
      if (item.kind === 'share') {
        const offer = item.payload && item.payload.offer
        if (offer) {
          _emit('cmd:join-shared-room', { token: offer.token, name: offer.name })
          await this.markSeen(item.id)
          try { await removeReceivedOffer(offer.id) } catch (_e) { /* ignore */ }
        }
      } else if (item.kind === 'invite') {
        const rootKey = item.payload && item.payload.rootKey
        _emit('cmd:join-team', { rootKey })
        await this.markSeen(item.id)
      } else {
        // mention/assigned have no "accept" — just acknowledge.
        await this.markSeen(item.id)
      }
    } catch (_e) { /* ignore */ } finally {
      _emit('inbox:items-updated', { unread: this.unreadCount() })
    }
  }

  /**
   * Dismiss an item. share → drop the stored offer; others → just mark seen.
   */
  async dismiss(item) {
    try {
      if (!item) return
      if (item.kind === 'share') {
        const offer = item.payload && item.payload.offer
        if (offer) { try { await removeReceivedOffer(offer.id) } catch (_e) { /* ignore */ } }
      }
      await this.markSeen(item.id)
    } catch (_e) { /* ignore */ } finally {
      _emit('inbox:items-updated', { unread: this.unreadCount() })
    }
  }

  /** Mark every item currently in the feed as read. */
  async markAllRead() {
    try {
      const items = await this.getItems()
      await this.markSeenMany(items.map((it) => it.id))
      // reflect immediately in the cached snapshot
      for (const it of this._snapshot) it.seen = true
    } catch (_e) { /* ignore */ } finally {
      _emit('inbox:items-updated', { unread: this.unreadCount() })
    }
  }

  /** Unread count over the last computed snapshot (cheap, synchronous). */
  unreadCount() {
    try {
      return (this._snapshot || []).reduce((n, it) => n + (it && it.seen === false ? 1 : 0), 0)
    } catch (_e) { return 0 }
  }
}

export const inboxStore = new InboxStore()
