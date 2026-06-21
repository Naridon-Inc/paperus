// util.js — tiny pure helpers shared across the email islands. No React, no host.

// Relative/clock time for the message list & reading pane.
export function relTime(input) {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  const t = d.getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const mins = Math.round(diff / 60000)
  if (diff < 60 * 1000) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24 && isSameDay(d, new Date())) {
    try {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    } catch (_e) { return `${hrs}h` }
  }
  const days = Math.round(hrs / 24)
  if (days < 7) {
    try { return d.toLocaleDateString(undefined, { weekday: 'short' }) } catch (_e) { return `${days}d` }
  }
  try { return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch (_e) { return '' }
}

export function fullTime(input) {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  if (!Number.isFinite(d.getTime())) return ''
  try {
    return d.toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch (_e) { return d.toISOString() }
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// "Alice Smith" / "alice@x.com" → "AS" / "al"
export function initials(person) {
  const name = (person && (person.name || person.address)) || ''
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return '?'
}

export function displayName(person) {
  if (!person) return ''
  if (typeof person === 'string') return person
  return person.name || person.address || ''
}

export function addressOf(person) {
  if (!person) return ''
  if (typeof person === 'string') return person
  return person.address || person.name || ''
}

export function fmtBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// Build a plain-text "thread" blob to feed the AI. We only ever have a single
// message body in the contract, so we stitch headers + body into context.
export function messageToContext(msg) {
  if (!msg) return ''
  const lines = []
  if (msg.subject) lines.push(`Subject: ${msg.subject}`)
  if (msg.from) lines.push(`From: ${displayName(msg.from)} <${addressOf(msg.from)}>`)
  if (Array.isArray(msg.to) && msg.to.length) {
    lines.push(`To: ${msg.to.map((p) => displayName(p)).join(', ')}`)
  }
  if (msg.date) lines.push(`Date: ${fullTime(msg.date)}`)
  lines.push('')
  lines.push(bestBody(msg))
  return lines.join('\n').slice(0, 16000) // keep prompts bounded
}

// Prefer plaintext; fall back to a crude HTML→text strip.
export function bestBody(msg) {
  if (!msg) return ''
  if (msg.text && msg.text.trim()) return msg.text
  if (msg.html) return htmlToText(msg.html)
  return msg.snippet || ''
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// "Re:"/"Fwd:" subject helpers (don't double-prefix).
export function replySubject(subject) {
  const s = String(subject || '').trim()
  return /^re:/i.test(s) ? s : `Re: ${s}`
}
export function forwardSubject(subject) {
  const s = String(subject || '').trim()
  return /^fwd?:/i.test(s) ? s : `Fwd: ${s}`
}

// Quote the original body for a reply, ">"-prefixed.
export function quoteBody(msg) {
  const who = msg && msg.from ? `${displayName(msg.from)} <${addressOf(msg.from)}>` : 'someone'
  const when = msg && msg.date ? fullTime(msg.date) : ''
  const header = when ? `On ${when}, ${who} wrote:` : `${who} wrote:`
  const body = bestBody(msg)
  const quoted = body.split('\n').map((l) => `> ${l}`).join('\n')
  return `\n\n${header}\n${quoted}\n`
}

// Robustly pull the first JSON object/array out of an AI completion that may be
// fenced or chatty. Returns null on failure (never throws).
export function extractJson(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = []
  if (fenced) candidates.push(fenced[1])
  const start = text.search(/[[{]/)
  if (start >= 0) candidates.push(text.slice(start))
  candidates.push(text)
  for (const c of candidates) {
    try { return JSON.parse(c.trim()) } catch (_e) { /* try next */ }
    // try trimming to the matching last brace/bracket
    const trimmed = c.trim()
    const lastObj = trimmed.lastIndexOf('}')
    const lastArr = trimmed.lastIndexOf(']')
    const end = Math.max(lastObj, lastArr)
    if (end > 0) {
      try { return JSON.parse(trimmed.slice(0, end + 1)) } catch (_e) { /* next */ }
    }
  }
  return null
}

// Parse "3 numbered/bulleted lines" out of an AI reply into <=n strings.
export function parseLines(text, n = 3) {
  if (!text) return []
  return String(text)
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .map((l) => l.replace(/^["“]|["”]$/g, '').trim())
    .filter((l) => l.length > 0 && l.length < 240)
    .slice(0, n)
}
