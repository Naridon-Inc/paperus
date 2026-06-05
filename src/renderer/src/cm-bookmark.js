/**
 * Link bookmark cards for the CodeMirror 6 markdown editor.
 *
 * BLOCK-level widget. Two sources are recognised (per-line pass in
 * cm-hide-markers.js):
 *   - a line `bookmark: <url>`
 *   - a bare non-embed URL on its own line (embeds win via cm-embed.js)
 *
 * Renders a clickable card: a favicon (Google's s2 favicon service), the
 * hostname as the title, and the full URL muted underneath. Clicking opens the
 * URL externally (Electron `shell` if exposed, else a new browser tab).
 *
 * LIMITATION: rich page title / description are NOT fetched (cross-origin
 * fetches are blocked and would need a backend proxy). The card shows the
 * hostname only — richer metadata is deliberately deferred.
 */
import { WidgetType } from '@codemirror/view'

// `bookmark: https://…`  (case-insensitive label)
export const BOOKMARK_RE = /^\s*bookmark:\s*(https?:\/\/\S+)\s*$/i

/** Extract a bookmark URL from a line, or null. Accepts `bookmark: <url>`
 *  or a bare URL line. The caller decides ordering vs embeds. */
export function bookmarkUrlForLine(lineText) {
  const labelled = lineText.match(BOOKMARK_RE)
  if (labelled) return labelled[1]
  const t = lineText.trim()
  if (/^https?:\/\/\S+$/i.test(t)) return t
  return null
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function openExternal(url) {
  if (window.api?.openExternal) {
    window.api.openExternal(url)
  } else if (window.api?.invoke) {
    window.api.invoke('shell:openExternal', url).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer')
    })
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export class BookmarkWidget extends WidgetType {
  /** @param {string} url the bookmarked URL */
  constructor(url) {
    super()
    this.url = url
    this.host = hostOf(url)
  }

  eq(other) { return other.url === this.url }

  toDOM() {
    const card = document.createElement('div')
    card.className = 'cm-bookmark'

    const fav = document.createElement('img')
    fav.className = 'cm-bookmark-favicon'
    fav.alt = ''
    fav.loading = 'lazy'
    fav.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(this.host)}&sz=64`
    fav.onerror = () => { fav.style.visibility = 'hidden' }

    const info = document.createElement('div')
    info.className = 'cm-bookmark-info'
    const title = document.createElement('div')
    title.className = 'cm-bookmark-title'
    title.textContent = this.host
    const sub = document.createElement('div')
    sub.className = 'cm-bookmark-url'
    sub.textContent = this.url
    info.appendChild(title)
    info.appendChild(sub)

    card.appendChild(fav)
    card.appendChild(info)

    card.title = `Open ${this.url}`
    card.addEventListener('mousedown', (e) => { e.preventDefault() })
    card.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      openExternal(this.url)
    })

    return card
  }

  ignoreEvent() { return true }
}
