/**
 * Notion-style database block for the CodeMirror 6 editor.
 *
 * Stored in the document as a fenced code block tagged `database` whose body is
 * JSON describing typed columns, rows and views:
 *
 *   ```database
 *   { "name": "...", "columns": [...], "rows": [...], "views": [...], "activeView": "..." }
 *   ```
 *
 * The whole block renders as an interactive widget (table / board / gallery).
 * Every edit re-serialises the JSON and dispatches it back into the document,
 * so it persists through Yjs → ProjectionManager → disk like any other text.
 */
import { WidgetType } from '@codemirror/view'
import { evaluateFormula, validateFormula, FORMULA_ERR } from './db-formula'
import { renderChart } from './db-chart'

export const COLUMN_TYPES = [
  { value: 'text', label: 'Text', icon: 'fa-align-left' },
  { value: 'number', label: 'Number', icon: 'fa-hashtag' },
  { value: 'select', label: 'Select', icon: 'fa-chevron-circle-down' },
  { value: 'multi-select', label: 'Multi-select', icon: 'fa-list-ul' },
  { value: 'status', label: 'Status', icon: 'fa-circle-half-stroke' },
  { value: 'checkbox', label: 'Checkbox', icon: 'fa-square-check' },
  { value: 'date', label: 'Date', icon: 'fa-calendar' },
  { value: 'url', label: 'URL', icon: 'fa-link' },
  { value: 'email', label: 'Email', icon: 'fa-envelope' },
  { value: 'person', label: 'Person', icon: 'fa-user' },
  { value: 'formula', label: 'Formula', icon: 'fa-square-root-variable' },
  { value: 'relation', label: 'Relation', icon: 'fa-arrow-right-arrow-left' },
  { value: 'rollup', label: 'Rollup', icon: 'fa-layer-group' },
]

/** FA icon for a column type (used in the property menu + header). */
function colTypeIcon(type) {
  return (COLUMN_TYPES.find(t => t.value === type) || COLUMN_TYPES[0]).icon
}

// Column types whose value is computed/derived and therefore read-only + not
// directly editable as a normal cell (they have bespoke editors/displays).
const COMPUTED_TYPES = ['formula', 'rollup']

export const VIEW_TYPES = [
  { value: 'table', label: 'Table', icon: '<i class="fas fa-table"></i>' },
  { value: 'board', label: 'Board', icon: '<i class="fas fa-columns"></i>' },
  { value: 'gallery', label: 'Gallery', icon: '<i class="far fa-images"></i>' },
  { value: 'list', label: 'List', icon: '<i class="fas fa-list"></i>' },
  { value: 'calendar', label: 'Calendar', icon: '<i class="far fa-calendar"></i>' },
  { value: 'chart', label: 'Chart', icon: '<i class="fas fa-chart-bar"></i>' },
  { value: 'timeline', label: 'Timeline', icon: '<i class="fas fa-stream"></i>' },
]

/**
 * Cross-block registry of every rendered database, keyed by its stable `id`.
 * Relation / rollup columns and linked-database views resolve their targets
 * through here. Each entry is `{ id, title, columns, rows, commit }` where
 * `commit(mutator)` lets a *linked* view (or a relation editor) write back into
 * the source widget's data and re-serialise it. Populated on every render; a
 * target that hasn't rendered yet simply isn't found (handled gracefully).
 */
export const DB_REGISTRY = new Map()

// Column types that can be used to group a board / group-by.
const GROUPABLE_TYPES = ['select', 'multi-select', 'status']

const NO_VALUE = '__none__'

// Filter operators grouped by the "family" of a column type.
const FILTER_OPS = {
  text: [
    { value: 'contains', label: 'contains' },
    { value: 'is', label: 'is' },
    { value: 'empty', label: 'is empty' },
    { value: 'not_empty', label: 'is not empty' },
  ],
  number: [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'gte', label: '≥' },
    { value: 'lte', label: '≤' },
  ],
  select: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'contains', label: 'contains' },
  ],
  checkbox: [
    { value: 'checked', label: 'is checked' },
    { value: 'unchecked', label: 'is unchecked' },
  ],
  date: [
    { value: 'is', label: 'is' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'empty', label: 'is empty' },
  ],
}

// Footer aggregation options.
const CALC_OPS = [
  { value: '', label: 'None' },
  { value: 'count', label: 'Count all' },
  { value: 'count-filled', label: 'Count filled' },
  { value: 'count-empty', label: 'Count empty' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
  { value: 'percent-checked', label: '% checked' },
]

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// Notion-style option colors. A select/multi-select/status option's color is
// stored per-column in `col.optionColors = { [optionName]: key }`. Options
// without an explicit color get a STABLE one hashed from the name, so existing
// databases instantly look colored without any migration. Tuned for the light
// theme; `dot` is the saturated swatch used in pickers.
const OPTION_COLORS = {
  gray: { bg: '#e9e9e7', fg: '#42413d', dot: '#9b9a97' },
  brown: { bg: '#eee0da', fg: '#5b3f33', dot: '#a8775c' },
  orange: { bg: '#fadec9', fg: '#75400e', dot: '#e08b3f' },
  yellow: { bg: '#fdecc8', fg: '#6a5018', dot: '#dfab01' },
  green: { bg: '#dbeddb', fg: '#2b593f', dot: '#4dab6d' },
  blue: { bg: '#d3e5ef', fg: '#193b53', dot: '#529cca' },
  purple: { bg: '#e8deee', fg: '#492f64', dot: '#9a6dd7' },
  pink: { bg: '#f5dceb', fg: '#5f2b48', dot: '#e255a1' },
  red: { bg: '#ffe2dd', fg: '#6e2920', dot: '#ff7369' },
}
const OPTION_COLOR_KEYS = Object.keys(OPTION_COLORS)

// Status columns model three lanes (Notion parity). Each option belongs to a
// group; boards/grouping can collapse by lane. Default palette per group.
const STATUS_GROUPS = [
  { id: 'todo', label: 'To-do', color: 'gray' },
  { id: 'doing', label: 'In progress', color: 'blue' },
  { id: 'done', label: 'Complete', color: 'green' },
]
const DEFAULT_STATUS_OPTIONS = ['Not started', 'In progress', 'Done']

// Per-column number display formats.
const NUMBER_FORMATS = [
  { value: '', label: 'Plain' },
  { value: 'comma', label: 'Comma (1,234)' },
  { value: 'percent', label: 'Percent' },
  { value: 'usd', label: 'US Dollar ($)' },
  { value: 'eur', label: 'Euro (€)' },
  { value: 'gbp', label: 'Pound (£)' },
]

/** Deterministic small hash of a string → non-negative int (stable colors/ids). */
function hashStr(s) {
  let h = 0
  const str = String(s)
  for (let i = 0; i < str.length; i += 1) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** select + status share all option/pill/group logic. */
function isSelectLike(type) { return type === 'select' || type === 'status' }
function hasOptions(type) { return type === 'select' || type === 'status' || type === 'multi-select' }

/** Stable per-row id (for relations, drag-reorder, row peek). */
function genRowId() {
  return 'r_' + Math.random().toString(36).slice(2, 9) + hashStr(String(Math.random())).toString(36).slice(0, 3)
}

// Module-level cache of EPHEMERAL UI state, keyed by a stable per-database
// signature. A new DatabaseWidget instance is built on every doc change /
// decoration rebuild, so we cannot keep ephemeral state (open popover,
// collapsed groups, calendar month, expanded rows) on the instance alone —
// it would reset on every `_commit()`. This cache lets state survive rebuilds
// WITHOUT ever being written into the serialised document JSON.
const UI_STATE = new Map()

// A single floating popover/menu shared across all database widgets. It is
// appended to <body> (like the slash menu) so the table's overflow:hidden /
// overflow-x:auto never clips it, and so it survives the widget rebuild that a
// commit triggers. Only one is ever open. `closeFloat()` is also called at the
// start of every render so a stale popover can never be orphaned.
let FLOAT = null
function closeFloat() {
  if (!FLOAT) return
  const f = FLOAT
  FLOAT = null // null FIRST so an onCloseCommit that re-renders can't recurse
  document.removeEventListener('mousedown', f.onDoc, true)
  document.removeEventListener('keydown', f.onKey, true)
  window.removeEventListener('resize', f.onWin, true)
  f.layer.remove()
  if (f.onCloseCommit) { try { f.onCloseCommit() } catch { /* noop */ } }
}
/**
 * Open a floating panel anchored under `anchorEl`. `build(panel, close)` fills
 * it. Closes on outside mousedown / Escape / window resize. `onCloseCommit`
 * runs once when it closes (used by multi-select to persist on dismiss).
 */
function openFloat(anchorEl, build, { width, onCloseCommit } = {}) {
  closeFloat()
  const layer = document.createElement('div')
  layer.className = 'cm-db-float'
  if (width) layer.style.width = typeof width === 'number' ? width + 'px' : width
  const close = () => closeFloat()
  build(layer, close)
  document.body.appendChild(layer)

  const place = () => {
    const r = anchorEl.getBoundingClientRect()
    const lw = layer.offsetWidth
    const lh = layer.offsetHeight
    let left = r.left
    let top = r.bottom + 4
    if (left + lw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - lw)
    if (top + lh > window.innerHeight - 8) top = Math.max(8, r.top - lh - 4)
    layer.style.left = Math.max(8, left) + 'px'
    layer.style.top = Math.max(8, top) + 'px'
  }
  place()

  const onDoc = (e) => {
    if (layer.contains(e.target) || anchorEl === e.target || anchorEl.contains(e.target)) return
    closeFloat()
  }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeFloat() } }
  const onWin = () => closeFloat()
  // Defer attaching so the opening click doesn't immediately dismiss it.
  setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', onWin, true)
  FLOAT = { layer, onDoc, onKey, onWin, onCloseCommit, place }
  return { layer, close, reposition: place }
}

/** Which FILTER_OPS family a column type maps onto. */
function filterFamily(type) {
  if (type === 'number') return 'number'
  if (type === 'checkbox') return 'checkbox'
  if (type === 'date') return 'date'
  if (type === 'select' || type === 'multi-select' || type === 'status') return 'select'
  return 'text' // text, url, email, person
}

/** Generate a short, reasonably-unique stable database id. */
function genDbId() {
  return 'db_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

/** Markdown for a fresh database block, used by the slash command. */
export function defaultDatabaseMarkdown() {
  const data = {
    id: genDbId(),
    name: 'Untitled Database',
    columns: [
      { id: 'c1', name: 'Name', type: 'text' },
      { id: 'c2', name: 'Status', type: 'select', options: ['Todo', 'In Progress', 'Done'] },
    ],
    rows: [
      { c1: 'New item', c2: 'Todo' },
    ],
    views: [{ id: 'v1', type: 'table', name: 'Table' }],
    activeView: 'v1',
  }
  return '```database\n' + JSON.stringify(data, null, 2) + '\n```'
}

/** True if a FencedCode block's opening line declares the `database` language. */
export function isDatabaseFence(firstLineText) {
  return /^\s*`{3,}\s*database\s*$/.test(firstLineText)
}

/**
 * Markdown for a LINKED database block (self-contained: a normal ```database```
 * fence whose JSON carries `{ link:true, refDbId }`). Renders a live view of the
 * source db resolved from DB_REGISTRY — no data duplication. A slash command can
 * use this once it knows the target id.
 */
export function defaultDatabaseLinkMarkdown(refDbId) {
  const data = {
    id: genDbId(),
    link: true,
    refDbId: refDbId || null,
    name: 'Linked view',
    views: [{ id: 'v1', type: 'table', name: 'Table' }],
    activeView: 'v1',
    rowTemplates: [],
  }
  return '```database\n' + JSON.stringify(data, null, 2) + '\n```'
}

/**
 * True if this database block's JSON body is a *linked* database (a live view
 * of another db, no data of its own). Self-contained: a linked db is just a
 * normal ```database``` fence whose JSON has `{ link:true, refDbId:'…' }`, so
 * NO change to cm-hide-markers.js is required — the same DatabaseWidget handles
 * it. Exported for callers that want to detect linked blocks without parsing.
 */
export function isDatabaseLinkFence(bodyOrText) {
  if (!bodyOrText) return false
  const body = String(bodyOrText)
    .replace(/^\s*`{3,}\s*database\s*\n?/, '')
    .replace(/\n?`{3,}\s*$/, '')
  try {
    const d = JSON.parse(body)
    return !!(d && d.link === true && d.refDbId)
  } catch {
    return false
  }
}

export class DatabaseWidget extends WidgetType {
  constructor(text, from, to) {
    super()
    this.text = text
    this.from = from
    this.to = to
    this.data = this._parse(text)
    // `_own` is the block's own parsed JSON (always the serialisation target).
    // `this.data` is swapped per-render to the EFFECTIVE data (source for a
    // linked db) — see _render(). Keep both pointing at the parsed JSON until
    // the first render so any pre-render access is safe.
    this._own = this.data
    // Ephemeral UI state — NEVER serialised into the doc. Kept in a module
    // cache keyed by a stable database signature so it survives the widget
    // rebuild that every `_commit()` triggers.
    const key = this._uiKey()
    if (!UI_STATE.has(key)) {
      const now = new Date()
      UI_STATE.set(key, {
        calMonth: now.getMonth(),
        calYear: now.getFullYear(),
        collapsedGroups: {}, // key `${viewId}:${groupValue}` -> true
        expandedRows: {}, // list view: rowIndex -> true
        calEditRi: null, // calendar: row index being inline-edited
        openPopover: null, // 'filter' | 'sort' | null
        relPicker: null, // relation editor: `${ri}:${colId}` currently open
        tlMonths: 3, // timeline: number of months in the visible window
        tlOffset: 0, // timeline: month offset from start anchor
        tlEditRi: null, // timeline: row index being inline-edited
        tplMenu: false, // row-template dropdown open
        peekRowId: null, // row-peek panel: open row's __id (null = closed)
        hiddenCols: {}, // `${viewId}:${colId}` -> true (per-view column hide)
      })
    }
    this._ui = UI_STATE.get(key)
    DatabaseWidget._injectStyles()
  }

  /** Stable signature for ephemeral-state caching (not serialised). */
  _uiKey() {
    // Prefer the stable id; fall back to name+cols for ancient JSON.
    if (this.data.id) return `id:${this.data.id}`
    const cols = (this.data.columns || []).map(c => c.id).join(',')
    return `${this.data.name || ''}::${cols}`
  }

  /** Inject extra CSS once (we are not allowed to edit style.css). */
  static _injectStyles() {
    if (document.getElementById('cm-db-extra-styles')) return
    const style = document.createElement('style')
    style.id = 'cm-db-extra-styles'
    style.textContent = `
.cm-db-toolbar{display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap;padding:4px 12px;}
.cm-db-tbtn{display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:1;padding:4px 8px;border:1px solid var(--border-color,#d9d9d9);border-radius:6px;background:transparent;color:inherit;cursor:pointer;}
.cm-db-tbtn:hover{background:rgba(125,125,125,.12);}
.cm-db-tbtn.active{background:rgba(80,120,255,.16);border-color:rgba(80,120,255,.5);}
.cm-db-tbtn .cm-db-badge{background:rgba(80,120,255,.85);color:#fff;border-radius:8px;padding:0 5px;font-size:10px;}
/* In-flow full-width panel (not absolute) so .cm-db overflow:hidden never clips it. */
.cm-db-pop{flex-basis:100%;width:100%;margin-top:4px;background:var(--bg-color,#fff);border:1px solid var(--border-color,#d9d9d9);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.10);padding:8px;}
.cm-db-poprow{display:flex;align-items:center;gap:4px;margin-bottom:6px;}
.cm-db-poprow select,.cm-db-poprow input{font-size:12px;padding:3px 5px;border:1px solid var(--border-color,#d9d9d9);border-radius:5px;background:transparent;color:inherit;}
.cm-db-popadd{font-size:12px;color:#5078ff;background:none;border:none;cursor:pointer;padding:4px 2px;}
.cm-db-popx{background:none;border:none;color:#999;cursor:pointer;font-size:14px;line-height:1;}
.cm-db-popconj{font-size:11px;color:#888;width:42px;text-align:center;}
/* chips for multi-select */
.cm-db-chips{display:flex;flex-wrap:wrap;gap:3px;align-items:center;}
.cm-db-chip{display:inline-flex;align-items:center;font-size:11px;padding:1px 7px;border-radius:10px;background:rgba(80,120,255,.16);color:inherit;}
.cm-db-msedit{display:flex;flex-direction:column;gap:2px;min-width:120px;}
.cm-db-mslabel{display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;}
.cm-db-msadd{font-size:11px;color:#5078ff;background:none;border:none;cursor:pointer;text-align:left;padding:2px 0;}
/* url / email links */
.cm-db-link{color:#5078ff;text-decoration:underline;font-size:13px;cursor:pointer;word-break:break-all;}
.cm-db-link-edit{display:flex;align-items:center;gap:3px;}
/* person avatar */
.cm-db-people{display:flex;flex-wrap:wrap;gap:3px;align-items:center;}
.cm-db-person{display:inline-flex;align-items:center;gap:4px;font-size:12px;}
.cm-db-avatar{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#7a8cff;color:#fff;font-size:10px;font-weight:600;flex:0 0 auto;}
/* list view */
.cm-db-list{display:flex;flex-direction:column;border:1px solid var(--border-color,#e3e3e3);border-radius:8px;overflow:hidden;}
.cm-db-listrow{border-bottom:1px solid var(--border-color,#eee);}
.cm-db-listrow:last-child{border-bottom:none;}
.cm-db-listmain{display:flex;align-items:center;gap:10px;padding:7px 10px;cursor:pointer;}
.cm-db-listmain:hover{background:rgba(125,125,125,.07);}
.cm-db-listprimary{font-weight:600;font-size:13px;}
.cm-db-listmeta{display:flex;gap:10px;flex-wrap:wrap;color:#999;font-size:12px;margin-left:auto;}
.cm-db-listmeta span b{font-weight:500;color:#bbb;margin-right:3px;}
.cm-db-listmetaitem{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;}
.cm-db-listexpand{padding:6px 12px 10px 12px;background:rgba(125,125,125,.04);border-top:1px dashed var(--border-color,#eee);}
.cm-db-listadd{margin-top:6px;}
/* group-by */
.cm-db-group{margin-bottom:8px;}
.cm-db-grouphead{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:5px 4px;cursor:pointer;}
.cm-db-groupcount{color:#999;font-weight:400;}
.cm-db-groupchevron{transition:transform .12s;font-size:10px;color:#999;}
.cm-db-group.collapsed .cm-db-groupchevron{transform:rotate(-90deg);}
/* footer calc */
.cm-db-calcrow td{border-top:2px solid var(--border-color,#ddd);background:rgba(125,125,125,.04);}
.cm-db-calccell{display:flex;flex-direction:column;gap:1px;padding:3px 4px;}
.cm-db-calcsel{font-size:10px;color:#999;background:none;border:none;cursor:pointer;}
.cm-db-calcval{font-size:12px;font-weight:600;}
/* calendar */
.cm-db-cal{display:flex;flex-direction:column;gap:6px;}
.cm-db-calnav{display:flex;align-items:center;gap:8px;}
.cm-db-calnav button{background:none;border:1px solid var(--border-color,#d9d9d9);border-radius:5px;cursor:pointer;padding:2px 8px;color:inherit;}
.cm-db-caltitle{font-weight:600;font-size:13px;min-width:130px;}
.cm-db-calgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border-color,#e3e3e3);border:1px solid var(--border-color,#e3e3e3);border-radius:6px;overflow:hidden;}
.cm-db-caldow{background:var(--bg-color,#fafafa);text-align:center;font-size:10px;color:#999;padding:3px 0;text-transform:uppercase;}
.cm-db-calday{background:var(--bg-color,#fff);min-height:64px;padding:3px 4px;font-size:11px;display:flex;flex-direction:column;gap:2px;}
.cm-db-calday.other{background:rgba(125,125,125,.04);color:#bbb;}
.cm-db-caldaynum{font-size:10px;color:#999;display:flex;justify-content:space-between;align-items:center;}
.cm-db-caldayadd{background:none;border:none;color:#5078ff;cursor:pointer;font-size:11px;opacity:0;}
.cm-db-calday:hover .cm-db-caldayadd{opacity:1;}
.cm-db-calchip{font-size:11px;padding:1px 5px;border-radius:4px;background:rgba(80,120,255,.16);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cm-db-calhint{color:#999;font-size:13px;padding:10px;}
/* ── formula / computed cells ── */
.cm-db-computed{font-size:13px;color:inherit;opacity:.92;}
.cm-db-computed.cm-db-err{color:#ff3b30;font-weight:600;}
.cm-db-formula-cfg{display:flex;align-items:center;gap:4px;}
.cm-db-formula-cfg input{font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
/* ── relation chips + picker ── */
.cm-db-rel{display:flex;flex-wrap:wrap;gap:3px;align-items:center;min-height:20px;cursor:pointer;}
.cm-db-rel-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:1px 7px;border-radius:10px;background:rgba(52,199,89,.16);color:inherit;}
.cm-db-rel-chip .cm-db-rel-x{cursor:pointer;color:#999;font-size:12px;}
.cm-db-rel-empty{color:#999;font-size:12px;}
.cm-db-rel-picker{flex-basis:100%;width:100%;margin-top:4px;background:var(--bg-color,#fff);border:1px solid var(--border-color,#d9d9d9);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.10);padding:6px;max-height:220px;overflow:auto;}
.cm-db-rel-search{width:100%;font-size:12px;padding:4px 6px;border:1px solid var(--border-color,#d9d9d9);border-radius:5px;background:transparent;color:inherit;margin-bottom:4px;}
.cm-db-rel-opt{display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 4px;cursor:pointer;border-radius:4px;}
.cm-db-rel-opt:hover{background:rgba(125,125,125,.10);}
.cm-db-rel-missing{font-size:12px;color:#ff9500;padding:4px;}
/* ── chart view ── */
.cm-db-chart{padding:8px 12px;display:flex;flex-direction:column;gap:6px;}
.cm-db-chart-caption{font-size:12px;color:#999;}
.cm-db-chart-svg{max-width:520px;}
.cm-db-chart-axis{font-size:10px;fill:#999;}
.cm-db-chart-bval{font-size:10px;fill:#888;}
.cm-db-chart-pielabel{font-size:11px;fill:#fff;font-weight:600;}
.cm-db-chart-legend{display:flex;flex-wrap:wrap;gap:8px;}
.cm-db-chart-legitem{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:inherit;}
.cm-db-chart-swatch{width:10px;height:10px;border-radius:2px;display:inline-block;}
.cm-db-chart-empty,.cm-db-chart-hint{color:#999;font-size:13px;padding:12px;}
.cm-db-chart-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:0 12px 6px 12px;}
.cm-db-chart-toolbar label{font-size:11px;color:#999;display:inline-flex;align-items:center;gap:3px;}
.cm-db-chart-toolbar select{font-size:12px;padding:3px 5px;border:1px solid var(--border-color,#d9d9d9);border-radius:5px;background:transparent;color:inherit;}
/* ── timeline / gantt ── */
.cm-db-tl{padding:6px 12px;display:flex;flex-direction:column;gap:6px;}
.cm-db-tl-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.cm-db-tl-toolbar label{font-size:11px;color:#999;display:inline-flex;align-items:center;gap:3px;}
.cm-db-tl-toolbar select,.cm-db-tl-toolbar button{font-size:12px;padding:3px 6px;border:1px solid var(--border-color,#d9d9d9);border-radius:5px;background:transparent;color:inherit;cursor:pointer;}
.cm-db-tl-scroll{overflow-x:auto;border:1px solid var(--border-color,#e3e3e3);border-radius:8px;}
.cm-db-tl-grid{position:relative;}
.cm-db-tl-axis{display:flex;border-bottom:1px solid var(--border-color,#e3e3e3);position:sticky;top:0;background:var(--bg-color,#fff);z-index:1;}
.cm-db-tl-axiscell{flex:0 0 auto;font-size:10px;color:#999;text-align:center;padding:3px 0;border-left:1px solid var(--border-color,#eee);box-sizing:border-box;}
.cm-db-tl-rows{position:relative;}
.cm-db-tl-row{position:relative;height:30px;border-bottom:1px solid var(--border-color,#f0f0f0);}
.cm-db-tl-row:nth-child(even){background:rgba(125,125,125,.03);}
.cm-db-tl-bar{position:absolute;top:5px;height:20px;background:#5078ff;border-radius:5px;color:#fff;font-size:11px;line-height:20px;padding:0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.15);}
.cm-db-tl-bar:hover{filter:brightness(1.08);}
.cm-db-tl-hint{color:#999;font-size:13px;padding:12px;}
/* ── linked db banner ── */
.cm-db-linkbanner{display:flex;align-items:center;gap:6px;font-size:11px;color:#999;padding:2px 12px;}
.cm-db-linkbanner .cm-db-linkicon{color:#5078ff;}
.cm-db-link-broken{color:#ff9500;font-size:13px;padding:12px;}
/* ── row templates ── */
.cm-db-tplwrap{position:relative;display:inline-block;}
.cm-db-tplmenu{position:absolute;z-index:5;margin-top:2px;background:var(--bg-color,#fff);border:1px solid var(--border-color,#d9d9d9);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.12);padding:4px;min-width:180px;}
.cm-db-tplitem{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;padding:5px 8px;cursor:pointer;border-radius:5px;}
.cm-db-tplitem:hover{background:rgba(125,125,125,.10);}
.cm-db-tplitem .cm-db-tplx{color:#999;font-size:13px;cursor:pointer;}
.cm-db-tplsave{font-size:12px;color:#5078ff;border-top:1px solid var(--border-color,#eee);margin-top:3px;padding-top:5px;}

/* ══ Redesign: pills, cells, floating menus, peek, grips ══════════════════ */
/* Colored option pills (select / multi-select / status) */
.cm-db-pill{display:inline-flex;align-items:center;gap:4px;max-width:100%;font-size:12px;line-height:1.4;padding:1px 8px;border-radius:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cm-db-pill-x{cursor:pointer;opacity:.55;font-size:13px;margin-left:1px;}
.cm-db-pill-x:hover{opacity:1;}
.cm-db-pills{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}
/* Click-to-edit cell shell (select/multi/date) — reads as plain content */
.cm-db-cellbtn{display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-height:30px;padding:5px 8px;cursor:pointer;border-radius:4px;}
.cm-db-cellbtn:hover{background:rgba(55,53,47,.04);}
.cm-db-empty-cell{color:#c4c4c2;font-size:13px;}
.cm-db-datval{font-size:13px;color:#37352f;}
.cm-db-num{text-align:left;font-variant-numeric:tabular-nums;}
/* Floating popover layer (body-level, escapes table clipping) */
.cm-db-float{position:fixed;z-index:9000;background:#fff;border:1px solid #e6e6e4;border-radius:10px;box-shadow:0 6px 28px rgba(15,15,15,.14),0 1px 4px rgba(15,15,15,.1);padding:6px;font-size:13px;color:#37352f;max-height:min(70vh,440px);overflow:auto;}
.cm-db-float input,.cm-db-float select,.cm-db-float textarea{font-family:inherit;color:#37352f;}
/* Menus */
.cm-db-menu{padding:6px;min-width:180px;}
.cm-db-menu-title{font-size:11px;font-weight:600;color:#9b9a97;text-transform:uppercase;letter-spacing:.04em;padding:4px 8px 6px;}
.cm-db-menu-div{height:1px;background:#ececeb;margin:5px 2px;}
.cm-db-menu-rename{width:100%;box-sizing:border-box;border:1px solid #e2e2e0;border-radius:6px;padding:6px 8px;font-size:13px;margin-bottom:5px;outline:none;}
.cm-db-menu-rename:focus{border-color:#a9c7ee;}
.cm-db-menuitem{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:6px;cursor:pointer;line-height:1.3;}
.cm-db-menuitem:hover{background:rgba(55,53,47,.06);}
.cm-db-menuitem.danger{color:#e03e3e;}
.cm-db-mi-icon{width:16px;text-align:center;color:#8a8a87;font-size:12px;}
.cm-db-menuitem.danger .cm-db-mi-icon{color:#e03e3e;}
.cm-db-mi-label{flex:1;}
.cm-db-mi-trail{color:#b4b4b1;font-size:11px;}
/* Option picker (cell) */
.cm-db-optpop{padding:6px;}
.cm-db-optsearch{width:100%;box-sizing:border-box;border:1px solid #e2e2e0;border-radius:6px;padding:6px 8px;font-size:13px;outline:none;margin-bottom:6px;}
.cm-db-optsearch:focus{border-color:#a9c7ee;}
.cm-db-optlist{display:flex;flex-direction:column;gap:1px;}
.cm-db-optrow{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;cursor:pointer;}
.cm-db-optrow:hover{background:rgba(55,53,47,.06);}
.cm-db-optcheck{margin-left:auto;color:#6b6b6b;font-size:11px;}
.cm-db-optadd,.cm-db-optclear{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;cursor:pointer;color:#6b6b6b;font-size:12px;}
.cm-db-optadd:hover,.cm-db-optclear:hover{background:rgba(55,53,47,.06);}
.cm-db-optclear{color:#9b9a97;}
/* Option manager */
.cm-db-optmgr-list{display:flex;flex-direction:column;gap:2px;margin-bottom:4px;}
.cm-db-optmgr-row{display:flex;align-items:center;gap:6px;padding:2px 4px;}
.cm-db-swatch{width:18px;height:18px;border-radius:5px;border:1px solid rgba(0,0,0,.08);cursor:pointer;flex:0 0 auto;}
.cm-db-optmgr-name{flex:1;min-width:0;border:1px solid transparent;border-radius:5px;padding:4px 6px;font-size:13px;outline:none;}
.cm-db-optmgr-name:hover{background:rgba(55,53,47,.04);}
.cm-db-optmgr-name:focus{border-color:#a9c7ee;background:#fff;}
.cm-db-optmgr-del{border:none;background:none;color:#bbb;cursor:pointer;font-size:15px;line-height:1;padding:2px 4px;}
.cm-db-optmgr-del:hover{color:#e03e3e;}
.cm-db-colorgrid{display:grid;grid-template-columns:repeat(9,1fr);gap:4px;padding:4px 4px 6px 28px;}
.cm-db-colorcell{width:18px;height:18px;border-radius:50%;border:1px solid rgba(0,0,0,.08);cursor:pointer;}
.cm-db-colorcell.sel{box-shadow:0 0 0 2px #fff,0 0 0 3.5px #6b6b6b;}
.cm-db-optmgr-add{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;cursor:pointer;color:#6b6b6b;font-size:12px;}
.cm-db-optmgr-add:hover{background:rgba(55,53,47,.06);}
/* Date picker float */
.cm-db-datepop{display:flex;flex-direction:column;gap:6px;}
.cm-db-datepop input{border:1px solid #e2e2e0;border-radius:6px;padding:6px;font-size:13px;}
.cm-db-float-clear{border:none;background:none;color:#9b9a97;cursor:pointer;font-size:12px;text-align:left;padding:2px 4px;}
.cm-db-float-clear:hover{color:#e03e3e;}
/* Config floats (formula / rollup) */
.cm-db-cfg{padding:8px;}
.cm-db-formula-input{width:100%;box-sizing:border-box;min-height:64px;border:1px solid #e2e2e0;border-radius:6px;padding:8px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;outline:none;resize:vertical;}
.cm-db-formula-input:focus{border-color:#a9c7ee;}
.cm-db-formula-err{color:#e03e3e;font-size:12px;min-height:15px;margin-top:4px;}
.cm-db-formula-help{color:#9b9a97;font-size:11px;line-height:1.5;margin-top:2px;}
.cm-db-formula-help code{background:rgba(55,53,47,.06);padding:0 3px;border-radius:3px;}
.cm-db-cfg-note{color:#9b9a97;font-size:12px;line-height:1.5;padding:4px 6px;}
.cm-db-cfg-row{display:flex;flex-direction:column;gap:3px;font-size:11px;color:#9b9a97;margin-bottom:8px;}
.cm-db-cfg-row select{border:1px solid #e2e2e0;border-radius:6px;padding:5px 6px;font-size:13px;background:#fff;}
.cm-db-cfg-label{font-size:11px;font-weight:600;color:#9b9a97;text-transform:uppercase;letter-spacing:.03em;margin:6px 2px 3px;}
.cm-db-cfg-input,.cm-db-cfg-select{width:100%;box-sizing:border-box;border:1px solid #e2e2e0;border-radius:6px;padding:7px 8px;font-size:13px;background:#fff;outline:none;}
.cm-db-cfg-input:focus,.cm-db-cfg-select:focus{border-color:#a9c7ee;}
.cm-db-cfg-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px;}
.cm-db-cfg-save{border:none;background:#2383e2;color:#fff;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;}
.cm-db-cfg-cancel{border:1px solid #e2e2e0;background:#fff;color:#555;border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer;}
/* Header property cell */
.cm-db-colhead{display:flex;align-items:center;gap:6px;}
.cm-db-coltypeicon{color:#9b9a97;font-size:11px;flex:0 0 auto;}
.cm-db-colmenu{border:none;background:none;color:#b4b4b1;cursor:pointer;font-size:12px;padding:2px 3px;border-radius:4px;opacity:0;margin-left:auto;}
.cm-db-th:hover .cm-db-colmenu{opacity:1;}
.cm-db-colmenu:hover{background:rgba(55,53,47,.08);color:#37352f;}
/* Row grip + open + drag */
.cm-db-griphead{width:30px;border:1px solid #ebebeb;background:#fafafa;}
.cm-db-rowgrip{width:30px;border:1px solid #ebebeb;position:relative;text-align:center;vertical-align:middle;}
.cm-db-grip{color:#c4c4c2;cursor:grab;font-size:11px;opacity:0;}
.cm-db-row:hover .cm-db-grip{opacity:1;}
.cm-db-grip-off{cursor:not-allowed;}
.cm-db-openrow{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);border:1px solid #e6e6e4;background:#fff;border-radius:5px;color:#6b6b6b;cursor:pointer;font-size:10px;padding:3px 5px;opacity:0;box-shadow:0 1px 2px rgba(0,0,0,.06);}
.cm-db-row:hover .cm-db-openrow{opacity:1;}
.cm-db-openrow:hover{color:#2383e2;border-color:#a9c7ee;}
.cm-db-row.cm-db-dragging{opacity:.4;}
.cm-db-row.cm-db-droprow td{box-shadow:inset 0 2px 0 #2383e2;}
/* Row peek panel (body-level overlay) */
.cm-db-peek-overlay{position:fixed;inset:0;background:rgba(15,15,15,.32);z-index:9100;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;}
.cm-db-peek{background:#fff;border-radius:12px;width:560px;max-width:96vw;max-height:88vh;overflow:auto;box-shadow:0 16px 60px rgba(0,0,0,.28);display:flex;flex-direction:column;}
.cm-db-peek-head{display:flex;align-items:center;gap:10px;padding:18px 22px 10px;}
.cm-db-peek-title{flex:1;font-size:22px;font-weight:700;color:#37352f;}
.cm-db-peek-x{border:none;background:none;color:#9b9a97;cursor:pointer;font-size:18px;padding:4px;border-radius:6px;}
.cm-db-peek-x:hover{background:rgba(55,53,47,.08);color:#37352f;}
.cm-db-peek-body{padding:4px 22px 12px;display:flex;flex-direction:column;gap:2px;}
.cm-db-peek-field{display:flex;align-items:flex-start;gap:12px;padding:5px 0;border-radius:6px;}
.cm-db-peek-label{flex:0 0 150px;color:#7a7a77;font-size:13px;display:flex;align-items:center;gap:7px;padding-top:6px;}
.cm-db-peek-label i{color:#9b9a97;font-size:12px;width:14px;text-align:center;}
.cm-db-peek-val{flex:1;min-width:0;border-radius:6px;}
.cm-db-peek-val:hover{background:rgba(55,53,47,.03);}
.cm-db-peek-val .cm-db-text,.cm-db-peek-val .cm-db-cellbtn{min-height:32px;}
.cm-db-peek-foot{padding:10px 22px 18px;border-top:1px solid #f0f0ef;margin-top:6px;}
.cm-db-peek-del{border:none;background:none;color:#9b9a97;cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;}
.cm-db-peek-del:hover{background:rgba(224,62,62,.08);color:#e03e3e;}
`
    document.head.appendChild(style)
  }

  eq(other) { return this.text === other.text }
  ignoreEvent() { return true }

  // Called by CodeMirror when this widget's DOM is removed. Tear down the shared
  // floating popover so it can't outlive the widget. (Row-peek is keyed by owner
  // and managed by _syncPeek across rebuilds, so it's intentionally left alone.)
  destroy() { closeFloat() }

  _parse(text) {
    // Strip the fence lines, parse the JSON body.
    const body = text.replace(/^\s*`{3,}\s*database\s*\n?/, '').replace(/\n?`{3,}\s*$/, '')
    let data
    try {
      data = JSON.parse(body)
    } catch {
      data = null
    }
    if (!data || typeof data !== 'object') {
      data = { name: 'Database', columns: [], rows: [], views: [], activeView: null }
    }
    // Stable cross-block id (relations / rollups / linked dbs resolve via it).
    // Default one in if missing so old JSON keeps working; it persists on the
    // next _commit() but rendering never depends on it being written yet.
    if (typeof data.id !== 'string' || !data.id) data.id = genDbId()
    // Linked-database mode: `{ link:true, refDbId }`. Such a block holds no
    // columns/rows of its own; it proxies another db resolved from DB_REGISTRY.
    data.link = data.link === true
    if (typeof data.refDbId !== 'string') data.refDbId = data.refDbId || null
    data.columns = Array.isArray(data.columns) ? data.columns : []
    data.rows = Array.isArray(data.rows) ? data.rows : []
    data.views = Array.isArray(data.views) ? data.views : []
    // Per-column defaults so old JSON gains the new optional config cleanly.
    data.columns.forEach((c) => {
      if (!c || typeof c !== 'object') return
      if (hasOptions(c.type) && !Array.isArray(c.options)) c.options = []
      if (hasOptions(c.type) && (!c.optionColors || typeof c.optionColors !== 'object')) c.optionColors = {}
      if (c.type === 'number' && typeof c.numberFormat !== 'string') c.numberFormat = c.numberFormat || ''
    })
    // Stable per-row id. Relations, drag-reorder and row-peek key off it;
    // generated lazily so legacy rows (keyed by array index) upgrade once and
    // persist on the next edit — same pattern as the top-level `data.id`.
    data.rows.forEach((r) => {
      if (r && typeof r === 'object' && !r.__id) r.__id = genRowId()
    })
    // Row templates: [{ name, values:{colId:val} }]. Default to [] for old JSON.
    data.rowTemplates = Array.isArray(data.rowTemplates) ? data.rowTemplates : []
    if (!data.views.length) data.views = [{ id: 'v1', type: 'table', name: 'Table' }]
    // Defensive: make sure every view has the new optional config fields so
    // old / malformed JSON (without them) still renders cleanly.
    data.views.forEach((v) => {
      if (!v || typeof v !== 'object') return
      v.filters = Array.isArray(v.filters) ? v.filters : []
      v.sorts = Array.isArray(v.sorts) ? v.sorts : []
      if (v.conjunction !== 'or') v.conjunction = 'and'
      if (typeof v.groupBy !== 'string') v.groupBy = v.groupBy || null
      if (!v.calc || typeof v.calc !== 'object') v.calc = {}
      if (typeof v.dateColId !== 'string') v.dateColId = v.dateColId || null
      // chart view config (all optional)
      if (typeof v.chartType !== 'string') v.chartType = v.chartType || 'bar'
      if (typeof v.groupColId !== 'string') v.groupColId = v.groupColId || null
      if (typeof v.valueColId !== 'string') v.valueColId = v.valueColId || null
      if (typeof v.agg !== 'string') v.agg = v.agg || 'count'
      // timeline view config
      if (typeof v.startColId !== 'string') v.startColId = v.startColId || null
      if (typeof v.endColId !== 'string') v.endColId = v.endColId || null
    })
    if (!data.activeView || !data.views.some(v => v.id === data.activeView)) {
      data.activeView = data.views[0].id
    }
    return data
  }

  _nextId(prefix, existing) {
    let n = 1
    const ids = new Set(existing)
    while (ids.has(prefix + n)) n += 1
    return prefix + n
  }

  toDOM(view) {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-db'
    this._view = view
    this._wrapper = wrapper
    this._render()
    return wrapper
  }

  /**
   * Persist a data change.
   *
   * - Normal db: re-serialise `this._own` (the block's own JSON) back into the
   *   document fence.
   * - Linked db (`this._own.link`): columns/rows belong to the SOURCE db; write
   *   the mutation through the registry's `commit` hook so the source block's
   *   fence is the one updated. The link block's OWN config (views/filters) is
   *   still persisted to its own fence separately.
   * `mutator` is optional: when linked, callers that changed source rows pass a
   * function that already mutated the (shared) source data so we only need to
   * trigger the source's re-serialisation. Without it, we serialise own JSON.
   */
  _commit() {
    if (this._own.link) {
      const src = DB_REGISTRY.get(this._own.refDbId)
      // Push the source's current (already-mutated, shared by reference) data
      // back into the source fence, if it is currently mounted.
      if (src && typeof src.commit === 'function') src.commit()
      // Always persist this link block's own config (view/filter/etc.) too.
      this._commitOwn()
      return
    }
    this._commitOwn()
  }

  /** Serialise this block's OWN JSON back into its fence. */
  _commitOwn() {
    const md = '```database\n' + JSON.stringify(this._own, null, 2) + '\n```'
    this.text = md
    this._view.dispatch({ changes: { from: this.from, to: this.to, insert: md } })
    // Position bookkeeping: the replaced range now spans the new length so a
    // follow-up edit before the next decoration rebuild stays consistent.
    this.to = this.from + md.length
  }

  /**
   * Register this database into the cross-block registry so relations, rollups
   * and linked-views in the SAME document can resolve it. Called on every
   * render. For a linked block we do NOT register (it owns no data); we resolve
   * its source instead.
   */
  _register() {
    if (this._own.link) return
    DB_REGISTRY.set(this._own.id, {
      id: this._own.id,
      title: this._own.name || 'Database',
      columns: this._own.columns,
      rows: this._own.rows,
      commit: () => this._commitOwn(),
    })
  }

  /**
   * Resolve the EFFECTIVE data for rendering. For a linked db this returns the
   * source's columns/rows (live, by reference) merged with the link block's own
   * views/templates. Returns null when a link target can't be resolved.
   */
  _resolveEffective() {
    if (!this._own.link) return this._own
    const src = DB_REGISTRY.get(this._own.refDbId)
    if (!src) return null
    // Effective view-data: source columns/rows + this block's own view config.
    return {
      id: this._own.id,
      name: this._own.name || src.title,
      columns: src.columns,
      rows: src.rows,
      views: this._own.views,
      activeView: this._own.activeView,
      rowTemplates: this._own.rowTemplates,
      link: true,
      refDbId: this._own.refDbId,
      _srcTitle: src.title,
    }
  }

  _render() {
    closeFloat()
    // `this._own` is always the block's own parsed JSON (the serialisation
    // target for view/template config). `this.data` is the EFFECTIVE data the
    // render methods read columns/rows from (== _own for normal dbs, == source
    // for linked dbs). This swap keeps every existing render method unchanged.
    if (!this._own) this._own = this.data
    this._register()

    const wrap = this._wrapper
    wrap.innerHTML = ''

    if (this._own.link) {
      const eff = this._resolveEffective()
      if (!eff) {
        wrap.appendChild(this._renderHeader())
        const broken = document.createElement('div')
        broken.className = 'cm-db-link-broken'
        broken.textContent = this._own.refDbId
          ? `Linked database "${this._own.refDbId}" is not available in this document.`
          : 'This linked database has no source set.'
        wrap.appendChild(broken)
        return
      }
      this.data = eff
    } else {
      this.data = this._own
    }

    wrap.appendChild(this._renderHeader())
    if (this._own.link) wrap.appendChild(this._renderLinkBanner())

    const view = this.data.views.find(v => v.id === this.data.activeView) || this.data.views[0]
    wrap.appendChild(this._renderToolbar(view))

    const body = document.createElement('div')
    body.className = 'cm-db-body'
    if (view.type === 'board') body.appendChild(this._renderBoard(view))
    else if (view.type === 'gallery') body.appendChild(this._renderGallery(view))
    else if (view.type === 'list') body.appendChild(this._renderList(view))
    else if (view.type === 'calendar') body.appendChild(this._renderCalendar(view))
    else if (view.type === 'chart') body.appendChild(this._renderChartView(view))
    else if (view.type === 'timeline') body.appendChild(this._renderTimeline(view))
    else body.appendChild(this._renderTable(view))
    wrap.appendChild(body)

    this._syncPeek()
  }

  _renderLinkBanner() {
    const b = document.createElement('div')
    b.className = 'cm-db-linkbanner'
    b.innerHTML = `<i class="fas fa-link cm-db-linkicon"></i> Linked view of <b>&nbsp;${this.data._srcTitle || this._own.refDbId}</b>`
    return b
  }

  // ── Header: title + view tabs + add-view ──────────────────────────────────
  _renderHeader() {
    const header = document.createElement('div')
    header.className = 'cm-db-header'

    const title = document.createElement('input')
    title.className = 'cm-db-title'
    title.value = this.data.name || ''
    title.placeholder = 'Untitled Database'
    // name lives on the OWN JSON (a linked db has its own title separate from
    // the source's title).
    title.addEventListener('change', () => { this._own.name = title.value; this.data.name = title.value; this._commit() })
    header.appendChild(title)

    const tabs = document.createElement('div')
    tabs.className = 'cm-db-tabs'
    this.data.views.forEach((v) => {
      const tab = document.createElement('button')
      tab.className = 'cm-db-tab' + (v.id === this.data.activeView ? ' active' : '')
      const meta = VIEW_TYPES.find(t => t.value === v.type) || VIEW_TYPES[0]
      tab.innerHTML = `${meta.icon} <span>${v.name || meta.label}</span>`
      tab.addEventListener('click', () => {
        if (this.data.activeView === v.id) { this._renameView(v, tab); return }
        // activeView is persisted on the OWN JSON (linked dbs keep their own).
        this._own.activeView = v.id
        this.data.activeView = v.id
        this._commit()
      })
      tabs.appendChild(tab)
    })

    const addView = document.createElement('button')
    addView.className = 'cm-db-tab cm-db-addview'
    addView.innerHTML = '<i class="fas fa-plus"></i>'
    addView.title = 'Add view'
    addView.addEventListener('click', () => this._addView())
    tabs.appendChild(addView)

    header.appendChild(tabs)
    return header
  }

  _addView() {
    const id = this._nextId('v', this.data.views.map(v => v.id))
    // cycle to the next view type for convenience
    const order = ['table', 'board', 'gallery', 'list', 'calendar', 'chart', 'timeline']
    const last = this.data.views[this.data.views.length - 1]
    const type = order[(order.indexOf(last?.type ?? 'table') + 1) % order.length]
    const v = {
      id,
      type,
      name: VIEW_TYPES.find(t => t.value === type).label,
      filters: [],
      sorts: [],
      conjunction: 'and',
      groupBy: null,
      calc: {},
      dateColId: null,
      chartType: 'bar',
      groupColId: null,
      valueColId: null,
      agg: 'count',
      startColId: null,
      endColId: null,
    }
    if (type === 'board') v.groupBy = this._firstGroupableColumn()?.id || null
    if (type === 'calendar') v.dateColId = this._firstDateColumn()?.id || null
    if (type === 'chart') v.groupColId = this._firstGroupableColumn()?.id || (this.data.columns[0]?.id ?? null)
    if (type === 'timeline') v.startColId = this._firstDateColumn()?.id || null
    // views is shared-by-reference with _own (even for linked dbs); activeView
    // is a primitive so update both to keep the own JSON authoritative.
    this._own.views.push(v)
    this._own.activeView = id
    this.data.activeView = id
    this._commit()
  }

  // Small floating single-line text prompt (replaces window.prompt). Calls
  // onSave(trimmedValue) when confirmed via the button or Enter.
  _textPromptFloat(anchor, { title, label, value = '', placeholder = '', okLabel = 'Save', onSave }) {
    if (!anchor) return
    openFloat(anchor, (panel, close) => {
      panel.className += ' cm-db-cfg'
      if (title) this._menuTitle(panel, title)
      if (label) {
        const lab = document.createElement('div')
        lab.className = 'cm-db-cfg-label'
        lab.textContent = label
        panel.appendChild(lab)
      }
      const input = document.createElement('input')
      input.className = 'cm-db-cfg-input'
      input.type = 'text'
      input.value = value
      input.placeholder = placeholder
      panel.appendChild(input)
      const actions = document.createElement('div')
      actions.className = 'cm-db-cfg-actions'
      const cancel = document.createElement('button')
      cancel.className = 'cm-db-cfg-cancel'
      cancel.textContent = 'Cancel'
      cancel.addEventListener('click', () => close())
      const ok = document.createElement('button')
      ok.className = 'cm-db-cfg-save'
      ok.textContent = okLabel
      const commit = () => { const val = input.value.trim(); close(); onSave(val) }
      ok.addEventListener('click', commit)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        else if (e.key === 'Escape') { e.preventDefault(); close() }
      })
      actions.appendChild(cancel); actions.appendChild(ok)
      panel.appendChild(actions)
      setTimeout(() => { input.focus(); input.select() }, 0)
    }, { width: 260 })
  }

  _renameView(v, anchor) {
    const meta = VIEW_TYPES.find(t => t.value === v.type)
    this._textPromptFloat(anchor, {
      title: 'Rename view',
      value: v.name || '',
      placeholder: meta ? meta.label : 'View',
      onSave: (name) => { v.name = name || v.name; this._commit() },
    })
  }

  _firstSelectColumn() {
    return this.data.columns.find(c => c.type === 'select')
  }

  _firstGroupableColumn() {
    return this.data.columns.find(c => GROUPABLE_TYPES.includes(c.type))
  }

  _firstDateColumn() {
    return this.data.columns.find(c => c.type === 'date')
  }

  _colById(id) {
    return this.data.columns.find(c => c.id === id) || null
  }

  // ── Cell editors ──────────────────────────────────────────────────────────
  // ── Column visibility / reorder / menus ───────────────────────────────────
  _isHidden(view, colId) { return !!(view && this._ui.hiddenCols[`${view.id}:${colId}`]) }
  _visibleCols(view) { return this.data.columns.filter(c => !this._isHidden(view, c.id)) }

  /** Move row `srcId` to just before `targetId` (manual drag-reorder). */
  _moveRow(srcId, targetId) {
    if (!srcId || srcId === targetId) return
    const rows = this.data.rows
    const si = rows.findIndex(r => r.__id === srcId)
    if (si < 0) return
    const [moved] = rows.splice(si, 1)
    const ti = rows.findIndex(r => r.__id === targetId)
    if (ti < 0) rows.push(moved)
    else rows.splice(ti, 0, moved)
    this._commit()
  }

  /** A standard menu item. `onClick` fires on click; menu floats stay open
   *  until the handler calls its `close`. */
  _menuItem(iconClass, label, onClick, opts = {}) {
    const item = document.createElement('div')
    item.className = 'cm-db-menuitem' + (opts.danger ? ' danger' : '')
    item.innerHTML = `<span class="cm-db-mi-icon"><i class="${iconClass}"></i></span>`
      + `<span class="cm-db-mi-label">${label}</span>`
      + (opts.trailing ? `<span class="cm-db-mi-trail">${opts.trailing}</span>` : '')
    item.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
    return item
  }

  _menuDivider(panel) {
    const d = document.createElement('div')
    d.className = 'cm-db-menu-div'
    panel.appendChild(d)
  }

  _menuTitle(panel, text) {
    const t = document.createElement('div')
    t.className = 'cm-db-menu-title'
    t.textContent = text
    panel.appendChild(t)
  }

  // "New property" picker (replaces the bare + that always made a text column).
  _openAddColumn(anchor) {
    openFloat(anchor, (panel) => {
      panel.className += ' cm-db-menu'
      this._menuTitle(panel, 'New property')
      COLUMN_TYPES.forEach((t) => {
        panel.appendChild(this._menuItem(`fas ${t.icon}`, t.label, () => {
          const id = this._nextId('c', this.data.columns.map(c => c.id))
          const col = { id, name: t.label, type: t.value }
          if (hasOptions(t.value)) {
            col.options = t.value === 'status' ? DEFAULT_STATUS_OPTIONS.slice() : []
            col.optionColors = {}
          }
          if (t.value === 'number') col.numberFormat = ''
          closeFloat()
          this.data.columns.push(col)
          this._commit()
        }))
      })
    }, { width: 210 })
  }

  // Per-column property menu (rename, type, configure, sort, hide, delete…).
  _openColumnMenu(anchor, col, view) {
    openFloat(anchor, (panel, close) => {
      panel.className += ' cm-db-menu'
      const rn = document.createElement('input')
      rn.className = 'cm-db-menu-rename'
      rn.value = col.name
      rn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); rn.blur() } })
      rn.addEventListener('change', () => { const v = rn.value.trim(); if (v && v !== col.name) { col.name = v; this._commit() } })
      panel.appendChild(rn)

      const tLabel = (COLUMN_TYPES.find(t => t.value === col.type) || {}).label || col.type
      panel.appendChild(this._menuItem(`fas ${colTypeIcon(col.type)}`, 'Type · ' + tLabel,
        () => this._openTypeMenu(anchor, col), { trailing: '<i class="fas fa-angle-right"></i>' }))

      if (hasOptions(col.type)) panel.appendChild(this._menuItem('fas fa-palette', 'Edit options', () => this._manageOptionsFloat(anchor, col)))
      if (col.type === 'number') panel.appendChild(this._menuItem('fas fa-dollar-sign', 'Number format', () => this._numberFormatFloat(anchor, col)))
      if (col.type === 'formula') panel.appendChild(this._menuItem('fas fa-square-root-variable', 'Edit formula', () => this._configFormulaFloat(anchor, col)))
      if (col.type === 'relation') panel.appendChild(this._menuItem('fas fa-arrow-right-arrow-left', 'Configure relation', () => this._configRelationFloat(anchor, col)))
      if (col.type === 'rollup') panel.appendChild(this._menuItem('fas fa-layer-group', 'Configure rollup', () => this._configRollupFloat(anchor, col)))

      if (view) {
        this._menuDivider(panel)
        panel.appendChild(this._menuItem('fas fa-arrow-up-short-wide', 'Sort ascending', () => { this._setSort(view, col.id, 'asc'); close(); this._commit() }))
        panel.appendChild(this._menuItem('fas fa-arrow-down-wide-short', 'Sort descending', () => { this._setSort(view, col.id, 'desc'); close(); this._commit() }))
        panel.appendChild(this._menuItem('fas fa-eye-slash', 'Hide in view', () => { this._ui.hiddenCols[`${view.id}:${col.id}`] = true; close(); this._render() }))
      }

      this._menuDivider(panel)
      panel.appendChild(this._menuItem('fas fa-arrow-left', 'Insert left', () => { this._insertColumn(col, -1); close() }))
      panel.appendChild(this._menuItem('fas fa-arrow-right', 'Insert right', () => { this._insertColumn(col, 1); close() }))
      panel.appendChild(this._menuItem('far fa-clone', 'Duplicate', () => { this._duplicateColumn(col); close() }))
      if (this.data.columns.length > 1) panel.appendChild(this._menuItem('fas fa-trash', 'Delete property', () => { close(); this._deleteColumn(col) }, { danger: true }))
    }, { width: 230 })
  }

  _openTypeMenu(anchor, col) {
    openFloat(anchor, (panel, close) => {
      panel.className += ' cm-db-menu'
      this._menuTitle(panel, 'Property type')
      COLUMN_TYPES.forEach((t) => {
        panel.appendChild(this._menuItem(`fas ${t.icon}`, t.label,
          () => { close(); this._changeColType(col, t.value) },
          { trailing: col.type === t.value ? '<i class="fas fa-check"></i>' : '' }))
      })
    }, { width: 200 })
  }

  _changeColType(col, type) {
    col.type = type
    if (hasOptions(type)) {
      if (!Array.isArray(col.options)) col.options = []
      if (!col.optionColors || typeof col.optionColors !== 'object') col.optionColors = {}
    }
    if (type === 'number' && typeof col.numberFormat !== 'string') col.numberFormat = ''
    this._commit()
  }

  _setSort(view, colId, dir) { view.sorts = [{ colId, dir }] }

  _insertColumn(refCol, dir) {
    const id = this._nextId('c', this.data.columns.map(c => c.id))
    const idx = this.data.columns.findIndex(c => c.id === refCol.id)
    this.data.columns.splice(dir < 0 ? idx : idx + 1, 0, { id, name: 'Column', type: 'text' })
    this._commit()
  }

  _duplicateColumn(col) {
    const id = this._nextId('c', this.data.columns.map(c => c.id))
    const copy = JSON.parse(JSON.stringify(col))
    copy.id = id
    copy.name = col.name + ' copy'
    const idx = this.data.columns.findIndex(c => c.id === col.id)
    this.data.columns.splice(idx + 1, 0, copy)
    this.data.rows.forEach((r) => { if (col.id in r) r[id] = r[col.id] })
    this._commit()
  }

  _deleteColumn(col) {
    if (this.data.columns.length <= 1) return
    this.data.columns = this.data.columns.filter(c => c.id !== col.id)
    this.data.rows.forEach((r) => { delete r[col.id] })
    this._commit()
  }

  // Option manager: rename / recolor (inline 9-color grid) / delete / add.
  // Mutations are deferred — committed once when the float dismisses — so the
  // panel doesn't tear itself down mid-edit.
  _manageOptionsFloat(anchor, col) {
    if (!Array.isArray(col.options)) col.options = []
    if (!col.optionColors || typeof col.optionColors !== 'object') col.optionColors = {}
    let openColor = null
    openFloat(anchor, (panel) => {
      panel.className += ' cm-db-menu cm-db-optmgr'
      this._menuTitle(panel, 'Options')
      const list = document.createElement('div')
      list.className = 'cm-db-optmgr-list'
      panel.appendChild(list)
      const rebuild = () => {
        list.innerHTML = ''
        col.options.forEach((o) => {
          const r = document.createElement('div')
          r.className = 'cm-db-optmgr-row'
          const sw = document.createElement('button')
          sw.className = 'cm-db-swatch'
          sw.style.background = this._optionColor(col, o).dot
          sw.title = 'Color'
          sw.addEventListener('click', () => { openColor = openColor === o ? null : o; rebuild() })
          const inp = document.createElement('input')
          inp.className = 'cm-db-optmgr-name'
          inp.value = o
          inp.addEventListener('change', () => { const nv = inp.value.trim(); if (nv && nv !== o) { this._renameOption(col, o, nv); rebuild() } })
          const del = document.createElement('button')
          del.className = 'cm-db-optmgr-del'
          del.innerHTML = '×'
          del.addEventListener('click', () => { this._removeOption(col, o); if (openColor === o) openColor = null; rebuild() })
          r.appendChild(sw); r.appendChild(inp); r.appendChild(del)
          list.appendChild(r)
          if (openColor === o) {
            const grid = document.createElement('div')
            grid.className = 'cm-db-colorgrid'
            OPTION_COLOR_KEYS.forEach((k) => {
              const b = document.createElement('button')
              b.className = 'cm-db-colorcell' + (this._optionColor(col, o).key === k ? ' sel' : '')
              b.style.background = OPTION_COLORS[k].dot
              b.title = k
              b.addEventListener('click', () => { col.optionColors[o] = k; openColor = null; rebuild() })
              grid.appendChild(b)
            })
            list.appendChild(grid)
          }
        })
      }
      rebuild()
      const add = document.createElement('div')
      add.className = 'cm-db-optmgr-add'
      add.innerHTML = '<i class="fas fa-plus"></i> Add option'
      add.addEventListener('click', () => {
        let n = 1
        const names = new Set(col.options)
        while (names.has('Option ' + n)) n += 1
        col.options.push('Option ' + n)
        this._optionColor(col, 'Option ' + n)
        rebuild()
      })
      panel.appendChild(add)
    }, { width: 250, onCloseCommit: () => this._commit() })
  }

  _renameOption(col, oldN, newN) {
    if (!Array.isArray(col.options)) return
    const i = col.options.indexOf(oldN)
    if (i < 0 || col.options.includes(newN)) return
    col.options[i] = newN
    if (col.optionColors && col.optionColors[oldN]) { col.optionColors[newN] = col.optionColors[oldN]; delete col.optionColors[oldN] }
    this.data.rows.forEach((r) => {
      const v = r[col.id]
      if (Array.isArray(v)) { const j = v.indexOf(oldN); if (j >= 0) v[j] = newN }
      else if (v === oldN) r[col.id] = newN
    })
  }

  _removeOption(col, name) {
    if (!Array.isArray(col.options)) return
    col.options = col.options.filter(o => o !== name)
    if (col.optionColors) delete col.optionColors[name]
    this.data.rows.forEach((r) => {
      const v = r[col.id]
      if (Array.isArray(v)) r[col.id] = v.filter(x => x !== name)
      else if (v === name) r[col.id] = ''
    })
  }

  _numberFormatFloat(anchor, col) {
    openFloat(anchor, (panel, close) => {
      panel.className += ' cm-db-menu'
      this._menuTitle(panel, 'Number format')
      NUMBER_FORMATS.forEach((f) => {
        panel.appendChild(this._menuItem('fas fa-hashtag', f.label,
          () => { col.numberFormat = f.value; close(); this._commit() },
          { trailing: (col.numberFormat || '') === f.value ? '<i class="fas fa-check"></i>' : '' }))
      })
    }, { width: 200 })
  }

  _configFormulaFloat(anchor, col) {
    openFloat(anchor, (panel, close) => {
      panel.className += ' cm-db-cfg'
      this._menuTitle(panel, 'Formula')
      const ta = document.createElement('textarea')
      ta.className = 'cm-db-formula-input'
      ta.value = col.formula || ''
      ta.placeholder = 'prop("Price") * prop("Qty")'
      panel.appendChild(ta)
      const err = document.createElement('div')
      err.className = 'cm-db-formula-err'
      panel.appendChild(err)
      const help = document.createElement('div')
      help.className = 'cm-db-formula-help'
      help.innerHTML = 'Reference a column with <code>prop("Name")</code>. Functions: if, concat, length, round, floor, ceil, abs, sum, min, max, avg, contains, lower, upper.'
      panel.appendChild(help)
      const validate = () => { const e = validateFormula(ta.value); err.textContent = e ? ('⚠ ' + e) : ''; return !e }
      ta.addEventListener('input', validate)
      validate()
      const actions = document.createElement('div')
      actions.className = 'cm-db-cfg-actions'
      const cancel = document.createElement('button')
      cancel.className = 'cm-db-cfg-cancel'
      cancel.textContent = 'Cancel'
      cancel.addEventListener('click', () => close())
      const save = document.createElement('button')
      save.className = 'cm-db-cfg-save'
      save.textContent = 'Save'
      save.addEventListener('click', () => { if (!validate()) return; col.formula = ta.value; close(); this._commit() })
      actions.appendChild(cancel); actions.appendChild(save)
      panel.appendChild(actions)
      setTimeout(() => ta.focus(), 0)
    }, { width: 330 })
  }

  _configRelationFloat(anchor, col) {
    openFloat(anchor, (panel, close) => {
      panel.className += ' cm-db-menu'
      this._menuTitle(panel, 'Relate to a database')
      const targets = Array.from(DB_REGISTRY.values()).filter(t => t.id !== this.data.id)
      if (!targets.length) {
        const note = document.createElement('div')
        note.className = 'cm-db-cfg-note'
        note.textContent = 'No other database in this document yet. Add another database block, then link to it.'
        panel.appendChild(note)
        return
      }
      targets.forEach((t) => {
        panel.appendChild(this._menuItem('fas fa-table', t.title || t.id,
          () => { col.relDbId = t.id; close(); this._commit() },
          { trailing: col.relDbId === t.id ? '<i class="fas fa-check"></i>' : '' }))
      })
    }, { width: 250 })
  }

  _configRollupFloat(anchor, col) {
    openFloat(anchor, (panel, close) => {
      panel.className += ' cm-db-cfg'
      this._menuTitle(panel, 'Rollup')
      const relCols = this.data.columns.filter(c => c.type === 'relation')
      if (!relCols.length) {
        const note = document.createElement('div')
        note.className = 'cm-db-cfg-note'
        note.textContent = 'Add a Relation column first — a rollup aggregates a column from related rows.'
        panel.appendChild(note)
        return
      }
      const mkRow = (label) => { const r = document.createElement('label'); r.className = 'cm-db-cfg-row'; r.appendChild(document.createTextNode(label)); return r }
      const relRow = mkRow('Through relation')
      const relSel = document.createElement('select')
      relCols.forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; relSel.appendChild(o) })
      relSel.value = col.relColId || relCols[0].id
      relRow.appendChild(relSel); panel.appendChild(relRow)

      const tgtRow = mkRow('Property')
      const tgtSel = document.createElement('select')
      tgtRow.appendChild(tgtSel); panel.appendChild(tgtRow)
      const fillTargets = () => {
        tgtSel.innerHTML = ''
        const rc = this._colById(relSel.value)
        const target = rc ? this._relTarget(rc) : null
        const cnt = document.createElement('option'); cnt.value = ''; cnt.textContent = '(count only)'; tgtSel.appendChild(cnt)
        if (target) target.columns.forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; tgtSel.appendChild(o) })
        tgtSel.value = col.targetColId || ''
      }
      fillTargets()
      relSel.addEventListener('change', fillTargets)

      const fnRow = mkRow('Calculate')
      const fnSel = document.createElement('select')
      ;['count', 'sum', 'avg', 'min', 'max', 'concat'].forEach((f) => { const o = document.createElement('option'); o.value = f; o.textContent = f; fnSel.appendChild(o) })
      fnSel.value = col.fn || 'count'
      fnRow.appendChild(fnSel); panel.appendChild(fnRow)

      const actions = document.createElement('div')
      actions.className = 'cm-db-cfg-actions'
      const save = document.createElement('button')
      save.className = 'cm-db-cfg-save'
      save.textContent = 'Save'
      save.addEventListener('click', () => {
        col.relColId = relSel.value
        col.targetColId = tgtSel.value || null
        col.fn = fnSel.value
        close(); this._commit()
      })
      actions.appendChild(save)
      panel.appendChild(actions)
    }, { width: 260 })
  }

  // ── Row peek (open a single record as a panel) ─────────────────────────────
  // Appended to <body> (not inside .cm-db) because the break-out width applies a
  // transform to .cm-db, which would make a position:fixed child resolve against
  // the widget instead of the viewport. Keyed by owner so each database manages
  // only its own peek across rebuilds.
  _syncPeek() {
    const owner = this._uiKey()
    document.querySelectorAll('.cm-db-peek-overlay').forEach((el) => { if (el.dataset.owner === owner) el.remove() })
    if (this._ui.peekRowId == null) return
    const row = this.data.rows.find(r => r.__id === this._ui.peekRowId)
    if (!row) { this._ui.peekRowId = null; return }
    document.body.appendChild(this._buildPeek(row))
  }

  _buildPeek(row) {
    const overlay = document.createElement('div')
    overlay.className = 'cm-db-peek-overlay'
    overlay.dataset.owner = this._uiKey()
    const closePeek = () => { this._ui.peekRowId = null; this._render() }
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePeek() })

    const panel = document.createElement('div')
    panel.className = 'cm-db-peek'
    const head = document.createElement('div')
    head.className = 'cm-db-peek-head'
    const primary = this.data.columns[0]
    const ttl = document.createElement('div')
    ttl.className = 'cm-db-peek-title'
    ttl.textContent = primary ? (this._cellDisplay(primary, row) || 'Untitled') : 'Untitled'
    const x = document.createElement('button')
    x.className = 'cm-db-peek-x'
    x.innerHTML = '<i class="fas fa-xmark"></i>'
    x.addEventListener('click', closePeek)
    head.appendChild(ttl); head.appendChild(x)
    panel.appendChild(head)

    const bodyEl = document.createElement('div')
    bodyEl.className = 'cm-db-peek-body'
    this.data.columns.forEach((col) => {
      const field = document.createElement('div')
      field.className = 'cm-db-peek-field'
      const label = document.createElement('div')
      label.className = 'cm-db-peek-label'
      label.innerHTML = `<i class="fas ${colTypeIcon(col.type)}"></i> ${col.name}`
      const val = document.createElement('div')
      val.className = 'cm-db-peek-val'
      val.appendChild(this._cellEditor(col, row, (v) => { row[col.id] = v; this._commit() }))
      field.appendChild(label); field.appendChild(val)
      bodyEl.appendChild(field)
    })
    panel.appendChild(bodyEl)

    const foot = document.createElement('div')
    foot.className = 'cm-db-peek-foot'
    const del = document.createElement('button')
    del.className = 'cm-db-peek-del'
    del.innerHTML = '<i class="fas fa-trash"></i> Delete row'
    del.addEventListener('click', () => {
      const i = this.data.rows.indexOf(row)
      if (i >= 0) this.data.rows.splice(i, 1)
      this._ui.peekRowId = null
      this._commit()
    })
    foot.appendChild(del)
    panel.appendChild(foot)
    overlay.appendChild(panel)
    return overlay
  }

  // ── Option colors (select / multi-select / status) ────────────────────────
  /** Resolve an option's color tuple; assigns + persists a stable one if none. */
  _optionColor(col, name) {
    if (!col.optionColors || typeof col.optionColors !== 'object') col.optionColors = {}
    let key = col.optionColors[name]
    if (!key || !OPTION_COLORS[key]) {
      key = OPTION_COLOR_KEYS[hashStr(name) % OPTION_COLOR_KEYS.length]
    }
    return { key, ...OPTION_COLORS[key] }
  }

  /** A colored option pill. `onRemove` (optional) adds an × for multi-select. */
  _pill(col, name, onRemove) {
    const c = this._optionColor(col, name)
    const pill = document.createElement('span')
    pill.className = 'cm-db-pill'
    pill.style.background = c.bg
    pill.style.color = c.fg
    pill.appendChild(document.createTextNode(name))
    if (onRemove) {
      const x = document.createElement('span')
      x.className = 'cm-db-pill-x'
      x.textContent = '×'
      x.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); onRemove() })
      pill.appendChild(x)
    }
    return pill
  }

  /** Format a number for display per the column's numberFormat. */
  _formatNumber(col, v) {
    if (v == null || v === '') return ''
    const n = parseFloat(v)
    if (Number.isNaN(n)) return String(v)
    const fmt = col.numberFormat || ''
    const grouped = (x, d) => x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d == null ? 6 : d })
    if (fmt === 'comma') return grouped(n)
    if (fmt === 'percent') return grouped(n * 100, undefined) + '%'
    if (fmt === 'usd') return '$' + grouped(n, 2)
    if (fmt === 'eur') return '€' + grouped(n, 2)
    if (fmt === 'gbp') return '£' + grouped(n, 2)
    return String(this._trim(n))
  }

  // ── Cell editors ──────────────────────────────────────────────────────────
  _cellEditor(col, row, onChange) {
    const value = row[col.id]
    // Computed columns render read-only — they never write back through onChange.
    if (col.type === 'formula') return this._formulaCell(col, row)
    if (col.type === 'rollup') return this._rollupCell(col, row)
    if (col.type === 'relation') return this._relationEditor(col, row)
    if (col.type === 'checkbox') {
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.className = 'cm-db-check'
      cb.checked = value === true || value === 'true'
      cb.addEventListener('change', () => onChange(cb.checked))
      return cb
    }
    if (isSelectLike(col.type)) return this._selectCell(col, row, onChange)
    if (col.type === 'multi-select') return this._multiSelectCell(col, row, onChange)
    if (col.type === 'date') return this._dateCell(col, row, onChange)
    if (col.type === 'number') return this._numberCell(col, row, onChange)
    if (col.type === 'url' || col.type === 'email') return this._linkEditor(col, value, onChange)
    if (col.type === 'person') return this._personEditor(col, value, onChange)
    // text
    const span = document.createElement('div')
    span.className = 'cm-db-text'
    span.contentEditable = 'true'
    span.textContent = value != null ? value : ''
    span.addEventListener('blur', () => {
      const v = span.textContent.trim()
      if ((value != null ? String(value) : '') === v) return
      onChange(v)
    })
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); span.blur() }
      if (e.key === 'Escape') { span.blur(); this._view.focus() }
    })
    return span
  }

  // Number: formatted display at rest, raw value while editing.
  _numberCell(col, row, onChange) {
    const value = row[col.id]
    const span = document.createElement('div')
    span.className = 'cm-db-text cm-db-num'
    span.contentEditable = 'true'
    span.inputMode = 'decimal'
    span.textContent = this._formatNumber(col, value)
    span.addEventListener('focus', () => { span.textContent = value != null ? String(value) : '' })
    span.addEventListener('blur', () => {
      const v = span.textContent.trim()
      if ((value != null ? String(value) : '') !== v) { onChange(v); return }
      span.textContent = this._formatNumber(col, value) // revert to formatted
    })
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); span.blur() }
      if (e.key === 'Escape') { span.blur(); this._view.focus() }
    })
    return span
  }

  // Select / status: a colored pill (or empty) that opens an option picker.
  _selectCell(col, row, onChange) {
    const value = row[col.id] != null ? String(row[col.id]) : ''
    const cell = document.createElement('div')
    cell.className = 'cm-db-cellbtn'
    if (value) cell.appendChild(this._pill(col, value))
    else { const e = document.createElement('span'); e.className = 'cm-db-empty-cell'; e.textContent = 'Empty'; cell.appendChild(e) }
    cell.addEventListener('click', () => this._openOptionPicker(cell, col, value, false, (next) => onChange(next)))
    return cell
  }

  // Multi-select: pills + opens a checklist picker. Toggling inside the picker
  // mutates the row but defers the (heavy) re-serialise until the picker closes;
  // removing a pill directly is a discrete action that commits immediately.
  _multiSelectCell(col, row, onChange) {
    const cell = document.createElement('div')
    cell.className = 'cm-db-cellbtn cm-db-pills'
    const selected = Array.isArray(row[col.id]) ? row[col.id].slice() : (row[col.id] ? [String(row[col.id])] : [])
    const write = () => { row[col.id] = selected.slice() }
    const paint = () => {
      cell.innerHTML = ''
      if (!selected.length) { const e = document.createElement('span'); e.className = 'cm-db-empty-cell'; e.textContent = 'Empty'; cell.appendChild(e) }
      else selected.forEach(s => cell.appendChild(this._pill(col, s, () => {
        const i = selected.indexOf(s); if (i >= 0) selected.splice(i, 1)
        write(); paint(); onChange(selected.slice()) // discrete remove → commit now
      })))
    }
    paint()
    cell.addEventListener('click', (e) => {
      if (e.target.classList.contains('cm-db-pill-x')) return
      this._openOptionPicker(cell, col, selected, true, () => { write(); paint() }, selected)
    })
    return cell
  }

  // Date: formatted display that opens a native date input in the float.
  _dateCell(col, row, onChange) {
    const value = row[col.id] || ''
    const cell = document.createElement('div')
    cell.className = 'cm-db-cellbtn'
    if (value) { const s = document.createElement('span'); s.className = 'cm-db-datval'; s.textContent = this._formatDate(value); cell.appendChild(s) }
    else { const e = document.createElement('span'); e.className = 'cm-db-empty-cell'; e.textContent = 'Empty'; cell.appendChild(e) }
    cell.addEventListener('click', () => {
      openFloat(cell, (panel, close) => {
        panel.className += ' cm-db-datepop'
        const inp = document.createElement('input')
        inp.type = 'date'
        inp.value = value
        inp.addEventListener('change', () => { onChange(inp.value); close() })
        panel.appendChild(inp)
        if (value) {
          const clr = document.createElement('button')
          clr.className = 'cm-db-float-clear'
          clr.textContent = 'Clear'
          clr.addEventListener('click', () => { onChange(''); close() })
          panel.appendChild(clr)
        }
        setTimeout(() => inp.focus(), 0)
      }, { width: 180 })
    })
    return cell
  }

  _formatDate(s) {
    const d = new Date(String(s) + 'T00:00:00')
    if (Number.isNaN(d.getTime())) return String(s)
    return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`
  }

  // Shared option picker float for select/status (single) and multi-select.
  // `current` is the selected value (single) or the live selected array (multi).
  _openOptionPicker(anchor, col, current, multi, onPick, liveArr) {
    openFloat(anchor, (panel, close) => {
      panel.className += ' cm-db-optpop'
      const search = document.createElement('input')
      search.className = 'cm-db-optsearch'
      search.placeholder = 'Search or add…'
      panel.appendChild(search)
      const listEl = document.createElement('div')
      listEl.className = 'cm-db-optlist'
      panel.appendChild(listEl)

      const renderList = (q) => {
        listEl.innerHTML = ''
        const opts = Array.isArray(col.options) ? col.options : []
        const needle = (q || '').toLowerCase()
        const shown = opts.filter(o => !needle || o.toLowerCase().includes(needle))
        shown.forEach((o) => {
          const isSel = multi ? liveArr.includes(o) : current === o
          const opt = document.createElement('div')
          opt.className = 'cm-db-optrow' + (isSel ? ' sel' : '')
          opt.appendChild(this._pill(col, o))
          if (isSel) { const ck = document.createElement('span'); ck.className = 'cm-db-optcheck'; ck.innerHTML = '<i class="fas fa-check"></i>'; opt.appendChild(ck) }
          opt.addEventListener('mousedown', (e) => {
            e.preventDefault()
            if (multi) {
              const i = liveArr.indexOf(o)
              if (i >= 0) liveArr.splice(i, 1); else liveArr.push(o)
              onPick(liveArr); renderList(search.value)
            } else { onPick(o); close() }
          })
          listEl.appendChild(opt)
        })
        const typed = (q || '').trim()
        if (typed && !opts.some(o => o.toLowerCase() === typed.toLowerCase())) {
          const add = document.createElement('div')
          add.className = 'cm-db-optadd'
          add.innerHTML = `<i class="fas fa-plus"></i> Create <span class="cm-db-pill" style="background:${this._optionColor(col, typed).bg};color:${this._optionColor(col, typed).fg}">${typed}</span>`
          add.addEventListener('mousedown', (e) => {
            e.preventDefault()
            col.options = [...opts, typed]
            this._optionColor(col, typed) // assign+persist a stable color
            if (multi) { liveArr.push(typed); onPick(liveArr); search.value = ''; renderList('') } else { onPick(typed); close() }
          })
          listEl.appendChild(add)
        }
        if (!multi && current) {
          const clr = document.createElement('div')
          clr.className = 'cm-db-optclear'
          clr.textContent = 'Clear'
          clr.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(''); close() })
          listEl.appendChild(clr)
        }
      }
      renderList('')
      search.addEventListener('input', () => renderList(search.value))
      search.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
      setTimeout(() => search.focus(), 0)
    }, { width: 240, onCloseCommit: multi ? () => this._commit() : null })
  }

  // URL / email: a small text input + a live clickable link.
  _linkEditor(col, value, onChange) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-db-link-edit'

    const inp = document.createElement('input')
    inp.type = col.type === 'email' ? 'email' : 'url'
    inp.className = 'cm-db-text'
    inp.style.minWidth = '90px'
    inp.value = value != null ? value : ''
    inp.placeholder = col.type === 'email' ? 'name@host' : 'https://…'

    const link = document.createElement('a')
    link.className = 'cm-db-link'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    const syncLink = () => {
      const v = (inp.value || '').trim()
      if (!v) { link.style.display = 'none'; return }
      link.style.display = ''
      link.textContent = '↗'
      link.title = v
      link.href = col.type === 'email' ? 'mailto:' + v : (/^https?:\/\//i.test(v) ? v : 'https://' + v)
    }
    syncLink()

    inp.addEventListener('blur', () => {
      const v = inp.value.trim()
      syncLink()
      if ((value != null ? String(value) : '') !== v) onChange(v)
    })
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur() } })
    inp.addEventListener('input', syncLink)

    wrap.appendChild(inp)
    wrap.appendChild(link)
    return wrap
  }

  // Person: free-text name(s), rendered as avatar chips while editing inline.
  _personEditor(col, value, onChange) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-db-link-edit'

    const people = document.createElement('span')
    people.className = 'cm-db-people'
    const renderPeople = (str) => {
      people.innerHTML = ''
      const names = String(str || '').split(',').map(s => s.trim()).filter(Boolean)
      names.forEach((n) => {
        const av = document.createElement('span')
        av.className = 'cm-db-avatar'
        av.textContent = (n[0] || '?').toUpperCase()
        av.title = n
        people.appendChild(av)
      })
    }
    renderPeople(value)

    const inp = document.createElement('input')
    inp.type = 'text'
    inp.className = 'cm-db-text'
    inp.style.minWidth = '80px'
    inp.value = value != null ? value : ''
    inp.placeholder = 'Name'
    inp.addEventListener('input', () => renderPeople(inp.value))
    inp.addEventListener('blur', () => {
      const v = inp.value.trim()
      if ((value != null ? String(value) : '') !== v) onChange(v)
    })
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur() } })

    wrap.appendChild(people)
    wrap.appendChild(inp)
    return wrap
  }

  // ── Formula ────────────────────────────────────────────────────────────────
  // Build a name→value lookup for one row so formulas can `prop("ColName")`.
  // Computed columns (formula/rollup) referenced inside another formula are
  // resolved recursively with a `stack` set guarding against cycles.
  _formulaContext(row, stack) {
    const cols = this.data.columns
    const self = this
    return {
      lookup(name) {
        const col = cols.find(c => c.name === name) || cols.find(c => c.id === name)
        if (!col) return ''
        if (col.type === 'formula') {
          if (stack.has(col.id)) throw new Error('cycle')
          stack.add(col.id)
          const out = evaluateFormula(col.formula || '', self._formulaContext(row, stack))
          stack.delete(col.id)
          if (out === FORMULA_ERR) throw new Error('nested-err') // propagate as #ERR
          return out
        }
        if (col.type === 'rollup') return self._computeRollup(col, row)
        if (col.type === 'checkbox') return row[col.id] === true || row[col.id] === 'true'
        if (col.type === 'multi-select') return Array.isArray(row[col.id]) ? row[col.id] : (row[col.id] ? [row[col.id]] : [])
        const v = row[col.id]
        return v == null ? '' : v
      },
    }
  }

  // Compute a formula column's value for a row (read-only). Cycle/error -> #ERR.
  _formulaValue(col, row) {
    if (!col.formula) return ''
    const stack = new Set([col.id])
    try {
      return evaluateFormula(col.formula, this._formulaContext(row, stack))
    } catch {
      return FORMULA_ERR
    }
  }

  _formulaCell(col, row) {
    const span = document.createElement('div')
    const out = this._formulaValue(col, row)
    const isErr = out === FORMULA_ERR
    span.className = 'cm-db-computed' + (isErr ? ' cm-db-err' : '')
    span.textContent = out === '' ? '—' : (out === true ? '✓' : out === false ? '—' : String(out))
    span.title = col.formula ? `= ${col.formula}` : 'Empty formula'
    return span
  }

  // ── Relation ───────────────────────────────────────────────────────────────
  // Resolve the target db registry entry for a relation column.
  _relTarget(col) {
    return col.relDbId ? DB_REGISTRY.get(col.relDbId) : null
  }

  // Primary (display) value of a target row: its first column's value.
  _relRowLabel(target, trow) {
    const pcol = target.columns[0]
    if (!pcol) return '(row)'
    const v = trow[pcol.id]
    if (v == null || v === '') return '(untitled)'
    return Array.isArray(v) ? v.join(', ') : String(v)
  }

  _relValueArray(value) {
    if (Array.isArray(value)) return value.slice()
    return value ? [value] : []
  }

  _relationEditor(col, row) {
    const wrap = document.createElement('div')
    const ids = this._relValueArray(row[col.id])
    const target = this._relTarget(col)

    const chips = document.createElement('div')
    chips.className = 'cm-db-rel'
    const pickerKey = `${this.data.rows.indexOf(row)}:${col.id}`

    if (!col.relDbId) {
      const note = document.createElement('span')
      note.className = 'cm-db-rel-missing'
      note.textContent = 'Set a target db in the column header ▾'
      wrap.appendChild(note)
      return wrap
    }

    if (!ids.length) {
      const empty = document.createElement('span')
      empty.className = 'cm-db-rel-empty'
      empty.textContent = '+ Link rows'
      chips.appendChild(empty)
    }
    ids.forEach((tid) => {
      const chip = document.createElement('span')
      chip.className = 'cm-db-rel-chip'
      let label = tid
      if (target) {
        const trow = target.rows.find((r, i) => (r.__id || `r${i}`) === tid || String(i) === tid)
        if (trow) label = this._relRowLabel(target, trow)
        else label = '· missing'
      }
      chip.appendChild(document.createTextNode(label))
      const x = document.createElement('span')
      x.className = 'cm-db-rel-x'
      x.textContent = '×'
      x.addEventListener('click', (e) => {
        e.stopPropagation()
        const next = ids.filter(i => i !== tid)
        row[col.id] = next
        this._commit()
      })
      chip.appendChild(x)
      chips.appendChild(chip)
    })
    chips.addEventListener('click', () => {
      this._ui.relPicker = this._ui.relPicker === pickerKey ? null : pickerKey
      this._render()
    })
    wrap.appendChild(chips)

    if (this._ui.relPicker === pickerKey) {
      wrap.appendChild(this._relationPicker(col, row, ids, target))
    }
    return wrap
  }

  _relationPicker(col, row, ids, target) {
    const pick = document.createElement('div')
    pick.className = 'cm-db-rel-picker'
    if (!target) {
      const m = document.createElement('div')
      m.className = 'cm-db-rel-missing'
      m.textContent = 'Target database not found in this document yet. Open / render it to link rows.'
      pick.appendChild(m)
      return pick
    }
    const search = document.createElement('input')
    search.className = 'cm-db-rel-search'
    search.placeholder = 'Search rows…'
    pick.appendChild(search)

    const list = document.createElement('div')
    const renderOpts = (q) => {
      list.innerHTML = ''
      const needle = (q || '').toLowerCase()
      target.rows.forEach((trow, i) => {
        const tid = trow.__id || `r${i}`
        const label = this._relRowLabel(target, trow)
        if (needle && !label.toLowerCase().includes(needle)) return
        const opt = document.createElement('label')
        opt.className = 'cm-db-rel-opt'
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = ids.includes(tid)
        cb.addEventListener('change', () => {
          let next = this._relValueArray(row[col.id])
          if (cb.checked) { if (!next.includes(tid)) next.push(tid) } else next = next.filter(x => x !== tid)
          row[col.id] = next
          // Stamp a stable id onto the target row so the link survives reorders.
          if (!trow.__id) { trow.__id = tid; if (target.commit) target.commit() }
          this._commit()
        })
        opt.appendChild(cb)
        opt.appendChild(document.createTextNode(label))
        list.appendChild(opt)
      })
    }
    renderOpts('')
    search.addEventListener('input', () => renderOpts(search.value))
    pick.appendChild(list)
    return pick
  }

  // ── Rollup ─────────────────────────────────────────────────────────────────
  // Aggregate a target column across the rows linked by a relation column.
  _computeRollup(col, row) {
    const relCol = this._colById(col.relColId)
    if (!relCol || relCol.type !== 'relation') return ''
    const target = this._relTarget(relCol)
    if (!target) return ''
    const ids = this._relValueArray(row[relCol.id])
    const linked = ids
      .map(tid => target.rows.find((r, i) => (r.__id || `r${i}`) === tid || String(i) === tid))
      .filter(Boolean)
    const fn = col.fn || 'count'
    if (fn === 'count') return linked.length
    const tcol = target.columns.find(c => c.id === col.targetColId)
    if (!tcol) return fn === 'concat' ? '' : 0
    const raw = linked.map(r => r[tcol.id])
    if (fn === 'concat') {
      return raw.map(v => (Array.isArray(v) ? v.join(', ') : (v == null ? '' : String(v)))).filter(Boolean).join(', ')
    }
    const nums = raw.map(v => parseFloat(v)).filter(n => !Number.isNaN(n))
    if (!nums.length) return 0
    if (fn === 'sum') return this._trim(nums.reduce((a, b) => a + b, 0))
    if (fn === 'avg') return this._trim(nums.reduce((a, b) => a + b, 0) / nums.length)
    if (fn === 'min') return this._trim(Math.min(...nums))
    if (fn === 'max') return this._trim(Math.max(...nums))
    return 0
  }

  _rollupCell(col, row) {
    const span = document.createElement('div')
    span.className = 'cm-db-computed'
    const out = this._computeRollup(col, row)
    span.textContent = out === '' || out == null ? '—' : String(out)
    return span
  }

  // Read-only cell value renderer (used by list/calendar meta + footer).
  _cellDisplay(col, row) {
    const value = row[col.id]
    if (col.type === 'checkbox') return (value === true || value === 'true') ? '☑' : '☐'
    if (col.type === 'multi-select') {
      const arr = Array.isArray(value) ? value : (value ? [value] : [])
      return arr.join(', ')
    }
    if (col.type === 'formula') {
      const out = this._formulaValue(col, row)
      return out === true ? '✓' : out === false ? '' : String(out)
    }
    if (col.type === 'rollup') {
      const out = this._computeRollup(col, row)
      return out == null ? '' : String(out)
    }
    if (col.type === 'relation') {
      const ids = this._relValueArray(value)
      const target = this._relTarget(col)
      if (!target) return ids.join(', ')
      return ids.map((tid) => {
        const trow = target.rows.find((r, i) => (r.__id || `r${i}`) === tid || String(i) === tid)
        return trow ? this._relRowLabel(target, trow) : tid
      }).join(', ')
    }
    if (value == null || value === '') return ''
    if (col.type === 'date') return this._formatDate(value)
    if (col.type === 'number') return this._formatNumber(col, value)
    return String(value)
  }

  // ── Filtering / sorting / grouping pipeline ───────────────────────────────
  // Returns an array of { row, ri } so callers keep the real row index for
  // edits / deletes against this.data.rows.
  _visibleRows(view) {
    let indexed = this.data.rows.map((row, ri) => ({ row, ri }))
    const filters = Array.isArray(view.filters) ? view.filters : []
    if (filters.length) {
      const conj = view.conjunction === 'or' ? 'or' : 'and'
      indexed = indexed.filter(({ row }) => {
        const results = filters.map(f => this._matchFilter(f, row))
        return conj === 'or' ? results.some(Boolean) : results.every(Boolean)
      })
    }
    const sorts = Array.isArray(view.sorts) ? view.sorts : []
    if (sorts.length) {
      indexed = indexed.slice().sort((a, b) => {
        for (const s of sorts) {
          const col = this._colById(s.colId)
          if (!col) continue
          const cmp = this._compareForSort(col, a.row[col.id], b.row[col.id])
          if (cmp !== 0) return s.dir === 'desc' ? -cmp : cmp
        }
        return 0
      })
    }
    return indexed
  }

  _matchFilter(f, row) {
    const col = this._colById(f.colId)
    if (!col) return true
    const raw = row[col.id]
    const fam = filterFamily(col.type)
    if (fam === 'checkbox') {
      const checked = raw === true || raw === 'true'
      return f.op === 'checked' ? checked : !checked
    }
    if (fam === 'number') {
      const a = parseFloat(raw)
      const b = parseFloat(f.value)
      if (Number.isNaN(a) || Number.isNaN(b)) return false
      switch (f.op) {
        case 'eq': return a === b
        case 'neq': return a !== b
        case 'gt': return a > b
        case 'lt': return a < b
        case 'gte': return a >= b
        case 'lte': return a <= b
        default: return true
      }
    }
    if (fam === 'date') {
      const s = raw ? String(raw) : ''
      if (f.op === 'empty') return s === ''
      if (!s) return false
      if (f.op === 'is') return s === f.value
      if (f.op === 'before') return s < (f.value || '')
      if (f.op === 'after') return s > (f.value || '')
      return true
    }
    if (fam === 'select') {
      const arr = Array.isArray(raw) ? raw : (raw ? [raw] : [])
      const target = f.value || ''
      if (f.op === 'is') return arr.length === 1 && arr[0] === target
      if (f.op === 'is_not') return !arr.includes(target)
      if (f.op === 'contains') return arr.includes(target)
      return true
    }
    // text family (text/url/email/person)
    const s = (raw == null ? '' : String(raw)).toLowerCase()
    const needle = (f.value == null ? '' : String(f.value)).toLowerCase()
    switch (f.op) {
      case 'contains': return s.includes(needle)
      case 'is': return s === needle
      case 'empty': return s === ''
      case 'not_empty': return s !== ''
      default: return true
    }
  }

  _compareForSort(col, av, bv) {
    if (col.type === 'number') {
      const a = parseFloat(av); const b = parseFloat(bv)
      const an = Number.isNaN(a); const bn = Number.isNaN(b)
      if (an && bn) return 0
      if (an) return 1
      if (bn) return -1
      return a - b
    }
    if (col.type === 'checkbox') {
      const a = (av === true || av === 'true') ? 1 : 0
      const b = (bv === true || bv === 'true') ? 1 : 0
      return a - b
    }
    if (col.type === 'multi-select') {
      const a = Array.isArray(av) ? av.join(', ') : (av || '')
      const b = Array.isArray(bv) ? bv.join(', ') : (bv || '')
      return a.localeCompare(b)
    }
    const a = av == null ? '' : String(av)
    const b = bv == null ? '' : String(bv)
    return a.localeCompare(b, undefined, { numeric: true })
  }

  // Group an array of {row,ri} by a column's value(s). Returns ordered
  // [{ key, label, items }]. Multi-select rows appear under each value.
  _groupRows(view, indexed) {
    const col = this._colById(view.groupBy)
    if (!col) return [{ key: NO_VALUE, label: '', items: indexed }]
    const map = new Map()
    const push = (key, label, item) => {
      if (!map.has(key)) map.set(key, { key, label, items: [] })
      map.get(key).items.push(item)
    }
    indexed.forEach((item) => {
      const v = item.row[col.id]
      if (col.type === 'multi-select') {
        const arr = Array.isArray(v) ? v : (v ? [v] : [])
        if (!arr.length) push(NO_VALUE, 'No ' + col.name, item)
        else arr.forEach(x => push(x, x, item))
      } else {
        const s = (v == null || v === '') ? '' : String(v)
        if (s === '') push(NO_VALUE, 'No ' + col.name, item)
        else push(s, s, item)
      }
    })
    return Array.from(map.values())
  }

  // ── Row creation + templates ───────────────────────────────────────────────
  // Build a blank row. Computed columns (formula/rollup) get no stored value.
  _blankRow(seed) {
    const row = { __id: genRowId() }
    this.data.columns.forEach((c) => {
      if (COMPUTED_TYPES.includes(c.type)) return
      if (c.type === 'relation') { row[c.id] = []; return }
      row[c.id] = c.type === 'checkbox' ? false : (c.type === 'multi-select' ? [] : '')
    })
    if (seed) Object.keys(seed).forEach((k) => { if (this._colById(k)) row[k] = seed[k] })
    return row
  }

  _addRowFromTemplate(tpl) {
    const row = this._blankRow(tpl ? tpl.values : null)
    this.data.rows.push(row)
    this._commit()
  }

  // "New row" + "New from template ▾" + a save-template entry. Returns a wrapper.
  _renderNewRowControls(extraClass) {
    const wrap = document.createElement('div')
    wrap.style.display = 'flex'
    wrap.style.gap = '6px'
    wrap.style.alignItems = 'center'

    const addRow = document.createElement('button')
    addRow.className = 'cm-db-addrow' + (extraClass ? ' ' + extraClass : '')
    addRow.innerHTML = '<i class="fas fa-plus"></i> New row'
    addRow.addEventListener('click', () => this._addRowFromTemplate(null))
    wrap.appendChild(addRow)

    const tplWrap = document.createElement('div')
    tplWrap.className = 'cm-db-tplwrap'
    const tplBtn = document.createElement('button')
    tplBtn.className = 'cm-db-addrow'
    tplBtn.innerHTML = 'New from template <i class="fas fa-caret-down"></i>'
    tplBtn.addEventListener('click', () => {
      this._ui.tplMenu = !this._ui.tplMenu
      this._render()
    })
    tplWrap.appendChild(tplBtn)

    if (this._ui.tplMenu) {
      const menu = document.createElement('div')
      menu.className = 'cm-db-tplmenu'
      const tpls = Array.isArray(this.data.rowTemplates) ? this.data.rowTemplates : []
      if (!tpls.length) {
        const none = document.createElement('div')
        none.className = 'cm-db-tplitem'
        none.style.color = '#999'
        none.textContent = 'No templates yet'
        menu.appendChild(none)
      }
      tpls.forEach((tpl, i) => {
        const item = document.createElement('div')
        item.className = 'cm-db-tplitem'
        const label = document.createElement('span')
        label.textContent = tpl.name || `Template ${i + 1}`
        label.addEventListener('click', () => {
          this._ui.tplMenu = false
          this._addRowFromTemplate(tpl)
        })
        const x = document.createElement('span')
        x.className = 'cm-db-tplx'
        x.textContent = '×'
        x.title = 'Delete template'
        x.addEventListener('click', (e) => {
          e.stopPropagation()
          this.data.rowTemplates.splice(i, 1)
          this._commit()
        })
        item.appendChild(label)
        item.appendChild(x)
        menu.appendChild(item)
      })
      const save = document.createElement('div')
      save.className = 'cm-db-tplitem cm-db-tplsave'
      save.textContent = '+ Save a row as template…'
      save.addEventListener('click', () => {
        this._saveRowTemplate(save)
      })
      menu.appendChild(save)
      tplWrap.appendChild(menu)
    }
    wrap.appendChild(tplWrap)
    return wrap
  }

  // Save an existing row's stored values as a named template (float-based:
  // pick the source row, name it — no browser prompts).
  _saveRowTemplate(anchor) {
    const rows = this.data.rows
    if (!rows.length) {
      openFloat(anchor, (panel) => {
        panel.className += ' cm-db-cfg'
        const note = document.createElement('div')
        note.className = 'cm-db-cfg-note'
        note.textContent = 'Add a row first, then save it as a template.'
        panel.appendChild(note)
      }, { width: 240 })
      return
    }
    const nameCol = this.data.columns.find(c => c.type === 'text') || this.data.columns[0]
    openFloat(anchor, (panel, close) => {
      panel.className += ' cm-db-cfg'
      this._menuTitle(panel, 'Save row as template')

      const rowLab = document.createElement('div')
      rowLab.className = 'cm-db-cfg-label'
      rowLab.textContent = 'Source row'
      panel.appendChild(rowLab)
      const sel = document.createElement('select')
      sel.className = 'cm-db-cfg-select'
      rows.forEach((r, i) => {
        const opt = document.createElement('option')
        opt.value = String(i)
        const label = nameCol ? String(r[nameCol.id] || '').slice(0, 44) : ''
        opt.textContent = `${i + 1}. ${label || 'Untitled'}`
        sel.appendChild(opt)
      })
      panel.appendChild(sel)

      const nameLab = document.createElement('div')
      nameLab.className = 'cm-db-cfg-label'
      nameLab.textContent = 'Template name'
      panel.appendChild(nameLab)
      const input = document.createElement('input')
      input.className = 'cm-db-cfg-input'
      input.type = 'text'
      input.value = 'Template'
      panel.appendChild(input)

      const actions = document.createElement('div')
      actions.className = 'cm-db-cfg-actions'
      const cancel = document.createElement('button')
      cancel.className = 'cm-db-cfg-cancel'
      cancel.textContent = 'Cancel'
      cancel.addEventListener('click', () => close())
      const save = document.createElement('button')
      save.className = 'cm-db-cfg-save'
      save.textContent = 'Save'
      const commit = () => {
        const src = rows[parseInt(sel.value, 10)]
        if (!src) { close(); return }
        const values = {}
        this.data.columns.forEach((c) => {
          if (COMPUTED_TYPES.includes(c.type)) return // never store computed values
          if (src[c.id] !== undefined) values[c.id] = src[c.id]
        })
        if (!Array.isArray(this.data.rowTemplates)) this.data.rowTemplates = []
        this.data.rowTemplates.push({ name: input.value.trim() || 'Template', values })
        close()
        this._commit()
      }
      save.addEventListener('click', commit)
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } })
      actions.appendChild(cancel); actions.appendChild(save)
      panel.appendChild(actions)
      setTimeout(() => { input.focus(); input.select() }, 0)
    }, { width: 300 })
  }

  // ── Table view ────────────────────────────────────────────────────────────
  _renderTable(view) {
    const data = this.data
    const indexed = this._visibleRows(view || {})
    const groupCol = view ? this._colById(view.groupBy) : null
    const tableWrap = document.createElement('div')
    tableWrap.className = 'cm-db-tablewrap'
    const table = document.createElement('table')
    table.className = 'cm-db-table'

    // Header row
    const thead = document.createElement('thead')
    const htr = document.createElement('tr')
    const cols = this._visibleCols(view)
    const reorderable = !!view && (!view.sorts || !view.sorts.length) && !groupCol

    // Leading grip/open column.
    const gripTh = document.createElement('th')
    gripTh.className = 'cm-db-griphead'
    htr.appendChild(gripTh)

    cols.forEach((col) => {
      const th = document.createElement('th')
      th.className = 'cm-db-th'

      const head = document.createElement('div')
      head.className = 'cm-db-colhead'

      const icon = document.createElement('span')
      icon.className = 'cm-db-coltypeicon'
      icon.innerHTML = `<i class="fas ${colTypeIcon(col.type)}"></i>`
      head.appendChild(icon)

      const name = document.createElement('span')
      name.className = 'cm-db-colname'
      name.contentEditable = 'true'
      name.textContent = col.name
      name.addEventListener('blur', () => {
        const v = name.textContent.trim()
        if (v && v !== col.name) { col.name = v; this._commit() }
      })
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur() } })
      head.appendChild(name)

      const caret = document.createElement('button')
      caret.className = 'cm-db-colmenu'
      caret.innerHTML = '<i class="fas fa-angle-down"></i>'
      caret.title = 'Edit property'
      caret.addEventListener('click', () => this._openColumnMenu(th, col, view))
      head.appendChild(caret)

      th.appendChild(head)
      htr.appendChild(th)
    })

    const addColTh = document.createElement('th')
    addColTh.className = 'cm-db-addcol'
    const addColBtn = document.createElement('button')
    addColBtn.innerHTML = '<i class="fas fa-plus"></i>'
    addColBtn.title = 'New property'
    addColBtn.addEventListener('click', () => this._openAddColumn(addColBtn))
    addColTh.appendChild(addColBtn)
    htr.appendChild(addColTh)
    thead.appendChild(htr)
    table.appendChild(thead)

    // Body
    const colSpan = cols.length + 2
    const tbody = document.createElement('tbody')

    const renderRow = ({ row }) => {
      const tr = document.createElement('tr')
      tr.className = 'cm-db-row'

      const gripTd = document.createElement('td')
      gripTd.className = 'cm-db-rowgrip'
      const grip = document.createElement('span')
      grip.className = 'cm-db-grip' + (reorderable ? '' : ' cm-db-grip-off')
      grip.innerHTML = '<i class="fas fa-grip-vertical"></i>'
      if (reorderable) {
        grip.draggable = true
        grip.title = 'Drag to reorder'
        grip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', row.__id); e.dataTransfer.effectAllowed = 'move'; tr.classList.add('cm-db-dragging') })
        grip.addEventListener('dragend', () => tr.classList.remove('cm-db-dragging'))
      } else {
        grip.title = 'Turn off sort & grouping to drag rows'
      }
      const openBtn = document.createElement('button')
      openBtn.className = 'cm-db-openrow'
      openBtn.innerHTML = '<i class="fas fa-expand"></i>'
      openBtn.title = 'Open row'
      openBtn.addEventListener('click', () => { this._ui.peekRowId = row.__id; this._render() })
      gripTd.appendChild(grip)
      gripTd.appendChild(openBtn)
      tr.appendChild(gripTd)

      cols.forEach((col) => {
        const td = document.createElement('td')
        td.className = 'cm-db-td'
        td.appendChild(this._cellEditor(col, row, (val) => {
          row[col.id] = val
          this._commit()
        }))
        tr.appendChild(td)
      })
      const delTd = document.createElement('td')
      delTd.className = 'cm-db-rowaction'
      const delBtn = document.createElement('button')
      delBtn.className = 'cm-db-delrow'
      delBtn.innerHTML = '×'
      delBtn.title = 'Delete row'
      delBtn.addEventListener('click', () => {
        const i = this.data.rows.indexOf(row)
        if (i >= 0) this.data.rows.splice(i, 1)
        this._commit()
      })
      delTd.appendChild(delBtn)
      tr.appendChild(delTd)

      if (reorderable) {
        tr.addEventListener('dragover', (e) => { e.preventDefault(); tr.classList.add('cm-db-droprow') })
        tr.addEventListener('dragleave', () => tr.classList.remove('cm-db-droprow'))
        tr.addEventListener('drop', (e) => {
          e.preventDefault()
          tr.classList.remove('cm-db-droprow')
          this._moveRow(e.dataTransfer.getData('text/plain'), row.__id)
        })
      }
      return tr
    }

    if (groupCol) {
      const groups = this._groupRows(view, indexed)
      groups.forEach((g) => {
        const key = `${view.id}:${g.key}`
        const collapsed = !!this._ui.collapsedGroups[key]
        const headTr = document.createElement('tr')
        const headTd = document.createElement('td')
        headTd.colSpan = colSpan
        const head = document.createElement('div')
        head.className = 'cm-db-grouphead' + (collapsed ? ' collapsed' : '')
        head.innerHTML = `<span class="cm-db-groupchevron">▼</span><span>${g.label || 'No ' + groupCol.name}</span><span class="cm-db-groupcount">${g.items.length}</span>`
        head.addEventListener('click', () => {
          this._ui.collapsedGroups[key] = !collapsed
          this._render()
        })
        headTd.appendChild(head)
        headTr.appendChild(headTd)
        tbody.appendChild(headTr)
        if (!collapsed) g.items.forEach(item => tbody.appendChild(renderRow(item)))
      })
    } else {
      indexed.forEach(item => tbody.appendChild(renderRow(item)))
    }
    table.appendChild(tbody)

    // Footer aggregation controls: per-column calc selector + computed value
    // over the currently-filtered rows. Lives in the main table's <tfoot> so
    // it stays column-aligned. Always shown so a calc can be picked.
    if (view) table.appendChild(this._renderCalcFooter(view, indexed))
    tableWrap.appendChild(table)

    tableWrap.appendChild(this._renderNewRowControls())
    return tableWrap
  }

  // The interactive footer where each column gets a small calc selector +
  // computed value over the currently-filtered rows. Returns a <tfoot>.
  _renderCalcFooter(view, indexed) {
    const data = this.data
    if (!view.calc || typeof view.calc !== 'object') view.calc = {}
    const tfoot = document.createElement('tfoot')
    const tr = document.createElement('tr')
    tr.className = 'cm-db-calcrow'
    tr.appendChild(document.createElement('td')) // leading grip column
    this._visibleCols(view).forEach((col) => {
      const td = document.createElement('td')
      const cell = document.createElement('div')
      cell.className = 'cm-db-calccell'
      const sel = document.createElement('select')
      sel.className = 'cm-db-calcsel'
      this._calcOpsFor(col).forEach((op) => {
        const o = document.createElement('option')
        o.value = op.value; o.textContent = op.label
        sel.appendChild(o)
      })
      sel.value = view.calc[col.id] || ''
      sel.addEventListener('change', () => {
        if (sel.value) view.calc[col.id] = sel.value
        else delete view.calc[col.id]
        this._commit()
      })
      const val = document.createElement('div')
      val.className = 'cm-db-calcval'
      val.textContent = view.calc[col.id]
        ? this._computeCalc(view.calc[col.id], col, indexed) : ''
      cell.appendChild(sel)
      cell.appendChild(val)
      td.appendChild(cell)
      tr.appendChild(td)
    })
    tr.appendChild(document.createElement('td'))
    tfoot.appendChild(tr)
    return tfoot
  }

  _calcOpsFor(col) {
    const numeric = col.type === 'number' || col.type === 'formula' || col.type === 'rollup'
    return CALC_OPS.filter((op) => {
      if (['sum', 'avg', 'min', 'max'].includes(op.value)) return numeric
      if (op.value === 'percent-checked') return col.type === 'checkbox'
      return true
    })
  }

  // The numeric/raw value of a cell for aggregation — resolves computed columns.
  _calcRaw(col, row) {
    if (col.type === 'formula') return this._formulaValue(col, row)
    if (col.type === 'rollup') return this._computeRollup(col, row)
    return row[col.id]
  }

  _computeCalc(op, col, indexed) {
    const rows = indexed.map(x => x.row)
    const isFilled = (r) => {
      const v = this._calcRaw(col, r)
      if (col.type === 'checkbox') return v === true || v === 'true'
      if (col.type === 'multi-select') return Array.isArray(v) && v.length > 0
      return v != null && String(v).trim() !== ''
    }
    if (op === 'count') return String(rows.length)
    if (op === 'count-filled') return String(rows.filter(isFilled).length)
    if (op === 'count-empty') return String(rows.filter(r => !isFilled(r)).length)
    if (op === 'percent-checked') {
      if (!rows.length) return '0%'
      const c = rows.filter(r => r[col.id] === true || r[col.id] === 'true').length
      return Math.round((c / rows.length) * 100) + '%'
    }
    const nums = rows.map(r => parseFloat(this._calcRaw(col, r))).filter(n => !Number.isNaN(n))
    if (!nums.length) return '—'
    if (op === 'sum') return String(this._trim(nums.reduce((a, b) => a + b, 0)))
    if (op === 'avg') return String(this._trim(nums.reduce((a, b) => a + b, 0) / nums.length))
    if (op === 'min') return String(this._trim(Math.min(...nums)))
    if (op === 'max') return String(this._trim(Math.max(...nums)))
    return ''
  }

  _trim(n) {
    return Math.round(n * 1000) / 1000
  }

  // ── Board (kanban) view ───────────────────────────────────────────────────
  _renderBoard(view) {
    const data = this.data
    const board = document.createElement('div')
    board.className = 'cm-db-board'

    let groupCol = data.columns.find(c => c.id === view.groupBy && GROUPABLE_TYPES.includes(c.type))
    if (!groupCol) groupCol = this._firstGroupableColumn()

    if (!groupCol) {
      const note = document.createElement('div')
      note.className = 'cm-db-empty'
      note.textContent = 'Add a Select or Multi-select column to group cards into a board.'
      board.appendChild(note)
      return board
    }
    view.groupBy = groupCol.id
    const isMulti = groupCol.type === 'multi-select'

    // Group selector
    const ctrl = document.createElement('div')
    ctrl.className = 'cm-db-boardctrl'
    ctrl.innerHTML = '<span>Group by</span>'
    const gsel = document.createElement('select')
    data.columns.filter(c => GROUPABLE_TYPES.includes(c.type)).forEach((c) => {
      const o = document.createElement('option')
      o.value = c.id; o.textContent = c.name
      gsel.appendChild(o)
    })
    gsel.value = groupCol.id
    gsel.addEventListener('change', () => { view.groupBy = gsel.value; this._commit() })
    ctrl.appendChild(gsel)
    board.appendChild(ctrl)

    const cols = document.createElement('div')
    cols.className = 'cm-db-boardcols'

    const groups = [...(groupCol.options || [])]
    const colId = groupCol.id
    const indexed = this._visibleRows(view)

    const cardMatches = (rv, matchVal, isNone) => {
      if (isMulti) {
        const arr = Array.isArray(rv) ? rv : (rv ? [rv] : [])
        return isNone ? arr.length === 0 : arr.includes(matchVal)
      }
      return (rv || '') === matchVal
    }

    const makeColumn = (groupName, isNone) => {
      const column = document.createElement('div')
      column.className = 'cm-db-boardcol'
      const head = document.createElement('div')
      head.className = 'cm-db-boardcol-head'
      head.textContent = isNone ? 'No ' + groupCol.name : groupName
      column.appendChild(head)

      const matchVal = isNone ? '' : groupName
      indexed.forEach(({ row, ri }) => {
        if (!cardMatches(row[colId], matchVal, isNone)) return
        column.appendChild(this._renderCard(row, ri, groupCol))
      })

      // drop target
      column.addEventListener('dragover', (e) => { e.preventDefault(); column.classList.add('cm-db-dropover') })
      column.addEventListener('dragleave', () => column.classList.remove('cm-db-dropover'))
      column.addEventListener('drop', (e) => {
        e.preventDefault()
        column.classList.remove('cm-db-dropover')
        const ri = parseInt(e.dataTransfer.getData('text/plain'), 10)
        if (!Number.isNaN(ri) && data.rows[ri]) {
          if (isMulti) data.rows[ri][colId] = isNone ? [] : [groupName]
          else data.rows[ri][colId] = isNone ? '' : groupName
          this._commit()
        }
      })

      const add = document.createElement('button')
      add.className = 'cm-db-addcard'
      add.innerHTML = '<i class="fas fa-plus"></i>'
      add.addEventListener('click', () => {
        const row = this._blankRow()
        if (isMulti) row[colId] = isNone ? [] : [groupName]
        else row[colId] = isNone ? '' : groupName
        data.rows.push(row)
        this._commit()
      })
      column.appendChild(add)
      return column
    }

    groups.forEach(g => cols.appendChild(makeColumn(g, false)))
    cols.appendChild(makeColumn(NO_VALUE, true))
    board.appendChild(cols)
    return board
  }

  _renderCard(row, ri, groupCol) {
    const data = this.data
    const card = document.createElement('div')
    card.className = 'cm-db-card'
    card.draggable = true
    card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(ri)) })

    data.columns.forEach((col) => {
      if (col.id === groupCol.id) return
      const field = document.createElement('div')
      field.className = 'cm-db-cardfield'
      const label = document.createElement('div')
      label.className = 'cm-db-cardlabel'
      label.textContent = col.name
      field.appendChild(label)
      field.appendChild(this._cellEditor(col, row, (val) => { row[col.id] = val; this._commit() }))
      card.appendChild(field)
    })

    const del = document.createElement('button')
    del.className = 'cm-db-delcard'
    del.innerHTML = '×'
    del.addEventListener('click', () => {
      const idx = data.rows.indexOf(row)
      if (idx >= 0) data.rows.splice(idx, 1)
      this._commit()
    })
    card.appendChild(del)
    return card
  }

  // ── Gallery view ──────────────────────────────────────────────────────────
  _renderGallery(view) {
    const data = this.data
    const gallery = document.createElement('div')
    gallery.className = 'cm-db-gallery'

    const indexed = this._visibleRows(view || {})
    indexed.forEach(({ row, ri }) => {
      const card = document.createElement('div')
      card.className = 'cm-db-gcard'
      data.columns.forEach((col) => {
        const field = document.createElement('div')
        field.className = 'cm-db-cardfield'
        const label = document.createElement('div')
        label.className = 'cm-db-cardlabel'
        label.textContent = col.name
        field.appendChild(label)
        field.appendChild(this._cellEditor(col, row, (val) => { row[col.id] = val; this._commit() }))
        card.appendChild(field)
      })
      const del = document.createElement('button')
      del.className = 'cm-db-delcard'
      del.innerHTML = '×'
      del.addEventListener('click', () => { data.rows.splice(ri, 1); this._commit() })
      card.appendChild(del)
      gallery.appendChild(card)
    })

    const add = document.createElement('button')
    add.className = 'cm-db-gadd'
    add.innerHTML = '<i class="fas fa-plus"></i> New'
    add.addEventListener('click', () => { data.rows.push(this._blankRow()); this._commit() })
    gallery.appendChild(add)
    return gallery
  }

  // ── List view ─────────────────────────────────────────────────────────────
  _renderList(view) {
    const data = this.data
    const wrap = document.createElement('div')

    const indexed = this._visibleRows(view)
    const primary = data.columns[0]

    const renderListRow = ({ row, ri }) => {
      const rowEl = document.createElement('div')
      rowEl.className = 'cm-db-listrow'

      const main = document.createElement('div')
      main.className = 'cm-db-listmain'
      const prim = document.createElement('span')
      prim.className = 'cm-db-listprimary'
      prim.textContent = primary ? (this._cellDisplay(primary, row) || 'Untitled') : 'Untitled'
      main.appendChild(prim)

      const meta = document.createElement('div')
      meta.className = 'cm-db-listmeta'
      data.columns.slice(1).forEach((col) => {
        const m = document.createElement('span')
        m.className = 'cm-db-listmetaitem'
        if (hasOptions(col.type)) {
          const value = row[col.id]
          const names = col.type === 'multi-select'
            ? (Array.isArray(value) ? value : (value ? [value] : []))
            : (value ? [value] : [])
          if (!names.length) return
          const lab = document.createElement('b')
          lab.textContent = col.name
          m.appendChild(lab)
          names.forEach((n) => m.appendChild(this._pill(col, n)))
        } else {
          const disp = this._cellDisplay(col, row)
          if (!disp) return
          m.innerHTML = `<b>${col.name}</b>${disp}`
        }
        meta.appendChild(m)
      })
      main.appendChild(meta)

      const expanded = !!this._ui.expandedRows[ri]
      main.addEventListener('click', () => {
        this._ui.expandedRows[ri] = !expanded
        this._render()
      })
      rowEl.appendChild(main)

      if (expanded) {
        const ex = document.createElement('div')
        ex.className = 'cm-db-listexpand'
        data.columns.forEach((col) => {
          const field = document.createElement('div')
          field.className = 'cm-db-cardfield'
          const label = document.createElement('div')
          label.className = 'cm-db-cardlabel'
          label.textContent = col.name
          field.appendChild(label)
          field.appendChild(this._cellEditor(col, row, (val) => { row[col.id] = val; this._commit() }))
          ex.appendChild(field)
        })
        const del = document.createElement('button')
        del.className = 'cm-db-delrow'
        del.innerHTML = '× Delete'
        del.addEventListener('click', () => { data.rows.splice(ri, 1); this._commit() })
        ex.appendChild(del)
        rowEl.appendChild(ex)
      }
      return rowEl
    }

    const groupCol = this._colById(view.groupBy)
    const list = document.createElement('div')
    list.className = 'cm-db-list'
    if (groupCol) {
      this._groupRows(view, indexed).forEach((g) => {
        const key = `${view.id}:${g.key}`
        const collapsed = !!this._ui.collapsedGroups[key]
        const head = document.createElement('div')
        head.className = 'cm-db-grouphead' + (collapsed ? ' collapsed' : '')
        head.innerHTML = `<span class="cm-db-groupchevron">▼</span><span>${g.label || 'No ' + groupCol.name}</span><span class="cm-db-groupcount">${g.items.length}</span>`
        head.addEventListener('click', () => {
          this._ui.collapsedGroups[key] = !collapsed
          this._render()
        })
        list.appendChild(head)
        if (!collapsed) g.items.forEach(item => list.appendChild(renderListRow(item)))
      })
    } else {
      indexed.forEach(item => list.appendChild(renderListRow(item)))
    }
    wrap.appendChild(list)
    wrap.appendChild(this._renderNewRowControls('cm-db-listadd'))
    return wrap
  }

  // ── Calendar view ─────────────────────────────────────────────────────────
  _renderCalendar(view) {
    const data = this.data
    const wrap = document.createElement('div')
    wrap.className = 'cm-db-cal'

    let dateCol = this._colById(view.dateColId)
    if (!dateCol || dateCol.type !== 'date') dateCol = this._firstDateColumn()
    if (!dateCol) {
      const hint = document.createElement('div')
      hint.className = 'cm-db-calhint'
      hint.textContent = 'Add a Date column to use the calendar view.'
      wrap.appendChild(hint)
      return wrap
    }
    if (view.dateColId !== dateCol.id) view.dateColId = dateCol.id
    const dateColId = dateCol.id

    // Navigation (ephemeral month/year in this._ui).
    const nav = document.createElement('div')
    nav.className = 'cm-db-calnav'
    const prev = document.createElement('button')
    prev.innerHTML = '‹'
    prev.addEventListener('click', () => { this._shiftMonth(-1); this._render() })
    const next = document.createElement('button')
    next.innerHTML = '›'
    next.addEventListener('click', () => { this._shiftMonth(1); this._render() })
    const title = document.createElement('span')
    title.className = 'cm-db-caltitle'
    title.textContent = `${MONTHS[this._ui.calMonth]} ${this._ui.calYear}`

    // optional date-column selector when more than one date column exists
    const dateCols = data.columns.filter(c => c.type === 'date')
    nav.appendChild(prev)
    nav.appendChild(next)
    nav.appendChild(title)
    if (dateCols.length > 1) {
      const sel = document.createElement('select')
      dateCols.forEach((c) => {
        const o = document.createElement('option')
        o.value = c.id; o.textContent = c.name
        sel.appendChild(o)
      })
      sel.value = dateColId
      sel.addEventListener('change', () => { view.dateColId = sel.value; this._commit() })
      nav.appendChild(sel)
    }
    wrap.appendChild(nav)

    const grid = document.createElement('div')
    grid.className = 'cm-db-calgrid'
    ;['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => {
      const dow = document.createElement('div')
      dow.className = 'cm-db-caldow'
      dow.textContent = d
      grid.appendChild(dow)
    })

    const year = this._ui.calYear
    const month = this._ui.calMonth
    const first = new Date(year, month, 1)
    const startDow = first.getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    // Map rows to their date string for the visible month.
    const indexed = this._visibleRows(view)
    const byDate = new Map()
    indexed.forEach(({ row, ri }) => {
      const d = row[dateColId]
      if (!d) return
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d).push({ row, ri })
    })

    const pad2 = n => (n < 10 ? '0' + n : String(n))
    const primary = data.columns[0]

    // leading blanks (previous month)
    for (let i = 0; i < startDow; i += 1) {
      const cell = document.createElement('div')
      cell.className = 'cm-db-calday other'
      grid.appendChild(cell)
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const ds = `${year}-${pad2(month + 1)}-${pad2(day)}`
      const cell = document.createElement('div')
      cell.className = 'cm-db-calday'
      const num = document.createElement('div')
      num.className = 'cm-db-caldaynum'
      const lbl = document.createElement('span')
      lbl.textContent = String(day)
      num.appendChild(lbl)
      const addBtn = document.createElement('button')
      addBtn.className = 'cm-db-caldayadd'
      addBtn.innerHTML = '+'
      addBtn.title = 'New row on this day'
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const row = this._blankRow()
        row[dateColId] = ds
        data.rows.push(row)
        this._commit()
      })
      num.appendChild(addBtn)
      cell.appendChild(num)

      const rowsOnDay = byDate.get(ds) || []
      rowsOnDay.forEach(({ row, ri }) => {
        const chip = document.createElement('div')
        chip.className = 'cm-db-calchip'
        chip.textContent = primary ? (this._cellDisplay(primary, row) || 'Untitled') : 'Untitled'
        chip.title = chip.textContent
        chip.addEventListener('click', () => {
          this._ui.expandedRows[ri] = true
          // Switch to a transient inline editor via prompt-free expansion:
          this._openCalRowEditor(view, row, ri)
        })
        cell.appendChild(chip)
      })
      grid.appendChild(cell)
    }
    wrap.appendChild(grid)

    // Inline editor area for a clicked calendar row.
    if (this._ui.calEditRi != null && data.rows[this._ui.calEditRi]) {
      wrap.appendChild(this._renderCalEditor(data.rows[this._ui.calEditRi], this._ui.calEditRi))
    }
    return wrap
  }

  _openCalRowEditor(view, row, ri) {
    this._ui.calEditRi = (this._ui.calEditRi === ri ? null : ri)
    this._render()
  }

  _renderCalEditor(row, ri) {
    const data = this.data
    const box = document.createElement('div')
    box.className = 'cm-db-listexpand'
    data.columns.forEach((col) => {
      const field = document.createElement('div')
      field.className = 'cm-db-cardfield'
      const label = document.createElement('div')
      label.className = 'cm-db-cardlabel'
      label.textContent = col.name
      field.appendChild(label)
      field.appendChild(this._cellEditor(col, row, (val) => { row[col.id] = val; this._commit() }))
      box.appendChild(field)
    })
    const del = document.createElement('button')
    del.className = 'cm-db-delrow'
    del.innerHTML = '× Delete'
    del.addEventListener('click', () => {
      data.rows.splice(ri, 1)
      this._ui.calEditRi = null
      this._commit()
    })
    box.appendChild(del)
    return box
  }

  _shiftMonth(delta) {
    let m = this._ui.calMonth + delta
    let y = this._ui.calYear
    while (m < 0) { m += 12; y -= 1 }
    while (m > 11) { m -= 12; y += 1 }
    this._ui.calMonth = m
    this._ui.calYear = y
  }

  // ── Chart view ─────────────────────────────────────────────────────────────
  _renderChartView(view) {
    const data = this.data
    const wrap = document.createElement('div')

    // Toolbar: chart type / group column / value column / aggregation.
    const tb = document.createElement('div')
    tb.className = 'cm-db-chart-toolbar'

    const mkSelect = (label, options, value, onChange) => {
      const l = document.createElement('label')
      l.appendChild(document.createTextNode(label))
      const sel = document.createElement('select')
      options.forEach(([v, t]) => {
        const o = document.createElement('option')
        o.value = v; o.textContent = t
        sel.appendChild(o)
      })
      sel.value = value
      sel.addEventListener('change', () => onChange(sel.value))
      l.appendChild(sel)
      return l
    }

    tb.appendChild(mkSelect('Type', [['bar', 'Bar'], ['line', 'Line'], ['pie', 'Pie']],
      view.chartType || 'bar', (v) => { view.chartType = v; this._commit() }))

    const colOpts = data.columns.map(c => [c.id, c.name])
    tb.appendChild(mkSelect('Group by', colOpts.length ? colOpts : [['', '—']],
      view.groupColId || (data.columns[0]?.id ?? ''), (v) => { view.groupColId = v; this._commit() }))

    tb.appendChild(mkSelect('Measure', [['count', 'Count']].concat([['sum', 'Sum'], ['avg', 'Average']]),
      view.agg || 'count', (v) => { view.agg = v; this._commit() }))

    if (view.agg && view.agg !== 'count') {
      const numCols = data.columns.filter(c => ['number', 'formula', 'rollup'].includes(c.type))
      tb.appendChild(mkSelect('of', numCols.length ? numCols.map(c => [c.id, c.name]) : [['', '—']],
        view.valueColId || (numCols[0]?.id ?? ''), (v) => { view.valueColId = v; this._commit() }))
    }
    wrap.appendChild(tb)

    const groupCol = this._colById(view.groupColId) || data.columns[0]
    if (!groupCol) {
      const hint = document.createElement('div')
      hint.className = 'cm-db-chart-hint'
      hint.textContent = 'Add a column to group by, then pick it above.'
      wrap.appendChild(hint)
      return wrap
    }

    const series = this._chartSeries(view, groupCol)
    const aggLabel = view.agg === 'count'
      ? `Count of rows by ${groupCol.name}`
      : `${view.agg === 'avg' ? 'Average' : 'Sum'} of ${this._colById(view.valueColId)?.name || '?'} by ${groupCol.name}`
    wrap.appendChild(renderChart({
      chartType: view.chartType || 'bar',
      series,
      valueLabel: aggLabel,
    }))
    return wrap
  }

  // Compute [{label,value}] by grouping the view's visible rows on groupCol and
  // aggregating valueCol (or counting). Respects the view's filters via
  // _visibleRows. Multi-select group values fan a row out across each value.
  _chartSeries(view, groupCol) {
    const indexed = this._visibleRows(view)
    const valueCol = view.agg && view.agg !== 'count' ? this._colById(view.valueColId) : null
    const buckets = new Map() // label -> { sum, count }
    const add = (label, num) => {
      if (!buckets.has(label)) buckets.set(label, { sum: 0, count: 0 })
      const b = buckets.get(label)
      b.count += 1
      if (num != null && !Number.isNaN(num)) b.sum += num
    }
    indexed.forEach(({ row }) => {
      const gv = row[groupCol.id]
      const labels = groupCol.type === 'multi-select'
        ? (Array.isArray(gv) ? gv : (gv ? [gv] : []))
        : [(gv == null || gv === '') ? '(empty)' : String(gv)]
      const finalLabels = labels.length ? labels : ['(empty)']
      let num = null
      if (valueCol) {
        const raw = this._calcRaw(valueCol, row)
        num = parseFloat(raw)
      }
      finalLabels.forEach(l => add(l, num))
    })
    return Array.from(buckets.entries()).map(([label, b]) => ({
      label,
      value: view.agg === 'sum' ? this._trim(b.sum)
        : view.agg === 'avg' ? this._trim(b.count ? b.sum / b.count : 0)
          : b.count,
    }))
  }

  // ── Timeline / Gantt view ──────────────────────────────────────────────────
  _renderTimeline(view) {
    const data = this.data
    const wrap = document.createElement('div')
    wrap.className = 'cm-db-tl'

    const dateCols = data.columns.filter(c => c.type === 'date')
    if (!dateCols.length) {
      const hint = document.createElement('div')
      hint.className = 'cm-db-tl-hint'
      hint.textContent = 'Add a Date column to use the timeline view.'
      wrap.appendChild(hint)
      return wrap
    }
    let startCol = this._colById(view.startColId)
    if (!startCol || startCol.type !== 'date') { startCol = dateCols[0]; view.startColId = startCol.id }
    let endCol = view.endColId ? this._colById(view.endColId) : null
    if (endCol && endCol.type !== 'date') endCol = null

    // Toolbar: start / end column pickers + zoom.
    const tb = document.createElement('div')
    tb.className = 'cm-db-tl-toolbar'
    const mkColSel = (label, value, allowNone, onChange) => {
      const l = document.createElement('label')
      l.appendChild(document.createTextNode(label))
      const sel = document.createElement('select')
      if (allowNone) {
        const o = document.createElement('option'); o.value = ''; o.textContent = '— none'
        sel.appendChild(o)
      }
      dateCols.forEach((c) => {
        const o = document.createElement('option'); o.value = c.id; o.textContent = c.name
        sel.appendChild(o)
      })
      sel.value = value || ''
      sel.addEventListener('change', () => onChange(sel.value || null))
      l.appendChild(sel)
      return l
    }
    tb.appendChild(mkColSel('Start', view.startColId, false, (v) => { view.startColId = v; this._commit() }))
    tb.appendChild(mkColSel('End', view.endColId, true, (v) => { view.endColId = v; this._commit() }))

    const zoomOut = document.createElement('button')
    zoomOut.textContent = '−'
    zoomOut.title = 'Show more months'
    zoomOut.addEventListener('click', () => { this._ui.tlMonths = Math.min(12, this._ui.tlMonths + 1); this._render() })
    const zoomIn = document.createElement('button')
    zoomIn.textContent = '+'
    zoomIn.title = 'Show fewer months'
    zoomIn.addEventListener('click', () => { this._ui.tlMonths = Math.max(1, this._ui.tlMonths - 1); this._render() })
    const panL = document.createElement('button')
    panL.textContent = '‹'
    panL.addEventListener('click', () => { this._ui.tlOffset -= 1; this._render() })
    const panR = document.createElement('button')
    panR.textContent = '›'
    panR.addEventListener('click', () => { this._ui.tlOffset += 1; this._render() })
    tb.appendChild(panL); tb.appendChild(zoomOut); tb.appendChild(zoomIn); tb.appendChild(panR)
    wrap.appendChild(tb)

    const indexed = this._visibleRows(view).filter(({ row }) => row[startCol.id])
    if (!indexed.length) {
      const hint = document.createElement('div')
      hint.className = 'cm-db-tl-hint'
      hint.textContent = 'No rows with a start date to plot.'
      wrap.appendChild(hint)
      return wrap
    }

    // Visible window: anchor at the earliest start date's month + offset.
    const parse = s => { const d = new Date(s + 'T00:00:00'); return Number.isNaN(d.getTime()) ? null : d }
    const starts = indexed.map(({ row }) => parse(row[startCol.id])).filter(Boolean)
    const minDate = starts.reduce((a, b) => (a < b ? a : b), starts[0])
    const anchor = new Date(minDate.getFullYear(), minDate.getMonth() + this._ui.tlOffset, 1)
    const months = this._ui.tlMonths
    const winStart = anchor
    const winEnd = new Date(anchor.getFullYear(), anchor.getMonth() + months, 1)
    const totalDays = Math.round((winEnd - winStart) / 86400000)
    const colW = 26 // px per day

    const scroll = document.createElement('div')
    scroll.className = 'cm-db-tl-scroll'
    const grid = document.createElement('div')
    grid.className = 'cm-db-tl-grid'
    grid.style.width = (totalDays * colW) + 'px'

    // Month axis.
    const axis = document.createElement('div')
    axis.className = 'cm-db-tl-axis'
    for (let m = 0; m < months; m += 1) {
      const md = new Date(anchor.getFullYear(), anchor.getMonth() + m, 1)
      const dim = new Date(md.getFullYear(), md.getMonth() + 1, 0).getDate()
      const cell = document.createElement('div')
      cell.className = 'cm-db-tl-axiscell'
      cell.style.width = (dim * colW) + 'px'
      cell.textContent = `${MONTHS[md.getMonth()].slice(0, 3)} ${md.getFullYear()}`
      axis.appendChild(cell)
    }
    grid.appendChild(axis)

    const primary = data.columns[0]
    const rowsEl = document.createElement('div')
    rowsEl.className = 'cm-db-tl-rows'
    indexed.forEach(({ row, ri }) => {
      const sd = parse(row[startCol.id])
      if (!sd) return
      const ed = endCol && row[endCol.id] ? parse(row[endCol.id]) : sd
      const endD = (ed && ed >= sd) ? ed : sd
      const offDays = Math.round((sd - winStart) / 86400000)
      const spanDays = Math.max(1, Math.round((endD - sd) / 86400000) + 1)
      const rowEl = document.createElement('div')
      rowEl.className = 'cm-db-tl-row'
      // clip to window
      if (offDays + spanDays > 0 && offDays < totalDays) {
        const left = Math.max(0, offDays) * colW
        const widthDays = Math.min(spanDays + Math.min(0, offDays), totalDays - Math.max(0, offDays))
        const bar = document.createElement('div')
        bar.className = 'cm-db-tl-bar'
        bar.style.left = left + 'px'
        bar.style.width = Math.max(colW, widthDays * colW - 2) + 'px'
        bar.textContent = primary ? (this._cellDisplay(primary, row) || 'Untitled') : 'Untitled'
        bar.title = `${row[startCol.id]}${endCol && row[endCol.id] ? ' → ' + row[endCol.id] : ''}`
        bar.addEventListener('click', () => {
          this._ui.tlEditRi = this._ui.tlEditRi === ri ? null : ri
          this._render()
        })
        rowEl.appendChild(bar)
      }
      rowsEl.appendChild(rowEl)
    })
    grid.appendChild(rowsEl)
    scroll.appendChild(grid)
    wrap.appendChild(scroll)

    // Inline editor for a clicked bar.
    if (this._ui.tlEditRi != null && data.rows[this._ui.tlEditRi]) {
      wrap.appendChild(this._renderInlineRowEditor(data.rows[this._ui.tlEditRi], this._ui.tlEditRi, () => {
        this._ui.tlEditRi = null
      }))
    }
    return wrap
  }

  // Generic inline row editor (used by timeline). Mirrors the calendar editor.
  _renderInlineRowEditor(row, ri, onDelete) {
    const data = this.data
    const box = document.createElement('div')
    box.className = 'cm-db-listexpand'
    data.columns.forEach((col) => {
      const field = document.createElement('div')
      field.className = 'cm-db-cardfield'
      const label = document.createElement('div')
      label.className = 'cm-db-cardlabel'
      label.textContent = col.name
      field.appendChild(label)
      field.appendChild(this._cellEditor(col, row, (val) => { row[col.id] = val; this._commit() }))
      box.appendChild(field)
    })
    const del = document.createElement('button')
    del.className = 'cm-db-delrow'
    del.innerHTML = '× Delete'
    del.addEventListener('click', () => {
      data.rows.splice(ri, 1)
      if (onDelete) onDelete()
      this._commit()
    })
    box.appendChild(del)
    return box
  }

  // ── View toolbar: Filter / Sort / Group-by controls ───────────────────────
  _renderToolbar(view) {
    const bar = document.createElement('div')
    bar.className = 'cm-db-toolbar'

    // Filter
    this._toolbarPopover(bar, 'filter', 'filter', 'Filter',
      (view.filters || []).length, () => this._renderFilterPanel(view))
    // Sort
    this._toolbarPopover(bar, 'sort', 'sort', 'Sort',
      (view.sorts || []).length, () => this._renderSortPanel(view))

    // Group-by (table & list only; board groups by its own column)
    if (view.type === 'table' || view.type === 'list') {
      const btn = document.createElement('button')
      btn.className = 'cm-db-tbtn' + (view.groupBy ? ' active' : '')
      btn.innerHTML = '<i class="fas fa-layer-group"></i> Group'
      const sel = document.createElement('select')
      sel.className = 'cm-db-calcsel'
      sel.style.marginLeft = '4px'
      const none = document.createElement('option')
      none.value = ''; none.textContent = 'No grouping'
      sel.appendChild(none)
      this.data.columns.forEach((c) => {
        const o = document.createElement('option')
        o.value = c.id; o.textContent = c.name
        sel.appendChild(o)
      })
      sel.value = view.groupBy || ''
      sel.addEventListener('change', () => {
        view.groupBy = sel.value || null
        this._commit()
      })
      btn.addEventListener('click', () => sel.focus())
      bar.appendChild(btn)
      bar.appendChild(sel)
    }
    return bar
  }

  // Appends a toolbar button to `bar`, plus (when open) its full-width
  // in-flow panel so the .cm-db overflow:hidden never clips it.
  _toolbarPopover(bar, key, icon, label, count, buildPanel) {
    const btn = document.createElement('button')
    btn.className = 'cm-db-tbtn' + (count ? ' active' : '')
    btn.innerHTML = `<i class="fas fa-${icon}"></i> ${label}` + (count ? ` <span class="cm-db-badge">${count}</span>` : '')
    btn.addEventListener('click', () => {
      this._ui.openPopover = this._ui.openPopover === key ? null : key
      this._render()
    })
    bar.appendChild(btn)
    if (this._ui.openPopover === key) bar.appendChild(buildPanel())
  }

  _renderFilterPanel(view) {
    const pop = document.createElement('div')
    pop.className = 'cm-db-pop cm-db-filterpop'
    if (!Array.isArray(view.filters)) view.filters = []

    view.filters.forEach((f, i) => {
      const row = document.createElement('div')
      row.className = 'cm-db-poprow'

      if (i === 0) {
        const lbl = document.createElement('span')
        lbl.className = 'cm-db-popconj'
        lbl.textContent = 'Where'
        row.appendChild(lbl)
      } else if (i === 1) {
        const cj = document.createElement('select')
        cj.className = 'cm-db-popconj'
        ;['and', 'or'].forEach((c) => {
          const o = document.createElement('option')
          o.value = c; o.textContent = c
          cj.appendChild(o)
        })
        cj.value = view.conjunction === 'or' ? 'or' : 'and'
        cj.addEventListener('change', () => { view.conjunction = cj.value; this._commit() })
        row.appendChild(cj)
      } else {
        const lbl = document.createElement('span')
        lbl.className = 'cm-db-popconj'
        lbl.textContent = view.conjunction === 'or' ? 'or' : 'and'
        row.appendChild(lbl)
      }

      // column selector
      const colSel = document.createElement('select')
      this.data.columns.forEach((c) => {
        const o = document.createElement('option')
        o.value = c.id; o.textContent = c.name
        colSel.appendChild(o)
      })
      colSel.value = f.colId
      colSel.addEventListener('change', () => {
        f.colId = colSel.value
        const fam = filterFamily(this._colById(f.colId)?.type)
        f.op = FILTER_OPS[fam][0].value
        this._commit()
      })
      row.appendChild(colSel)

      // op selector
      const col = this._colById(f.colId)
      const fam = filterFamily(col?.type)
      const opSel = document.createElement('select')
      FILTER_OPS[fam].forEach((op) => {
        const o = document.createElement('option')
        o.value = op.value; o.textContent = op.label
        opSel.appendChild(o)
      })
      opSel.value = f.op
      opSel.addEventListener('change', () => { f.op = opSel.value; this._commit() })
      row.appendChild(opSel)

      // value input (hidden for ops that need no value)
      const noVal = ['empty', 'not_empty', 'checked', 'unchecked'].includes(f.op)
      if (!noVal) {
        let valInput
        if (fam === 'select' && Array.isArray(col?.options)) {
          valInput = document.createElement('select')
          col.options.forEach((o) => {
            const op = document.createElement('option')
            op.value = o; op.textContent = o
            valInput.appendChild(op)
          })
        } else {
          valInput = document.createElement('input')
          valInput.type = fam === 'number' ? 'number' : (fam === 'date' ? 'date' : 'text')
        }
        valInput.value = f.value != null ? f.value : ''
        valInput.addEventListener('change', () => { f.value = valInput.value; this._commit() })
        row.appendChild(valInput)
      }

      const rm = document.createElement('button')
      rm.className = 'cm-db-popx'
      rm.innerHTML = '×'
      rm.addEventListener('click', () => { view.filters.splice(i, 1); this._commit() })
      row.appendChild(rm)
      pop.appendChild(row)
    })

    const add = document.createElement('button')
    add.className = 'cm-db-popadd'
    add.textContent = '+ Add filter'
    add.addEventListener('click', () => {
      const col = this.data.columns[0]
      if (!col) return
      const fam = filterFamily(col.type)
      view.filters.push({ colId: col.id, op: FILTER_OPS[fam][0].value, value: '' })
      this._commit()
    })
    pop.appendChild(add)
    return pop
  }

  _renderSortPanel(view) {
    const pop = document.createElement('div')
    pop.className = 'cm-db-pop cm-db-sortpop'
    if (!Array.isArray(view.sorts)) view.sorts = []

    view.sorts.forEach((s, i) => {
      const row = document.createElement('div')
      row.className = 'cm-db-poprow'
      const colSel = document.createElement('select')
      this.data.columns.forEach((c) => {
        const o = document.createElement('option')
        o.value = c.id; o.textContent = c.name
        colSel.appendChild(o)
      })
      colSel.value = s.colId
      colSel.addEventListener('change', () => { s.colId = colSel.value; this._commit() })
      row.appendChild(colSel)

      const dirSel = document.createElement('select')
      ;[['asc', 'Ascending'], ['desc', 'Descending']].forEach(([v, l]) => {
        const o = document.createElement('option')
        o.value = v; o.textContent = l
        dirSel.appendChild(o)
      })
      dirSel.value = s.dir === 'desc' ? 'desc' : 'asc'
      dirSel.addEventListener('change', () => { s.dir = dirSel.value; this._commit() })
      row.appendChild(dirSel)

      const rm = document.createElement('button')
      rm.className = 'cm-db-popx'
      rm.innerHTML = '×'
      rm.addEventListener('click', () => { view.sorts.splice(i, 1); this._commit() })
      row.appendChild(rm)
      pop.appendChild(row)
    })

    const add = document.createElement('button')
    add.className = 'cm-db-popadd'
    add.textContent = '+ Add sort'
    add.addEventListener('click', () => {
      const col = this.data.columns[0]
      if (!col) return
      view.sorts.push({ colId: col.id, dir: 'asc' })
      this._commit()
    })
    pop.appendChild(add)
    return pop
  }
}
