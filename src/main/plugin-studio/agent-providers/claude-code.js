/**
 * Plugin Studio — Claude Code AgentProvider (id:'claude-code', kind:'cli').
 *
 * FROZEN CONTRACT (docs/PLUGIN_STUDIO_CONTRACT.md §4.2 "Claude Code"):
 *   spawn(bin, ['-p', goal, '--output-format', 'stream-json', '--permission-mode', 'acceptEdits',
 *               '--verbose'],
 *         { cwd: workspaceDir, env: claudeEnv() })
 *   Parse line-delimited `stream-json` from child.stdout; map message/tool/result
 *   frames → AgentEvent. `send()` is a follow-up turn (a fresh `-p` spawn in the
 *   same cwd). `cancel()` → child.kill().
 *
 * The binary is discovered via the lifted `resolveClaudeBin()` and env via
 * `claudeEnv()` from `../cli-discovery.js` (these accept the electron `app` so
 * they can resolve the home dir after being lifted out of index.js's closure).
 *
 * Defensive: createSession never throws; spawn errors and parse errors surface as
 * `onEvent({type:'error'})`. cancel() always kills the current child.
 *
 * `--output-format stream-json` REQUIRES `--verbose` in non-interactive (`-p`)
 * mode; we always pass it so the stream is emitted.
 */

import { spawn } from 'child_process'
import { resolveClaudeBin, claudeEnv } from '../cli-discovery.js'

const ID = 'claude-code'
const LABEL = 'Claude Code'
const KIND = 'cli'

// File-mutating Claude Code tools → derive a `file` AgentEvent so the transcript
// reflects writes immediately. The studio chokidar watcher is the authoritative
// source for hot-reload; these are best-effort UI signals.
const WRITE_TOOLS = new Set(['Write', 'NotebookEdit'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit'])

/**
 * Turn an absolute or relative path from a tool frame into a path relative to
 * `workspaceDir` (the AgentEvent `file.path` contract). Returns null if the path
 * escapes the workspace or is unusable.
 */
function relToWorkspace(workspaceDir, filePath) {
  if (!filePath || typeof filePath !== 'string') return null
  const wd = String(workspaceDir || '')
  let p = filePath
  if (wd && p.startsWith(wd)) {
    p = p.slice(wd.length)
  }
  // strip a leading separator
  p = p.replace(/^[\\/]+/, '')
  if (!p || p.includes('..')) return null
  return p.replace(/\\/g, '/')
}

/**
 * Map a single parsed stream-json frame to zero or more AgentEvents.
 * Claude Code's stream-json emits frames like:
 *   { type:'system', subtype:'init', ... }
 *   { type:'assistant', message:{ content:[ {type:'text',text}, {type:'tool_use',name,input} ] } }
 *   { type:'user', message:{ content:[ {type:'tool_result', ...} ] } }
 *   { type:'result', subtype:'success'|'error_*', result?:string, is_error?:bool, ... }
 * We are liberal in what we accept (the format has drifted across versions).
 */
function frameToEvents(frame, workspaceDir, emit) {
  if (!frame || typeof frame !== 'object') return

  const t = frame.type

  if (t === 'system') {
    if (frame.subtype && frame.subtype !== 'init') {
      emit({ type: 'status', text: `claude: ${frame.subtype}` })
    }
    return
  }

  if (t === 'assistant' || t === 'message') {
    const msg = frame.message || frame
    const content = Array.isArray(msg?.content) ? msg.content
      : (typeof msg?.content === 'string' ? [{ type: 'text', text: msg.content }] : [])
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'text' && block.text) {
        emit({ type: 'text', text: String(block.text) })
      } else if (block.type === 'tool_use') {
        const name = String(block.name || 'tool')
        const input = block.input || {}
        emit({ type: 'tool', name, input })
        // Derive a file event for file-mutating tools.
        const fp = input.file_path || input.path || input.notebook_path
        const rel = relToWorkspace(workspaceDir, fp)
        if (rel) {
          if (WRITE_TOOLS.has(name)) emit({ type: 'file', path: rel, action: 'write' })
          else if (EDIT_TOOLS.has(name)) emit({ type: 'file', path: rel, action: 'write' })
        }
      }
    }
    return
  }

  if (t === 'result') {
    if (frame.is_error || (frame.subtype && frame.subtype !== 'success')) {
      const text = String(frame.result || frame.error || frame.subtype || 'Claude Code reported an error')
      emit({ type: 'error', text })
      emit({ type: 'done', summary: text })
    } else {
      const summary = String(frame.result || 'Done')
      if (frame.result) emit({ type: 'text', text: summary })
      emit({ type: 'done', summary })
    }
    return
  }

  // 'user' frames carry tool_results; we don't surface raw results as prose, but a
  // tool error inside a result is worth showing.
  if (t === 'user') {
    const msg = frame.message || frame
    const content = Array.isArray(msg?.content) ? msg.content : []
    for (const block of content) {
      if (block && block.type === 'tool_result' && block.is_error) {
        const text = Array.isArray(block.content)
          ? block.content.map((c) => (c && c.text) || '').join('\n')
          : String(block.content || 'tool error')
        emit({ type: 'error', text: text || 'Tool reported an error' })
      }
    }
  }
}

/**
 * A streaming line buffer that parses NDJSON frames and feeds them to `frameToEvents`.
 * Robust to partial lines and to occasional non-JSON noise (logged as status).
 */
function makeStreamParser(workspaceDir, emit) {
  let buf = ''
  return {
    feed(chunk) {
      buf += chunk
      let nl
      // eslint-disable-next-line no-cond-assign
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let frame
        try {
          frame = JSON.parse(line)
        } catch (_) {
          // Not JSON — surface as raw status text so nothing is silently lost.
          emit({ type: 'status', text: line.length > 500 ? `${line.slice(0, 500)}…` : line })
          continue
        }
        try {
          frameToEvents(frame, workspaceDir, emit)
        } catch (e) {
          emit({ type: 'error', text: `stream parse error: ${e?.message || e}` })
        }
      }
    },
    flush() {
      const line = buf.trim()
      buf = ''
      if (!line) return
      try {
        frameToEvents(JSON.parse(line), workspaceDir, emit)
      } catch (_) {
        emit({ type: 'status', text: line.length > 500 ? `${line.slice(0, 500)}…` : line })
      }
    },
  }
}

export function createClaudeCodeProvider({ app } = {}) {
  return {
    id: ID,
    label: LABEL,
    kind: KIND,

    async detect() {
      let bin = null
      try {
        bin = resolveClaudeBin(app)
      } catch (_) {
        bin = null
      }
      if (!bin) {
        return { available: false, reason: 'Claude Code CLI not found. Install it from claude.com/code.' }
      }
      // Probe --version without throwing.
      return await new Promise((resolve) => {
        let child
        try {
          child = spawn(bin, ['--version'], { env: safeEnv(app) })
        } catch (e) {
          resolve({ available: false, reason: e?.message || 'spawn failed' })
          return
        }
        let out = ''
        let settled = false
        const finish = (res) => { if (!settled) { settled = true; resolve(res) } }
        const timer = setTimeout(() => {
          try { child.kill() } catch (_) {}
          finish({ available: true }) // binary exists; version probe just timed out
        }, 6000)
        child.stdout?.on('data', (d) => { out += String(d) })
        child.on('error', (e) => { clearTimeout(timer); finish({ available: false, reason: e?.message }) })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) finish({ available: true, version: out.trim() || undefined })
          else finish({ available: true, version: out.trim() || undefined }) // present even if nonzero
        })
      })
    },

    createSession(opts = {}) {
      const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {}
      const workspaceDir = String(opts.workspaceDir || '')
      const initialGoal = String(opts.goal || '')

      let child = null
      let cancelled = false

      const emit = (ev) => { try { onEvent(ev) } catch (_) {} }

      // Spawn one non-interactive `-p` turn for `prompt`. Each send() is a fresh
      // spawn in the same cwd (the workspace + CLAUDE.md/AGENTS.md ground it).
      const runTurn = (prompt) => {
        if (cancelled) return
        let bin = null
        try {
          bin = resolveClaudeBin(app)
        } catch (_) {
          bin = null
        }
        if (!bin) {
          emit({ type: 'error', text: 'Claude Code CLI not found. Install it from claude.com/code.' })
          emit({ type: 'done', summary: 'Claude Code not available' })
          return
        }
        if (!workspaceDir) {
          emit({ type: 'error', text: 'Claude Code: missing workspace directory.' })
          return
        }

        const args = [
          '-p', String(prompt || ''),
          '--output-format', 'stream-json',
          '--permission-mode', 'acceptEdits',
          '--verbose',
        ]
        if (opts.model) args.push('--model', String(opts.model))

        emit({ type: 'status', text: 'Running Claude Code…' })

        let env
        try { env = claudeEnv(app) } catch (_) { env = process.env }

        try {
          child = spawn(bin, args, { cwd: workspaceDir, env })
        } catch (e) {
          emit({ type: 'error', text: `Failed to start Claude Code: ${e?.message || e}` })
          emit({ type: 'done', summary: 'spawn failed' })
          child = null
          return
        }

        const parser = makeStreamParser(workspaceDir, emit)
        let stderrBuf = ''

        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (d) => { try { parser.feed(String(d)) } catch (_) {} })
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (d) => { stderrBuf += String(d) })

        child.on('error', (e) => {
          emit({ type: 'error', text: `Claude Code error: ${e?.message || e}` })
          emit({ type: 'done', summary: 'error' })
          child = null
        })

        child.on('close', (code) => {
          try { parser.flush() } catch (_) {}
          if (cancelled) { child = null; return }
          if (code !== 0) {
            const tail = stderrBuf.trim()
            emit({ type: 'error', text: tail || `Claude Code exited with code ${code}` })
            emit({ type: 'done', summary: `exited ${code}` })
          }
          child = null
        })
      }

      // Kick off the initial turn (defensively — never throw out of createSession).
      try {
        runTurn(initialGoal)
      } catch (e) {
        emit({ type: 'error', text: `Claude Code failed to start: ${e?.message || e}` })
      }

      return {
        send(message) {
          try {
            if (cancelled) return
            if (child) {
              // A turn is already running; queue is not supported headless — surface it.
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

// Local env helper for detect() that tolerates a missing claudeEnv import shape.
function safeEnv(app) {
  try { return claudeEnv(app) } catch (_) { return process.env }
}

export default createClaudeCodeProvider
