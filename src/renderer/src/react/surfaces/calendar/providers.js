// providers.js — CalDAV presets for the CalAccountWizard + small pure helpers.
//
// Mirrors email/providers.js: plain data + string utilities, no imports and no
// side-effects, so it can be pulled into any calendar/* island without dragging
// React or the host in.
//
// Each preset auto-fills the connection fields. `appPassword` flags providers
// that reject account passwords over CalDAV and need an app-specific one;
// `help` is shown verbatim under the form. `usernameIsEmail` controls whether we
// pre-fill the username from the typed address. `disabled` renders a greyed-out
// "coming soon" card with no functional path (Google OAuth lands in a later
// phase). `server` is the CalDAV base URL; for `generic` the user types it.

// Brand marks for the provider picker, sized to sit centered on a white tile
// (see .pp-provider-logo in island.css). iCloud + Google are their real marks;
// Fastmail + generic use clean on-brand glyphs. Apple's mark stands in for the
// iCloud calendar (it's the recognisable CalDAV face for Apple users).
const LOGOS = {
  icloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#111" d="M16.36 12.9c-.02-2.04 1.67-3.02 1.74-3.07-0.95-1.39-2.43-1.58-2.95-1.6-1.26-.13-2.45.74-3.09.74-.63 0-1.62-.72-2.66-.7-1.37.02-2.63.8-3.34 2.03-1.42 2.47-.36 6.12 1.02 8.12.67.98 1.48 2.08 2.54 2.04 1.02-.04 1.4-.66 2.64-.66 1.23 0 1.58.66 2.66.64 1.1-.02 1.79-1 2.46-1.98.77-1.13 1.09-2.23 1.11-2.29-.02-.01-2.13-.82-2.15-3.24zM14.33 6.9c.56-.68.94-1.62.83-2.56-.81.03-1.79.54-2.37 1.22-.52.6-.97 1.56-.85 2.48.9.07 1.83-.46 2.39-1.14z"/></svg>',
  fastmail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.75" width="18" height="14.5" rx="2.6" fill="#2C6BED"/><path d="M7 9.25h10M7 12h10M7 14.75h6" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>',
  generic: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><rect x="3.75" y="4.75" width="16.5" height="15" rx="2.4" stroke="#64748B" stroke-width="1.6"/><path d="M3.75 8.75h16.5" stroke="#64748B" stroke-width="1.6"/><path d="M8 3.5v3M16 3.5v3" stroke="#64748B" stroke-width="1.6" stroke-linecap="round"/><rect x="7" y="11.5" width="3" height="3" rx="0.7" fill="#64748B"/></svg>',
  google: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4.5" width="16" height="15" rx="2.4" fill="#fff" stroke="#E0E0E0" stroke-width="1"/><path d="M4 8.5h16" stroke="#E0E0E0" stroke-width="1"/><path d="M8 3.5v3M16 3.5v3" stroke="#5F6368" stroke-width="1.6" stroke-linecap="round"/><path fill="#4285F4" d="M10.1 14.7c.27.5.83.9 1.62.9.93 0 1.55-.55 1.55-1.27 0-.78-.66-1.18-1.5-1.18h-.45v-.86h.42c.74 0 1.27-.38 1.27-1.05 0-.6-.5-1.02-1.24-1.02-.7 0-1.2.34-1.45.83l-.78-.46c.4-.74 1.2-1.25 2.25-1.25 1.3 0 2.23.74 2.23 1.83 0 .73-.42 1.24-1 1.5.7.24 1.18.82 1.18 1.66 0 1.16-1 1.97-2.46 1.97-1.2 0-2.07-.56-2.4-1.36z"/></svg>',
}

export const PROVIDERS = {
  icloud: {
    id: 'icloud',
    label: 'iCloud',
    desc: 'Apple iCloud Calendar',
    logo: LOGOS.icloud,
    server: 'https://caldav.icloud.com',
    usernameIsEmail: true,
    appPassword: true,
    help:
      'iCloud Calendar requires an app-specific password. At appleid.apple.com → '
      + 'Sign-In and Security → App-Specific Passwords, generate one and paste it '
      + 'below. Your username is your full @icloud.com address.',
    helpUrl: 'https://support.apple.com/en-us/102654',
  },
  fastmail: {
    id: 'fastmail',
    label: 'Fastmail',
    desc: 'Fastmail Calendar (CalDAV)',
    logo: LOGOS.fastmail,
    server: 'https://caldav.fastmail.com',
    usernameIsEmail: true,
    appPassword: true,
    help:
      'Create a dedicated app password in Fastmail (Settings → Privacy & Security '
      + '→ App Passwords) scoped to "Calendars (CalDAV)" and use it below.',
    helpUrl: 'https://app.fastmail.com/settings/security/apppassword',
  },
  generic: {
    id: 'generic',
    label: 'Other (CalDAV)',
    desc: 'Any CalDAV server',
    logo: LOGOS.generic,
    server: '',
    usernameIsEmail: false,
    appPassword: true,
    help:
      'Enter the CalDAV URL from your provider (often ends in /dav/ or '
      + '/.well-known/caldav), plus your username and an app-specific password if '
      + 'the host requires one.',
    helpUrl: '',
  },
  google: {
    id: 'google',
    label: 'Google',
    desc: 'Google Calendar — coming soon',
    logo: LOGOS.google,
    server: '',
    usernameIsEmail: true,
    appPassword: false,
    disabled: true, // OAuth path lands in a later phase; no functional connect
    comingSoon: 'Google Calendar uses OAuth and is coming in a later update.',
    help: '',
    helpUrl: '',
  },
}

export const PROVIDER_ORDER = ['icloud', 'fastmail', 'generic', 'google']

// A small, non-cryptographic palette so each calendar/account gets a stable
// accent. Deliberately no pink — cool/neutral hues only (matches email).
export const ACCOUNT_COLORS = [
  '#3b82f6', // blue
  '#0ea5e9', // sky
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#64748b', // slate
  '#8b5cf6', // violet
  '#22c55e', // green
  '#f59e0b', // amber
]

export function colorForSeed(seed) {
  const s = String(seed || '')
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return ACCOUNT_COLORS[h % ACCOUNT_COLORS.length]
}

// Build a CalDAV connection config from form state + the chosen preset. Shape
// matches the calendar:accountTest / calendar:accountAdd IPC contract.
export function buildConfig(form) {
  return {
    name: (form.name || '').trim() || (form.email || '').trim(),
    provider: form.provider || 'generic',
    server: (form.server || '').trim(),
    username: (form.username || form.email || '').trim(),
    password: form.password || '',
    color: form.color || colorForSeed(form.email || form.username),
  }
}

// Cheap RFC-ish email sanity check — enough to gate, not to validate delivery.
export function looksLikeEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim())
}

// Cheap http(s) URL sanity check for the generic CalDAV server field.
export function looksLikeUrl(v) {
  return /^https?:\/\/[^\s]+$/i.test(String(v || '').trim())
}

// Is the form complete enough to attempt a connection test? Generic providers
// need an explicit server URL + a username; presets fill the server and use the
// email as username, so an email + password is enough.
export function configComplete(form) {
  const hasServer = looksLikeUrl(form.server)
  const hasUser = String(form.username || form.email || '').trim().length > 0
  const hasPw = String(form.password || '').length > 0
  if ((form.provider || 'generic') === 'generic') {
    return hasServer && hasUser && hasPw
  }
  return looksLikeEmail(form.email) && hasServer && hasUser && hasPw
}
