/**
 * Inline image widget for the CodeMirror 6 markdown editor.
 *
 * Renders `![alt](src)` as an actual <img> element in live preview. Remote
 * and data URLs are loaded directly; local paths / file:// URLs are resolved
 * to a data URL through the `fs:readFileDataUrl` IPC handler so they display
 * under Electron's webSecurity (file:// is blocked when served over http).
 *
 * The raw markdown is still shown (and editable) when the cursor touches the
 * image span — see the `Image` handler in cm-hide-markers.js.
 */
import { WidgetType } from '@codemirror/view'

const REMOTE_RE = /^(https?:|data:)/i

export class ImageWidget extends WidgetType {
  constructor(alt, src) {
    super()
    this.alt = alt
    this.src = src
  }

  eq(other) {
    return other.alt === this.alt && other.src === this.src
  }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-image-wrap'

    const img = document.createElement('img')
    img.className = 'cm-image'
    img.alt = this.alt
    img.onerror = () => { wrap.classList.add('cm-image-broken') }

    if (REMOTE_RE.test(this.src)) {
      img.src = this.src
    } else if (window.api?.invoke) {
      // Local path or file:// — resolve to a data URL via the main process.
      window.api.invoke('fs:readFileDataUrl', this.src)
        .then((dataUrl) => { img.src = dataUrl || this.src })
        .catch(() => { img.src = this.src })
    } else {
      img.src = this.src
    }

    wrap.appendChild(img)
    return wrap
  }

  ignoreEvent() { return true }
}
