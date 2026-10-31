// Runs independently of the editor: preparing the offline shell must not wait
// for a relay, team unlock, or a large document to load.
const appRoot = new URL('./', document.baseURI)
const panel = document.createElement('details')
panel.id = 'paperus-offline'
panel.innerHTML = `
  <summary aria-label="Connection status"><span data-status>Online</span></summary>
  <div class="offline-info">
    <strong>Paperus offline</strong>
    <p data-info>Downloading the app to this device…</p>
    <p data-sync>Note synchronization starts when a team connects.</p>
    <p>Previously downloaded notes are available offline. Open important notes before disconnecting. Edits merge when the server is reachable again.</p>
    <p>On iPhone: Safari → Share → Add to Home Screen. Launch from the icon and check offline availability in this panel.</p>
    <p>Do not clear website data: it contains local notes and access to your teams.</p>
    <button type="button" data-update hidden>Open updated version</button>
    <button type="button" data-retry hidden>Retry</button>
  </div>`
const style = document.createElement('style')
style.textContent = `
  #paperus-offline{position:fixed;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));z-index:9990;font:12px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;color:#27352f}
  #paperus-offline summary{list-style:none;cursor:pointer;background:#f3faf5;border:1px solid #bad6c4;border-radius:18px;padding:6px 12px;box-shadow:0 2px 8px #0001;max-width:80vw}
  #paperus-offline summary::-webkit-details-marker{display:none}
  #paperus-offline[data-disconnected] summary{background:#fff6dc;border-color:#dfc272}
  #paperus-offline .offline-info{position:absolute;bottom:40px;right:0;width:min(310px,calc(100vw - 44px));max-height:65dvh;overflow:auto;padding:16px;background:#fff;border:1px solid #d5ded8;border-radius:12px;box-shadow:0 8px 30px #0002}
  #paperus-offline p{margin:10px 0;font-size:13px}
  #paperus-offline button{font:inherit;font-size:14px;padding:10px;margin-top:6px;border:1px solid #b2c7b9;background:#eef6f0;border-radius:8px;cursor:pointer}
  .mobile-sidebar-dismiss{display:none}
  @media(max-width:700px){
    body.is-web{position:fixed;inset:0;min-height:0;height:100%;overscroll-behavior:none}
    body.is-web #app{position:fixed;top:var(--paperus-viewport-top,0px);height:var(--paperus-viewport-height,100dvh)}
    body.is-web .window-layout{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
    body.is-web .wrapper{position:relative;min-height:0}
    body.is-web .main{height:100%}
    body.is-web #sidebar:not(.collapsed){position:absolute;z-index:5000;inset:0 auto 0 0;width:min(86vw,320px)!important;min-width:0!important;max-width:none;box-shadow:8px 0 28px #0002}
    body.is-web #sidebar:not(.collapsed) ~ .mobile-sidebar-dismiss{display:block;position:absolute;inset:0;width:100%;height:100%;z-index:4999;border:0;padding:0;background:transparent;touch-action:manipulation}
    body.is-web .sidebar-header-area{padding-left:8px}
    body.is-web aside{transition:none}
    body.is-web .traffic-lights-spacer.collapsed-only{width:0!important}
    body.is-web #sidebar-expand-btn{display:flex!important}
    body.is-web .editor-container{height:auto;min-height:0;flex:1}
    body.is-web .document-title-wrapper{padding:24px 20px 0}
    body.is-web #editor .cm-content{padding:16px 20px 80px!important}
    body.is-web input:not([type=checkbox]):not([type=radio]),body.is-web textarea{font-size:16px}
    body.is-web .td-box{max-width:calc(100vw - 28px)}
  }
`
document.head.appendChild(style)
document.body.appendChild(panel)
function fitViewport() {
  document.documentElement.style.setProperty('--paperus-viewport-height', `${window.visualViewport?.height || innerHeight}px`)
  document.documentElement.style.setProperty('--paperus-viewport-top', `${window.visualViewport?.offsetTop || 0}px`)
}
window.visualViewport?.addEventListener('resize', fitViewport)
window.visualViewport?.addEventListener('scroll', fitViewport)
// Safari can leave the layout viewport scrolled after its keyboard Done button.
// Reset only the outer page; the note's own scroll position remains untouched.
function restorePageOrigin() {
  if (!window.matchMedia('(max-width:700px)').matches) return
  const active = document.activeElement
  if (active?.matches('input,textarea,select,[contenteditable=true]') || active?.isContentEditable) return
  window.scrollTo(0, 0)
  fitViewport()
}
document.addEventListener('focusout', () => {
  for (const delay of [0, 150, 400]) setTimeout(restorePageOrigin, delay)
})
window.addEventListener('scroll', () => requestAnimationFrame(restorePageOrigin), { passive: true })
window.addEventListener('resize', fitViewport)
fitViewport()
const status = panel.querySelector('[data-status]')
const info = panel.querySelector('[data-info]')
const updateButton = panel.querySelector('[data-update]')
const retryButton = panel.querySelector('[data-retry]')
const syncInfo = panel.querySelector('[data-sync]')
const teamSync = new Map()
window.addEventListener('team:background-sync', event => {
  teamSync.set(event.detail.teamId, event.detail)
  const states = [...teamSync.values()]
  const total = states.reduce((n, s) => n + s.total, 0)
  const done = states.reduce((n, s) => n + s.completed, 0)
  const errors = states.reduce((n, s) => n + s.failed, 0)
  const skipped = states.reduce((n, s) => n + (s.skipped || 0), 0)
  syncInfo.textContent = states.some(s => s.running)
    ? `Background sync: ${done}/${total} notes. Keep the app open.`
    : errors || done + skipped < total ? 'Sync is incomplete. Retrying when the server is reachable.'
      : skipped ? `Synced ${done} closed notes. Open notes are handled by the editor.`
        : `Background sync complete: ${done} notes. No need to open each one.`
})
let ready = false
let connected = navigator.onLine
let failed = false
let registration
let storageFailed = false

function render() {
  panel.toggleAttribute('data-disconnected', !connected)
  status.textContent = connected ? 'Online' : 'Offline'
  info.textContent = failed
    ? 'Offline setup failed. Check the connection and available storage, then retry.'
    : !ready ? 'Downloading app files. Keep this page open until setup completes.'
      : connected ? 'The app is stored on this device. The server is reachable.'
        : 'The server is unreachable. Using data stored on this device.'
  retryButton.hidden = !failed
  if (storageFailed) info.textContent = 'Local note storage is unavailable. Keep unsaved changes open and check free space and website storage permissions.'
}

async function persistStorage() {
  try { await navigator.storage?.persist?.() } catch (_) { /* best effort on iOS */ }
}
panel.addEventListener('toggle', () => { if (panel.open) persistStorage() })

let checking = false
async function checkConnection() {
  if (checking) return
  checking = true
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(new URL('health', appRoot), { cache: 'no-store', signal: controller.signal })
    connected = response.ok && (await response.json()).status === 'ok'
  } catch (_) { connected = false }
  finally { clearTimeout(timeout); checking = false; render() }
}
window.addEventListener('offline', () => { connected = false; render() })
window.addEventListener('online', checkConnection)
window.addEventListener('offline:storage-error', () => { storageFailed = true; render() })
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkConnection() })
setInterval(() => { if (!document.hidden) checkConnection() }, 30000)

async function prepare() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    failed = true
    render()
    return
  }
  try {
    failed = false
    render()
    registration = await navigator.serviceWorker.register(new URL('sw.js', appRoot), { scope: appRoot.href, updateViaCache: 'none' })
    const showUpdate = () => { updateButton.hidden = !registration.waiting }
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') showUpdate()
        if (worker.state === 'redundant' && !ready) { failed = true; render() }
      })
    })
    showUpdate()
    await navigator.serviceWorker.ready
    ready = true
    render()
    await persistStorage()
  } catch (error) {
    console.warn('[Offline] Preparation failed', error)
    failed = true
    render()
  }
}
updateButton.addEventListener('click', () => {
  if (!registration?.waiting) return
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
  registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' })
})
retryButton.addEventListener('click', prepare)
prepare()
checkConnection()
