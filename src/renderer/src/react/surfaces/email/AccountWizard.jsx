// AccountWizard.jsx — connect an IMAP/SMTP account, as a stepped Medusa wizard.
//
// Rendered through the shared <Wizard> (FocusModal + ProgressTabs) so it matches
// every other "create" flow in the app. Three steps:
//   1. Provider     — pick a preset (auto-fills host/port/secure + help) + email/name
//   2. Credentials  — password (+ app-password help) + advanced server settings
//   3. Connect      — review, "Test connection" (email:accountTest), then finish →
//                     add (email:accountAdd). A passing test is required before add.
//
// All form controls are real @medusajs/ui primitives (Input/Label/Alert/InlineTip/
// IconButton/Heading/Text/Switch) so they inherit correct sizing, focus rings and
// light/dark theming for free; only the layout shells (.pp-wizard-*, .pp-form-grid)
// are local CSS, and those resolve against Medusa's themed --fg/--bg vars.

import { useEffect, useMemo, useState } from 'react'
import {
  Button, IconButton, Input, Label, Text, Heading, Alert, InlineTip, Switch, Badge,
} from '@medusajs/ui'
import {
  ShieldCheck, EnvelopeSolid, Eye, EyeSlash, LockClosedSolid, ArrowUpRightOnBox,
} from '@medusajs/icons'
import { useHost } from '../../host.js'
import {
  PROVIDERS, PROVIDER_ORDER, buildConfig, configComplete, looksLikeEmail, colorForSeed,
} from './providers.js'
import { invoke } from './useEmail.js'
import Wizard from '../../_shared/Wizard'

function applyPreset(form, providerId) {
  const p = PROVIDERS[providerId] || PROVIDERS.generic
  return {
    ...form,
    provider: providerId,
    imapHost: p.imapHost || form.imapHost,
    imapPort: p.imapPort,
    imapSecure: p.imapSecure,
    smtpHost: p.smtpHost || form.smtpHost,
    smtpPort: p.smtpPort,
    smtpSecure: p.smtpSecure,
    username: p.usernameIsEmail && form.email ? form.email : form.username,
  }
}

export default function AccountWizard({ open, onOpenChange, onAdded }) {
  const host = useHost()
  const [form, setForm] = useState(() => applyPreset({
    email: '', name: '', username: '', password: '', color: '',
  }, 'gmail'))
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(null) // null | {ok} | {ok:false,error}
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
  const emailInvalid = !!form.email && !looksLikeEmail(form.email)

  async function testConnection() {
    if (!complete) return
    setTesting(true); setTested(null)
    const cfg = buildConfig(form)
    const res = await invoke(host, 'email:accountTest', { config: cfg })
    setTested(res.ok ? { ok: true } : { ok: false, error: res.error || 'Connection failed' })
    setTesting(false)
    if (res.ok) host.toast('Connection looks good', 'success')
  }

  async function addAccount() {
    if (!tested || !tested.ok) return false
    setAdding(true)
    const cfg = buildConfig({ ...form, color: form.color || colorForSeed(form.email) })
    const res = await invoke(host, 'email:accountAdd', { config: cfg })
    setAdding(false)
    if (res.ok) {
      host.toast('Account added', 'success')
      if (onAdded) onAdded(res.accountId)
      return true
    }
    setTested({ ok: false, error: res.error || 'Could not add account' })
    host.toast('Could not add account', 'error')
    return false // keep the wizard open so the error stays visible
  }

  // ── Step 1: provider + address ──────────────────────────────────────────────
  const stepProvider = (
    <div className="pp-wizard-step">
      <div className="pp-wizard-head">
        <span className="pp-wizard-mark"><EnvelopeSolid /></span>
        <Heading level="h2">Choose your mail provider</Heading>
        <Text size="small" className="pp-wizard-sub">
          Connect any inbox over IMAP &amp; SMTP. Your credentials are encrypted with
          your OS keychain and never leave this device.
        </Text>
      </div>

      <div className="pp-provider-grid">
        {PROVIDER_ORDER.map((id) => {
          const p = PROVIDERS[id]
          const active = form.provider === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => { setForm((f) => applyPreset(f, id)); setTested(null) }}
              className={`pp-provider${active ? ' pp-provider--active' : ''}`}
              aria-pressed={active}
            >
              {/* eslint-disable-next-line react/no-danger */}
              <span className="pp-provider-logo" dangerouslySetInnerHTML={{ __html: p.logo || '' }} />
              <span className="pp-provider-text">
                <span className="pp-provider-name">{p.label}</span>
                <span className="pp-provider-host">{p.desc || ''}</span>
              </span>
              <span className="pp-provider-check" aria-hidden="true">
                {active ? (
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      <div className="pp-form-grid">
        <Field label="Email address" error={emailInvalid ? 'Enter a valid email address.' : ''}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
            placeholder="you@example.com"
            aria-invalid={emailInvalid || undefined}
            autoFocus
          />
        </Field>
        <Field label="Display name" optional>
          <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Your name" />
        </Field>
      </div>
    </div>
  )

  // ── Step 2: credentials + advanced server settings ──────────────────────────
  const stepCredentials = (
    <div className="pp-wizard-step">
      <div className="pp-wizard-head">
        <span className="pp-wizard-mark"><LockClosedSolid /></span>
        <Heading level="h2">Add your credentials</Heading>
        <Text size="small" className="pp-wizard-sub">
          {preset.appPassword
            ? 'This provider needs an app-specific password — generate one with the guide below.'
            : 'Enter the password for this mailbox.'}
        </Text>
      </div>

      <div className="pp-form-grid">
        <Field label={preset.appPassword ? 'App password' : 'Password'} full>
          <div style={{ position: 'relative' }}>
            <Input
              type={showPw ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder={preset.appPassword ? '16-character app password' : '••••••••'}
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

      {/* advanced (server) details */}
      <Button
        type="button"
        variant="transparent"
        size="small"
        onClick={() => setShowAdvanced((v) => !v)}
        className="pp-advanced-toggle"
      >
        {showAdvanced ? 'Hide server settings' : 'Advanced server settings'}
      </Button>
      {showAdvanced || form.provider === 'generic' ? (
        <div className="pp-advanced-panel">
          <div className="pp-form-grid">
            <Field label="Username" full hint="Usually your full email address.">
              <Input value={form.username} onChange={(e) => set({ username: e.target.value })} placeholder="usually your email" />
            </Field>
            <Field label="IMAP host">
              <Input value={form.imapHost} onChange={(e) => set({ imapHost: e.target.value })} placeholder="imap.example.com" />
            </Field>
            <div className="pp-port-row">
              <Field label="IMAP port" style={{ flex: 1 }}>
                <Input type="number" value={form.imapPort} onChange={(e) => set({ imapPort: e.target.value })} />
              </Field>
              <SecureToggle label="TLS" checked={form.imapSecure} onChange={(v) => set({ imapSecure: v })} />
            </div>
            <Field label="SMTP host">
              <Input value={form.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} placeholder="smtp.example.com" />
            </Field>
            <div className="pp-port-row">
              <Field label="SMTP port" style={{ flex: 1 }}>
                <Input type="number" value={form.smtpPort} onChange={(e) => set({ smtpPort: e.target.value })} />
              </Field>
              <SecureToggle label="TLS" checked={form.smtpSecure} onChange={(v) => set({ smtpSecure: v })} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )

  // ── Step 3: review, test connection, then finish → add ──────────────────────
  const stepConnect = (
    <div className="pp-wizard-step">
      <div className="pp-wizard-head">
        <span className="pp-wizard-mark"><ShieldCheck /></span>
        <Heading level="h2">Test &amp; connect</Heading>
        <Text size="small" className="pp-wizard-sub">
          Verify the connection, then add this inbox to Paperus.
        </Text>
      </div>

      {/* what we're about to connect */}
      <div className="pp-summary">
        <SummaryRow label="Provider" value={<Badge size="2xsmall" color="grey">{preset.label}</Badge>} />
        <SummaryRow label="Account" value={form.email || '—'} />
        <SummaryRow label="IMAP" value={`${form.imapHost || '—'}:${form.imapPort}`} mono />
        <SummaryRow label="SMTP" value={`${form.smtpHost || '—'}:${form.smtpPort}`} mono last />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="secondary" isLoading={testing} disabled={!complete || testing} onClick={testConnection}>
          Test connection
        </Button>
        <Text size="small" className="pp-muted">
          {tested && tested.ok ? 'Verified — add the inbox to finish.' : 'Run a test before adding the inbox.'}
        </Text>
      </div>

      {tested ? (
        <Alert variant={tested.ok ? 'success' : 'error'}>
          {tested.ok
            ? 'Connection successful — you can add this account.'
            : (tested.error || 'Connection failed.')}
        </Alert>
      ) : null}
    </div>
  )

  const steps = [
    {
      id: 'provider',
      label: 'Provider',
      content: stepProvider,
      canContinue: !!form.provider && looksLikeEmail(form.email),
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
      finishLabel="Add inbox"
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

function SecureToggle({ label, checked, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
      <Label size="xsmall" weight="plus">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
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
