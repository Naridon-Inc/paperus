// Calendar.jsx — the Calendar surface (React island, @medusajs/ui).
//
// Renders a Sunday-start month grid (and a chronological Agenda view) of dated
// tasks + reminders coming from the host scan. Day cells show up to ~3 pills
// (tasks, reminders); clicking a pill opens its source note, clicking the empty
// part of a day opens that day's daily note.
//
// Visual layer = the `.pp-*` Paperus surface design system in island.css (cards,
// hairline grid, soft shadows, today tint) layered over Medusa primitives; pure
// date math lives in date-index.js (monthMatrix / buildDateIndex).
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Button, IconButton, Badge, Tooltip, TooltipProvider } from '@medusajs/ui'
import {
  ChevronLeft,
  ChevronRight,
  BellAlert,
  DocumentText,
  CalendarSolid,
  Clock,
  MapPin,
  Plus,
  XMark,
} from '@medusajs/icons'
import { useHost } from '../host.js'
import { monthMatrix, buildDateIndex } from '../../date-index.js'
import EventWizard from './calendar/EventWizard.jsx'
import CalAccountWizard from './calendar/CalAccountWizard.jsx'
import { useExternalEvents } from './calendar/useCalendar.js'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] // Sunday-start

function parseTeamSource(source) {
  const s = String(source || '')
  if (!s.startsWith('team:')) return null
  const rest = s.slice('team:'.length)
  const idx = rest.indexOf(':')
  if (idx < 0) return null
  return { teamId: rest.slice(0, idx), noteId: rest.slice(idx + 1) }
}

export default function Calendar() {
  const host = useHost()
  const todayISO = (host.dates && host.dates.todayISO) ? host.dates.todayISO() : isoFallback(new Date())

  const [scan, setScan] = useState(() => (host.scan && host.scan.getScan ? host.scan.getScan() : { tasks: [] }))
  const [view, setView] = useState('month') // 'month' | 'agenda'
  const initial = useMemo(() => parseISOParts(todayISO), [todayISO])
  const [cursor, setCursor] = useState(() => ({ year: initial.year, month0: initial.month0 }))

  useEffect(() => {
    let alive = true
    try { host.scan && host.scan.requestScan && host.scan.requestScan() } catch (_e) { /* noop */ }
    const off = host.on
      ? host.on('scan:updated', (detail) => { if (alive && detail) setScan(detail) })
      : () => {}
    return () => { alive = false; try { off() } catch (_e) { /* noop */ } }
  }, [host])

  const weeks = useMemo(() => monthMatrix(cursor.year, cursor.month0), [cursor])

  // Visible range = the whole grid (incl. spill-over days from prev/next month),
  // as an ISO day window for the external-events fetch.
  const [rangeStartISO, rangeEndISO] = useMemo(() => {
    const flat = weeks.flat()
    if (!flat.length) return [todayISO, todayISO]
    return [flat[0].iso, `${flat[flat.length - 1].iso}T23:59:59`]
  }, [weeks, todayISO])

  // External CalDAV events for the visible month (empty + harmless when no
  // accounts are connected — the notes calendar is unaffected).
  const { events: externalEvents, refresh: refetchExternal } = useExternalEvents(host, rangeStartISO, rangeEndISO)

  const index = useMemo(() => buildDateIndex(scan, {}, externalEvents), [scan, externalEvents])

  // Read-only peek for an external event (click a CalDAV pill).
  const [peekEvent, setPeekEvent] = useState(null)
  const openEventPeek = useCallback((ev) => { if (ev) setPeekEvent(ev) }, [])

  // total dated items in the visible month (for the header context chip):
  // dated tasks + external calendar events.
  const monthCount = useMemo(() => {
    let n = 0
    weeks.flat().forEach((cell) => {
      if (!cell.inMonth) return
      const e = index.get(cell.iso)
      if (!e) return
      if (e.tasks) n += e.tasks.length
      if (e.events) n += e.events.length
    })
    return n
  }, [weeks, index])

  const openSource = useCallback((task) => {
    if (!task || !task.source) return
    const team = parseTeamSource(task.source)
    if (team) { try { host.openTeamNote(team.teamId, team.noteId) } catch (_e) { /* noop */ } return }
    try { host.openFile(task.source) } catch (_e) { /* noop */ }
  }, [host])

  const openDay = useCallback((iso) => {
    try { host.openDailyNote(iso) } catch (_e) { /* noop */ }
  }, [host])

  // New-event wizard: clicking a day (or the ＋) opens it prefilled for that day.
  const [wizOpen, setWizOpen] = useState(false)
  const [wizDate, setWizDate] = useState(todayISO)
  const openCreate = useCallback((iso) => { setWizDate(iso || todayISO); setWizOpen(true) }, [todayISO])
  const createEvent = useCallback(async (payload) => {
    if (!host.events || !host.events.create) return { ok: false }
    const res = await host.events.create(payload)
    try { host.scan && host.scan.requestScan && host.scan.requestScan({ force: true }) } catch (_e) { /* noop */ }
    return res
  }, [host])

  // ── external (CalDAV) account wizard ──────────────────────────────────────
  const [acctWizOpen, setAcctWizOpen] = useState(false)
  const openWizard = useCallback(() => setAcctWizOpen(true), [])

  // Refetch external events when main signals a remote calendar change, and let
  // the sidebar open the connect flow via a `calendar:cmd` { type:'add-account' }.
  useEffect(() => {
    if (!host.on) return undefined
    const offs = [
      host.on('calendar:changed', () => { try { refetchExternal() } catch (_e) { /* noop */ } }),
      host.on('calendar:cmd', (e) => { if (e && e.type === 'add-account') openWizard() }),
    ]
    return () => offs.forEach((off) => { try { off() } catch (_e) { /* noop */ } })
  }, [host, refetchExternal, openWizard])

  // Cold-open: the sidebar may have asked to connect an account before this
  // surface mounted (so the live calendar:cmd was missed) — pick it up once.
  useEffect(() => {
    const intent = (typeof window !== 'undefined' && window.__calCmd) || null
    if (intent && intent.type === 'add-account') { window.__calCmd = null; openWizard() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isCurrentMonth = cursor.year === initial.year && cursor.month0 === initial.month0
  const goPrev = () => setCursor((c) => stepMonth(c, -1))
  const goNext = () => setCursor((c) => stepMonth(c, 1))
  const goToday = () => setCursor({ year: initial.year, month0: initial.month0 })

  return (
    <TooltipProvider>
      <div className="pp-surface">
        {/* ── top bar ───────────────────────────────────────────────────── */}
        <header className="pp-header">
          <h1 className="pp-title">
            {MONTH_NAMES[cursor.month0]} <span style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>{cursor.year}</span>
          </h1>

          <div className="flex items-center gap-1">
            <IconButton variant="transparent" size="small" onClick={goPrev} aria-label="Previous month">
              <ChevronLeft />
            </IconButton>
            <Button variant="secondary" size="small" onClick={goToday} disabled={isCurrentMonth && view === 'month'}>
              Today
            </Button>
            <IconButton variant="transparent" size="small" onClick={goNext} aria-label="Next month">
              <ChevronRight />
            </IconButton>
          </div>

          {monthCount > 0 ? (
            <Badge size="2xsmall" color="grey" rounded="full" className="hidden sm:inline-flex">
              {monthCount} scheduled
            </Badge>
          ) : null}

          <div className="pp-spacer" />

          <div className="flex items-center gap-2">
            <div className="pp-seg" role="tablist" aria-label="Calendar view">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'month'}
                className="pp-seg-btn"
                onClick={() => setView('month')}
              >
                Month
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'agenda'}
                className="pp-seg-btn"
                onClick={() => setView('agenda')}
              >
                Agenda
              </button>
            </div>
            <Button variant="primary" size="small" onClick={() => openCreate(todayISO)}>
              <Plus /> New event
            </Button>
          </div>
        </header>

        {/* ── body ──────────────────────────────────────────────────────── */}
        <div className={view === 'month' ? 'pp-body pp-body--cal' : 'pp-body'}>
          {view === 'month'
            ? <MonthGrid weeks={weeks} index={index} todayISO={todayISO} onCreate={openCreate} onOpenDay={openDay} onOpenSource={openSource} onOpenEvent={openEventPeek} />
            : <AgendaList index={index} todayISO={todayISO} onOpenSource={openSource} onOpenDay={openDay} onOpenEvent={openEventPeek} />}
        </div>

        <EventWizard open={wizOpen} onOpenChange={setWizOpen} date={wizDate} onCreate={createEvent} />
        <CalAccountWizard open={acctWizOpen} onOpenChange={setAcctWizOpen} onAdded={() => { setAcctWizOpen(false); refetchExternal() }} />
        <EventPeek event={peekEvent} onClose={() => setPeekEvent(null)} />
      </div>
    </TooltipProvider>
  )
}

// ── month grid ──────────────────────────────────────────────────────────────────
function MonthGrid({ weeks, index, todayISO, onCreate, onOpenDay, onOpenSource, onOpenEvent }) {
  return (
    <div className="pp-card pp-cal">
      <div className="pp-cal-weekhead">
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="pp-cal-grid">
        {weeks.flat().map((cell) => (
          <DayCell
            key={cell.iso}
            cell={cell}
            entry={index.get(cell.iso)}
            isPast={cell.iso < todayISO}
            onCreate={onCreate}
            onOpenDay={onOpenDay}
            onOpenSource={onOpenSource}
            onOpenEvent={onOpenEvent}
          />
        ))}
      </div>
    </div>
  )
}

function DayCell({ cell, entry, isPast, onCreate, onOpenDay, onOpenSource, onOpenEvent }) {
  const dayNum = Number(cell.iso.slice(8, 10))
  const tasks = (entry && entry.tasks) || []
  const reminders = (entry && entry.reminders) || []
  const events = (entry && entry.events) || [] // external CalDAV events
  // Reminders are also tasks; show external events first, then reminders, then
  // remaining tasks. All share the 3-pill cap so a busy day stays compact.
  const reminderIds = new Set(reminders.map((t) => t.id))
  const plainTasks = tasks.filter((t) => !reminderIds.has(t.id))
  const pills = [
    ...events.map((ev) => ({ kind: 'event', ev })),
    ...reminders.map((t) => ({ kind: 'task', t, remind: true })),
    ...plainTasks.map((t) => ({ kind: 'task', t, remind: false })),
  ]
  const shown = pills.slice(0, 3)
  const extra = pills.length - shown.length

  const cls = ['pp-cal-cell']
  if (!cell.inMonth) cls.push('pp-cal-cell--out')
  if (cell.isToday) cls.push('pp-cal-cell--today')

  return (
    <div className={cls.join(' ')}>
      {/* clicking empty space (or the ＋) → start a new event on this day */}
      <button type="button" aria-label={`Add event on ${cell.iso}`} className="pp-cal-hit" onClick={() => onCreate(cell.iso)} />

      <div className="pp-cal-cellhead">
        <span className="pp-cal-daynum">{dayNum}</span>
        <span className="pp-cal-add" aria-hidden="true"><Plus /></span>
      </div>

      <div className="pp-cal-pills">
        {shown.map((p, i) => {
          if (p.kind === 'event') return <EventPill key={p.ev.id || p.ev.uid || `ev${i}`} ev={p.ev} onOpenEvent={onOpenEvent} />
          const { t, remind } = p
          const pcls = ['pp-pill']
          if (remind) pcls.push('pp-pill--remind')
          if (t.done) pcls.push('pp-pill--done')
          else if (isPast) pcls.push('pp-pill--overdue')
          return (
            <button
              key={t.id}
              type="button"
              className={pcls.join(' ')}
              onClick={(e) => { e.stopPropagation(); onOpenSource(t) }}
              title={`${t.text || 'task'} — ${t.noteTitle || ''}`}
            >
              {remind
                ? <span className="pp-pill__ico"><BellAlert /></span>
                : <span className="pp-pill__dot" />}
              <span className="pp-pill__label">{t.text || '(task)'}</span>
            </button>
          )
        })}
        {extra > 0 ? (
          <button type="button" className="pp-pill pp-pill--more" onClick={(e) => { e.stopPropagation(); onOpenDay(cell.iso) }}>
            +{extra} more
          </button>
        ) : null}
      </div>
    </div>
  )
}

// External calendar event pill — tinted with its own `color`, opens a read-only
// peek on click (no edit in v1).
function EventPill({ ev, onOpenEvent }) {
  const color = ev.color || 'var(--pp-accent)'
  return (
    <button
      type="button"
      className="pp-pill pp-pill--ext"
      style={{
        borderColor: `color-mix(in srgb, ${color} 36%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, var(--bg-base, #fff))`,
      }}
      onClick={(e) => { e.stopPropagation(); onOpenEvent && onOpenEvent(ev) }}
      title={`${ev.title || 'event'}${ev.location ? ` — ${ev.location}` : ''}`}
    >
      <span className="pp-pill__dot" style={{ background: color }} />
      <span className="pp-pill__label">{ev.title || '(event)'}</span>
    </button>
  )
}

// ── read-only event peek (click an external pill) ────────────────────────────────
function fmtEventTime(ev) {
  if (!ev) return ''
  if (ev.allDay) return 'All day'
  const fmt = (iso) => {
    const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''))
    return m ? `${m[1]}:${m[2]}` : ''
  }
  const s = fmt(ev.startISO)
  const e = fmt(ev.endISO)
  if (s && e) return `${s} – ${e}`
  return s || ''
}

function EventPeek({ event, onClose }) {
  if (!event) return null
  const color = event.color || 'var(--pp-accent)'
  const dayLabel = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(event.startISO || event.dueISO || ''))
    if (!m) return ''
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    try { return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) } catch (_e) { return '' }
  })()
  const time = fmtEventTime(event)
  return (
    <>
      <div className="pp-evpeek-scrim" role="presentation" onClick={onClose} />
      <div className="pp-evpeek" role="dialog" aria-label="Event details">
        <div className="pp-evpeek-head">
          <span className="pp-evpeek-dot" aria-hidden style={{ background: color }} />
          <div className="pp-evpeek-title">{event.title || '(untitled event)'}</div>
          <IconButton variant="transparent" size="small" onClick={onClose} aria-label="Close">
            <XMark />
          </IconButton>
        </div>
        <div className="pp-evpeek-body">
          {dayLabel ? (
            <div className="pp-evpeek-row"><span className="pp-evpeek-ico"><CalendarSolid /></span><span>{dayLabel}</span></div>
          ) : null}
          {time ? (
            <div className="pp-evpeek-row"><span className="pp-evpeek-ico"><Clock /></span><span>{time}</span></div>
          ) : null}
          {event.location ? (
            <div className="pp-evpeek-row"><span className="pp-evpeek-ico"><MapPin /></span><span>{event.location}</span></div>
          ) : null}
          <div className="pp-evpeek-foot">
            <Badge size="2xsmall" color="grey" rounded="full">External calendar</Badge>
          </div>
        </div>
      </div>
    </>
  )
}

// ── agenda view ──────────────────────────────────────────────────────────────────
function AgendaList({ index, todayISO, onOpenSource, onOpenDay, onOpenEvent }) {
  const host = useHost()
  const fmtDate = (host.dates && host.dates.formatDateLabel) ? host.dates.formatDateLabel : (x) => x

  // Upcoming = days on/after today, chronological. (Past dated tasks are reachable
  // via the Tasks "Overdue" bucket; the agenda looks forward.) A day appears if it
  // has tasks OR external events.
  const days = useMemo(() => {
    return Array.from(index.keys())
      .filter((iso) => iso >= todayISO)
      .sort()
      .map((iso) => ({ iso, entry: index.get(iso) }))
      .filter((d) => d.entry && (
        (d.entry.tasks && d.entry.tasks.length) || (d.entry.events && d.entry.events.length)
      ))
  }, [index, todayISO])

  if (!days.length) {
    return (
      <div className="pp-empty">
        <div className="pp-empty-icon"><CalendarSolid /></div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg-base)' }}>Nothing scheduled</div>
        <div style={{ fontSize: 13, maxWidth: 340, color: 'var(--fg-subtle)' }}>
          Add <span className="pp-kbd">@date(2026-06-21)</span> to any task and it lands here and on the month grid.
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {days.map(({ iso, entry }) => {
        const isToday = iso === todayISO
        const events = entry.events || []
        const count = (entry.tasks ? entry.tasks.length : 0) + events.length
        return (
          <section key={iso} className="flex flex-col gap-2">
            <button type="button" onClick={() => onOpenDay(iso)} className="flex w-fit items-center gap-2 text-left">
              <span style={{ fontSize: 13.5, fontWeight: 640, letterSpacing: '-.01em', color: isToday ? 'var(--pp-accent, #3b82f6)' : 'var(--fg-base)' }}>
                {isToday ? 'Today · ' : ''}{fmtDate(iso)}
              </span>
              <Badge size="2xsmall" color="grey" rounded="full">{count}</Badge>
            </button>
            <div className="pp-card">
              <div className="pp-list">
                {events.map((ev, i) => (
                  <div key={ev.id || ev.uid || `ev${i}`} className="pp-row">
                    <span className="pp-pill__dot" style={{ background: ev.color || 'var(--pp-accent)' }} />
                    <button
                      type="button"
                      onClick={() => onOpenEvent && onOpenEvent(ev)}
                      className="min-w-0 flex-1 truncate text-left"
                      style={{
                        fontSize: 13.5, color: 'var(--fg-base)',
                        background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {ev.title || '(event)'}
                    </button>
                    <Badge size="2xsmall" color="grey" className="gap-x-1">
                      <CalendarSolid className="text-ui-fg-muted" />
                      <span>{ev.allDay ? 'All day' : (fmtEventTime(ev) || 'event')}</span>
                    </Badge>
                  </div>
                ))}
                {(entry.tasks || []).map((t) => (
                  <div key={t.id} className="pp-row">
                    {t.remind
                      ? <span className="pp-pill__ico"><BellAlert /></span>
                      : <span className={`pp-pill__dot ${t.done ? 'pp-pill__dot--done' : ''}`} style={t.done ? { background: 'var(--tag-green-icon, #16a34a)' } : null} />}
                    <button
                      type="button"
                      onClick={() => onOpenSource(t)}
                      className="min-w-0 flex-1 truncate text-left"
                      style={{
                        fontSize: 13.5,
                        color: t.done ? 'var(--fg-muted)' : 'var(--fg-base)',
                        textDecoration: t.done ? 'line-through' : 'none',
                        background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {t.text || '(task)'}
                    </button>
                    <Badge size="2xsmall" color="grey" className="gap-x-1">
                      <DocumentText className="text-ui-fg-muted" />
                      <span className="max-w-[150px] truncate">{t.noteTitle || 'note'}</span>
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ── tiny date helpers (no external import beyond host.dates) ─────────────────────
function isoFallback(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function parseISOParts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  const now = new Date()
  if (!m) return { year: now.getFullYear(), month0: now.getMonth(), day: now.getDate() }
  return { year: Number(m[1]), month0: Number(m[2]) - 1, day: Number(m[3]) }
}
function stepMonth({ year, month0 }, delta) {
  const d = new Date(year, month0 + delta, 1)
  return { year: d.getFullYear(), month0: d.getMonth() }
}
