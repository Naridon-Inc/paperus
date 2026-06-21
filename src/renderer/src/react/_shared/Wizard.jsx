// Wizard.jsx — a reusable multi-step wizard built on Medusa's FocusModal +
// ProgressTabs, mirroring the Medusa admin create-flows (stepped header with
// status ticks, Cancel/Back on the left, Continue → finish on the right).
//
// Consumers pass `steps` (each with an id, label, rendered content, and an
// optional `canContinue` gate) and an `onFinish` handler invoked on the last
// step. Used by the calendar New-Event flow and the email Connect-Inbox flow so
// every "creation" in the app looks and behaves the same.
//
// Portal note: Medusa's FocusModal portals to <body> (outside the island). The
// Tailwind config uses `important: true` (utilities are global `!important`, not
// scoped to `#react-root`) precisely so this body-portalled modal is fully styled
// and its `fixed inset-2` covers the WHOLE viewport, above the sidebar and
// everything else. Dark tokens follow because theme.js puts `.dark` on <html>.
//
// z-index: Medusa gives its overlay/content no z-index (in the Medusa admin
// nothing competes). The vanilla app has stacking contexts up to z-index 100001
// (command palette, dialogs), which would paint OVER a z:auto modal. So we pin the
// overlay + content above everything with `z-[2000000]`.
const Z = 'z-[2000000]'

import { useState } from 'react'
import { FocusModal, ProgressTabs, Button } from '@medusajs/ui'

const SR_ONLY = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}

export default function Wizard({
  open,
  onOpenChange,
  steps = [],
  finishLabel = 'Create',
  onFinish,
  busy = false,
  title,
  trigger = null,
}) {
  const [idx, setIdx] = useState(0)

  const safe = Array.isArray(steps) ? steps : []
  const step = safe[idx] || {}
  const isLast = idx >= safe.length - 1
  const canContinue = step.canContinue !== false

  const handleOpenChange = (o) => {
    if (!o) setIdx(0) // reset for next time
    if (onOpenChange) onOpenChange(o)
  }

  const statusFor = (i) => {
    if (i < idx) return 'completed'
    if (i === idx) return 'in-progress'
    return 'not-started'
  }

  const goPrev = () => setIdx((i) => Math.max(0, i - 1))
  const goNext = async () => {
    if (!isLast) { setIdx((i) => Math.min(safe.length - 1, i + 1)); return }
    const res = onFinish ? await onFinish() : true
    if (res !== false) { setIdx(0); handleOpenChange(false) }
  }
  // Allow clicking a *visited* step in the header to jump back.
  const onValueChange = (v) => {
    const target = safe.findIndex((s) => s.id === v)
    if (target >= 0 && target <= idx) setIdx(target)
  }

  const a11yTitle = title || step.label || 'Dialog'

  return (
      <FocusModal open={open} onOpenChange={handleOpenChange}>
        {trigger ? <FocusModal.Trigger asChild>{trigger}</FocusModal.Trigger> : null}
        <FocusModal.Content className={Z} overlayProps={{ className: Z }}>
          <FocusModal.Title style={SR_ONLY}>{a11yTitle}</FocusModal.Title>
          <ProgressTabs value={step.id} onValueChange={onValueChange}>
            <FocusModal.Header>
              <div className="flex w-full items-center justify-between gap-4">
                <div className="flex-1 overflow-hidden">
                  <ProgressTabs.List className="flex w-full items-center">
                    {safe.map((s, i) => (
                      <ProgressTabs.Trigger key={s.id} value={s.id} status={statusFor(i)}>
                        {s.label}
                      </ProgressTabs.Trigger>
                    ))}
                  </ProgressTabs.List>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {idx > 0 ? (
                    <Button variant="secondary" size="small" onClick={goPrev} disabled={busy}>Back</Button>
                  ) : (
                    <FocusModal.Close asChild>
                      <Button variant="secondary" size="small" disabled={busy}>Cancel</Button>
                    </FocusModal.Close>
                  )}
                  <Button
                    variant="primary"
                    size="small"
                    onClick={goNext}
                    disabled={busy || !canContinue}
                    isLoading={busy && isLast}
                  >
                    {isLast ? finishLabel : 'Continue'}
                  </Button>
                </div>
              </div>
            </FocusModal.Header>
            <FocusModal.Body className="flex w-full flex-col items-center overflow-y-auto p-0">
              <div style={{ width: '100%', maxWidth: 620, margin: 'auto', padding: '36px 24px' }}>
                {safe.map((s) => (
                  <ProgressTabs.Content key={s.id} value={s.id} className="outline-none">
                    {s.content}
                  </ProgressTabs.Content>
                ))}
              </div>
            </FocusModal.Body>
          </ProgressTabs>
        </FocusModal.Content>
      </FocusModal>
  )
}
