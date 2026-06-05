/**
 * Dependency-free SVG chart renderer for the database `chart` view.
 *
 * Used by database-widget.js. The widget computes an aggregation (group rows by
 * a column, then count / sum / avg another column) and passes the resulting
 * series to `renderChart()`, which returns a self-contained <svg> element
 * (bar / line / pie) plus a small HTML legend wrapped in a container <div>.
 *
 * No external libraries — everything is hand-built SVG primitives so it works
 * identically on Electron + web with no extra bundle weight.
 */

const PALETTE = [
  '#5078ff', '#34c759', '#ff9500', '#ff3b30', '#af52de',
  '#00c7be', '#ff2d55', '#a2845e', '#ffcc00', '#5ac8fa',
  '#8e8e93', '#30b0c7',
]

const SVGNS = 'http://www.w3.org/2000/svg'

function el(tag, attrs, text) {
  const node = document.createElementNS(SVGNS, tag)
  if (attrs) Object.keys(attrs).forEach(k => node.setAttribute(k, attrs[k]))
  if (text != null) node.textContent = text
  return node
}

function colorFor(i) { return PALETTE[i % PALETTE.length] }

/** Pretty-print a numeric value (trims float noise, keeps it short). */
function fmt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  const r = Math.round(n * 1000) / 1000
  return String(r)
}

/**
 * @param {object} opts
 * @param {'bar'|'line'|'pie'} opts.chartType
 * @param {Array<{label:string,value:number}>} opts.series
 * @param {string} [opts.title]
 * @param {string} [opts.valueLabel]   description of the aggregated metric
 * @returns {HTMLElement} container div with the chart + legend
 */
export function renderChart(opts) {
  const { chartType = 'bar', series = [], valueLabel = '' } = opts || {}
  const container = document.createElement('div')
  container.className = 'cm-db-chart'

  if (!series.length) {
    const empty = document.createElement('div')
    empty.className = 'cm-db-chart-empty'
    empty.textContent = 'No data to chart. Pick a group column (and add rows).'
    container.appendChild(empty)
    return container
  }

  if (valueLabel) {
    const cap = document.createElement('div')
    cap.className = 'cm-db-chart-caption'
    cap.textContent = valueLabel
    container.appendChild(cap)
  }

  let svg
  if (chartType === 'pie') svg = buildPie(series)
  else if (chartType === 'line') svg = buildLine(series)
  else svg = buildBar(series)
  container.appendChild(svg)

  // Legend (also doubles as the labels for pie).
  const legend = document.createElement('div')
  legend.className = 'cm-db-chart-legend'
  series.forEach((s, i) => {
    const item = document.createElement('span')
    item.className = 'cm-db-chart-legitem'
    const sw = document.createElement('span')
    sw.className = 'cm-db-chart-swatch'
    sw.style.background = colorFor(i)
    item.appendChild(sw)
    item.appendChild(document.createTextNode(`${s.label || '—'} (${fmt(s.value)})`))
    legend.appendChild(item)
  })
  container.appendChild(legend)
  return container
}

// ── Bar chart ────────────────────────────────────────────────────────────────
function buildBar(series) {
  const W = 460
  const H = 240
  const padL = 38
  const padR = 12
  const padT = 12
  const padB = 46
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const maxV = Math.max(0, ...series.map(s => s.value))
  const niceMax = maxV <= 0 ? 1 : maxV

  const svg = el('svg', {
    class: 'cm-db-chart-svg',
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
  })

  // y axis gridlines + labels (4 steps)
  const steps = 4
  for (let i = 0; i <= steps; i += 1) {
    const frac = i / steps
    const y = padT + plotH - frac * plotH
    svg.appendChild(el('line', {
      x1: padL, y1: y, x2: W - padR, y2: y,
      stroke: 'rgba(125,125,125,.18)', 'stroke-width': 1,
    }))
    svg.appendChild(el('text', {
      x: padL - 5, y: y + 3, 'text-anchor': 'end',
      class: 'cm-db-chart-axis',
    }, fmt(frac * niceMax)))
  }

  const n = series.length
  const slot = plotW / n
  const barW = Math.max(4, Math.min(48, slot * 0.6))

  series.forEach((s, i) => {
    const x = padL + slot * i + (slot - barW) / 2
    const h = niceMax > 0 ? (s.value / niceMax) * plotH : 0
    const y = padT + plotH - h
    const rect = el('rect', {
      x, y: Number.isFinite(y) ? y : padT + plotH, width: barW, height: Math.max(0, h),
      rx: 3, fill: colorFor(i),
    })
    const t = el('title', null, `${s.label}: ${fmt(s.value)}`)
    rect.appendChild(t)
    svg.appendChild(rect)

    // value above bar
    svg.appendChild(el('text', {
      x: x + barW / 2, y: y - 4, 'text-anchor': 'middle', class: 'cm-db-chart-bval',
    }, fmt(s.value)))

    // x label (truncated)
    const label = String(s.label || '—')
    const short = label.length > 8 ? label.slice(0, 7) + '…' : label
    svg.appendChild(el('text', {
      x: x + barW / 2, y: H - padB + 16, 'text-anchor': 'middle',
      class: 'cm-db-chart-axis',
      transform: n > 6 ? `rotate(35 ${x + barW / 2} ${H - padB + 16})` : '',
    }, short))
  })

  return svg
}

// ── Line chart ───────────────────────────────────────────────────────────────
function buildLine(series) {
  const W = 460
  const H = 240
  const padL = 38
  const padR = 12
  const padT = 12
  const padB = 46
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const maxV = Math.max(0, ...series.map(s => s.value))
  const niceMax = maxV <= 0 ? 1 : maxV

  const svg = el('svg', {
    class: 'cm-db-chart-svg',
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
  })

  const steps = 4
  for (let i = 0; i <= steps; i += 1) {
    const frac = i / steps
    const y = padT + plotH - frac * plotH
    svg.appendChild(el('line', {
      x1: padL, y1: y, x2: W - padR, y2: y,
      stroke: 'rgba(125,125,125,.18)', 'stroke-width': 1,
    }))
    svg.appendChild(el('text', {
      x: padL - 5, y: y + 3, 'text-anchor': 'end', class: 'cm-db-chart-axis',
    }, fmt(frac * niceMax)))
  }

  const n = series.length
  const step = n > 1 ? plotW / (n - 1) : 0
  const pts = series.map((s, i) => {
    const x = n > 1 ? padL + step * i : padL + plotW / 2
    const y = padT + plotH - (niceMax > 0 ? (s.value / niceMax) * plotH : 0)
    return { x, y, s }
  })

  // area fill under the line
  if (pts.length > 1) {
    const area = `M ${pts[0].x} ${padT + plotH} `
      + pts.map(p => `L ${p.x} ${p.y}`).join(' ')
      + ` L ${pts[pts.length - 1].x} ${padT + plotH} Z`
    svg.appendChild(el('path', { d: area, fill: 'rgba(80,120,255,.10)' }))
  }

  // poly line
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  svg.appendChild(el('path', {
    d, fill: 'none', stroke: colorFor(0), 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }))

  // points + labels
  pts.forEach((p, i) => {
    const dot = el('circle', { cx: p.x, cy: p.y, r: 3.5, fill: colorFor(0) })
    dot.appendChild(el('title', null, `${p.s.label}: ${fmt(p.s.value)}`))
    svg.appendChild(dot)
    const label = String(p.s.label || '—')
    const short = label.length > 8 ? label.slice(0, 7) + '…' : label
    svg.appendChild(el('text', {
      x: p.x, y: H - padB + 16, 'text-anchor': 'middle', class: 'cm-db-chart-axis',
      transform: n > 6 ? `rotate(35 ${p.x} ${H - padB + 16})` : '',
    }, short))
  })

  return svg
}

// ── Pie chart ────────────────────────────────────────────────────────────────
function buildPie(series) {
  const W = 320
  const H = 240
  const cx = 120
  const cy = H / 2
  const r = 92

  const svg = el('svg', {
    class: 'cm-db-chart-svg',
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    preserveAspectRatio: 'xMidYMid meet',
  })

  const total = series.reduce((a, s) => a + (s.value > 0 ? s.value : 0), 0)
  if (total <= 0) {
    svg.appendChild(el('circle', { cx, cy, r, fill: 'rgba(125,125,125,.12)' }))
    svg.appendChild(el('text', {
      x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'cm-db-chart-axis',
    }, 'no values'))
    return svg
  }

  let angle = -Math.PI / 2 // start at top
  series.forEach((s, i) => {
    const v = s.value > 0 ? s.value : 0
    if (v <= 0) return
    const frac = v / total
    const a0 = angle
    const a1 = angle + frac * Math.PI * 2
    angle = a1
    const x0 = cx + r * Math.cos(a0)
    const y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1)
    const y1 = cy + r * Math.sin(a1)
    const large = (a1 - a0) > Math.PI ? 1 : 0
    // full circle special case (single slice)
    let path
    if (frac >= 0.9999) {
      path = el('circle', { cx, cy, r, fill: colorFor(i) })
    } else {
      const d = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
      path = el('path', { d, fill: colorFor(i) })
    }
    path.appendChild(el('title', null, `${s.label}: ${fmt(v)} (${Math.round(frac * 100)}%)`))
    svg.appendChild(path)

    // percentage label on slice
    if (frac > 0.05) {
      const mid = (a0 + a1) / 2
      const lx = cx + (r * 0.62) * Math.cos(mid)
      const ly = cy + (r * 0.62) * Math.sin(mid)
      svg.appendChild(el('text', {
        x: lx, y: ly + 3, 'text-anchor': 'middle', class: 'cm-db-chart-pielabel',
      }, Math.round(frac * 100) + '%'))
    }
  })

  return svg
}
