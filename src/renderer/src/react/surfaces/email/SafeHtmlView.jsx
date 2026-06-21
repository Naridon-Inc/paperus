// SafeHtmlView.jsx — SECURITY-CRITICAL HTML email renderer.
//
// Threat model: email HTML is hostile. We render it with belt-and-suspenders:
//   1. DOMPurify strips active content (script/style/iframe/object/embed/link/meta,
//      srcset, data-* attrs) — defense layer 1.
//   2. The sanitized markup is injected into a **fully sandboxed** <iframe srcdoc>
//      with `sandbox=""` — no allow-scripts, no allow-same-origin. So even if
//      something slipped past DOMPurify, it cannot run JS, cannot reach our
//      origin, cannot read cookies/localStorage, cannot navigate the top frame.
//   3. A strict CSP <meta> inside the srcdoc blocks ALL network by default
//      (`default-src 'none'`), so remote images/trackers don't load until the
//      user explicitly opts in via the "Load remote images" toggle (which only
//      then widens img-src to https:).
//   4. All <a> get target="_blank" so the (inert, sandboxed) links at least
//      render correctly; real navigation is neutered by the sandbox, and we offer
//      a plaintext fallback below for anything the user needs to act on.
//
// We cannot postMessage-resize a no-same-origin iframe, so we use a generous
// min-height and let the iframe scroll internally (user-resizable via the wrapper).

import { useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { Button } from '@medusajs/ui'

const PURIFY_OPTS = {
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'],
  FORBID_ATTR: ['srcset'],
  ALLOW_DATA_ATTR: false,
  // Keep `target` so our post-sanitize target="_blank" survives. We deliberately
  // do NOT override ALLOWED_URI_REGEXP — DOMPurify's safe default already blocks
  // javascript:/vbscript: and other dangerous schemes; weakening it would be a
  // foot-gun. The sandboxed, no-same-origin iframe is the real backstop anyway.
  ADD_ATTR: ['target'],
}

// CSP strings. `blocked` denies everything but inline style + data: images/fonts
// (data: is local, safe). `remote` additionally allows https: images.
function csp(allowRemote) {
  const img = allowRemote ? "img-src data: https:" : 'img-src data:'
  return `default-src 'none'; ${img}; style-src 'unsafe-inline'; font-src data:; media-src data:`
}

// Force target="_blank" + rel on every anchor in the sanitized DOM (post-sanitize
// so we never re-introduce something DOMPurify removed).
function hardenLinks(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer nofollow')
    })
    // Neutralize any leftover event-handler-ish or form actions defensively.
    doc.querySelectorAll('form').forEach((f) => f.removeAttribute('action'))
    return doc.body ? doc.body.innerHTML : html
  } catch (_e) {
    return html
  }
}

function buildSrcdoc(sanitized, allowRemote) {
  // The CSP meta MUST be the first thing in <head> so it governs the document.
  return `<!doctype html><html><head>`
    + `<meta http-equiv="Content-Security-Policy" content="${csp(allowRemote)}">`
    + `<meta name="referrer" content="no-referrer">`
    + `<base target="_blank">`
    + `<style>`
    + `html,body{margin:0;padding:0;background:#fff;color:#111;`
    + `font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;`
    + `word-break:break-word;overflow-wrap:anywhere;}`
    + `body{padding:14px 16px;}`
    + `img{max-width:100%;height:auto;}`
    + `table{max-width:100%;}`
    + `a{color:#2563eb;}`
    + `blockquote{margin:0 0 0 .5rem;padding-left:.75rem;border-left:3px solid #e5e7eb;color:#555;}`
    + `pre{white-space:pre-wrap;}`
    + `</style></head><body>${sanitized}</body></html>`
}

export default function SafeHtmlView({ html, text, minHeight = 320 }) {
  const [allowRemote, setAllowRemote] = useState(false)
  const [showPlain, setShowPlain] = useState(false)
  const iframeRef = useRef(null)

  // Detect whether the original HTML even references remote content, so we only
  // show the toggle when it's meaningful.
  const hasRemote = useMemo(() => {
    const s = String(html || '')
    return /(?:src|background|url\()\s*=?\s*["'(]?\s*https?:/i.test(s)
  }, [html])

  const srcdoc = useMemo(() => {
    if (!html) return null
    let clean = ''
    try {
      clean = DOMPurify.sanitize(String(html), PURIFY_OPTS)
    } catch (_e) {
      clean = ''
    }
    clean = hardenLinks(clean)
    return buildSrcdoc(clean, allowRemote)
  }, [html, allowRemote])

  // No HTML → render the plaintext body directly (still inside the surface).
  if (!html) {
    return (
      <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ui-fg-base">
        {text || ''}
      </pre>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {(hasRemote || text) ? (
        <div className="flex items-center gap-2">
          {hasRemote ? (
            <Button
              size="small"
              variant="secondary"
              onClick={() => setAllowRemote((v) => !v)}
            >
              {allowRemote ? 'Hide remote images' : 'Load remote images'}
            </Button>
          ) : null}
          {text ? (
            <Button
              size="small"
              variant="transparent"
              onClick={() => setShowPlain((v) => !v)}
            >
              {showPlain ? 'Show formatted' : 'View plain text'}
            </Button>
          ) : null}
          {!allowRemote && hasRemote ? (
            <span className="text-xs text-ui-fg-muted">Remote images blocked to protect your privacy</span>
          ) : null}
        </div>
      ) : null}

      {showPlain ? (
        <pre className="whitespace-pre-wrap break-words rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3 font-sans text-[13px] leading-relaxed text-ui-fg-base">
          {text || ''}
        </pre>
      ) : (
        <iframe
          ref={iframeRef}
          title="Email content"
          // sandbox="" → maximally restrictive: no scripts, no same-origin.
          sandbox=""
          srcDoc={srcdoc}
          referrerPolicy="no-referrer"
          className="w-full rounded-lg border border-ui-border-base bg-white"
          style={{ minHeight, height: minHeight, resize: 'vertical', overflow: 'auto', display: 'block' }}
        />
      )}
    </div>
  )
}
