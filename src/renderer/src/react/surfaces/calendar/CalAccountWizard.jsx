// CalAccountWizard.jsx — connect an external CalDAV calendar, as a stepped
// Medusa wizard. Mirrors email/AccountWizard.jsx (same shared <Wizard>, same
// Medusa primitives, same .pp-* shells) so it looks and behaves identically.
// Three steps:
//   1. Provider     — pick a preset (iCloud / Fastmail / Generic; Google is a
//                     disabled "coming soon" card) + email/name
//   2. Credentials  — app-password (+ per-provider help) + the CalDAV server URL
//                     (always shown for Generic; under Advanced for presets)
//   3. Connect      — review, "Test connection" (calendar:accountTest) which
//                     lists the discovered calendars, then finish → add
//                     (calendar:accountAdd). A passing test gates the add.

import { useEffect, useMemo, useState } from 'react'
import {
  Button, IconButton, Input, Label, Text, Heading, Alert, InlineTip, Badge,
} from '@medusajs/ui'
import {
  ShieldCheck, CalendarSolid, Eye, EyeSlash, LockClosedSolid, ArrowUpRightOnBox,
} from '@medusajs/icons'
import { useHost } from '../../host.js'
import {
  PROVIDERS, PROVIDER_ORDER, buildConfig, configComplete, looksLikeEmail, looksLikeUrl, colorForSeed,
} from './providers.js'
import { invoke } from './useCalendar.js'
import Wizard from '../../_shared/Wizard'

function applyPreset(form, providerId) {
  const p = PROVIDERS[providerId] || PROVIDERS.generic
  return {
    ...form,
    provider: providerId,
    server: p.server || (providerId === form.provider ? form.server : ''),
    username: p.usernameIsEmail && form.email ? form.email : form.username,
  }
}

export default function CalAccountWizard({ open, onOpenChange, onAdded }) {
  const host = useHost()
  const [form, setForm] = useState(() => applyPreset({
    email: '', name: '', username: '', password: '', server: '', color: '',
  }, 'icloud'))
  const [testing, setTesting] = useState(false)
  // null | {ok, calendars:[]} | {ok:false, error}
  const [tested, setTested] = useState(null)
  const [adding, setAdding] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const preset = PROVIDERS[form.provider] || PROVIDERS.generic
  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }))
    setTested(null) // any edit invalidates a prior successful test
  }

  // Keep username synced to email for presets that use the email as username.
  useEffect(() => {
    if (preset.usernameIsEmail && form.email && (!form.username || form.username === form._lastEmail)) {
      setForm((f) => ({ ...f, username: form.email, _lastEmail: form.email }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.email, form.provider])

  const complete = useMemo(() => configComplete(form), [form])
  const isGeneric = form.provider === 'generic'
  const emailInvalid = !isGeneric && !!form.email && !looksLikeEmail(form.email)
  const serverInvalid = !!form.server && !looksLikeUrl(form.server)

  async function testConnection() {
    if (!complete) return
    setTesting(true); setTested(null)
    const cfg = buildConfig(form)
    const res = await invoke(host, 'calendar:accountTest', cfg)
    if (res.ok) {
      setTested({ ok: true, calendars: Array.isArray(res.calendars) ? res.calendars : [] })
      host.toast('Connection looks good', 'success')
    } else {
      setTested({ ok: false, error: res.error || 'Connection failed' })
    }
    setTesting(false)
  }

  async function addAccount() {
    if (!tested || !tested.ok) return false
    setAdding(true)
    const cfg = buildConfig({ ...form, color: form.color || colorForSeed(form.email || form.username) })
    const res = await invoke(host, 'calendar:accountAdd', cfg)
    setAdding(false)
    if (res.ok) {
      host.toast('Calendar connected', 'success')
      if (onAdded) onAdded(res.account)
      return true
    }
    setTested({ ok: false, error: res.error || 'Could not add calendar' })
    host.toast('Could not add calendar', 'error')
    return false // keep the wizard open so the error stays visible
  }

  // ── Step 1: provider + address ──────────────────────────────────────────────
  const stepProvider = (
    <div className="pp-wizard-step">
      <div className="pp-wizard-head">
        <span className="pp-wizard-mark"><CalendarSolid /></span>
        <Heading level="h2">Choose your calendar provider</Heading>
        <Text size="small" className="pp-wizard-sub">
          Connect any calendar over CalDAV. Your credentials are encrypted with
          your OS keychain and never leave this device.
        </Text>
      </div>

      <div className="pp-provider-grid">
        {PROVIDER_ORDER.map((id) => {
          const p = PROVIDERS[id]
          const active = form.provider === id
          const disabled = !!p.disabled
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => { if (disabled) return; setForm((f) => applyPreset(f, id)); setTested(null) }}
              className={`pp-provider${active ? ' pp-provider--active' : ''}${disabled ? ' pp-provider--disabled' : ''}`}
              aria-pressed={active}
              aria-disabled={disabled || undefined}
              title={disabled ? (p.comingSoon || 'Coming soon') : undefined}
            >
              {/* eslint-disable-next-line react/no-danger */}
              <span className="pp-provider-logo" dangerouslySetInnerHTML={{ __html: p.logo || '' }} />
              <span className="pp-provider-text">
                <span className="pp-provider-name">{p.label}</span>
                <span className="pp-provider-host">{p.desc || ''}</span>
              </span>
              {disabled ? (
                <Badge size="2xsmall" color="grey" className="pp-provider-soon">Soon</Badge>
              ) : (
                <span className="pp-provider-check" aria-hidden="true">
                  {active ? (
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {preset.disabled ? (
        <InlineTip variant="warning" label="Not available yet">
          {preset.comingSoon || 'This provider is coming soon.'}
        </InlineTip>
      ) : (
        <div className="pp-form-grid">
          <Field
            label={isGeneric ? 'Email or username' : 'Email address'}
            error={emailInvalid ? 'Enter a valid email address.' : ''}
          >
            <Input
              type={isGeneric ? 'text' : 'email'}
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
              placeholder={isGeneric ? 'you or you@example.com' : 'you@icloud.com'}
              aria-invalid={emailInvalid || undefined}
              autoFocus
            />
          </Field>
          <Field label="Display name" optional>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Work calendar" />
          </Field>
        </div>
      )}
    </div>
  )

  // ── Step 2: credentials + server URL ────────────────────────────────────────
  const showServerPanel = showAdvanced || isGeneric
  const stepCredentials = (
    <div className="pp-wizard-step">
      <div className="pp-wizard-head">
        <span className="pp-wizard-mark"><LockClosedSolid /></span>
        <Heading level="h2">Add your credentials</Heading>
        <Text size="small" className="pp-wizard-sub">
          {preset.appPassword
            ? 'This provider needs an app-specific password — generate one with the guide below.'
            : 'Enter the password for this calendar account.'}
        </Text>
      </div>

      <div className="pp-form-grid">
        <Field label={preset.appPassword ? 'App password' : 'Password'} full>
          <div style={{ position: 'relative' }}>
            <Input
              type={showPw ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder={preset.appPassword ? 'app-specific password' : '••••••••'}
              style={{ paddingRight: 40 }}
              autoFocus
            />
            <IconButton
              type="button"
              variant="transparent"
              size="small"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
              style={{ position: 'absolute', top: '50%', right: 4, transform: 'translateY(-50%)' }}
            >
              {showPw ? <EyeSlash /> : <Eye />}
            </IconButton>
          </div>
        </Field>
      </div>

      {/* per-provider app-password help */}
      {preset.help ? (
        <InlineTip variant="info" label={preset.appPassword ? 'App password required' : 'Tip'}>
          <span>{preset.help}</span>
          {preset.helpUrl ? (
            <button
              type="button"
              onClick={() => host.openExternal(preset.helpUrl)}
              className="pp-inline-link"
            >
              Open setup guide
              <ArrowUpRightOnBox />
            </button>
          ) : null}
        </InlineTip>
      ) : null}

      {/* advanced (server URL) — always open for generic */}
      {!isGeneric ? (
        <Button
          type="button"
          variant="transparent"
          size="small"
          onClick={() => setShowAdvanced((v) => !v)}
          className="pp-advanced-toggle"
        >
          {showAdvanced ? 'Hide server settings' : 'Advanced server settings'}
        </Button>
      ) : null}
      {showServerPanel ? (
        <div className="pp-advanced-panel">
          <div className="pp-form-grid">
            <Field
              label="CalDAV server URL"
              full
              hint="Often ends in /dav/ or /.well-known/caldav."
              error={serverInvalid ? 'Enter a valid http(s) URL.' : ''}
            >
              <Input
                value={form.server}
                onChange={(e) => set({ server: e.target.value })}
                placeholder="https://caldav.example.com"
                aria-invalid={serverInvalid || undefined}
              />
            </Field>
            <Field label="Username" full hint="Usually your full email address.">
              <Input value={form.username} onChange={(e) => set({ username: e.target.value })} placeholder="usually your email" />
            </Field>
          </div>
        </div>
      ) : null}
    </div>
  )

  // ── Step 3: review, test connection (lists calendars), then finish → add ─────
  const stepConnect = (
    <div className="pp-wizard-step">
      <div className="pp-wizard-head">
        <span className="pp-wizard-mark"><ShieldCheck /></span>
        <Heading level="h2">Test &amp; connect</Heading>
        <Text size="small" className="pp-wizard-sub">
          Verify the connection, then add this calendar to Paperus.
        </Text>
      </div>

      <div className="pp-summary">
        <SummaryRow label="Provider" value={<Badge size="2xsmall" color="grey">{preset.label}</Badge>} />
        <SummaryRow label="Account" value={form.email || form.username || '—'} />
        <SummaryRow label="Server" value={form.server || '—'} mono />
        <SummaryRow label="Username" value={form.username || form.email || '—'} last />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="secondary" isLoading={testing} disabled={!complete || testing} onClick={testConnection}>
          Test connection
        </Button>
        <Text size="small" className="pp-muted">
          {tested && tested.ok ? 'Verified — add the calendar to finish.' : 'Run a test before adding the calendar.'}
        </Text>
      </div>

      {tested && !tested.ok ? (
        <Alert variant="error">{tested.error || 'Connection failed.'}</Alert>
      ) : null}

      {tested && tested.ok ? (
        <Alert variant="success">
          {tested.calendars && tested.calendars.length
            ? `Found ${tested.calendars.length} calendar${tested.calendars.length === 1 ? '' : 's'}.`
            : 'Connection successful — you can add this account.'}
        </Alert>
      ) : null}

      {/* discovered calendars preview */}
      {tested && tested.ok && tested.calendars && tested.calendars.length ? (
        <div className="pp-summary">
          {tested.calendars.map((c, i) => (
            <div
              key={c.url || c.name || i}
              className={`pp-summary-row${i === tested.calendars.length - 1 ? ' pp-summary-row--last' : ''}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span
                  aria-hidden
                  style={{
                    width: 9, height: 9, borderRadius: 999, flex: 'none',
                    background: c.color || preset && colorForSeed(form.email || form.username),
                  }}
                />
                <Text size="small" className="text-ui-fg-base" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name || c.url}
                </Text>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )

  const steps = [
    {
      id: 'provider',
      label: 'Provider',
      content: stepProvider,
      canContinue: !preset.disabled
        && !!form.provider
        && (isGeneric ? String(form.email || form.username || '').trim().length > 0 : looksLikeEmail(form.email)),
    },
    {
      id: 'credentials',
      label: 'Credentials',
      content: stepCredentials,
      canContinue: complete,
    },
    {
      id: 'connect',
      label: 'Connect',
      content: stepConnect,
      canContinue: !!tested && tested.ok, // require a passing test before finish
    },
  ]

  return (
    <Wizard
      open={open}
      onOpenChange={onOpenChange}
      steps={steps}
      finishLabel="Add calendar"
      onFinish={addAccount}
      busy={testing || adding}
    />
  )
}

function Field({ label, children, full, optional, hint, error, style }) {
  return (
    <div
      className="pp-field-row"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: full ? '1 / -1' : undefined, ...style }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Label size="xsmall" weight="plus">{label}</Label>
        {optional ? <Text size="xsmall" className="pp-muted">Optional</Text> : null}
      </div>
      {children}
      {error
        ? <Text size="xsmall" className="pp-field-error">{error}</Text>
        : (hint ? <Text size="xsmall" className="pp-muted">{hint}</Text> : null)}
    </div>
  )
}

function SummaryRow({ label, value, mono, last }) {
  return (
    <div className={`pp-summary-row${last ? ' pp-summary-row--last' : ''}`}>
      <Text size="small" className="pp-muted">{label}</Text>
      <span className={mono ? 'pp-summary-val pp-summary-val--mono' : 'pp-summary-val'}>{value}</span>
    </div>
  )
}
