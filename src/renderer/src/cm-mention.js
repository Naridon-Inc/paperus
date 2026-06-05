/**
 * @mentions + @dates(+reminders) for the CodeMirror 6 markdown editor.
 *
 * Two things live here:
 *
 *   1. A CM `@codemirror/autocomplete` completion source (`mentionCompletionSource`)
 *      that fires when the user types `@`. It offers:
 *        - PAGES    → existing markdown pages (via fs:listMarkdownFilesRecursive),
 *                     inserted as `[[Title]]` so they render through the existing
 *                     wiki-link chip pipeline (page-links.js).
 *        - DATES    → "Today / Tomorrow / Next week / In a week / Pick a date…",
 *                     inserted as an inline `@date(YYYY-MM-DD)` token, optionally
 *                     `@date(YYYY-MM-DD|remind)` for a reminder.
 *      It self-registers from cm-editor.js via `autocompletion({override:[…]})`,
 *      so NO main.js wiring is required for the autocomplete itself.
 *
 *   2. Date-token detection + reminder scanning helpers used by:
 *        - cm-hide-markers.js   → renders `@date(…)` as a 📅 chip (🔔 if |remind)
 *        - initReminderWatcher  → best-effort surfacing of due reminders
 *
 * RENDERING (the date chip) lives in cm-hide-markers.js using `Decoration.mark`
 * marker-hiding (same overlap-safe approach as the highlight feature). The page
 * mentions render through the existing wiki-link chip pass — nothing new needed
 * for those beyond inserting the `[[…]]` text.
 */
import { WidgetType, Decoration } from '@codemirror/view'

// ── Date token: @date(2026-06-15) | @date(2026-06-15|remind) ───────────────────
// Group 1 = ISO date (YYYY-MM-DD), Group 2 = optional flag (e.g. "remind").
export const DATE_TOKEN_RE = /@date\((\d{4}-\d{2}-\d{2})(?:\|([a-z]+))?\)/gi

// ── Date helpers ───────────────────────────────────────────────────────────────

/** Local-midnight YYYY-MM-DD for a Date (avoids UTC off-by-one). */
function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d, n) {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

/** Parse a YYYY-MM-DD string to a local Date at midnight (null if invalid). */
export function parseISODate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Friendly short label for a date chip, e.g. "Jun 15, 2026" / "Today". */
export function formatDateLabel(iso) {
  const d = parseISODate(iso)
  if (!d) return iso
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  try {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

// ── Date chip widget (rendered by cm-hide-markers.js) ──────────────────────────

export class DateChipWidget extends WidgetType {
  /** @param {string} iso  @param {boolean} remind */
  constructor(iso, remind) {
    super()
    this.iso = iso
    this.remind = !!remind
  }

  eq(other) { return other.iso === this.iso && other.remind === this.remind }

  toDOM() {
    const chip = document.createElement('span')
    chip.className = 'cm-date-chip' + (this.remind ? ' cm-reminder' : '')
    const icon = this.remind ? '🔔' : '📅'
    chip.innerHTML = `<span class="cm-date-chip-icon"></span><span class="cm-date-chip-text"></span>`
    chip.querySelector('.cm-date-chip-icon').textContent = icon
    chip.querySelector('.cm-date-chip-text').textContent = formatDateLabel(this.iso)
    chip.title = this.remind ? `Reminder: ${this.iso}` : this.iso
    return chip
  }

  ignoreEvent() { return true }
}

/**
 * Collect overlap-safe date-chip decorations for the whole document.
 *
 * Mirrors collectInlineMathDecorations' shape. The `@date(…)` token is replaced
 * with a chip widget (a single `Decoration.replace` per token — these never
 * overlap each other or wiki/math/code spans because we skip those ranges via
 * the suppression guards passed in). Raw text is revealed on cursor-touch.
 *
 * @param {EditorState} state
 * @param {{from:number,to:number}[]} codeRanges  inline/fenced code spans to skip
 * @param {(state,from,to)=>boolean} cursorInRange  reveal predicate
 * @param {(from,to)=>boolean} [isSuppressed]  extra overlap guard (wiki/math/…)
 * @returns {{decos:import('@codemirror/view').Range[], ranges:{from:number,to:number}[]}}
 */
export function collectDateDecorations(state, codeRanges, cursorInRange, isSuppressed) {
  const decos = []
  const ranges = []
  const text = state.doc.toString()
  DATE_TOKEN_RE.lastIndex = 0
  let m
  while ((m = DATE_TOKEN_RE.exec(text)) !== null) {
    const from = m.index
    const to = from + m[0].length
    if (codeRanges && codeRanges.some(r => from < r.to && to > r.from)) continue
    if (isSuppressed && isSuppressed(from, to)) continue
    const iso = m[1]
    const remind = (m[2] || '').toLowerCase() === 'remind'
    ranges.push({ from, to })
    if (cursorInRange(state, from, to)) continue
    decos.push(Decoration.replace({ widget: new DateChipWidget(iso, remind) }).range(from, to))
  }
  return { decos, ranges }
}

// ── Reminder scanning ──────────────────────────────────────────────────────────

/**
 * Scan a document's text for reminder tokens (`@date(…|remind)`).
 * @param {string} docText
 * @returns {{iso:string, due:boolean, daysUntil:number}[]}
 *   due = date ≤ today; daysUntil is signed (negative = overdue).
 */
export function scanReminders(docText) {
  const out = []
  if (!docText) return out
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  DATE_TOKEN_RE.lastIndex = 0
  let m
  while ((m = DATE_TOKEN_RE.exec(docText)) !== null) {
    if ((m[2] || '').toLowerCase() !== 'remind') continue
    const d = parseISODate(m[1])
    if (!d) continue
    const daysUntil = Math.round((d - today) / 86400000)
    out.push({ iso: m[1], due: daysUntil <= 0, daysUntil })
  }
  return out
}

// ── Best-effort reminder watcher ────────────────────────────────────────────────
// Polls the currently-open document (window.cmView) for due reminders and
// surfaces them via the browser Notification API (if permitted) else console.
// Deliberately modest + non-intrusive: each reminder fires at most once per
// session (deduped by ISO date), and firing is best-effort.

let _reminderTimer = null
const _firedReminders = new Set()

function currentDocText() {
  try {
    if (window.cmView && window.cmView.state) return window.cmView.state.doc.toString()
  } catch { /* ignore */ }
  return ''
}

function surfaceReminder(rem) {
  const label = formatDateLabel(rem.iso)
  const overdue = rem.daysUntil < 0
  const title = overdue ? 'Reminder overdue' : 'Reminder due'
  const body = `${label} (${rem.iso})`
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      // eslint-disable-next-line no-new
      new Notification(title, { body })
      return
    }
  } catch { /* fall through to console */ }
  console.log(`[reminder] ${title}: ${body}`)
}

function checkReminders() {
  try {
    const reminders = scanReminders(currentDocText())
    for (const rem of reminders) {
      if (!rem.due) continue
      if (_firedReminders.has(rem.iso)) continue
      _firedReminders.add(rem.iso)
      surfaceReminder(rem)
    }
  } catch { /* best-effort */ }
}

/**
 * Start a lightweight reminder watcher. Safe to call multiple times (guarded).
 * Requests Notification permission once (best-effort) then polls every `intervalMs`.
 * @param {number} [intervalMs=60000]
 */
export function initReminderWatcher(intervalMs = 60000) {
  if (_reminderTimer) return // already running
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  } catch { /* ignore — console fallback */ }
  checkReminders()
  _reminderTimer = setInterval(checkReminders, Math.max(10000, intervalMs || 60000))
}

export function stopReminderWatcher() {
  if (_reminderTimer) {
    clearInterval(_reminderTimer)
    _reminderTimer = null
  }
}

// ── Mention completion source (registered in cm-editor.js) ─────────────────────

// Cache page list briefly so each keystroke doesn't re-scan the filesystem.
let _pageCache = { at: 0, pages: null }
const PAGE_CACHE_MS = 5000

async function loadPages() {
  const now = Date.now()
  if (_pageCache.pages && (now - _pageCache.at) < PAGE_CACHE_MS) return _pageCache.pages
  const pages = []
  try {
    // Guard for web / no-api builds.
    if (typeof window === 'undefined' || !window.api || typeof window.api.invoke !== 'function') {
      _pageCache = { at: now, pages }
      return pages
    }
    let root = null
    try {
      const known = await window.api.getSettings('knownProjects')
      if (Array.isArray(known) && known.length) root = known[0]
    } catch { /* ignore */ }
    if (!root) { _pageCache = { at: now, pages }; return pages }
    const files = await window.api.invoke('fs:listMarkdownFilesRecursive', root).catch(() => [])
    for (const p of (files || [])) {
      let base = p
      try { base = await window.api.basename(p) } catch { /* keep full path */ }
      base = String(base).replace(/\.(md|note)$/i, '')
      pages.push({ title: base.replace(/_/g, ' '), path: p })
    }
  } catch { /* ignore — empty list */ }
  _pageCache = { at: now, pages }
  return pages
}

/** Build the static date options offered after `@`. */
function dateOptions(from, view) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const make = (label, dateObj, remind) => {
    const iso = toISODate(dateObj)
    const token = `@date(${iso}${remind ? '|remind' : ''})`
    return {
      label,
      type: 'text',
      detail: remind ? '🔔 reminder' : '📅 date',
      // Insert via apply so we replace from the `@` trigger.
      apply: token,
      boost: -1,
    }
  }
  const opts = [
    make('Today', today, false),
    make('Tomorrow', addDays(today, 1), false),
    make('Next week', addDays(today, 7), false),
    make('Today (remind)', today, true),
    make('Tomorrow (remind)', addDays(today, 1), true),
    {
      label: 'Pick a date…',
      type: 'text',
      detail: '📅 choose',
      boost: -2,
      apply: (v, completion, fromPos, toPos) => {
        // Prompt for an ISO date, then insert a token. Browser prompt keeps this
        // dependency-free; cancelling just removes the `@`.
        let iso = ''
        try {
          iso = (window.prompt('Date (YYYY-MM-DD):', toISODate(today)) || '').trim()
        } catch { iso = '' }
        const valid = parseISODate(iso)
        const insert = valid ? `@date(${iso})` : ''
        v.dispatch({
          changes: { from: fromPos, to: toPos, insert },
          selection: { anchor: fromPos + insert.length },
        })
      },
    },
  ]
  return opts
}

/**
 * CM completion source for `@` (async). Resolves to null unless an `@` token is
 * being typed. Page options insert `[[Title]]` (wiki chip); date options insert
 * `@date(…)`. `options` must be a concrete array, so we await the page scan here.
 */
export async function mentionCompletionSource(context) {
  // Match `@` then word/space chars up to the cursor (no newline). The `@` must
  // be at line start or preceded by whitespace so we don't fire inside emails.
  const word = context.matchBefore(/(?:^|\s)@[\w .\-]*/)
  if (!word) return null
  // matchBefore captured an optional leading space — find the real `@` offset.
  const atIdx = word.text.indexOf('@')
  const from = word.from + atIdx
  // Only fire at start-of-doc/line or after whitespace.
  if (from > 0) {
    const before = context.state.doc.sliceString(from - 1, from)
    if (!/\s/.test(before)) return null
  }
  const query = context.state.doc.sliceString(from + 1, context.pos)
  // Bail if the query contains characters that mean this isn't a mention.
  if (/[\n\]]/.test(query)) return null

  const view = context.view
  const lower = query.toLowerCase()
  const options = []

  // PAGES → insert as [[Title]] (renders via existing wiki-link chip pass).
  const pages = await loadPages()
  if (context.aborted) return null
  const matched = lower
    ? pages.filter(p => p.title.toLowerCase().includes(lower))
    : pages
  for (const p of matched.slice(0, 30)) {
    options.push({
      label: p.title,
      type: 'class', // gives the popup a generic icon slot
      detail: '📄 page',
      apply: `[[${p.title}]]`,
    })
  }

  // DATES → show when no page query, or query loosely matches a date word.
  const dateWords = ['date', 'today', 'tomorrow', 'week', 'remind', 'reminder', 'pick']
  const showDates = !lower || dateWords.some(w => w.includes(lower) || lower.includes(w))
  if (showDates) {
    for (const opt of dateOptions(from, view)) options.push(opt)
  }

  if (options.length === 0) return null

  return {
    from,
    to: context.pos,
    filter: false, // we filter ourselves (mixed page/date options)
    options,
  }
}
