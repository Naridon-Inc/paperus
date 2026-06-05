/**
 * Minimal YAML front-matter parsing/serialisation for page metadata
 * (icon, cover, …). Front-matter is a `---` fenced block at the very top of a
 * markdown document. Kept deliberately simple: flat `key: value` pairs only.
 */

// Leading `---\n ... \n---\n` block.
const FM_RE = /^---\n([\s\S]*?)\n---\n?/

/**
 * @returns {{ data: Object, raw: string|null, end: number }}
 *   data — parsed key/value pairs; raw — the matched block (or null);
 *   end — char offset where the document body begins.
 */
export function parseFrontmatter(text) {
  const m = (text || '').match(FM_RE)
  if (!m) return { data: {}, raw: null, end: 0 }
  const data = {}
  m[1].split('\n').forEach((line) => {
    const i = line.indexOf(':')
    if (i === -1) return
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    v = v.replace(/^["']/, '').replace(/["']$/, '')
    if (k) data[k] = v
  })
  return { data, raw: m[0], end: m[0].length }
}

export function serializeFrontmatter(data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined && data[k] !== null && data[k] !== '')
  if (!keys.length) return ''
  const lines = keys.map((k) => {
    const v = String(data[k])
    const needsQuote = /[:#"']/.test(v)
    return `${k}: ${needsQuote ? JSON.stringify(v) : v}`
  })
  return `---\n${lines.join('\n')}\n---\n`
}

/**
 * Merge `updates` into the document's front-matter and return the change needed
 * to apply it as a minimal edit at the top of the text.
 * @returns {{ text: string, oldEnd: number, fm: string }}
 */
export function applyFrontmatter(text, updates) {
  const { data, end } = parseFrontmatter(text)
  const merged = { ...data, ...updates }
  Object.keys(merged).forEach((k) => { if (merged[k] === '' || merged[k] == null) delete merged[k] })
  const fm = serializeFrontmatter(merged)
  const body = text.slice(end)
  return { text: fm + body, oldEnd: end, fm }
}

/** Convenience: read a single front-matter value. */
export function getFrontmatterValue(text, key) {
  return parseFrontmatter(text).data[key]
}
