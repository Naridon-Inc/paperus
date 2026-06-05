/**
 * screen-note.js — the full-screen mobile note editor screen.
 *
 * This is the load-bearing screen of the mobile companion view layer. It opens
 * the per-note CRDT engine through the manager seam, mounts a CodeMirror 6 view
 * bound to that engine with the EXACT yCollab binding recipe from the desktop
 * (main.js rebindEditor, lines 137-258), ADAPTED to (container, engine) and
 * STRIPPED of every desktop-only surface (slash menu, wiki autocomplete,
 * comments, selection toolbar, plugin extensions, link-open IPC) so it carries
 * zero extra imports.
 *
 * Lifecycle contract (do not deviate):
 *   - The Y.Text is `engine.text` (NOT engine.ytext). The real property is
 *     `engine.text = doc.getText('content')` (engine.js:101).
 *   - CRITICAL: createEditor must be seeded with `engine.text.toString()` —
 *     yCollab does NOT seed initial content, only future changes.
 *   - `await engine.whenSynced()` before binding so IndexedDB content is loaded
 *     (mirrors main.js mountP2PEngineInEditor:3149).
 *   - On teardown: view.destroy() + app.closeNote(teamId, noteId). NEVER
 *     engine.destroy() — the manager owns the engine/replica lifecycle and
 *     destroying it would break the background-replica re-form.
 *   - The view is screen-local: never assign window.cmView (that is desktop's,
 *     and there is no desktop view to collide with on mobile anyway).
 *
 * View atoms come from ./ui.js; the format bar from ./format-bar.js. Everything
 * is DOM-first (no framework), touch-first (no hover-only affordances),
 * safe-area aware, and uses big tap targets — mirroring the el()/DOM idiom of
 * team-dialogs.js and mobile-link-screen.js.
 */

import { yCollab } from 'y-codemirror.next'
import { EditorView } from '@codemirror/view'
import { createEditor } from '../../src/cm-editor'
import { el, Header, IconButton } from './ui.js'
import { createFormatBar } from './format-bar.js'

/**
 * Mount a CM6 view bound to a P2P engine's CRDT, mirroring main.js rebindEditor()
 * (lines 137-258) but stripped of all desktop-only wiring.
 *
 * @param {HTMLElement} container  the #editor-host element this screen built
 * @param {object} engine         from openNote(): has .text (Y.Text), .awareness,
 *                                 .undoManager
 * @returns {EditorView}
 */
function bindEditorToEngine(container, engine) {
  const yText = engine.text // engine.text === doc.getText('content') — NOT engine.ytext

  // Scrub old-format cursor data before creating yCollab (verbatim from main.js 145-151).
  engine.awareness.getStates().forEach((state, clientId) => {
    if (state.cursor && typeof state.cursor.index === 'number') {
      if (clientId === engine.awareness.clientID) {
        engine.awareness.setLocalStateField('cursor', null)
      }
    }
  })

  // Build extensions: yCollab + a minimal update listener. The desktop adds
  // slash/wiki/comment/selection-toolbar/plugin wiring here; mobile drops all of
  // it. The format bar reads the selection on demand, so no listener is needed.
  const extensions = [
    yCollab(yText, engine.awareness, { undoManager: engine.undoManager }),
    EditorView.updateListener.of(() => {
      // v1: intentionally minimal — no slash menu / wiki autocomplete / comments /
      // selection toolbar. The format bar pulls selection state when a button taps.
    }),
  ]

  // CRITICAL: seed doc with yText.toString() — yCollab does NOT seed initial content.
  const view = createEditor(container, {
    doc: yText.toString(),
    placeholder: 'Start writing…',
    extensions,
  })

  return view
}

/**
 * Open the per-note engine through whichever seam the app exposes. The app-shell
 * may surface `app.openEngine(teamId, noteId)` (a thin wrapper) OR expose the
 * manager directly as `app.teamManager.openNote(teamId, noteId)`. Prefer the
 * wrapper; fall back to the manager. Either way the call can throw with
 * `err.code === 'NO_ACCESS'` for a restricted note we cannot decrypt.
 *
 * @returns {Promise<object>} the DocumentEngine
 */
function openEngineViaSeam(app, teamId, noteId) {
  if (app && typeof app.openEngine === 'function') {
    return app.openEngine(teamId, noteId)
  }
  return app.teamManager.openNote(teamId, noteId)
}

/**
 * Tell the manager the note tab closed (re-forms the background ciphertext
 * replica — main.js:3142). Prefer the app wrapper, fall back to the manager.
 * Tolerant of 'Unknown team' throws since activeTeamId may lead a not-yet-loaded
 * team. Never calls engine.destroy().
 */
function closeNoteViaSeam(app, teamId, noteId) {
  try {
    if (app && typeof app.closeNote === 'function') {
      app.closeNote(teamId, noteId)
      return
    }
    if (app && app.teamManager && typeof app.teamManager.closeNote === 'function') {
      app.teamManager.closeNote(teamId, noteId)
    }
  } catch (e) {
    // closeNote is best-effort cleanup; an unknown-team throw must not crash the pop.
    console.warn('[Mobile] closeNote failed', e)
  }
}

/**
 * Create the full-screen note editor screen.
 *
 * Calling conventions (both accepted, to bridge a contract/brief mismatch):
 *   - createNoteScreen(app, { teamId, noteId, title })   // FILE BRIEF form
 *   - createNoteScreen({ app, teamId, noteId, title })   // BUILD CONTRACT form
 * Whichever app-shell uses, the screen resolves the same `app` + opts.
 *
 * @param {object} appOrOpts  the app API, OR a single opts object containing `app`
 * @param {object} [maybeOpts]
 * @param {string} [maybeOpts.teamId]
 * @param {string} [maybeOpts.noteId]
 * @param {string} [maybeOpts.title]
 * @returns {{ root: HTMLElement, onEnter: Function, onLeave: Function, onDestroy: Function, title: string }}
 */
export function createNoteScreen(appOrOpts, maybeOpts) {
  // Normalize the two accepted call shapes into (app, { teamId, noteId, title }).
  let app
  let opts
  if (appOrOpts && typeof appOrOpts === 'object' && appOrOpts.app) {
    // Single-object form: createNoteScreen({ app, teamId, noteId, title })
    app = appOrOpts.app
    opts = appOrOpts
  } else {
    // Two-arg form: createNoteScreen(app, { teamId, noteId, title })
    app = appOrOpts
    opts = maybeOpts || {}
  }
  const { teamId, noteId } = opts
  const title = opts.title || 'Untitled'

  // ── DOM scaffold ────────────────────────────────────────────────────────────
  const backBtn = IconButton({
    icon: 'back',
    label: 'Back',
    onTap: () => app.nav.pop(),
  })

  const header = Header({
    title,
    left: backBtn,
    onTitleTap: () => startRename(),
  })

  // The CM6 mount point. flex:1 so the editor fills the space between header and
  // the (keyboard-riding) format bar. overflow handled by the .cm-scroller.
  const editorHost = el('div', {
    class: 'mob-note-editorhost',
    style: {
      flex: '1 1 auto',
      minHeight: '0',
      position: 'relative',
      overflow: 'hidden',
    },
  })

  // A message slot for the restricted / error state (replaces the editor when
  // openNote throws NO_ACCESS or any other failure).
  const messageSlot = el('div', { class: 'mob-note-message' })

  const formatBar = createFormatBar()

  const root = el('div', { class: 'mob-screen mob-screen-note' }, [
    header.root,
    editorHost,
    messageSlot,
    formatBar.root,
  ])

  // ── Screen-local state ──────────────────────────────────────────────────────
  let view = null
  let engine = null
  let destroyed = false

  // ── Rename (inline, via the Header title affordance) ────────────────────────
  async function startRename() {
    // Locked notes / missing access cannot be renamed.
    const current = header.titleEl ? header.titleEl.textContent : title
    // eslint-disable-next-line no-alert
    const next = window.prompt('Rename note', current)
    if (next == null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === current) return
    try {
      const ok = await app.teamManager.renameNote(teamId, noteId, trimmed)
      if (ok) header.setTitle(trimmed)
    } catch (e) {
      console.warn('[Mobile] renameNote failed', e)
    }
  }

  // ── Restricted / error rendering ────────────────────────────────────────────
  function renderMessage(headline, body) {
    editorHost.style.display = 'none'
    formatBar.detach()
    messageSlot.innerHTML = ''
    messageSlot.appendChild(
      el('div', { class: 'mob-note-message-inner' }, [
        el('div', { class: 'mob-note-message-title' }, [headline]),
        body ? el('div', { class: 'mob-note-message-body' }, [body]) : null,
      ]),
    )
  }

  function renderRestricted() {
    renderMessage(
      'Restricted note',
      'You do not have the key to open this note. Ask a teammate with access to grant it.',
    )
  }

  function renderError(err) {
    renderMessage(
      'Could not open this note',
      (err && err.message) ? String(err.message) : 'An unexpected error occurred.',
    )
  }

  // ── Nav lifecycle ───────────────────────────────────────────────────────────
  async function onEnter() {
    if (destroyed) return
    // Hide the bottom bar while editing — the format bar takes the bottom.
    if (typeof app.hideBottomBar === 'function') app.hideBottomBar()

    // (1) Open the engine through the seam. Catch NO_ACCESS for restricted notes.
    try {
      engine = await openEngineViaSeam(app, teamId, noteId)
    } catch (e) {
      if (e && e.code === 'NO_ACCESS') {
        renderRestricted()
        return
      }
      renderError(e)
      return
    }
    if (destroyed) {
      // The screen was popped while openNote was awaiting — undo the open so the
      // replica re-forms and we don't leak a bound engine.
      closeNoteViaSeam(app, teamId, noteId)
      engine = null
      return
    }

    // (2) Wait for IndexedDB/CRDT sync so the doc is hydrated before binding
    //     (mirrors main.js mountP2PEngineInEditor:3149).
    try {
      await engine.whenSynced()
    } catch (e) {
      console.warn('[Mobile] engine.whenSynced failed', e)
    }
    if (destroyed) {
      closeNoteViaSeam(app, teamId, noteId)
      engine = null
      return
    }

    // (3) Mount CM6 bound to the engine via the binding recipe.
    try {
      view = bindEditorToEngine(editorHost, engine)
    } catch (e) {
      renderError(e)
      return
    }

    // (4) Attach the above-keyboard format bar to the live view.
    formatBar.attach(view)

    // Focus the editor so the keyboard + format bar come up on open.
    try { view.focus() } catch (_e) { /* focus may be blocked until a tap; ignore */ }
  }

  function onLeave() {
    // Re-show the bottom bar as we head back to Home/Search.
    if (typeof app.showBottomBar === 'function') app.showBottomBar()
    // Detach the format bar (stops visualViewport / focus tracking) but keep the
    // teardown of the view + engine for onDestroy so a temporary leave (if nav
    // ever supports it) doesn't drop the binding. For the v1 stack, pop fires
    // onLeave then onDestroy, so destroying in onDestroy is correct.
    formatBar.detach()
  }

  function onDestroy() {
    destroyed = true
    // Destroy the screen-local CM view to drop the yCollab binding + listeners.
    if (view) {
      try { view.destroy() } catch (e) { console.warn('[Mobile] view.destroy failed', e) }
      view = null
    }
    // Fully tear down the format bar's listeners.
    try { formatBar.destroy() } catch (e) { console.warn('[Mobile] formatBar.destroy failed', e) }
    // Tell the manager the tab closed so the background replica re-forms.
    // NEVER engine.destroy() — the manager owns the engine/replica lifecycle.
    if (engine) {
      closeNoteViaSeam(app, teamId, noteId)
      engine = null
    }
  }

  return {
    root,
    title,
    onEnter,
    onLeave,
    onDestroy,
  }
}

export default createNoteScreen
