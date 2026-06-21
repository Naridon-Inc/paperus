/**
 * date-index.js — pure, I/O-free helpers that turn a scan (from task-scan.js)
 * into the shapes the Tasks + Calendar surfaces render:
 *
 *   - buildBuckets   → overdue / today / upcoming / noDate / done lists.
 *   - buildDateIndex → a Map keyed by ISO date → { tasks, reminders, hasDaily }.
 *   - monthMatrix    → a calendar grid of week-rows for a given year/month.
 *
 * Everything here is deterministic and side-effect-free; the only import is the
 * shared `todayISO` so "is today" math is consistent with the rest of the app.
 * ISO date strings (`YYYY-MM-DD`) sort lexicographically the same as
 * chronologically, so we compare them as plain strings throughout.
 */
import { todayISO } from './daily-notes'

/** Stable comparator: by dueISO (nulls last), then by text. */
function byDateThenText(a, b) {
  const da = a && a.dueISO ? a.dueISO : ''
  const db = b && b.dueISO ? b.dueISO : ''
  if (da !== db) {
    if (!da) return 1
    if (!db) return -1
    return da < db ? -1 : 1
  }
  const ta = String((a && a.text) || '')
  const tb = String((b && b.text) || '')
  return ta.localeCompare(tb)
}

/**
 * Bucket tasks into overdue / today / upcoming / noDate / done.
 *
 * - `done` tasks always go to `done` (regardless of date).
 * - otherwise by `dueISO` vs `todayISO` (string compare):
 *     < today → overdue, === today → today, > today → upcoming, null → noDate.
 * Each bucket is sorted by dueISO then text.
 *
 * @param {Array} tasks
 * @param {{ todayISO:string }} ctx
 * @returns {{overdue:Array, today:Array, upcoming:Array, noDate:Array, done:Array}}
 */
export function buildBuckets(tasks, { todayISO: today } = {}) {
  const t = today || todayISO()
  const out = { overdue: [], today: [], upcoming: [], noDate: [], done: [] }
  for (const task of (Array.isArray(tasks) ? tasks : [])) {
    if (!task) continue
    if (task.done) { out.done.push(task); continue }
    const due = task.dueISO || null
    if (!due) { out.noDate.push(task); continue }
    if (due < t) out.overdue.push(task)
    else if (due === t) out.today.push(task)
    else out.upcoming.push(task)
  }
  out.overdue.sort(byDateThenText)
  out.today.sort(byDateThenText)
  out.upcoming.sort(byDateThenText)
  out.noDate.sort(byDateThenText)
  out.done.sort(byDateThenText)
  return out
}

/** ISO day (YYYY-MM-DD) for an external event: prefer dueISO, else the date
 *  portion of startISO. Returns '' when neither is usable. */
function eventDayISO(ev) {
  if (!ev) return ''
  if (ev.dueISO && /^\d{4}-\d{2}-\d{2}/.test(ev.dueISO)) return String(ev.dueISO).slice(0, 10)
  if (ev.startISO && /^\d{4}-\d{2}-\d{2}/.test(ev.startISO)) return String(ev.startISO).slice(0, 10)
  return ''
}

/** Stable comparator for external events: by startISO (nulls last), then title. */
function byStartThenTitle(a, b) {
  const sa = (a && a.startISO) ? String(a.startISO) : ''
  const sb = (b && b.startISO) ? String(b.startISO) : ''
  if (sa !== sb) {
    if (!sa) return 1
    if (!sb) return -1
    return sa < sb ? -1 : 1
  }
  return String((a && a.title) || '').localeCompare(String((b && b.title) || ''))
}

/**
 * Build a per-date index for the calendar.
 *
 * Every dated task lands under its `dueISO`; reminder tasks (`remind != null`)
 * are additionally collected into `reminders` for that day. `hasDaily` is true
 * if `dailyNotesByISO` has a truthy entry for that ISO date (the caller supplies
 * the daily-note presence map, since this module does no I/O).
 *
 * External calendar events (e.g. CalDAV) are additive: each is keyed by its
 * start day's ISO and pushed into a per-day `events` array, created lazily so
 * days without external events keep their original shape. Tasks / reminders /
 * hasDaily are left untouched, so the notes-derived calendar is unchanged when
 * `externalEvents` is empty.
 *
 * @param {{tasks:Array}} scan
 * @param {Object<string, any>} [dailyNotesByISO]  iso → truthy if a daily note exists
 * @param {Array<{dueISO?:string, startISO?:string, endISO?:string, title?:string,
 *   allDay?:boolean, calendarId?:string, color?:string, source?:string}>} [externalEvents]
 * @returns {Map<string, {tasks:Array, reminders:Array, hasDaily:boolean, events?:Array}>}
 */
export function buildDateIndex(scan, dailyNotesByISO = {}, externalEvents = []) {
  const map = new Map()
  const tasks = (scan && Array.isArray(scan.tasks)) ? scan.tasks : []

  const ensure = (iso) => {
    let entry = map.get(iso)
    if (!entry) {
      entry = { tasks: [], reminders: [], hasDaily: !!(dailyNotesByISO && dailyNotesByISO[iso]) }
      map.set(iso, entry)
    }
    return entry
  }

  for (const task of tasks) {
    if (!task || !task.dueISO) continue
    const entry = ensure(task.dueISO)
    entry.tasks.push(task)
    if (task.remind) entry.reminders.push(task)
  }

  // External calendar events → bucket.events[] keyed by the start day's ISO.
  for (const ev of (Array.isArray(externalEvents) ? externalEvents : [])) {
    const iso = eventDayISO(ev)
    if (!iso) continue
    const entry = ensure(iso)
    if (!entry.events) entry.events = []
    entry.events.push(ev)
  }

  // Make sure days that only have a daily note (no tasks) still appear.
  for (const iso of Object.keys(dailyNotesByISO || {})) {
    if (dailyNotesByISO[iso]) ensure(iso)
  }

  // Sort each day's lists for stable rendering.
  for (const entry of map.values()) {
    entry.tasks.sort(byDateThenText)
    entry.reminders.sort(byDateThenText)
    if (entry.events) entry.events.sort(byStartThenTitle)
  }
  return map
}

/** Local-midnight YYYY-MM-DD for a Date (no UTC drift). */
function isoOf(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * A calendar grid for `month0` (0-based month) of `year`.
 *
 * SUNDAY-START: each week row begins on Sunday (cell[0] = Sun … cell[6] = Sat).
 * Returns an array of week-rows; each row is 7 cells:
 *   { iso:'YYYY-MM-DD', inMonth:boolean, isToday:boolean }
 * Leading/trailing cells from the prev/next month fill the first/last rows so
 * every row has 7 cells. The grid always spans whole weeks (5 or 6 rows).
 *
 * @param {number} year
 * @param {number} month0  0 = January … 11 = December
 * @returns {Array<Array<{iso:string, inMonth:boolean, isToday:boolean}>>}
 */
export function monthMatrix(year, month0) {
  const today = todayISO()
  const first = new Date(year, month0, 1)
  // Sunday-start: how many days to step back to reach the Sunday on/just-before the 1st.
  const lead = first.getDay() // 0 (Sun) … 6 (Sat)
  const start = new Date(year, month0, 1 - lead)

  const last = new Date(year, month0 + 1, 0) // last day of this month
  const totalDays = lead + last.getDate()
  const rows = Math.ceil(totalDays / 7)

  const weeks = []
  const cursor = new Date(start)
  for (let w = 0; w < rows; w += 1) {
    const week = []
    for (let d = 0; d < 7; d += 1) {
      const iso = isoOf(cursor)
      week.push({
        iso,
        inMonth: cursor.getMonth() === month0 && cursor.getFullYear() === year,
        isToday: iso === today,
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}
