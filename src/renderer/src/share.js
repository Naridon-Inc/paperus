import { generateRoomCode, buildShareLink, buildShareCode } from './p2p'
import { contactStore, sendNoteToContact } from './contacts'

/**
 * SharePopover — accountless, pure-P2P "share this note via a link".
 *
 * There is no cloud account, no server-side document, and no permission list in
 * the open-source build. Sharing a note means:
 *   1. mint a random URL-safe share code (the swarm secret),
 *   2. bind THIS document's engine to that swarm (`connectP2P(code)`), so the
 *      live doc starts syncing to anyone holding the code,
 *   3. hand the user a `notionless-share:<code>` link / URL to pass along.
 *
 * The receiver pastes the link (sidebar "Join shared" affordance, or a
 * `#share=<code>` URL) → `cmd:join-shared-room` binds their engine to the same
 * swarm and the two converge. The relay only ever sees the BLAKE2b-hashed topic,
 * never the code or the note text.
 *
 * NOTE (Phase 1): this is the v1 share — the code is the WebRTC password
 * (transport encryption) but the CRDT itself is not yet AEAD-encrypted. Phase 5
 * upgrades per-note sharing to E2EE `share:v2` tokens routed through
 * `openP2PDoc`. The popover deliberately carries no sign-in path.
 */
export class SharePopover {
  constructor() {
    this.isOpen = false
    this.engine = null
    this.docName = 'Untitled'
  }

  /**
   * @param {string} docId
   * @param {string} filePath display name / path
   * @param {DocumentEngine} [engine]
   * @param {object} [opts] when sharing a TEAM note, pass a precomputed
   *        least-privilege link/code so we don't mint a fresh swarm:
   *        { link, code, note: true }
   */
  async open(docId, filePath, engine = null, opts = {}) {
    this.engine = engine || window.docEngine || null
    this.isOpen = true

    // Derive a friendly title for display.
    try {
      const raw = String(filePath || 'Untitled')
      const base = raw.includes('/') || raw.includes('\\') ? raw.split(/[\\/]/).pop() : raw
      this.docName = base.replace(/\.(md|txt|markdown)$/i, '').replace(/_/g, ' ') || 'Untitled'
    } catch (e) { this.docName = 'Untitled' }

    let container = document.getElementById('share-popover-container')
    if (!container) {
      container = document.createElement('div')
      container.id = 'share-popover-container'
      container.className = 'input-modal'
      document.body.appendChild(container)
    }

    // Team note: render the supplied least-privilege (share:v2) link directly.
    if (opts && opts.link) {
      this._renderLinkBox(container, opts.link, opts.code || opts.link, true, opts.share)
      return
    }

    if (!this.engine) {
      container.innerHTML = `
        <div class="input-box" style="width: 320px;">
          <h3 style="margin-top:0;">Open a note first</h3>
          <p style="color:#666; font-size:13px;">Open or create a note, then share it.</p>
          <div class="input-actions"><button class="btn" id="share-close">OK</button></div>
        </div>`
      container.querySelector('#share-close').onclick = () => this.close()
      return
    }

    // Mint a share code once per engine/session and bind the swarm. Re-opening
    // the popover for the same doc returns the same link (idempotent).
    if (!this.engine._shareCode) {
      this.engine._shareCode = generateRoomCode()
      try { this.engine.connectP2P(this.engine._shareCode) } catch (e) { console.warn('[Share] connectP2P failed', e) }
    }
    const code = this.engine._shareCode
    const link = buildShareLink(code)
    const codeStr = buildShareCode(code)

    container.innerHTML = `
      <div class="share-box" style="width: 380px; padding: 16px;">
        <div style="display:flex; align-items:center; margin-bottom:12px;">
          <div style="flex:1; font-size:14px; font-weight:600; color:#333;">Share "${this._esc(this.docName)}"</div>
          <button class="icon-btn" id="share-close" style="border:none; background:transparent; cursor:pointer; font-size:18px; color:#666;">&times;</button>
        </div>
        <p style="font-size:12px; color:#888; margin:0 0 10px; line-height:1.4;">
          Anyone with this link can open and edit this note live, peer-to-peer. No account needed.
        </p>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <input id="share-link-input" readonly value="${this._esc(link)}"
            style="flex:1; font-size:12px; padding:8px; border:1px solid #e0e0e0; border-radius:6px; background:#fafafa; color:#333;" />
          <button class="btn" id="share-copy-link" style="white-space:nowrap;">Copy link</button>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input id="share-code-input" readonly value="${this._esc(codeStr)}"
            style="flex:1; font-size:12px; padding:8px; border:1px solid #e0e0e0; border-radius:6px; background:#fafafa; color:#666;" />
          <button class="btn btn-secondary" id="share-copy-code" style="white-space:nowrap;">Copy code</button>
        </div>
      </div>`

    container.querySelector('#share-close').onclick = () => this.close()
    const copy = async (val, btn) => {
      try { await navigator.clipboard.writeText(val) } catch (e) {
        const inp = btn === 'link' ? '#share-link-input' : '#share-code-input'
        const el = container.querySelector(inp); el.select(); document.execCommand('copy')
      }
    }
    const linkBtn = container.querySelector('#share-copy-link')
    linkBtn.onclick = async () => { await copy(link, 'link'); linkBtn.textContent = 'Copied!'; setTimeout(() => { linkBtn.textContent = 'Copy link' }, 1500) }
    const codeBtn = container.querySelector('#share-copy-code')
    codeBtn.onclick = async () => { await copy(codeStr, 'code'); codeBtn.textContent = 'Copied!'; setTimeout(() => { codeBtn.textContent = 'Copy code' }, 1500) }
  }

  /**
   * Render a copy-link box for a PRECOMPUTED link (team-note `share:v2`).
   * No swarm is minted here — the link already encodes the note's own
   * least-privilege swarm+e2ee keys (p2p-team.noteShareLink).
   */
  _renderLinkBox(container, link, codeStr, isNote, share) {
    container.innerHTML = `
      <div class="share-box" style="width: 380px; padding: 16px;">
        <div style="display:flex; align-items:center; margin-bottom:12px;">
          <div style="flex:1; font-size:14px; font-weight:600; color:#333;">Share "${this._esc(this.docName)}"</div>
          <button class="icon-btn" id="share-close" style="border:none; background:transparent; cursor:pointer; font-size:18px; color:#666;">&times;</button>
        </div>
        <p style="font-size:12px; color:#888; margin:0 0 10px; line-height:1.4;">
          Anyone with this link can open and edit ${isNote ? 'this one note' : 'this note'} live, peer-to-peer.
          ${isNote ? 'It grants access to this note only — not the rest of the team.' : 'No account needed.'}
        </p>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
          <input id="share-link-input" readonly value="${this._esc(link)}"
            style="flex:1; font-size:12px; padding:8px; border:1px solid #e0e0e0; border-radius:6px; background:#fafafa; color:#333;" />
          <button class="btn" id="share-copy-link" style="white-space:nowrap;">Copy link</button>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input id="share-code-input" readonly value="${this._esc(codeStr)}"
            style="flex:1; font-size:12px; padding:8px; border:1px solid #e0e0e0; border-radius:6px; background:#fafafa; color:#666;" />
          <button class="btn btn-secondary" id="share-copy-code" style="white-space:nowrap;">Copy code</button>
        </div>
        <div id="share-people"></div>
      </div>`
    container.querySelector('#share-close').onclick = () => this.close()
    if (share && share.swarmKey && share.e2eeKey) {
      this._renderPeople(container.querySelector('#share-people'), share)
    }
    const copy = async (val, which) => {
      try { await navigator.clipboard.writeText(val) } catch (e) {
        const el = container.querySelector(which === 'link' ? '#share-link-input' : '#share-code-input')
        el.select(); document.execCommand('copy')
      }
    }
    const linkBtn = container.querySelector('#share-copy-link')
    linkBtn.onclick = async () => { await copy(link, 'link'); linkBtn.textContent = 'Copied!'; setTimeout(() => { linkBtn.textContent = 'Copy link' }, 1500) }
    const codeBtn = container.querySelector('#share-copy-code')
    codeBtn.onclick = async () => { await copy(codeStr, 'code'); codeBtn.textContent = 'Copied!'; setTimeout(() => { codeBtn.textContent = 'Copy code' }, 1500) }
  }

  /**
   * "Send to people" — list known contacts and let the user deliver the note
   * straight to one's sealed inbox (no link copy). The offer carries the note's
   * own swarm + e2ee keys (same grant as the share:v2 link) and is sealed to the
   * recipient's identity inside `sendNoteToContact`.
   */
  async _renderPeople(host, share) {
    if (!host) return
    let contacts = []
    try { contacts = await contactStore.list() } catch (e) { contacts = [] }

    const wrap = document.createElement('div')
    wrap.style.cssText = 'margin-top:14px; padding-top:12px; border-top:1px solid #eee;'
    const label = document.createElement('div')
    label.textContent = 'Send to people'
    label.style.cssText = 'font-size:12px; font-weight:600; color:#555; margin-bottom:8px;'
    wrap.appendChild(label)

    if (!contacts.length) {
      const hint = document.createElement('div')
      hint.textContent = 'People you share a team with appear here — then you can send a note straight to them.'
      hint.style.cssText = 'font-size:11px; color:#999; line-height:1.4;'
      wrap.appendChild(hint)
      host.appendChild(wrap)
      return
    }

    const listEl = document.createElement('div')
    listEl.style.cssText = 'max-height:160px; overflow-y:auto; display:flex; flex-direction:column; gap:4px;'
    for (const c of contacts) {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:4px 2px;'
      const dot = document.createElement('span')
      dot.style.cssText = `width:22px; height:22px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px; font-weight:600; background:${c.color || '#888'};`
      dot.textContent = String(c.name || '?').trim().charAt(0).toUpperCase() || '?'
      const name = document.createElement('div')
      name.textContent = c.name || 'Member'
      name.style.cssText = 'flex:1; font-size:13px; color:#333; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;'
      const btn = document.createElement('button')
      btn.className = 'btn btn-secondary'
      btn.textContent = 'Send'
      btn.style.cssText = 'white-space:nowrap; font-size:12px; padding:4px 12px;'
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = 'Sending…'
        try {
          await sendNoteToContact(c.pubKey, {
            type: 'note',
            title: share.title || this.docName || 'Untitled',
            swarmKey: share.swarmKey,
            e2eeKey: share.e2eeKey,
            fromName: share.fromName || '',
            fromPub: share.fromPub || '',
          })
          btn.textContent = 'Sent ✓'
        } catch (e) {
          console.warn('[Share] sendNoteToContact failed', e)
          btn.textContent = 'Failed'; btn.disabled = false
          setTimeout(() => { btn.textContent = 'Send' }, 2000)
        }
      }
      row.append(dot, name, btn)
      listEl.appendChild(row)
    }
    wrap.appendChild(listEl)
    host.appendChild(wrap)
  }

  _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  close() {
    const container = document.getElementById('share-popover-container')
    if (container) container.remove()
    this.isOpen = false
  }
}
