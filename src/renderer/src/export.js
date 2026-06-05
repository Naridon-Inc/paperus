// Export the currently open document to Markdown, HTML, or PDF.
//
// This module is fully additive and self-contained. It owns its own popover UI
// and injects its own CSS (no edits to style.css). It works on BOTH Electron
// and web:
//   - Electron: native save dialog via window.api.invoke('dialog:showSaveDialog')
//     then window.api.writeFile(...). Falls back to a Blob download if the
//     dialog is unavailable/cancelled-by-error.
//   - Web: Blob download (the save dialog IPC is not mocked on web).
//   - PDF (both targets): opens a styled print window and calls print() so the
//     user can "Save as PDF". No main-process IPC is added.
//
// The host (main.js) wires this up by passing getters for the current
// markdown text and the document title.

import { marked } from 'marked'

const STYLE_ID = 'export-import-styles'

/** True when running the web build (no Electron IPC message channel). */
function isWebTarget() {
  return typeof window !== 'undefined'
    && (document.body.classList.contains('is-web') || !window.api || !window.api.onMessage)
}

/**
 * Inject the shared Export/Import popover CSS exactly once. Guarded by id so
 * export.js and import.js can both call it safely.
 */
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .exim-popover {
      position: fixed;
      z-index: 100000;
      min-width: 200px;
      background: #fff;
      border: 1px solid #e3e3e3;
      border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      padding: 6px;
      font-size: 14px;
      color: #333;
    }
    .exim-popover .exim-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #999;
      padding: 6px 10px 4px;
    }
    .exim-popover .exim-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      user-select: none;
    }
    .exim-popover .exim-item:hover { background: #f3f3f2; }
    .exim-popover .exim-item i { width: 16px; text-align: center; color: #888; }
    .exim-popover .exim-sub { font-size: 12px; color: #aaa; margin-left: auto; }
    .exim-trigger-btn { cursor: pointer; }
  `
  document.head.appendChild(style)
}

/** Strip a leading YAML front-matter block (--- ... ---) from markdown. */
function stripFrontMatter(md) {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

/** Escape text for safe interpolation into HTML attribute/text context. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Build a clean, self-contained HTML document from markdown. Front-matter is
 * stripped before rendering so raw YAML never leaks into the output.
 */
function buildHtmlDocument(markdown, title) {
  const body = marked.parse(stripFrontMatter(markdown))
  const safeTitle = escapeHtml(title || 'Document')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.7;
    color: #2b2b2b;
    max-width: 720px;
    margin: 48px auto;
    padding: 0 24px;
  }
  h1, h2, h3, h4 { line-height: 1.3; font-weight: 650; margin-top: 1.6em; }
  h1 { font-size: 2em; margin-top: 0; }
  h2 { font-size: 1.5em; }
  h3 { font-size: 1.25em; }
  p, li { font-size: 16px; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  blockquote {
    border-left: 3px solid #d0d0d0;
    margin: 1em 0;
    padding: 0.2em 1em;
    color: #555;
  }
  code {
    font-family: "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
    background: #f3f3f2;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
  }
  pre {
    background: #f6f8fa;
    border: 1px solid #e3e3e3;
    border-radius: 8px;
    padding: 14px 16px;
    overflow: auto;
  }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #e3e3e3; padding: 8px 12px; text-align: left; }
  th { background: #f6f8fa; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #e3e3e3; margin: 2em 0; }
  ul, ol { padding-left: 1.4em; }
</style>
</head>
<body>
${body}
</body>
</html>`
}

/** Trigger a client-side download of a string as a file (web + Electron). */
function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 0)
}

/**
 * Save `content` to disk. On Electron, attempt a native Save dialog and write
 * via window.api.writeFile; on any failure or on web, fall back to a Blob
 * download. Returns true if a save/download was attempted (false if cancelled).
 */
async function saveOrDownload(defaultName, content, mime) {
  if (!isWebTarget() && window.api && window.api.invoke) {
    try {
      const result = await window.api.invoke('dialog:showSaveDialog', {
        defaultPath: defaultName,
      })
      // Electron returns { canceled, filePath }
      if (result && result.canceled) return false
      if (result && result.filePath) {
        await window.api.writeFile(result.filePath, content)
        return true
      }
    } catch (e) {
      console.warn('[Export] Native save failed, falling back to download:', e)
    }
  }
  downloadBlob(defaultName, content, mime)
  return true
}

/**
 * ExportMenu — opens a small popover near a trigger element offering Markdown,
 * HTML, and PDF export of the currently open document.
 *
 * @param {object} opts
 * @param {() => string} opts.getMarkdown  Returns the current doc's raw markdown.
 * @param {() => string} opts.getTitle      Returns the current doc's display title.
 */
export class ExportMenu {
  constructor({ getMarkdown, getTitle } = {}) {
    this.getMarkdown = getMarkdown || (() => '')
    this.getTitle = getTitle || (() => 'document')
    this.el = null
    ensureStyles()
    this._onDocMouseDown = this._onDocMouseDown.bind(this)
  }

  /** Sanitize a title into a safe base filename (no extension). */
  _safeName() {
    const raw = (this.getTitle() || 'document').trim() || 'document'
    return raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_') || 'document'
  }

  /** Open the popover anchored to `anchorEl` (or near it / centered). */
  open(anchorEl) {
    this.close()
    ensureStyles()

    const pop = document.createElement('div')
    pop.className = 'exim-popover'
    pop.innerHTML = `
      <div class="exim-title">Export</div>
      <div class="exim-item" data-format="md"><i class="fas fa-file-alt"></i> Markdown <span class="exim-sub">.md</span></div>
      <div class="exim-item" data-format="html"><i class="fas fa-code"></i> HTML <span class="exim-sub">.html</span></div>
      <div class="exim-item" data-format="pdf"><i class="fas fa-file-pdf"></i> PDF <span class="exim-sub">Print</span></div>
      <div class="exim-title">Import</div>
      <div class="exim-item" data-action="import"><i class="fas fa-file-import"></i> Import file <span class="exim-sub">CSV / .md</span></div>
    `
    document.body.appendChild(pop)
    this.el = pop

    // Position: below the anchor if given, else top-right area.
    if (anchorEl && anchorEl.getBoundingClientRect) {
      const r = anchorEl.getBoundingClientRect()
      const top = r.bottom + 6
      let left = r.left
      // keep on-screen
      const popWidth = 220
      if (left + popWidth > window.innerWidth) left = window.innerWidth - popWidth - 8
      pop.style.top = `${top}px`
      pop.style.left = `${Math.max(8, left)}px`
    } else {
      pop.style.top = '52px'
      pop.style.right = '16px'
    }

    pop.querySelectorAll('.exim-item').forEach((item) => {
      item.addEventListener('click', async () => {
        this.close()
        // Import row hands off to the host's cmd:import handler (ImportManager).
        if (item.dataset.action === 'import') {
          window.dispatchEvent(new CustomEvent('cmd:import', { detail: { anchor: anchorEl } }))
          return
        }
        const fmt = item.dataset.format
        try {
          await this.export(fmt)
        } catch (e) {
          console.error('[Export] failed:', e)
          alert('Export failed: ' + (e && e.message ? e.message : e))
        }
      })
    })

    // Close on outside click (defer so the opening click doesn't immediately close it).
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

  /** Run an export for the given format: 'md' | 'html' | 'pdf'. */
  async export(format) {
    const markdown = this.getMarkdown() || ''
    if (!markdown.trim()) {
      alert('Open a document with content to export first.')
      return
    }
    const base = this._safeName()

    if (format === 'md') {
      // Keep front-matter intact (it carries icon/cover/width).
      await saveOrDownload(`${base}.md`, markdown, 'text/markdown;charset=utf-8')
      return
    }

    const html = buildHtmlDocument(markdown, this.getTitle())

    if (format === 'html') {
      await saveOrDownload(`${base}.html`, html, 'text/html;charset=utf-8')
      return
    }

    if (format === 'pdf') {
      const win = window.open('', '_blank')
      if (!win) {
        alert('Could not open a print window. Please allow pop-ups for this site, then try again.')
        return
      }
      win.document.open()
      win.document.write(html)
      win.document.close()
      // Give the new window a tick to render before invoking print.
      const doPrint = () => {
        try { win.focus(); win.print() } catch (e) { console.warn('[Export] print failed:', e) }
      }
      if (win.document.readyState === 'complete') setTimeout(doPrint, 250)
      else win.onload = () => setTimeout(doPrint, 250)
    }
  }
}
