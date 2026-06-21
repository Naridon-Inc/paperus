// First-run onboarding for Paperus.
//
// Zero-account, local-first apps have no sign-up to anchor a first impression,
// so a brand-new user historically dropped straight into an empty editor. This
// module adds ONE welcoming screen that names the product and offers the three
// things you can actually do on first launch: start writing locally, create a
// peer-to-peer team, or join one from an invite link. It overlays the normal
// empty state (which stays mounted underneath), so dismissing it reveals the
// usual workspace with nothing lost.
//
// It is shown exactly once — gated on the `notionless_onboarded` flag (an
// internal localStorage key; the brand rename deliberately leaves storage keys
// untouched for continuity) — and never when the app was opened via an invite
// deep link (that flow takes over) or for an existing user (a saved project or
// any joined team means they're past first run).

import { sparkIcon } from './brain-service-logos'

const ONBOARDED_KEY = 'notionless_onboarded'

export function hasOnboarded() {
  try { return localStorage.getItem(ONBOARDED_KEY) === '1' } catch (_e) { return false }
}

export function markOnboarded() {
  try { localStorage.setItem(ONBOARDED_KEY, '1') } catch (_e) { /* private mode / no storage */ }
}

let _stylesInjected = false
function injectStyles() {
  if (_stylesInjected) return
  _stylesInjected = true
  const style = document.createElement('style')
  style.id = 'paperus-onboarding-styles'
  style.textContent = `
    .pob-overlay {
      position: fixed; inset: 0; z-index: 99999;
      display: flex; align-items: center; justify-content: center; padding: 24px;
      background: rgba(18, 20, 26, 0.46);
      -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px);
      opacity: 0; transition: opacity .22s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .pob-overlay.pob-in { opacity: 1; }
    .pob-card {
      width: 100%; max-width: 540px; background: #fff; border-radius: 18px;
      padding: 40px 40px 28px; box-sizing: border-box;
      box-shadow: 0 24px 70px rgba(16, 18, 27, .28), 0 2px 8px rgba(16, 18, 27, .10);
      transform: translateY(10px) scale(.99); transition: transform .24s cubic-bezier(.2,.8,.2,1);
    }
    .pob-overlay.pob-in .pob-card { transform: translateY(0) scale(1); }
    .pob-brand { display: flex; align-items: center; gap: 11px; margin-bottom: 6px; }
    .pob-spark {
      display: flex; align-items: center; justify-content: center;
      width: 38px; height: 38px; border-radius: 11px;
      background: linear-gradient(150deg, #eef4ff, #e3ecff);
      color: var(--accent, #2f6bff); flex: none;
    }
    .pob-spark svg { width: 22px; height: 22px; }
    .pob-wordmark { font-size: 25px; font-weight: 650; letter-spacing: -.02em; color: #16181b; }
    .pob-tagline { font-size: 14px; line-height: 1.5; color: #6b7177; margin: 2px 0 24px; }
    .pob-options { display: flex; flex-direction: column; gap: 10px; }
    .pob-opt {
      display: flex; align-items: center; gap: 14px; width: 100%; text-align: left;
      padding: 15px 16px; border: 1px solid #e7e9ee; border-radius: 12px;
      background: #fcfcfd; cursor: pointer; transition: border-color .15s, background .15s, transform .05s;
      font-family: inherit;
    }
    .pob-opt:hover { border-color: var(--accent, #2f6bff); background: #f6f9ff; }
    .pob-opt:active { transform: translateY(1px); }
    .pob-opt-ico {
      flex: none; width: 38px; height: 38px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      background: #eef1f6; color: #4a5560; font-size: 16px;
    }
    .pob-opt:hover .pob-opt-ico { background: #e6efff; color: var(--accent, #2f6bff); }
    .pob-opt-body { flex: 1; min-width: 0; }
    .pob-opt-title { font-size: 14.5px; font-weight: 600; color: #1c1f24; }
    .pob-opt-sub { font-size: 12.5px; color: #8a9099; margin-top: 2px; line-height: 1.4; }
    .pob-opt-chev { color: #c3c8d0; font-size: 13px; flex: none; }
    .pob-opt:hover .pob-opt-chev { color: var(--accent, #2f6bff); }
    .pob-footer {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 22px; padding-top: 16px; border-top: 1px solid #f0f1f4;
    }
    .pob-assure { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #9aa0a8; }
    .pob-assure svg { width: 12px; height: 12px; color: #b6bcc4; }
    .pob-skip {
      background: none; border: none; cursor: pointer; font-family: inherit;
      font-size: 12.5px; color: #8a9099; padding: 4px 6px; border-radius: 6px;
    }
    .pob-skip:hover { color: #4a5560; background: #f2f3f6; }
    @media (prefers-color-scheme: dark) {
      .pob-card { background: #1c1e24; box-shadow: 0 24px 70px rgba(0,0,0,.55); }
      .pob-wordmark { color: #f2f3f5; }
      .pob-tagline { color: #9aa1ab; }
      .pob-opt { background: #232630; border-color: #2f333d; }
      .pob-opt:hover { background: #262b38; }
      .pob-opt-ico { background: #2c303b; color: #aeb6c2; }
      .pob-opt-title { color: #eceef1; }
      .pob-spark { background: #232a3a; }
      .pob-footer { border-top-color: #2a2d36; }
    }
  `
  document.head.appendChild(style)
}

/**
 * Render the welcome overlay. Each action marks onboarding complete, animates
 * the overlay out, removes it, then runs its handler. Returns nothing.
 *
 * @param {Object} h handlers: onStartWriting, onCreateTeam, onJoinTeam, onSkip
 */
export function showOnboarding(h = {}) {
  injectStyles()
  if (document.querySelector('.pob-overlay')) return

  const overlay = document.createElement('div')
  overlay.className = 'pob-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Welcome to Paperus')

  const chev = '<i class="fas fa-chevron-right pob-opt-chev"></i>'
  overlay.innerHTML = `
    <div class="pob-card">
      <div class="pob-brand">
        <span class="pob-spark">${sparkIcon()}</span>
        <span class="pob-wordmark">Paperus</span>
      </div>
      <div class="pob-tagline">Your notes, your way — local-first, end-to-end encrypted, and no account to create. Pick a way to start.</div>
      <div class="pob-options">
        <button class="pob-opt" data-act="write">
          <span class="pob-opt-ico"><i class="fas fa-pen-nib"></i></span>
          <span class="pob-opt-body">
            <span class="pob-opt-title">Start writing</span>
            <span class="pob-opt-sub">Open a folder of notes on this device and start a fresh page.</span>
          </span>${chev}
        </button>
        <button class="pob-opt" data-act="create">
          <span class="pob-opt-ico"><i class="fas fa-users"></i></span>
          <span class="pob-opt-body">
            <span class="pob-opt-title">Create a team</span>
            <span class="pob-opt-sub">Spin up a shared, peer-to-peer workspace and invite people with one link.</span>
          </span>${chev}
        </button>
        <button class="pob-opt" data-act="join">
          <span class="pob-opt-ico"><i class="fas fa-link"></i></span>
          <span class="pob-opt-body">
            <span class="pob-opt-title">Join with a link</span>
            <span class="pob-opt-sub">Got an invite? Paste it and you're in — no sign-up needed.</span>
          </span>${chev}
        </button>
      </div>
      <div class="pob-footer">
        <span class="pob-assure">${sparkIcon()} Local-first · encrypted · no account, ever</span>
        <button class="pob-skip" data-act="skip">Skip for now</button>
      </div>
    </div>
  `

  const close = (cb) => {
    markOnboarded()
    overlay.classList.remove('pob-in')
    const done = () => { overlay.remove(); if (typeof cb === 'function') cb() }
    setTimeout(done, 230)
  }

  overlay.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-act]')
    // Clicking the dimmed backdrop (outside the card) counts as "skip".
    if (!opt) { if (e.target === overlay) close(h.onSkip); return }
    const act = opt.getAttribute('data-act')
    if (act === 'write') close(h.onStartWriting)
    else if (act === 'create') close(h.onCreateTeam)
    else if (act === 'join') close(h.onJoinTeam)
    else close(h.onSkip)
  })

  const onKey = (e) => {
    if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(h.onSkip) }
  }
  document.addEventListener('keydown', onKey)

  document.body.appendChild(overlay)
  // Next frame so the fade/rise transition actually runs.
  requestAnimationFrame(() => overlay.classList.add('pob-in'))
}

let _considered = false

/**
 * Decide whether this is a genuine first run and, if so, show the welcome
 * overlay. Safe to call once after the P2P team manager has loaded.
 *
 * @param {Object} o
 * @param {boolean} o.isWeb            running the web build (no native FS)
 * @param {boolean} o.hasTeams        the user already has ≥1 joined team
 * @param {boolean} o.hasProject      a saved local workspace/project exists
 * @param {boolean} o.hadDeepLink     app was opened via an invite/share link
 * @param {Object}  o.handlers        onStartWriting / onCreateTeam / onJoinTeam / onSkip
 * @returns {boolean} whether the overlay was shown
 */
export function maybeShowOnboarding(o = {}) {
  if (_considered) return false
  _considered = true
  // A link-launch hands off to the join/share flow; never compete with it.
  if (o.hadDeepLink) { markOnboarded(); return false }
  if (hasOnboarded()) return false
  // Existing user (has a workspace or a team) — past first run; don't nag.
  if (o.hasTeams || o.hasProject) { markOnboarded(); return false }
  showOnboarding(o.handlers || {})
  return true
}
