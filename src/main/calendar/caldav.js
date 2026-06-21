/**
 * Calendar subsystem — CalDAV operations layer (tsdav + ICAL.js, on top of Store).
 *
 * Responsibilities:
 *  - testConnection(probe): build a throwaway DAVClient, login (discover
 *      principal + home-set), fetchCalendars; return the discovered calendar
 *      list. Used for the "Test" button — nothing is persisted.
 *  - discoverCalendars(account): login, fetchCalendars, upsert into store.calendars.
 *  - syncCalendar(account, calendar): fetchCalendarObjects (skipping work when the
 *      remote ctag is unchanged), parse each VEVENT with ICAL.js, store the base
 *      event row (+ rrule + raw ics). Returns the number of events stored.
 *  - expandEvents(rows, startTs, endTs): expand recurrences with ICAL.js ONLY
 *      within [startTs,endTs]; return flat instances.
 *  - createEvent / updateEvent / deleteEvent: build an ICS VCALENDAR/VEVENT with
 *      ICAL.js and call the matching tsdav create/update/deleteCalendarObject.
 *
 * tsdav (DAVClient) and ical.js are pure-JS and externalized in the main build:
 *  - tsdav exposes `DAVClient` as a named ESM export.
 *  - ical.js is ESM; its default export is the ICAL namespace.
 * The decrypted password lives only inside the DAVClient credentials object in
 * main-process memory — it is never returned, serialized, or logged here.
 *
 * All functions assume a usable account/calendar and let errors propagate to the
 * IPC layer for `{ ok:false }` mapping.
 */

import { DAVClient } from 'tsdav'
import ICAL from 'ical.js'

import crypto from 'crypto'
import { Store } from './store.js'
import { buildDavConfig } from './accounts.js'

// Cap per-sync event parses so a brand-new huge calendar doesn't block forever.
const MAX_EVENTS_PER_SYNC = 5000

// ---------------------------------------------------------------------------
// DAVClient construction
// ---------------------------------------------------------------------------

/**
 * Build + login a DAVClient from a `{ serverUrl, credentials:{username,password} }`
 * config. Always Basic auth against a CalDAV server (app-specific password).
 * Throws if serverUrl/credentials are missing or login fails.
 */
async function makeClient(cfg) {
  if (!cfg || !cfg.serverUrl) throw new Error('CalDAV server URL not configured')
  if (!cfg.credentials || !cfg.credentials.username || !cfg.credentials.password) {
    throw new Error('CalDAV username and password required')
  }
  const client = new DAVClient({
    serverUrl: cfg.serverUrl,
    credentials: {
      username: cfg.credentials.username,
      password: cfg.credentials.password,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  })
  // login() discovers the principal URL + calendar-home-set.
  await client.login()
  return client
}

/** Build + login a DAVClient for a stored account id. */
async function clientForAccount(accountId) {
  const cfg = buildDavConfig(accountId)
  if (!cfg) throw new Error('account config or password missing')
  return makeClient(cfg)
}

// ---------------------------------------------------------------------------
// shape helpers
// ---------------------------------------------------------------------------

/** tsdav displayName can be a string or an xml-js object; coerce to a string. */
function calName(cal) {
  const dn = cal && cal.displayName
  if (typeof dn === 'string' && dn) return dn
  if (dn && typeof dn === 'object') {
    // xml-js compact text node, e.g. { _text: 'Home' } or { '#text': 'Home' }.
    const t = dn._text ?? dn['#text'] ?? dn._cdata
    if (typeof t === 'string' && t) return t
  }
  // Fall back to the last non-empty URL path segment.
  const url = (cal && cal.url) || ''
  const seg = url.replace(/\/+$/, '').split('/').filter(Boolean).pop()
  return seg ? decodeURIComponent(seg) : 'Calendar'
}

/** Normalize a tsdav calendar to a renderer/store-friendly descriptor. */
function toCalDescriptor(cal) {
  return {
    url: cal.url,
    name: calName(cal),
    color: (cal.calendarColor && String(cal.calendarColor)) || null,
    ctag: cal.ctag || null,
    syncToken: (cal.syncToken && String(cal.syncToken)) || null,
  }
}

/** Stable per-(account,calendarUrl) id so re-discovery upserts the same row. */
function calendarId(accountId, url) {
  const h = crypto.createHash('sha1').update(`${accountId}\n${url}`).digest('hex').slice(0, 16)
  return `calx_${h}`
}

// ---------------------------------------------------------------------------
// connection test + discovery
// ---------------------------------------------------------------------------

/**
 * Probe a CalDAV server with throwaway credentials. Returns an array of
 * `{ url, name, color }`. Throws (with a useful message) on auth/connection
 * failure. NOTHING is persisted.
 *
 * @param {{provider?:string, server:string, username:string, password:string}} probe
 */
export async function testConnection(probe) {
  const p = probe || {}
  if (!p.server) throw new Error('CalDAV server URL required')
  if (!p.username || !p.password) throw new Error('username and password required')

  const client = await makeClient({
    serverUrl: p.server,
    credentials: { username: p.username, password: p.password },
  })
  const calendars = await client.fetchCalendars()
  return (calendars || []).map((c) => {
    const d = toCalDescriptor(c)
    return { url: d.url, name: d.name, color: d.color }
  })
}

/**
 * Discover an account's calendars and upsert them into store.calendars
 * (preserving the existing `visible` toggle on re-discovery). Returns the stored
 * calendar rows (renderer-safe).
 */
export async function discoverCalendars(account) {
  const accountId = account.id
  const client = await clientForAccount(accountId)
  const calendars = await client.fetchCalendars()

  const out = []
  for (const c of (calendars || [])) {
    const d = toCalDescriptor(c)
    const id = calendarId(accountId, d.url)
    const prev = Store.getCalendar(id)
    Store.upsertCalendar({
      id,
      account_id: accountId,
      url: d.url,
      name: d.name,
      // Prefer the calendar's own color; fall back to the account color.
      color: d.color || account.color || prev?.color || null,
      ctag: d.ctag,
      sync_token: d.syncToken,
      visible: prev ? prev.visible : 1,
    })
    out.push({ id, url: d.url, name: d.name, color: d.color, ctag: d.ctag, syncToken: d.syncToken })
  }
  return out
}

// ---------------------------------------------------------------------------
// ICS parsing
// ---------------------------------------------------------------------------

/** ms timestamp from an ICAL.Time, or null. */
function tsFromIcalTime(t) {
  if (!t) return null
  try {
    return t.toJSDate().getTime()
  } catch (_e) {
    return null
  }
}

/**
 * Parse one ICS object's first VEVENT into a base event row. Returns null if the
 * object has no usable VEVENT (e.g. it's a VTODO or unparsable). `raw` is the ICS
 * source we keep for re-expansion + round-trip edits.
 */
function parseVeventRow(accountId, calendarId_, raw, url, etag) {
  if (!raw || typeof raw !== 'string') return null
  let comp
  try {
    const jcal = ICAL.parse(raw)
    comp = new ICAL.Component(jcal)
  } catch (_e) {
    return null
  }
  // A VCALENDAR may wrap several VEVENTs (a base + RECURRENCE-ID overrides). The
  // base row is the master (no RECURRENCE-ID); overrides live inside raw_ics and
  // are applied by ICAL.Event during expansion.
  const vevents = comp.getAllSubcomponents('vevent')
  if (!vevents || !vevents.length) return null
  let master = vevents.find((v) => !v.hasProperty('recurrence-id'))
  if (!master) [master] = vevents

  let event
  try {
    event = new ICAL.Event(master)
  } catch (_e) {
    return null
  }

  const uid = event.uid || master.getFirstPropertyValue('uid')
  if (!uid) return null

  const startTime = event.startDate
  const endTime = event.endDate
  const allDay = !!(startTime && startTime.isDate)

  const rruleProp = master.getFirstPropertyValue('rrule')
  const rrule = rruleProp ? rruleProp.toString() : null

  return {
    account_id: accountId,
    calendar_id: calendarId_,
    uid: String(uid),
    start_ts: tsFromIcalTime(startTime),
    end_ts: tsFromIcalTime(endTime),
    all_day: allDay,
    summary: event.summary || '',
    location: event.location || '',
    rrule,
    raw_ics: raw,
    url: url || null,
    etag: etag || null,
  }
}

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

/**
 * Sync a single calendar: fetch its CalDAV objects, parse VEVENTs, and replace
 * the calendar's cached event rows. Skips the heavy fetch when the calendar's
 * remote ctag is unchanged from what we last stored. Returns
 * `{ count, skipped }`.
 *
 * @param {{id:string}} account  the account row (only `.id` is used)
 * @param {object} calendar      a store.calendars row (id/url/ctag/...)
 */
export async function syncCalendar(account, calendar) {
  const accountId = account.id
  const calRow = Store.getCalendar(calendar.id) || calendar
  const client = await clientForAccount(accountId)

  // Re-fetch the live calendar list so we can read the current ctag cheaply and
  // get a tsdav DAVCalendar object (fetchCalendarObjects wants the full object).
  const remoteCals = await client.fetchCalendars()
  const remote = (remoteCals || []).find((c) => c.url === calRow.url)
  if (!remote) {
    // Calendar vanished server-side — drop its cached events.
    Store.delEventsForCalendar(calRow.id)
    return { count: 0, skipped: false, removed: true }
  }

  const remoteDesc = toCalDescriptor(remote)
  const remoteCtag = remoteDesc.ctag

  // Fast path: ctag unchanged ⇒ nothing changed on the server. Only skip when we
  // actually have a stored ctag to compare against (first sync always fetches).
  if (remoteCtag && calRow.ctag && remoteCtag === calRow.ctag) {
    return { count: 0, skipped: true }
  }

  const objects = await client.fetchCalendarObjects({ calendar: remote })
  const rows = []
  for (const obj of (objects || [])) {
    const row = parseVeventRow(accountId, calRow.id, obj.data, obj.url, obj.etag)
    if (row) rows.push(row)
    if (rows.length >= MAX_EVENTS_PER_SYNC) break
  }

  // Replace the calendar's event set atomically (handles server-side deletes).
  Store.replaceCalendarEvents(calRow.id, rows)
  // Advance the stored ctag/sync-token so the next sync can short-circuit.
  Store.setCalendarSync(calRow.id, remoteCtag, remoteDesc.syncToken)

  return { count: rows.length, skipped: false }
}

// ---------------------------------------------------------------------------
// recurrence expansion
// ---------------------------------------------------------------------------

/**
 * Expand event rows into flat instances within [startTs,endTs]. Non-recurring
 * rows pass through (if they overlap the window); recurring rows are expanded
 * with ICAL.Event so RRULE/EXDATE/RDATE/overrides are honored — but only the
 * occurrences that fall inside the window are emitted.
 *
 * Each returned instance is `{ calendar_id, account_id, uid, summary, location,
 * start_ts, end_ts, all_day, cal_color }` (cal_color carried from the row).
 *
 * @param {Array<object>} rows  store rows (must include raw_ics for recurrences)
 */
export function expandEvents(rows, startTs, endTs) {
  const out = []
  const winStart = Number(startTs)
  const winEnd = Number(endTs)

  for (const row of (rows || [])) {
    const baseColor = row.cal_color ?? row.color ?? null

    // Non-recurring: include iff its window overlaps the query window.
    if (!row.rrule) {
      const s = row.start_ts
      const e = row.end_ts != null ? row.end_ts : row.start_ts
      if (s != null && s <= winEnd && (e != null ? e : s) >= winStart) {
        out.push(instanceFromRow(row, s, e, baseColor))
      }
      continue
    }

    // Recurring: expand from raw_ics within the window.
    const expanded = expandRecurringRow(row, winStart, winEnd, baseColor)
    for (const inst of expanded) out.push(inst)
  }

  return out
}

function instanceFromRow(row, startMs, endMs, color) {
  return {
    calendar_id: row.calendar_id,
    account_id: row.account_id,
    uid: row.uid,
    summary: row.summary || '',
    location: row.location || '',
    start_ts: startMs,
    end_ts: endMs != null ? endMs : startMs,
    all_day: !!row.all_day,
    cal_color: color,
  }
}

/** Expand a single recurring row's raw ICS within [winStart,winEnd] (ms). */
function expandRecurringRow(row, winStart, winEnd, color) {
  const out = []
  if (!row.raw_ics) {
    // No source to expand — fall back to the single base instance.
    if (row.start_ts != null && row.start_ts <= winEnd
        && (row.end_ts != null ? row.end_ts : row.start_ts) >= winStart) {
      out.push(instanceFromRow(row, row.start_ts, row.end_ts, color))
    }
    return out
  }

  let event
  try {
    const comp = new ICAL.Component(ICAL.parse(row.raw_ics))
    const vevents = comp.getAllSubcomponents('vevent')
    let master = vevents.find((v) => !v.hasProperty('recurrence-id'))
    if (!master) [master] = vevents
    event = new ICAL.Event(master)
    // Attach RECURRENCE-ID overrides so getOccurrenceDetails reflects edits.
    for (const v of vevents) {
      if (v.hasProperty('recurrence-id')) {
        try { event.relateException(new ICAL.Event(v)) } catch (_e) { /* noop */ }
      }
    }
  } catch (_e) {
    return out
  }

  if (!event.isRecurring()) {
    const s = tsFromIcalTime(event.startDate)
    const e = tsFromIcalTime(event.endDate)
    if (s != null && s <= winEnd && (e != null ? e : s) >= winStart) {
      out.push(instanceFromRow(row, s, e, color))
    }
    return out
  }

  const isAllDay = !!(event.startDate && event.startDate.isDate)
  const rangeStart = ICAL.Time.fromJSDate(new Date(winStart), false)
  const rangeEnd = ICAL.Time.fromJSDate(new Date(winEnd), false)

  const iter = event.iterator()
  let next = iter.next()
  // Bounded loop: never emit more than MAX_EVENTS_PER_SYNC instances per row, and
  // stop once we pass the window's end.
  let guard = 0
  while (next && guard < MAX_EVENTS_PER_SYNC) {
    guard += 1
    if (next.compare(rangeEnd) > 0) break
    // Skip occurrences entirely before the window (cheap compare on the start).
    let details
    try {
      details = event.getOccurrenceDetails(next)
    } catch (_e) {
      next = iter.next()
      continue
    }
    const startMs = tsFromIcalTime(details.startDate)
    const endMs = tsFromIcalTime(details.endDate)
    const instEnd = endMs != null ? endMs : startMs
    if (startMs != null && startMs <= winEnd && instEnd >= winStart) {
      out.push({
        calendar_id: row.calendar_id,
        account_id: row.account_id,
        uid: row.uid,
        summary: (details.item && details.item.summary) || row.summary || '',
        location: (details.item && details.item.location) || row.location || '',
        start_ts: startMs,
        end_ts: instEnd,
        all_day: isAllDay,
        cal_color: color,
      })
    }
    if (next.compare(rangeStart) < 0 && out.length === 0 && guard > MAX_EVENTS_PER_SYNC) break
    next = iter.next()
  }

  return out
}

// ---------------------------------------------------------------------------
// mutations (create / update / delete)
// ---------------------------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, '0')
}

/** Format an ICAL.Time-equivalent for a date-time in UTC: 20260621T140000Z. */
function icsDateTimeUTC(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Format an all-day DATE value: 20260621 (local calendar date of the ms). */
function icsDate(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

/**
 * Build a VCALENDAR/VEVENT ICS string with ICAL.js for the given fields. When
 * `existingRaw` is provided we mutate that component's master VEVENT in place
 * (preserving unknown props, recurrence rules, overrides) so an edit round-trips
 * cleanly; otherwise we build a fresh single-event VCALENDAR.
 */
function buildIcs({
  uid, title, startMs, endMs, allDay, location, description, existingRaw,
}) {
  let vcal
  let vevent

  if (existingRaw) {
    try {
      vcal = new ICAL.Component(ICAL.parse(existingRaw))
    } catch (_e) {
      vcal = null
    }
  }

  if (vcal) {
    const vevents = vcal.getAllSubcomponents('vevent')
    vevent = vevents.find((v) => !v.hasProperty('recurrence-id')) || vevents[0]
    if (!vevent) {
      vevent = new ICAL.Component('vevent')
      vcal.addSubcomponent(vevent)
    }
  } else {
    vcal = new ICAL.Component(['vcalendar', [], []])
    vcal.updatePropertyWithValue('prodid', '-//Paperus//Calendar//EN')
    vcal.updatePropertyWithValue('version', '2.0')
    vevent = new ICAL.Component('vevent')
    vcal.addSubcomponent(vevent)
  }

  vevent.updatePropertyWithValue('uid', String(uid))

  // DTSTAMP / LAST-MODIFIED = now (UTC).
  const nowUtc = icsDateTimeUTC(Date.now())
  setRawDateTime(vevent, 'dtstamp', nowUtc, false)
  setRawDateTime(vevent, 'last-modified', nowUtc, false)

  if (typeof title === 'string') vevent.updatePropertyWithValue('summary', title)
  if (typeof location === 'string') vevent.updatePropertyWithValue('location', location)
  if (typeof description === 'string') vevent.updatePropertyWithValue('description', description)

  // DTSTART / DTEND. For all-day events use VALUE=DATE (start inclusive, end
  // exclusive per RFC 5545). Otherwise UTC date-times.
  if (startMs != null) {
    if (allDay) {
      setDateValue(vevent, 'dtstart', icsDate(startMs))
      const endExclusive = endMs != null && endMs > startMs ? endMs : startMs + 86400000
      setDateValue(vevent, 'dtend', icsDate(endExclusive))
    } else {
      setRawDateTime(vevent, 'dtstart', icsDateTimeUTC(startMs), false)
      const e = endMs != null ? endMs : startMs + 3600000
      setRawDateTime(vevent, 'dtend', icsDateTimeUTC(e), false)
    }
  }

  return vcal.toString()
}

/** Set a DATE-TIME property from a pre-formatted ICS string (e.g. 20260621T...Z). */
function setRawDateTime(vevent, name, icsValue, isDate) {
  vevent.removeAllProperties(name)
  const prop = new ICAL.Property(name, vevent)
  prop.setValue(ICAL.Time.fromString(isDate
    ? `${icsValue.slice(0, 4)}-${icsValue.slice(4, 6)}-${icsValue.slice(6, 8)}`
    : isoFromIcsUtc(icsValue)))
  vevent.addProperty(prop)
}

/** Set a VALUE=DATE property (all-day). */
function setDateValue(vevent, name, ymd) {
  vevent.removeAllProperties(name)
  const prop = new ICAL.Property(name, vevent)
  const t = ICAL.Time.fromString(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`)
  t.isDate = true
  prop.setValue(t)
  vevent.addProperty(prop)
}

/** 20260621T140000Z -> 2026-06-21T14:00:00Z (ICAL.Time.fromString accepts this). */
function isoFromIcsUtc(ics) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(ics)
  if (!m) return ics
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`
}

/** Deterministic object filename for a new event (CalDAV expects `<uid>.ics`). */
function objectFilename(uid) {
  return `${String(uid).replace(/[^A-Za-z0-9._-]/g, '_')}.ics`
}

/**
 * Create an event on a calendar. Generates a fresh UID, builds the ICS, and
 * POSTs it via tsdav. Returns the stored base row's identifying fields
 * `{ calendarId, uid, url }`.
 */
export async function createEvent(account, calendar, fields) {
  const accountId = account.id
  const calRow = Store.getCalendar(calendar.id) || calendar
  const client = await clientForAccount(accountId)

  const remoteCals = await client.fetchCalendars()
  const remote = (remoteCals || []).find((c) => c.url === calRow.url)
  if (!remote) throw new Error('calendar not found on server')

  const uid = `${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}@paperus`
  const ics = buildIcs({
    uid,
    title: fields.title || '',
    startMs: fields.startMs,
    endMs: fields.endMs,
    allDay: !!fields.allDay,
    location: fields.location,
    description: fields.description,
  })
  const filename = objectFilename(uid)

  const res = await client.createCalendarObject({ calendar: remote, iCalString: ics, filename })
  if (res && res.ok === false) {
    throw new Error(`CalDAV create failed (${res.status})`)
  }
  const objectUrl = joinUrl(calRow.url, filename)

  // Reflect locally so the UI updates immediately (a subsequent sync reconciles).
  const row = parseVeventRow(accountId, calRow.id, ics, objectUrl, (res && res.headers && res.headers.get && res.headers.get('etag')) || null)
  if (row) Store.upsertEvent(row)

  return { calendarId: calRow.id, uid, url: objectUrl }
}

/**
 * Update an existing event (identified by calendarId + uid). Rebuilds the ICS
 * from the stored raw (preserving recurrence/unknown props) with the supplied
 * field overrides, then PUTs it via tsdav using the stored object URL + etag.
 */
export async function updateEvent(account, calendar, uid, fields) {
  const accountId = account.id
  const calRow = Store.getCalendar(calendar.id) || calendar
  const existing = Store.getEvent(calRow.id, uid)
  if (!existing) throw new Error('event not found')

  const client = await clientForAccount(accountId)

  const ics = buildIcs({
    uid,
    title: fields.title != null ? fields.title : existing.summary,
    startMs: fields.startMs != null ? fields.startMs : existing.start_ts,
    endMs: fields.endMs != null ? fields.endMs : existing.end_ts,
    allDay: fields.allDay != null ? !!fields.allDay : !!existing.all_day,
    location: fields.location != null ? fields.location : existing.location,
    description: fields.description,
    existingRaw: existing.raw_ics,
  })

  const objectUrl = existing.url || joinUrl(calRow.url, objectFilename(uid))
  const res = await client.updateCalendarObject({
    calendarObject: { url: objectUrl, data: ics, etag: existing.etag || undefined },
  })
  if (res && res.ok === false) {
    throw new Error(`CalDAV update failed (${res.status})`)
  }

  const row = parseVeventRow(accountId, calRow.id, ics, objectUrl,
    (res && res.headers && res.headers.get && res.headers.get('etag')) || existing.etag || null)
  if (row) Store.upsertEvent(row)

  return { calendarId: calRow.id, uid }
}

/**
 * Delete an event (calendarId + uid) from the server and the local store, using
 * the stored object URL + etag.
 */
export async function deleteEvent(account, calendar, uid) {
  const accountId = account.id
  const calRow = Store.getCalendar(calendar.id) || calendar
  const existing = Store.getEvent(calRow.id, uid)
  if (!existing) {
    // Already gone locally; nothing to do server-side either.
    return { calendarId: calRow.id, uid, removed: true }
  }

  const client = await clientForAccount(accountId)
  const objectUrl = existing.url || joinUrl(calRow.url, objectFilename(uid))
  const res = await client.deleteCalendarObject({
    calendarObject: { url: objectUrl, etag: existing.etag || undefined },
  })
  if (res && res.ok === false && res.status !== 404) {
    throw new Error(`CalDAV delete failed (${res.status})`)
  }

  Store.removeEvent(calRow.id, uid)
  return { calendarId: calRow.id, uid, removed: true }
}

/** Join a collection URL and a filename (handles a trailing slash). */
function joinUrl(base, name) {
  if (!base) return name
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`
}
