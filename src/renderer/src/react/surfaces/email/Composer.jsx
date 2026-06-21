// Composer.jsx — compose / reply / forward in a Medusa FocusModal.
//
// Fields: to/cc/bcc, subject, body (textarea v1), attachments (native file
// picker → paths passed to email:send). AI "Draft" streams a body via host.ai.
// Send is routed through the parent's onSend (which implements the few-second
// undo-send hold), so the modal just collects a draft and closes.

import {
  useEffect, useMemo, useRef, useState,
} from 'react'
import {
  FocusModal, Button, Textarea, IconButton, Tooltip, Badge, Text,
} from '@medusajs/ui'
import {
  PaperPlane, PaperClip, XMark, Sparkles, WandSparkle, Trash,
} from '@medusajs/icons'
import { useHost } from '../../host.js'
import { aiAvailable, streamInto, replyDraftPrompt, composePrompt } from './ai.js'
import {
  replySubject, forwardSubject, quoteBody, addressOf, displayName, fmtBytes, messageToContext,
} from './util.js'

// Build the initial draft from a `mode` + optional source message.
// `extra.prefillBody` seeds the body above any quoted text (used by AI quick
// replies). `extra.restore` rehydrates a full payload from an undone send.
function initialDraft(mode, src, account, extra = {}) {
  const base = {
    to: '', cc: '', bcc: '', subject: '', body: '', attachments: [],
    inReplyTo: '', references: '', showCc: false,
  }
  // Restore a previously-held (undone) send verbatim.
  if (extra.restore) {
    const r = extra.restore
    return {
      ...base,
      to: Array.isArray(r.to) ? r.to.join(', ') : (r.to || ''),
      cc: Array.isArray(r.cc) ? r.cc.join(', ') : (r.cc || ''),
      bcc: Array.isArray(r.bcc) ? r.bcc.join(', ') : (r.bcc || ''),
      showCc: !!((r.cc && r.cc.length) || (r.bcc && r.bcc.length)),
      subject: r.subject || '',
      body: r.text || '',
      inReplyTo: r.inReplyTo || '',
      references: r.references || '',
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
    }
  }
  if (!src) {
    return extra.prefillBody ? { ...base, body: extra.prefillBody } : base
  }
  if (mode === 'reply' || mode === 'replyAll') {
    const to = addressOf(src.from)
    let cc = ''
    if (mode === 'replyAll') {
      const me = account ? (account.email || '').toLowerCase() : ''
      const others = []
        .concat(Array.isArray(src.to) ? src.to : [])
        .concat(Array.isArray(src.cc) ? src.cc : [])
        .map(addressOf)
        .filter((a) => a && a.toLowerCase() !== me && a.toLowerCase() !== to.toLowerCase())
      cc = Array.from(new Set(others)).join(', ')
    }
    const lead = extra.prefillBody ? `${extra.prefillBody}\n` : ''
    return {
      ...base,
      to,
      cc,
      showCc: !!cc,
      subject: replySubject(src.subject),
      body: lead + quoteBody(src),
      inReplyTo: src.messageId || '',
      references: [src.references, src.messageId].filter(Boolean).join(' ').trim(),
    }
  }
  if (mode === 'forward') {
    const fwdHeader = `\n\n---------- Forwarded message ----------\nFrom: ${displayName(src.from)} <${addressOf(src.from)}>\nSubject: ${src.subject || ''}\n\n`
    return {
      ...base,
      subject: forwardSubject(src.subject),
      body: fwdHeader + (src.text || ''),
    }
  }
  return base
}

function Recipients({ draft, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="pp-label" htmlFor="pp-compose-to">To</label>
          {!draft.showCc ? (
            <button type="button" className="pp-seg-btn" style={{ marginBottom: 6, padding: '2px 8px' }} onClick={() => set({ showCc: true })}>Cc/Bcc</button>
          ) : null}
        </div>
        <input
          id="pp-compose-to"
          className="pp-field"
          value={draft.to}
          onChange={(e) => set({ to: e.target.value })}
          placeholder="name@example.com, …"
        />
      </div>
      {draft.showCc ? (
        <>
          <div>
            <label className="pp-label" htmlFor="pp-compose-cc">Cc</label>
            <input id="pp-compose-cc" className="pp-field" value={draft.cc} onChange={(e) => set({ cc: e.target.value })} />
          </div>
          <div>
            <label className="pp-label" htmlFor="pp-compose-bcc">Bcc</label>
            <input id="pp-compose-bcc" className="pp-field" value={draft.bcc} onChange={(e) => set({ bcc: e.target.value })} />
          </div>
        </>
      ) : null}
    </div>
  )
}

export default function Composer({
  open, onOpenChange, mode = 'new', source = null, account = null, onSend,
  prefillBody = '', restore = null,
}) {
  const host = useHost()
  const ai = aiAvailable(host)
  const [draft, setDraft] = useState(() => initialDraft(mode, source, account, { prefillBody, restore }))
  const [sending, setSending] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiIntent, setAiIntent] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [inMyVoice, setInMyVoice] = useState(false)
  const cancelRef = useRef(null)
  const fileInputRef = useRef(null)

  // Re-seed when the modal (re)opens for a new mode/source.
  useEffect(() => {
    if (open) {
      setDraft(initialDraft(mode, source, account, { prefillBody, restore }))
      setAiOpen(false); setAiIntent(''); setAiBusy(false)
    }
    return () => { if (cancelRef.current) { try { cancelRef.current() } catch (_e) { /* noop */ } } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, source && source.uid, prefillBody, restore])

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))

  const parseList = (s) => String(s || '')
    .split(/[,;]/).map((x) => x.trim()).filter(Boolean)

  const canSend = useMemo(
    () => parseList(draft.to).length > 0 && !sending,
    [draft.to, sending],
  )

  async function pickAttachments() {
    try {
      const api = host.api
      if (api && typeof api.showOpenDialog === 'function') {
        const res = await api.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
        const paths = (res && (res.filePaths || res.paths)) || (Array.isArray(res) ? res : [])
        if (paths && paths.length) {
          const adds = paths.map((p) => ({ path: p, filename: String(p).split('/').pop(), size: 0 }))
          set({ attachments: draft.attachments.concat(adds) })
        }
        return
      }
    } catch (_e) { /* fall through to <input> */ }
    if (fileInputRef.current) fileInputRef.current.click()
  }

  function onFilePicked(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    // Browser fallback: we can pass name/size; path may be empty (backend should
    // handle gracefully). Electron path picker above is the primary route.
    const adds = files.map((f) => ({ path: f.path || '', filename: f.name, size: f.size }))
    set({ attachments: draft.attachments.concat(adds) })
    e.target.value = ''
  }

  function removeAttachment(i) {
    set({ attachments: draft.attachments.filter((_, idx) => idx !== i) })
  }

  function runAiDraft() {
    if (!ai || aiBusy) return
    setAiBusy(true)
    // Stream into the body. For replies/forwards we keep any quoted text after a
    // marker; for compose we replace the body.
    const originalText = source ? messageToContext(source) : ''
    const prompt = source
      ? replyDraftPrompt({ originalText, intent: aiIntent, inMyVoice })
      : composePrompt({ intent: aiIntent, inMyVoice })
    const quoted = source && mode !== 'forward' ? quoteBody(source) : ''
    let streamed = ''
    if (cancelRef.current) { try { cancelRef.current() } catch (_e) { /* noop */ } }
    cancelRef.current = streamInto(host, prompt, {
      onToken: (_t, acc) => { streamed = acc; set({ body: acc + quoted }) },
      onDone: (full) => {
        set({ body: (full || streamed) + quoted })
        setAiBusy(false); setAiOpen(false)
      },
      onError: () => {
        setAiBusy(false)
        host.toast('AI draft failed', 'error')
      },
    })
  }

  async function doSend() {
    if (!canSend) return
    setSending(true)
    const payload = {
      to: parseList(draft.to),
      cc: parseList(draft.cc),
      bcc: parseList(draft.bcc),
      subject: draft.subject,
      text: draft.body,
      html: '', // textarea v1 — backend can wrap text/plain
      inReplyTo: draft.inReplyTo || undefined,
      references: draft.references || undefined,
      attachments: draft.attachments.map((a) => ({ path: a.path, filename: a.filename })),
    }
    try {
      await onSend(payload) // parent handles undo-send hold + toast
      onOpenChange(false)
    } catch (_e) {
      host.toast('Could not send', 'error')
    } finally {
      setSending(false)
    }
  }

  const title = mode === 'reply' || mode === 'replyAll' ? 'Reply'
    : mode === 'forward' ? 'Forward' : 'New message'

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content className="flex h-full flex-col">
        <FocusModal.Header>
          <div className="flex w-full items-center gap-2">
            <Text size="base" weight="plus" className="text-ui-fg-base">{title}</Text>
            {account ? (
              <Badge size="2xsmall" rounded="full" className="ml-1">{account.email}</Badge>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {ai ? (
                <Tooltip content="Draft with AI — can also pull from your notes & docs">
                  <Button size="small" variant="secondary" onClick={() => setAiOpen((v) => !v)}>
                    <Sparkles /> Draft
                  </Button>
                </Tooltip>
              ) : null}
              <Button size="small" variant="primary" isLoading={sending} disabled={!canSend} onClick={doSend}>
                <PaperPlane /> Send
              </Button>
            </div>
          </div>
        </FocusModal.Header>

        <FocusModal.Body className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
          <Recipients draft={draft} set={set} />

          <div>
            <label className="pp-label" htmlFor="pp-compose-subject">Subject</label>
            <input
              id="pp-compose-subject"
              className="pp-field"
              value={draft.subject}
              onChange={(e) => set({ subject: e.target.value })}
              placeholder="Subject"
            />
          </div>

          {/* AI intent panel */}
          {aiOpen && ai ? (
            <div className="pp-card" style={{ padding: 14, boxShadow: 'var(--pp-shadow-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <WandSparkle style={{ width: 16, height: 16, color: 'var(--pp-accent)' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-base, #18181b)' }}>Draft with AI</span>
                <label style={{
                  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-subtle, #52525b)',
                }}
                >
                  <input type="checkbox" checked={inMyVoice} onChange={(e) => setInMyVoice(e.target.checked)} />
                  Reply in my voice
                </label>
              </div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  className="pp-field"
                  value={aiIntent}
                  onChange={(e) => setAiIntent(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runAiDraft() } }}
                  placeholder={source ? 'What should the reply say? (e.g. accept, propose Friday 2pm)' : 'What should this email say?'}
                />
                <Button size="small" variant="secondary" isLoading={aiBusy} onClick={runAiDraft}>
                  Generate
                </Button>
              </div>
            </div>
          ) : null}

          <Textarea
            value={draft.body}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Write your message…"
            className="min-h-[240px] flex-1 font-sans text-sm"
          />

          {/* attachments */}
          {draft.attachments.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {draft.attachments.map((a, i) => (
                <span
                  key={`${a.filename}-${i}`}
                  className="pp-chip"
                  style={{ gap: 6 }}
                >
                  <PaperClip />
                  <span style={{ fontSize: 11.5, color: 'var(--fg-base, #18181b)' }}>{a.filename}</span>
                  {a.size ? <span style={{ fontSize: 11.5, color: 'var(--fg-muted, #a1a1aa)' }}>{fmtBytes(a.size)}</span> : null}
                  <button type="button" aria-label="Remove attachment" onClick={() => removeAttachment(i)} className="pp-iconbtn" style={{ width: 18, height: 18, marginLeft: 2 }}>
                    <XMark />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </FocusModal.Body>

        <FocusModal.Footer>
          <div className="flex w-full items-center gap-2">
            <Tooltip content="Attach files">
              <IconButton size="small" variant="transparent" onClick={pickAttachments} aria-label="Attach files">
                <PaperClip />
              </IconButton>
            </Tooltip>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilePicked} />
            {draft.body ? (
              <Tooltip content="Clear body">
                <IconButton size="small" variant="transparent" onClick={() => set({ body: '' })} aria-label="Clear body">
                  <Trash />
                </IconButton>
              </Tooltip>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button size="small" variant="secondary" onClick={() => onOpenChange(false)}>Discard</Button>
              <Button size="small" variant="primary" isLoading={sending} disabled={!canSend} onClick={doSend}>
                <PaperPlane /> Send
              </Button>
            </div>
          </div>
        </FocusModal.Footer>
      </FocusModal.Content>
    </FocusModal>
  )
}
