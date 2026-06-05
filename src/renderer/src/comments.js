/**
 * Inline commenting system with popovers for CodeMirror 6 + Yjs.
 * Comments appear as floating cards next to the highlighted text.
 */
import * as Y from 'yjs'
import { StateField, StateEffect } from '@codemirror/state'
import { EditorView, Decoration } from '@codemirror/view'
import { authClient } from './auth-client'

const setComments = StateEffect.define()

const commentHighlightField = StateField.define({
  create() { return Decoration.none },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setComments)) return e.value
    }
    if (tr.docChanged) return value.map(tr.changes)
    return value
  },
  provide: f => EditorView.decorations.from(f)
})

export class CommentManager {
  constructor(docEngine) {
    this.docEngine = null
    this.comments = null
    this.view = null
    this.popover = null
    this.activeCommentId = null
    // Panel state
    this.panel = null
    this.panelToggle = null
    this.panelOpen = false
    this.showResolved = false

    this._injectStyles()
    this._buildPopover()
    this._buildPanel()
    this.attachEvents()
    if (docEngine) this.setDocEngine(docEngine)
  }

  static get extension() {
    return commentHighlightField
  }

  setDocEngine(docEngine) {
    if (this.comments && this._observer) {
      this.comments.unobserve(this._observer)
    }
    this.docEngine = docEngine
    if (!docEngine) { this.comments = null; return }

    this.comments = docEngine.doc.getMap('comments')
    this._observer = () => {
      this.updateHighlights()
      // Re-render popover if it's open
      if (this.activeCommentId) this._renderPopoverContent(this.activeCommentId)
      // Keep the "All comments" panel in sync
      this._renderPanel()
    }
    this.comments.observe(this._observer)
    this._renderPanel()
  }

  setView(view) { this.view = view; this._renderPanel() }

  // ── Popover DOM ──

  _buildPopover() {
    if (document.getElementById('comment-popover')) {
      this.popover = document.getElementById('comment-popover')
      return
    }
    this.popover = document.createElement('div')
    this.popover.id = 'comment-popover'
    this.popover.className = 'comment-popover'
    this.popover.style.display = 'none'
    document.body.appendChild(this.popover)

    // Close on outside click
    document.addEventListener('mousedown', (e) => {
      if (this.popover.style.display === 'none') return
      if (this.popover.contains(e.target)) return
      // Don't close if clicking on highlighted text (will reopen)
      if (e.target.closest('.cm-comment-highlight')) return
      this.closePopover()
    })
  }

  _positionPopover(coords) {
    this.popover.style.display = 'block'

    const popRect = this.popover.getBoundingClientRect()
    const winW = window.innerWidth
    const winH = window.innerHeight

    // Default: to the right of the text
    let left = coords.right + 12
    let top = coords.top - 8

    // If not enough space on right, put on left
    if (left + 320 > winW) {
      left = coords.left - 320 - 12
    }
    // If still off screen, align to right edge
    if (left < 8) left = 8

    // Vertical bounds
    if (top + popRect.height > winH - 20) {
      top = winH - popRect.height - 20
    }
    if (top < 50) top = 50

    this.popover.style.left = `${left}px`
    this.popover.style.top = `${top}px`
  }

  closePopover() {
    this.popover.style.display = 'none'
    this.activeCommentId = null
  }

  // ── Show popover for existing comment ──

  showComment(commentId) {
    if (!this.comments) return
    const comment = this.comments.get(commentId)
    if (!comment) return

    this.activeCommentId = commentId

    // Position near the highlighted text
    const range = this.resolveRange(comment)
    if (range && this.view) {
      const coords = this.view.coordsAtPos(range.from)
      const endCoords = this.view.coordsAtPos(range.to)
      if (coords && endCoords) {
        this._renderPopoverContent(commentId)
        this._positionPopover({
          left: coords.left,
          right: Math.max(coords.right, endCoords.right),
          top: coords.top,
          bottom: endCoords.bottom
        })
      }
    }
  }

  // ── Show popover for new comment ──

  showNewComment(from, to) {
    if (!this.comments || !this.view) return

    this.activeCommentId = null
    const quotedText = this.view.state.doc.sliceString(from, to)

    this.popover.innerHTML = `
      <div class="cp-new">
        <div class="cp-quoted">"${this._esc(quotedText.substring(0, 120))}${quotedText.length > 120 ? '...' : ''}"</div>
        <textarea class="cp-input" placeholder="Add a comment..." autofocus></textarea>
        <div class="cp-footer">
          <button class="cp-btn cp-cancel">Cancel</button>
          <button class="cp-btn cp-submit">Comment</button>
        </div>
      </div>
    `

    const coords = this.view.coordsAtPos(from)
    const endCoords = this.view.coordsAtPos(to)
    if (coords && endCoords) {
      this._positionPopover({
        left: coords.left,
        right: Math.max(coords.right, endCoords.right),
        top: coords.top,
        bottom: endCoords.bottom
      })
    }

    const textarea = this.popover.querySelector('.cp-input')
    setTimeout(() => textarea.focus(), 50)

    // Enter to submit (Shift+Enter for newline)
    textarea.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        submit()
      }
      if (e.key === 'Escape') this.closePopover()
    }

    const submit = () => {
      const content = textarea.value.trim()
      if (!content) return
      this.addComment(from, to, content)
    }

    this.popover.querySelector('.cp-cancel').onclick = () => this.closePopover()
    this.popover.querySelector('.cp-submit').onclick = submit
  }

  // ── Render existing comment thread in popover ──

  _renderPopoverContent(commentId) {
    const comment = this.comments.get(commentId)
    if (!comment) { this.closePopover(); return }

    // Full thread: original + each reply with author + relative time
    const replies = (comment.replies || []).map(r => `
      <div class="cp-reply">
        <div class="cp-reply-meta">
          <span class="cp-author">${this._esc(r.author)}</span>
          <span class="cp-time">${this._relTime(r.timestamp || r.createdAt)}</span>
        </div>
        <div class="cp-text">${this._fmt(r.content)}</div>
      </div>
    `).join('')

    const resolvedBadge = comment.resolved
      ? '<span class="cp-resolved-badge">Resolved</span>'
      : ''

    const reminderRow = this._reminderRowHtml(comment)

    this.popover.innerHTML = `
      <div class="cp-thread${comment.resolved ? ' cp-thread-resolved' : ''}">
        <div class="cp-header">
          <span class="cp-author">${this._esc(comment.author)}</span>
          <span class="cp-time">${this._relTime(comment.timestamp || comment.createdAt)}</span>
          ${resolvedBadge}
          <div class="cp-actions">
            ${comment.resolved
              ? '<button class="cp-action-btn cp-reopen" title="Reopen"><i class="fas fa-undo"></i></button>'
              : '<button class="cp-action-btn cp-resolve" title="Resolve"><i class="fas fa-check"></i></button>'
            }
            <button class="cp-action-btn cp-delete" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        ${comment.quotedText ? `<div class="cp-quoted">"${this._esc(comment.quotedText.substring(0, 100))}${comment.quotedText.length > 100 ? '...' : ''}"</div>` : ''}
        <div class="cp-text">${this._fmt(comment.content)}</div>
        ${replies ? `<div class="cp-replies">${replies}</div>` : ''}
        ${reminderRow}
        <div class="cp-reply-box">
          <input type="text" class="cp-reply-input" placeholder="Reply...">
        </div>
      </div>
    `

    // Wire buttons
    const resolveBtn = this.popover.querySelector('.cp-resolve')
    if (resolveBtn) resolveBtn.onclick = () => { this.resolveComment(commentId); this.closePopover() }
    const reopenBtn = this.popover.querySelector('.cp-reopen')
    if (reopenBtn) reopenBtn.onclick = () => this.reopenComment(commentId)
    const deleteBtn = this.popover.querySelector('.cp-delete')
    if (deleteBtn) deleteBtn.onclick = () => { this.deleteComment(commentId); this.closePopover() }

    // Reminder: set / clear
    const reminderInput = this.popover.querySelector('.cp-reminder-input')
    if (reminderInput) {
      reminderInput.onchange = () => this.setReminder(commentId, reminderInput.value || null)
    }
    const reminderClear = this.popover.querySelector('.cp-reminder-clear')
    if (reminderClear) reminderClear.onclick = () => this.setReminder(commentId, null)

    const replyInput = this.popover.querySelector('.cp-reply-input')
    replyInput.onkeydown = (e) => {
      if (e.key === 'Enter' && replyInput.value.trim()) {
        this.addReply(commentId, replyInput.value.trim())
        replyInput.value = ''
      }
      if (e.key === 'Escape') this.closePopover()
    }
  }

  // Reminder row: shows the set date (if any) + a date input to set/change it.
  _reminderRowHtml(comment) {
    const value = comment.reminder ? this._toDateInputValue(comment.reminder) : ''
    const label = comment.reminder
      ? `<span class="comment-reminder"><i class="fas fa-bell"></i> ${this._esc(this._reminderLabel(comment.reminder))}</span>
         <button class="cp-action-btn cp-reminder-clear" title="Clear reminder"><i class="fas fa-times"></i></button>`
      : ''
    return `
      <div class="cp-reminder-box">
        <label class="cp-reminder-label"><i class="far fa-calendar"></i> Remind</label>
        <input type="date" class="cp-reminder-input" value="${value}">
        ${label}
      </div>
    `
  }

  // ── Comment CRUD ──

  async addComment(from, to, content) {
    if (!this.comments || !this.docEngine) return
    const user = await authClient.getMe()
    const author = user ? (user.displayName || user.email) : 'Anonymous'
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 6)
    const text = this.view ? this.view.state.doc.sliceString(from, to) : ''
    const yText = this.docEngine.text
    const relFrom = Y.createRelativePositionFromTypeIndex(yText, from)
    const relTo = Y.createRelativePositionFromTypeIndex(yText, to)

    this.comments.set(id, {
      id, author, content,
      quotedText: text,
      relFrom: Y.relativePositionToJSON(relFrom),
      relTo: Y.relativePositionToJSON(relTo),
      replies: [], resolved: false, reminder: null,
      timestamp: Date.now()
    })
    this.updateHighlights()
    this.closePopover()
    // Reopen as existing comment
    setTimeout(() => this.showComment(id), 50)
  }

  async addReply(commentId, content) {
    if (!this.comments) return
    const comment = this.comments.get(commentId)
    if (!comment) return
    const user = await authClient.getMe()
    const author = user ? (user.displayName || user.email) : 'Anonymous'
    const now = Date.now()
    const id = now.toString(36) + Math.random().toString(36).substring(2, 6)
    if (!Array.isArray(comment.replies)) comment.replies = []
    // createdAt mirrors timestamp so both naming conventions resolve.
    comment.replies.push({ id, author, content, timestamp: now, createdAt: now })
    // Persist through the same Y.Map path the manager already uses.
    this.comments.set(commentId, comment)
  }

  setReminder(commentId, dateStr) {
    if (!this.comments) return
    const c = this.comments.get(commentId)
    if (!c) return
    c.reminder = dateStr || null
    this.comments.set(commentId, c)
  }

  resolveComment(commentId) {
    if (!this.comments) return
    const c = this.comments.get(commentId)
    if (c) { c.resolved = true; this.comments.set(commentId, c) }
    this.updateHighlights()
  }

  reopenComment(commentId) {
    if (!this.comments) return
    const c = this.comments.get(commentId)
    if (c) { c.resolved = false; this.comments.set(commentId, c) }
    this.updateHighlights()
  }

  deleteComment(commentId) {
    if (!this.comments) return
    this.comments.delete(commentId)
    this.updateHighlights()
  }

  // ── Resolve positions ──

  resolveRange(comment) {
    if (!this.docEngine || !comment.relFrom || !comment.relTo) return null
    const yText = this.docEngine.text
    try {
      const from = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(comment.relFrom), this.docEngine.doc
      )
      const to = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(comment.relTo), this.docEngine.doc
      )
      if (from && to && from.type === yText && to.type === yText) {
        return { from: from.index, to: to.index }
      }
    } catch (e) { /* range no longer valid */ }
    return null
  }

  // ── CM6 highlights ──

  updateHighlights() {
    if (!this.view || !this.comments) return
    const decos = []
    this.comments.forEach(comment => {
      if (comment.resolved) return
      const range = this.resolveRange(comment)
      if (!range) return
      const { from, to } = range
      if (from >= 0 && to <= this.view.state.doc.length && from < to) {
        decos.push(
          Decoration.mark({
            class: 'cm-comment-highlight',
            attributes: { 'data-comment-id': comment.id }
          }).range(from, to)
        )
      }
    })
    this.view.dispatch({
      effects: setComments.of(Decoration.set(decos, true))
    })
  }

  // ── Start new comment from selection ──

  startNewComment() {
    if (!this.comments || !this.view) return
    const sel = this.view.state.selection.main
    if (sel.from === sel.to) return
    this.showNewComment(sel.from, sel.to)
  }

  // ── Click on highlighted text → open popover ──

  handleClick(e) {
    const el = e.target.closest('.cm-comment-highlight')
    if (!el) return false
    const commentId = el.getAttribute('data-comment-id')
    if (commentId) {
      e.preventDefault()
      this.showComment(commentId)
      return true
    }
    return false
  }

  // ── Events ──

  attachEvents() {
    window.addEventListener('cmd:add-comment', () => this.startNewComment())
    window.addEventListener('cmd:toggle-comments-panel', () => this.togglePanel())
  }

  // ── "All comments" side panel ──

  // Locate a mount point safely; prefer the editor container, fall back to body.
  _panelMount() {
    return document.querySelector('.editor-container')
      || document.querySelector('main')
      || document.body
  }

  _buildPanel() {
    // Floating comments FAB removed for a cleaner, Notion-like UI. Comments are
    // reached via inline comment markers / the selection toolbar; the panel is
    // still built below and can be toggled programmatically.
    this.panelToggle = null
    // Drop any stale FAB left over from a previous build / hot-reload.
    document.getElementById('comments-panel-toggle')?.remove()

    if (document.getElementById('comments-panel')) {
      this.panel = document.getElementById('comments-panel')
      return
    }
    const panel = document.createElement('div')
    panel.id = 'comments-panel'
    panel.className = 'comments-panel'
    panel.style.display = 'none'
    const mount = this._panelMount()
    mount.appendChild(panel)
    this.panel = panel
  }

  openPanel() {
    if (!this.panel) this._buildPanel()
    this.panelOpen = true
    this.panel.style.display = 'flex'
    if (this.panelToggle) this.panelToggle.classList.add('active')
    this._renderPanel()
  }

  closePanel() {
    if (!this.panel) return
    this.panelOpen = false
    this.panel.style.display = 'none'
    if (this.panelToggle) this.panelToggle.classList.remove('active')
  }

  togglePanel() {
    if (this.panelOpen) this.closePanel()
    else this.openPanel()
  }

  _renderPanel() {
    if (!this.panel || !this.panelOpen) return

    const all = this.comments ? Array.from(this.comments.values()) : []
    // Anchored ones first (by position), then by recency.
    all.sort((a, b) => {
      const ra = this.resolveRange(a)
      const rb = this.resolveRange(b)
      if (ra && rb) return ra.from - rb.from
      if (ra) return -1
      if (rb) return 1
      return (b.timestamp || b.createdAt || 0) - (a.timestamp || a.createdAt || 0)
    })

    const visible = all.filter(c => this.showResolved || !c.resolved)
    const resolvedCount = all.filter(c => c.resolved).length

    const items = visible.map(c => {
      const range = this.resolveRange(c)
      const snippetSrc = c.quotedText
        || (range && this.view ? this.view.state.doc.sliceString(range.from, range.to) : '')
      const snippet = snippetSrc
        ? `<div class="cpl-snippet">"${this._esc(snippetSrc.substring(0, 80))}${snippetSrc.length > 80 ? '...' : ''}"</div>`
        : '<div class="cpl-snippet cpl-orphan">(text removed)</div>'
      const replyCount = Array.isArray(c.replies) ? c.replies.length : 0
      const replyLabel = replyCount
        ? `<span class="cpl-replies"><i class="far fa-comment"></i> ${replyCount}</span>`
        : ''
      const reminder = c.reminder
        ? `<span class="comment-reminder"><i class="fas fa-bell"></i> ${this._esc(this._reminderLabel(c.reminder))}</span>`
        : ''
      const badge = c.resolved ? '<span class="cp-resolved-badge">Resolved</span>' : ''
      return `
        <div class="cpl-item${c.resolved ? ' cpl-resolved' : ''}" data-comment-id="${this._esc(c.id)}">
          <div class="cpl-meta">
            <span class="cp-author">${this._esc(c.author || 'Anonymous')}</span>
            <span class="cp-time">${this._relTime(c.timestamp || c.createdAt)}</span>
            ${badge}
          </div>
          ${snippet}
          <div class="cpl-body">${this._fmt((c.content || '').substring(0, 140))}</div>
          <div class="cpl-foot">${replyLabel}${reminder}</div>
        </div>
      `
    }).join('')

    this.panel.innerHTML = `
      <div class="cpl-header">
        <span class="cpl-title">Comments</span>
        <label class="cpl-filter">
          <input type="checkbox" class="cpl-show-resolved" ${this.showResolved ? 'checked' : ''}>
          Show resolved${resolvedCount ? ` (${resolvedCount})` : ''}
        </label>
        <button class="cp-action-btn cpl-close" title="Close"><i class="fas fa-times"></i></button>
      </div>
      <div class="cpl-list">
        ${items || '<div class="cpl-empty">No comments yet. Select text and add one.</div>'}
      </div>
    `

    const closeBtn = this.panel.querySelector('.cpl-close')
    if (closeBtn) closeBtn.onclick = () => this.closePanel()

    const showResolved = this.panel.querySelector('.cpl-show-resolved')
    if (showResolved) {
      showResolved.onchange = () => { this.showResolved = showResolved.checked; this._renderPanel() }
    }

    this.panel.querySelectorAll('.cpl-item').forEach(el => {
      el.onclick = () => {
        const id = el.getAttribute('data-comment-id')
        this.scrollToComment(id)
        this.showComment(id)
      }
    })
  }

  // Click-to-scroll: jump the editor to a comment's anchored range.
  scrollToComment(commentId) {
    if (!this.comments || !this.view) return
    const comment = this.comments.get(commentId)
    if (!comment) return
    const range = this.resolveRange(comment)
    if (!range) return
    try {
      this.view.dispatch({
        effects: EditorView.scrollIntoView(range.from, { y: 'center' })
      })
    } catch (e) { /* position no longer in document */ }
  }

  // ── Utilities ──

  _esc(text) {
    const d = document.createElement('div')
    d.textContent = text
    return d.innerHTML
  }

  _fmt(text) {
    return this._esc(text).replace(/@(\w+)/g, '<span class="mention">@$1</span>')
  }

  _relTime(ts) {
    if (!ts) return ''
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'now'
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d`
    return new Date(ts).toLocaleDateString()
  }

  // reminder may be an ISO date string ("2026-06-10") or a timestamp.
  _toDateInputValue(reminder) {
    if (!reminder) return ''
    if (typeof reminder === 'string' && /^\d{4}-\d{2}-\d{2}/.test(reminder)) {
      return reminder.substring(0, 10)
    }
    const d = new Date(reminder)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().substring(0, 10)
  }

  _reminderLabel(reminder) {
    const v = this._toDateInputValue(reminder)
    if (!v) return ''
    const d = new Date(`${v}T00:00:00`)
    if (Number.isNaN(d.getTime())) return v
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // ── One-time injected styles for NEW panel/reminder UI ──
  // Reuses the .cp-* look from style.css; only adds what's missing.
  _injectStyles() {
    if (document.getElementById('comments-extra-styles')) return
    const style = document.createElement('style')
    style.id = 'comments-extra-styles'
    style.textContent = `
      /* Resolved thread de-emphasis (popover) */
      .cp-thread-resolved { opacity: 0.72; }

      /* Reminder row in popover */
      .cp-reminder-box {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #f0f0f0;
        font-size: 12px;
        color: #888;
      }
      .cp-reminder-label { display: inline-flex; align-items: center; gap: 4px; }
      .cp-reminder-input {
        padding: 4px 6px;
        border: 1px solid #e8e8e8;
        border-radius: 6px;
        font-size: 12px;
        outline: none;
        background: #fafafa;
        font-family: inherit;
      }
      .cp-reminder-input:focus { border-color: #007bff; background: #fff; }
      .cp-reminder-clear { color: #bbb; }

      /* Floating toggle button */
      .comments-panel-toggle {
        position: fixed;
        right: 20px;
        bottom: 76px;
        z-index: 999;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        border: 1px solid #e0e0e0;
        background: #fff;
        color: #666;
        cursor: pointer;
        font-size: 14px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.12);
        transition: all 0.15s;
      }
      .comments-panel-toggle:hover { color: #333; transform: translateY(-1px); }
      .comments-panel-toggle.active { background: #007bff; color: #fff; border-color: #007bff; }

      /* "All comments" side panel */
      .comments-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 320px;
        z-index: 998;
        display: flex;
        flex-direction: column;
        background: #fff;
        border-left: 1px solid #e0e0e0;
        box-shadow: -4px 0 24px rgba(0,0,0,0.08);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
      }
      .cpl-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
        border-bottom: 1px solid #f0f0f0;
      }
      .cpl-title { font-weight: 600; font-size: 14px; color: #1a1a1a; }
      .cpl-filter {
        margin-left: auto;
        font-size: 11px;
        color: #888;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        user-select: none;
      }
      .cpl-list { flex: 1; overflow-y: auto; padding: 8px; }
      .cpl-empty { padding: 24px 16px; text-align: center; color: #aaa; font-size: 12px; }
      .cpl-item {
        padding: 10px 12px;
        border: 1px solid #f0f0f0;
        border-radius: 10px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
      }
      .cpl-item:hover { border-color: #d8d8d8; background: #fafafa; }
      .cpl-item.cpl-resolved { opacity: 0.6; }
      .cpl-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 5px;
      }
      .cpl-snippet {
        font-size: 11px;
        color: #888;
        font-style: italic;
        margin-bottom: 5px;
        padding: 4px 8px;
        background: #f8f8f8;
        border-left: 3px solid #e0e0e0;
        border-radius: 4px;
        line-height: 1.4;
      }
      .cpl-snippet.cpl-orphan { color: #c0392b; font-style: normal; }
      .cpl-body { color: #333; line-height: 1.45; word-wrap: break-word; }
      .cpl-foot {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 6px;
      }
      .cpl-replies { font-size: 11px; color: #999; display: inline-flex; align-items: center; gap: 4px; }
    `
    document.head.appendChild(style)
  }

  destroy() {
    if (this.comments && this._observer) this.comments.unobserve(this._observer)
    this.closePopover()
    this.closePanel()
  }
}
