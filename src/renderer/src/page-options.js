/**
 * Page options — a "•••" header popover for the currently open document.
 *
 * Provides two Notion-style page-level toggles, both stored in the document's
 * YAML front-matter so they travel with the .md file (git sync) and work on
 * the web build:
 *
 *   • Full width   → front-matter `width: full` (unset = default width).
 *                    Applied by toggling `.full-width` on the editor container.
 *   • Lock (read-only) → front-matter `locked: true`. Applied by flipping the
 *                    CodeMirror read-only compartment via a callback supplied by
 *                    main.js (`setEditorReadOnly`) — the proper mechanism. If no
 *                    callback is available we fall back to `contentEditable=false`
 *                    on `.cm-content` and show a "Locked" badge.
 *
 * This module owns NO global state: it reads/writes the doc through callbacks
 * mirroring PageHeader (`getEngine`), and is driven by main.js which calls
 * `apply()` after each doc load. The front-matter block itself stays hidden in
 * the editor via the existing live-preview decorations.
 */
import { parseFrontmatter, applyFrontmatter, getFrontmatterValue } from './frontmatter'

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('page-options-styles')) return
  const style = document.createElement('style')
  style.id = 'page-options-styles'
  style.textContent = `
    #page-options-btn { font-size: 16px; line-height: 1; color: #999; }
    #page-options-btn:hover { color: #555; }
    .page-options-popover {
      position: fixed;
      z-index: 10000;
      min-width: 220px;
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      padding: 6px;
      font-size: 13px;
    }
    .page-options-popover .po-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      color: #333;
      user-select: none;
    }
    .page-options-popover .po-item:hover { background: #f5f5f5; }
    .page-options-popover .po-item i.po-icon { width: 16px; text-align: center; color: #888; }
    .page-options-popover .po-item .po-check { margin-left: auto; color: #2383e2; }
    .page-options-popover .po-item .po-check.hidden { visibility: hidden; }
    /* Editor full-width override. style.css already ships an equivalent rule
       (.editor-container.full-width #editor .cm-content { max-width:100% }); we
       mirror its ID-level specificity here so the toggle still works even if
       that rule is absent. Harmless duplicate when present. */
    .editor-container.full-width #editor .cm-content { max-width: 100% !important; }
    .editor-container.full-width #editor .cm-editor { max-width: none !important; }
    /* Locked page badge */
    .page-locked-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #b26a00;
      background: #fff4e5;
      border: 1px solid #ffe2b3;
      border-radius: 4px;
      padding: 1px 6px;
      margin-right: 6px;
    }
  `
  document.head.appendChild(style)
}

export class PageOptions {
  /**
   * @param {object} opts
   * @param {() => any} opts.getEngine          returns the active DocumentEngine
   * @param {(boolean) => void} [opts.setEditorReadOnly]  toggle CM read-only (proper compartment)
   * @param {() => HTMLElement|null} [opts.getEditorContainer]  resolves `.editor-container`
   */
  constructor({ getEngine, setEditorReadOnly, getEditorContainer } = {}) {
    this.getEngine = getEngine || (() => null)
    this.setEditorReadOnly = typeof setEditorReadOnly === 'function' ? setEditorReadOnly : null
    this.getEditorContainer = getEditorContainer || (() => document.querySelector('.editor-container'))
    this._popover = null
    this._outside = null
    injectStyles()
    this._mountButton()
  }

  /** Mount the "•••" button into the header-right cluster (idempotent). */
  _mountButton() {
    const headerRight = document.getElementById('header-right') || document.querySelector('.header-right')
    if (!headerRight) return
    if (document.getElementById('page-options-btn')) {
      this.btn = document.getElementById('page-options-btn')
      return
    }
    const btn = document.createElement('button')
    btn.className = 'icon-btn'
    btn.id = 'page-options-btn'
    btn.title = 'Page options'
    btn.innerHTML = '<i class="fas fa-ellipsis-h"></i>'
    btn.onclick = (e) => { e.stopPropagation(); this.toggleMenu() }
    headerRight.appendChild(btn)
    this.btn = btn
  }

  // ── Front-matter helpers (mirror PageHeader._set) ──
  _frontmatterText() {
    const engine = this.getEngine()
    if (!engine || !engine.text) return null
    return engine.text.toString()
  }

  _set(updates) {
    const engine = this.getEngine()
    if (!engine || !engine.text) return
    const current = engine.text.toString()
    const { fm, oldEnd } = applyFrontmatter(current, updates)
    engine.doc.transact(() => {
      engine.text.delete(0, oldEnd)
      if (fm) engine.text.insert(0, fm)
    }, 'page-frontmatter')
  }

  // ── State readers ──
  isFullWidth() {
    const text = this._frontmatterText()
    if (text == null) return false
    return getFrontmatterValue(text, 'width') === 'full'
  }

  isLocked() {
    const text = this._frontmatterText()
    if (text == null) return false
    const v = getFrontmatterValue(text, 'locked')
    return v === true || v === 'true'
  }

  /**
   * Apply the persisted page options for the currently open doc. Called by
   * main.js after a document finishes loading (both local + cloud paths).
   * Safe to call when no doc is open — it resets to defaults.
   */
  apply() {
    const container = this.getEditorContainer()
    const hasEngine = !!(this.getEngine() && this.getEngine().text)

    // Hide the options button when nothing is open.
    if (this.btn) this.btn.style.display = hasEngine ? '' : 'none'

    if (!hasEngine) {
      if (container) container.classList.remove('full-width')
      this._applyLock(false)
      return
    }

    // Full width
    if (container) container.classList.toggle('full-width', this.isFullWidth())

    // Lock
    this._applyLock(this.isLocked())
  }

  /** Apply (or clear) the read-only / locked state to the editor + UI. */
  _applyLock(locked) {
    // Preferred: CodeMirror read-only compartment via main.js callback.
    if (this.setEditorReadOnly) {
      try { this.setEditorReadOnly(!!locked) } catch (e) { console.warn('[PageOptions] setEditorReadOnly failed:', e) }
    } else {
      // Fallback: toggle contentEditable on the CM content element.
      const content = document.querySelector('.cm-content')
      if (content) content.setAttribute('contenteditable', locked ? 'false' : 'true')
    }
    this._renderLockBadge(locked)
  }

  /** Show/hide a "Locked" badge in the header (next to the title). */
  _renderLockBadge(locked) {
    let badge = document.getElementById('page-locked-badge')
    if (locked) {
      if (!badge) {
        badge = document.createElement('span')
        badge.id = 'page-locked-badge'
        badge.className = 'page-locked-badge'
        badge.innerHTML = '<i class="fas fa-lock" style="font-size:9px;"></i> Locked'
        badge.title = 'This page is locked (read-only). Open page options to unlock.'
        const headerRight = document.getElementById('header-right') || document.querySelector('.header-right')
        if (headerRight) headerRight.insertBefore(badge, headerRight.firstChild)
      }
      badge.style.display = 'inline-flex'
    } else if (badge) {
      badge.style.display = 'none'
    }
  }

  // ── Toggles (persist to front-matter, then re-apply) ──
  toggleFullWidth() {
    const next = !this.isFullWidth()
    this._set({ width: next ? 'full' : '' })
    const container = this.getEditorContainer()
    if (container) container.classList.toggle('full-width', next)
  }

  toggleLock() {
    const next = !this.isLocked()
    this._set({ locked: next ? 'true' : '' })
    this._applyLock(next)
  }

  // ── Popover ──
  toggleMenu() {
    if (this._popover) { this._close(); return }
    const engine = this.getEngine()
    if (!engine || !engine.text) return

    const pop = document.createElement('div')
    pop.className = 'page-options-popover'

    const fullWidthOn = this.isFullWidth()
    const lockedOn = this.isLocked()

    pop.innerHTML = `
      <div class="po-item" data-action="full-width">
        <i class="po-icon fas fa-arrows-alt-h"></i>
        <span>Full width</span>
        <i class="po-check fas fa-check ${fullWidthOn ? '' : 'hidden'}"></i>
      </div>
      <div class="po-item" data-action="lock">
        <i class="po-icon fas ${lockedOn ? 'fa-lock' : 'fa-lock-open'}"></i>
        <span>${lockedOn ? 'Unlock page' : 'Lock page'}</span>
        <i class="po-check fas fa-check ${lockedOn ? '' : 'hidden'}"></i>
      </div>
    `

    pop.querySelector('[data-action="full-width"]').onclick = () => {
      this.toggleFullWidth()
      this._close()
    }
    pop.querySelector('[data-action="lock"]').onclick = () => {
      this.toggleLock()
      this._close()
    }

    document.body.appendChild(pop)
    const anchor = this.btn || document.getElementById('header-right') || document.body
    const r = anchor.getBoundingClientRect()
    // Position below-right of the button, kept on-screen.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 240))
    pop.style.top = `${r.bottom + 6}px`
    pop.style.left = `${left}px`
    this._popover = pop

    setTimeout(() => {
      this._outside = (ev) => {
        if (this._popover && !this._popover.contains(ev.target) && ev.target !== this.btn && !this.btn?.contains(ev.target)) {
          this._close()
        }
      }
      document.addEventListener('mousedown', this._outside)
    }, 0)
  }

  _close() {
    if (this._popover && this._popover.parentNode) this._popover.parentNode.removeChild(this._popover)
    this._popover = null
    if (this._outside) { document.removeEventListener('mousedown', this._outside); this._outside = null }
  }
}
