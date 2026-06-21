// MessageList.jsx — virtualized middle column (newest-first), Split-Inbox triage
// tabs, and a search box with natural-language understanding.
//
// Rows show: sender, subject, snippet, time, attachment dot, unread weight, flag.
// Keyboard selection (j/k/Enter) is owned by the parent surface, which controls
// `selectedUid` + `onSelect`; this component just renders & scrolls.

import {
  useEffect, useMemo, useRef, useState, useCallback,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Tooltip, clx, Skeleton,
} from '@medusajs/ui'
import {
  MagnifyingGlass, Star, StarSolid, PaperClip, ArrowPath, Sparkles, XMark,
} from '@medusajs/icons'
import {
  relTime, displayName, addressOf,
} from './util.js'

// Date buckets for the list group headers (Notion-style: Today / Yesterday /
// This week / This month / "Month YYYY").
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }
function bucketFor(date) {
  const t = new Date(date).getTime()
  if (!Number.isFinite(t)) return { key: 'older', label: 'Earlier' }
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(t)) / 86400000)
  if (diff <= 0) return { key: 'today', label: 'Today' }
  if (diff === 1) return { key: 'yesterday', label: 'Yesterday' }
  if (diff < 7) return { key: 'week', label: 'This week' }
  if (diff < 30) return { key: 'month', label: 'This month' }
  const d = new Date(t)
  return { key: `m-${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString(undefined, { month: 'long', year: 'numeric' }) }
}

function Row({
  msg, active, triage, onClick, onToggleFlag, accountColor,
}) {
  const unread = !msg.seen
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onClick}
      className={clx('pp-msg group', active && 'pp-msg--active', unread && 'pp-msg--unread')}
    >
      {/* lead: unread dot or flag star */}
      <div className="pp-msg-lead">
        {unread ? (
          <span aria-hidden className="pp-msg-unread-dot" />
        ) : (
          <span aria-hidden style={{ width: 8, height: 8 }} />
        )}
        <Tooltip content={msg.flagged ? 'Unstar' : 'Star'}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFlag(msg) }}
            aria-label={msg.flagged ? 'Unstar' : 'Star'}
            className={clx('pp-iconbtn', !msg.flagged && 'opacity-0 group-hover:opacity-100')}
            style={{ width: 22, height: 22 }}
          >
            {msg.flagged
              ? <StarSolid style={{ color: 'var(--tag-amber-icon, #d97706)' }} />
              : <Star />}
          </button>
        </Tooltip>
      </div>

      <div className="pp-msg-body">
        <div className="pp-msg-row1">
          {accountColor ? (
            <Tooltip content={msg.accountEmail || 'Account'}>
              <span aria-hidden className="pp-msg-acct" style={{ background: accountColor }} />
            </Tooltip>
          ) : null}
          <span className="pp-msg-from">
            {displayName(msg.from) || addressOf(msg.from) || '(unknown)'}
          </span>
          {triage === 'important' ? (
            <span className="pp-count pp-count--amber" style={{ flex: 'none' }}>Important</span>
          ) : null}
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5, flex: 'none',
          }}
          >
            {msg.hasAttachments ? <PaperClip style={{ width: 13, height: 13, color: 'var(--fg-muted, #a1a1aa)' }} /> : null}
            <span className="pp-msg-time">{relTime(msg.date)}</span>
          </span>
        </div>
        <div className="pp-msg-subject">{msg.subject || '(no subject)'}</div>
        <div className="pp-msg-snippet">{msg.snippet || ''}</div>
      </div>
    </div>
  )
}

export default function MessageList({
  messages, total, loading, selectedUid, onSelect, onToggleFlag, onLoadMore, onRefresh,
  // search
  searchValue, onSearchChange, onSearchSubmit, onSearchClear, searching, nlActive,
  // triage / split inbox
  triageMode, onTriageModeChange, triageMap, triaging, onRunTriage, aiAvailable,
  // chrome
  folderLabel, unified = false, accounts = null,
}) {
  const parentRef = useRef(null)

  // Per-account colour lookup for the unified "All inboxes" view.
  const acctColor = useMemo(() => {
    const map = {}
    for (const a of (accounts || [])) map[a.id] = a.color || 'var(--pp-accent)'
    return map
  }, [accounts])

  // Filter by triage tab (only when a classification exists).
  const visible = useMemo(() => {
    if (triageMode === 'all' || !triageMap) return messages
    return messages.filter((m) => {
      const t = triageMap[String(m.uid)]
      if (triageMode === 'important') return t === 'important'
      if (triageMode === 'other') return t === 'other' || !t
      return true
    })
  }, [messages, triageMode, triageMap])

  // Flatten into [group header, …messages] so the virtualizer renders inline
  // date dividers between the rows.
  const rows = useMemo(() => {
    const out = []
    let lastKey = null
    for (const m of visible) {
      const b = bucketFor(m.date)
      if (b.key !== lastKey) { out.push({ type: 'group', key: b.key, label: b.label }); lastKey = b.key }
      out.push({ type: 'msg', msg: m })
    }
    return out
  }, [visible])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i] && rows[i].type === 'group' ? 32 : 76),
    overscan: 8,
  })

  // Infinite scroll: when the last virtual row nears the end, ask for more.
  const items = rowVirtualizer.getVirtualItems()
  useEffect(() => {
    const last = items[items.length - 1]
    if (!last) return
    if (triageMode === 'all' && last.index >= rows.length - 8 && visible.length < total && !loading) {
      onLoadMore()
    }
  }, [items, rows.length, visible.length, total, loading, onLoadMore, triageMode])

  // Keep the selected row scrolled into view when selection changes externally
  // (keyboard nav from the parent).
  useEffect(() => {
    if (selectedUid == null) return
    const idx = rows.findIndex((r) => r.type === 'msg' && r.msg.uid === selectedUid)
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUid])

  const onSearchKey = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); onSearchSubmit() }
    if (e.key === 'Escape') { e.stopPropagation(); onSearchClear() }
  }, [onSearchSubmit, onSearchClear])

  return (
    <div className="pp-mail-listcol">
      {/* search */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 0',
      }}
      >
        <div style={{ position: 'relative', flex: 1 }}>
          <MagnifyingGlass
            aria-hidden
            style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'var(--fg-muted, #a1a1aa)', pointerEvents: 'none',
            }}
          />
          <input
            data-email-search
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={aiAvailable ? 'Search or ask (e.g. unread from Sam)' : 'Search mail'}
            className="pp-field"
            style={{ paddingLeft: 32, paddingRight: 32 }}
          />
          {nlActive ? (
            <Tooltip content="Interpreted with AI">
              <span style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex',
              }}
              >
                <Sparkles style={{ width: 15, height: 15, color: 'var(--pp-accent)' }} />
              </span>
            </Tooltip>
          ) : searchValue ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={onSearchClear}
              className="pp-iconbtn"
              style={{
                position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24,
              }}
            >
              <XMark />
            </button>
          ) : null}
        </div>
        <Tooltip content="Refresh">
          <button type="button" onClick={onRefresh} aria-label="Refresh" disabled={loading} className="pp-iconbtn">
            <ArrowPath className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </div>

      {/* triage / split inbox tabs */}
      {aiAvailable ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 0',
        }}
        >
          <div className="pp-seg" role="tablist" aria-label="Split inbox" style={{ flex: 1 }}>
            {[['all', 'All'], ['important', 'Important'], ['other', 'Other']].map(([val, label]) => (
              <button
                key={val}
                type="button"
                role="tab"
                aria-selected={triageMode === val}
                className="pp-seg-btn"
                style={{ flex: 1 }}
                onClick={() => onTriageModeChange(val)}
              >
                {label}
              </button>
            ))}
          </div>
          <Tooltip content="Re-classify with AI">
            <button
              type="button"
              onClick={onRunTriage}
              aria-label="Run triage"
              disabled={triaging || !messages.length}
              className="pp-iconbtn"
            >
              <Sparkles className={triaging ? 'animate-pulse' : ''} style={triaging ? { color: 'var(--pp-accent)' } : null} />
            </button>
          </Tooltip>
        </div>
      ) : null}

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 15px 8px',
      }}
      >
        <span style={{
          fontSize: 11, fontWeight: 650, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-muted, #71717a)',
        }}
        >
          {searching ? 'Searching…' : folderLabel || 'Mail'}
        </span>
        <span style={{
          fontSize: 11.5, color: 'var(--fg-muted, #a1a1aa)', fontVariantNumeric: 'tabular-nums',
        }}
        >
          {triageMode === 'all' ? `${total || messages.length}` : `${visible.length}`}
        </span>
      </div>

      {/* list */}
      <div ref={parentRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading && messages.length === 0 ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="pp-empty" style={{ padding: '56px 24px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-base, #18181b)' }}>
              {searching ? 'No matches' : 'Nothing here'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--fg-muted, #71717a)' }}>
              {triageMode !== 'all' ? 'Try the All tab or re-run triage.' : 'This folder is empty.'}
            </div>
          </div>
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
            {items.map((vi) => {
              const row = rows[vi.index]
              if (!row) return null
              const common = {
                'data-index': vi.index,
                ref: rowVirtualizer.measureElement,
                style: {
                  position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`,
                },
              }
              if (row.type === 'group') {
                return (
                  <div key={`g-${row.key}`} {...common}>
                    <div className="pp-msg-group">{row.label}</div>
                  </div>
                )
              }
              const { msg } = row
              return (
                <div key={msg.uid} {...common}>
                  <Row
                    msg={msg}
                    active={msg.uid === selectedUid}
                    triage={triageMap ? triageMap[String(msg.uid)] : null}
                    onClick={() => onSelect(msg.uid)}
                    onToggleFlag={onToggleFlag}
                    accountColor={unified ? acctColor[msg.accountId] : null}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
