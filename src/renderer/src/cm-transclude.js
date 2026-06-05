/**
 * Page transclusion (block embed) for the CodeMirror 6 markdown editor.
 *
 * A line that is exactly `![[Page Name]]` renders the referenced page's content
 * inline, READ-ONLY, inside a bordered box with a clickable title header.
 *
 * Resolution mirrors main.js's resolveWikiTitle: list the project's markdown
 * files (`fs:listMarkdownFilesRecursive` on the project root) and match by file
 * basename variants (raw / underscores→spaces, case-insensitive), then read the
 * file with `fs:readFile`. Both are async, so the widget paints a placeholder
 * synchronously in toDOM and fills it in when the read resolves (same pattern as
 * the inline ImageWidget).
 *
 * Clicking the header dispatches the existing `cmd:open-page` window event with
 * `{ kind:'wiki', value:title }`, so main.js opens/creates the page.
 *
 * SCOPE: this is READ-ONLY transclusion. The embedded content is a one-way,
 * lightly-formatted snapshot of the source page at render time — there is NO
 * bidirectional sync, and editing happens only by opening the source page. The
 * markdown is rendered as plain lines with minimal inline formatting (the
 * referenced page's own block widgets are intentionally not re-run).
 *
 * WEB GUARD: under the web build there is no `window.api`; the widget then shows
 * a graceful "transclusion unavailable" note instead of attempting a read.
 */
import { WidgetType } from '@codemirror/view'

// A whole line that is exactly ![[Page Name]] (optionally with surrounding ws).
export const TRANSCLUDE_RE = /^\s*!\[\[([^\[\]|#]+?)(?:#[^\[\]|]*)?\]\]\s*$/

/** Resolve a wiki title to a file path among the project's markdown files. */
async function resolveTitle(title) {
  if (!window.api?.invoke) return null
  const wanted = String(title).trim().toLowerCase()
  let root = null
  try {
    const projects = (await window.api.getSettings?.('knownProjects')) || []
    root = Array.isArray(projects) ? projects[0] : null
  } catch { /* ignore */ }
  if (!root) return null
  const files = await window.api.invoke('fs:listMarkdownFilesRecursive', root).catch(() => [])
  for (const p of files) {
    const base = String(p).split(/[\\/]/).pop().replace(/\.(md|note)$/i, '')
    const variants = [base.toLowerCase(), base.replace(/_/g, ' ').toLowerCase()]
    if (variants.includes(wanted)) return p
  }
  return null
}

/** Strip front-matter and the leading H1 (usually the page title itself). */
function cleanSource(text, title) {
  let body = String(text).replace(/^---\n[\s\S]*?\n---\n?/, '')
  const lines = body.split('\n')
  // Drop a leading `# Title` heading that duplicates the transcluded title.
  while (lines.length && lines[0].trim() === '') lines.shift()
  if (lines.length) {
    const h = lines[0].match(/^#{1,6}\s+(.*)$/)
    if (h && h[1].trim().toLowerCase() === String(title).trim().toLowerCase()) {
      lines.shift()
    }
  }
  return lines.join('\n').trim()
}

/** Render a markdown line to a lightly-formatted text DOM node. */
function renderLine(line) {
  const div = document.createElement('div')
  div.className = 'cm-transclude-line'
  const heading = line.match(/^(#{1,6})\s+(.*)$/)
  if (heading) {
    const h = document.createElement('div')
    h.className = `cm-transclude-h cm-transclude-h${heading[1].length}`
    h.textContent = heading[2]
    return h
  }
  const trimmed = line.trim()
  if (trimmed === '') { div.innerHTML = '&nbsp;'; return div }
  // Minimal inline formatting: bold/italic/code stripped of markers.
  div.textContent = line
    .replace(/^\s*[-*+]\s+/, '• ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
  return div
}

export class TranscludeWidget extends WidgetType {
  /** @param {string} title referenced page title */
  constructor(title) {
    super()
    this.title = String(title).trim()
  }

  eq(other) { return other.title === this.title }

  toDOM() {
    const box = document.createElement('div')
    box.className = 'cm-transclude'

    const header = document.createElement('div')
    header.className = 'cm-transclude-header'
    header.innerHTML = '<span class="cm-transclude-icon"><i class="far fa-file-alt"></i></span>'
    const titleEl = document.createElement('span')
    titleEl.className = 'cm-transclude-title'
    titleEl.textContent = this.title
    header.appendChild(titleEl)
    header.title = `Open “${this.title}”`
    header.addEventListener('mousedown', (e) => { e.preventDefault() })
    header.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      window.dispatchEvent(new CustomEvent('cmd:open-page', {
        detail: { kind: 'wiki', value: this.title, title: this.title },
      }))
    })

    const body = document.createElement('div')
    body.className = 'cm-transclude-body'
    body.textContent = 'Loading…'

    box.appendChild(header)
    box.appendChild(body)

    if (!window.api?.invoke) {
      body.classList.add('cm-transclude-empty')
      body.textContent = 'Transclusion is unavailable in the web app.'
      return box
    }

    resolveTitle(this.title)
      .then((path) => {
        if (!path) {
          body.classList.add('cm-transclude-empty')
          body.textContent = `Page “${this.title}” not found.`
          return null
        }
        return window.api.invoke('fs:readFile', path)
      })
      .then((text) => {
        if (text == null) return
        const cleaned = cleanSource(text, this.title)
        body.textContent = ''
        if (!cleaned) {
          body.classList.add('cm-transclude-empty')
          body.textContent = '(empty page)'
          return
        }
        const frag = document.createDocumentFragment()
        for (const line of cleaned.split('\n')) frag.appendChild(renderLine(line))
        body.appendChild(frag)
      })
      .catch(() => {
        body.classList.add('cm-transclude-empty')
        body.textContent = `Could not load “${this.title}”.`
      })

    return box
  }

  ignoreEvent() { return true }
}
