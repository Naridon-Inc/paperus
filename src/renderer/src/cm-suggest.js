/**
 * Suggested edits / track-changes for the CodeMirror 6 markdown editor, using
 * CriticMarkup syntax:
 *
 *   {++inserted++}        → insertion   (green underline)
 *   {--deleted--}         → deletion    (red strikethrough)
 *   {~~old~>new~~}        → substitution (red strike old + green new)
 *   {>>comment<<}         → a comment bubble marker
 *   {==marked==}{>>note<<}→ highlighted span with an attached note
 *
 * OVERLAP-SAFETY: rendering uses ONLY `Decoration.mark` (CSS classes) plus a
 * single zero-width inline `Decoration.widget` for the accept/reject controls.
 * Mark decorations may freely overlap other marks AND the replace ranges used by
 * wiki/math/etc., so this never participates in the non-overlapping replace
 * invariant in cm-hide-markers.js. Markers are dimmed (not removed) via a marker
 * mark class when the cursor is outside the span — same model as cm-highlight.js.
 *
 * ACCEPT / REJECT: `applySuggestion(view, from, to, action)` rewrites the doc
 * text. When the cursor sits on a CriticMarkup span, a small ✓/✗ widget appears
 * just after it. Buttons dispatch the change.
 *
 * SUGGESTION MODE: `toggleSuggestMode()` flips a flag; a floating button (guarded
 * once) injects into the DOM. While ON, a `suggestModeFilter` transactionFilter
 * (added in cm-editor.js) rewrites the user's plain insertions into `{++…++}`
 * and plain deletions into `{--…--}` — see caveats in the export docs.
 */
import { WidgetType, Decoration } from '@codemirror/view'
import { StateEffect, EditorState } from '@codemirror/state'

// One regex per CriticMarkup construct. Order matters when scanning: we run them
// independently over the full doc and de-dupe by range, longest-first.
const CRIT_RES = [
  { kind: 'sub', re: /\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g },
  { kind: 'ins', re: /\{\+\+([\s\S]*?)\+\+\}/g },
  { kind: 'del', re: /\{--([\s\S]*?)--\}/g },
  { kind: 'comment', re: /\{>>([\s\S]*?)<<\}/g },
  { kind: 'mark', re: /\{==([\s\S]*?)==\}/g },
]

/**
 * Parse all CriticMarkup spans in `text`.
 * @returns {{from:number,to:number,kind:string,a:string,b:string}[]} sorted by from.
 */
export function parseCritic(text) {
  const spans = []
  for (const { kind, re } of CRIT_RES) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      spans.push({
        from: m.index,
        to: m.index + m[0].length,
        kind,
        a: m[1] != null ? m[1] : '',
        b: m[2] != null ? m[2] : '',
      })
    }
  }
  spans.sort((x, y) => x.from - y.from || (y.to - y.from) - (x.to - x.from))
  // Drop spans nested inside an already-claimed span (e.g. {== ==} preceding a
  // {>> <<} are independent and both kept; true containment is dropped).
  const out = []
  let lastTo = -1
  for (const s of spans) {
    if (s.from < lastTo) continue
    out.push(s)
    lastTo = s.to
  }
  return out
}

/**
 * Apply (accept) or remove (reject) a CriticMarkup span at [from,to).
 * @param {EditorView} view
 * @param {number} from  @param {number} to  span bounds (the full {…} markup)
 * @param {'accept'|'reject'} action
 */
export function applySuggestion(view, from, to, action) {
  if (!view) return
  const text = view.state.doc.sliceString(from, to)
  let replacement = null

  let m
  if ((m = /^\{~~([\s\S]*?)~>([\s\S]*?)~~\}$/.exec(text))) {
    // substitution: accept → new, reject → old
    replacement = action === 'accept' ? m[2] : m[1]
  } else if ((m = /^\{\+\+([\s\S]*?)\+\+\}$/.exec(text))) {
    // insertion: accept → keep inner, reject → remove
    replacement = action === 'accept' ? m[1] : ''
  } else if ((m = /^\{--([\s\S]*?)--\}$/.exec(text))) {
    // deletion: accept → remove, reject → keep inner
    replacement = action === 'accept' ? '' : m[1]
  } else if ((m = /^\{>>([\s\S]*?)<<\}$/.exec(text))) {
    // comment: accept and reject both just drop the comment markup
    replacement = ''
  } else if ((m = /^\{==([\s\S]*?)==\}$/.exec(text))) {
    // marked: accept → keep inner text (drop markers), reject → keep inner too
    // (rejecting a highlight shouldn't delete content), so both unwrap.
    replacement = m[1]
  }

  if (replacement === null) return
  view.dispatch({
    changes: { from, to, insert: replacement },
    selection: { anchor: from + replacement.length },
  })
  view.focus()
}

// ── Accept/reject controls (inline zero-width widget, overlap-safe) ─────────────

class CriticControlsWidget extends WidgetType {
  constructor(from, to, kind) {
    super()
    this.from = from
    this.to = to
    this.kind = kind
  }

  eq(other) {
    return other.from === this.from && other.to === this.to && other.kind === this.kind
  }

  toDOM(view) {
    const box = document.createElement('span')
    box.className = 'cm-crit-controls'
    const accept = document.createElement('button')
    accept.className = 'cm-crit-btn cm-crit-accept'
    accept.textContent = '✓'
    accept.title = 'Accept'
    const reject = document.createElement('button')
    reject.className = 'cm-crit-btn cm-crit-reject'
    reject.textContent = '✗'
    reject.title = 'Reject'
    for (const [btn, action] of [[accept, 'accept'], [reject, 'reject']]) {
      btn.addEventListener('mousedown', (e) => e.preventDefault())
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        applySuggestion(view, this.from, this.to, action)
      })
    }
    box.appendChild(accept)
    box.appendChild(reject)
    return box
  }

  ignoreEvent() { return true }
}

/**
 * Collect overlap-safe CriticMarkup decorations for the whole document.
 * Returns mark decorations (styling + dim markers) and an inline controls widget
 * when the cursor is on a span. NEVER emits a `Decoration.replace`, so it is safe
 * against the existing non-overlapping-replace invariant.
 *
 * @param {EditorState} state
 * @param {{from:number,to:number}[]} codeRanges  code spans to skip
 * @param {(state,from,to)=>boolean} cursorInRange  reveal/controls predicate
 * @returns {{decos:import('@codemirror/view').Range[], ranges:{from:number,to:number}[]}}
 */
export function collectCriticDecorations(state, codeRanges, cursorInRange) {
  const decos = []
  const ranges = []
  const text = state.doc.toString()
  const spans = parseCritic(text)

  for (const s of spans) {
    if (codeRanges && codeRanges.some(r => s.from < r.to && s.to > r.from)) continue
    ranges.push({ from: s.from, to: s.to })
    const onSpan = cursorInRange(state, s.from, s.to)

    if (s.kind === 'sub') {
      // {~~old~>new~~}: markers + arrow dimmed; old = strike, new = ins.
      const oldFrom = s.from + 3
      const oldTo = oldFrom + s.a.length
      const arrowFrom = oldTo
      const arrowTo = arrowFrom + 2 // "~>"
      const newFrom = arrowTo
      const newTo = newFrom + s.b.length
      if (s.a) decos.push(Decoration.mark({ class: 'cm-crit-sub-old' }).range(oldFrom, oldTo))
      if (s.b) decos.push(Decoration.mark({ class: 'cm-crit-sub-new' }).range(newFrom, newTo))
      if (!onSpan) {
        decos.push(Decoration.mark({ class: 'cm-crit-marker' }).range(s.from, oldFrom))
        decos.push(Decoration.mark({ class: 'cm-crit-marker' }).range(arrowFrom, arrowTo))
        decos.push(Decoration.mark({ class: 'cm-crit-marker' }).range(newTo, s.to))
      }
    } else {
      let cls = ''
      let openLen = 3
      let closeLen = 3
      if (s.kind === 'ins') cls = 'cm-crit-ins'
      else if (s.kind === 'del') cls = 'cm-crit-del'
      else if (s.kind === 'comment') cls = 'cm-crit-comment'
      else if (s.kind === 'mark') cls = 'cm-crit-mark'
      const bodyFrom = s.from + openLen
      const bodyTo = s.to - closeLen
      if (bodyTo > bodyFrom) decos.push(Decoration.mark({ class: cls }).range(bodyFrom, bodyTo))
      if (!onSpan) {
        decos.push(Decoration.mark({ class: 'cm-crit-marker' }).range(s.from, bodyFrom))
        decos.push(Decoration.mark({ class: 'cm-crit-marker' }).range(bodyTo, s.to))
      }
    }

    // Inline accept/reject controls when the cursor is on the span (skip plain
    // marks — accepting/rejecting a highlight is less meaningful, but allow it).
    if (onSpan && s.kind !== 'mark') {
      decos.push(
        Decoration.widget({
          widget: new CriticControlsWidget(s.from, s.to, s.kind),
          side: 1,
        }).range(s.to)
      )
    }
  }

  return { decos, ranges }
}

// ── Suggestion mode (best-effort auto-wrap via transactionFilter) ───────────────
//
// CAVEAT: true input interception is hard. This is a BEST-EFFORT implementation:
//   - It wraps single contiguous user insertions in {++…++}.
//   - It wraps user deletions of existing text in {--…--}, keeping the text.
//   - It deliberately IGNORES: multi-range changes, programmatic changes
//     (anything with a userEvent that isn't input.type/delete), IME composition,
//     paste-over-selection edge cases, and any change touching existing
//     CriticMarkup (to avoid nesting). When skipped, the edit applies normally.
//   - It is OFF by default. The slash-inserted suggestions + rendering +
//     accept/reject all work regardless of this mode.

let _suggestMode = false
const _modeListeners = new Set()

export function isSuggestMode() { return _suggestMode }

export function setSuggestMode(on) {
  _suggestMode = !!on
  for (const fn of _modeListeners) { try { fn(_suggestMode) } catch { /* ignore */ } }
}

export function toggleSuggestMode() {
  setSuggestMode(!_suggestMode)
  return _suggestMode
}

export function onSuggestModeChange(fn) {
  _modeListeners.add(fn)
  return () => _modeListeners.delete(fn)
}

// Marker effect so our own rewritten transactions aren't re-processed.
const fromFilterEffect = StateEffect.define()

/**
 * A CM transactionFilter that, while suggestion mode is ON, rewrites plain user
 * insertions/deletions into CriticMarkup. Added to the editor in cm-editor.js.
 * Returns the original transaction(s) unchanged when not applicable.
 */
export const suggestModeTransactionFilter = EditorState.transactionFilter.of((tr) => {
  if (!_suggestMode) return tr
  if (!tr.docChanged) return tr
  // Skip our own rewrites and any explicitly non-user transactions.
  if (tr.effects.some(e => e.is(fromFilterEffect))) return tr
  const userEvent = tr.isUserEvent('input.type') || tr.isUserEvent('delete')
  if (!userEvent) return tr

  // Collect the change set; only handle a SINGLE simple change.
  let count = 0
  let single = null
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    count++
    single = { fromA, toA, fromB, toB, insertedStr: inserted.toString() }
  })
  if (count !== 1 || !single) return tr

  const { fromA, toA, insertedStr } = single
  const docBefore = tr.startState.doc

  // Don't touch changes that intersect existing CriticMarkup (avoid nesting).
  const spans = parseCritic(docBefore.toString())
  const intersects = spans.some(s => fromA < s.to && toA > s.from)
  if (intersects) return tr

  const isInsertion = toA === fromA && insertedStr.length > 0
  const isDeletion = toA > fromA && insertedStr.length === 0

  if (isInsertion) {
    // Wrap inserted text: {++text++}. Place cursor before the closing ++}.
    const wrapped = `{++${insertedStr}++}`
    return {
      changes: { from: fromA, to: toA, insert: wrapped },
      selection: { anchor: fromA + 3 + insertedStr.length },
      effects: fromFilterEffect.of(null),
      scrollIntoView: true,
    }
  }

  if (isDeletion) {
    // Convert deletion into a suggested deletion: keep the text, wrap in {--…--}.
    const removed = docBefore.sliceString(fromA, toA)
    if (!removed) return tr
    const wrapped = `{--${removed}--}`
    return {
      changes: { from: fromA, to: toA, insert: wrapped },
      selection: { anchor: fromA + wrapped.length },
      effects: fromFilterEffect.of(null),
      scrollIntoView: true,
    }
  }

  return tr
})

// ── Floating toggle button (guarded once) ───────────────────────────────────────

let _btnInjected = false

/**
 * Inject a small floating "Suggesting" toggle button into the DOM. Guarded so it
 * only ever creates one. Safe to call from cm-editor.js on editor creation.
 */
export function ensureSuggestToggleButton() {
  if (_btnInjected) return
  if (typeof document === 'undefined') return
  _btnInjected = true
  const btn = document.createElement('button')
  btn.className = 'cm-suggest-toggle'
  btn.type = 'button'
  btn.title = 'Toggle suggestion mode (track changes)'
  btn.textContent = 'Suggesting: Off'
  const sync = (on) => {
    btn.textContent = on ? 'Suggesting: On' : 'Suggesting: Off'
    btn.classList.toggle('active', !!on)
  }
  btn.addEventListener('click', () => sync(toggleSuggestMode()))
  onSuggestModeChange(sync)
  // Append once the body exists.
  if (document.body) document.body.appendChild(btn)
  else window.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn))
}
