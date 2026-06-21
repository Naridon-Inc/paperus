/**
 * cm-focus.js — Focus / Zen writing mode for the CodeMirror editor.
 *
 * When ON, every line outside the *active block* (the contiguous run of
 * non-blank lines containing the cursor) is dimmed, and the caret line is kept
 * vertically centred (typewriter scrolling). It's a single toggleable StateField
 * driven by a StateEffect — inert (zero decorations, zero work) until switched
 * on, so it's safe to always include in the editor's extension list.
 *
 * Mirrors the decoration cadence of cm-hide-markers.js (rebuild on docChanged /
 * selection), and ships its own CSS via EditorView.theme so no global stylesheet
 * edit is needed.
 */
import { StateField, StateEffect } from '@codemirror/state'
import { EditorView, Decoration } from '@codemirror/view'

/** Toggle effect: dispatch `setFocusEffect.of(true|false)` to switch the mode. */
export const setFocusEffect = StateEffect.define()

const focusTheme = EditorView.theme({
  '.cm-focus-dim': { opacity: '0.22', transition: 'opacity 240ms ease' },
  '.cm-focus-active': { opacity: '1', transition: 'opacity 240ms ease' },
})

const dimDeco = Decoration.line({ class: 'cm-focus-dim' })
const activeDeco = Decoration.line({ class: 'cm-focus-active' })

/** Per-line decorations dimming everything outside the cursor's paragraph. */
function buildFocusDecos(state) {
  const head = state.selection.main.head
  const curLine = state.doc.lineAt(head)
  const total = state.doc.lines
  const isBlank = (n) => state.doc.line(n).text.trim() === ''

  let topN = curLine.number
  let botN = curLine.number
  // Grow the active block over contiguous non-blank lines. If the cursor sits on
  // a blank line, the active block is just that line.
  if (!isBlank(curLine.number)) {
    while (topN > 1 && !isBlank(topN - 1)) topN -= 1
    while (botN < total && !isBlank(botN + 1)) botN += 1
  }

  const ranges = []
  for (let n = 1; n <= total; n += 1) {
    const line = state.doc.line(n)
    const inActive = n >= topN && n <= botN
    ranges.push((inActive ? activeDeco : dimDeco).range(line.from))
  }
  return Decoration.set(ranges, true)
}

const EMPTY = { on: false, deco: Decoration.none }

export const focusField = StateField.define({
  create() { return EMPTY },
  update(value, tr) {
    let on = value.on
    let toggled = false
    for (const e of tr.effects) {
      if (e.is(setFocusEffect)) { on = e.value; toggled = true }
    }
    if (!on) return value.on || toggled ? EMPTY : value
    if (toggled || tr.docChanged || tr.selection) {
      return { on: true, deco: buildFocusDecos(tr.state) }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

// Typewriter scrolling: while focus is on, keep the caret line centred. Deferred
// to the next frame so we never dispatch re-entrantly from inside an update.
const typewriter = EditorView.updateListener.of((update) => {
  if (!update.selectionSet && !update.docChanged) return
  const f = update.state.field(focusField, false)
  if (!f || !f.on) return
  const head = update.state.selection.main.head
  requestAnimationFrame(() => {
    try {
      update.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
    } catch (_e) { /* view may be gone after a rebind */ }
  })
})

/** The extension to add to the editor. Inert until toggled on. */
export const focusMode = [focusField, focusTheme, typewriter]

/** Flip focus mode for a view. Returns the new on/off state. */
export function toggleFocusMode(view) {
  if (!view) return false
  const cur = view.state.field(focusField, false)
  const next = !(cur && cur.on)
  view.dispatch({ effects: setFocusEffect.of(next) })
  return next
}

/** Whether focus mode is currently on for a view. */
export function isFocusOn(view) {
  const f = view && view.state.field(focusField, false)
  return !!(f && f.on)
}
