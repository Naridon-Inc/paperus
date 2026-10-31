// Plain words from the beginning of Markdown, without changing the body.
export function titleFromContent(content) {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(^|\n)\s*(?:#{1,6}\s+|>\s*|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?|\[[ xX]\]\s*)/g, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ').trim()
  return Array.from(text.split(' ').slice(0, 6).join(' ')).slice(0, 60).join('').trim()
}

export function isUntitled(title) {
  return !String(title || '').trim() || /^untitled(?:[ _]\d+)?(?:\.md)?$/i.test(String(title).trim())
}
