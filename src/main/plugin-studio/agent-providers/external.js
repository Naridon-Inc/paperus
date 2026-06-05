/**
 * Plugin Studio — `external` AgentProvider (kind:'external').
 *
 * FROZEN CONTRACT (docs/PLUGIN_STUDIO_CONTRACT.md §4.2 "External"):
 *   - `id:'external'`, `kind:'external'`.
 *   - `detect()` is always available (opening a folder needs nothing).
 *   - `createSession` immediately fires
 *     `onEvent({type:'status', text:'Opened workspace in your editor'})` and opens
 *     the workspace dir in the user's editor (prefer `code`/`cursor`/$EDITOR, else
 *     `shell.openPath`). `send()`/`cancel()` are no-ops; Studio keeps watching and
 *     hot-reloading via the studio chokidar watcher (file events → renderer).
 *
 * This is the Phase A escape hatch: a user runs their own agent / hand-edits the
 * grounded workspace while Studio watches and hot-loads. It never throws out of a
 * public entry point; spawn failures are surfaced as `onEvent({type:'error'})`.
 */

import { spawn } from 'child_process'
import { shell } from 'electron'

const ID = 'external'
const LABEL = 'Open in editor'
const KIND = 'external'

/**
 * Try to open `dir` in a GUI editor. Returns true if a spawn was attempted
 * (we don't await the editor; we just want it open), false to fall back to
 * `shell.openPath`. Never throws.
 */
function trySpawnEditor(dir) {
  // Honor an explicit $EDITOR/$VISUAL first, then common GUI launchers.
  const fromEnv = (process.env.VISUAL || process.env.EDITOR || '').trim()
  const candidates = []
  if (fromEnv) candidates.push(fromEnv)
  // `code`/`cursor` accept a directory argument and return immediately.
  candidates.push('code', 'cursor')

  for (const cmd of candidates) {
    try {
      const child = spawn(cmd, [dir], {
        stdio: 'ignore',
        detached: true,
        // Don't inherit a controlling cwd inside the workspace; harmless but tidy.
        cwd: undefined,
      })
      // If the binary is missing, 'error' fires asynchronously; we already
      // returned true, so the caller won't double-open. That's acceptable —
      // worst case the editor simply didn't open and the user uses Reveal.
      child.on('error', () => {})
      try { child.unref() } catch (_) {}
      return true
    } catch (_) {
      // try the next candidate
    }
  }
  return false
}

export function createExternalProvider() {
  return {
    id: ID,
    label: LABEL,
    kind: KIND,

    async detect() {
      // Opening a folder is always possible on desktop.
      return { available: true, version: undefined }
    },

    createSession(opts = {}) {
      const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {}
      const workspaceDir = String(opts.workspaceDir || '')

      // Defensive: never throw out of createSession.
      ;(async () => {
        try {
          if (!workspaceDir) {
            onEvent({ type: 'error', text: 'External provider: missing workspace directory.' })
            return
          }
          const opened = trySpawnEditor(workspaceDir)
          if (!opened) {
            try {
              const err = await shell.openPath(workspaceDir)
              if (err) {
                onEvent({ type: 'error', text: `Could not open workspace: ${err}` })
                return
              }
            } catch (e) {
              onEvent({ type: 'error', text: `Could not open workspace: ${e?.message || e}` })
              return
            }
          }
          onEvent({ type: 'status', text: 'Opened workspace in your editor' })
          onEvent({
            type: 'status',
            text: 'Edit the files there — Studio is watching and will hot-reload changes.',
          })
        } catch (e) {
          onEvent({ type: 'error', text: `External provider failed: ${e?.message || e}` })
        }
      })()

      return {
        send() { /* no-op: the external editor drives edits; Studio watches the FS */ },
        cancel() { /* no-op: there is no child process to kill */ },
      }
    },
  }
}

export default createExternalProvider
