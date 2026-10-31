const KEY = 'completedTasksAtBottom'
let enabled = false
let savedOrders = {}

export async function loadChecklistPreference() {
  try { enabled = await window.api.getSettings(KEY) === true }
  catch { enabled = false }
  try { savedOrders = await window.api.getSettings('checklistOrders') || {} }
  catch { savedOrders = {} }
  if (typeof savedOrders !== 'object' || Array.isArray(savedOrders)) savedOrders = {}
}
export function checklistOrder(docId, doc = null) {
  return { ...savedOrders[docId], ...doc?.getMap('metadata').get('checklistOrder') }
}
export function saveChecklistOrder(docId, order, doc = null) {
  if (!order) return
  if (doc) doc.getMap('metadata').set('checklistOrder', order)
  savedOrders[docId] = order
  // Only opaque fingerprints and ordinal numbers are cached, never task text.
  void window.api.setSettings('checklistOrders', savedOrders).catch(error => console.warn('[Checklist] Order cache save failed', error))
}

function fingerprint(text) {
  let a = 2166136261, b = 5381
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619)
    b = Math.imul(b, 33) ^ text.charCodeAt(i)
  }
  return `${a >>> 0}:${b >>> 0}:${text.length}`
}
export function completedTasksAtBottom() { return enabled }
export async function setCompletedTasksAtBottom(value) {
  await window.api.setSettings(KEY, !!value)
  enabled = !!value
}

const TASK = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\](?:\s|$)/
const indent = line => (line.match(/^[ \t]*/)?.[0] || '').replace(/\t/g, '    ').length

// One checkbox action, scoped to its contiguous sibling checklist. Nested
// content travels with its parent; headings/blank lines split separate lists.
export function checkboxChange(text, position, done, sort = enabled, order = {}) {
  const lines = text.split('\n')
  let index = 0, offset = 0
  while (index < lines.length - 1 && offset + lines[index].length < position) {
    offset += lines[index++].length + 1
  }
  const match = TASK.exec(lines[index])
  if (!match) return null
  const box = lines[index].indexOf('[', match[1].length) + 1
  if (!sort) return { from: offset + box, to: offset + box + 1, insert: done ? 'x' : ' ' }
  const occurrences = new Map()
  const keys = lines.map((line, i) => {
    if (!TASK.test(line)) return null
    const key = fingerprint(line.replace(/\[[ xX]\]/, '[ ]'))
    const occurrence = occurrences.get(key) || 0
    occurrences.set(key, occurrence + 1)
    const id = `${key}:${occurrence}`
    if (!Object.hasOwn(order, id)) order[id] = i
    return id
  })
  const depth = indent(lines[index])
  let start = index
  for (let i = index - 1; i >= 0; i--) {
    if (!lines[i].trim()) break
    if (indent(lines[i]) > depth) continue
    if (indent(lines[i]) === depth && TASK.test(lines[i])) start = i
    else break
  }
  const blocks = []
  let end = start
  while (end < lines.length && indent(lines[end]) === depth && TASK.test(lines[end])) {
    const first = end++
    while (end < lines.length && lines[end].trim() && indent(lines[end]) > depth) end++
    const block = lines.slice(first, end)
    if (first === index) block[0] = block[0].slice(0, box) + (done ? 'x' : ' ') + block[0].slice(box + 1)
    blocks.push({ lines: block, done: TASK.exec(block[0])[2] !== ' ', rank: order[keys[first]], target: first === index })
  }
  // Completed items keep completion order; newly completed goes to the end.
  // Incomplete items always return to their remembered original order.
  const unfinished = blocks.filter(b => !b.done).sort((a, b) => a.rank - b.rank)
  const finished = blocks.filter(b => b.done)
  const sorted = done
    ? [...unfinished, ...finished.filter(b => !b.target), ...finished.filter(b => b.target)]
    : [...unfinished, ...finished]
  const before = lines.slice(start, end).join('\n')
  const after = sorted.flatMap(b => b.lines).join('\n')
  // Keep unchanged CRDT characters intact rather than replacing the document.
  let prefix = 0, suffix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const from = lines.slice(0, start).reduce((n, line) => n + line.length + 1, 0)
  return { from: from + prefix, to: from + before.length - suffix, insert: after.slice(prefix, after.length - suffix), order }
}
