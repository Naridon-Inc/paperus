/**
 * device-link-dialog.js — desktop "Link a device" dialog (parent side).
 *
 * A parent member mints a pairing payload for the CURRENT team and hands it to a
 * phone. The payload carries exactly one secret — the `teamRootKey` — plus a
 * `deviceId` and `expiresAt`, so a leaked link is time-gated and the device can be
 * tagged in the roster (see docs/MOBILE_COMPANION.md §2.2/§4.7). From that single
 * secret the companion re-derives *everything* locally; the link carries no private
 * identity key and no per-note keys.
 *
 * This dialog only mints + displays the payload (copyable link + short code, with
 * "scan/enter on your phone" guidance and the honest security note). The companion
 * proves identity by self-claiming against the signed roster on the phone — the
 * parent never signs on its behalf.
 *
 * Mirrors team-dialogs.js for construction/mount/dispose: vanilla DOM, an overlay
 * with click-outside + Escape to close, reusing the `.td-*` styles.
 */
import QRCode from 'qrcode'
import { buildPairingPayload, serializePairingLink } from './device-link'

// ── styles (reuse team-dialogs' .td-* sheet; add a couple device-only rules) ─────

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('device-link-dialog-styles')) return
  // Base .td-* styles live in team-dialogs.js; ensure they exist even if this
  // dialog is opened before any team dialog has injected them.
  if (!document.getElementById('team-dialogs-styles')) {
    const base = document.createElement('style')
    base.id = 'team-dialogs-styles'
    base.textContent = `
    .td-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 10000; }
    .td-box { background: #fff; border-radius: 12px; width: 380px; max-width: 92vw; padding: 22px; box-shadow: 0 12px 40px rgba(0,0,0,0.18); font-size: 13px; color: #222; }
    .td-box h3 { margin: 0 0 6px; font-size: 17px; }
    .td-box p.td-sub { margin: 0 0 16px; color: #888; font-size: 12px; line-height: 1.45; }
    .td-field { margin-bottom: 12px; }
    .td-field label { display: block; font-size: 11px; font-weight: 600; color: #666; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .03em; }
    .td-field input { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #e0e0e0; border-radius: 7px; font-size: 13px; }
    .td-field input:focus { outline: none; border-color: #2383e2; }
    .td-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
    .td-btn { padding: 8px 14px; border-radius: 7px; border: 1px solid #e0e0e0; background: #fff; cursor: pointer; font-size: 13px; }
    .td-btn.primary { background: #2383e2; border-color: #2383e2; color: #fff; }
    .td-btn:disabled { opacity: .5; cursor: default; }
    .td-error { color: #d83a3a; font-size: 12px; margin-top: 10px; min-height: 16px; }
    .td-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: td-spin .7s linear infinite; vertical-align: -2px; margin-right: 6px; }
    @keyframes td-spin { to { transform: rotate(360deg); } }
    .td-linkbox { display: flex; gap: 6px; margin: 8px 0 4px; }
    .td-linkbox input { flex: 1; font-size: 12px; padding: 8px; border: 1px solid #e0e0e0; border-radius: 6px; background: #fafafa; }
    `
    document.head.appendChild(base)
  }
  const s = document.createElement('style')
  s.id = 'device-link-dialog-styles'
  s.textContent = `
  .dl-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 22px; letter-spacing: .12em; font-weight: 700; text-align: center; padding: 12px; background: #f6f8fb; border: 1px dashed #cfd8e3; border-radius: 8px; color: #2a3a4a; user-select: all; }
  .dl-steps { margin: 14px 0 4px; padding: 0; list-style: none; }
  .dl-steps li { display: flex; gap: 9px; align-items: flex-start; font-size: 12px; color: #444; line-height: 1.45; margin-bottom: 8px; }
  .dl-steps .dl-num { flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; background: #2383e2; color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
  .dl-note { margin-top: 14px; padding: 10px 12px; background: #fff8e6; border: 1px solid #f0e0b0; border-radius: 8px; font-size: 11.5px; color: #7a5e10; line-height: 1.5; }
  .dl-note b { color: #5e480a; }
  .dl-status { margin-top: 14px; display: flex; align-items: center; gap: 9px; padding: 10px 12px; background: #f4f6f8; border: 1px solid #e6eaee; border-radius: 8px; font-size: 12px; color: #555; }
  .dl-pulse { width: 9px; height: 9px; border-radius: 50%; background: #f0a83a; flex-shrink: 0; animation: dl-pulse 1.4s ease-in-out infinite; }
  @keyframes dl-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
  .dl-expiry { font-size: 11px; color: #999; margin-top: 4px; text-align: right; }
  .dl-qr-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 4px 0 14px; }
  .dl-qr { width: 200px; height: 200px; background: #fff; border: 1px solid #e6eaee; border-radius: 10px; padding: 10px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
  .dl-qr img { width: 100%; height: 100%; image-rendering: pixelated; display: block; }
  .dl-qr.dl-qr-loading, .dl-qr.dl-qr-error { color: #aab2bb; font-size: 11.5px; text-align: center; line-height: 1.4; padding: 16px; }
  .dl-qr-hint { font-size: 11.5px; color: #8a8a8a; text-align: center; }
  `
  document.head.appendChild(s)
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Mount an overlay+box modal. Returns { overlay, box, close }. Closes on
 * click-outside and on Escape (the Escape handler is torn down on close).
 */
function modal(innerHTML) {
  injectStyles()
  const overlay = document.createElement('div')
  overlay.className = 'td-overlay'
  overlay.innerHTML = `<div class="td-box">${innerHTML}</div>`
  document.body.appendChild(overlay)
  const onKey = (e) => { if (e.key === 'Escape') close() }
  const close = () => {
    document.removeEventListener('keydown', onKey)
    overlay.remove()
  }
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close() })
  document.addEventListener('keydown', onKey)
  return { overlay, box: overlay.querySelector('.td-box'), close }
}

/** Human-friendly "expires in N hours/days" from a ms-epoch deadline. */
function expiryLabel(expiresAt) {
  if (!expiresAt) return ''
  const ms = expiresAt - Date.now()
  if (ms <= 0) return 'expired'
  const hours = Math.round(ms / 3600000)
  if (hours < 1) return 'expires in under an hour'
  if (hours < 48) return `expires in ${hours} hour${hours === 1 ? '' : 's'}`
  return `expires in ${Math.round(hours / 24)} days`
}

// ── Link a device ────────────────────────────────────────────────────────────────

/**
 * Open the "Link a device" dialog for the current team.
 *
 * @param {object} manager  P2PTeamManager (provides getName / getKeys / getTeams).
 * @param {string} teamId   The team to mint a pairing payload for. If omitted and
 *                          exactly one team exists, that team is used.
 */
export function openDeviceLinkDialog(manager, teamId) {
  // Resolve the current team. If none was passed, fall back to the sole team.
  let resolvedTeamId = teamId
  if (!resolvedTeamId && manager && typeof manager.getTeams === 'function') {
    const teams = manager.getTeams() || []
    if (teams.length === 1) resolvedTeamId = teams[0].teamId
  }
  if (!resolvedTeamId) {
    const { box, close } = modal(`
      <h3>Link a device</h3>
      <p class="td-sub">Open a team first, then link a phone to it. A device is paired to one team at a time.</p>
      <div class="td-actions"><button class="td-btn primary" id="dl-ok">OK</button></div>`)
    box.querySelector('#dl-ok').onclick = close
    return { close }
  }

  const teamName = (manager.getName && manager.getName(resolvedTeamId)) || 'this team'

  const { box, close } = modal(`
    <h3>Link a device to “${esc(teamName)}”</h3>
    <p class="td-sub">Pair your phone to this team. Open Notionless on your phone, tap <b>Link a device</b>, then scan or paste the link below.</p>
    <div id="dl-body">
      <div class="td-status" style="margin-top:0;background:transparent;border:none;padding:0;color:#888;">
        <span class="td-spinner" style="border-color:#cfd8e3;border-top-color:transparent;"></span>Generating a pairing link…
      </div>
    </div>
    <div class="td-error" id="dl-err"></div>
    <div class="td-actions"><button class="td-btn" id="dl-close">Close</button></div>`)

  box.querySelector('#dl-close').onclick = close

  const bodyEl = box.querySelector('#dl-body')
  const errEl = box.querySelector('#dl-err')

  const renderError = (msg) => {
    bodyEl.innerHTML = ''
    errEl.textContent = msg
  }

  const renderPayload = ({ link, code, expiresAt }) => {
    const expLabel = expiryLabel(expiresAt)
    bodyEl.innerHTML = `
      <div class="dl-qr-wrap">
        <div class="dl-qr dl-qr-loading" id="dl-qr">Generating QR…</div>
        <div class="dl-qr-hint">Scan with your phone's camera, or paste the link below.</div>
      </div>
      <div class="td-field" style="margin-bottom:6px;">
        <label>Pairing link</label>
        <div class="td-linkbox">
          <input id="dl-link" readonly value="${esc(link)}" />
          <button class="td-btn primary" id="dl-copy-link">Copy link</button>
        </div>
      </div>
      ${code && code !== link ? `
      <div class="td-field" style="margin-bottom:6px;">
        <label>Or enter this short code on your phone</label>
        <div class="dl-code" id="dl-code">${esc(code)}</div>
        <div class="td-linkbox" style="margin-top:6px;">
          <span style="flex:1;"></span>
          <button class="td-btn" id="dl-copy-code">Copy code</button>
        </div>
      </div>` : ''}
      ${expLabel ? `<div class="dl-expiry">${esc(expLabel)} — generate a new one if it lapses.</div>` : ''}
      <ol class="dl-steps">
        <li><span class="dl-num">1</span><span>Install Notionless on your phone and open it.</span></li>
        <li><span class="dl-num">2</span><span>Scan the QR with the phone's camera, or paste the link on its Link screen.</span></li>
        <li><span class="dl-num">3</span><span>Pick a username + password on the phone to claim its own identity in this team.</span></li>
      </ol>
      <div class="dl-note">
        <b>Treat this link like a key.</b> It carries the team's full read/write access for a limited time —
        anyone who gets it before it expires can join and read everything. Share it over a trusted channel,
        and prefer a phone-specific username so a lost device is distinguishable. A linked phone is as
        trust-significant as inviting a person; access can't be revoked without rotating the team.
      </div>
      <div class="dl-status" id="dl-status">
        <span class="dl-pulse"></span>
        <span id="dl-status-text">Waiting for companion to connect…</span>
      </div>`

    const copy = async (val, btn, label) => {
      try { await navigator.clipboard.writeText(val) } catch (e) { /* ignore */ }
      btn.textContent = 'Copied!'
      setTimeout(() => { btn.textContent = label }, 1400)
    }
    const copyLinkBtn = bodyEl.querySelector('#dl-copy-link')
    if (copyLinkBtn) copyLinkBtn.onclick = (e) => copy(link, e.target, 'Copy link')
    const copyCodeBtn = bodyEl.querySelector('#dl-copy-code')
    if (copyCodeBtn) copyCodeBtn.onclick = (e) => copy(code, e.target, 'Copy code')

    // Render the SAME pairing link as a scannable QR. The phone's camera (native
    // app or the companion's link screen) decodes it to the exact string the
    // paste box holds — QR is just an alternate channel, no new secret. Error
    // correction 'M' tolerates the camera/screen-glare while keeping the ~215-char
    // link's module count low enough to scan comfortably at 200px.
    const qrEl = bodyEl.querySelector('#dl-qr')
    if (qrEl) {
      QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 0, width: 360 })
        .then((dataUrl) => {
          qrEl.classList.remove('dl-qr-loading')
          const img = document.createElement('img')
          img.alt = 'Pairing QR code'
          img.src = dataUrl
          qrEl.textContent = ''
          qrEl.appendChild(img)
        })
        .catch(() => {
          qrEl.classList.remove('dl-qr-loading')
          qrEl.classList.add('dl-qr-error')
          qrEl.textContent = 'Couldn’t draw the QR — use the link below instead.'
        })
    }
  }

  // Mint the payload for the current team. buildPairingPayload mints a fresh
  // deviceId + expiresAt each call (see device-link.js), so opening the dialog
  // again yields a new, independently time-gated link. renderPayload shows the
  // link both as a scannable QR and as copyable text; the lossless numeric
  // short-code (device-link.serializeNumericCode) stays a later read-aloud option.
  ;(async () => {
    try {
      const keys = (manager.getKeys && manager.getKeys(resolvedTeamId)) || {}
      const teamRootKey = keys.teamRootKey || keys.rootKey
      if (!teamRootKey) { renderError('Could not read this team’s key — open the team first.'); return }
      const payload = await buildPairingPayload({
        teamRootKey,
        teamId: resolvedTeamId,
        teamName,
      })
      const link = serializePairingLink(payload)
      if (!link) { renderError('Could not generate a pairing link for this team.'); return }
      renderPayload({ link, code: '', expiresAt: payload.expiresAt })
    } catch (e) {
      renderError('Could not generate a pairing link: ' + (e && e.message ? e.message : e))
    }
  })()

  return { close }
}
