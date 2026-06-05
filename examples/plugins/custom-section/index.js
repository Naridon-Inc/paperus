import { definePlugin } from '@notionless/plugin-sdk'

/**
 * Bookmarks — exercises `ctx.ui.sidebarSection` (sections cap), `ctx.ui.view`
 * (views cap), and `ctx.ui.navItem` (ui cap). It adds a "Bookmarks" sidebar
 * section listing saved notes, a nav item that opens a full Bookmarks view, and
 * a toolbar/notify round-trip.
 *
 * Capabilities: ["ui", "sections", "views"]
 *
 * State is kept in memory for this example (no `storage` capability declared).
 * A real plugin would declare `storage` and persist via `ctx.storage`.
 */

export default definePlugin({
  async activate(ctx) {
    this._disposables = []
    // In-memory bookmark list: [{ title, docId }]
    this._bookmarks = []
    // Last-opened note, tracked via the capability-free `note:open` event so we
    // never need the `editor` capability (this plugin declares only ui/sections/views).
    this._current = null

    const offOpen = ctx.events.on('note:open', (p) => {
      if (p && p.docId) this._current = { docId: p.docId, title: p.title || deriveTitleFromPath(p.path) }
    })
    this._disposables.push(offOpen)

    // Re-render hooks the section/view can call after state changes.
    const repaint = () => {
      try { this._section && this._section.update && this._section.update(sectionVDOM(this)) } catch { /* ignore */ }
      try { this._view && this._view.update && this._view.update(viewVDOM(this)) } catch { /* ignore */ }
    }
    this._repaint = repaint

    // Add a bookmark for whatever note was last opened.
    this._addCurrent = async () => {
      const active = this._current
      const docId = active && active.docId ? active.docId : null
      const title = (active && active.title) ? active.title : 'Untitled'
      if (!docId) {
        ctx.ui.notify({ message: 'No note open to bookmark', kind: 'warn' })
        return
      }
      if (this._bookmarks.some((b) => b.docId === docId)) {
        ctx.ui.notify({ message: 'Already bookmarked', kind: 'info' })
        return
      }
      this._bookmarks.push({ docId, title })
      ctx.ui.notify({ message: `Bookmarked "${title}"`, kind: 'success', timeout: 1500 })
      repaint()
    }

    this._remove = (docId) => {
      this._bookmarks = this._bookmarks.filter((b) => b.docId !== docId)
      repaint()
    }

    // Shared dispatcher for vDOM `on:` actions (§5.7) delivered via onEvent.
    const onAction = (e) => {
      const action = e && e.action ? e.action : ''
      if (action === 'add-current') { this._addCurrent(); return }
      if (action.startsWith('remove:')) { this._remove(action.slice('remove:'.length)) }
    }
    this._onAction = onAction

    // ── Sidebar section (requires `sections`) ─────────────────────────────
    // The vDOM `on:` actions (e.g. add-current) are delivered to onEvent.
    const section = ctx.ui.sidebarSection({
      id: 'bookmarks',
      title: 'Bookmarks',
      order: 3,
      render: () => sectionVDOM(this),
      onEvent: onAction,
    })
    this._section = section
    this._disposables.push(section)

    // ── Full view (requires `views`) ─────────────────────────────────────
    const view = ctx.ui.view({
      id: 'bookmarks',
      title: 'Bookmarks',
      icon: '<i class="far fa-bookmark"></i>',
      render: () => viewVDOM(this),
      onEvent: onAction,
    })
    this._view = view
    this._disposables.push(view)

    // ── Nav item (requires `ui`) — opens the view ─────────────────────────
    const nav = ctx.ui.navItem({
      id: 'bookmarks-nav',
      label: 'Bookmarks',
      icon: '<i class="far fa-bookmark"></i>',
      target: 'bookmarks', // a view id
    })
    this._disposables.push(nav)

    repaint()
  },

  async deactivate() {
    for (const d of this._disposables || []) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this._disposables = []
    this._bookmarks = []
  },
})

/** Derive a display title from a note path (fallback when the host omits title). */
function deriveTitleFromPath(p) {
  if (!p || typeof p !== 'string') return 'Untitled'
  const base = p.split(/[\\/]/).pop() || p
  return base.replace(/\.md$/i, '') || 'Untitled'
}

/** Sidebar section body vDOM. Note `on` actions are delivered to the host. */
function sectionVDOM(plugin) {
  const items = (plugin._bookmarks || []).map((b) => ({
    tag: 'li',
    attrs: { class: 'bookmark-item', 'data-doc': b.docId, title: b.title },
    children: [b.title],
  }))
  if (!items.length) {
    items.push({ tag: 'li', attrs: { class: 'bookmark-empty' }, children: ['No bookmarks yet'] })
  }
  return {
    tag: 'div',
    attrs: { class: 'bookmarks-section' },
    children: [
      {
        tag: 'button',
        attrs: { class: 'bookmark-add', type: 'button' },
        on: { click: 'add-current' },
        children: ['+ Bookmark current note'],
      },
      { tag: 'ul', attrs: { class: 'bookmark-list' }, children: items },
    ],
  }
}

/** Full view vDOM. */
function viewVDOM(plugin) {
  const rows = (plugin._bookmarks || []).map((b) => ({
    tag: 'tr',
    attrs: { class: 'bookmark-row' },
    children: [
      { tag: 'td', children: [b.title] },
      { tag: 'td', attrs: { class: 'bookmark-id' }, children: [String(b.docId).slice(0, 8)] },
      {
        tag: 'td',
        children: [{
          tag: 'button',
          attrs: { class: 'bookmark-remove', type: 'button', 'data-doc': b.docId },
          on: { click: `remove:${b.docId}` },
          children: ['Remove'],
        }],
      },
    ],
  }))

  return {
    tag: 'div',
    attrs: { class: 'bookmarks-view' },
    children: [
      { tag: 'h1', children: ['Bookmarks'] },
      { tag: 'p', children: [`${(plugin._bookmarks || []).length} saved`] },
      {
        tag: 'table',
        attrs: { class: 'bookmarks-table' },
        children: [
          {
            tag: 'thead',
            children: [{
              tag: 'tr',
              children: [
                { tag: 'th', children: ['Title'] },
                { tag: 'th', children: ['Id'] },
                { tag: 'th', children: [''] },
              ],
            }],
          },
          { tag: 'tbody', children: rows.length ? rows : [{ tag: 'tr', children: [{ tag: 'td', attrs: { colspan: '3' }, children: ['No bookmarks yet'] }] }] },
        ],
      },
    ],
  }
}
