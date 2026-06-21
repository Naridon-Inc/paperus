// server-config.js — connect the app to your TEAM'S OWN self-hosted server.
//
// By default every client (desktop, web, mobile) brokers peers through Naridon's
// free global relay at oss.naridon.com. A team that self-hosts the bundle gets
// their OWN signaling relay (and, with the full-online bundle, an always-on
// encrypted store). This module is the in-app, runtime, team-managed switch that
// points the app at that server — no rebuild, and once connected nothing depends
// on Naridon at all. Until a team connects, the free Naridon relay is the fallback.
//
// It writes a single localStorage key (`notionless_server_url`) that config.js
// reads to derive BOTH the WebRTC signaling path (`/signaling`) and the optional
// always-on relay path (`/yjs`). The always-on checkbox reuses the existing
// per-client opt-out flag (`notionless_cloud_sync_disabled`) that p2p.js honors.
// Pure DOM, no framework — matches the rest of the renderer (cf. cloud-sync.js).
import { Config } from './config'

const SERVER_KEY = 'notionless_server_url'
const CLOUD_DISABLED_KEY = 'notionless_cloud_sync_disabled'
const NARIDON_HOST = 'oss.naridon.com'

function lsGet(key) {
  try { return (typeof localStorage !== 'undefined' && localStorage.getItem(key)) || '' } catch (_e) { return '' }
}
function lsSet(key, val) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, val) } catch (_e) { /* ignore */ }
}
function lsDel(key) {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key) } catch (_e) { /* ignore */ }
}

// The raw team-server URL the user configured (empty when on Naridon's relay).
export function getServerUrl() { return lsGet(SERVER_KEY) }

// True once a team has pointed this client at their own server.
export function isCustomServer() { return !!getServerUrl() }

// Whether the always-on encrypted relay (`/yjs`) is in use for this client.
export function alwaysOnEnabled() { return lsGet(CLOUD_DISABLED_KEY) !== '1' }

// A short host label for the server currently in effect, for the UI.
export function currentServerHost() {
  const raw = getServerUrl()
  if (!raw) return NARIDON_HOST
  try { return new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).host } catch (_e) { return raw }
}

// The effective signaling URL config.js will actually use (for display/debug).
export function effectiveSignalingUrl() {
  try { return String((Config && Config.SIGNALING_URL) || '') } catch (_e) { return '' }
}

// Normalize user input into a stored origin. Accepts `host`, `host:port`,
// `https://host`, `http://host`, `wss://host`. Returns '' if it can't be parsed
// into something with a host. We store an http(s) origin and let config.js map it
// to ws(s) for the sockets — keeping one canonical form.
export function normalizeServerUrl(raw) {
  let v = String(raw || '').trim().replace(/\/+$/, '')
  if (!v) return ''
  // ws(s):// → http(s):// for storage; the realtime mapping happens in config.js.
  if (/^wss:\/\//i.test(v)) v = v.replace(/^wss/i, 'https')
  else if (/^ws:\/\//i.test(v)) v = v.replace(/^ws/i, 'http')
  else if (!/^https?:\/\//i.test(v)) v = `https://${v}` // bare host → assume TLS
  try {
    const u = new URL(v)
    if (!u.hostname) return ''
    // Drop any path/query/hash — a server base is just origin.
    return u.origin
  } catch (_e) { return '' }
}

// Point this client at a team server. `alwaysOn` toggles the encrypted 24/7 relay
// (off ⇒ this device stays pure peer-to-peer while still using the team's relay
// for signaling). Caller reloads to rebind every open doc's providers.
export function setServer(raw, { alwaysOn = true } = {}) {
  const origin = normalizeServerUrl(raw)
  if (!origin) throw new Error('Enter a valid server address (e.g. https://notes.yourteam.com).')
  lsSet(SERVER_KEY, origin)
  if (alwaysOn) lsDel(CLOUD_DISABLED_KEY)
  else lsSet(CLOUD_DISABLED_KEY, '1')
  return origin
}

// Drop the team server and fall back to Naridon's free global relay (pure P2P).
export function useNaridon() {
  lsDel(SERVER_KEY)
  lsDel(CLOUD_DISABLED_KEY)
}

// One-shot flag, set just before the post-connect reload, that tells the freshly
// reloaded app to flash a confirmation toast (the switch is otherwise silent).
const CONNECTED_FLASH_KEY = 'notionless_server_connected_flash'

// Reachability probe: GET <origin>/health with a hard timeout. Resolves with the
// parsed body on a 2xx, throws on network error / non-2xx / timeout. A live box
// answers in well under a second; we cap the wait so a dead address fails fast.
// Note: a server that's UP but lacks permissive CORS (older build) will reject
// the browser fetch — callers must treat a throw as "couldn't confirm," not
// "definitely down," and offer a connect-anyway path.
export async function pingServer(origin, { timeoutMs = 6000 } = {}) {
  const base = normalizeServerUrl(origin)
  if (!base) throw new Error('invalid server')
  if (typeof fetch !== 'function') throw new Error('fetch unavailable')
  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetch(`${base}/health`, {
      method: 'GET', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined,
    })
    if (!res.ok) throw new Error(`server returned ${res.status}`)
    let body = null
    try { body = await res.json() } catch (_e) { /* non-JSON health is still a 2xx */ }
    return body || { status: 'ok' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// Render a transient bottom-center toast confirming the connection change. Called
// once on app load by flashConnectToastIfPending(); pure DOM, auto-dismisses.
function showServerToast({ host, alwaysOn, naridon }) {
  if (typeof document === 'undefined' || !document.body) return
  const wrap = document.createElement('div')
  wrap.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%) translateY(8px)',
    'z-index:100001', 'background:#1a1a1a', 'color:#fff', 'border-radius:10px',
    'padding:11px 15px', 'font-size:12.5px', 'line-height:1.4', 'max-width:380px',
    'box-shadow:0 10px 34px rgba(0,0,0,0.28)', 'display:flex', 'align-items:center', 'gap:10px',
    'opacity:0', 'transition:opacity .18s ease, transform .18s ease', 'pointer-events:none',
  ].join(';')
  const dot = naridon ? '#9ca3af' : (alwaysOn ? '#3b82f6' : '#3aa757')
  const title = naridon ? "Back on Naridon's free relay" : `Connected to ${esc(host)}`
  const sub = naridon
    ? 'Pure peer-to-peer — nothing stored on a server.'
    : (alwaysOn ? 'Always-on encrypted sync is on — notes stay available 24/7.'
                : 'Signaling only — this device stays pure peer-to-peer.')
  wrap.innerHTML = `
    <span style="width:9px;height:9px;border-radius:50%;background:${dot};flex-shrink:0;box-shadow:0 0 0 3px ${dot}22;"></span>
    <span><b style="font-weight:600;">${title}</b><br/><span style="color:#b8b8b8;">${sub}</span></span>`
  document.body.appendChild(wrap)
  requestAnimationFrame(() => {
    wrap.style.opacity = '1'
    wrap.style.transform = 'translateX(-50%) translateY(0)'
  })
  setTimeout(() => {
    wrap.style.opacity = '0'
    wrap.style.transform = 'translateX(-50%) translateY(8px)'
    setTimeout(() => wrap.remove(), 240)
  }, 4200)
}

// Call once during app init: if a connect/disconnect just happened, flash the
// confirmation toast and clear the flag so it shows exactly once.
export function flashConnectToastIfPending() {
  let payload = ''
  try {
    payload = lsGet(CONNECTED_FLASH_KEY)
    if (payload) lsDel(CONNECTED_FLASH_KEY)
  } catch (_e) { return }
  if (!payload) return
  let data = null
  try { data = JSON.parse(payload) } catch (_e) { data = { host: payload } }
  if (data) showServerToast(data)
}

// ── Dialog ────────────────────────────────────────────────────────────────────

let _open = null

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function openServerDialog() {
  if (_open) { _open.remove(); _open = null }

  const custom = isCustomServer()
  const curHost = currentServerHost()
  const overlay = document.createElement('div')
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.35)', 'display:flex',
    'align-items:center', 'justify-content:center', 'z-index:100000',
  ].join(';')

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:420px;max-width:92vw;padding:22px;
                box-shadow:0 12px 40px rgba(0,0,0,0.18);font-size:13px;color:#222;box-sizing:border-box;">
      <h3 style="margin:0 0 6px;font-size:17px;">Connect to your team's server</h3>
      <p style="margin:0 0 14px;color:#888;font-size:12px;line-height:1.5;">
        Point this app at a server your team runs — for peer signaling and (optionally)
        always-on encrypted sync. Once connected, nothing depends on Naridon. Until then,
        the app uses Naridon's free global relay.
      </p>

      <div style="margin-bottom:6px;font-size:11px;font-weight:600;color:#666;
                  text-transform:uppercase;letter-spacing:.03em;">Server address</div>
      <input id="sc-url" placeholder="https://notes.yourteam.com" value="${esc(getServerUrl())}"
             style="width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #e0e0e0;
                    border-radius:7px;font-size:13px;" autofocus />
      <div style="margin-top:5px;font-size:11px;color:#a1a1aa;">
        Your team's self-host domain. Signaling uses <code>/signaling</code>; always-on sync uses <code>/yjs</code>.
      </div>

      <label style="display:flex;align-items:flex-start;gap:8px;margin-top:14px;cursor:pointer;">
        <input id="sc-alwayson" type="checkbox" ${alwaysOnEnabled() ? 'checked' : ''} style="margin-top:2px;" />
        <span style="font-size:12px;color:#52525b;line-height:1.45;">
          <b>Keep my notes available 24/7</b> (always-on encrypted sync).<br/>
          <span style="color:#a1a1aa;">Needs the full self-host bundle. Uncheck for a signaling-only relay — this device stays pure peer-to-peer.</span>
        </span>
      </label>

      <div style="margin-top:12px;font-size:11px;color:#a1a1aa;">
        Currently using: <b style="color:#6b7280;">${esc(curHost)}</b>${custom ? '' : ' <span style="color:#a1a1aa;">(Naridon, free)</span>'}
      </div>
      <div id="sc-err" style="color:#d83a3a;font-size:12px;margin-top:10px;min-height:16px;"></div>

      <div style="display:flex;align-items:center;gap:8px;margin-top:14px;">
        ${custom ? `<button id="sc-reset" style="padding:8px 12px;border-radius:7px;border:1px solid #e0e0e0;
            background:#fff;cursor:pointer;font-size:12px;color:#666;">Use Naridon's free relay</button>` : ''}
        <div style="flex:1;"></div>
        <button id="sc-cancel" style="padding:8px 14px;border-radius:7px;border:1px solid #e0e0e0;
            background:#fff;cursor:pointer;font-size:13px;">Cancel</button>
        <button id="sc-connect" style="padding:8px 14px;border-radius:7px;border:1px solid #2383e2;
            background:#2383e2;color:#fff;cursor:pointer;font-size:13px;">Connect</button>
      </div>
    </div>`

  document.body.appendChild(overlay)
  _open = overlay

  const box = overlay.firstElementChild
  const urlEl = box.querySelector('#sc-url')
  const errEl = box.querySelector('#sc-err')
  const close = () => { overlay.remove(); if (_open === overlay) _open = null }

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close() })
  box.querySelector('#sc-cancel').onclick = close
  document.addEventListener('keydown', function onKey(e) {
    if (!document.body.contains(overlay)) { document.removeEventListener('keydown', onKey, true); return }
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey, true) }
  }, true)

  const connectBtn = box.querySelector('#sc-connect')
  const alwaysOnEl = box.querySelector('#sc-alwayson')

  const reset = box.querySelector('#sc-reset')
  if (reset) reset.onclick = () => {
    useNaridon()
    lsSet(CONNECTED_FLASH_KEY, JSON.stringify({ host: NARIDON_HOST, alwaysOn: false, naridon: true }))
    close()
    location.reload()
  }

  const setBusy = (busy) => {
    urlEl.disabled = busy
    connectBtn.disabled = busy
    if (alwaysOnEl) alwaysOnEl.disabled = busy
    if (reset) reset.disabled = busy
  }

  // Restore the blue "Connect" button to its validating default.
  const resetConnectBtn = () => {
    connectBtn.textContent = 'Connect'
    connectBtn.style.background = '#2383e2'
    connectBtn.style.borderColor = '#2383e2'
    connectBtn.onclick = connect
  }

  // Persist the choice, flag the post-reload toast, and reload so every open
  // doc re-binds its providers (signaling + always-on relay) to the new server.
  const commit = (origin, alwaysOn) => {
    setServer(origin, { alwaysOn })
    let host = origin
    try { host = new URL(origin).host } catch (_e) { /* keep origin */ }
    lsSet(CONNECTED_FLASH_KEY, JSON.stringify({ host, alwaysOn, naridon: false }))
    close()
    location.reload()
  }

  function connect() {
    const origin = normalizeServerUrl(urlEl.value)
    if (!origin) {
      errEl.style.color = '#d83a3a'
      errEl.textContent = 'Enter a valid server address (e.g. https://notes.yourteam.com).'
      return
    }
    const alwaysOn = !!(alwaysOnEl && alwaysOnEl.checked)
    let host = origin
    try { host = new URL(origin).host } catch (_e) { /* keep origin */ }

    setBusy(true)
    connectBtn.textContent = 'Connecting…'
    errEl.style.color = '#a1a1aa'
    errEl.textContent = `Reaching ${host}…`

    pingServer(origin)
      .then(() => {
        // Reachable — brief green confirmation, then commit + reload.
        connectBtn.textContent = 'Connected ✓'
        connectBtn.style.background = '#16a34a'
        connectBtn.style.borderColor = '#16a34a'
        errEl.style.color = '#16a34a'
        errEl.textContent = `Reached ${host}. Connecting…`
        setTimeout(() => commit(origin, alwaysOn), 650)
      })
      .catch((e) => {
        // Couldn't confirm (offline, wrong address, or CORS-blocked older build).
        // Don't dead-end: re-enable and let the user connect anyway.
        setBusy(false)
        const reason = /abort/i.test(String(e && e.name)) ? 'timed out' : "couldn't be reached"
        connectBtn.textContent = 'Connect anyway'
        connectBtn.style.background = '#f59e0b'
        connectBtn.style.borderColor = '#f59e0b'
        errEl.style.color = '#b45309'
        errEl.textContent = `${host} ${reason}. It may be offline, the address may be wrong, or it's an older server without a health check. You can connect anyway.`
        connectBtn.onclick = () => commit(origin, alwaysOn)
      })
  }

  // Editing the address after a failed probe returns to the validating Connect.
  urlEl.addEventListener('input', () => { errEl.textContent = ''; resetConnectBtn() })
  connectBtn.onclick = connect
  urlEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectBtn.onclick() })

  return overlay
}
