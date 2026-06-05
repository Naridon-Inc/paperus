/**
 * team-dialogs.js — vanilla DOM dialogs for the P2P team flow:
 *   - create team        (name → P2PTeamManager.createTeam → claim identity)
 *   - join team          (paste link → joinTeam → claim-or-login)
 *   - claim-or-login      (username + password → deriveIdentity → roster)
 *   - roster view         (signed members list)
 *
 * Identity derivation (Argon2id MODERATE) is intentionally slow — it's the only
 * thing standing between a weak password and an offline guess against the public
 * roster (R5) — so each derive shows a spinner and a password-strength meter
 * gates new claims.
 */
import { deriveIdentity } from './team-keys'
import { identity } from './identity'
import { Config } from './config'

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('team-dialogs-styles')) return
  const s = document.createElement('style')
  s.id = 'team-dialogs-styles'
  s.textContent = `
  .td-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 10000; }
  .td-box { background: #fff; border-radius: 12px; width: 380px; max-width: 92vw; padding: 22px; box-shadow: 0 12px 40px rgba(0,0,0,0.18); font-size: 13px; color: #222; }
  .td-box h3 { margin: 0 0 6px; font-size: 17px; }
  .td-box p.td-sub { margin: 0 0 16px; color: #888; font-size: 12px; line-height: 1.45; }
  .td-field { margin-bottom: 12px; }
  .td-field label { display: block; font-size: 11px; font-weight: 600; color: #666; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .03em; }
  .td-field input { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #e0e0e0; border-radius: 7px; font-size: 13px; }
  .td-field input:focus { outline: none; border-color: #2383e2; }
  .td-meter { height: 5px; border-radius: 3px; background: #eee; margin-top: 6px; overflow: hidden; }
  .td-meter > div { height: 100%; width: 0; transition: width .2s, background .2s; }
  .td-meter-label { font-size: 10px; color: #999; margin-top: 3px; }
  .td-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
  .td-btn { padding: 8px 14px; border-radius: 7px; border: 1px solid #e0e0e0; background: #fff; cursor: pointer; font-size: 13px; }
  .td-btn.primary { background: #2383e2; border-color: #2383e2; color: #fff; }
  .td-btn:disabled { opacity: .5; cursor: default; }
  .td-error { color: #d83a3a; font-size: 12px; margin-top: 10px; min-height: 16px; }
  .td-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: td-spin .7s linear infinite; vertical-align: -2px; margin-right: 6px; }
  @keyframes td-spin { to { transform: rotate(360deg); } }
  .td-linkbox { display: flex; gap: 6px; margin: 8px 0 4px; }
  .td-linkbox input { flex: 1; font-size: 12px; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; background: #fafafa; }
  .td-member { display: flex; align-items: center; gap: 8px; padding: 7px 4px; border-bottom: 1px solid #f3f3f3; }
  .td-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .td-member .nm { font-weight: 600; }
  .td-member .un { color: #999; font-size: 11px; }
  `
  document.head.appendChild(s)
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function modal(innerHTML) {
  injectStyles()
  const overlay = document.createElement('div')
  overlay.className = 'td-overlay'
  overlay.innerHTML = `<div class="td-box">${innerHTML}</div>`
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close() })
  return { overlay, box: overlay.querySelector('.td-box'), close }
}

/** Cheap password-strength estimate (0..4) — variety + length, no dictionary. */
function strength(pw) {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(4, score)
}
const STRENGTH_LABEL = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong']
const STRENGTH_COLOR = ['#d83a3a', '#e8843a', '#e8c33a', '#7bc043', '#3aa757']

// ── Create team ────────────────────────────────────────────────────────────────

export function openCreateTeamDialog(manager) {
  const { box, close } = modal(`
    <h3>Create a team</h3>
    <p class="td-sub">A team is a shared, peer-to-peer workspace. You'll get one link to invite teammates — no accounts, no server.</p>
    <div class="td-field">
      <label>Team name</label>
      <input id="td-team-name" placeholder="Acme Docs" autofocus />
    </div>
    <div class="td-error" id="td-err"></div>
    <div class="td-actions">
      <button class="td-btn" id="td-cancel">Cancel</button>
      <button class="td-btn primary" id="td-create">Create</button>
    </div>`)
  const nameEl = box.querySelector('#td-team-name')
  box.querySelector('#td-cancel').onclick = close
  const create = async () => {
    const name = nameEl.value.trim()
    if (!name) { box.querySelector('#td-err').textContent = 'Enter a team name.'; return }
    const created = await manager.createTeam(name)
    close()
    // New team → claim your identity, then show the invite link.
    openClaimDialog(manager, created.teamId, { afterClaim: () => openInviteDialog(manager, created.teamId) })
  }
  box.querySelector('#td-create').onclick = create
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') create() })
}

// ── Join team ────────────────────────────────────────────────────────────────

export function openJoinTeamDialog(manager, prefillKey = '') {
  const { box, close } = modal(`
    <h3>Join a team</h3>
    <p class="td-sub">Paste the team link a teammate shared with you.</p>
    <div class="td-field">
      <label>Team link</label>
      <input id="td-join-link" placeholder="notionless-team:… or https://…/#team=…" value="${esc(prefillKey)}" autofocus />
    </div>
    <div class="td-error" id="td-err"></div>
    <div class="td-actions">
      <button class="td-btn" id="td-cancel">Cancel</button>
      <button class="td-btn primary" id="td-join">Join</button>
    </div>`)
  box.querySelector('#td-cancel').onclick = close
  const linkEl = box.querySelector('#td-join-link')
  const join = async () => {
    const raw = linkEl.value.trim()
    const errEl = box.querySelector('#td-err')
    // Lazy import to avoid a cycle; parseTeamCode lives in p2p.js.
    const { parseTeamCode } = await import('./p2p')
    const rootKey = parseTeamCode(raw) || (/^[A-Za-z0-9_-]{16,}$/.test(raw) ? raw : null)
    if (!rootKey) { errEl.textContent = 'That doesn\'t look like a team link.'; return }
    errEl.textContent = ''
    const btn = box.querySelector('#td-join'); btn.disabled = true; btn.innerHTML = '<span class="td-spinner"></span>Joining…'
    try {
      const { teamId } = await manager.joinTeam(rootKey)
      close()
      openClaimDialog(manager, teamId, {})
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Join'
      errEl.textContent = 'Could not join: ' + (e.message || e)
    }
  }
  box.querySelector('#td-join').onclick = join
  linkEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') join() })
}

// ── Claim or login (identity) ────────────────────────────────────────────────

export function openClaimDialog(manager, teamId, { afterClaim } = {}) {
  const keys = manager.getKeys(teamId)
  const roster = manager.getRoster(teamId)
  const teamName = manager.getName(teamId)
  const { box, close } = modal(`
    <h3>Who are you in “${esc(teamName)}”?</h3>
    <p class="td-sub">Pick a username and password for this team. They never leave your device — they re-derive your identity key. Use the same pair on another device to log in as you.</p>
    <div class="td-field">
      <label>Username</label>
      <input id="td-un" placeholder="alice" autocomplete="off" autofocus />
    </div>
    <div class="td-field">
      <label>Password</label>
      <input id="td-pw" type="password" placeholder="a strong passphrase" />
      <div class="td-meter"><div id="td-meterbar"></div></div>
      <div class="td-meter-label" id="td-meterlabel"></div>
    </div>
    <div class="td-error" id="td-err"></div>
    <div class="td-actions">
      <button class="td-btn" id="td-cancel">Cancel</button>
      <button class="td-btn primary" id="td-go">Continue</button>
    </div>`)

  const unEl = box.querySelector('#td-un')
  const pwEl = box.querySelector('#td-pw')
  const errEl = box.querySelector('#td-err')
  const bar = box.querySelector('#td-meterbar')
  const meterLabel = box.querySelector('#td-meterlabel')
  box.querySelector('#td-cancel').onclick = close

  pwEl.addEventListener('input', () => {
    const sc = strength(pwEl.value)
    bar.style.width = `${(sc / 4) * 100}%`
    bar.style.background = STRENGTH_COLOR[sc]
    meterLabel.textContent = pwEl.value ? STRENGTH_LABEL[sc] : ''
  })

  const go = async () => {
    const username = unEl.value.trim().toLowerCase()
    const password = pwEl.value
    errEl.textContent = ''
    if (!/^[a-z0-9_.-]{2,32}$/.test(username)) { errEl.textContent = 'Username: 2–32 chars, letters/numbers/._- only.'; return }
    if (!password) { errEl.textContent = 'Enter a password.'; return }

    const taken = roster.isTaken(username)
    // Enforce a minimum strength only when CLAIMING a new username.
    if (!taken && strength(password) < 2) { errEl.textContent = 'Please choose a stronger password (8+ chars, mixed).'; return }

    const btn = box.querySelector('#td-go'); btn.disabled = true; btn.innerHTML = '<span class="td-spinner"></span>Deriving your key…'
    // Let the spinner paint before the synchronous Argon2id work.
    await new Promise((r) => setTimeout(r, 30))

    let id
    try {
      id = await deriveIdentity(keys.teamId, username, password)
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Continue'; errEl.textContent = 'Key derivation failed: ' + (e.message || e); return
    }

    const fullId = { username, displayName: unEl.value.trim(), color: '', publicKey: id.publicKey, privateKey: id.privateKey }
    let res
    if (taken) {
      res = await roster.login({ username, identity: id })
      if (!res.ok) {
        btn.disabled = false; btn.textContent = 'Continue'
        errEl.textContent = 'That username is taken and the password doesn\'t match. Try a different username, or check your password.'
        return
      }
    } else {
      res = await roster.claim({ username, displayName: unEl.value.trim(), identity: id })
      if (!res.ok) {
        btn.disabled = false; btn.textContent = 'Continue'
        errEl.textContent = res.reason === 'taken'
          ? 'Someone just claimed that username. Pick another.'
          : 'Could not claim username.'
        return
      }
    }

    await identity.setIdentity(keys.teamId, fullId)
    manager.refreshPresence(keys.teamId)
    close()
    if (afterClaim) afterClaim()
    window.dispatchEvent(new CustomEvent('team:identity-ready', { detail: { teamId: keys.teamId, username } }))
  }
  box.querySelector('#td-go').onclick = go
  pwEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
}

// ── Invite link ────────────────────────────────────────────────────────────────

export function openInviteDialog(manager, teamId) {
  const link = manager.inviteLink(teamId)
  const code = manager.inviteCode(teamId)
  const dl = (Config && Config.DOWNLOAD_URL) || 'https://github.com/Naridon-Inc/notionless/releases/latest'
  const { box, close } = modal(`
    <h3>Invite to “${esc(manager.getName(teamId))}”</h3>
    <p class="td-sub">Share this link. It opens the Notionless desktop app and joins them instantly — they pick their own username, no account needed. Treat it like a key: it grants full access to the workspace.</p>
    <div class="td-linkbox">
      <input id="td-invite-link" readonly value="${esc(link)}" />
      <button class="td-btn primary" id="td-copy-link">Copy link</button>
    </div>
    <p class="td-sub" style="margin:10px 0 4px;font-size:11px;">Or paste this code straight into the app (Join a team):</p>
    <div class="td-linkbox">
      <input id="td-invite-code" readonly value="${esc(code)}" />
      <button class="td-btn" id="td-copy-code">Copy code</button>
    </div>
    <p class="td-sub" style="margin:12px 0 0;font-size:11px;">Don't have the app yet? Install it first, then open the link: <a href="${esc(dl)}" target="_blank" rel="noopener">Download Notionless for Mac</a></p>
    <div class="td-actions"><button class="td-btn" id="td-done">Done</button></div>`)
  box.querySelector('#td-done').onclick = close
  const copy = async (val, btn, label) => {
    try { await navigator.clipboard.writeText(val) } catch (e) { /* ignore */ }
    btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = label }, 1400)
  }
  box.querySelector('#td-copy-link').onclick = (e) => copy(link, e.target, 'Copy link')
  box.querySelector('#td-copy-code').onclick = (e) => copy(code, e.target, 'Copy code')
}

// ── Roster view ────────────────────────────────────────────────────────────────

export function openRosterDialog(manager, teamId) {
  const roster = manager.getRoster(teamId)
  const members = roster.getMembers()
  const rows = members.length
    ? members.map((m) => `
      <div class="td-member">
        <span class="td-dot" style="background:${esc(m.color || '#888')}"></span>
        <span class="nm">${esc(m.displayName || m.username)}</span>
        <span class="un">@${esc(m.username)}</span>
      </div>`).join('')
    : '<p class="td-sub">No members yet.</p>'
  const { box, close } = modal(`
    <h3>Members of “${esc(manager.getName(teamId))}”</h3>
    <p class="td-sub">Membership is a cryptographically signed roster — each name is backed by a key only that person can produce.</p>
    <div>${rows}</div>
    <div class="td-actions">
      <button class="td-btn" id="td-invite">Invite link</button>
      <button class="td-btn primary" id="td-close">Close</button>
    </div>`)
  box.querySelector('#td-close').onclick = close
  box.querySelector('#td-invite').onclick = () => { close(); openInviteDialog(manager, teamId) }
}

// ── Create note (with optional restricted access) ───────────────────────────────

/**
 * New-note dialog. A plain note is team-wide (everyone reads). Toggling
 * "Restricted" reveals a member picker; the note's content key is then wrapped
 * only to the chosen members (you're always included). Either way the ciphertext
 * still replicates to every member for availability — only reading is gated.
 */
export function openCreateNoteDialog(manager, teamId, { parentId = null, afterCreate } = {}) {
  const me = identity.getIdentity(teamId)
  const members = manager.getRoster(teamId).getMembers()
  // Everyone except me — I'm auto-included and shown as a fixed row.
  const others = members.filter((m) => !me || m.idPublicKey !== me.publicKey)
  const canRestrict = !!(me && me.publicKey && me.privateKey)
  const memberRows = others.map((m) => `
    <label class="td-member" style="cursor:pointer;border:none;">
      <input type="checkbox" class="td-grant" value="${esc(m.idPublicKey)}" style="margin:0;" />
      <span class="td-dot" style="background:${esc(m.color || '#888')}"></span>
      <span class="nm">${esc(m.displayName || m.username)}</span>
      <span class="un">@${esc(m.username)}</span>
    </label>`).join('')

  const { box, close } = modal(`
    <h3>New note</h3>
    <div class="td-field">
      <label>Title</label>
      <input id="td-note-title" placeholder="Untitled" autofocus />
    </div>
    <label class="td-member" style="border:none;cursor:${canRestrict ? 'pointer' : 'default'};opacity:${canRestrict ? 1 : 0.5};">
      <input type="checkbox" id="td-restricted" style="margin:0;" ${canRestrict ? '' : 'disabled'} />
      <span style="font-weight:600;">Restricted — only chosen members can read</span>
    </label>
    ${canRestrict ? '' : '<p class="td-sub" style="margin:4px 0 0;">Claim your identity (username + password) to create restricted notes.</p>'}
    <div id="td-grant-wrap" style="display:none;margin-top:10px;">
      <p class="td-sub" style="margin:0 0 6px;">Who can read it? Ciphertext still syncs to everyone; only these members get the key.</p>
      <div class="td-member" style="border:none;opacity:.7;">
        <input type="checkbox" checked disabled style="margin:0;" />
        <span class="nm">You</span><span class="un">always included</span>
      </div>
      <div style="max-height:180px;overflow:auto;">${memberRows || '<p class="td-sub">No other members yet.</p>'}</div>
    </div>
    <div class="td-error" id="td-err"></div>
    <div class="td-actions">
      <button class="td-btn" id="td-cancel">Cancel</button>
      <button class="td-btn primary" id="td-create">Create</button>
    </div>`)

  const titleEl = box.querySelector('#td-note-title')
  const restrictedEl = box.querySelector('#td-restricted')
  const grantWrap = box.querySelector('#td-grant-wrap')
  restrictedEl.addEventListener('change', () => { grantWrap.style.display = restrictedEl.checked ? 'block' : 'none' })
  box.querySelector('#td-cancel').onclick = close

  const create = async () => {
    const title = titleEl.value.trim() || 'Untitled'
    const restricted = restrictedEl.checked
    const grantTo = restricted
      ? [...box.querySelectorAll('.td-grant:checked')].map((c) => c.value)
      : []
    const btn = box.querySelector('#td-create')
    btn.disabled = true
    try {
      const noteId = await manager.createNote(teamId, {
        title, parentId, restricted, grantTo,
      })
      close()
      if (afterCreate) afterCreate(noteId)
    } catch (e) {
      box.querySelector('#td-err').textContent = e && e.message ? e.message : 'Could not create the note.'
      btn.disabled = false
    }
  }
  box.querySelector('#td-create').onclick = create
  titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') create() })
}

// ── Note access ("Who can access") ──────────────────────────────────────────────

/**
 * Per-note access manager for a restricted note. Lists every member with their
 * current access; granting wraps the content key to that member. Revocation is a
 * v1 limitation (no forward secrecy) so existing grants aren't removable here.
 */
export function openNoteAccessDialog(manager, teamId, noteId) {
  const meta = manager.getNoteMeta(teamId, noteId)
  if (!meta || !meta.restricted) {
    const { box: b0, close: c0 } = modal(`
      <h3>Open access</h3>
      <p class="td-sub">This is a normal team note — every member can already read it. Create a <b>restricted</b> note to limit who has access.</p>
      <div class="td-actions"><button class="td-btn primary" id="td-ok">OK</button></div>`)
    b0.querySelector('#td-ok').onclick = c0
    return
  }
  const list = manager.getNoteAccessList(teamId, noteId)
  const render = (rows) => rows.map((m) => `
    <div class="td-member">
      <span class="td-dot" style="background:${esc(m.color || '#888')}"></span>
      <span class="nm">${esc(m.displayName || m.username)}</span>
      <span class="un">@${esc(m.username)}</span>
      <span style="flex:1;"></span>
      ${m.hasAccess
    ? '<span style="font-size:11px;color:#3aa757;font-weight:600;">Has access</span>'
    : `<button class="td-btn td-grant-btn" data-pk="${esc(m.idPublicKey)}" style="padding:4px 10px;font-size:12px;">Grant</button>`}
    </div>`).join('')

  const { box, close } = modal(`
    <h3>Who can access</h3>
    <p class="td-sub">Members with the key can read this note. Anyone with access can grant others. Removing access isn't supported yet — it needs a key rotation (no forward secrecy).</p>
    <div id="td-acl-list">${render(list)}</div>
    <div class="td-error" id="td-err"></div>
    <div class="td-actions"><button class="td-btn primary" id="td-done">Done</button></div>`)
  box.querySelector('#td-done').onclick = close

  box.querySelector('#td-acl-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.td-grant-btn')
    if (!btn) return
    btn.disabled = true; btn.textContent = 'Granting…'
    const res = await manager.grantAccess(teamId, noteId, btn.dataset.pk)
    if (res && res.ok) {
      box.querySelector('#td-acl-list').innerHTML = render(manager.getNoteAccessList(teamId, noteId))
    } else {
      box.querySelector('#td-err').textContent = res && res.reason === 'no-access'
        ? 'You need access yourself before you can grant it.'
        : 'Could not grant access.'
      btn.disabled = false; btn.textContent = 'Grant'
    }
  })
}
