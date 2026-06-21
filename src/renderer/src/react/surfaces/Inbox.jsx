// Inbox.jsx — the Inbox React island.
//
// One newest-first feed of "things waiting for you", merged by inbox-store.js
// into four kinds: shares (a peer sent you a note), invites (pending team
// invites), mentions (you were @-mentioned), and assigned (open tasks on your
// handle). This surface is pure presentation: it reads from `host.inbox`,
// refreshes off the coarse `inbox:items-updated` / `scan:updated` signals, and
// routes user actions back through the host bridge.
//
// Interaction model:
//   • share / invite  → Accept (primary) + Dismiss (secondary).
//   • mention / assigned → click the row to open the source note.
// Visual layer = the `.pp-*` Paperus surface design system in island.css. Unread
// items get a left accent rail + bold title; everything else stays calm. No pink
// anywhere — neutral greys with a single cool-blue accent.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Tooltip, clx } from '@medusajs/ui'
import {
  Share,
  UserGroup,
  AtSymbol,
  ListCheckbox,
  CheckCircle,
  XMark,
} from '@medusajs/icons'
import { useHost } from '../host.js'

const TABS = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'shares', label: 'Shares', kinds: ['share'] },
  { key: 'invites', label: 'Invites', kinds: ['invite'] },
  { key: 'mentions', label: 'Mentions', kinds: ['mention'] },
  { key: 'assigned', label: 'Assigned', kinds: ['assigned'] },
]

const KIND_ICON = {
  share: Share,
  invite: UserGroup,
  mention: AtSymbol,
  assigned: ListCheckbox,
}

const EMPTY_COPY = {
  all: 'Your inbox is clear',
  shares: 'No new shares',
  invites: 'No pending invites',
  mentions: 'No new mentions',
  assigned: 'Nothing assigned to you',
}

// ── relative time ─────────────────────────────────────────────────────────────
function relativeTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - Number(ts)
  if (!Number.isFinite(diff)) return ''
  if (diff < 45 * 1000) return 'just now'
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  try {
    return new Date(Number(ts)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch (_e) {
    return ''
  }
}

// Parse a mention/assigned source into an open action. Team notes are encoded as
// `team:<teamId>:<noteId>`; anything else is treated as a local filesystem path.
function openSource(host, source) {
  if (!source) return
  const s = String(source)
  if (s.startsWith('team:')) {
    const rest = s.slice('team:'.length)
    const idx = rest.indexOf(':')
    if (idx > 0) {
      const teamId = rest.slice(0, idx)
      const noteId = rest.slice(idx + 1)
      try { host.openTeamNote(teamId, noteId); return } catch (_e) { /* fall through */ }
    }
  }
  try { host.openFile(s) } catch (_e) { /* ignore */ }
}

// ── one row ───────────────────────────────────────────────────────────────────
function InboxRow({ item, onAccept, onDismiss, onOpen }) {
  const Icon = KIND_ICON[item.kind] || Share
  const unread = item.seen === false
  const actionable = item.kind === 'share' || item.kind === 'invite'
  const clickable = item.kind === 'mention' || item.kind === 'assigned'

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onOpen(item) : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item) } } : undefined}
      className={clx('pp-inbox-item', clickable && 'pp-inbox-item--click', unread && 'pp-inbox-item--unread')}
    >
      <div className={clx('pp-inbox-ico', `pp-inbox-ico--${item.kind}`)}>
        <Icon />
      </div>

      <div className="min-w-0 flex-1">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="pp-inbox-title">{item.title}</span>
          <span className="pp-inbox-time" style={{ marginLeft: 'auto' }}>{relativeTime(item.at)}</span>
        </div>
        {item.subtitle ? <div className="pp-inbox-sub">{item.subtitle}</div> : null}

        {actionable ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11 }}>
            <Button size="small" variant="secondary" onClick={(e) => { e.stopPropagation(); onAccept(item) }}>
              <CheckCircle className="text-ui-fg-subtle" />
              {item.kind === 'invite' ? 'Join' : 'Accept'}
            </Button>
            <Button size="small" variant="transparent" onClick={(e) => { e.stopPropagation(); onDismiss(item) }}>
              Dismiss
            </Button>
          </div>
        ) : null}
      </div>

      {clickable ? (
        <Tooltip content="Mark as read">
          <button
            type="button"
            aria-label="Mark as read"
            className="pp-iconbtn"
            style={{ opacity: 0, transition: 'opacity .12s ease' }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = 1 }}
            onFocus={(e) => { e.currentTarget.style.opacity = 1 }}
            onClick={(e) => { e.stopPropagation(); onDismiss(item) }}
          >
            <XMark />
          </button>
        </Tooltip>
      ) : null}
    </div>
  )
}

// ── empty state ───────────────────────────────────────────────────────────────
function EmptyState({ copy }) {
  return (
    <div className="pp-empty">
      <div className="pp-empty-icon"><CheckCircle /></div>
      <div style={{ fontSize: 15, fontWeight: 620, color: 'var(--fg-base)' }}>{copy}</div>
      <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>You&rsquo;re all caught up.</div>
    </div>
  )
}

// ── surface ───────────────────────────────────────────────────────────────────
export default function Inbox() {
  const host = useHost()
  const inbox = host && host.inbox ? host.inbox : {}

  const [items, setItems] = useState([])
  const [active, setActive] = useState('all')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = inbox.getItems ? await inbox.getItems() : []
      setItems(Array.isArray(next) ? next : [])
    } catch (_e) {
      setItems([])
    }
  }, [inbox])

  // Initial load + refresh on the two coarse signals the store/scan emit.
  useEffect(() => {
    let alive = true
    const run = async () => { await refresh(); if (!alive) setItems([]) }
    run()
    const offItems = host.on ? host.on('inbox:items-updated', refresh) : null
    const offScan = host.on ? host.on('scan:updated', refresh) : null
    return () => {
      alive = false
      if (offItems) offItems()
      if (offScan) offScan()
    }
  }, [host, refresh])

  // Per-tab unread counts for the badges.
  const counts = useMemo(() => {
    const c = { all: 0, shares: 0, invites: 0, mentions: 0, assigned: 0 }
    for (const it of items) {
      if (it.seen !== false) continue
      c.all += 1
      if (it.kind === 'share') c.shares += 1
      else if (it.kind === 'invite') c.invites += 1
      else if (it.kind === 'mention') c.mentions += 1
      else if (it.kind === 'assigned') c.assigned += 1
    }
    return c
  }, [items])

  const visible = useMemo(() => {
    const tab = TABS.find((t) => t.key === active) || TABS[0]
    if (!tab.kinds) return items
    return items.filter((it) => tab.kinds.includes(it.kind))
  }, [items, active])

  const onAccept = useCallback(async (item) => {
    try {
      if (inbox.accept) await inbox.accept(item)
      if (host.toast) {
        host.toast(item.kind === 'invite' ? 'Joining team…' : 'Opening shared note…', 'success')
      }
    } catch (_e) {
      if (host.toast) host.toast('Could not complete that action', 'error')
    } finally {
      refresh()
    }
  }, [inbox, host, refresh])

  const onDismiss = useCallback(async (item) => {
    try { if (inbox.dismiss) await inbox.dismiss(item) } catch (_e) { /* ignore */ }
    refresh()
  }, [inbox, refresh])

  const onOpen = useCallback((item) => {
    const p = item.payload || {}
    openSource(host, p.source)
  }, [host])

  const onMarkAll = useCallback(async () => {
    setBusy(true)
    try {
      if (inbox.markAllRead) await inbox.markAllRead()
      if (host.toast) host.toast('Inbox marked as read', 'success')
    } catch (_e) { /* ignore */ } finally {
      setBusy(false)
      refresh()
    }
  }, [inbox, host, refresh])

  return (
    <div className="pp-surface">
      {/* header */}
      <header className="pp-header">
        <h1 className="pp-title">Inbox</h1>
        {counts.all > 0 ? <span className="pp-count pp-count--blue">{counts.all}</span> : null}
        <div className="pp-spacer" />
        <Button size="small" variant="secondary" disabled={busy || counts.all === 0} onClick={onMarkAll}>
          Mark all read
        </Button>
      </header>

      {/* tab strip */}
      <div style={{ display: 'flex', padding: '11px 24px', borderBottom: '1px solid var(--pp-line)', background: 'var(--bg-base)', flex: 'none' }}>
        <div className="pp-seg" role="tablist" aria-label="Inbox filter">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active === t.key}
              className="pp-seg-btn"
              onClick={() => setActive(t.key)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {t.label}
              {counts[t.key] > 0 ? (
                <span className="pp-count pp-count--blue" style={{ minWidth: 16, height: 16, fontSize: 10, padding: '0 5px' }}>
                  {counts[t.key]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* body */}
      <div className="pp-body">
        <div className="mx-auto" style={{ maxWidth: 640 }}>
          {visible.length === 0 ? (
            <EmptyState copy={EMPTY_COPY[active] || 'Nothing here'} />
          ) : (
            <div className="pp-card">
              <div className="pp-list">
                {visible.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    onAccept={onAccept}
                    onDismiss={onDismiss}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
