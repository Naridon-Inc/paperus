/**
 * graph-view.js — a dependency-free, force-directed "graph view" of the
 * workspace (Obsidian / Anytype style). Nodes are notes; edges are
 * [[wiki-links]] (local vault) or parent→child structure (P2P team).
 *
 * Rendered on a <canvas> with a tiny spring-electrical simulation. Supports pan
 * (drag the background), zoom (wheel), drag a node, and click a node to open it.
 * Fully decoupled from app internals: the caller passes an async `gather()` that
 * returns `{ nodes:[{id,title}], edges:[{from,to}] }` and an `openNode(node)`
 * callback. No third-party graph library — the physics is ~40 lines.
 */

const GRAPH_CSS = `
.graph-overlay {
  position: fixed; inset: 0; z-index: 4000;
  display: none; flex-direction: column;
  background: rgba(252, 252, 253, 0.98);
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  animation: graph-fade 140ms ease;
}
@keyframes graph-fade { from { opacity: 0 } to { opacity: 1 } }
.graph-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid #ececef;
  font: 13px -apple-system, system-ui, sans-serif; color: #333;
  -webkit-app-region: drag;
}
.graph-toolbar .graph-title { font-weight: 650; }
.graph-toolbar .graph-status { color: #9a9aa2; font-size: 12px; }
.graph-toolbar .graph-spacer { flex: 1; }
.graph-btn {
  -webkit-app-region: no-drag;
  border: 1px solid #e2e2e7; background: #fff; color: #444;
  border-radius: 7px; padding: 4px 10px; font-size: 12px; cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.graph-btn:hover { background: #f4f4f6; border-color: #d4d4da; }
.graph-close { font-size: 13px; line-height: 1; padding: 4px 9px; }
.graph-canvas { flex: 1; display: block; width: 100%; height: 100%; cursor: grab; }
.graph-canvas.dragging { cursor: grabbing; }
.graph-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #9a9aa2; font: 14px -apple-system, system-ui, sans-serif; pointer-events: none;
}
`

export class GraphView {
  constructor({ openNode } = {}) {
    this.openNode = openNode || (() => {})
    this.overlay = null
    this.canvas = null
    this.ctx = null
    this.nodes = []
    this.edges = []
    this.byId = new Map()
    this.raf = null
    this.alpha = 0
    this.scale = 1
    this.offsetX = 0
    this.offsetY = 0
    this.hover = null
    this.drag = null // node being dragged
    this.pan = null // {x,y} pan anchor
    this.moved = false
    this._onKey = this._onKey.bind(this)
    this._frame = this._frame.bind(this)
  }

  async open(gather) {
    this._ensureDom()
    this.overlay.style.display = 'flex'
    document.addEventListener('keydown', this._onKey)
    this._setStatus('Building graph…')
    this.emptyEl.style.display = 'none'
    let data = { nodes: [], edges: [] }
    try { data = (await gather()) || data } catch (e) { console.warn('[graph] gather failed', e) }
    this._setData(data)
    this._resize()
    this._fit()
    this._start()
  }

  close() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null }
    document.removeEventListener('keydown', this._onKey)
    if (this.overlay) this.overlay.style.display = 'none'
  }

  isOpen() { return !!(this.overlay && this.overlay.style.display !== 'none') }

  _onKey(e) { if (e.key === 'Escape') { e.preventDefault(); this.close() } }

  _setStatus(txt) { if (this.statusEl) this.statusEl.textContent = txt }

  _ensureDom() {
    if (this.overlay) return
    if (!document.getElementById('graph-view-styles')) {
      const st = document.createElement('style')
      st.id = 'graph-view-styles'
      st.textContent = GRAPH_CSS
      document.head.appendChild(st)
    }
    const ov = document.createElement('div')
    ov.className = 'graph-overlay'
    ov.innerHTML = `
      <div class="graph-toolbar">
        <span class="graph-title">Graph</span>
        <span class="graph-status"></span>
        <span class="graph-spacer"></span>
        <button class="graph-btn" data-act="fit" title="Fit to view">Fit</button>
        <button class="graph-btn graph-close" data-act="close" title="Close (Esc)">✕</button>
      </div>
      <canvas class="graph-canvas"></canvas>
      <div class="graph-empty">No linked notes to graph yet.</div>`
    document.body.appendChild(ov)
    this.overlay = ov
    this.canvas = ov.querySelector('.graph-canvas')
    this.ctx = this.canvas.getContext('2d')
    this.statusEl = ov.querySelector('.graph-status')
    this.emptyEl = ov.querySelector('.graph-empty')
    ov.querySelector('[data-act=close]').onclick = () => this.close()
    ov.querySelector('[data-act=fit]').onclick = () => this._fit()
    this._bindInteractions()
    window.addEventListener('resize', () => { if (this.isOpen()) this._resize() })
  }

  _setData({ nodes = [], edges = [] }) {
    // De-dupe nodes by id, seed positions on a circle (jittered).
    const seen = new Map()
    const N = nodes.length || 1
    nodes.forEach((n, i) => {
      if (seen.has(n.id)) return
      const ang = (i / N) * Math.PI * 2
      const r = 120 + Math.random() * 60
      seen.set(n.id, {
        id: n.id,
        title: n.title || 'Untitled',
        x: Math.cos(ang) * r + (Math.random() - 0.5) * 30,
        y: Math.sin(ang) * r + (Math.random() - 0.5) * 30,
        vx: 0, vy: 0, deg: 0,
      })
    })
    this.byId = seen
    this.nodes = [...seen.values()]
    // Keep only edges whose endpoints both exist and aren't self-loops.
    const ekey = new Set()
    this.edges = []
    for (const e of edges) {
      if (!e || e.from === e.to) continue
      if (!seen.has(e.from) || !seen.has(e.to)) continue
      const k = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`
      if (ekey.has(k)) continue
      ekey.add(k)
      this.edges.push({ a: seen.get(e.from), b: seen.get(e.to) })
      seen.get(e.from).deg += 1
      seen.get(e.to).deg += 1
    }
    this._setStatus(`${this.nodes.length} notes · ${this.edges.length} links`)
    this.emptyEl.style.display = this.nodes.length ? 'none' : 'flex'
    this.alpha = 1
  }

  // ── Simulation ────────────────────────────────────────────────────────────
  _step() {
    const nodes = this.nodes
    const REPULSE = 5200
    const SPRING = 0.018
    const LEN = 78
    const GRAVITY = 0.012
    const DAMP = 0.86
    const a = this.alpha
    for (let i = 0; i < nodes.length; i += 1) { nodes[i].fx = 0; nodes[i].fy = 0 }
    // Repulsion (O(n²) — fine for the few hundred notes a workspace holds).
    for (let i = 0; i < nodes.length; i += 1) {
      const ni = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const nj = nodes[j]
        let dx = ni.x - nj.x
        let dy = ni.y - nj.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 0.01 }
        const f = REPULSE / d2
        const d = Math.sqrt(d2)
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        ni.fx += fx; ni.fy += fy
        nj.fx -= fx; nj.fy -= fy
      }
    }
    // Springs along edges.
    for (const e of this.edges) {
      const dx = e.b.x - e.a.x
      const dy = e.b.y - e.a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const f = (d - LEN) * SPRING
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      e.a.fx += fx; e.a.fy += fy
      e.b.fx -= fx; e.b.fy -= fy
    }
    // Gravity to centre + integrate.
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i]
      if (n === this.drag) { n.vx = 0; n.vy = 0; continue }
      n.fx -= n.x * GRAVITY
      n.fy -= n.y * GRAVITY
      n.vx = (n.vx + n.fx * a) * DAMP
      n.vy = (n.vy + n.fy * a) * DAMP
      n.x += n.vx
      n.y += n.vy
    }
    this.alpha *= 0.985
    if (this.alpha < 0.02) this.alpha = 0.02 // keep a gentle floor so drags settle
  }

  _frame() {
    if (this.drag == null && this.alpha > 0.025) this._step()
    else if (this.drag != null) this._step()
    this._draw()
    this.raf = requestAnimationFrame(this._frame)
  }

  _start() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this._frame)
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  _draw() {
    const ctx = this.ctx
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const cssW = this.canvas.clientWidth
    const cssH = this.canvas.clientHeight
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.translate(this.offsetX, this.offsetY)
    ctx.scale(this.scale, this.scale)

    const hov = this.hover
    const nbr = hov ? this._neighbors(hov) : null

    // Edges.
    ctx.lineWidth = 1 / this.scale
    for (const e of this.edges) {
      const lit = hov && (e.a === hov || e.b === hov)
      ctx.strokeStyle = lit ? 'rgba(35,131,226,0.55)' : 'rgba(170,170,178,0.35)'
      ctx.beginPath()
      ctx.moveTo(e.a.x, e.a.y)
      ctx.lineTo(e.b.x, e.b.y)
      ctx.stroke()
    }

    // Nodes.
    for (const n of this.nodes) {
      const r = 4 + Math.min(10, n.deg * 1.6)
      const dim = hov && n !== hov && !(nbr && nbr.has(n))
      ctx.beginPath()
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
      ctx.fillStyle = n === hov ? '#1f6fd0' : (dim ? 'rgba(35,131,226,0.30)' : '#2383e2')
      ctx.fill()
      if (n === hov) {
        ctx.lineWidth = 2 / this.scale
        ctx.strokeStyle = 'rgba(31,111,208,0.35)'
        ctx.stroke()
      }
    }

    // Labels (screen space): hovered + neighbours always; everything when zoomed
    // in or when the graph is small.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const showAll = this.scale > 1.25 || this.nodes.length <= 36
    ctx.font = '11px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const n of this.nodes) {
      const isHot = n === hov || (nbr && nbr.has(n))
      if (!showAll && !isHot) continue
      const sx = n.x * this.scale + this.offsetX
      const sy = n.y * this.scale + this.offsetY
      const r = 4 + Math.min(10, n.deg * 1.6)
      ctx.fillStyle = isHot ? '#222' : 'rgba(80,80,88,0.78)'
      const label = n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title
      ctx.fillText(label, sx, sy + r * this.scale + 3)
    }
  }

  _neighbors(node) {
    const set = new Set()
    for (const e of this.edges) {
      if (e.a === node) set.add(e.b)
      else if (e.b === node) set.add(e.a)
    }
    return set
  }

  // ── View transforms ───────────────────────────────────────────────────────
  _resize() {
    if (!this.canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    this.canvas.width = Math.max(1, Math.round(w * dpr))
    this.canvas.height = Math.max(1, Math.round(h * dpr))
  }

  _fit() {
    if (!this.nodes.length) { this.scale = 1; this.offsetX = this.canvas.clientWidth / 2; this.offsetY = this.canvas.clientHeight / 2; return }
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (const n of this.nodes) {
      if (n.x < minX) minX = n.x
      if (n.y < minY) minY = n.y
      if (n.x > maxX) maxX = n.x
      if (n.y > maxY) maxY = n.y
    }
    const pad = 80
    const w = this.canvas.clientWidth || 800
    const h = this.canvas.clientHeight || 600
    const gw = Math.max(1, maxX - minX)
    const gh = Math.max(1, maxY - minY)
    this.scale = Math.min(2.2, Math.max(0.2, Math.min((w - pad) / gw, (h - pad) / gh)))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    this.offsetX = w / 2 - cx * this.scale
    this.offsetY = h / 2 - cy * this.scale
  }

  _screenToWorld(mx, my) {
    return { x: (mx - this.offsetX) / this.scale, y: (my - this.offsetY) / this.scale }
  }

  _hit(mx, my) {
    const p = this._screenToWorld(mx, my)
    let best = null
    let bestD = Infinity
    for (const n of this.nodes) {
      const r = 4 + Math.min(10, n.deg * 1.6)
      const dx = n.x - p.x
      const dy = n.y - p.y
      const d = dx * dx + dy * dy
      const hitR = (r + 6) * (r + 6) / (this.scale * this.scale)
      if (d < hitR && d < bestD) { best = n; bestD = d }
    }
    return best
  }

  _bindInteractions() {
    const c = this.canvas
    c.addEventListener('mousedown', (e) => {
      const mx = e.offsetX
      const my = e.offsetY
      this.moved = false
      const hit = this._hit(mx, my)
      if (hit) { this.drag = hit; this.alpha = Math.max(this.alpha, 0.4) }
      else { this.pan = { x: mx - this.offsetX, y: my - this.offsetY } }
      c.classList.add('dragging')
    })
    window.addEventListener('mousemove', (e) => {
      if (!this.isOpen()) return
      const rect = c.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      if (this.drag) {
        this.moved = true
        const p = this._screenToWorld(mx, my)
        this.drag.x = p.x; this.drag.y = p.y; this.drag.vx = 0; this.drag.vy = 0
      } else if (this.pan) {
        this.moved = true
        this.offsetX = mx - this.pan.x
        this.offsetY = my - this.pan.y
      } else {
        const h = this._hit(mx, my)
        if (h !== this.hover) { this.hover = h; c.style.cursor = h ? 'pointer' : 'grab' }
      }
    })
    window.addEventListener('mouseup', () => {
      if (!this.isOpen()) return
      if (this.drag && !this.moved) this.openNode(this.drag)
      this.drag = null
      this.pan = null
      c.classList.remove('dragging')
    })
    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      const mx = e.offsetX
      const my = e.offsetY
      const before = this._screenToWorld(mx, my)
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      this.scale = Math.min(4, Math.max(0.12, this.scale * factor))
      this.offsetX = mx - before.x * this.scale
      this.offsetY = my - before.y * this.scale
    }, { passive: false })
  }
}
