/**
 * Media embeds for the CodeMirror 6 markdown editor.
 *
 * BLOCK-level widget. Three sources are recognised:
 *   1. A line that is ONLY a URL to a known provider (YouTube / Vimeo / Loom).
 *   2. A fenced block  ```embed\n<url>\n```
 *   3. A raw `<iframe …></iframe>` HTML block.
 *
 * Each renders a responsive 16:9 sandboxed <iframe> (lazy-loaded). Raw markdown
 * is shown on cursor-touch so the source stays editable. Detection of bare
 * provider URLs lives in cm-hide-markers.js (a per-line pass); fenced `embed`
 * blocks are handled in the FencedCode branch; iframe HTML blocks in the
 * HTMLBlock branch.
 *
 * SECURITY: the generated iframe is sandboxed
 * (`allow-scripts allow-same-origin allow-popups allow-presentation`) and
 * `loading="lazy"`. Raw user-supplied <iframe> HTML is NOT injected verbatim —
 * we parse out its `src` and rebuild a sandboxed iframe ourselves.
 */
import { WidgetType } from '@codemirror/view'

// ── Provider URL → embed src resolution ──────────────────────────────────────

const YT_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i
const VIMEO_RE = /vimeo\.com\/(?:video\/)?(\d+)/i
const LOOM_RE = /loom\.com\/(?:share|embed)\/([\w-]+)/i

/** Resolve a provider page URL to a sandboxable embed src, or null. */
export function resolveEmbedSrc(url) {
  const u = String(url).trim()
  let m
  if ((m = u.match(YT_RE))) return `https://www.youtube.com/embed/${m[1]}`
  if ((m = u.match(VIMEO_RE))) return `https://player.vimeo.com/video/${m[1]}`
  if ((m = u.match(LOOM_RE))) return `https://www.loom.com/embed/${m[1]}`
  return null
}

/** True if a single trimmed line is a bare embeddable provider URL. */
export function isEmbedUrlLine(lineText) {
  const t = lineText.trim()
  if (!/^https?:\/\/\S+$/i.test(t)) return false
  return resolveEmbedSrc(t) !== null
}

/** True if a FencedCode block's opening line declares the `embed` language. */
export function isEmbedFence(firstLineText) {
  return /^\s*`{3,}\s*embed\s*$/i.test(firstLineText)
}

/** Extract the URL from an ```embed block's body (first non-empty line). */
export function extractFenceUrl(text) {
  const body = text
    .replace(/^\s*`{3,}\s*embed\s*\n?/i, '')
    .replace(/\n?`{3,}\s*$/, '')
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (t) return t
  }
  return ''
}

/** True if a block of text is a raw <iframe …></iframe> HTML block. */
export function isIframeBlock(text) {
  return /^\s*<iframe[\s>]/i.test(text) && /<\/iframe>\s*$/i.test(text)
}

/** Pull the src attribute out of a raw <iframe> tag, or null. */
export function extractIframeSrc(text) {
  const m = text.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i)
  return m ? m[1] : null
}

export class EmbedWidget extends WidgetType {
  /** @param {string} src already-resolved embed URL */
  constructor(src) {
    super()
    this.src = src
  }

  eq(other) { return other.src === this.src }

  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-embed'

    const frame = document.createElement('iframe')
    frame.className = 'cm-embed-iframe'
    frame.src = this.src
    frame.loading = 'lazy'
    frame.setAttribute('frameborder', '0')
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups allow-presentation'
    )
    frame.setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
    )
    frame.allowFullscreen = true

    wrap.appendChild(frame)
    return wrap
  }

  ignoreEvent() { return true }
}
