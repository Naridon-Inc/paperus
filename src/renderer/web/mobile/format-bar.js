/**
 * format-bar.js — the above-keyboard markdown formatting toolbar for the mobile
 * companion's NoteScreen (src/renderer/web/mobile/screen-note.js).
 *
 * The buffer is NATIVE MARKDOWN (the CM6 editor edits markdown text, not a
 * rich-text model — see cm-editor.js), so every button here is a plain text
 * transform on the CM6 selection / line, applied via `view.dispatch`. There are
 * NO new CodeMirror extensions and NO new cm-editor exports — we only read the
 * primary selection (getSelection) and write changes through transactions.
 *
 * View atoms (el / icon / IconButton) come from the shared ui.js toolkit; the
 * only engine-layer import is the cm-editor selection helper. Nothing here knows
 * about Yjs, the engine, the team manager, or the nav — yCollab observes the
 * doc changes our transactions produce and syncs them for free.
 *
 * Touch-first contract:
 *   - Buttons preventDefault on pointerdown so tapping a format button does NOT
 *     blur the editor (the on-screen keyboard stays up).
 *   - The bar rides the top of the on-screen keyboard via window.visualViewport
 *     (resize/scroll -> bottom = innerHeight - vv.height - vv.offsetTop), with a
 *     safe-area fallback when visualViewport is unavailable.
 *   - It is hidden whenever the bound editor is not focused — never hover-gated.
 *
 * Frozen API (consumed by screen-note.js in parallel):
 *   createFormatBar() => { root, attach(view), detach(), destroy() }
 * Brief aliases provided additively (so either call-shape works):
 *   .el  === .root        (DOM-first alias)
 *   .attachTo(parent)     (append .root into a parent, no view binding)
 */

import { el, icon, IconButton } from './ui.js'
import { getSelection, insertAtCursor } from '../../src/cm-editor'

// ── Button table ─────────────────────────────────────────────────────────────
// Each entry: { icon (ui.js name), label (aria/title), run(view) }. Order is the
// left-to-right order in the scrollable bar. `run` receives the bound EditorView.

/**
 * Wrap the current selection (or insert paired markers at the cursor) with an
 * inline marker like ** (bold), * (italic) or ` (code). When there is no
 * selection the cursor is placed between the two markers so the user types
 * inside them; with a selection the marked range stays selected.
 *
 * @param {import('@codemirror/view').EditorView} view
 * @param {string} marker  e.g. '**', '*', '`'
 */
function wrapInline(view, marker) {
  const { from, to } = getSelection(view)
  const len = marker.length
  if (from < to) {
    // Insert the marker before `from` and after `to` in one transaction. The
    // second change uses doc coordinates (pre-edit) — CM applies them together.
    view.dispatch({
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      // Keep the original text selected (now shifted right by one marker).
      selection: { anchor: from + len, head: to + len },
    })
  } else {
    view.dispatch({
      changes: { from, insert: marker + marker },
      selection: { anchor: from + len },
    })
  }
  view.focus()
}

/**
 * Toggle a line-start prefix (e.g. '# ', '> ', '- ', '- [ ] ') on every line the
 * selection touches. If every targeted line already starts with the prefix it is
 * removed (toggle off); otherwise it is added to the lines that lack it.
 *
 * For the heading prefixes we strip any EXISTING heading marker first so toggling
 * H1->H2 swaps cleanly instead of stacking '## #'. Numbered lists get an
 * incrementing index per line.
 *
 * @param {import('@codemirror/view').EditorView} view
 * @param {string} prefix    e.g. '# ', '## ', '> ', '- ', '- [ ] '
 * @param {object} [opts]
 * @param {boolean} [opts.heading]  strip existing ATX heading markers before applying
 * @param {boolean} [opts.ordered]  treat prefix as a numbered-list seed ('1. ')
 */
function toggleLinePrefix(view, prefix, opts = {}) {
  const { state } = view
  const sel = state.selection.main
  const startLine = state.doc.lineAt(sel.from)
  const endLine = state.doc.lineAt(sel.to)

  // Heading markers we recognize for the strip/swap behavior.
  const headingRe = /^#{1,6}\s+/
  // Existing ordered-list prefix ("12. ") or bullet ("- "/"* "/"+ ").
  const orderedRe = /^\d+\.\s+/
  const bulletRe = /^[-*+]\s+/
  const quoteRe = /^>\s+/
  const checkRe = /^[-*+]\s+\[[ xX]\]\s+/

  // Decide toggle direction: are ALL targeted lines already prefixed?
  const matchesPrefix = (text) => {
    if (opts.heading) return headingRe.test(text) && text.startsWith(prefix)
    if (opts.ordered) return orderedRe.test(text)
    if (prefix === '- [ ] ') return checkRe.test(text)
    if (prefix === '> ') return quoteRe.test(text)
    if (prefix === '- ') return bulletRe.test(text) && !checkRe.test(text)
    return text.startsWith(prefix)
  }

  let allPrefixed = true
  for (let n = startLine.number; n <= endLine.number; n += 1) {
    if (!matchesPrefix(state.doc.line(n).text)) {
      allPrefixed = false
      break
    }
  }

  const changes = []
  let ordinal = 1
  for (let n = startLine.number; n <= endLine.number; n += 1) {
    const line = state.doc.line(n)
    const text = line.text

    if (allPrefixed) {
      // Toggle OFF: remove whichever recognized marker leads this line.
      let strip = 0
      if (opts.heading) {
        const m = text.match(headingRe)
        if (m) strip = m[0].length
      } else if (opts.ordered) {
        const m = text.match(orderedRe)
        if (m) strip = m[0].length
      } else if (prefix === '- [ ] ') {
        const m = text.match(checkRe)
        if (m) strip = m[0].length
      } else if (prefix === '> ') {
        const m = text.match(quoteRe)
        if (m) strip = m[0].length
      } else if (prefix === '- ') {
        const m = text.match(bulletRe)
        if (m) strip = m[0].length
      } else if (text.startsWith(prefix)) {
        strip = prefix.length
      }
      if (strip > 0) changes.push({ from: line.from, to: line.from + strip, insert: '' })
    } else {
      // Toggle ON. For headings, strip an existing heading marker first so we
      // swap levels instead of stacking. For lists, replace a sibling list type.
      let removeLen = 0
      let insert = prefix
      if (opts.heading) {
        const m = text.match(headingRe)
        if (m) removeLen = m[0].length
      } else if (opts.ordered) {
        const m = text.match(orderedRe) || text.match(bulletRe) || text.match(checkRe)
        if (m) removeLen = m[0].length
        insert = `${ordinal}. `
        ordinal += 1
      } else if (prefix === '- ') {
        const m = text.match(checkRe) || text.match(orderedRe) || text.match(bulletRe)
        if (m) removeLen = m[0].length
      } else if (prefix === '- [ ] ') {
        const m = text.match(bulletRe) || text.match(orderedRe)
        if (m) removeLen = m[0].length
      }
      changes.push({ from: line.from, to: line.from + removeLen, insert })
    }
  }

  if (changes.length) view.dispatch({ changes })
  view.focus()
}

/**
 * Insert a markdown link. With a selection: wrap it as [selection](url) and place
 * the cursor in the empty url slot. Without a selection: insert a [](url)
 * scaffold via the cm-editor helper and drop the cursor in the text slot.
 *
 * @param {import('@codemirror/view').EditorView} view
 */
function insertLink(view) {
  const { from, to } = getSelection(view)
  if (from < to) {
    const text = view.state.sliceDoc(from, to)
    const insert = `[${text}](url)`
    // url slot starts after "[text](" — i.e. from + text.length + 3.
    const urlStart = from + text.length + 3
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: urlStart, head: urlStart + 3 }, // select "url"
    })
  } else {
    // Scaffold: "[](url)" with the cursor between the brackets (the text slot).
    insertAtCursor(view, '[](url)')
    const caret = from + 1 // just inside the opening bracket
    view.dispatch({ selection: { anchor: caret } })
  }
  view.focus()
}

const BUTTONS = [
  { icon: 'bold', label: 'Bold', run: (v) => wrapInline(v, '**') },
  { icon: 'italic', label: 'Italic', run: (v) => wrapInline(v, '*') },
  { icon: 'h1', label: 'Heading 1', run: (v) => toggleLinePrefix(v, '# ', { heading: true }) },
  { icon: 'h2', label: 'Heading 2', run: (v) => toggleLinePrefix(v, '## ', { heading: true }) },
  { icon: 'h3', label: 'Heading 3', run: (v) => toggleLinePrefix(v, '### ', { heading: true }) },
  { icon: 'check-square', label: 'Checklist', run: (v) => toggleLinePrefix(v, '- [ ] ') },
  { icon: 'list', label: 'Bulleted list', run: (v) => toggleLinePrefix(v, '- ') },
  { icon: 'list-ordered', label: 'Numbered list', run: (v) => toggleLinePrefix(v, '1. ', { ordered: true }) },
  { icon: 'quote', label: 'Quote', run: (v) => toggleLinePrefix(v, '> ') },
  { icon: 'code', label: 'Inline code', run: (v) => wrapInline(v, '`') },
  { icon: 'link', label: 'Link', run: (v) => insertLink(v) },
]

// ── The bar ──────────────────────────────────────────────────────────────────

/**
 * Create the above-keyboard formatting toolbar.
 *
 * @returns {{
 *   root: HTMLElement,
 *   el: HTMLElement,
 *   attach: (view: import('@codemirror/view').EditorView) => void,
 *   attachTo: (parent: HTMLElement) => void,
 *   detach: () => void,
 *   destroy: () => void
 * }}
 */
export function createFormatBar() {
  // The bound CM6 view (set by attach, cleared by detach). All button handlers
  // close over `state.view` so re-attaching to a different view just works.
  const state = { view: null, vvBound: false, domBound: false }

  // Build the buttons. We attach the markdown command on tap, and — critically —
  // preventDefault on pointerdown/mousedown so the tap does NOT move focus out of
  // the editor (which would dismiss the keyboard and collapse the selection).
  const buttons = BUTTONS.map((b) => {
    const btn = IconButton({
      icon: b.icon,
      label: b.label,
      onTap: () => {
        if (state.view) b.run(state.view)
      },
      className: 'mob-formatbar-btn',
    })
    // Keep the editor focused: swallow the focus-stealing default of the press.
    const keepFocus = (e) => e.preventDefault()
    btn.addEventListener('pointerdown', keepFocus)
    btn.addEventListener('mousedown', keepFocus)
    btn.addEventListener('touchstart', keepFocus, { passive: false })
    return btn
  })

  const root = el(
    'div',
    {
      class: 'mob-formatbar',
      role: 'toolbar',
      'aria-label': 'Formatting',
    },
    buttons,
  )

  // ── Keyboard tracking ──────────────────────────────────────────────────────
  // Ride the top of the on-screen keyboard. When visualViewport is present, the
  // gap between the layout viewport bottom and the visual viewport bottom IS the
  // keyboard height; bottom = innerHeight - vv.height - vv.offsetTop puts the bar
  // flush on top of it. Without visualViewport, fall back to the safe-area inset.
  const reposition = () => {
    const vv = (typeof window !== 'undefined' && window.visualViewport) || null
    if (vv) {
      const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      root.style.bottom = `${gap}px`
    } else {
      // No visualViewport (older Android WebView / some desktops): sit above the
      // safe-area inset; the keyboard estimate is handled by CSS layout flow.
      root.style.bottom = 'env(safe-area-inset-bottom, 0px)'
    }
  }

  const onViewportChange = () => {
    // Only reposition while visible — avoids layout thrash when hidden.
    if (root.classList.contains('is-visible')) reposition()
  }

  // ── Focus tracking ─────────────────────────────────────────────────────────
  // Show on the editor's focusin, hide on focusout — never on hover. We bind to
  // the view's DOM (set in attach) so the bar only reacts to ITS editor.
  const show = () => {
    root.classList.add('is-visible')
    // Defer one frame so the keyboard has begun animating in and vv has updated.
    requestAnimationFrame(reposition)
    // A couple of follow-up frames catch the keyboard's slide-in on iOS where vv
    // resize events can lag the focus event.
    setTimeout(reposition, 120)
    setTimeout(reposition, 300)
  }
  const hide = () => {
    root.classList.remove('is-visible')
  }

  const onFocusIn = () => show()
  const onFocusOut = (e) => {
    // Ignore focus moving INTO the bar itself (button taps): those preventDefault
    // focus loss anyway, but guard defensively against relatedTarget in the bar.
    const next = e && e.relatedTarget
    if (next && root.contains(next)) return
    hide()
  }

  function bindViewportListeners() {
    if (state.vvBound) return
    const vv = (typeof window !== 'undefined' && window.visualViewport) || null
    if (vv) {
      vv.addEventListener('resize', onViewportChange)
      vv.addEventListener('scroll', onViewportChange)
    }
    // window resize as a coarse fallback so rotation / split-view still tracks.
    if (typeof window !== 'undefined') window.addEventListener('resize', onViewportChange)
    state.vvBound = true
  }

  function unbindViewportListeners() {
    if (!state.vvBound) return
    const vv = (typeof window !== 'undefined' && window.visualViewport) || null
    if (vv) {
      vv.removeEventListener('resize', onViewportChange)
      vv.removeEventListener('scroll', onViewportChange)
    }
    if (typeof window !== 'undefined') window.removeEventListener('resize', onViewportChange)
    state.vvBound = false
  }

  function bindFocusListeners(view) {
    if (state.domBound || !view || !view.dom) return
    view.dom.addEventListener('focusin', onFocusIn)
    view.dom.addEventListener('focusout', onFocusOut)
    state.domBound = true
  }

  function unbindFocusListeners() {
    if (!state.domBound || !state.view || !state.view.dom) {
      state.domBound = false
      return
    }
    state.view.dom.removeEventListener('focusin', onFocusIn)
    state.view.dom.removeEventListener('focusout', onFocusOut)
    state.domBound = false
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Bind the bar to a CM6 EditorView and start keyboard + focus tracking. If the
   * editor already has focus when we attach (e.g. autofocus on note open), show
   * immediately.
   * @param {import('@codemirror/view').EditorView} view
   */
  function attach(view) {
    if (state.view === view) return
    // Re-attach to a new view: drop the old focus listeners first.
    if (state.view) unbindFocusListeners()
    state.view = view || null
    if (!state.view) {
      hide()
      return
    }
    bindFocusListeners(state.view)
    bindViewportListeners()
    // If the editor is already focused, reveal now.
    const active = typeof document !== 'undefined' ? document.activeElement : null
    if (state.view.dom && (state.view.hasFocus || (active && state.view.dom.contains(active)))) {
      show()
    } else {
      hide()
    }
  }

  /** Append the bar's root into a parent (no view binding). Brief alias. */
  function attachTo(parent) {
    if (parent && root.parentNode !== parent) parent.appendChild(root)
  }

  /** Unbind from the current view, hide, and stop tracking. */
  function detach() {
    unbindFocusListeners()
    unbindViewportListeners()
    state.view = null
    hide()
  }

  /** Tear everything down: detach + remove the root from the DOM. */
  function destroy() {
    detach()
    if (root.parentNode) root.parentNode.removeChild(root)
  }

  return {
    root,
    el: root, // brief alias: .el === .root
    attach,
    attachTo,
    detach,
    destroy,
  }
}

export default createFormatBar
