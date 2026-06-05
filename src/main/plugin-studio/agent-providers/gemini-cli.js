/**
 * Plugin Studio — Gemini CLI AgentProvider (id:'gemini-cli', kind:'cli').
 *
 * FROZEN CONTRACT (docs/PLUGIN_STUDIO_CONTRACT.md §4.2 "Gemini CLI"):
 *   - Discover the binary with `resolveGeminiBin()` (twin of `resolveClaudeBin`,
 *     lifted into ../cli-discovery.js).
 *   - Spawn the non-interactive prompt form in `cwd: workspaceDir` (it reads
 *     GEMINI.md + AGENTS.md automatically); stream stdout to the transcript.
 *
 * Gemini CLI's headless prompt form is `gemini -p "<prompt>"` (alias `--prompt`),
 * which prints model output to stdout and exits. We stream stdout chunks as
 * `text` AgentEvents. The studio chokidar watcher is the authoritative source of
 * `file` events (Gemini's plain-text output doesn't reliably announce writes).
 *
 * Defensive: createSession never throws; spawn errors surface as
 * `onEvent({type:'error'})`; cancel() kills the child.
 */

import { spawn } from 'child_process'
import { resolveGeminiBin, claudeEnv } from '../cli-discovery.js'

const ID = 'gemini-cli'
const LABEL = 'Gemini CLI'
const KIND = 'cli'

// claudeEnv now carries the user's full login-shell PATH (cli-discovery.js), which
// is exactly what gemini needs: it's a `#!/usr/bin/env node` script, so the spawn
// env must include the dir holding `node`. Falls back to process.env.
function geminiEnv(app) {
  try { return claudeEnv(app) } catch (_) { return process.env }
}

export function createGeminiCliProvider({ app } = {}) {
  return {
    id: ID,
    label: LABEL,
    kind: KIND,

    async detect() {
      let bin = null
      try {
        bin = resolveGeminiBin(app)
      } catch (_) {
        bin = null
      }
      if (!bin) {
        return { available: false, reason: 'Gemini CLI not found. Install it (npm i -g @google/gemini-cli).' }
      }
      return await new Promise((resolve) => {
        let child
        try {
          child = spawn(bin, ['--version'], { env: geminiEnv(app) })
        } catch (e) {
          resolve({ available: false, reason: e?.message || 'spawn failed' })
          return
        }
        let out = ''
        let settled = false
        const finish = (res) => { if (!settled) { settled = true; resolve(res) } }
        const timer = setTimeout(() => {
          try { child.kill() } catch (_) {}
          finish({ available: true })
        }, 6000)
        child.stdout?.on('data', (d) => { out += String(d) })
        child.on('error', (e) => { clearTimeout(timer); finish({ available: false, reason: e?.message }) })
        child.on('close', () => { clearTimeout(timer); finish({ available: true, version: out.trim() || undefined }) })
      })
    },

    createSession(opts = {}) {
      const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {}
      const workspaceDir = String(opts.workspaceDir || '')
      const initialGoal = String(opts.goal || '')

      let child = null
      let cancelled = false
      const emit = (ev) => { try { onEvent(ev) } catch (_) {} }

      const runTurn = (prompt) => {
        if (cancelled) return
        let bin = null
        try {
          bin = resolveGeminiBin(app)
        } catch (_) {
          bin = null
        }
        if (!bin) {
          emit({ type: 'error', text: 'Gemini CLI not found. Install it (npm i -g @google/gemini-cli).' })
          emit({ type: 'done', summary: 'Gemini CLI not available' })
          return
        }
        if (!workspaceDir) {
          emit({ type: 'error', text: 'Gemini CLI: missing workspace directory.' })
          return
        }

        const args = ['-p', String(prompt || '')]
        if (opts.model) args.push('-m', String(opts.model))
        // YOLO/auto-approve so it can write files non-interactively in the workspace.
        args.push('--yolo')

        emit({ type: 'status', text: 'Running Gemini CLI…' })

        let env
        try { env = geminiEnv(app) } catch (_) { env = process.env }

        try {
          child = spawn(bin, args, { cwd: workspaceDir, env })
        } catch (e) {
          emit({ type: 'error', text: `Failed to start Gemini CLI: ${e?.message || e}` })
          emit({ type: 'done', summary: 'spawn failed' })
          child = null
          return
        }

        let stderrBuf = ''
        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (d) => {
          const text = String(d)
          if (text) emit({ type: 'text', text })
        })
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (d) => { stderrBuf += String(d) })

        child.on('error', (e) => {
          emit({ type: 'error', text: `Gemini CLI error: ${e?.message || e}` })
          emit({ type: 'done', summary: 'error' })
          child = null
        })

        child.on('close', (code) => {
          if (cancelled) { child = null; return }
          if (code === 0) {
            emit({ type: 'done', summary: 'Done' })
          } else {
            const tail = stderrBuf.trim()
            emit({ type: 'error', text: tail || `Gemini CLI exited with code ${code}` })
            emit({ type: 'done', summary: `exited ${code}` })
          }
          child = null
        })
      }

      try {
        runTurn(initialGoal)
      } catch (e) {
        emit({ type: 'error', text: `Gemini CLI failed to start: ${e?.message || e}` })
      }

      return {
        send(message) {
          try {
            if (cancelled) return
            if (child) {
              emit({ type: 'status', text: 'Waiting for the current turn to finish…' })
              const prev = child
              prev.once('close', () => { if (!cancelled) runTurn(String(message || '')) })
              return
            }
            runTurn(String(message || ''))
          } catch (e) {
            emit({ type: 'error', text: `send failed: ${e?.message || e}` })
          }
        },
        cancel() {
          cancelled = true
          try { if (child) child.kill() } catch (_) {}
          child = null
        },
      }
    },
  }
}

export default createGeminiCliProvider
