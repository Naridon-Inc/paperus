/**
 * studio-code-editor.js — the Plugin Studio code workbench.
 *
 * A CodeMirror 6 editor over the files of one Studio build (`build-<buildId>/`).
 * It owns:
 *   - a file tree (sourced from `studio:read-build` → the recursive `plugin/`
 *     listing, surfaced via the renderer `studioClient`),
 *   - load/save of the active file through `studio:fs-read` / `studio:fs-write`,
 *   - a standalone CM6 `EditorView` (NOT `createEditor`, which is markdown-only) with
 *     language highlighting picked from the file extension (markdown ships; JS/JSON
 *     degrade to plain text unless the optional lang packages are added — see the
 *     integrationNote), and
 *   - a Phase-D diff-view toggle that shows what the agent changed since the editor
 *     last had a clean baseline (a line-level diff of baseline → current text).
 *
 * Trust: this is author-time host UI (NOT a sandboxed plugin), so it may talk to the
 * `studio:*` IPC surface directly — but ALWAYS through the defensive `studioClient`
 * wrapper, which normalizes "no desktop" to `{ ok:false, error:'unsupported' }`.
 *
 * Web-safety (FROZEN CONTRACT §7): NO top-level node/electron/child_process imports.
 * Every machine op goes through `client` (→ `window.api.invoke('studio:*', …)`). On
 * the web build (or when Studio is unsupported) the view degrades to a notice and
 * every public method is a no-op that never throws.
 *
 * Public surface (per the studio-editor-preview task contract):
 *   mountCodeEditor({ el, client, buildId }) →
 *     { setActiveFile(path), refresh(), showDiff(on?), destroy() }
 *
 * Class names belong to studio.css (owned by the studio-ui builder); this file only
 * references them.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from '@codemirror/commands'
import {
  HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput,
} from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'

/* ------------------------------------------------------------------------- *
 * Optional language packages.
 *
 * `@codemirror/lang-markdown` is in package.json. `@codemirror/lang-javascript`
 * and `@codemirror/lang-json` are NOT (see integrationNote). We import markdown
 * eagerly (always present) and probe for the JS/JSON packages lazily via a
 * dynamic import wrapped in try/catch so the bundle never hard-fails if they are
 * absent — degrading to plain text. The Vite bundler resolves the markdown import
 * statically; the dynamic ones are best-effort.
 * ------------------------------------------------------------------------- */

import { markdown } from '@codemirror/lang-markdown'

// Lazily-resolved language factories. null until probed; false if unavailable.
let _jsLang = null
let _jsonLang = null

async function loadJsLang() {
  if (_jsLang !== null) return _jsLang === false ? null : _jsLang
  try {
    const mod = await import('@codemirror/lang-javascript')
    _jsLang = (mod && typeof mod.javascript === 'function') ? mod.javascript : false
  } catch (_e) {
    _jsLang = false
  }
  return _jsLang === false ? null : _jsLang
}

async function loadJsonLang() {
  if (_jsonLang !== null) return _jsonLang === false ? null : _jsonLang
  try {
    const mod = await import('@codemirror/lang-json')
    _jsonLang = (mod && typeof mod.json === 'function') ? mod.json : false
  } catch (_e) {
    _jsonLang = false
  }
  return _jsonLang === false ? null : _jsonLang
}

/* ------------------------------------------------------------------------- *
 * Highlight style — a code-flavored palette (this editor shows real source, not
 * a markdown document, so it gets a conventional syntax-highlight theme).
 * ------------------------------------------------------------------------- */

const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#d73a49' },
  { tag: tags.controlKeyword, color: '#d73a49' },
  { tag: tags.operatorKeyword, color: '#d73a49' },
  { tag: tags.string, color: '#032f62' },
  { tag: tags.special(tags.string), color: '#032f62' },
  { tag: tags.number, color: '#005cc5' },
  { tag: tags.bool, color: '#005cc5' },
  { tag: tags.null, color: '#005cc5' },
  { tag: tags.atom, color: '#005cc5' },
  { tag: tags.comment, color: '#6a737d', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#6a737d', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#6a737d', fontStyle: 'italic' },
  { tag: tags.operator, color: '#d73a49' },
  { tag: tags.variableName, color: '#24292e' },
  { tag: tags.typeName, color: '#6f42c1' },
  { tag: tags.className, color: '#6f42c1' },
  { tag: tags.namespace, color: '#6f42c1' },
  { tag: tags.propertyName, color: '#005cc5' },
  { tag: tags.definition(tags.variableName), color: '#e36209' },
  { tag: tags.function(tags.variableName), color: '#6f42c1' },
  { tag: tags.labelName, color: '#e36209' },
  { tag: tags.regexp, color: '#032f62' },
  { tag: tags.meta, color: '#999' },
  // markdown
  { tag: tags.heading, fontWeight: '700', color: '#1a1a1a' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: '#2383e2' },
  { tag: tags.monospace, fontFamily: '"SF Mono", Monaco, Menlo, Consolas, monospace' },
])

/* ------------------------------------------------------------------------- *
 * Tiny DOM helpers (vanilla, matches the no-framework renderer style).
 * ------------------------------------------------------------------------- */

function el(tag, attrs, children) {
  const node = document.createElement(tag)
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k]
      if (v == null) continue
      if (k === 'class') node.className = v
      else if (k === 'text') node.textContent = v
      else if (k === 'html') node.innerHTML = v
      else if (k === 'dataset') Object.assign(node.dataset, v)
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v)
      } else node.setAttribute(k, v)
    }
  }
  if (children != null) {
    const list = Array.isArray(children) ? children : [children]
    for (const c of list) {
      if (c == null) continue
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    }
  }
  return node
}

function clearEl(node) {
  if (!node) return
  while (node.firstChild) node.removeChild(node.firstChild)
}

function extOf(path) {
  const s = String(path || '')
  const i = s.lastIndexOf('.')
  return i < 0 ? '' : s.slice(i + 1).toLowerCase()
}

function baseName(path) {
  const s = String(path || '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i < 0 ? s : s.slice(i + 1)
}

/* ------------------------------------------------------------------------- *
 * A minimal line-level diff (LCS) for the Phase-D diff view. No dependency.
 * Returns an ordered list of { type:'same'|'add'|'del', text } rows.
 * ------------------------------------------------------------------------- */

function lineDiff(oldText, newText) {
  const a = String(oldText == null ? '' : oldText).split('\n')
  const b = String(newText == null ? '' : newText).split('\n')
  const n = a.length
  const m = b.length
  // LCS length table. Cap the work so a pathological huge file can't hang the UI.
  const MAX = 4000
  if (n > MAX || m > MAX) {
    // Fall back to a coarse "everything changed" view for very large files.
    return [
      ...a.map((t) => ({ type: 'del', text: t })),
      ...b.map((t) => ({ type: 'add', text: t })),
    ]
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: a[i] })
      i += 1
    } else {
      rows.push({ type: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < n) { rows.push({ type: 'del', text: a[i] }); i += 1 }
  while (j < m) { rows.push({ type: 'add', text: b[j] }); j += 1 }
  return rows
}

/* ------------------------------------------------------------------------- *
 * The code editor factory.
 * ------------------------------------------------------------------------- */

/**
 * @param {object} opts
 * @param {HTMLElement} opts.el       host-provided container
 * @param {object} opts.client        the renderer studioClient (studio-client.js)
 * @param {number} opts.buildId       the integer build id
 * @returns {{
 *   setActiveFile(path:string): Promise<void>,
 *   refresh(): Promise<void>,
 *   showDiff(on?:boolean): void,
 *   destroy(): void
 * }}
 */
export function mountCodeEditor(optsOrEl, maybeOpts) {
  // Accept BOTH call shapes:
  //   • contract §5.2 (consumer-driven): mountCodeEditor(el, { doc, language, onChange })
  //     — plugin-studio.js drives content via setText()/getText(); no client/buildId.
  //   • builder shape (self-driving): mountCodeEditor({ el, client, buildId })
  //     — the editor reads/writes files itself through studioClient.
  let opts
  let consumerDriven = false
  if (optsOrEl && (optsOrEl.nodeType === 1 || typeof optsOrEl.appendChild === 'function')) {
    const o2 = maybeOpts || {}
    opts = { el: optsOrEl, client: o2.client || null, buildId: o2.buildId }
    // Treat the positional form without a client as consumer-driven.
    consumerDriven = !o2.client
    opts.__lang = o2.language
    opts.__onChange = typeof o2.onChange === 'function' ? o2.onChange : null
  } else {
    opts = optsOrEl || {}
  }
  const root = opts && opts.el
  const client = (opts && opts.client) || null
  const buildId = opts && opts.buildId

  // Defensive no-op surface returned when we cannot mount (web / bad args). Every
  // method resolves/returns without throwing.
  const inert = {
    setActiveFile: async () => {},
    refresh: async () => {},
    showDiff: () => {},
    destroy: () => {},
    // Contract §5.2 consumer-driven surface:
    getText: () => '',
    setText: () => {},
    dispose: () => {},
  }
  if (!root || typeof document === 'undefined') return inert

  // ── state ────────────────────────────────────────────────────────────────
  let disposed = false
  let view = null // the CM6 EditorView
  let files = [] // [{ path, dir }]
  let activePath = null
  let baselineText = '' // last-saved / agent baseline for the active file (diff)
  let diffOn = false
  let dirty = false

  const langComp = new Compartment()
  const readOnlyComp = new Compartment()

  // ── DOM scaffold ───────────────────────────────────────────────────────────
  clearEl(root)
  const wrap = el('div', { class: 'studio-code' })
  const treeEl = el('div', { class: 'studio-code-tree' })
  const main = el('div', { class: 'studio-code-main' })
  const toolbar = el('div', { class: 'studio-code-toolbar' })
  const pathLabel = el('span', { class: 'studio-code-path', text: '—' })
  const dirtyDot = el('span', { class: 'studio-code-dirty', text: '' })
  const saveBtn = el('button', { class: 'studio-btn', text: 'Save' })
  const diffBtn = el('button', { class: 'studio-btn', text: 'Diff' })
  toolbar.appendChild(pathLabel)
  toolbar.appendChild(dirtyDot)
  toolbar.appendChild(el('span', { class: 'studio-code-spacer' }))
  toolbar.appendChild(diffBtn)
  toolbar.appendChild(saveBtn)
  const editorHost = el('div', { class: 'studio-code-editor' })
  const diffHost = el('div', { class: 'studio-code-diff' })
  diffHost.style.display = 'none'
  main.appendChild(toolbar)
  main.appendChild(editorHost)
  main.appendChild(diffHost)
  wrap.appendChild(treeEl)
  wrap.appendChild(main)
  root.appendChild(wrap)

  function setDirty(v) {
    dirty = !!v
    dirtyDot.textContent = dirty ? '●' : ''
    saveBtn.disabled = !dirty
  }

  // ── CM6 construction ───────────────────────────────────────────────────────
  function buildView() {
    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged && !disposed) {
        setDirty(true)
        if (opts.__onChange) { try { opts.__onChange(getText()) } catch (_e) { /* noop */ } }
      }
    })
    const state = EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        syntaxHighlighting(codeHighlight),
        langComp.of([]),
        readOnlyComp.of(EditorState.readOnly.of(false)),
        EditorView.lineWrapping,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
          // Cmd/Ctrl-S → save.
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => { void save(); return true },
          },
        ]),
        updateListener,
      ],
    })
    view = new EditorView({ state, parent: editorHost })
  }

  function setText(text) {
    if (!view) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text == null ? '' : text) } })
  }

  function getText() {
    return view ? view.state.doc.toString() : ''
  }

  // Reconfigure the language compartment for the active file's extension.
  async function applyLanguage(path) {
    if (!view) return
    const e = extOf(path)
    let ext = []
    try {
      if (e === 'md' || e === 'markdown' || e === 'mdx') {
        ext = markdown()
      } else if (e === 'js' || e === 'mjs' || e === 'cjs' || e === 'jsx' || e === 'ts' || e === 'tsx') {
        const factory = await loadJsLang()
        ext = factory ? factory({ jsx: e.endsWith('x'), typescript: e === 'ts' || e === 'tsx' }) : []
      } else if (e === 'json') {
        const factory = await loadJsonLang()
        ext = factory ? factory() : []
      } else {
        ext = []
      }
    } catch (_err) {
      ext = []
    }
    if (disposed || !view) return
    view.dispatch({ effects: langComp.reconfigure(ext) })
  }

  // ── file tree ──────────────────────────────────────────────────────────────
  function renderTree() {
    clearEl(treeEl)
    treeEl.appendChild(el('div', { class: 'studio-code-tree-title', text: 'Files' }))
    const fileList = files
      .filter((f) => f && !f.dir)
      .map((f) => f.path)
      .sort((x, y) => x.localeCompare(y))
    if (!fileList.length) {
      treeEl.appendChild(el('div', { class: 'studio-code-tree-empty', text: 'No files yet.' }))
      return
    }
    for (const path of fileList) {
      const item = el('button', {
        class: 'studio-code-tree-item' + (path === activePath ? ' active' : ''),
        title: path,
        text: baseName(path),
        dataset: { path },
      })
      item.addEventListener('click', () => { void setActiveFile(path) })
      treeEl.appendChild(item)
    }
  }

  // ── diff view ──────────────────────────────────────────────────────────────
  function renderDiff() {
    clearEl(diffHost)
    const rows = lineDiff(baselineText, getText())
    const changed = rows.some((r) => r.type !== 'same')
    if (!changed) {
      diffHost.appendChild(el('div', { class: 'studio-code-diff-empty', text: 'No changes since the last baseline.' }))
      return
    }
    const table = el('div', { class: 'studio-code-diff-body' })
    for (const r of rows) {
      const sign = r.type === 'add' ? '+' : (r.type === 'del' ? '-' : ' ')
      table.appendChild(
        el('div', { class: `studio-code-diff-row ${r.type}` }, [
          el('span', { class: 'studio-code-diff-sign', text: sign }),
          el('span', { class: 'studio-code-diff-text', text: r.text }),
        ]),
      )
    }
    diffHost.appendChild(table)
  }

  function showDiff(on) {
    diffOn = (on === undefined) ? !diffOn : !!on
    diffBtn.classList.toggle('active', diffOn)
    if (diffOn) {
      editorHost.style.display = 'none'
      diffHost.style.display = ''
      renderDiff()
    } else {
      diffHost.style.display = 'none'
      editorHost.style.display = ''
    }
  }

  // ── load / save through studio:fs-* (via studioClient) ──────────────────────
  // The studioClient may expose either named methods (readBuild/fsRead/fsWrite) OR a
  // generic `invoke(channel, payload)` passthrough. Support both, and normalize the
  // "no desktop" signal to { ok:false, error:'unsupported' } either way.
  async function call(named, args, channel, payload) {
    try {
      if (client && typeof client[named] === 'function') {
        const res = await client[named](...args)
        return res || { ok: false, error: 'unsupported' }
      }
      if (client && typeof client.invoke === 'function') {
        const res = await client.invoke(channel, payload)
        return res || { ok: false, error: 'unsupported' }
      }
      return { ok: false, error: 'unsupported' }
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) }
    }
  }

  function fsRead(path) {
    return call('fsRead', [buildId, path], 'studio:fs-read', { buildId, path })
  }

  function fsWrite(path, data) {
    return call('fsWrite', [buildId, path, data], 'studio:fs-write', { buildId, path, data })
  }

  function readBuild() {
    return call('readBuild', [buildId], 'studio:read-build', { buildId })
  }

  function showUnsupported(msg) {
    clearEl(editorHost)
    editorHost.appendChild(
      el('div', { class: 'studio-code-unsupported', text: msg || 'Plugin Studio needs the desktop app.' }),
    )
    pathLabel.textContent = '—'
    saveBtn.disabled = true
    diffBtn.disabled = true
  }

  async function setActiveFile(path) {
    if (disposed) return
    // The deliverable subtree is `plugin/`; tree paths are relative to the build dir.
    const target = String(path || '')
    if (!target) return
    const res = await fsRead(target)
    if (!res.ok) {
      if (res.error === 'unsupported') { showUnsupported(); return }
      setText(`// Could not read ${target}: ${res.error || 'unknown error'}`)
      activePath = target
      pathLabel.textContent = target
      renderTree()
      return
    }
    activePath = target
    baselineText = res.data == null ? '' : String(res.data)
    pathLabel.textContent = target
    saveBtn.disabled = true
    diffBtn.disabled = false
    setText(baselineText)
    setDirty(false)
    await applyLanguage(target)
    renderTree()
    if (diffOn) renderDiff()
  }

  async function save() {
    if (disposed || !activePath) return
    const text = getText()
    saveBtn.disabled = true
    const res = await fsWrite(activePath, text)
    if (!res.ok) {
      saveBtn.disabled = false
      if (res.error === 'unsupported') showUnsupported()
      return
    }
    // Saving establishes a new clean baseline; the diff resets relative to it.
    baselineText = text
    setDirty(false)
    if (diffOn) renderDiff()
  }

  saveBtn.addEventListener('click', () => { void save() })
  diffBtn.addEventListener('click', () => showDiff())

  async function refresh() {
    if (disposed) return
    const res = await readBuild()
    if (!res.ok) {
      files = []
      renderTree()
      showUnsupported(res.error === 'unsupported' ? 'Plugin Studio needs the desktop app.' : `Could not read build: ${res.error || 'unknown error'}`)
      return
    }
    files = Array.isArray(res.files) ? res.files.slice() : []
    renderTree()
    // Pick an initial active file if none is selected (prefer index.js, then manifest).
    if (!activePath) {
      const names = files.filter((f) => f && !f.dir).map((f) => f.path)
      const pick = names.find((p) => /(^|\/)index\.js$/.test(p))
        || names.find((p) => /(^|\/)plugin\.json$/.test(p))
        || names[0]
      if (pick) {
        await setActiveFile(pick)
        return
      }
    } else if (files.some((f) => f && f.path === activePath && !f.dir)) {
      // The active file still exists: re-read it (agent may have rewritten it).
      // Preserve unsaved local edits — only auto-reload when the editor is clean.
      if (!dirty) await setActiveFile(activePath)
      else if (diffOn) renderDiff()
    } else {
      // Active file vanished; clear selection and re-pick.
      activePath = null
      await refresh()
    }
  }

  // ── boot ───────────────────────────────────────────────────────────────────
  buildView()
  if (consumerDriven) {
    // plugin-studio.js owns file loading: it reads via studioClient.fsRead and
    // pushes content through setText(); it reads back via getText() to save.
    // Don't self-drive (no client/buildId) and don't show the "unsupported" notice.
    if (opts.__lang != null) {
      // plugin-studio.js passes a CM6 language NAME ('javascript'|'json'|'markdown'),
      // not an extension. Map the common names to a representative extension so
      // applyLanguage() reconfigures the right grammar (degrades to plain text else).
      const LANG_EXT = { javascript: 'x.js', js: 'x.js', json: 'x.json', markdown: 'x.md', md: 'x.md' }
      const probe = typeof opts.__lang === 'string'
        ? (opts.__lang.includes('.') ? opts.__lang : (LANG_EXT[opts.__lang.toLowerCase()] || `x.${opts.__lang}`))
        : null
      if (probe) { try { void applyLanguage(probe) } catch (_e) { /* noop */ } }
    }
    if (opts.doc != null) setText(opts.doc)
    treeEl.style.display = 'none'
  } else {
    // Self-driving: initial population is async but non-blocking; never throws.
    void refresh()
  }

  function destroy() {
    if (disposed) return
    disposed = true
    try { if (view) view.destroy() } catch (_e) { /* ignore */ }
    view = null
    try { clearEl(root) } catch (_e) { /* ignore */ }
  }

  return {
    setActiveFile: (path) => setActiveFile(path),
    refresh: () => refresh(),
    showDiff: (on) => showDiff(on),
    destroy,
    // Contract §5.2 consumer-driven surface (used by plugin-studio.js):
    getText,
    setText: (t) => { setText(t); setDirty(false) },
    dispose: destroy,
  }
}

export default mountCodeEditor
