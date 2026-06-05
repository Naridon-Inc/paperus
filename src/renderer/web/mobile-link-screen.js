/**
 * mobile-link-screen.js — the hard pairing gate UI for the mobile companion.
 *
 * The companion is INERT until linked (docs/MOBILE_COMPANION.md §2.5). This module
 * renders the Link screen shown when no pairing credentials are stored, parses a
 * pasted pairing link / short code into companion credentials, and hands the
 * verified creds back to mobile-main.js to persist + boot.
 *
 * It owns ONLY presentation + parse-orchestration. It never derives keys itself,
 * never opens a note, and never touches the swarm — the gate is enforced by the
 * caller (mobile-main.js) which only proceeds once `onLinked(creds)` resolves.
 *
 * The authoritative pairing parser is `../src/device-link.js` (the desktop "Link a
 * device" slice). We consume that seam when present; if it hasn't landed yet we
 * fall back to a thin parser built on the REAL `parseTeamCode` from `../src/p2p.js`
 * so we never fork the team-key format. Either way the only secret we extract is
 * the `teamRootKey` — everything else (teamId, swarmKey, e2eeKey, per-note keys,
 * identity) is re-derived locally, exactly as on desktop.
 */

// Tiny vanilla element builder — same DOM-first spirit as team-dialogs.js (no
// framework, no new deps). `attrs` maps to properties (className, htmlFor, …) or
// attributes; `children` is text nodes / elements.
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue
    if (k in node) {
      try { node[k] = v } catch (_e) { node.setAttribute(k, v) }
    } else {
      node.setAttribute(k, v)
    }
  }
  const kids = Array.isArray(children) ? children : [children]
  for (const c of kids) {
    if (c == null) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

// ── Pairing-link parsing (consumes ../src/device-link.js when available) ─────────

const PAIR_PREFIX = 'notionless-pair:'

/**
 * Resolve the authoritative parser + verifier from the device-link seam if it
 * exists. Returns `{ parse, verify }` (either may be null) so callers can fall
 * back to the local parser when the module isn't present.
 */
async function loadCanonical() {
  try {
    const mod = await import('../src/device-link.js')
    const parse =
      mod.parsePairingLink ||
      mod.parsePairingPayload ||
      mod.parsePairingCode ||
      (mod.default && (mod.default.parsePairingLink || mod.default.parsePairingPayload))
    const verify = mod.verifyPairingPayload || (mod.default && mod.default.verifyPairingPayload)
    return {
      parse: typeof parse === 'function' ? parse : null,
      verify: typeof verify === 'function' ? verify : null,
    }
  } catch (_e) {
    // device-link.js not shipped yet — fall back to the local parser below.
    return { parse: null, verify: null }
  }
}

/** base64url → JSON object, or null. */
function decodePayload(b64url) {
  try {
    let s = String(b64url).replace(/-/g, '+').replace(/_/g, '/')
    while (s.length % 4) s += '='
    const json = decodeURIComponent(
      atob(s)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    )
    const obj = JSON.parse(json)
    return obj && typeof obj === 'object' ? obj : null
  } catch (_e) {
    return null
  }
}

/**
 * Local fallback parser. Accepts (in priority order):
 *   1. `notionless-pair:v1.<base64url(JSON(PairingPayload))>` (preferred — carries
 *      deviceId + expiresAt) — and the `notionless://pair#v1.<…>` deep-link form.
 *   2. A bare team link / code (`notionless-team:<key>` or a `#team=` URL) — degrades
 *      gracefully: no deviceId, no expiry.
 * Returns normalized creds `{ teamRootKey, teamId?, teamName?, deviceId?, deviceName?,
 * suggestedUsername?, parentUsername?, expiresAt? }` or null.
 */
function parseLocally(raw, parseTeamCode) {
  const text = String(raw || '').trim()
  if (!text) return null

  // 1) Pairing payload (notionless-pair:v1.<b64> or notionless://pair#v1.<b64>)
  let encoded = null
  if (text.startsWith(PAIR_PREFIX)) {
    encoded = text.slice(PAIR_PREFIX.length).trim()
  } else {
    const m = text.match(/[#?&]?v1\.([A-Za-z0-9_-]+)/)
    if (m && /pair/i.test(text)) encoded = `v1.${m[1]}`
  }
  if (encoded && encoded.startsWith('v1.')) {
    const payload = decodePayload(encoded.slice('v1.'.length))
    if (payload && payload.teamRootKey) {
      return {
        teamRootKey: String(payload.teamRootKey),
        teamId: payload.teamId || null,
        teamName: payload.teamName || null,
        deviceId: payload.deviceId || null,
        deviceName: payload.deviceName || null,
        suggestedUsername: payload.suggestedUsername || null,
        parentUsername: payload.parentUsername || null,
        expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : null,
      }
    }
    return null
  }

  // 2) Plain team link / code — graceful degrade (no deviceId / expiry).
  const rootKey =
    (parseTeamCode && parseTeamCode(text)) ||
    (/^[A-Za-z0-9_-]{16,}$/.test(text) ? text : null)
  if (rootKey) {
    return {
      teamRootKey: rootKey,
      teamId: null,
      teamName: null,
      deviceId: null,
      deviceName: null,
      suggestedUsername: null,
      parentUsername: null,
      expiresAt: null,
    }
  }
  return null
}

/**
 * Parse a pasted pairing link / code into companion credentials. Prefers the
 * canonical `device-link.js` parser; falls back to the local parser (reusing the
 * real `parseTeamCode`). Also enforces `expiresAt` here so an expired link is
 * rejected before anything is persisted.
 *
 * @returns {Promise<{ creds: object|null, error: string|null }>}
 */
export async function parsePairingInput(raw) {
  const text = String(raw || '').trim()
  if (!text) return { creds: null, error: 'Paste a pairing link or code first.' }

  let creds = null
  const { parse, verify } = await loadCanonical()
  if (parse) {
    try {
      const out = await parse(text)
      // Normalize: the canonical parser may return the raw payload or { teamRootKey }.
      if (out && out.teamRootKey) creds = out
    } catch (_e) {
      creds = null
    }
  }
  if (!creds) {
    const { parseTeamCode } = await import('../src/p2p')
    creds = parseLocally(text, parseTeamCode)
  }

  if (!creds || !creds.teamRootKey) {
    return { creds: null, error: "That doesn't look like a Notionless pairing link." }
  }

  // Cryptographic verification (when device-link is present): re-derive teamId
  // from the secret so a tampered teamId hint is rejected, and enforce expiry on
  // the canonical path too. We then trust the DERIVED teamId, never the hint —
  // bootCompanion seeds the team from it. Falls back to the structural expiry
  // check below when the verifier isn't available.
  if (verify) {
    let res = null
    try { res = await verify(creds) } catch (_e) { res = null }
    if (res && res.reason === 'expired') {
      return { creds: null, error: 'This pairing link has expired. Ask the desktop to generate a fresh one.' }
    }
    if (res && res.reason === 'team-id-mismatch') {
      return { creds: null, error: 'This pairing link looks tampered (its team id doesn’t match). Ask the desktop for a fresh one.' }
    }
    if (res && res.ok && res.teamId) creds = { ...creds, teamId: res.teamId }
  }

  if (creds.expiresAt && Date.now() > creds.expiresAt) {
    return {
      creds: null,
      error: 'This pairing link has expired. Ask the desktop to generate a fresh one.',
    }
  }
  return { creds, error: null }
}

// ── Styles (mirrors team-dialogs.css conventions, tuned for full-screen mobile) ──

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('mobile-link-styles')) return
  const s = document.createElement('style')
  s.id = 'mobile-link-styles'
  s.textContent = `
  .ml-screen { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: #fff; color: #222; z-index: 12000; padding: max(24px, env(safe-area-inset-top)) 22px max(24px, env(safe-area-inset-bottom)); box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; overflow-y: auto; }
  .ml-card { width: 100%; max-width: 420px; }
  .ml-logo { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
  .ml-tag { font-size: 13px; color: #888; margin: 0 0 28px; line-height: 1.5; }
  .ml-h { font-size: 18px; font-weight: 650; margin: 0 0 6px; }
  .ml-sub { font-size: 13px; color: #888; line-height: 1.5; margin: 0 0 18px; }
  .ml-field { margin-bottom: 12px; }
  .ml-field label { display: block; font-size: 11px; font-weight: 600; color: #666; margin-bottom: 5px; text-transform: uppercase; letter-spacing: .03em; }
  .ml-field input, .ml-field textarea { width: 100%; box-sizing: border-box; padding: 13px 12px; border: 1px solid #e0e0e0; border-radius: 9px;
    font-size: 16px; /* ≥16px avoids iOS zoom-on-focus */ font-family: inherit; resize: none; }
  .ml-field textarea { min-height: 74px; line-height: 1.4; }
  .ml-field input:focus, .ml-field textarea:focus { outline: none; border-color: #2383e2; }
  .ml-row { display: flex; gap: 8px; }
  .ml-btn { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 50px; padding: 0 18px; border-radius: 10px;
    border: 1px solid #e0e0e0; background: #fff; color: #222; cursor: pointer; font-size: 15px; font-weight: 550; font-family: inherit; flex: 1;
    -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .ml-btn.primary { background: #2383e2; border-color: #2383e2; color: #fff; }
  .ml-btn:disabled { opacity: .55; cursor: default; }
  .ml-btn.ghost { flex: 0 0 auto; }
  .ml-spinner { display: inline-block; width: 15px; height: 15px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: ml-spin .7s linear infinite; }
  @keyframes ml-spin { to { transform: rotate(360deg); } }
  .ml-error { color: #d83a3a; font-size: 13px; margin-top: 10px; min-height: 18px; line-height: 1.4; }
  .ml-note { margin-top: 22px; padding: 12px 14px; background: #fbf6ec; border: 1px solid #f0e2c4; border-radius: 9px;
    font-size: 12px; color: #8a6d2f; line-height: 1.5; }
  .ml-note b { color: #6f561f; }
  .ml-deferred { margin-top: 14px; font-size: 12px; color: #aaa; text-align: center; }
  `
  document.head.appendChild(s)
}

// ── The Link screen ──────────────────────────────────────────────────────────────

/**
 * Render the full-screen Link UI. Calls `onLinked(creds)` once the user pastes a
 * valid (non-expired) pairing link / code. The caller persists the creds and boots.
 *
 * @param {object}   opts
 * @param {(creds:object)=>(Promise<void>|void)} opts.onLinked  invoked with verified creds
 * @param {HTMLElement} [opts.mount]  where to attach (defaults to document.body)
 * @returns {{ destroy: () => void }}
 */
export function showLinkScreen({ onLinked, mount } = {}) {
  injectStyles()
  const parent = mount || document.body

  const linkInput = el('textarea', {
    id: 'ml-link-input',
    placeholder: 'notionless-pair:v1.…  (or a team link / code)',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: false,
  })
  const errEl = el('div', { className: 'ml-error', role: 'alert' })

  const pasteBtn = el('button', { className: 'ml-btn ghost', type: 'button' }, [
    document.createTextNode('Paste'),
  ])
  const linkBtn = el('button', { className: 'ml-btn primary', type: 'button' }, [
    document.createTextNode('Link this device'),
  ])

  const card = el('div', { className: 'ml-card' }, [
    el('h1', { className: 'ml-logo' }, ['Notionless']),
    el('p', { className: 'ml-tag' }, [
      'Mobile companion — a paired leaf of your team. It stays locked until you link it from a desktop.',
    ]),
    el('h2', { className: 'ml-h' }, ['Link this device']),
    el('p', { className: 'ml-sub' }, [
      'On a desktop where the team is open, choose “Link a device” and paste the pairing link or short code here.',
    ]),
    el('div', { className: 'ml-field' }, [
      el('label', { htmlFor: 'ml-link-input' }, ['Pairing link or code']),
      linkInput,
    ]),
    el('div', { className: 'ml-row' }, [pasteBtn, linkBtn]),
    errEl,
    el('div', { className: 'ml-note' }, [
      el('b', {}, ['Treat this link like a key. ']),
      document.createTextNode(
        'It grants full access to the workspace, can’t be revoked, and is only safe for ~72h. Share it over a trusted channel — pairing a phone is as trust-significant as inviting a person.',
      ),
    ]),
    el('div', { className: 'ml-deferred' }, ['QR scanning is coming soon.']),
  ])

  const screen = el('div', { className: 'ml-screen' }, [card])
  parent.appendChild(screen)

  let busy = false
  const setError = (msg) => {
    errEl.textContent = msg || ''
  }

  const tryPaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        linkInput.value = text.trim()
        setError('')
      }
    } catch (_e) {
      setError('Couldn’t read the clipboard. Paste the link into the box manually.')
    }
  }

  const submit = async () => {
    if (busy) return
    setError('')
    const raw = linkInput.value.trim()
    const { creds, error } = await parsePairingInput(raw)
    if (!creds) {
      setError(error)
      return
    }
    busy = true
    linkBtn.disabled = true
    pasteBtn.disabled = true
    linkBtn.textContent = ''
    linkBtn.appendChild(el('span', { className: 'ml-spinner' }))
    linkBtn.appendChild(document.createTextNode(' Linking…'))
    try {
      await onLinked(creds)
      // On success the caller tears this screen down + boots; nothing more to do.
    } catch (e) {
      busy = false
      linkBtn.disabled = false
      pasteBtn.disabled = false
      linkBtn.textContent = 'Link this device'
      setError(`Couldn’t link: ${(e && e.message) || e}`)
    }
  }

  pasteBtn.addEventListener('click', tryPaste)
  linkBtn.addEventListener('click', submit)
  linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  })

  return {
    destroy() {
      screen.remove()
    },
  }
}
