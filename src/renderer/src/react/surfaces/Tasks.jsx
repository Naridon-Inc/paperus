// Tasks.jsx — the Tasks surface (React island, @medusajs/ui).
//
// Reads the scan from the host bridge (host.scan), buckets it with the pure
// date-index helpers, and renders Overdue / Today / Upcoming / No date / Done
// sections. Each row is a Medusa Checkbox that toggles the underlying Markdown
// checkbox back to disk / into the team CRDT via host.scan.toggleTask.
//
// Visual layer = the `.pp-*` Paperus surface design system in island.css (cards,
// dense rows, status chips). One-directional seam: this file never imports
// vanilla app modules except the pure date-index helpers; everything else flows
// through `useHost()`.
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Badge,
  Button,
  Checkbox,
  Select,
  Tooltip,
  TooltipProvider,
} from '@medusajs/ui'
import {
  Plus,
  ArrowPath,
  DocumentText,
  BellAlert,
  CheckCircleSolid,
} from '@medusajs/icons'
import { useHost } from '../host.js'
import { buildBuckets } from '../../date-index.js'

// Bucket → display metadata (order, label, count + date-chip color class).
const SECTIONS = [
  { key: 'overdue', label: 'Overdue', count: 'pp-count--red', chip: 'pp-chip--red' },
  { key: 'today', label: 'Today', count: 'pp-count--amber', chip: 'pp-chip--amber' },
  { key: 'upcoming', label: 'Upcoming', count: 'pp-count', chip: '' },
  { key: 'noDate', label: 'No date', count: 'pp-count', chip: '' },
  { key: 'done', label: 'Done', count: 'pp-count--green', chip: '' },
]

/** Parse a team source descriptor `team:<teamId>:<noteId>` → {teamId, noteId} | null. */
function parseTeamSource(source) {
  const s = String(source || '')
  if (!s.startsWith('team:')) return null
  const rest = s.slice('team:'.length)
  const idx = rest.indexOf(':')
  if (idx < 0) return null
  return { teamId: rest.slice(0, idx), noteId: rest.slice(idx + 1) }
}
function isTeamSource(source) { return String(source || '').startsWith('team:') }

export default function Tasks() {
  const host = useHost()
  const [scan, setScan] = useState(() => (host.scan && host.scan.getScan ? host.scan.getScan() : { tasks: [] }))
  const [scope, setScope] = useState('all') // 'all' | 'assigned'
  const [sourceFilter, setSourceFilter] = useState('__all__')
  const [busy, setBusy] = useState(() => new Set()) // task ids mid-toggle

  // Mount: kick a scan, prime from cache, subscribe to updates.
  useEffect(() => {
    let alive = true
    try { host.scan && host.scan.requestScan && host.scan.requestScan() } catch (_e) { /* noop */ }
    const off = host.on
      ? host.on('scan:updated', (detail) => { if (alive && detail) setScan(detail) })
      : () => {}
    return () => { alive = false; try { off() } catch (_e) { /* noop */ } }
  }, [host])

  const tasks = Array.isArray(scan && scan.tasks) ? scan.tasks : []

  // Source filter options: All + one per distinct (source,noteTitle).
  const sources = useMemo(() => {
    const seen = new Map()
    for (const t of tasks) {
      if (t && t.source && !seen.has(t.source)) seen.set(t.source, t.noteTitle || t.source)
    }
    return Array.from(seen, ([value, label]) => ({ value, label }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)))
  }, [tasks])

  // Apply the top-bar filters (scope + source) before bucketing.
  const filtered = useMemo(() => {
    let list = tasks
    if (scope === 'assigned') list = list.filter((t) => t && Array.isArray(t.assignees) && t.assignees.length > 0)
    if (sourceFilter !== '__all__') list = list.filter((t) => t && t.source === sourceFilter)
    return list
  }, [tasks, scope, sourceFilter])

  const todayISO = (host.dates && host.dates.todayISO) ? host.dates.todayISO() : undefined
  const buckets = useMemo(() => buildBuckets(filtered, { todayISO }), [filtered, todayISO])

  const openSource = useCallback((task) => {
    if (!task || !task.source) return
    const team = parseTeamSource(task.source)
    if (team) { try { host.openTeamNote(team.teamId, team.noteId) } catch (_e) { /* noop */ } return }
    try { host.openFile(task.source) } catch (_e) { /* noop */ }
  }, [host])

  const onToggle = useCallback(async (task, nextDone) => {
    if (!task) return
    setBusy((prev) => { const n = new Set(prev); n.add(task.id); return n })
    try {
      const res = await (host.scan && host.scan.toggleTask
        ? host.scan.toggleTask(task, nextDone)
        : Promise.resolve({ ok: false }))
      if (!res || !res.ok) {
        try { host.toast('Open the note to change this task') } catch (_e) { /* noop */ }
      }
    } catch (_e) {
      try { host.toast('Open the note to change this task') } catch (_e2) { /* noop */ }
    } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(task.id); return n })
    }
  }, [host])

  const total = tasks.length
  const visible = filtered.length

  return (
    <TooltipProvider>
      <div className="pp-surface">
        {/* ── top bar ───────────────────────────────────────────────────── */}
        <header className="pp-header">
          <div className="flex flex-col">
            <h1 className="pp-title">Tasks</h1>
            <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 1 }}>
              {visible === total ? `${total} task${total === 1 ? '' : 's'}` : `${visible} of ${total}`}
            </span>
          </div>

          <div className="pp-spacer" />

          <div className="pp-seg" role="tablist" aria-label="Scope">
            <button type="button" role="tab" aria-selected={scope === 'all'} className="pp-seg-btn" onClick={() => setScope('all')}>All</button>
            <button type="button" role="tab" aria-selected={scope === 'assigned'} className="pp-seg-btn" onClick={() => setScope('assigned')}>Assigned</button>
          </div>

          <div className="w-[190px]">
            <Select value={sourceFilter} onValueChange={setSourceFilter} size="small">
              <Select.Trigger>
                <Select.Value placeholder="All notes" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="__all__">All notes</Select.Item>
                {sources.map((s) => (
                  <Select.Item key={s.value} value={s.value}>{s.label}</Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          <Button variant="secondary" size="small" onClick={() => { try { host.openDailyNote() } catch (_e) { /* noop */ } }}>
            <Plus /> Today&apos;s note
          </Button>
          <Tooltip content="Rescan notes for tasks">
            <button
              type="button"
              className="pp-iconbtn"
              aria-label="Rescan"
              onClick={() => { try { host.scan && host.scan.requestScan && host.scan.requestScan({ force: true }) } catch (_e) { /* noop */ } }}
            >
              <ArrowPath />
            </button>
          </Tooltip>
        </header>

        {/* ── body ──────────────────────────────────────────────────────── */}
        <div className="pp-body">
          {visible === 0 ? (
            <EmptyState onCreate={() => { try { host.openDailyNote() } catch (_e) { /* noop */ } }} />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              {SECTIONS.map((section) => {
                const items = buckets[section.key] || []
                if (!items.length) return null
                return (
                  <section key={section.key} className="flex flex-col gap-2.5">
                    <div className="pp-sec-head">
                      <span className="pp-sec-title">{section.label}</span>
                      <span className={section.count}>{items.length}</span>
                    </div>
                    <div className="pp-card">
                      <div className="pp-list">
                        {items.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            busy={busy.has(task.id)}
                            chipClass={section.chip}
                            onToggle={onToggle}
                            onOpenSource={openSource}
                          />
                        ))}
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

function TaskRow({ task, busy, chipClass, onToggle, onOpenSource }) {
  const host = useHost()
  const team = isTeamSource(task.source)
  const liveTeam = team && !!task.ytext // team task with a live Y.Text can be toggled in place
  const checkbox = (
    <Checkbox
      checked={!!task.done}
      disabled={busy}
      onCheckedChange={(val) => onToggle(task, val === true)}
    />
  )

  const fmtDate = (host.dates && host.dates.formatDateLabel) ? host.dates.formatDateLabel : (x) => x

  return (
    <div className="pp-row" style={{ alignItems: 'flex-start' }}>
      <div style={{ paddingTop: 1 }}>
        {team && !liveTeam ? (
          <Tooltip content="Open the note to toggle this task">{checkbox}</Tooltip>
        ) : checkbox}
      </div>

      <div className="min-w-0 flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span style={{
          fontSize: 13.5,
          lineHeight: 1.45,
          color: task.done ? 'var(--fg-muted)' : 'var(--fg-base)',
          textDecoration: task.done ? 'line-through' : 'none',
        }}>
          {task.text || <span style={{ color: 'var(--fg-muted)' }}>(empty task)</span>}
        </span>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {/* note chip → open source */}
          <button
            type="button"
            className="pp-chip pp-chip--btn"
            onClick={() => onOpenSource(task)}
            title={`Open ${task.noteTitle || 'note'}`}
          >
            <DocumentText />
            <span className="pp-chip__label">{task.noteTitle || 'note'}</span>
          </button>

          {/* due-date chip (colored by bucket) with a bell if a reminder */}
          {task.dueISO ? (
            <span className={`pp-chip ${chipClass}`}>
              {task.remind ? <BellAlert /> : null}
              <span className="pp-chip__label">{fmtDate(task.dueISO)}</span>
            </span>
          ) : null}

          {/* assignees */}
          {(task.assignees || []).map((a) => (
            <span key={a} className="pp-chip pp-chip--accent">@{a}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onCreate }) {
  return (
    <div className="pp-empty">
      <div className="pp-empty-icon"><CheckCircleSolid /></div>
      <div style={{ fontSize: 16, fontWeight: 640, letterSpacing: '-.01em', color: 'var(--fg-base)' }}>No tasks yet</div>
      <div style={{ fontSize: 13.5, maxWidth: 380, lineHeight: 1.55, color: 'var(--fg-subtle)' }}>
        Add a checkbox to any note — <span className="pp-kbd">- [ ] write the spec</span> — and it shows up here.
        Use <span className="pp-kbd">@date(…)</span> for a due date and <span className="pp-kbd">@name</span> to assign it.
      </div>
      <div style={{ marginTop: 4 }}>
        <Button variant="secondary" size="small" onClick={onCreate}>
          <Plus /> Open today&apos;s note
        </Button>
      </div>
    </div>
  )
}
