// useCalendar.js — data hooks over the calendar IPC contract
// (host.calendar.invoke). Mirrors email/useEmail.js exactly in spirit:
// everything is defensive — an unimplemented channel returns {ok:false}, which
// we surface as an error string + an empty list rather than throwing, so the
// notes-derived calendar keeps working when no external account exists.

import { useCallback, useEffect, useRef, useState } from 'react'

// Thin wrapper that never rejects: normalises to {ok, ...} | {ok:false,error}.
// Routes over host.calendar (the dedicated namespace added in host-bridge.js).
export async function invoke(host, channel, payload) {
  try {
    const res = await host.calendar.invoke(channel, payload || {})
    if (res && typeof res === 'object') return res
    return { ok: false, error: 'Malformed response' }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) }
  }
}

// Subscribe to the push channel main emits when remote calendars change. Returns
// an unsubscribe fn (or a noop). Shared by every hook below so any CalDAV sync
// refetches the surface.
function onCalendarChanged(host, cb) {
  if (!host || typeof host.on !== 'function') return () => {}
  return host.on('calendar:changed', cb)
}

// ── accounts ──────────────────────────────────────────────────────────────────
export function useCalAccounts(host) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await invoke(host, 'calendar:accountsList', {})
    if (res.ok) {
      setAccounts(Array.isArray(res.accounts) ? res.accounts : [])
      setError(null)
    } else {
      setAccounts([])
      setError(res.error || 'Could not load calendar accounts')
    }
    setLoading(false)
  }, [host])

  useEffect(() => { refresh() }, [refresh])
  // Refetch on remote change pushes.
  useEffect(() => onCalendarChanged(host, refresh), [host, refresh])

  return {
    accounts, loading, error, refresh, setAccounts,
  }
}

// ── calendars (optionally scoped to one account) ─────────────────────────────────
export function useCalendars(host, accountId) {
  const [calendars, setCalendars] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await invoke(host, 'calendar:calendars', accountId ? { accountId } : {})
    if (res.ok) {
      setCalendars(Array.isArray(res.calendars) ? res.calendars : [])
      setError(null)
    } else {
      setCalendars([])
      setError(res.error || 'Could not load calendars')
    }
    setLoading(false)
  }, [host, accountId])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => onCalendarChanged(host, refresh), [host, refresh])

  // Optimistic visibility toggle without a full round-trip; persisted via IPC.
  const setVisible = useCallback(async (calendarId, visible) => {
    setCalendars((prev) => prev.map((c) => (c.id === calendarId ? { ...c, visible } : c)))
    await invoke(host, 'calendar:calendarSetVisible', { calendarId, visible })
  }, [host])

  return {
    calendars, loading, error, refresh, setVisible, setCalendars,
  }
}

// ── external events for a date range ─────────────────────────────────────────────
// Returns events normalised to the calendar surface's pill shape:
//   { dueISO, startISO, endISO, title, allDay, calendarId, color, source:'caldav' }
// `dueISO` is the start day (YYYY-MM-DD) so date-index.js can bucket it directly.
export function useExternalEvents(host, startISO, endISO, accountId) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const reqId = useRef(0)

  const refresh = useCallback(async () => {
    if (!startISO || !endISO) { setEvents([]); return }
    const mine = ++reqId.current
    setLoading(true)
    const payload = { startISO, endISO }
    if (accountId) payload.accountId = accountId
    const res = await invoke(host, 'calendar:events', payload)
    if (mine !== reqId.current) return // a newer range superseded us
    if (res.ok) {
      const list = Array.isArray(res.events) ? res.events : []
      setEvents(list.map((e) => normalizeEvent(e)))
      setError(null)
    } else {
      setEvents([])
      setError(res.error || null)
    }
    setLoading(false)
  }, [host, startISO, endISO, accountId])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => onCalendarChanged(host, refresh), [host, refresh])

  return {
    events, loading, error, refresh,
  }
}

// Map a raw IPC event to the surface/date-index pill shape. `dueISO` (start day)
// is derived from startISO so the day-bucket key is always present.
function normalizeEvent(e) {
  const start = (e && e.startISO) ? String(e.startISO) : ''
  const dueISO = /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : ''
  return {
    id: e && e.id,
    uid: e && e.uid,
    calendarId: e && e.calendarId,
    accountId: e && e.accountId,
    title: (e && e.title) || '(untitled)',
    startISO: start,
    endISO: (e && e.endISO) ? String(e.endISO) : '',
    allDay: !!(e && e.allDay),
    location: (e && e.location) || '',
    color: (e && e.color) || '',
    dueISO,
    source: 'caldav',
  }
}
