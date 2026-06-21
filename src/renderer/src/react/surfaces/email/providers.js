// providers.js — IMAP/SMTP presets for the AccountWizard + small pure helpers.
//
// No imports, no side-effects: this is plain data + string utilities so it can
// be pulled into any email/* island without dragging React or the host in.

// Each preset auto-fills the connection fields. `appPassword` flags providers
// that reject account passwords over IMAP/SMTP and need an app-specific one;
// `help` is shown verbatim under the form. `usernameIsEmail` controls whether we
// pre-fill the username from the typed address.
// Brand marks for the provider picker. Gmail + iCloud are their real
// multi-colour logos; Fastmail + generic use clean on-brand marks. Each is sized
// to sit centered on a white tile (see .pp-provider-logo in island.css).
const LOGOS = {
  gmail: '<svg viewBox="0 0 256 193" aria-hidden="true"><path fill="#4285F4" d="M58.18 192.05V93.14L27.5 65.07 0 49.5v130.5a12.03 12.03 0 0 0 12.03 12.03z"/><path fill="#34A853" d="M197.82 192.05h46.15A12.03 12.03 0 0 0 256 180.02V49.5l-31.13 17.8-27.05 25.84z"/><path fill="#EA4335" d="M58.18 93.14V18.96L128 70.07l69.82-51.1v74.18L128 145.7z"/><path fill="#FBBC04" d="M197.82 18.96v74.18L256 49.5V24.9c0-22.7-25.9-35.6-44.04-22z"/><path fill="#C5221F" d="M0 49.5l58.18 43.64V18.96L44.04 2.9C25.9-10.7 0 2.2 0 24.9z"/></svg>',
  fastmail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.6" fill="#2C6BED"/><path d="M5.4 8.6 12 13l6.6-4.4" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  icloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#3B96F4" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>',
  generic: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><rect x="3.5" y="4.75" width="17" height="6" rx="1.6" stroke="#64748B" stroke-width="1.6"/><rect x="3.5" y="13.25" width="17" height="6" rx="1.6" stroke="#64748B" stroke-width="1.6"/><circle cx="7" cy="7.75" r="1.05" fill="#64748B"/><circle cx="7" cy="16.25" r="1.05" fill="#64748B"/></svg>',
}

export const PROVIDERS = {
  gmail: {
    id: 'gmail',
    label: 'Gmail',
    desc: 'Google Workspace & Gmail',
    logo: LOGOS.gmail,
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    usernameIsEmail: true,
    appPassword: true,
    help:
      'Gmail blocks plain passwords. Turn on 2-Step Verification, then create an '
      + 'App Password (Google Account → Security → App passwords) and paste the '
      + '16-character code below instead of your normal password.',
    helpUrl: 'https://myaccount.google.com/apppasswords',
  },
  fastmail: {
    id: 'fastmail',
    label: 'Fastmail',
    desc: 'Fastmail account',
    logo: LOGOS.fastmail,
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 465,
    smtpSecure: true,
    usernameIsEmail: true,
    appPassword: true,
    help:
      'Create a dedicated app password in Fastmail (Settings → Privacy & Security '
      + '→ App Passwords) scoped to "Mail (IMAP/SMTP)" and use it below.',
    helpUrl: 'https://app.fastmail.com/settings/security/apppassword',
  },
  icloud: {
    id: 'icloud',
    label: 'iCloud',
    desc: 'Apple iCloud Mail',
    logo: LOGOS.icloud,
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false, // 587 uses STARTTLS, not implicit TLS
    usernameIsEmail: true,
    appPassword: true,
    help:
      'iCloud Mail requires an app-specific password. At appleid.apple.com → '
      + 'Sign-In and Security → App-Specific Passwords, generate one and paste it '
      + 'below. Your username is your full @icloud.com address.',
    helpUrl: 'https://support.apple.com/en-us/102654',
  },
  generic: {
    id: 'generic',
    label: 'Other (IMAP/SMTP)',
    desc: 'Any IMAP / SMTP server',
    logo: LOGOS.generic,
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 465,
    smtpSecure: true,
    usernameIsEmail: true,
    appPassword: false,
    help:
      'Enter the IMAP and SMTP details from your mail host. Port 993 / 465 use '
      + 'implicit TLS; 143 / 587 typically use STARTTLS (leave "secure" off).',
    helpUrl: '',
  },
}

export const PROVIDER_ORDER = ['gmail', 'fastmail', 'icloud', 'generic']

// A small, non-cryptographic palette so each account gets a stable accent.
// Deliberately no pink — cool/neutral hues only.
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

// Build a connection config object from form state + the chosen preset.
export function buildConfig(form) {
  return {
    email: (form.email || '').trim(),
    name: (form.name || '').trim() || (form.email || '').trim(),
    provider: form.provider || 'generic',
    color: form.color || colorForSeed(form.email),
    imapHost: (form.imapHost || '').trim(),
    imapPort: Number(form.imapPort) || 993,
    imapSecure: !!form.imapSecure,
    smtpHost: (form.smtpHost || '').trim(),
    smtpPort: Number(form.smtpPort) || 465,
    smtpSecure: !!form.smtpSecure,
    username: (form.username || form.email || '').trim(),
    password: form.password || '',
  }
}

// Cheap RFC-ish email sanity check — enough to gate the "Test" button, not to
// validate deliverability.
export function looksLikeEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim())
}

// Is the form complete enough to attempt a connection test?
export function configComplete(form) {
  return (
    looksLikeEmail(form.email)
    && String(form.imapHost || '').trim().length > 0
    && String(form.smtpHost || '').trim().length > 0
    && String(form.username || form.email || '').trim().length > 0
    && String(form.password || '').length > 0
  )
}
