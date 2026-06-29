/**
 * Page properties — a Notion/Obsidian-style key→value table for the open
 * document's YAML front-matter, shown directly under the page title and above
 * the body. Lets users add, rename, edit and remove simple `key: value`
 * metadata (e.g. agent-skill `name`/`description`/`tools`, system-prompt
 * profiles) without hand-editing the raw `---` block — which stays hidden in the
 * editor by the live-preview decorations (cm-hide-markers.js).
 *
 * Mirrors PageHeader / PageOptions: owns no global state, reads/writes the doc
 * through a `getEngine` callback, and is driven by main.js which calls
 * `render()` after each doc load and `clear()` when the doc closes.
 *
 * Reserved keys (icon, cover, width, locked) are managed by their own UI
 * (PageHeader, PageOptions) so they're hidden from this table — but always
 * preserved on write, since every save re-reads them from the live document.
 */
import { parseFrontmatter, getFrontmatterValue } from './frontmatter'

// Front-matter keys that have dedicated controls elsewhere. Hidden from the
// properties table, never dropped (re-read from the doc on every write).
const RESERVED = new Set(['icon', 'cover', 'width', 'locked'])

/** Serialise one key/value line, quoting only when YAML would need it. Unlike
 *  the shared serializeFrontmatter, this keeps empty-valued keys (`key:`) so a
 *  freshly-added property persists before you fill in its value. */
function fmLine(key, value) {
  const v = String(value == null ? '' : value)
  if (v === '') return `${key}:`
  const needsQuote = /[:#"'\n]/.test(v) || /^\s|\s$/.test(v)
  return `${key}: ${needsQuote ? JSON.stringify(v) : v}`
}

export class PageProperties {
  constructor(container, { getEngine } = {}) {
    this.getEngine = getEngine || (() => null)
    this._engine = null // captured at render() so writes target the right doc
    this._writeTimer = null

    this.el = document.createElement('div')
    this.el.className = 'page-properties'
    this.el.style.display = 'none'

    // Sit between the page header/title and the editor body.
    const editor = container.querySelector('#editor')
    if (editor) container.insertBefore(this.el, editor)
    else container.appendChild(this.el)
  }

  clear() {
    // Persist anything still pending to the doc we were editing, then reset.
    this._flush()
    this._engine = null
    this.el.style.display = 'none'
    this.el.innerHTML = ''
    this._rowsWrap = null
    this._emptyAdd = null
  }

  /** Rebuild the table from the current document's front-matter. */
  render() {
    const engine = this.getEngine()
    this._engine = engine
    if (!engine || !engine.text) { this.clear(); return }

    const text = engine.text.toString()
    const { data } = parseFrontmatter(text)
    this._locked = (() => {
      const v = getFrontmatterValue(text, 'locked')
      return v === true || v === 'true'
    })()

    const entries = Object.keys(data)
      .filter((k) => !RESERVED.has(k))
      .map((k) => [k, data[k]])

    this.el.innerHTML = ''
    this.el.style.display = 'block'

    this._rowsWrap = document.createElement('div')
    this._rowsWrap.className = 'pp-rows'
    this.el.appendChild(this._rowsWrap)
    entries.forEach(([k, v]) => this._addRow(k, v))

    // Footer "Add property" — a full row when properties exist, otherwise a
    // single faint affordance that surfaces on hover so clean docs stay clean.
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'pp-add' + (entries.length ? '' : ' pp-add-empty')
    add.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span>Add property</span>'
    add.addEventListener('click', () => {
      add.classList.remove('pp-add-empty')
      const row = this._addRow('', '')
      const keyEl = row.querySelector('.pp-key')
      if (keyEl) keyEl.focus()
    })
    this._emptyAdd = add
    if (this._locked) add.style.display = 'none'
    this.el.appendChild(add)
  }

  /** Append one editable property row; returns the row element. */
  _addRow(key, value) {
    const row = document.createElement('div')
    row.className = 'pp-row'

    const keyEl = document.createElement('input')
    keyEl.type = 'text'
    keyEl.className = 'pp-key'
    keyEl.value = key
    keyEl.placeholder = 'Property'
    keyEl.spellcheck = false

    const valEl = document.createElement('input')
    valEl.type = 'text'
    valEl.className = 'pp-val'
    valEl.value = value == null ? '' : String(value)
    valEl.placeholder = 'Empty'
    valEl.spellcheck = false

    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'pp-del'
    del.title = 'Remove property'
    del.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
    del.addEventListener('click', () => {
      row.remove()
      this._write()
    })

    if (this._locked) {
      keyEl.readOnly = true
      valEl.readOnly = true
      del.style.display = 'none'
    }

    keyEl.addEventListener('input', () => this._scheduleWrite())
    valEl.addEventListener('input', () => this._scheduleWrite())
    keyEl.addEventListener('blur', () => this._onBlur(row))
    valEl.addEventListener('blur', () => this._onBlur(row))

    // Keyboard flow: Enter in the key jumps to its value; Enter in the value
    // commits and opens a fresh row (Notion-style).
    keyEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); valEl.focus() }
    })
    valEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this._write()
        const fresh = this._addRow('', '')
        const k = fresh.querySelector('.pp-key')
        if (k) k.focus()
      }
    })

    row.appendChild(keyEl)
    row.appendChild(valEl)
    row.appendChild(del)
    this._rowsWrap.appendChild(row)
    return row
  }

  /** Drop a row left completely empty on blur, then persist. */
  _onBlur(row) {
    const keyEl = row.querySelector('.pp-key')
    const valEl = row.querySelector('.pp-val')
    if (keyEl && valEl && !keyEl.value.trim() && !valEl.value.trim()) row.remove()
    this._flush()
  }

  _scheduleWrite() {
    if (this._writeTimer) clearTimeout(this._writeTimer)
    this._writeTimer = setTimeout(() => this._write(), 250)
  }

  _flush() {
    if (this._writeTimer) { clearTimeout(this._writeTimer); this._writeTimer = null }
    this._write()
  }

  /**
   * Rebuild the front-matter block = reserved keys (re-read live, so PageHeader
   * icon/cover edits are never clobbered) + the current table rows, and apply it
   * as one minimal edit at the top of the Yjs text.
   */
  _write() {
    this._writeTimer = null
    const engine = this._engine
    if (!engine || !engine.text) return
    if (this._locked) return

    let current
    try { current = engine.text.toString() } catch { return } // engine torn down
    const { data, end } = parseFrontmatter(current)

    const lines = []
    RESERVED.forEach((k) => {
      if (data[k] != null && data[k] !== '') lines.push(fmLine(k, data[k]))
    })
    const seen = new Set(RESERVED)
    if (this._rowsWrap) {
      this._rowsWrap.querySelectorAll('.pp-row').forEach((row) => {
        const k = row.querySelector('.pp-key').value.trim()
        const v = row.querySelector('.pp-val').value
        if (!k || seen.has(k)) return // skip blank or duplicate / reserved keys
        seen.add(k)
        lines.push(fmLine(k, v))
      })
    }

    const fm = lines.length ? `---\n${lines.join('\n')}\n---\n` : ''
    const body = current.slice(end)
    if (fm + body === current) return // no change → no churn

    try {
      engine.doc.transact(() => {
        engine.text.delete(0, end)
        if (fm) engine.text.insert(0, fm)
      }, 'page-frontmatter')
    } catch (e) {
      console.warn('[PageProperties] write failed:', e)
    }
  }
}
