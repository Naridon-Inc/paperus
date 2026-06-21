// useEmail.js — data hooks over the email IPC contract (host.email.invoke).
//
// Everything here is defensive: an unimplemented channel returns {ok:false},
// which we surface as an error string and an empty list rather than throwing.
// The surface stays alive no matter what the backend does.

import { useCallback, useEffect, useRef, useState } from 'react'

// Thin wrapper that never rejects: normalises to {ok, ...} | {ok:false,error}.
export async function invoke(host, channel, payload) {
  try {
    const res = await host.email.invoke(channel, payload || {})
    if (res && typeof res === 'object') return res
    return { ok: false, error: 'Malformed response' }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) }
  }
}

// ── accounts ──────────────────────────────────────────────────────────────────
export function useAccounts(host) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await invoke(host, 'email:accountsList', {})
    if (res.ok) {
      setAccounts(Array.isArray(res.accounts) ? res.accounts : [])
      setError(null)
    } else {
      setAccounts([])
      setError(res.error || 'Could not load accounts')
    }
    setLoading(false)
  }, [host])

  useEffect(() => { refresh() }, [refresh])

  return { accounts, loading, error, refresh, setAccounts }
}

// ── folders for one account ─────────────────────────────────────────────────────
export function useFolders(host, accountId) {
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!accountId) { setFolders([]); return }
    setLoading(true)
    const res = await invoke(host, 'email:folders', { accountId })
    if (res.ok) { setFolders(Array.isArray(res.folders) ? res.folders : []); setError(null) } else {
      setFolders([]); setError(res.error || 'Could not load folders')
    }
    setLoading(false)
  }, [host, accountId])

  useEffect(() => { refresh() }, [refresh])

  return { folders, loading, error, refresh, setFolders }
}

// ── messages for an account+folder (paged, append-on-loadMore) ───────────────────
const PAGE = 50

export function useMessages(host, accountId, folder) {
  const [messages, setMessages] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const offsetRef = useRef(0)
  const reqId = useRef(0)

  const load = useCallback(async (reset) => {
    if (!accountId || !folder) { setMessages([]); setTotal(0); return }
    const mine = ++reqId.current
    setLoading(true)
    const offset = reset ? 0 : offsetRef.current
    const res = await invoke(host, 'email:messages', {
      accountId, folder, offset, limit: PAGE,
    })
    if (mine !== reqId.current) return // a newer request superseded us
    if (res.ok) {
      const batch = Array.isArray(res.messages) ? res.messages : []
      offsetRef.current = offset + batch.length
      setMessages((prev) => (reset ? batch : prev.concat(batch)))
      setTotal(Number(res.total) || (reset ? batch.length : offsetRef.current))
      setError(null)
      // Warm the newest bodies for this mailbox in the background so the next
      // click opens instantly (cache fill is detached; we ignore the result).
      if (reset) invoke(host, 'email:prefetch', { accountId, folder })
      // Also sync THIS folder from the server (detached) so opening any folder —
      // Sent, Drafts, Spam, Trash — pulls its latest mail newest-first, not just
      // whatever happened to be cached. email:new drives the follow-up reload.
      if (reset) invoke(host, 'email:folderSync', { accountId, folder })
    } else if (reset) {
      setMessages([]); setTotal(0); setError(res.error || 'Could not load mail')
    }
    setLoading(false)
  }, [host, accountId, folder])

  // reset whenever the account/folder changes
  useEffect(() => { offsetRef.current = 0; load(true) }, [load])

  const loadMore = useCallback(() => {
    if (loading) return
    if (offsetRef.current >= total) return
    load(false)
  }, [load, loading, total])

  // Optimistic local mutation (mark read/flag/remove) without a round-trip.
  const patch = useCallback((uid, fields) => {
    setMessages((prev) => prev.map((m) => (m.uid === uid ? { ...m, ...fields } : m)))
  }, [])
  const remove = useCallback((uid) => {
    setMessages((prev) => prev.filter((m) => m.uid !== uid))
    setTotal((t) => Math.max(0, t - 1))
  }, [])

  return {
    messages, total, loading, error, reload: () => load(true), loadMore, patch, remove, setMessages,
  }
}

// ── a single full message (lazy, cached by key) ──────────────────────────────────
export function useMessage(host, accountId, folder, uid) {
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const reqId = useRef(0)

  useEffect(() => {
    if (!accountId || !folder || uid == null) { setMessage(null); setError(null); return undefined }
    const mine = ++reqId.current
    let alive = true
    setLoading(true); setMessage(null); setError(null)
    invoke(host, 'email:message', { accountId, folder, uid }).then((res) => {
      if (!alive || mine !== reqId.current) return
      if (res.ok && res.message) setMessage(res.message)
      else setError(res.error || 'Could not open message')
      setLoading(false)
    })
    return () => { alive = false }
  }, [host, accountId, folder, uid])

  return { message, loading, error }
}

// ── push events (email:new / email:syncProgress) ────────────────────────────────
export function useEmailEvents(host, onNew, onProgress) {
  useEffect(() => {
    const offs = []
    if (typeof host.on === 'function') {
      if (onNew) offs.push(host.on('email:new', (d) => onNew(d || {})))
      if (onProgress) offs.push(host.on('email:syncProgress', (d) => onProgress(d || {})))
    }
    return () => offs.forEach((off) => { try { off() } catch (_e) { /* noop */ } })
  }, [host, onNew, onProgress])
}

// ── local-only queue persistence (undo-send / snooze) ────────────────────────────
// We persist a tiny JSON blob through window.api.setSettings, per the brief —
// the backend never sees these client-side timers.
const LOCAL_KEY = 'email_local_queue'

export async function loadLocalQueue(host) {
  try {
    const api = host.api
    if (api && typeof api.getSettings === 'function') {
      const raw = await api.getSettings(LOCAL_KEY)
      if (raw && typeof raw === 'object') return raw
      if (typeof raw === 'string' && raw) return JSON.parse(raw)
    }
  } catch (_e) { /* fall through */ }
  return { snoozed: {}, history: [] }
}

export async function saveLocalQueue(host, data) {
  try {
    const api = host.api
    if (api && typeof api.setSettings === 'function') await api.setSettings(LOCAL_KEY, data)
  } catch (_e) { /* best-effort */ }
}
