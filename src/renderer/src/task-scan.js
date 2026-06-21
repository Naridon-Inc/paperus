/**
 * task-scan.js — the task + @mention scan engine (singleton).
 *
 * Mirrors the contacts.js / identity.js singleton style: one exported object
 * (`taskScan`) holding the latest computed scan and the methods to refresh it
 * and to toggle a checkbox back to disk / into a Y.Text.
 *
 * It walks every known local project root (the `knownProjects` setting) plus any
 * open team docs supplied by the orchestrator, reads each Markdown note, and
 * parses out:
 *   - Tasks    — Markdown checkbox lines (`- [ ] …` / `- [x] …`), enriched with a
 *                due date + reminder (`@date(YYYY-MM-DD|remind)`) and @assignees.
 *   - Mentions — EVERY `@handle` occurrence on ANY line (task or prose), so the
 *                Inbox surface can later filter to the current user's handles.
 *
 * Identity vs projection: a task's stable `id` is derived from the *normalized
 * text* (state-stripped, whitespace-collapsed, lowercased) — never the line
 * number — so toggling the box or inserting lines above it does NOT change the id.
 * Toggling re-reads the source fresh and re-finds the line by that normalized
 * text (nearest the remembered line number as a tie-break) rather than trusting
 * the stored line, because lines drift under collaboration.
 *
 * It is transport-agnostic: local sources are plain absolute file paths (read /
 * written through `window.api`); team sources carry a live `ytext` (Y.Text) and
 * are mutated minimally inside a `doc.transact(…, 'task-toggle')` so the CRDT
 * sync path stays intact.
 *
 * Events:
 *   - emits  `scan:updated`     (detail = the new scan) after every recompute.
 *   - listens `fs:file-changed` → invalidate the file-list cache + rescan.
 */
import { DATE_TOKEN_RE } from './cm-mention'

// ── small utils ────────────────────────────────────────────────────────────────

/** djb2 string hash → unsigned 32-bit, base-36 (compact, stable, deterministic). */
function djb2(str) {
  let h = 5381
  const s = String(str)
  for (let i = 0; i < s.length; i += 1) {
    // h * 33 + c, kept in 32-bit space via >>> 0 below.
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/** Checkbox line matcher: indent, state char, the rest. */
const CHECKBOX_RE = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/
/** @handle matcher (preceded by start-of-string or whitespace). Global. */
const HANDLE_RE = /(?:^|\s)@([a-z0-9][a-z0-9._-]*)/gi

/**
 * Normalize a checkbox line's "rest" for a stable id / for re-finding the line.
 * Strips the checkbox-state difference (there is none in `rest`, but we also
 * strip a leading box if one is present), collapses whitespace, lowercases.
 */
function normalizeRest(rawRest) {
  return String(rawRest || '')
    .replace(/^\[[ xX]\]\s*/, '') // defensive: drop a leading box if present
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** A fresh, non-shared clone of the global DATE_TOKEN_RE (its own lastIndex). */
function dateRe() {
  return new RegExp(DATE_TOKEN_RE.source, 'gi')
}

/** Strip every `@date(…)` token from a string. */
function stripDateTokens(s) {
  return String(s || '').replace(dateRe(), '')
}

/** First `@date(…)` in a string → { dueISO, remind } | { dueISO:null, remind:null }. */
function firstDate(s) {
  const re = dateRe()
  const m = re.exec(String(s || ''))
  if (!m) return { dueISO: null, remind: null }
  return { dueISO: m[1], remind: (m[2] || null) }
}

/** Collect @handles from a string (lowercased, de-duped, order preserved). */
function collectHandles(s) {
  const out = []
  const seen = new Set()
  const re = new RegExp(HANDLE_RE.source, 'gi')
  let m
  while ((m = re.exec(String(s || ''))) !== null) {
    const h = m[1].toLowerCase()
    if (!seen.has(h)) { seen.add(h); out.push(h) }
  }
  return out
}

function basenameNoExt(p) {
  const base = String(p).split(/[\\/]/).pop() || String(p)
  return base.replace(/\.(md|note|markdown|txt)$/i, '')
}

function emit(name, detail) {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(name, { detail }))
    }
  } catch (_e) { /* noop */ }
}

// ── line parsing ────────────────────────────────────────────────────────────────

/**
 * Parse one document's text into tasks + mentions.
 * @param {string} text
 * @param {{ source:string, noteTitle:string, ytext?:any }} ctx
 */
function parseDoc(text, ctx) {
  const tasks = []
  const mentions = []
  if (!text) return { tasks, mentions }
  const lines = String(text).split('\n')

  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line]

    // --- task? ---
    const cm = CHECKBOX_RE.exec(raw)
    if (cm) {
      const indent = cm[1].length
      const done = cm[2].toLowerCase() === 'x'
      const rawRest = cm[3]
      const { dueISO, remind } = firstDate(rawRest)
      // Assignees come from the rest AFTER date tokens are stripped (a date token
      // never contains an @handle, but stripping keeps the two concerns separate).
      const withoutDates = stripDateTokens(rawRest)
      const assignees = collectHandles(withoutDates)
      const text2 = withoutDates.replace(/\s+/g, ' ').trim()
      const id = `${ctx.source}::${djb2(normalizeRest(rawRest))}`
      tasks.push({
        id,
        source: ctx.source,
        noteTitle: ctx.noteTitle,
        text: text2,
        rawText: rawRest,
        done,
        dueISO: dueISO || null,
        remind: remind || null,
        assignees,
        line,
        indent,
        // The live Y.Text (team docs only) is carried straight on the task so
        // toggleTask + the surfaces can detect/mutate it. CustomEvent details are
        // NOT structured-cloned (unlike postMessage), so a non-cloneable Y.Text
        // rides along fine through `scan:updated`.
        ytext: ctx.ytext || null,
      })
    }

    // --- mentions (on EVERY line, task or prose) ---
    // Strip @date(…) tokens first so the date keyword isn't mistaken for an
    // @date mention (the token literally starts with "@date").
    const handles = collectHandles(stripDateTokens(raw))
    if (handles.length) {
      const { dueISO } = firstDate(raw)
      for (const handle of handles) {
        mentions.push({
          handle,
          source: ctx.source,
          noteTitle: ctx.noteTitle,
          line,
          text: raw.trim(),
          dueISO: dueISO || null,
        })
      }
    }
  }

  return { tasks, mentions }
}

// ── the singleton ───────────────────────────────────────────────────────────────

class TaskScan {
  constructor() {
    /** @type {{tasks:any[], mentions:any[], partialTeams:string[], scannedAt:number}} */
    this._scan = { tasks: [], mentions: [], partialTeams: [], scannedAt: 0 }

    this._getRoots = null
    this._getOpenTeamDocs = null

    // debounce + in-flight coalescing
    this._debounceMs = 250
    this._timer = null
    this._pendingForce = false
    this._running = null // Promise while a scan is in flight
    this._debounce = null // shared deferred handed to coalesced debounced callers

    // file-list cache for the debounce window
    this._fileCache = null // { at:number, roots:string[], files:string[] }
    this._fileCacheMs = 1500

    this._wired = false
  }

  /**
   * Inject providers (optional). Safe to call repeatedly.
   * @param {{ getRoots?:()=>Promise<string[]>, getOpenTeamDocs?:()=>Promise<any[]> }} [opts]
   */
  init({ getRoots, getOpenTeamDocs } = {}) {
    if (typeof getRoots === 'function') this._getRoots = getRoots
    if (typeof getOpenTeamDocs === 'function') this._getOpenTeamDocs = getOpenTeamDocs
    this._wireOnce()
    return this
  }

  _wireOnce() {
    if (this._wired) return
    this._wired = true
    try {
      if (typeof window !== 'undefined') {
        window.addEventListener('fs:file-changed', () => {
          this._fileCache = null // invalidate
          this.requestScan()
        })
      }
    } catch (_e) { /* noop */ }
  }

  /** The most recently computed scan (starts empty). */
  getScan() { return this._scan }

  // -- providers with defaults --
  async _roots() {
    if (this._getRoots) {
      try { const r = await this._getRoots(); return Array.isArray(r) ? r : [] } catch (_e) { return [] }
    }
    try {
      if (typeof window !== 'undefined' && window.api && window.api.getSettings) {
        const known = await window.api.getSettings('knownProjects')
        return Array.isArray(known) ? known : []
      }
    } catch (_e) { /* ignore */ }
    return []
  }

  async _teamDocs() {
    if (!this._getOpenTeamDocs) return []
    try { const d = await this._getOpenTeamDocs(); return Array.isArray(d) ? d : [] } catch (_e) { return [] }
  }

  // -- file listing (cached for the debounce window) --
  async _listFiles(roots) {
    const now = Date.now()
    const key = JSON.stringify(roots)
    if (this._fileCache && this._fileCache.key === key && (now - this._fileCache.at) < this._fileCacheMs) {
      return this._fileCache.files
    }
    const files = []
    const api = (typeof window !== 'undefined') ? window.api : null
    if (api && typeof api.invoke === 'function') {
      for (const root of roots) {
        if (!root) continue
        try {
          const list = await api.invoke('fs:listMarkdownFilesRecursive', root)
          if (Array.isArray(list)) {
            for (const p of list) {
              // The lister already excludes dot-dirs; belt-and-braces guard anyway.
              if (typeof p === 'string' && !/(^|[\\/])\.[^\\/]/.test(p)) files.push(p)
            }
          }
        } catch (_e) { /* per-root failure is non-fatal */ }
      }
    }
    // de-dupe (roots can overlap)
    const uniq = Array.from(new Set(files))
    this._fileCache = { key, at: now, files: uniq }
    return uniq
  }

  /**
   * Recompute the scan. Debounced 250ms unless `force` (force still coalesces a
   * burst into a single in-flight run). Never throws (per-file errors swallowed).
   * @param {{ force?:boolean }} [opts]
   * @returns {Promise<object>} the resulting scan
   */
  requestScan({ force = false } = {}) {
    // A scan is already running: don't start a parallel one. Remember that a
    // *fresh* result was demanded so we re-run once when this one settles, and
    // (for force) drop the file-list cache so the re-run actually re-reads disk.
    if (this._running) {
      this._pendingForce = this._pendingForce || force
      if (force) this._fileCache = null
      return this._running.then(() => (this._pendingForce ? this.requestScan({ force }) : this._scan))
    }

    const start = () => {
      this._timer = null
      // Consume any pending-force request: this run satisfies it.
      this._pendingForce = false
      this._running = this._doScan().finally(() => { this._running = null })
      return this._running.then((result) => (
        // Only re-run if a force arrived *during* this run.
        this._pendingForce ? this.requestScan({ force: true }) : result
      ))
    }

    if (force) {
      if (this._timer) { clearTimeout(this._timer); this._timer = null }
      this._fileCache = null
      return start()
    }

    // Debounced (250ms): collapse a burst of non-forced requests into one run.
    // A single shared deferred (`_debounce`) is handed to every coalesced caller,
    // so resetting the timer reschedules the SAME promise — no caller is orphaned.
    if (!this._debounce) {
      let res
      let rej
      const promise = new Promise((resolve, reject) => { res = resolve; rej = reject })
      this._debounce = { promise, res, rej }
    }
    const deferred = this._debounce
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(() => {
      this._debounce = null
      start().then(deferred.res, deferred.rej)
    }, this._debounceMs)
    return deferred.promise
  }

  async _doScan() {
    const allTasks = []
    const allMentions = []
    const partialTeams = []

    // 1) local files
    try {
      const roots = await this._roots()
      const files = await this._listFiles(roots)
      const api = (typeof window !== 'undefined') ? window.api : null
      for (const path of files) {
        try {
          let text = ''
          if (api && typeof api.readFile === 'function') text = await api.readFile(path)
          if (typeof text !== 'string') text = ''
          const { tasks, mentions } = parseDoc(text, {
            source: path,
            noteTitle: basenameNoExt(path),
          })
          for (const t of tasks) allTasks.push(t)
          for (const m of mentions) allMentions.push(m)
        } catch (_e) { /* skip unreadable file */ }
      }
    } catch (_e) { /* listing failed wholesale — still try team docs */ }

    // 2) open team docs
    try {
      const docs = await this._teamDocs()
      for (const d of docs) {
        try {
          if (!d) continue
          if (d.partial) {
            if (d.source && !partialTeams.includes(d.source)) partialTeams.push(d.source)
          }
          let text = ''
          if (typeof d.getText === 'function') text = d.getText()
          else if (d.ytext && typeof d.ytext.toString === 'function') text = d.ytext.toString()
          if (typeof text !== 'string') text = ''
          const { tasks, mentions } = parseDoc(text, {
            source: d.source,
            noteTitle: d.title || basenameNoExt(d.source || 'note'),
            ytext: d.ytext || null,
          })
          for (const t of tasks) allTasks.push(t)
          for (const m of mentions) allMentions.push(m)
        } catch (_e) { /* skip bad team doc */ }
      }
    } catch (_e) { /* team-doc provider failed — keep local results */ }

    const scan = {
      tasks: allTasks,
      mentions: allMentions,
      partialTeams,
      scannedAt: Date.now(),
    }
    this._scan = scan
    // CustomEvent detail must be structured-cloneable. `_ytext` (a Y.Text) is not,
    // and structuredClone of CustomEvent detail can throw — but the bridge's `on`
    // hands `e.detail` straight through (no clone), and we never postMessage it.
    emit('scan:updated', scan)
    return scan
  }

  /**
   * Toggle a single task's checkbox to `done`, writing the change back to its
   * source. Re-reads the source fresh and re-finds the line by normalized text
   * (nearest `task.line` as a tie-break) — NOT by the stored line number.
   *
   * @param {object} task   a Task from getScan().tasks
   * @param {boolean} done  desired done-state
   * @returns {Promise<{ok:boolean}>}
   */
  async toggleTask(task, done) {
    if (!task || !task.source) return { ok: false }
    const wantChar = done ? 'x' : ' '
    const targetNorm = normalizeRest(task.rawText != null ? task.rawText : task.text)

    // -- TEAM doc (live Y.Text) --
    const ytext = task.ytext || null
    if (ytext && ytext.doc) {
      try {
        const full = ytext.toString()
        const hit = this._findCheckboxLine(full, targetNorm, task.line)
        if (!hit) { this.requestScan({ force: true }); return { ok: false } }
        // Replace just the single state char inside the bracket.
        const absBox = hit.lineStart + hit.boxOffset
        ytext.doc.transact(() => {
          ytext.delete(absBox, 1)
          ytext.insert(absBox, wantChar)
        }, 'task-toggle')
        await this.requestScan({ force: true })
        return { ok: true }
      } catch (_e) {
        this.requestScan({ force: true })
        return { ok: false }
      }
    }

    // -- LOCAL file --
    const api = (typeof window !== 'undefined') ? window.api : null
    if (!api || typeof api.readFile !== 'function' || typeof api.writeFile !== 'function') {
      return { ok: false }
    }
    try {
      const text = await api.readFile(task.source)
      if (typeof text !== 'string') { this.requestScan({ force: true }); return { ok: false } }
      const hit = this._findCheckboxLine(text, targetNorm, task.line)
      if (!hit) { this.requestScan({ force: true }); return { ok: false } }
      const abs = hit.lineStart + hit.boxOffset
      const next = text.slice(0, abs) + wantChar + text.slice(abs + 1)
      await api.writeFile(task.source, next)
      await this.requestScan({ force: true })
      return { ok: true }
    } catch (_e) {
      this.requestScan({ force: true })
      return { ok: false }
    }
  }

  /**
   * Find the checkbox line in `fullText` whose normalized rest equals `targetNorm`.
   * Among matches, pick the one whose line index is nearest `preferLine`.
   * Returns { lineStart, boxOffset } (boxOffset = index of the state char WITHIN
   * the line, i.e. the char between `[` and `]`), or null.
   */
  _findCheckboxLine(fullText, targetNorm, preferLine) {
    const lines = String(fullText).split('\n')
    let best = null
    let bestDist = Infinity
    let lineStart = 0
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i]
      const cm = CHECKBOX_RE.exec(raw)
      if (cm) {
        const norm = normalizeRest(cm[3])
        if (norm === targetNorm) {
          // Box offset = position of the state char. cm[1] is the indent, then
          // "- [" before the state char; recompute robustly by locating "[".
          const bracket = raw.indexOf('[')
          const boxOffset = bracket >= 0 ? bracket + 1 : -1
          if (boxOffset >= 0) {
            const dist = Math.abs(i - (preferLine || 0))
            if (dist < bestDist) { bestDist = dist; best = { lineStart, boxOffset } }
          }
        }
      }
      lineStart += raw.length + 1 // +1 for the '\n' we split on
    }
    return best
  }
}

export const taskScan = new TaskScan()

// Also export internals that are genuinely useful/pure for tests + the surfaces.
export { djb2, normalizeRest, parseDoc, CHECKBOX_RE }
