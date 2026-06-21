// AiBar.jsx — slim top strip: account title, compose, AI/brain status, sync
// progress, and the undo-send banner. Styled with the `.pp-*` design system.

import { Button, Tooltip } from '@medusajs/ui'
import {
  Pencil, Sparkles, Bolt, ArrowPath,
} from '@medusajs/icons'

export function UndoSendBanner({ pending, onUndo }) {
  if (!pending) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 16px', background: 'var(--bg-base)', borderBottom: '1px solid var(--pp-line)' }}>
      <div
        className="pp-card"
        style={{ display: 'flex', alignItems: 'center', gap: 12, borderRadius: 999, padding: '5px 7px 5px 14px', boxShadow: 'var(--pp-shadow-soft)' }}
      >
        <Bolt style={{ color: 'var(--pp-accent)' }} />
        <span style={{ fontSize: 12.5, color: 'var(--fg-base)' }}>
          Sending &ldquo;{pending.subject || '(no subject)'}&rdquo; in {pending.secondsLeft}s…
        </span>
        <Button size="small" variant="secondary" onClick={onUndo}>Undo</Button>
      </div>
    </div>
  )
}

export default function AiBar({
  title, subtitle, onCompose, aiAvailable, syncing, syncLabel,
}) {
  return (
    <div className="pp-header" style={{ padding: '12px 20px' }}>
      <div className="min-w-0">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 640, letterSpacing: '-.01em', color: 'var(--fg-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <Tooltip content="Email is a new beta feature — expect rough edges as it stabilizes">
            <span
              className="pp-chip"
              style={{ flex: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', padding: '1px 7px', color: 'var(--pp-accent)' }}
            >
              Beta
            </span>
          </Tooltip>
        </div>
        {subtitle ? (
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </div>
        ) : null}
      </div>

      {syncing ? (
        <span className="pp-chip" style={{ gap: 6 }}>
          <ArrowPath className="animate-spin" />
          <span className="pp-chip__label">{syncLabel || 'Syncing…'}</span>
        </span>
      ) : null}

      <div className="pp-spacer" />

      {aiAvailable ? (
        <Tooltip content="AI is on — summarize, draft, triage & ask from the Brain">
          <span className="pp-chip pp-chip--accent" style={{ fontWeight: 600 }}>
            <Sparkles /> AI on
          </span>
        </Tooltip>
      ) : (
        <Tooltip content="Open the Brain once to enable AI features">
          <span className="pp-chip" style={{ opacity: 0.75 }}>
            <Sparkles /> AI off
          </span>
        </Tooltip>
      )}

      <Tooltip content="New message (c)">
        <Button size="small" variant="primary" onClick={onCompose}>
          <Pencil /> Compose
        </Button>
      </Tooltip>
    </div>
  )
}
