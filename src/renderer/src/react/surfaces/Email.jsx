// Email.jsx — the Email surface (React island, @medusajs/ui).
//
// A 3-pane mail client built to out-pace Superhuman: virtualized list, sandboxed
// HTML rendering, keyboard-first navigation, undo-send, snooze, and an AI layer
// powered by the SAME Company Brain that runs the rest of the app (host.ai).
//
//   left   FolderList   — accounts + special folders + unread badges
//   middle MessageList  — virtualized, newest-first, Split-Inbox triage, NL search
//   right  ReadingPane  — sandboxed body, actions, AI summarize + quick replies
//
// AI features (summarize / draft / triage / NL-search / instant replies) all go
// through host.ai. Five READ/DRAFT brain tools are registered on mount so the
// user can act on mail conversationally from the Brain drawer (never sends).
//
// This file owns cross-pane state + keyboard routing; panes are presentational.

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import {
  TooltipProvider, Button, Text, Drawer,
} from '@medusajs/ui'
import { Envelope } from '@medusajs/icons'
import { useHost } from '../host.js'
import MessageList from './email/MessageList.jsx'
import ReadingPane from './email/ReadingPane.jsx'
import Composer from './email/Composer.jsx'
import AccountWizard from './email/AccountWizard.jsx'
import AiBar, { UndoSendBanner } from './email/AiBar.jsx'
import {
  useAccounts, useFolders, useMessages, useMessage, useEmailEvents, invoke,
  loadLocalQueue, saveLocalQueue,
} from './email/useEmail.js'
import { useBrainTools } from './email/useBrainTools.js'
import {
  aiAvailable, askOnce, triagePrompt, nlSearchPrompt,
} from './email/ai.js'
import { extractJson } from './email/util.js'

const UNDO_SECONDS = 5

export default function Email() {
  const host = useHost()
  const ai = aiAvailable(host)
  const rootRef = useRef(null)

  // Register the shared-brain email tools once.
  useBrainTools(host)

  // ── accounts / folders / messages ──────────────────────────────────────────
  const { accounts, loading: accLoading, refresh: refreshAccounts } = useAccounts(host)
  // `'*'` is the unified "All inboxes" pseudo-account. Initial selection can be
  // seeded by the sidebar (window.__mailNav) so a cold-opened tab lands right.
  const [accountId, setAccountId] = useState(
    () => (typeof window !== 'undefined' && window.__mailNav && window.__mailNav.accountId) || null,
  )
  const isUnified = accountId === '*'
  useEffect(() => {
    if (accountId === '*') return // keep the unified pseudo-account
    if (!accountId && accounts.length) setAccountId(accounts[0].id)
    if (accountId && accounts.length && !accounts.find((a) => a.id === accountId)) setAccountId(accounts[0].id)
  }, [accounts, accountId])
  const account = useMemo(() => accounts.find((a) => a.id === accountId) || null, [accounts, accountId])

  // No per-folder rail in unified mode — the merged inbox IS the view.
  const { folders, refresh: refreshFolders } = useFolders(host, isUnified ? null : accountId)
  const [folder, setFolder] = useState(null)
  useEffect(() => {
    if (!folders.length) { setFolder(null); return }
    const inbox = folders.find((f) => /inbox/i.test(f.specialUse || '') || /^inbox$/i.test(f.name || ''))
    setFolder((cur) => (cur && folders.find((f) => f.path === cur) ? cur : (inbox ? inbox.path : folders[0].path)))
  }, [folders])
  const folderLabel = useMemo(() => {
    if (isUnified) return 'All inboxes'
    const f = folders.find((x) => x.path === folder)
    return f ? (f.name || f.path) : ''
  }, [isUnified, folders, folder])

  // Sentinel folder for the unified path — the main-process handler branches on
  // accountId === '*' and merges every account's Inbox; the list/pager flow is
  // otherwise identical to a single (account, folder) pair.
  const effFolder = isUnified ? '__ALL_INBOXES__' : folder
  const {
    messages, total, loading: msgLoading, reload, loadMore, patch, remove,
  } = useMessages(host, accountId, effFolder)

  // ── selection ───────────────────────────────────────────────────────────────
  // `selectedUid` is always the LIST KEY — a composite `account::folder::uid` in
  // unified mode, a numeric uid otherwise. `selectedRow` is the row it points at;
  // `sel` is the real per-mailbox scope (accountId/folder/uid) used for the body
  // fetch and every per-message IPC. In single-account mode they collapse back to
  // the active (account, folder) pair and a numeric uid.
  const [selectedUid, setSelectedUid] = useState(null)
  useEffect(() => { setSelectedUid(null) }, [accountId, folder])
  const selectedRow = useMemo(
    () => (messages || []).find((m) => m.uid === selectedUid) || null,
    [messages, selectedUid],
  )
  const sel = useMemo(() => {
    if (isUnified && selectedRow) {
      return { accountId: selectedRow.accountId, folder: selectedRow.folder, uid: selectedRow.ruid }
    }
    return { accountId, folder, uid: selectedUid }
  }, [isUnified, selectedRow, accountId, folder, selectedUid])

  const { message, loading: bodyLoading, error: bodyError } = useMessage(host, sel.accountId, sel.folder, sel.uid)
  // the open message's home account — drives avatar colour, attachment fetch and
  // reply identity (in unified mode the surface account is the '*' pseudo-account).
  const selAccount = useMemo(
    () => (isUnified ? (accounts.find((a) => a.id === sel.accountId) || null) : account),
    [isUnified, accounts, sel.accountId, account],
  )
  // the account a NEW/reply message is sent from (falls back to the first mailbox)
  const composeAccount = selAccount || account || accounts[0] || null
  // tag the body with its real folder/account for downstream actions (attachments).
  const fullMessage = useMemo(
    () => (message ? { ...message, folder: sel.folder, accountId: sel.accountId } : null),
    [message, sel.folder, sel.accountId],
  )

  // Mark read on open — optimistic on the LIST key, IPC on the real scope.
  useEffect(() => {
    if (!fullMessage || fullMessage.seen) return
    patch(selectedUid, { seen: true })
    invoke(host, 'email:markRead', {
      accountId: sel.accountId, folder: sel.folder, uid: sel.uid, seen: true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullMessage && fullMessage.uid])

  // ── push events ─────────────────────────────────────────────────────────────
  const [sync, setSync] = useState(null)
  useEmailEvents(
    host,
    useCallback((d) => {
      // Reload the list when the arrival belongs to the view we're showing:
      //  • unified  → any account's Inbox (the event carries a real account id,
      //    never '*', so match on "we're in unified mode" instead).
      //  • single   → our active account + (this folder, or an unspecified one).
      const forUnified = isUnified
      const forSingle = d && d.accountId === accountId && (d.folder === folder || !d.folder)
      if (!d || forUnified || forSingle) reload()
      refreshFolders()
      refreshAccounts()
    }, [isUnified, accountId, folder, reload, refreshFolders, refreshAccounts]),
    useCallback((d) => {
      if (d && d.done) { setSync(null); return }
      setSync(d && d.total ? d : null)
    }, []),
  )

  // Keep the OPEN folder live: re-sync it from the server on an interval so the
  // mailbox the user is actually looking at (Sent, Drafts, a label…) picks up new
  // mail without a click. The main-process poller only watches inboxes; this
  // covers whatever folder is in front of the user. email:new drives the reload.
  useEffect(() => {
    if (!accountId || !effFolder) return undefined
    const t = setInterval(() => {
      invoke(host, 'email:folderSync', { accountId, folder: effFolder })
    }, 45 * 1000)
    return () => clearInterval(t)
  }, [host, accountId, effFolder])

  // ── search (NL-aware) ────────────────────────────────────────────────────────
  const [searchValue, setSearchValue] = useState('')
  const [searchResults, setSearchResults] = useState(null) // null = not searching
  const [searching, setSearching] = useState(false)
  const [nlActive, setNlActive] = useState(false)

  const looksNatural = (q) => (
    /\b(from|to|unread|since|last|today|yesterday|about|regarding|attachment|sent)\b/i.test(q)
    || q.split(/\s+/).length >= 4
  )

  const runSearch = useCallback(async () => {
    const q = searchValue.trim()
    if (!q) { setSearchResults(null); setNlActive(false); return }
    setSearching(true); setNlActive(false)
    let serverQuery = q
    let filter = null
    if (ai && looksNatural(q)) {
      try {
        const raw = await askOnce(host, nlSearchPrompt(q))
        const parsed = extractJson(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          filter = parsed
          setNlActive(true)
          serverQuery = [parsed.from, parsed.subject, parsed.text].filter(Boolean).join(' ') || q
        }
      } catch (_e) { /* fall back to literal search */ }
    }
    const res = await invoke(host, 'email:search', { accountId, query: serverQuery, folder })
    let list = res.ok ? (res.messages || []) : []
    if (filter) {
      if (filter.unreadOnly) list = list.filter((m) => !m.seen)
      if (filter.since) {
        const since = new Date(filter.since).getTime()
        if (Number.isFinite(since)) list = list.filter((m) => new Date(m.date).getTime() >= since)
      }
      if (filter.from) {
        const ff = String(filter.from).toLowerCase()
        list = list.filter((m) => `${m.from && m.from.name} ${m.from && m.from.address}`.toLowerCase().includes(ff))
      }
    }
    if (!res.ok && res.error) host.toast('Search unavailable here', 'warning')
    setSearchResults(list)
    setSearching(false)
  }, [searchValue, ai, host, accountId, folder])

  const clearSearch = useCallback(() => {
    setSearchValue(''); setSearchResults(null); setNlActive(false)
  }, [])

  const listMessages = searchResults != null ? searchResults : messages
  const listTotal = searchResults != null ? searchResults.length : total

  // ── triage / split inbox ─────────────────────────────────────────────────────
  const [triageMode, setTriageMode] = useState('all')
  const [triageMap, setTriageMap] = useState(null)
  const [triaging, setTriaging] = useState(false)
  useEffect(() => { setTriageMap(null); setTriageMode('all') }, [accountId, folder])

  const runTriage = useCallback(async () => {
    if (!ai || triaging) return
    const sample = listMessages.slice(0, 60).map((m) => ({
      uid: m.uid,
      from: (m.from && (m.from.name || m.from.address)) || '',
      subject: m.subject || '',
    }))
    if (!sample.length) return
    setTriaging(true)
    try {
      const raw = await askOnce(host, triagePrompt(sample))
      const parsed = extractJson(raw)
      if (parsed && typeof parsed === 'object') {
        const map = {}
        for (const k of Object.keys(parsed)) {
          const v = String(parsed[k]).toLowerCase()
          map[String(k)] = v.includes('import') ? 'important' : 'other'
        }
        setTriageMap(map)
      } else {
        host.toast('Could not classify', 'warning')
      }
    } catch (_e) {
      host.toast('Triage failed', 'error')
    } finally {
      setTriaging(false)
    }
  }, [ai, triaging, listMessages, host])

  const onTriageModeChange = useCallback((mode) => {
    setTriageMode(mode)
    if (mode !== 'all' && !triageMap && !triaging) runTriage()
  }, [triageMap, triaging, runTriage])

  // ── snooze (local-only) ──────────────────────────────────────────────────────
  const [snoozed, setSnoozed] = useState({}) // uid -> untilTs
  useEffect(() => {
    let alive = true
    loadLocalQueue(host).then((q) => { if (alive) setSnoozed(q.snoozed || {}) })
    return () => { alive = false }
  }, [host])

  const now = Date.now()
  const shownMessages = useMemo(
    () => listMessages.filter((m) => !(snoozed[m.uid] && snoozed[m.uid] > now)),
    [listMessages, snoozed, now],
  )

  // ── selection helpers ────────────────────────────────────────────────────────
  const moveSelectionAfterRemoval = useCallback((uid) => {
    const idx = shownMessages.findIndex((m) => m.uid === uid)
    const next = shownMessages[idx + 1] || shownMessages[idx - 1]
    setSelectedUid(next ? next.uid : null)
  }, [shownMessages])

  const snoozeMsg = useCallback(async (uid, minutes) => {
    const until = Date.now() + minutes * 60000
    const next = { ...snoozed, [uid]: until }
    setSnoozed(next)
    const q = await loadLocalQueue(host)
    q.snoozed = next
    saveLocalQueue(host, q)
    moveSelectionAfterRemoval(uid)
    host.toast(`Snoozed for ${minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`}`, 'success')
  }, [snoozed, host, moveSelectionAfterRemoval])

  // ── message actions ──────────────────────────────────────────────────────────
  // Resolve a list ROW to its real per-mailbox IPC scope. Unified rows carry
  // their own {accountId, folder, ruid}; single-account rows use the active pair.
  const rowScope = useCallback((m) => (
    isUnified && m && m.accountId
      ? { accountId: m.accountId, folder: m.folder, uid: m.ruid }
      : { accountId, folder, uid: m ? m.uid : null }
  ), [isUnified, accountId, folder])

  const toggleFlag = useCallback((m) => {
    if (!m) return
    const flagged = !m.flagged
    patch(m.uid, { flagged }) // m.uid is the list key (composite in unified mode)
    const sc = rowScope(m)
    invoke(host, 'email:flag', {
      accountId: sc.accountId, folder: sc.folder, uid: sc.uid, flagged,
    })
  }, [host, rowScope, patch])

  const markUnread = useCallback(() => {
    if (!fullMessage) return
    patch(selectedUid, { seen: false })
    invoke(host, 'email:markRead', {
      accountId: sel.accountId, folder: sel.folder, uid: sel.uid, seen: false,
    })
  }, [fullMessage, host, sel, selectedUid, patch])

  const archiveMsg = useCallback(async (m) => {
    const target = m || selectedRow
    if (!target) return
    const key = target.uid // list key (composite in unified)
    const sc = rowScope(target)
    const archive = folders.find((f) => /archive/i.test(f.specialUse || '') || /^archive$/i.test(f.name || ''))
    moveSelectionAfterRemoval(key)
    remove(key)
    const res = await invoke(host, 'email:move', {
      accountId: sc.accountId, folder: sc.folder, uid: sc.uid, toFolder: archive ? archive.path : 'Archive',
    })
    if (res.ok) host.toast('Archived', 'success')
    else { host.toast('Archive failed', 'error'); reload() }
  }, [selectedRow, rowScope, folders, host, remove, reload, moveSelectionAfterRemoval])

  const deleteMsg = useCallback(async (m) => {
    const target = m || selectedRow
    if (!target) return
    const key = target.uid
    const sc = rowScope(target)
    moveSelectionAfterRemoval(key)
    remove(key)
    const res = await invoke(host, 'email:delete', {
      accountId: sc.accountId, folder: sc.folder, uid: sc.uid,
    })
    if (res.ok) host.toast('Deleted', 'success')
    else { host.toast('Delete failed', 'error'); reload() }
  }, [selectedRow, rowScope, host, remove, reload, moveSelectionAfterRemoval])

  // ── composer + undo-send ─────────────────────────────────────────────────────
  const [composer, setComposer] = useState(null) // null | {mode, source, prefillBody?, restore?}
  const openCompose = useCallback((mode, source) => setComposer({ mode, source: source || null }), [])

  const [pending, setPending] = useState(null) // {id, payload, secondsLeft, subject}
  const pendingTimer = useRef(null)
  const pendingTick = useRef(null)

  const flushPending = useCallback(async (job) => {
    if (!job) return
    clearTimeout(pendingTimer.current)
    clearInterval(pendingTick.current)
    setPending(null)
    const sendAcct = job.accountId && job.accountId !== '*' ? job.accountId : accountId
    const res = await invoke(host, 'email:send', { accountId: sendAcct, draft: job.payload })
    if (res.ok) {
      host.toast('Sent', 'success')
      const q = await loadLocalQueue(host)
      q.history = (q.history || []).concat([{ at: Date.now(), to: job.payload.to, subject: job.payload.subject }]).slice(-50)
      saveLocalQueue(host, q)
      reload()
    } else {
      host.toast(res.error || 'Send failed', 'error')
    }
  }, [host, accountId, reload])

  // when a job is queued, run the countdown then flush
  useEffect(() => {
    if (!pending) return undefined
    const job = pending
    pendingTimer.current = setTimeout(() => { flushPending(job) }, UNDO_SECONDS * 1000)
    pendingTick.current = setInterval(() => {
      setPending((p) => (p ? { ...p, secondsLeft: Math.max(0, p.secondsLeft - 1) } : p))
    }, 1000)
    return () => { clearTimeout(pendingTimer.current); clearInterval(pendingTick.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending && pending.id])

  const queueSend = useCallback((payload) => {
    setPending({
      id: Date.now(),
      payload,
      subject: payload.subject,
      secondsLeft: UNDO_SECONDS,
      accountId: (composeAccount && composeAccount.id) || null,
    })
    return Promise.resolve()
  }, [composeAccount])

  const undoSend = useCallback(() => {
    clearTimeout(pendingTimer.current)
    clearInterval(pendingTick.current)
    setPending((p) => {
      if (p) {
        host.toast('Send undone — back to drafts', 'info')
        setComposer({ mode: 'new', source: null, restore: p.payload })
      }
      return null
    })
  }, [host])

  // ── keyboard nav (scoped to the surface root) ────────────────────────────────
  const selectRelative = useCallback((delta) => {
    const list = shownMessages
    if (!list.length) return
    const idx = list.findIndex((m) => m.uid === selectedUid)
    const nextIdx = idx < 0 ? 0 : Math.min(list.length - 1, Math.max(0, idx + delta))
    setSelectedUid(list[nextIdx].uid)
  }, [shownMessages, selectedUid])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || ''
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)
      if (e.key === 'Escape') {
        if (composer) { setComposer(null); return }
        if (searchResults != null) { clearSearch(); return }
        if (selectedUid != null && !typing) { setSelectedUid(null) }
        return
      }
      if (typing || composer) return
      if (e.key === '/') {
        e.preventDefault()
        const input = el.querySelector('[data-email-search]')
        if (input) input.focus()
        return
      }
      switch (e.key) {
        case 'j': e.preventDefault(); selectRelative(1); break
        case 'k': e.preventDefault(); selectRelative(-1); break
        case 'Enter':
          if (selectedUid == null && shownMessages[0]) setSelectedUid(shownMessages[0].uid)
          break
        case 'r': if (fullMessage) { e.preventDefault(); openCompose('reply', fullMessage) } break
        case 'a': if (fullMessage) { e.preventDefault(); openCompose('replyAll', fullMessage) } break
        case 'f': if (fullMessage) { e.preventDefault(); openCompose('forward', fullMessage) } break
        case 'e': if (selectedRow) { e.preventDefault(); archiveMsg(selectedRow) } break
        case '#': if (selectedRow) { e.preventDefault(); deleteMsg(selectedRow) } break
        case 'u': if (fullMessage) { e.preventDefault(); markUnread() } break
        case 'h': if (selectedUid != null) { e.preventDefault(); snoozeMsg(selectedUid, 180) } break
        case 'c': e.preventDefault(); openCompose('new', null); break
        default: break
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [
    composer, searchResults, selectedUid, selectedRow, shownMessages, fullMessage,
    selectRelative, clearSearch, openCompose, archiveMsg, deleteMsg, markUnread, snoozeMsg,
  ])

  // ── account management ───────────────────────────────────────────────────────
  const [manageOpen, setManageOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const removeAccount = useCallback(async (id) => {
    const res = await invoke(host, 'email:accountRemove', { id })
    if (res.ok) { host.toast('Account removed', 'success'); refreshAccounts() } else host.toast('Could not remove', 'error')
  }, [host, refreshAccounts])

  // ── one-sidebar bridge ───────────────────────────────────────────────────────
  // Publish the nav (accounts + folders + selection) so the MAIN sidebar paints
  // the Mail rail — there is no second folder column. renderMailNav() in main.js
  // consumes this; its clicks come back as `email:cmd`.
  useEffect(() => {
    const navAccounts = accounts.map((a) => ({
      id: a.id, name: a.name || a.email, email: a.email, color: a.color, unread: a.unread || 0,
    }))
    const navFolders = (folders || []).map((f) => ({
      path: f.path, name: f.name, specialUse: f.specialUse, unread: f.unread || 0,
    }))
    host.emit('email:nav-state', {
      accounts: navAccounts,
      activeAccountId: isUnified ? '*' : accountId,
      folders: navFolders,
      activeFolder: folder,
      unified: isUnified,
    })
  }, [host, accounts, folders, accountId, folder, isUnified])

  // Sidebar → surface commands.
  useEffect(() => {
    const off = host.on('email:cmd', (detail) => {
      if (!detail) return
      switch (detail.type) {
        case 'account': setAccountId(detail.id === '*' ? '*' : detail.id); clearSearch(); break
        case 'folder': if (detail.path) { setFolder(detail.path); clearSearch() } break
        case 'compose': openCompose('new', null); break
        case 'add-account': setAddOpen(true); break
        case 'manage': setManageOpen(true); break
        default: break
      }
    })
    return off
  }, [host, clearSearch, openCompose])

  // Cold-open: apply a folder the sidebar asked for before this tab mounted.
  useEffect(() => {
    const nav = (typeof window !== 'undefined' && window.__mailNav) || null
    if (nav && nav.folder) setFolder(nav.folder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── empty state: no accounts ─────────────────────────────────────────────────
  if (!accLoading && accounts.length === 0) {
    return (
      <TooltipProvider>
        <div ref={rootRef} tabIndex={-1} className="pp-surface" style={{ overflowY: 'auto', outline: 'none' }}>
          <div style={{ width: '100%', maxWidth: 520, margin: '64px auto', padding: '0 24px' }}>
            <div className="pp-card" style={{ padding: '40px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <span className="pp-wizard-mark"><Envelope /></span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Text size="large" weight="plus" className="text-ui-fg-base">Connect your inbox</Text>
                <Text size="small" className="text-ui-fg-subtle">Add any IMAP/SMTP mailbox. Your credentials are encrypted and never leave this device.</Text>
              </div>
              <Button variant="primary" onClick={() => setAddOpen(true)}>Connect an inbox</Button>
            </div>
          </div>
        </div>
        <AccountWizard open={addOpen} onOpenChange={setAddOpen} onAdded={() => { setAddOpen(false); refreshAccounts() }} />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <div ref={rootRef} tabIndex={-1} className="flex h-full w-full flex-col bg-ui-bg-subtle outline-none">
        <AiBar
          title={isUnified ? 'All inboxes' : (account ? (account.name || account.email) : 'Mail')}
          subtitle={isUnified ? `${accounts.length} account${accounts.length === 1 ? '' : 's'}` : (account ? account.email : '')}
          onCompose={() => openCompose('new', null)}
          aiAvailable={ai}
          syncing={!!sync}
          syncLabel={sync ? `Syncing ${sync.done || 0}/${sync.total}` : ''}
        />
        <UndoSendBanner pending={pending} onUndo={undoSend} />

        {/* One sidebar: accounts + folders live in the MAIN app sidebar
            (renderMailNav), so the surface is a 2-pane split — message list
            beside a persistent reading pane. */}
        <div className="pp-mail pp-mail--split">
          <MessageList
            messages={shownMessages}
            total={searchResults != null ? shownMessages.length : listTotal}
            loading={msgLoading}
            selectedUid={selectedUid}
            onSelect={setSelectedUid}
            onToggleFlag={toggleFlag}
            onLoadMore={loadMore}
            onRefresh={() => { reload(); refreshFolders() }}
            folderLabel={folderLabel}
            unified={isUnified}
            accounts={accounts}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSearchSubmit={runSearch}
            onSearchClear={clearSearch}
            searching={searching}
            nlActive={nlActive}
            triageMode={triageMode}
            onTriageModeChange={onTriageModeChange}
            triageMap={triageMap}
            triaging={triaging}
            onRunTriage={runTriage}
            aiAvailable={ai}
          />

          {/* Persistent reading pane beside the list (split view); an empty
              state holds the column when nothing is selected. */}
          {selectedUid != null ? (
            <ReadingPane
              message={fullMessage}
              loading={bodyLoading}
              error={bodyError}
              account={selAccount}
              onClose={() => setSelectedUid(null)}
              onReply={() => fullMessage && openCompose('reply', fullMessage)}
              onReplyAll={() => fullMessage && openCompose('replyAll', fullMessage)}
              onForward={() => fullMessage && openCompose('forward', fullMessage)}
              onArchive={() => archiveMsg(selectedRow)}
              onDelete={() => deleteMsg(selectedRow)}
              onToggleFlag={() => toggleFlag(selectedRow)}
              onMarkUnread={markUnread}
              onSnooze={(mins) => snoozeMsg(selectedUid, mins)}
              onInstantReply={(text) => {
                setComposer({ mode: 'reply', source: fullMessage, prefillBody: text })
              }}
            />
          ) : (
            <div className="pp-mail-empty" role="note">
              <div>Select a conversation to read</div>
            </div>
          )}
        </div>

        {/* composer */}
        {composer ? (
          <Composer
            open={!!composer}
            onOpenChange={(o) => { if (!o) setComposer(null) }}
            mode={composer.mode}
            source={composer.source}
            account={composeAccount}
            prefillBody={composer.prefillBody}
            restore={composer.restore}
            onSend={queueSend}
          />
        ) : null}

        {/* add-account wizard (renders its own FocusModal) */}
        <AccountWizard
          open={addOpen}
          onOpenChange={setAddOpen}
          onAdded={() => { setAddOpen(false); refreshAccounts() }}
        />

        {/* manage-accounts drawer */}
        <Drawer open={manageOpen} onOpenChange={setManageOpen}>
          <Drawer.Content>
            <Drawer.Header><Drawer.Title>Accounts</Drawer.Title></Drawer.Header>
            <Drawer.Body className="space-y-3">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3">
                  <span
                    aria-hidden
                    className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: a.color || '#3b82f6' }}
                  >
                    {(a.name || a.email || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Text size="small" weight="plus" className="truncate text-ui-fg-base">{a.name || a.email}</Text>
                    <Text size="xsmall" className="truncate text-ui-fg-muted">{a.email} · {a.provider || 'imap'}</Text>
                  </div>
                  <Button size="small" variant="danger" onClick={() => removeAccount(a.id)}>Remove</Button>
                </div>
              ))}
              <Button variant="secondary" onClick={() => { setManageOpen(false); setAddOpen(true) }}>Add another account</Button>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer>
      </div>
    </TooltipProvider>
  )
}
