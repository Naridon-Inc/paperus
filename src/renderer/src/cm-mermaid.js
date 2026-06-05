/**
 * Mermaid diagram blocks for the CodeMirror 6 editor.
 *
 * A fenced code block tagged `mermaid` renders as an SVG diagram in live
 * preview:
 *
 *   ```mermaid
 *   graph TD;
 *     A-->B;
 *   ```
 *
 * Mermaid is lazy-loaded (dynamic import) inside toDOM so it stays out of the
 * main bundle and never runs at module-eval time. Detection lives in the
 * FencedCode handler in cm-hide-markers.js; raw markdown is shown on
 * cursor-touch so the diagram source stays editable.
 */
import { WidgetType } from '@codemirror/view'

let _idCounter = 0
let _initPromise = null

/** True if a FencedCode block's opening line declares the `mermaid` language. */
export function isMermaidFence(firstLineText) {
  return /^\s*`{3,}\s*mermaid\s*$/i.test(firstLineText)
}

/** Strip the opening / closing fence lines, leaving the diagram source. */
function extractCode(text) {
  return text
    .replace(/^\s*`{3,}\s*mermaid\s*\n?/i, '')
    .replace(/\n?`{3,}\s*$/, '')
    .trim()
}

export class MermaidWidget extends WidgetType {
  constructor(text) {
    super()
    this.text = text
    this.code = extractCode(text)
  }

  eq(other) { return other.text === this.text }

  toDOM() {
    const container = document.createElement('div')
    container.className = 'cm-mermaid'
    container.textContent = 'Rendering diagram…'

    const id = `mmd-${Date.now()}-${_idCounter++}`
    const code = this.code

    import('mermaid')
      .then((m) => {
        const mer = m.default || m
        if (!_initPromise) {
          _initPromise = Promise.resolve(
            mer.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' })
          )
        }
        return _initPromise.then(() => mer.render(id, code))
      })
      .then((res) => {
        const svg = res && res.svg ? res.svg : ''
        container.innerHTML = svg
      })
      .catch((err) => {
        container.classList.add('cm-mermaid-error')
        container.textContent = `Mermaid error: ${err && err.message ? err.message : err}`
      })

    return container
  }

  ignoreEvent() { return true }
}
