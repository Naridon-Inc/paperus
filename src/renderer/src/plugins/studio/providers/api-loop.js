// providers/api-loop.js — the RENDERER-side, zero-CLI "built-in API" AgentProvider
// (Frozen Plugin Studio Contract v1, §4, §4.3; Phase C).
//
// This is the harness that requires NO external CLI: a minimal agent tool-loop
// driven by the host's existing AI backend (`ragEngine._generateApi` streaming SSE
// or `ragEngine._generateClaudeCode` via the `ai:claude-code` IPC). It exposes a
// fixed toolset — read_file / write_file / list_dir / build_check — implemented
// ENTIRELY over the `studio:*` IPC channels (through `studioClient`), so every
// filesystem effect is confined to the studio workspace and NEVER touches the
// vault. It emits the SAME `AgentEvent` union (§4.1) as the CLI providers.
//
// THE API KEY NEVER LEAVES MAIN: this provider only sends a prompt to `ragEngine`
// (which holds/forwards the key). It never reads, logs, or transmits a key, and
// it never hands a key to the plugin or the preview iframe.
//
// `_generateLocal` does NOT exist on RAGEngine (contract §4.3), so the 'local'
// (Ollama) backend reports unavailable here.
//
// PURE renderer module: no node/electron imports (web-safe). On web, `studioClient`
// resolves `{ ok:false, error:'unsupported' }` for every tool, so the loop is inert.

/* ------------------------------------------------------------------------- *
 * The fixed toolset, described to the model. The model is instructed to emit a
 * single fenced ```tool block containing one JSON object per turn; we parse it,
 * execute against studioClient, and feed the result back as the next user turn.
 * This is a deliberately small, text-protocol tool loop (the rag-engine backends
 * are plain completion, not native function-calling).
 * ------------------------------------------------------------------------- */

const MAX_TURNS = 24 // hard cap so a runaway model can never loop forever

const TOOL_PROTOCOL = `
You are building a Notionless plugin in the workspace folder "plugin/". You have a
small set of tools. To use a tool, reply with EXACTLY ONE fenced code block tagged
\`tool\` containing a single JSON object, and nothing else:

\`\`\`tool
{ "tool": "write_file", "path": "plugin/index.js", "content": "..." }
\`\`\`

Tools:
  • { "tool": "list_dir",   "path": "plugin" }                       → lists files
  • { "tool": "read_file",  "path": "plugin/index.js" }              → returns text
  • { "tool": "write_file", "path": "plugin/index.js", "content": "…" } → writes text
  • { "tool": "build_check" }                                        → node --check + manifest validation

Rules:
  • Paths are RELATIVE to the workspace; write the plugin under "plugin/".
  • Always finish with a working "plugin/plugin.json" and "plugin/index.js".
  • After writing files, call build_check; if it reports errors, FIX them and
    build_check again.
  • When the plugin builds clean and matches the goal, reply with a fenced
    \`done\` block summarizing what you built (no tool block):

\`\`\`done
Built a status-bar word-count plugin. Builds clean.
\`\`\`

Reply with prose to think out loud, but END every turn with either one \`tool\`
block or one \`done\` block.
`.trim()

/* ---- parsing helpers ----------------------------------------------------- */

// Extract the LAST fenced block of a given tag (tool|done) from model output.
function extractTaggedBlock(text, tag) {
  if (typeof text !== 'string') return null
  const re = new RegExp('```' + tag + '\\s*\\n([\\s\\S]*?)```', 'g')
  let m
  let last = null
  while ((m = re.exec(text)) !== null) last = m[1]
  return last == null ? null : last.trim()
}

function parseToolCall(text) {
  const body = extractTaggedBlock(text, 'tool')
  if (body == null) return null
  try {
    const obj = JSON.parse(body)
    if (obj && typeof obj.tool === 'string') return obj
  } catch (_) { /* malformed JSON → treat as no tool call */ }
  return null
}

/* ------------------------------------------------------------------------- *
 * Provider factory.
 * @param {object} deps
 * @param {object} deps.ragEngine     the RAGEngine (drives generation; holds the key)
 * @param {object} deps.studioClient  the renderer studio IPC client (fs/build tools)
 * @returns {AgentProvider}
 * ------------------------------------------------------------------------- */

export function createApiLoopProvider({ ragEngine, studioClient } = {}) {
  const engine = ragEngine || null
  const client = studioClient || null

  /* ---- one generation turn against the rag-engine backend --------------- */
  // Returns { ok, text, error }. Accumulates streamed tokens (so the transcript
  // can show prose live via onToken), then resolves the full text.
  async function generateOnce(systemPrompt, userPrompt, onToken) {
    if (!engine) return { ok: false, error: 'No AI backend (rag-engine) available.' }
    const mode = engine.aiMode || 'local'
    let acc = ''
    const onTok = (t) => { acc += t; if (onToken) onToken(t) }
    const noop = () => {}
    try {
      if (mode === 'api' && typeof engine._generateApi === 'function') {
        await engine._generateApi(systemPrompt, userPrompt, onTok, noop, [])
        return { ok: true, text: acc }
      }
      if (mode === 'claude-code' && typeof engine._generateClaudeCode === 'function') {
        await engine._generateClaudeCode(systemPrompt, userPrompt, onTok, noop, [])
        return { ok: true, text: acc }
      }
      // No _generateLocal on RAGEngine (contract §4.3): local backend unsupported.
      return {
        ok: false,
        error: mode === 'local'
          ? 'Local (Ollama) generation is not supported by the built-in API loop. Switch the AI backend to an API provider or Claude Code in Brain settings.'
          : `Unsupported AI backend mode "${mode}".`,
      }
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) }
    }
  }

  /* ---- execute a tool call over studioClient ---------------------------- */
  // Returns a short string result fed back to the model; emits AgentEvents.
  async function runTool(buildId, call, emit) {
    const name = call && call.tool
    if (!client) return 'ERROR: studio filesystem is unavailable (desktop app only).'
    try {
      if (name === 'list_dir') {
        const dir = call.path || 'plugin'
        emit({ type: 'tool', name: 'list_dir', input: { path: dir } })
        const res = await client.fsList(buildId, dir)
        if (!res || !res.ok) return `ERROR: list_dir failed: ${(res && res.error) || 'unknown'}`
        const entries = Array.isArray(res.entries) ? res.entries : []
        return 'DIR ' + dir + ':\n' + entries.map((e) => `${e.dir ? 'd' : '-'} ${e.path}`).join('\n')
      }
      if (name === 'read_file') {
        const path = call.path || ''
        emit({ type: 'tool', name: 'read_file', input: { path } })
        const res = await client.fsRead(buildId, path)
        if (!res || !res.ok) return `ERROR: read_file failed: ${(res && res.error) || 'unknown'}`
        return `FILE ${path}:\n${res.data == null ? '' : res.data}`
      }
      if (name === 'write_file') {
        const path = call.path || ''
        const content = typeof call.content === 'string' ? call.content : ''
        emit({ type: 'tool', name: 'write_file', input: { path, bytes: content.length } })
        const res = await client.fsWrite(buildId, path, content)
        if (!res || !res.ok) return `ERROR: write_file failed: ${(res && res.error) || 'unknown'}`
        // A successful write drives the hot-reload + code-editor pipeline.
        emit({ type: 'file', path, action: 'write' })
        return `OK wrote ${path} (${content.length} bytes).`
      }
      if (name === 'build_check') {
        emit({ type: 'tool', name: 'build_check', input: {} })
        emit({ type: 'status', text: 'Running build check…' })
        const res = await client.buildCheck(buildId)
        if (!res || res.ok === false) {
          return `ERROR: build_check could not run: ${(res && res.error) || 'unknown'}`
        }
        const errs = Array.isArray(res.errors) ? res.errors : []
        if (errs.length === 0) return 'BUILD OK: no errors.'
        return 'BUILD ERRORS:\n' + errs.map((e) => `  • ${e}`).join('\n')
      }
      return `ERROR: unknown tool "${name}".`
    } catch (e) {
      return `ERROR: tool "${name}" threw: ${(e && e.message) || String(e)}`
    }
  }

  return {
    id: 'api-anthropic',
    label: 'Built-in API loop (no CLI)',
    kind: 'api',

    async detect() {
      if (!engine) return { available: false, reason: 'AI backend not initialized.' }
      const mode = engine.aiMode || 'local'
      if (mode === 'api' || mode === 'claude-code') {
        return { available: true, version: mode }
      }
      // 'local' (Ollama) has no generator here (contract §4.3).
      return { available: false, reason: 'local generation unsupported — set an API provider or Claude Code in Brain settings.' }
    },

    createSession(opts) {
      const o = opts || {}
      const buildId = o.buildId != null ? o.buildId : o._buildId
      const workspaceDir = o.workspaceDir || ''
      const systemContext = o.systemContext || ''
      const onEvent = typeof o.onEvent === 'function' ? o.onEvent : () => {}
      let cancelled = false
      let running = false

      const emit = (ev) => { try { onEvent(ev) } catch (_) { /* never let a listener break the loop */ } }

      // The system prompt = the grounding context (author guide + CAPABILITIES.md
      // text, passed in by the manager) PLUS the tool protocol.
      const systemPrompt = `${systemContext}\n\n${TOOL_PROTOCOL}`

      // The running conversation, flattened into a single rolling user prompt
      // (the rag-engine backends are stateless single-shot completion).
      async function loop(initialGoal) {
        if (running) return
        running = true
        let turnInput = `GOAL: ${initialGoal}\n\nBegin. Inspect the workspace, then build the plugin under plugin/.`
        try {
          for (let turn = 0; turn < MAX_TURNS; turn += 1) {
            if (cancelled) { emit({ type: 'status', text: 'Cancelled.' }); break }
            emit({ type: 'status', text: `Thinking… (turn ${turn + 1})` })

            let streamed = ''
            const onToken = (t) => { streamed += t }
            const gen = await generateOnce(systemPrompt, turnInput, onToken)
            if (cancelled) { emit({ type: 'status', text: 'Cancelled.' }); break }
            if (!gen.ok) {
              emit({ type: 'error', text: gen.error || 'Generation failed.' })
              break
            }
            const text = gen.text || streamed || ''
            if (text.trim()) emit({ type: 'text', text })

            // Done?
            const done = extractTaggedBlock(text, 'done')
            const call = parseToolCall(text)
            if (done != null && !call) {
              emit({ type: 'done', summary: done })
              break
            }
            if (!call) {
              // No tool, no done — nudge once, then bail to avoid burning turns.
              turnInput = 'You did not emit a `tool` or `done` block. '
                + 'Emit ONE `tool` block to act, or a `done` block to finish.'
              continue
            }

            const result = await runTool(buildId, call, emit)
            if (cancelled) { emit({ type: 'status', text: 'Cancelled.' }); break }
            // Feed the tool result back as the next turn.
            turnInput = `TOOL RESULT (${call.tool}):\n${result}\n\nContinue. Emit the next \`tool\` block, or \`done\` when the plugin builds clean and matches the goal.`

            if (turn === MAX_TURNS - 1) {
              emit({ type: 'error', text: `Reached the ${MAX_TURNS}-turn cap. Use "Fix errors" or chat to continue.` })
            }
          }
        } catch (e) {
          emit({ type: 'error', text: (e && e.message) || String(e) })
        } finally {
          running = false
        }
      }

      // Kick the loop with the initial goal.
      void loop(o.goal || '')

      return {
        send(message) {
          // A follow-up user turn: if idle, restart the loop folding the message
          // in as a new goal/refinement; if mid-loop, the message is appended on
          // the next idle (the loop is single-flight by design).
          if (cancelled) return
          if (!running) {
            void loop(String(message || ''))
          } else {
            emit({ type: 'status', text: 'Busy — your message will be picked up after the current step.' })
          }
        },
        cancel() {
          cancelled = true
          emit({ type: 'status', text: 'Cancelling…' })
        },
      }
    },
  }
}

export default createApiLoopProvider
