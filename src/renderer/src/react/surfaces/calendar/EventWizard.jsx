// EventWizard.jsx — the "New event" create-flow for the Calendar surface.
//
// A Medusa wizard (FocusModal + ProgressTabs, via the shared <Wizard>) that
// collects an event's title / date / time / reminder and writes it through
// host.events.create — which appends a `- [ ] <title> @date(iso)` task line to
// the relevant daily note, so the event appears on the month grid and in Tasks.
// Mirrors how Medusa admin builds stepped create flows.

import React, { useEffect, useState } from 'react'
import { Input, Label, Switch, Text } from '@medusajs/ui'
import { CalendarSolid } from '@medusajs/icons'
import Wizard from '../../_shared/Wizard.jsx'

function prettyDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return iso || '—'
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  try {
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  } catch (_e) { return iso }
}

export default function EventWizard({ open, onOpenChange, date, onCreate }) {
  const [title, setTitle] = useState('')
  const [iso, setIso] = useState(date || '')
  const [allDay, setAllDay] = useState(true)
  const [time, setTime] = useState('09:00')
  const [remind, setRemind] = useState(false)
  const [busy, setBusy] = useState(false)

  // Re-seed every time the wizard opens (for whichever day was clicked).
  useEffect(() => {
    if (!open) return
    setTitle('')
    setIso(date || '')
    setAllDay(true)
    setTime('09:00')
    setRemind(false)
    setBusy(false)
  }, [open, date])

  const finish = async () => {
    const t = title.trim()
    if (!t || !iso) return false
    setBusy(true)
    try {
      const res = await onCreate({ iso, title: t, remind, allDay, time: allDay ? '' : time })
      return !(res && res.ok === false)
    } catch (_e) {
      return false
    } finally {
      setBusy(false)
    }
  }

  const steps = [
    {
      id: 'details',
      label: 'Details',
      canContinue: title.trim().length > 0,
      content: (
        <div>
          <div className="pp-wizard-eyebrow">New event</div>
          <h2 className="pp-wizard-title" style={{ marginTop: 4 }}>What&rsquo;s happening?</h2>
          <p className="pp-wizard-sub" style={{ marginTop: 6 }}>
            Events are saved as a dated task on your daily note, so they show up here and in Tasks.
          </p>
          <div className="pp-wizard-fields">
            <div className="pp-fieldrow">
              <Label htmlFor="ev-title" weight="plus" size="small">Title</Label>
              <Input
                id="ev-title"
                autoFocus
                placeholder="e.g. Design review with Sarah"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <label className="pp-wizard-toggle" htmlFor="ev-allday">
              <span className="flex flex-col">
                <Label size="small" weight="plus">All day</Label>
                <Text size="xsmall" className="text-ui-fg-subtle">Turn off to set a specific time</Text>
              </span>
              <Switch id="ev-allday" checked={allDay} onCheckedChange={setAllDay} />
            </label>
            {!allDay ? (
              <div className="pp-fieldrow">
                <Label htmlFor="ev-time" weight="plus" size="small">Time</Label>
                <Input id="ev-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      id: 'when',
      label: 'Schedule',
      canContinue: !!iso,
      content: (
        <div>
          <div className="pp-wizard-eyebrow">New event</div>
          <h2 className="pp-wizard-title" style={{ marginTop: 4 }}>When &amp; reminders</h2>
          <p className="pp-wizard-sub" style={{ marginTop: 6 }}>Pick the day this lands on.</p>
          <div className="pp-wizard-fields">
            <div className="pp-fieldrow">
              <Label htmlFor="ev-date" weight="plus" size="small">Date</Label>
              <Input id="ev-date" type="date" value={iso} onChange={(e) => setIso(e.target.value)} />
            </div>
            <label className="pp-wizard-toggle" htmlFor="ev-remind">
              <span className="flex flex-col">
                <Label size="small" weight="plus">Remind me</Label>
                <Text size="xsmall" className="text-ui-fg-subtle">Adds a reminder marker to the task</Text>
              </span>
              <Switch id="ev-remind" checked={remind} onCheckedChange={setRemind} />
            </label>
            <div className="pp-wizard-summary">
              <span className="pp-wizard-summary__ico"><CalendarSolid /></span>
              <div>
                <div className="pp-wizard-summary__title">{title.trim() || 'Untitled event'}</div>
                <div className="pp-wizard-summary__sub">
                  {prettyDate(iso)}{!allDay && time ? ` · ${time}` : ''}{remind ? ' · reminder' : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
    },
  ]

  return (
    <Wizard
      open={open}
      onOpenChange={onOpenChange}
      steps={steps}
      finishLabel="Add event"
      onFinish={finish}
      busy={busy}
    />
  )
}
