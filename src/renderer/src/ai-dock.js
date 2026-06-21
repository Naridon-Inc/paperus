/*
 * AIDock — the Company Brain docked as a resizable right-hand panel (the
 * Workspace Shell "chat on the side"): a white aside with a border-left, an
 * "New AI chat" topbar, a soft welcome state, and a blue-bordered composer
 * with an attach button, a model picker, and send. The panel is drag-resizable
 * from its left edge (width persisted) and reuses the existing Brain engine
 * (companyBrainCenter.engine.askBrain) and its safe markdown renderer — no
 * second AI stack, no new auth.
 */

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const WIDTH_KEY = 'paperus_aidock_w'
const DEFAULT_W = 392
const MIN_W = 320
const MAX_W = 640

const sparkSvg = (size = 22, color = '#37352F') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
  <path d="M12 3l1.9 5.6a3 3 0 001.5 1.5L21 12l-5.6 1.9a3 3 0 00-1.5 1.5L12 21l-1.9-5.6a3 3 0 00-1.5-1.5L3 12l5.6-1.9a3 3 0 001.5-1.5L12 3z" fill="${color}"/>
</svg>`

export class AIDock {
  /** @param {{ getBrain: () => any, getDocContext?: () => ({label:string}|null), onToggle?: (open:boolean)=>void }} opts */
  constructor({ getBrain, getDocContext, onToggle } = {}) {
    this.getBrain = getBrain || (() => null)
    this.getDocContext = getDocContext || (() => null)
    this.onToggle = onToggle || (() => {})
    this.history = []
    this.attachments = [] // { name, text }
    this.el = null
    this.bodyEl = null
    this.inputEl = null
    this.sendBtn = null
    this.open = false
    this.busy = false
    let w = DEFAULT_W
    try { const s = parseInt(localStorage.getItem(WIDTH_KEY), 10); if (s >= MIN_W && s <= MAX_W) w = s } catch { /* noop */ }
    this.width = w
  }

  /** Build the dock into `container` (the .wrapper flex row, after .main). */
  mount(container) {
    // A <div>, not an <aside>: the global `aside { min-width:240; max-width:500 }`
    // rule (for the sidebar) would otherwise cap the dock's resize at 500px.
    const aside = document.createElement('div')
    aside.id = 'ai-dock'
    aside.className = 'ai-dock'
    aside.dataset.open = 'false'
    aside.innerHTML = `
      <div class="ai-dock-resizer" id="ai-dock-resizer" title="Drag to resize · double-click to reset"></div>
      <header class="ai-dock-top">
        <button class="ai-dock-newchat" id="ai-dock-newchat" title="New chat">
          <span>New AI chat</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M7 10l5 5 5-5" stroke="#37352F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="ai-dock-top-spacer"></div>
        <button class="ai-dock-iconbtn" id="ai-dock-add" title="New chat">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <button class="ai-dock-iconbtn" id="ai-dock-wide" title="Toggle wide panel">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M14 4v16" stroke="currentColor" stroke-width="1.6"/></svg>
        </button>
        <button class="ai-dock-iconbtn" id="ai-dock-close" title="Close panel  (⌘J)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M13 6l6 6-6 6M5 6l6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </header>

      <div class="ai-dock-body" id="ai-dock-body"></div>

      <div class="ai-dock-composer-wrap">
        <div class="ai-dock-composer">
          <div class="ai-dock-chips" id="ai-dock-chips"></div>
          <textarea id="ai-dock-input" rows="1" placeholder="Ask anything about your workspace…"></textarea>
          <div class="ai-dock-composer-row">
            <button class="ai-dock-tool" id="ai-dock-attach" title="Attach a file as context">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <div class="ai-dock-composer-spacer"></div>
            <button class="ai-dock-model" id="ai-dock-model" title="Choose model"><span id="ai-dock-model-label">Auto</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="ai-dock-send" id="ai-dock-send" title="Send" disabled>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
      </div>
      <input type="file" id="ai-dock-file" accept=".md,.txt,.markdown,.json,.csv,.log,.js,.ts,.py" style="display:none">
    `
    container.appendChild(aside)
    this.el = aside
    this.bodyEl = aside.querySelector('#ai-dock-body')
    this.inputEl = aside.querySelector('#ai-dock-input')
    this.sendBtn = aside.querySelector('#ai-dock-send')
    this.fileEl = aside.querySelector('#ai-dock-file')

    aside.querySelector('#ai-dock-close').addEventListener('click', () => this.hide())
    const reset = () => this.newChat()
    aside.querySelector('#ai-dock-add').addEventListener('click', reset)
    aside.querySelector('#ai-dock-newchat').addEventListener('click', reset)
    aside.querySelector('#ai-dock-wide').addEventListener('click', () => this._toggleWide())
    aside.querySelector('#ai-dock-attach').addEventListener('click', () => this.fileEl.click())
    aside.querySelector('#ai-dock-model').addEventListener('click', (e) => { e.stopPropagation(); this._openModelMenu() })
    this.fileEl.addEventListener('change', (e) => this._onFile(e))

    const autosize = () => {
      this.inputEl.style.height = 'auto'
      this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 160)}px`
      const has = this.inputEl.value.trim().length > 0
      this.sendBtn.disabled = (!has && !this.attachments.length) || this.busy
    }
    this.inputEl.addEventListener('input', autosize)
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._submit() }
    })
    this.sendBtn.addEventListener('click', () => this._submit())

    this._initResizer(aside.querySelector('#ai-dock-resizer'))
    this._applyWidth()
    this._renderEmpty()
    return aside
  }

  // ---- resize ---------------------------------------------------------------
  _applyWidth() {
    if (!this.el) return
    this.el.style.width = this.open ? `${this.width}px` : ''
  }

  setWidth(px, persist = true) {
    this.width = Math.max(MIN_W, Math.min(MAX_W, Math.round(px)))
    this._applyWidth()
    if (persist) { try { localStorage.setItem(WIDTH_KEY, String(this.width)) } catch { /* noop */ } }
  }

  _toggleWide() {
    // A quick preset toggle between the default and a wider reading width.
    this.setWidth(this.width >= 520 ? DEFAULT_W : 560)
  }

  _initResizer(handle) {
    if (!handle) return
    let startX = 0
    let startW = 0
    const onMove = (e) => {
      // Left-edge handle: dragging left widens the panel.
      this.setWidth(startW + (startX - e.clientX), false)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('ai-dock-resizing')
      try { localStorage.setItem(WIDTH_KEY, String(this.width)) } catch { /* noop */ }
    }
    handle.addEventListener('mousedown', (e) => {
      if (!this.open) return
      e.preventDefault()
      startX = e.clientX
      startW = this.width
      document.body.classList.add('ai-dock-resizing')
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
    handle.addEventListener('dblclick', () => this.setWidth(DEFAULT_W))
  }

  // ---- open / close ---------------------------------------------------------
  toggle() { return this.open ? this.hide() : this.show() }

  show() {
    if (!this.el) return
    this.open = true
    this.el.dataset.open = 'true'
    this._applyWidth()
    this._renderChips()
    this._refreshModelPill()
    this.onToggle(true)
    try { const b = this.getBrain(); if (b && b.engine && typeof b.engine.warm === 'function') b.engine.warm() } catch { /* noop */ }
    setTimeout(() => { try { this.inputEl.focus() } catch { /* noop */ } }, 60)
  }

  hide() {
    if (!this.el) return
    this.open = false
    this.el.dataset.open = 'false'
    this.el.style.width = ''
    this.onToggle(false)
  }

  newChat() {
    this.history = []
    this.attachments = []
    this._renderEmpty()
    this._renderChips()
    try { this.inputEl.value = ''; this.inputEl.style.height = 'auto'; this.sendBtn.disabled = true; this.inputEl.focus() } catch { /* noop */ }
  }

  // ---- model picker ---------------------------------------------------------
  async _refreshModelPill() {
    const label = this.el && this.el.querySelector('#ai-dock-model-label')
    if (!label) return
    try {
      const eng = this.getBrain() && this.getBrain().engine
      if (eng && typeof eng.listModels === 'function') {
        const info = await eng.listModels()
        const cur = (info && info.current) || ''
        label.textContent = cur ? this._shortModel(cur) : 'Auto'
      }
    } catch { /* keep Auto */ }
  }

  _shortModel(id) {
    const s = String(id)
    if (/opus/i.test(s)) return 'Opus'
    if (/sonnet/i.test(s)) return 'Sonnet'
    if (/haiku/i.test(s)) return 'Haiku'
    if (/gpt-4o/i.test(s)) return 'GPT-4o'
    return s.length > 14 ? `${s.slice(0, 13)}…` : s
  }

  async _openModelMenu() {
    this._closeModelMenu()
    const eng = this.getBrain() && this.getBrain().engine
    if (!eng || typeof eng.listModels !== 'function') return
    let info
    try { info = await eng.listModels() } catch { return }
    const models = (info && info.models) || []
    if (!models.length) return
    const menu = document.createElement('div')
    menu.className = 'ai-dock-model-menu'
    menu.innerHTML = models.map((m) => {
      const on = (info.current && m.id === info.current) ? ' is-on' : ''
      return `<button class="ai-dock-model-opt${on}" data-id="${escapeHtml(m.id)}">${escapeHtml(m.label || m.id)}</button>`
    }).join('')
    this.el.querySelector('.ai-dock-composer').appendChild(menu)
    this._menu = menu
    menu.addEventListener('click', async (e) => {
      const btn = e.target.closest('.ai-dock-model-opt')
      if (!btn) return
      try { if (typeof eng.setActiveModel === 'function') await eng.setActiveModel(btn.dataset.id) } catch { /* noop */ }
      this._closeModelMenu()
      this._refreshModelPill()
    })
    setTimeout(() => document.addEventListener('mousedown', this._menuAway = (ev) => {
      if (this._menu && !this._menu.contains(ev.target) && !ev.target.closest('#ai-dock-model')) this._closeModelMenu()
    }), 0)
  }

  _closeModelMenu() {
    if (this._menu) { this._menu.remove(); this._menu = null }
    if (this._menuAway) { document.removeEventListener('mousedown', this._menuAway); this._menuAway = null }
  }

  // ---- attachments + context chips -----------------------------------------
  async _onFile(e) {
    const file = e.target && e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      this.attachments.push({ name: file.name, text: text.slice(0, 200000) })
      this._renderChips()
      this.sendBtn.disabled = this.busy
    } catch { /* ignore unreadable */ }
  }

  _renderChips() {
    const wrap = this.el && this.el.querySelector('#ai-dock-chips')
    if (!wrap) return
    const chips = []
    const ctx = this.getDocContext && this.getDocContext()
    if (ctx && ctx.label) chips.push(`<span class="ai-dock-chip ai-dock-chip--doc">📄 ${escapeHtml(ctx.label)}</span>`)
    this.attachments.forEach((a, i) => {
      chips.push(`<span class="ai-dock-chip" data-att="${i}">📎 ${escapeHtml(a.name)} <span class="ai-dock-chip-x" data-att="${i}">✕</span></span>`)
    })
    wrap.innerHTML = chips.join('')
    wrap.querySelectorAll('.ai-dock-chip-x').forEach((x) => x.addEventListener('click', () => {
      this.attachments.splice(parseInt(x.dataset.att, 10), 1)
      this._renderChips()
    }))
  }

  // ---- rendering ------------------------------------------------------------
  _renderEmpty() {
    this.bodyEl.innerHTML = `
      <div class="ai-dock-welcome">
        <div class="ai-dock-welcome-mark">${sparkSvg(24, '#5F5E5B')}</div>
        <h2>How can I help?</h2>
        <p>I read across your whole workspace and cite the exact notes I used. Ask about the open page, a project, or anything in your team's docs.</p>
      </div>
    `
  }

  _appendMessage(role, html) {
    const welcome = this.bodyEl.querySelector('.ai-dock-welcome')
    if (welcome) this.bodyEl.innerHTML = ''
    const row = document.createElement('div')
    row.className = `ai-dock-msg ai-dock-msg--${role}`
    row.innerHTML = `<div class="ai-dock-msg-body">${html}</div>`
    this.bodyEl.appendChild(row)
    this.bodyEl.scrollTop = this.bodyEl.scrollHeight
    return row.querySelector('.ai-dock-msg-body')
  }

  _renderMd(text) {
    const b = this.getBrain()
    if (b && typeof b.formatMarkdown === 'function') {
      try { return b.formatMarkdown(text) } catch { /* fall through */ }
    }
    return escapeHtml(text).replace(/\n/g, '<br>')
  }

  async _submit() {
    const text = (this.inputEl.value || '').trim()
    if ((!text && !this.attachments.length) || this.busy) return
    const brain = this.getBrain()
    const engine = brain && brain.engine
    if (!engine || typeof engine.askBrain !== 'function') {
      this._appendMessage('user', escapeHtml(text))
      this._appendMessage('assistant', 'The Company Brain isn’t ready yet. Open the Brain tab once to finish setup, then try again.')
      return
    }

    // Fold attached files in as plain-text context (the brain-drawer pattern).
    let prompt = text
    if (this.attachments.length) {
      const ctx = this.attachments.map((a) => `--- Attached file: ${a.name} ---\n${a.text}`).join('\n\n')
      prompt = `${ctx}\n\n${text}`
    }
    const userLabel = text || `(${this.attachments.length} attachment${this.attachments.length > 1 ? 's' : ''})`

    this.inputEl.value = ''
    this.inputEl.style.height = 'auto'
    this.busy = true
    this.sendBtn.disabled = true
    const sentAttachments = this.attachments.slice()
    this.attachments = []
    this._renderChips()

    this._appendMessage('user', escapeHtml(userLabel))
    const out = this._appendMessage('assistant', '<span class="ai-dock-thinking">Thinking…</span>')

    let acc = ''
    let thinking = true
    const priorHistory = this.history.slice()
    try {
      await engine.askBrain(
        prompt,
        (token) => {
          if (thinking) { thinking = false; out.innerHTML = '' }
          acc += token
          out.innerHTML = this._renderMd(acc)
          this.bodyEl.scrollTop = this.bodyEl.scrollHeight
        },
        (full) => {
          thinking = false
          const answer = full || acc
          out.innerHTML = answer ? this._renderMd(answer)
            : 'No answer came back. Open the Brain tab to check your AI setup.'
          this.history.push({ role: 'user', content: userLabel })
          this.history.push({ role: 'assistant', content: answer })
          this.bodyEl.scrollTop = this.bodyEl.scrollHeight
        },
        priorHistory,
        null,
        [],
      )
    } catch (e) {
      out.innerHTML = `Something went wrong: ${escapeHtml(e && e.message)}`
      this.attachments = sentAttachments
      this._renderChips()
    } finally {
      this.busy = false
      this.sendBtn.disabled = (this.inputEl.value || '').trim().length === 0 && !this.attachments.length
    }
  }
}
