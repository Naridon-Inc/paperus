// Import data into Notionless.
//
// Two import paths, both work on Electron and web:
//   1. CSV  -> a Notionless ```database fenced block inserted into the current
//      document (at the cursor via the CodeMirror view, or appended to the
//      Y.Text if no cursor is available).
//   2. Markdown (.md) -> a new note created via the host's existing create-file
//      path (createNewNote), so we REUSE main.js's importer rather than
//      duplicating it.
//
// File selection uses a hidden <input type="file"> which works on both targets
// (no Electron-only dialog IPC needed). This module is additive and injects no
// CSS of its own beyond reusing the shared popover style from export.js (guarded
// by id) — the import menu reuses the .exim-* classes.

const STYLE_ID = 'export-import-styles'

/** Ensure the shared popover CSS exists (mirrors export.js; guarded by id). */
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .exim-popover {
      position: fixed; z-index: 100000; min-width: 200px; background: #fff;
      border: 1px solid #e3e3e3; border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.18); padding: 6px; font-size: 14px; color: #333;
    }
    .exim-popover .exim-title { font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.04em; color: #999; padding: 6px 10px 4px; }
    .exim-popover .exim-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px;
      border-radius: 6px; cursor: pointer; user-select: none; }
    .exim-popover .exim-item:hover { background: #f3f3f2; }
    .exim-popover .exim-item i { width: 16px; text-align: center; color: #888; }
    .exim-popover .exim-sub { font-size: 12px; color: #aaa; margin-left: auto; }
  `
  document.head.appendChild(style)
}

/**
 * Parse CSV text into a 2D array of strings. Handles:
 *   - quoted fields ("...")
 *   - commas inside quotes
 *   - newlines (\n and \r\n) inside quotes
 *   - escaped quotes ("")
 * Returns an array of rows; each row is an array of cell strings.
 */
export function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  while (i < n) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false
        i += 1
        continue
      }
      field += c
      i += 1
      continue
    }

    if (c === '"') { inQuotes = true; i += 1; continue }
    if (c === ',') { row.push(field); field = ''; i += 1; continue }
    if (c === '\r') { i += 1; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue }
    field += c
    i += 1
  }
  // Flush final field/row (unless the file ended on a clean newline with no trailing data).
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Convert parsed CSV rows into a Notionless database-fence markdown block.
 * First row is treated as the header. Column types are kept as 'text' for v1.
 * Rows are objects keyed by column id (matching database-widget.js format).
 */
export function csvToDatabaseFence(parsedRows, dbName = 'Imported CSV') {
  const nonEmpty = parsedRows.filter((r) => r.some((cell) => String(cell).trim() !== ''))
  if (nonEmpty.length === 0) {
    // Empty CSV -> minimal empty table
    const empty = {
      name: dbName,
      columns: [{ id: 'c1', name: 'Column 1', type: 'text' }],
      rows: [],
      views: [{ id: 'v1', name: 'Table', type: 'table' }],
      activeView: 'v1',
    }
    return '```database\n' + JSON.stringify(empty, null, 2) + '\n```'
  }

  const header = nonEmpty[0]
  const columns = header.map((name, idx) => ({
    id: `c${idx + 1}`,
    name: String(name).trim() || `Column ${idx + 1}`,
    type: 'text',
  }))

  const rows = nonEmpty.slice(1).map((cells) => {
    const obj = {}
    columns.forEach((col, idx) => {
      obj[col.id] = cells[idx] != null ? String(cells[idx]) : ''
    })
    return obj
  })

  const data = {
    name: dbName,
    columns,
    rows,
    views: [{ id: 'v1', name: 'Table', type: 'table' }],
    activeView: 'v1',
  }
  return '```database\n' + JSON.stringify(data, null, 2) + '\n```'
}

/** Read a File object as UTF-8 text. */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

/**
 * Open a hidden file picker and resolve to { name, text } for the chosen file,
 * or null if cancelled. Works on Electron and web (uses the DOM file input,
 * which is available in both renderers).
 */
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    let settled = false
    const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input) }
    input.onchange = async () => {
      if (settled) return
      settled = true
      const file = input.files && input.files[0]
      cleanup()
      if (!file) { resolve(null); return }
      try {
        const text = await readFileAsText(file)
        resolve({ name: file.name, text })
      } catch (e) {
        console.error('[Import] read failed:', e)
        resolve(null)
      }
    }
    // No reliable cross-browser cancel event; rely on change. Click to open.
    input.click()
  })
}

/**
 * ImportManager — opens a popover offering CSV -> database and Markdown -> new
 * note imports.
 *
 * @param {object} opts
 * @param {() => any} opts.getCmView         Returns the active CodeMirror EditorView (or null).
 * @param {() => any} opts.getDocEngine      Returns the active DocumentEngine (or null).
 * @param {(content: string) => Promise<void>} opts.createNote
 *        Host callback that creates+opens a new note from markdown content
 *        (reuses main.js's createNewNote).
 */
export class ImportManager {
  constructor({ getCmView, getDocEngine, createNote } = {}) {
    this.getCmView = getCmView || (() => null)
    this.getDocEngine = getDocEngine || (() => null)
    this.createNote = createNote || (async () => {})
    this.el = null
    ensureStyles()
    this._onDocMouseDown = this._onDocMouseDown.bind(this)
  }

  open(anchorEl) {
    this.close()
    ensureStyles()
    const pop = document.createElement('div')
    pop.className = 'exim-popover'
    pop.innerHTML = `
      <div class="exim-title">Import</div>
      <div class="exim-item" data-kind="csv"><i class="fas fa-table"></i> CSV as database <span class="exim-sub">.csv</span></div>
      <div class="exim-item" data-kind="md"><i class="fas fa-file-alt"></i> Markdown as note <span class="exim-sub">.md</span></div>
    `
    document.body.appendChild(pop)
    this.el = pop

    if (anchorEl && anchorEl.getBoundingClientRect) {
      const r = anchorEl.getBoundingClientRect()
      let left = r.left
      const popWidth = 230
      if (left + popWidth > window.innerWidth) left = window.innerWidth - popWidth - 8
      pop.style.top = `${r.bottom + 6}px`
      pop.style.left = `${Math.max(8, left)}px`
    } else {
      pop.style.top = '52px'
      pop.style.right = '16px'
    }

    pop.querySelectorAll('.exim-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const kind = item.dataset.kind
        this.close()
        try {
          if (kind === 'csv') await this.importCSV()
          else if (kind === 'md') await this.importMarkdown()
        } catch (e) {
          console.error('[Import] failed:', e)
          alert('Import failed: ' + (e && e.message ? e.message : e))
        }
      })
    })

    setTimeout(() => document.addEventListener('mousedown', this._onDocMouseDown, true), 0)
  }

  _onDocMouseDown(e) {
    if (this.el && !this.el.contains(e.target)) this.close()
  }

  close() {
    document.removeEventListener('mousedown', this._onDocMouseDown, true)
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el)
    this.el = null
  }

  /**
   * CSV import: pick a .csv, convert to a database fence, and insert it into
   * the current document. Inserts at the cursor via the CodeMirror view when
   * available; otherwise appends to the Y.Text so the change still syncs.
   */
  async importCSV() {
    const picked = await pickFile('.csv,text/csv')
    if (!picked) return

    const parsed = parseCSV(picked.text)
    const dbName = picked.name.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported CSV'
    const fence = csvToDatabaseFence(parsed, dbName)

    const cmView = this.getCmView()
    const docEngine = this.getDocEngine()

    if (cmView && cmView.state) {
      // Insert at cursor on its own lines, mirroring createSubPage in main.js.
      const pos = cmView.state.selection.main.head
      const line = cmView.state.doc.lineAt(pos)
      const prefix = line.text.trim().length > 0 ? '\n\n' : ''
      const insert = `${prefix}${fence}\n`
      cmView.dispatch({
        changes: { from: pos, insert },
        selection: { anchor: pos + insert.length },
      })
      cmView.focus()
    } else if (docEngine && docEngine.text) {
      // Fallback: append to the Y.Text (used when no editor view is bound).
      const yText = docEngine.text
      const existing = yText.toString()
      const prefix = existing.trim().length > 0 ? '\n\n' : ''
      const insert = `${prefix}${fence}\n`
      docEngine.doc.transact(() => {
        yText.insert(yText.length, insert)
      }, 'import-csv')
    } else {
      // No open document — create a fresh note containing the database.
      await this.createNote(`# ${dbName}\n\n${fence}\n`)
      return
    }

    const rowCount = Math.max(0, parsed.filter((r) => r.some((c) => String(c).trim() !== '')).length - 1)
    const statusEl = document.getElementById('file-status')
    if (statusEl) {
      const prev = statusEl.textContent
      statusEl.textContent = `Imported ${rowCount} row${rowCount === 1 ? '' : 's'} from CSV`
      setTimeout(() => { statusEl.textContent = prev }, 2000)
    }
  }

  /**
   * Markdown import: pick a .md file and create a new note from its content,
   * reusing the host's createNewNote path.
   */
  async importMarkdown() {
    const picked = await pickFile('.md,.markdown,.txt,text/markdown')
    if (!picked) return
    let content = picked.text
    if (!content || !content.trim()) {
      const base = picked.name.replace(/\.(md|markdown|txt)$/i, '')
      content = `# ${base}\n`
    }
    await this.createNote(content)
  }
}
