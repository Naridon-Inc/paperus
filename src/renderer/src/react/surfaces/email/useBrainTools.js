// useBrainTools.js — register email read/draft tools on the shared Company Brain.
//
// These let the user act on mail conversationally from the Brain drawer. Per the
// brief: READ/DRAFT ONLY. Nothing here sends, deletes, moves, or flags mail — no
// silent outbound. Every handler returns STRUCTURED data and never throws.
//
// Registered once on mount, guarded against double-registration (StrictMode /
// remounts) via a module-level set keyed by the brain instance.

import { useEffect } from 'react'
import { invoke } from './useEmail.js'
import {
  displayName, addressOf, bestBody, messageToContext,
} from './util.js'
import { aiAvailable, askOnce, replyDraftPrompt } from './ai.js'

const registered = new WeakSet() // brain engine objects we've already registered on

// Pick a default account id when the tool args omit one.
async function resolveAccountId(host, accountId) {
  if (accountId) return accountId
  const res = await invoke(host, 'email:accountsList', {})
  if (res.ok && Array.isArray(res.accounts) && res.accounts.length) return res.accounts[0].id
  return null
}

async function firstInboxFolder(host, accountId) {
  const res = await invoke(host, 'email:folders', { accountId })
  if (!res.ok || !Array.isArray(res.folders)) return 'INBOX'
  const inbox = res.folders.find(
    (f) => /inbox/i.test(f.specialUse || '') || /^inbox$/i.test(f.name || ''),
  )
  return (inbox && inbox.path) || (res.folders[0] && res.folders[0].path) || 'INBOX'
}

function summarizeMsg(m) {
  return {
    uid: m.uid,
    from: displayName(m.from) || addressOf(m.from),
    fromAddress: addressOf(m.from),
    subject: m.subject || '',
    date: m.date,
    seen: !!m.seen,
    flagged: !!m.flagged,
    hasAttachments: !!m.hasAttachments,
    snippet: m.snippet || '',
  }
}

export function useBrainTools(host) {
  useEffect(() => {
    if (!host || !host.ai || typeof host.ai.registerTool !== 'function') return undefined
    const brain = host.getBrain ? host.getBrain() : null
    // Guard: register only once per brain instance.
    if (brain && registered.has(brain)) return undefined
    if (brain) registered.add(brain)

    const tools = [
      {
        id: 'email_list_unread',
        description: 'List unread emails in the user\'s inbox. Returns an array of message summaries (uid, from, subject, date, snippet). Read-only.',
        parameters: {
          type: 'object',
          properties: {
            accountId: { type: 'string', description: 'Optional account id; defaults to the first account.' },
            limit: { type: 'number', description: 'Max messages to return (default 20).' },
          },
        },
        source: 'email',
        handler: async (args = {}) => {
          const accountId = await resolveAccountId(host, args.accountId)
          if (!accountId) return { ok: false, error: 'No mail account configured', unread: [] }
          const folder = await firstInboxFolder(host, accountId)
          const res = await invoke(host, 'email:messages', {
            accountId, folder, offset: 0, limit: Math.min(Number(args.limit) || 20, 100),
          })
          if (!res.ok) return { ok: false, error: res.error || 'Could not list mail', unread: [] }
          const unread = (res.messages || []).filter((m) => !m.seen).map(summarizeMsg)
          return { ok: true, accountId, folder, count: unread.length, unread }
        },
      },
      {
        id: 'email_get_thread',
        description: 'Fetch the full text of a single email by uid (subject, sender, recipients, body). Read-only.',
        parameters: {
          type: 'object',
          properties: {
            accountId: { type: 'string' },
            folder: { type: 'string', description: 'Folder path the message lives in.' },
            uid: { type: ['string', 'number'], description: 'The message uid.' },
          },
          required: ['folder', 'uid'],
        },
        source: 'email',
        handler: async (args = {}) => {
          const accountId = await resolveAccountId(host, args.accountId)
          if (!accountId) return { ok: false, error: 'No mail account configured' }
          const res = await invoke(host, 'email:message', { accountId, folder: args.folder, uid: args.uid })
          if (!res.ok || !res.message) return { ok: false, error: res.error || 'Message not found' }
          const m = res.message
          return {
            ok: true,
            uid: m.uid,
            from: { name: displayName(m.from), address: addressOf(m.from) },
            subject: m.subject || '',
            date: m.date,
            body: bestBody(m),
            context: messageToContext(m),
          }
        },
      },
      {
        id: 'email_search_mail',
        description: 'Search the user\'s mail for a query string. Returns matching message summaries. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            accountId: { type: 'string' },
            query: { type: 'string', description: 'Search terms (sender, subject, or body keywords).' },
            folder: { type: 'string', description: 'Optional folder to scope the search.' },
          },
          required: ['query'],
        },
        source: 'email',
        handler: async (args = {}) => {
          const accountId = await resolveAccountId(host, args.accountId)
          if (!accountId) return { ok: false, error: 'No mail account configured', results: [] }
          const res = await invoke(host, 'email:search', {
            accountId, query: String(args.query || ''), folder: args.folder,
          })
          if (!res.ok) return { ok: false, error: res.error || 'Search unavailable', results: [] }
          return { ok: true, count: (res.messages || []).length, results: (res.messages || []).map(summarizeMsg) }
        },
      },
      {
        id: 'email_draft_reply',
        description: 'Draft (but DO NOT send) a reply to an email. Returns the drafted reply text as a string. The user reviews and sends it manually.',
        parameters: {
          type: 'object',
          properties: {
            accountId: { type: 'string' },
            folder: { type: 'string' },
            uid: { type: ['string', 'number'] },
            intent: { type: 'string', description: 'What the reply should convey.' },
          },
          required: ['folder', 'uid'],
        },
        source: 'email',
        handler: async (args = {}) => {
          const accountId = await resolveAccountId(host, args.accountId)
          if (!accountId) return { ok: false, error: 'No mail account configured' }
          const res = await invoke(host, 'email:message', { accountId, folder: args.folder, uid: args.uid })
          if (!res.ok || !res.message) return { ok: false, error: res.error || 'Message not found' }
          if (!aiAvailable(host)) return { ok: false, error: 'AI brain unavailable' }
          let draft = ''
          try {
            draft = await askOnce(host, replyDraftPrompt({
              originalText: messageToContext(res.message),
              intent: args.intent || 'reply appropriately',
            }))
          } catch (e) {
            return { ok: false, error: (e && e.message) || 'Draft failed' }
          }
          return {
            ok: true, sent: false, draft, note: 'Draft only — not sent. Open the composer to review and send.',
          }
        },
      },
      {
        id: 'email_summarize_inbox',
        description: 'Summarize the state of the inbox: unread count, total, and the top senders. Read-only.',
        parameters: {
          type: 'object',
          properties: { accountId: { type: 'string' } },
        },
        source: 'email',
        handler: async (args = {}) => {
          const accountId = await resolveAccountId(host, args.accountId)
          if (!accountId) return { ok: false, error: 'No mail account configured' }
          const folder = await firstInboxFolder(host, accountId)
          const res = await invoke(host, 'email:messages', {
            accountId, folder, offset: 0, limit: 100,
          })
          if (!res.ok) return { ok: false, error: res.error || 'Could not read inbox' }
          const msgs = res.messages || []
          const unread = msgs.filter((m) => !m.seen)
          const counts = {}
          for (const m of msgs) {
            const key = addressOf(m.from) || displayName(m.from) || 'unknown'
            counts[key] = (counts[key] || 0) + 1
          }
          const topSenders = Object.entries(counts)
            .sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([sender, count]) => ({ sender, count }))
          return {
            ok: true,
            accountId,
            folder,
            total: Number(res.total) || msgs.length,
            unreadCount: unread.length,
            topSenders,
            unreadSubjects: unread.slice(0, 10).map((m) => m.subject || '(no subject)'),
          }
        },
      },
    ]

    const unregs = []
    for (const t of tools) {
      try {
        const u = host.ai.registerTool(t)
        if (typeof u === 'function') unregs.push(u)
      } catch (_e) { /* never throw on registration */ }
    }

    // Best-effort cleanup if the brain exposes unregister handles.
    return () => {
      for (const u of unregs) { try { u() } catch (_e) { /* noop */ } }
      // keep the WeakSet entry: if the brain persists, we don't want to
      // double-register on a transient remount; the brain dedupes by id anyway.
    }
  }, [host])
}
