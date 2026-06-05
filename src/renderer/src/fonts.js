/**
 * Editor appearance: font family, font size and line height.
 *
 * The editor's font is hardcoded in `style.css` (`#editor .cm-editor` /
 * `#editor .cm-content`) and there is no pre-existing CSS variable to reuse, so
 * this module introduces three of its own:
 *
 *   --editor-font-family
 *   --editor-font-size
 *   --editor-line-height
 *
 * Because we cannot edit `style.css` here, this module injects a one-time
 * `<style id="editor-fonts-styles">` block whose selectors override the
 * hardcoded rules (same `#editor .cm-…` specificity, declared later in the
 * cascade so it wins) and consume those variables. The variables themselves are
 * set on `document.documentElement` so they can also be reused by `style.css`
 * later if desired (see the follow-up snippet in the agent report).
 *
 * Persistence uses the cross-platform settings bridge
 * (`window.api.setSettings` / `getSettings`), so the chosen appearance works on
 * both Electron (electron-settings) and the web build (localStorage mock), and
 * is re-applied on startup via `applyEditorFont()`.
 */

const SETTINGS_KEY = 'editorAppearance'

// Curated font stacks. `id` is persisted; `stack` is the actual CSS value.
export const FONT_OPTIONS = [
  {
    id: 'system',
    name: 'System Default',
    stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  {
    id: 'inter',
    name: 'Inter (sans)',
    stack: 'Inter, "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: 'georgia',
    name: 'Georgia (serif)',
    stack: 'Georgia, "Times New Roman", "Noto Serif", serif',
  },
  {
    id: 'lora',
    name: 'Lora (serif)',
    stack: 'Lora, Georgia, "Times New Roman", serif',
  },
  {
    id: 'mono',
    name: 'JetBrains Mono (mono)',
    stack: '"JetBrains Mono", "SF Mono", Monaco, Menlo, Consolas, "Courier New", monospace',
  },
]

const DEFAULTS = {
  fontId: 'system',
  fontSize: 16, // px — matches the current style.css default
  lineHeight: 1.75, // matches the current style.css default
}

function resolveStack(fontId) {
  const opt = FONT_OPTIONS.find((f) => f.id === fontId)
  return (opt || FONT_OPTIONS[0]).stack
}

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('editor-fonts-styles')) return
  const style = document.createElement('style')
  style.id = 'editor-fonts-styles'
  // These selectors mirror the hardcoded ones in style.css but read from the
  // CSS variables we set on :root. Declared later in the cascade → they win.
  style.textContent = `
    #editor .cm-editor {
      font-family: var(--editor-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--editor-font-size, 16px);
    }
    #editor .cm-content {
      font-family: var(--editor-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      line-height: var(--editor-line-height, 1.75);
    }
    /* Appearance settings UI (rendered inside the Settings modal). */
    .appearance-section .appearance-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .appearance-section .appearance-row > label {
      font-weight: 500;
      min-width: 120px;
    }
    .appearance-section select,
    .appearance-section input[type="range"] {
      flex: 1;
    }
    .appearance-section .appearance-value {
      min-width: 56px;
      text-align: right;
      color: #666;
      font-size: 12px;
    }
    .appearance-section .appearance-preview {
      margin-top: 8px;
      padding: 16px;
      border: 1px solid #eee;
      border-radius: 8px;
      background: #fafafa;
      color: #37352f;
    }
  `
  document.head.appendChild(style)
}

let _current = { ...DEFAULTS }

/** Load persisted appearance settings (tolerant of string/object shapes). */
export async function loadEditorFont() {
  try {
    const raw = await window.api.getSettings(SETTINGS_KEY)
    let obj = null
    if (raw && typeof raw === 'object') obj = raw
    else if (typeof raw === 'string' && raw) {
      try { obj = JSON.parse(raw) } catch { obj = null }
    }
    if (obj) {
      _current = {
        fontId: obj.fontId || DEFAULTS.fontId,
        fontSize: Number(obj.fontSize) || DEFAULTS.fontSize,
        lineHeight: Number(obj.lineHeight) || DEFAULTS.lineHeight,
      }
    }
  } catch (e) {
    console.warn('[Fonts] load failed:', e)
    _current = { ...DEFAULTS }
  }
  return { ..._current }
}

/** Return a copy of the current (in-memory) appearance settings. */
export function getEditorFont() {
  return { ..._current }
}

/** Apply the current appearance to :root CSS variables. Idempotent. */
export function applyEditorFont(settings = _current) {
  injectStyles()
  if (typeof document === 'undefined' || !document.documentElement) return
  const s = {
    fontId: settings.fontId || DEFAULTS.fontId,
    fontSize: Number(settings.fontSize) || DEFAULTS.fontSize,
    lineHeight: Number(settings.lineHeight) || DEFAULTS.lineHeight,
  }
  _current = s
  const root = document.documentElement.style
  root.setProperty('--editor-font-family', resolveStack(s.fontId))
  root.setProperty('--editor-font-size', `${s.fontSize}px`)
  root.setProperty('--editor-line-height', String(s.lineHeight))
}

/** Persist + apply appearance settings in one shot. */
export async function setEditorFont(settings) {
  const s = {
    fontId: settings.fontId || _current.fontId || DEFAULTS.fontId,
    fontSize: Number(settings.fontSize) || _current.fontSize || DEFAULTS.fontSize,
    lineHeight: Number(settings.lineHeight) || _current.lineHeight || DEFAULTS.lineHeight,
  }
  applyEditorFont(s)
  try {
    await window.api.setSettings(SETTINGS_KEY, JSON.stringify(s))
  } catch (e) {
    console.warn('[Fonts] persist failed:', e)
  }
  return { ...s }
}

/**
 * Render the Appearance settings UI into `container`. Self-contained: wires its
 * own change handlers which persist + apply immediately. Called from team.js's
 * settings dispatcher (the "Appearance" nav item).
 */
export function renderAppearanceSettings(container) {
  injectStyles()
  const s = getEditorFont()
  const opts = FONT_OPTIONS.map(
    (f) => `<option value="${f.id}" ${f.id === s.fontId ? 'selected' : ''}>${f.name}</option>`
  ).join('')

  container.innerHTML = `
    <h2>Appearance <span style="font-size:12px;font-weight:400;color:#999;">— editor typography</span></h2>
    <div class="settings-section appearance-section">
      <p style="font-size:13px;color:#666;margin-top:0;">
        Choose the editor's font, size and line spacing. Changes apply instantly and are saved for next time.
      </p>

      <div class="appearance-row">
        <label for="appearance-font">Font family</label>
        <select id="appearance-font">${opts}</select>
      </div>

      <div class="appearance-row">
        <label for="appearance-size">Font size</label>
        <input type="range" id="appearance-size" min="12" max="24" step="1" value="${s.fontSize}">
        <span class="appearance-value" id="appearance-size-val">${s.fontSize}px</span>
      </div>

      <div class="appearance-row">
        <label for="appearance-line">Line height</label>
        <input type="range" id="appearance-line" min="1.2" max="2.2" step="0.05" value="${s.lineHeight}">
        <span class="appearance-value" id="appearance-line-val">${s.lineHeight}</span>
      </div>

      <div class="appearance-preview" id="appearance-preview"
        style="font-family:${resolveStack(s.fontId)};font-size:${s.fontSize}px;line-height:${s.lineHeight};">
        The quick brown fox jumps over the lazy dog. Typography sets the tone of your notes —
        pick something comfortable to read for long stretches.
      </div>

      <div style="margin-top:14px;">
        <button class="btn btn-secondary" id="appearance-reset">Reset to defaults</button>
      </div>
    </div>
  `

  const fontSel = container.querySelector('#appearance-font')
  const sizeInput = container.querySelector('#appearance-size')
  const sizeVal = container.querySelector('#appearance-size-val')
  const lineInput = container.querySelector('#appearance-line')
  const lineVal = container.querySelector('#appearance-line-val')
  const preview = container.querySelector('#appearance-preview')
  const resetBtn = container.querySelector('#appearance-reset')

  const refreshPreview = (next) => {
    if (!preview) return
    preview.style.fontFamily = resolveStack(next.fontId)
    preview.style.fontSize = `${next.fontSize}px`
    preview.style.lineHeight = String(next.lineHeight)
  }

  const apply = async () => {
    const next = {
      fontId: fontSel.value,
      fontSize: parseInt(sizeInput.value, 10),
      lineHeight: parseFloat(lineInput.value),
    }
    if (sizeVal) sizeVal.textContent = `${next.fontSize}px`
    if (lineVal) lineVal.textContent = String(next.lineHeight)
    refreshPreview(next)
    await setEditorFont(next)
  }

  if (fontSel) fontSel.onchange = apply
  if (sizeInput) sizeInput.oninput = apply
  if (lineInput) lineInput.oninput = apply
  if (resetBtn) {
    resetBtn.onclick = async () => {
      fontSel.value = DEFAULTS.fontId
      sizeInput.value = String(DEFAULTS.fontSize)
      lineInput.value = String(DEFAULTS.lineHeight)
      await apply()
    }
  }
}
