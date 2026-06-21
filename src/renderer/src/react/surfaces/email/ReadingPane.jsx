// ReadingPane.jsx — right column: full message + actions + AI (summarize +
// instant replies). HTML is rendered through the sandboxed SafeHtmlView.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, Tooltip, Skeleton, DropdownMenu,
} from '@medusajs/ui'
import {
  ArrowUturnLeft, ForwardSolid, ArchiveBox, Trash, Star, StarSolid, EnvelopeSolid,
  Sparkles, PaperClip, ArrowDownTray, Users, WandSparkle, XMark, Clock,
} from '@medusajs/icons'
import { useHost } from '../../host.js'
import SafeHtmlView from './SafeHtmlView.jsx'
import {
  aiAvailable, streamInto, summarizePrompt, instantRepliesPrompt,
} from './ai.js'
import {
  fullTime, displayName, addressOf, initials, fmtBytes, messageToContext, parseLines,
} from './util.js'

function Recipient({ people, prefix }) {
  if (!people || (Array.isArray(people) && !people.length)) return null
  const list = Array.isArray(people) ? people : [people]
  return (
    <div style={{ fontSize: 12, color: 'var(--fg-muted, #71717a)', marginTop: 2 }}>
      {prefix}
      {' '}
      {list.map((p) => displayName(p) || addressOf(p)).join(', ')}
    </div>
  )
}

export default function ReadingPane({
  message, loading, error, account, onReply, onReplyAll, onForward, onArchive, onDelete, onToggleFlag, onMarkUnread,
  onInstantReply, onSnooze, onClose,
}) {
  const host = useHost()
  const ai = aiAvailable(host)

  // Summary state
  const [summary, setSummary] = useState('')
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  // Instant replies
  const [replies, setReplies] = useState([])
  const [repliesBusy, setRepliesBusy] = useState(false)
  const cancelRef = useRef(null)

  // Reset AI artifacts whenever the open message changes.
  useEffect(() => {
    setSummary(''); setSummaryOpen(false); setSummaryBusy(false); setReplies([])
    if (cancelRef.current) { try { cancelRef.current() } catch (_e) { /* noop */ } cancelRef.current = null }
  }, [message && message.uid])

  const context = useMemo(() => (message ? messageToContext(message) : ''), [message])

  function summarize() {
    if (!ai || summaryBusy) return
    setSummaryOpen(true); setSummaryBusy(true); setSummary('')
    cancelRef.current = streamInto(host, summarizePrompt(context), {
      onToken: (_t, acc) => setSummary(acc),
      onDone: (full) => { setSummary(full); setSummaryBusy(false) },
      onError: () => { setSummaryBusy(false); host.toast('Summary failed', 'error') },
    })
  }

  function suggestReplies() {
    if (!ai || repliesBusy) return
    setRepliesBusy(true)
    let acc = ''
    streamInto(host, instantRepliesPrompt(context), {
      onToken: (_t, a) => { acc = a },
      onDone: (full) => { setReplies(parseLines(full || acc, 3)); setRepliesBusy(false) },
      onError: () => { setRepliesBusy(false) },
    })
  }

  async function saveAttachment(att) {
    if (!message) return
    const res = await host.email.invoke('email:attachmentSave', {
      accountId: account && account.id,
      folder: message.folder || undefined,
      uid: message.uid,
      partId: att.partId,
      filename: att.filename,
    }).catch((e) => ({ ok: false, error: e.message }))
    if (res && res.ok) host.toast(`Saved ${att.filename}`, 'success')
    else host.toast('Could not save attachment', 'error')
  }

  if (loading) {
    return (
      <div className="pp-mail-read">
        <div className="pp-read-body">
          <div className="pp-read-card" style={{ padding: 24 }}>
            <Skeleton className="h-6 w-2/3 rounded" />
            <div style={{ height: 12 }} />
            <Skeleton className="h-4 w-1/3 rounded" />
            <div style={{ height: 20 }} />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="pp-mail-read">
        <div className="pp-empty">
          <div className="pp-empty-icon"><EnvelopeSolid /></div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-base, #18181b)' }}>Could not open message</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-muted, #71717a)', maxWidth: 340 }}>{error}</div>
        </div>
      </div>
    )
  }

  if (!message) {
    return (
      <div className="pp-mail-read">
        <div className="pp-empty">
          <div className="pp-empty-icon"><EnvelopeSolid /></div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-base, #18181b)' }}>Select a message to read</div>
          <div style={{ fontSize: 13, color: 'var(--fg-subtle, #52525b)', maxWidth: 340 }}>
            Pick a message — or press <span className="pp-kbd">j</span>/<span className="pp-kbd">k</span> to move, <span className="pp-kbd">Enter</span> to open.
          </div>
        </div>
      </div>
    )
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments : []

  return (
    <div className="pp-mail-read">
      {/* header: subject + meta + action toolbar */}
      <div className="pp-read-head">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {onClose ? (
            <Tooltip content="Close (Esc)">
              <button type="button" className="pp-iconbtn" onClick={onClose} aria-label="Close" style={{ marginTop: 1, flex: 'none' }}><XMark /></button>
            </Tooltip>
          ) : null}
          <div className="pp-read-subject" style={{ flex: 1, minWidth: 0 }}>{message.subject || '(no subject)'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 1, flex: 'none' }}>
            <Tooltip content="Reply (r)">
              <button type="button" className="pp-iconbtn" onClick={onReply} aria-label="Reply"><ArrowUturnLeft /></button>
            </Tooltip>
            <Tooltip content="Reply all">
              <button type="button" className="pp-iconbtn" onClick={onReplyAll} aria-label="Reply all"><Users /></button>
            </Tooltip>
            <Tooltip content="Forward">
              <button type="button" className="pp-iconbtn" onClick={onForward} aria-label="Forward"><ForwardSolid /></button>
            </Tooltip>
            <span style={{ width: 1, height: 18, background: 'var(--pp-line)', margin: '0 4px' }} />
            <Tooltip content="Archive (e)">
              <button type="button" className="pp-iconbtn" onClick={onArchive} aria-label="Archive"><ArchiveBox /></button>
            </Tooltip>
            <Tooltip content="Delete (#)">
              <button type="button" className="pp-iconbtn" onClick={onDelete} aria-label="Delete"><Trash /></button>
            </Tooltip>
            <Tooltip content={message.flagged ? 'Unstar' : 'Star'}>
              <button type="button" className="pp-iconbtn" onClick={() => onToggleFlag(message)} aria-label="Star">
                {message.flagged ? <StarSolid style={{ color: 'var(--tag-amber-icon, #d97706)' }} /> : <Star />}
              </button>
            </Tooltip>
            <Tooltip content="Mark unread (u)">
              <button type="button" className="pp-iconbtn" onClick={onMarkUnread} aria-label="Mark unread"><EnvelopeSolid /></button>
            </Tooltip>
            {onSnooze ? (
              <DropdownMenu>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="pp-iconbtn" aria-label="Snooze"><Clock /></button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  <DropdownMenu.Label>Snooze until…</DropdownMenu.Label>
                  <DropdownMenu.Item onClick={() => onSnooze(60)}>In 1 hour</DropdownMenu.Item>
                  <DropdownMenu.Item onClick={() => onSnooze(180)}>In 3 hours</DropdownMenu.Item>
                  <DropdownMenu.Item onClick={() => onSnooze(60 * 24)}>Tomorrow</DropdownMenu.Item>
                  <DropdownMenu.Item onClick={() => onSnooze(60 * 24 * 7)}>Next week</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu>
            ) : null}
            {ai ? (
              <>
                <span style={{ width: 1, height: 18, background: 'var(--pp-line)', margin: '0 4px' }} />
                <Tooltip content="Summarize with AI">
                  <Button size="small" variant="secondary" onClick={summarize} isLoading={summaryBusy}>
                    <Sparkles /> Summarize
                  </Button>
                </Tooltip>
              </>
            ) : null}
          </div>
        </div>

        {/* sender meta */}
        <div className="pp-read-meta">
          <span
            aria-hidden
            className="pp-avatar pp-avatar--sm pp-avatar--sq"
            style={{ background: (account && account.color) || 'var(--pp-accent)' }}
          >
            {initials(message.from)}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-base, #18181b)' }}>{displayName(message.from) || addressOf(message.from)}</span>
              <span style={{ fontSize: 12, color: 'var(--fg-muted, #71717a)' }}>{addressOf(message.from)}</span>
              <span style={{
                fontSize: 12, color: 'var(--fg-muted, #a1a1aa)', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums',
              }}
              >
                {fullTime(message.date)}
              </span>
            </div>
            <Recipient people={message.to} prefix="To:" />
            <Recipient people={message.cc} prefix="Cc:" />
          </div>
        </div>
      </div>

      <div className="pp-read-body">
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {/* AI summary panel */}
          {summaryOpen ? (
            <div className="pp-card" style={{ padding: 16, marginBottom: 16, boxShadow: 'var(--pp-shadow-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <WandSparkle style={{ width: 15, height: 15, color: 'var(--pp-accent)' }} />
                <span style={{
                  fontSize: 11, fontWeight: 650, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-muted, #71717a)',
                }}
                >
                  AI summary
                </span>
                <button type="button" aria-label="Close summary" onClick={() => setSummaryOpen(false)} className="pp-iconbtn" style={{ marginLeft: 'auto', width: 24, height: 24 }}><XMark /></button>
              </div>
              <pre style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55, color: 'var(--fg-base, #18181b)', margin: 0,
              }}
              >
                {summary || (summaryBusy ? 'Thinking…' : '')}
              </pre>
            </div>
          ) : null}

          {/* body */}
          <div className="pp-read-card" style={{ padding: 20 }}>
            <SafeHtmlView html={message.html} text={message.text} />
          </div>

          {/* attachments */}
          {attachments.length > 0 ? (
            <div style={{ marginTop: 20, borderTop: '1px solid var(--pp-line)', paddingTop: 16 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted, #71717a)',
              }}
              >
                <PaperClip style={{ width: 13, height: 13 }} />
                {' '}
                {attachments.length} attachment{attachments.length > 1 ? 's' : ''}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {attachments.map((a) => (
                  <button
                    key={a.partId || a.filename}
                    type="button"
                    onClick={() => saveAttachment(a)}
                    className="pp-chip pp-chip--btn"
                    style={{ maxWidth: 280, padding: '6px 10px', gap: 8 }}
                  >
                    <PaperClip />
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left' }}>
                      <span style={{
                        fontSize: 12, color: 'var(--fg-base, #18181b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      >
                        {a.filename}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--fg-muted, #a1a1aa)' }}>{a.mime || ''} · {fmtBytes(a.size)}</span>
                    </span>
                    <ArrowDownTray style={{ marginLeft: 'auto' }} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* instant AI replies */}
          {ai ? (
            <div style={{ marginTop: 20, borderTop: '1px solid var(--pp-line)', paddingTop: 16 }}>
              {replies.length === 0 ? (
                <Button size="small" variant="transparent" onClick={suggestReplies} isLoading={repliesBusy}>
                  <Sparkles /> Suggest quick replies
                </Button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 650, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-muted, #71717a)',
                  }}
                  >
                    Quick replies
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {replies.map((r, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onInstantReply(r)}
                        className="pp-chip pp-chip--btn pp-chip--accent"
                        style={{ maxWidth: '100%', padding: '5px 11px', fontSize: 12.5 }}
                      >
                        {r}
                      </button>
                    ))}
                    <button type="button" onClick={suggestReplies} className="pp-chip pp-chip--btn" style={{ padding: '5px 9px' }}>↻ regenerate</button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
