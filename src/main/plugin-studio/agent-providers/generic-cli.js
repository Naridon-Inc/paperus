/**
 * Plugin Studio — Generic CLI AgentProvider (id:'generic-cli', kind:'cli').
 *
 * FROZEN CONTRACT (docs/PLUGIN_STUDIO_CONTRACT.md §4.2 "Generic CLI", Phase E):
 *   A user-provided COMMAND TEMPLATE with `{goal}` and `{workspace}` placeholders,
 *   e.g. `codex exec "{goal}"` run with `cwd: {workspace}`. Substituted **as argv
 *   tokens** (NO shell string interpolation — split the template, replace tokens,
 *   `spawn(argv[0], argv.slice(1))`). This is the literal "or anything you have
 *   installed" slot. `detect()` = template configured.
 *
 * Template source (in priority order):
 *   1. `opts.commandTemplate` forwarded via studio:agent-start, if present.
 *   2. electron-settings key `plugin_studio_generic_cli_template`.
 * `{goal}` and `{workspace}` are replaced as whole-token substitutions inside the
 * already-tokenized argv, so a goal containing spaces or quotes can NEVER inject
 * extra argv items or reach a shell — `spawn` is called with `shell:false`.
 *
 * Defensive: createSession never throws; missing template / spawn errors surface
 * as `onEvent({type:'error'})`; cancel() kills the child.
 */

import { spawn } from 'child_process'
import settings from 'electron-settings'

const ID = 'generic-cli'
const LABEL = 'Custom CLI'
const KIND = 'cli'

const SETTINGS_KEY = 'plugin_studio_generic_cli_template'

/**
 * Tokenize a command template into argv, honoring single/double quotes and
 * backslash escapes. Quotes group tokens; placeholders are NOT expanded here —
 * they are expanded per-token afterwards so a value can never spawn new tokens.
 */
function tokenize(template) {
  const tokens = []
  let cur = ''
  let inSingle = false
  let inDouble = false
  let hasContent = false
  const str = String(template || '')
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i]
    if (inSingle) {
      if (ch === "'") inSingle = false
      else { cur += ch }
      continue
    }
    if (inDouble) {
      if (ch === '"') inDouble = false
      else if (ch === '\\' && i + 1 < str.length) { i += 1; cur += str[i] }
      else cur += ch
      continue
    }
    if (ch === "'") { inSingle = true; hasContent = true; continue }
    if (ch === '"') { inDouble = true; hasContent = true; continue }
    if (ch === '\\' && i + 1 < str.length) { i += 1; cur += str[i]; hasContent = true; continue }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (hasContent) { tokens.push(cur); cur = ''; hasContent = false }
      continue
    }
    cur += ch
    hasContent = true
  }
  if (hasContent) tokens.push(cur)
  return tokens
}

/**
 * Expand `{goal}` and `{workspace}` inside a single argv token. The replacement
 * value is inserted verbatim into that one token — it can contain spaces, quotes,
 * or anything else and will remain a single argv item (no re-tokenization, no
 * shell). Unknown `{...}` placeholders are left untouched.
 */
function expandToken(token, { goal, workspace }) {
  return String(token)
    .split('{goal}').join(goal)
    .split('{workspace}').join(workspace)
}

function resolveTemplate(opts) {
  const fromOpts = opts && typeof opts.commandTemplate === 'string' ? opts.commandTemplate.trim() : ''
  if (fromOpts) return fromOpts
  try {
    const stored = settings.getSync(SETTINGS_KEY)
    if (typeof stored === 'string' && stored.trim()) return stored.trim()
  } catch (_) {}
  return ''
}

export function createGenericCliProvider() {
  return {
    id: ID,
    label: LABEL,
    kind: KIND,

    async detect() {
      const tpl = resolveTemplate({})
      if (!tpl) {
        return { available: false, reason: 'No custom CLI template configured. Set one in Studio settings.' }
      }
      const tokens = tokenize(tpl)
      if (!tokens.length) {
        return { available: false, reason: 'Custom CLI template is empty after parsing.' }
      }
      return { available: true, version: tokens[0] }
    },

    createSession(opts = {}) {
      const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {}
      const workspaceDir = String(opts.workspaceDir || '')
      const initialGoal = String(opts.goal || '')

      let child = null
      let cancelled = false
      const emit = (ev) => { try { onEvent(ev) } catch (_) {} }

      const runTurn = (goal) => {
        if (cancelled) return
        const template = resolveTemplate(opts)
        if (!template) {
          emit({ type: 'error', text: 'No custom CLI template configured. Set one in Studio settings.' })
          emit({ type: 'done', summary: 'no template' })
          return
        }
        if (!workspaceDir) {
          emit({ type: 'error', text: 'Custom CLI: missing workspace directory.' })
          return
        }

        const rawTokens = tokenize(template)
        if (!rawTokens.length) {
          emit({ type: 'error', text: 'Custom CLI template is empty after parsing.' })
          emit({ type: 'done', summary: 'empty template' })
          return
        }
        const argv = rawTokens.map((t) => expandToken(t, { goal: String(goal || ''), workspace: workspaceDir }))
        const cmd = argv[0]
        const args = argv.slice(1)

        emit({ type: 'status', text: `Running: ${cmd} …` })

        try {
          // shell:false (default) — argv is passed literally; no injection surface.
          child = spawn(cmd, args, { cwd: workspaceDir, env: process.env })
        } catch (e) {
          emit({ type: 'error', text: `Failed to start "${cmd}": ${e?.message || e}` })
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
        child.stderr?.on('data', (d) => {
          const text = String(d)
          stderrBuf += text
          // Many CLIs log progress to stderr; surface it as status, not error.
          if (text) emit({ type: 'status', text: text.length > 500 ? `${text.slice(0, 500)}…` : text })
        })

        child.on('error', (e) => {
          emit({ type: 'error', text: `Custom CLI error: ${e?.message || e}` })
          emit({ type: 'done', summary: 'error' })
          child = null
        })

        child.on('close', (code) => {
          if (cancelled) { child = null; return }
          if (code === 0) {
            emit({ type: 'done', summary: 'Done' })
          } else {
            const tail = stderrBuf.trim()
            emit({ type: 'error', text: tail || `Custom CLI exited with code ${code}` })
            emit({ type: 'done', summary: `exited ${code}` })
          }
          child = null
        })
      }

      try {
        runTurn(initialGoal)
      } catch (e) {
        emit({ type: 'error', text: `Custom CLI failed to start: ${e?.message || e}` })
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

export default createGenericCliProvider
