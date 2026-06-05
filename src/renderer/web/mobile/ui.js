/**
 * ui.js — zero-dependency DOM toolkit + inline-SVG icon set + shared, hover-free
 * primitives for the from-scratch mobile companion shell.
 *
 * This is the ONLY DOM-creation layer the mobile screens use. It has NO knowledge
 * of CM6, the engine, or any manager — pure view atoms. Every affordance is a real
 * tap target (>=44px) driven by pointer events with a click fallback; NOTHING is
 * gated behind :hover (the desktop icon-button pattern reveals on hover at opacity
 * .6 — the mobile shell must never rely on that). Mirrors the el()/DOM-first idiom
 * of src/renderer/src/team-dialogs.js and src/renderer/web/mobile-link-screen.js.
 *
 * No imports: this file MUST NOT import CM6 or any engine module.
 */

// ── el(): the one DOM-creation primitive ─────────────────────────────────────────

/**
 * Hyperscript helper. Every other mobile-shell file composes from this.
 *
 * @param {string} tag                       element tag name
 * @param {object} [props]                   {
 *   class|className,                         -> className
 *   id,
 *   style,                                   -> string set verbatim, or object of camelCase props
 *   on<Event> (any key starting 'on'),       -> addEventListener (e.g. onclick, onpointerup)
 *   dataset:{},                              -> el.dataset[k] = v
 *   html,                                    -> innerHTML (TRUSTED ONLY — never user text)
 *   text,                                    -> textContent
 *   attrs:{},                                -> setAttribute(k, v)
 *   ...rest                                  -> setAttribute(k, v) (e.g. role, type, placeholder, aria-*)
 * }
 * @param {(string|Node|Array<string|Node|null>)} [children]  nullish entries skipped
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  const p = props || {}
  for (const [k, v] of Object.entries(p)) {
    if (v == null) continue
    if (k === 'class' || k === 'className') {
      node.className = v
    } else if (k === 'id') {
      node.id = v
    } else if (k === 'style') {
      if (typeof v === 'string') {
        node.style.cssText = v
      } else if (typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv != null) node.style[sk] = sv
        }
      }
    } else if (k === 'dataset' && typeof v === 'object') {
      for (const [dk, dv] of Object.entries(v)) {
        if (dv != null) node.dataset[dk] = dv
      }
    } else if (k === 'attrs' && typeof v === 'object') {
      for (const [ak, av] of Object.entries(v)) {
        if (av != null) node.setAttribute(ak, av)
      }
    } else if (k === 'html') {
      node.innerHTML = v
    } else if (k === 'text') {
      node.textContent = v
    } else if (k.startsWith('on') && typeof v === 'function') {
      // onclick -> 'click', onPointerUp -> 'pointerup', etc.
      node.addEventListener(k.slice(2).toLowerCase(), v)
    } else {
      node.setAttribute(k, v)
    }
  }
  const kids = Array.isArray(children) ? children : [children]
  for (const c of kids) {
    if (c == null) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

/** HTML-escape helper for the rare html: interpolation path (mirrors esc() in main.js). */
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── icon(): self-contained inline SVG set (no FontAwesome dependency) ─────────────

const SVG_NS = 'http://www.w3.org/2000/svg'

// Each entry is the inner markup of a 24x24, stroke=currentColor, stroke-width 2 svg.
// (Line-art set in the spirit of Feather/Lucide so it reads on both light/dark.)
const ICON_PATHS = {
  back: '<polyline points="15 18 9 12 15 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  bold: '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>',
  italic: '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
  h1: '<path d="M4 6v12"/><path d="M12 6v12"/><path d="M4 12h8"/><path d="M17 10l3-2v10"/>',
  h2: '<path d="M4 6v12"/><path d="M11 6v12"/><path d="M4 12h7"/><path d="M16 9a2 2 0 1 1 4 0c0 1.5-4 3.5-4 6h5"/>',
  h3: '<path d="M4 6v12"/><path d="M11 6v12"/><path d="M4 12h7"/><path d="M16 8.5a2 2 0 1 1 3 1.7 2 2 0 1 1-3 1.8"/>',
  'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  'list-ordered': '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 16.5a1 1 0 1 0-1.5-.9"/><path d="M4.5 18.5a1 1 0 1 0 1.5-.9"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  quote: '<path d="M7 7H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v3a3 3 0 0 1-3 3"/><path d="M18 7h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v3a3 3 0 0 1-3 3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/>',
  dot: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
}

/**
 * Returns an inline <svg> (stroke=currentColor, stroke-width 2, 24x24 viewBox).
 * Unknown names fall back to the 'note' glyph so a missing icon never throws.
 *
 * @param {string} name  one of the keys in ICON_PATHS (see contract for v1 set)
 * @param {number} [size=24]
 * @returns {SVGElement}
 */
export function icon(name, size = 24) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('mob-icon')
  svg.innerHTML = ICON_PATHS[name] || ICON_PATHS.note
  return svg
}

// ── Tap handling: pointerup with a small move-tolerance, click fallback ───────────

const TAP_MOVE_TOLERANCE = 10 // px — beyond this a pointer interaction is a scroll, not a tap

/**
 * Bind a tap handler that fires on a settled pointerup (ignoring scroll-like drags)
 * with a click fallback for non-pointer environments. Avoids the 300ms delay and
 * never relies on :hover.
 *
 * @param {HTMLElement} node
 * @param {(ev:Event)=>void} handler
 */
function onTap(node, handler) {
  if (typeof handler !== 'function') return
  let startX = 0
  let startY = 0
  let tracking = false
  let usedPointer = false

  node.addEventListener('pointerdown', (e) => {
    tracking = true
    startX = e.clientX
    startY = e.clientY
  })
  node.addEventListener('pointerup', (e) => {
    if (!tracking) return
    tracking = false
    const dx = Math.abs(e.clientX - startX)
    const dy = Math.abs(e.clientY - startY)
    if (dx <= TAP_MOVE_TOLERANCE && dy <= TAP_MOVE_TOLERANCE) {
      usedPointer = true
      handler(e)
    }
  })
  node.addEventListener('pointercancel', () => { tracking = false })
  // Fallback for environments that don't fire pointer events (older WebViews, tests).
  node.addEventListener('click', (e) => {
    if (usedPointer) { usedPointer = false; return }
    handler(e)
  })
}

/**
 * Bind a long-press handler (>=hold ms) that REPLACES desktop right-click/hover
 * actions. Cancels if the pointer moves past tolerance (treat as scroll).
 *
 * @param {HTMLElement} node
 * @param {(ev:Event)=>void} handler
 * @param {number} [hold=500]
 */
function onLongPress(node, handler, hold = 500) {
  if (typeof handler !== 'function') return
  let timer = null
  let startX = 0
  let startY = 0
  let fired = false

  const clear = () => {
    if (timer) { clearTimeout(timer); timer = null }
  }
  node.addEventListener('pointerdown', (e) => {
    fired = false
    startX = e.clientX
    startY = e.clientY
    clear()
    timer = setTimeout(() => {
      fired = true
      timer = null
      handler(e)
    }, hold)
  })
  node.addEventListener('pointermove', (e) => {
    if (!timer) return
    if (Math.abs(e.clientX - startX) > TAP_MOVE_TOLERANCE
      || Math.abs(e.clientY - startY) > TAP_MOVE_TOLERANCE) {
      clear()
    }
  })
  node.addEventListener('pointerup', clear)
  node.addEventListener('pointercancel', clear)
  node.addEventListener('pointerleave', clear)
  // Suppress the OS context menu so long-press doesn't double-fire a right-click menu.
  node.addEventListener('contextmenu', (e) => { e.preventDefault() })
  // Expose whether the press already fired so the row's onTap can be suppressed.
  return () => fired
}

// ── IconButton ───────────────────────────────────────────────────────────────────

/**
 * A >=44x44px tappable button wrapping icon(name). The glyph is ALWAYS full opacity
 * (no hover-only reveal); label -> aria-label + title.
 *
 * @param {object} opts
 * @param {string} opts.icon                 icon name
 * @param {string} [opts.label]              aria-label + title
 * @param {(ev:Event)=>void} [opts.onTap]
 * @param {number} [opts.size=44]            min tap size (px)
 * @param {boolean} [opts.active=false]      toggles .mob-iconbtn--active
 * @param {string} [opts.className='']
 * @returns {HTMLButtonElement}
 */
export function IconButton({
  icon: name,
  label,
  onTap: tap,
  size = 44,
  active = false,
  className = '',
} = {}) {
  const btn = el('button', {
    type: 'button',
    class: `mob-iconbtn${active ? ' mob-iconbtn--active' : ''}${className ? ` ${className}` : ''}`,
    style: { minWidth: `${size}px`, minHeight: `${size}px` },
    'aria-label': label || name,
    title: label || '',
  }, [icon(name)])
  if (tap) onTap(btn, tap)
  return btn
}

// ── Header ────────────────────────────────────────────────────────────────────────

/**
 * Top app bar (height var(--mob-header-h)). Safe-area top padding handled in CSS.
 *
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {(Node|Array<Node>|null)} [opts.left]    typically IconButton(s)
 * @param {(Node|Array<Node>|null)} [opts.right]
 * @param {(ev:Event)=>void|null} [opts.onTitleTap]  makes the title a tappable affordance (rename hook)
 * @returns {{ root: HTMLElement, setTitle(t:string):void, titleEl: HTMLElement }}
 */
export function Header({
  title = '', left = null, right = null, onTitleTap = null,
} = {}) {
  const toNodes = (slot) => {
    if (slot == null) return []
    return Array.isArray(slot) ? slot.filter(Boolean) : [slot]
  }

  const titleEl = el('div', {
    class: `mob-header__title${onTitleTap ? ' mob-header__title--tappable' : ''}`,
    text: title,
  })
  if (onTitleTap) onTap(titleEl, onTitleTap)

  const leftSlot = el('div', { class: 'mob-header__slot mob-header__slot--left' }, toNodes(left))
  const rightSlot = el('div', { class: 'mob-header__slot mob-header__slot--right' }, toNodes(right))

  const root = el('header', { class: 'mob-header' }, [leftSlot, titleEl, rightSlot])

  return {
    root,
    titleEl,
    setTitle(t) { titleEl.textContent = t == null ? '' : t },
  }
}

// ── ListRow ────────────────────────────────────────────────────────────────────────

/**
 * A full-width >=48px tappable row.
 *
 * @param {object} opts
 * @param {string|null} [opts.icon=null]      leading icon name
 * @param {string} opts.title
 * @param {string|null} [opts.subtitle=null]
 * @param {Node|null} [opts.trailing=null]     e.g. chevron or an overflow IconButton
 * @param {(ev:Event)=>void} [opts.onTap]
 * @param {(ev:Event)=>void|null} [opts.onLongPress=null]  pointer-hold (>=500ms) — overflow menu
 * @param {number} [opts.indent=0]             left padding = indent * 16px (nested tree)
 * @param {boolean} [opts.muted=false]         dimmed/italic (locked restricted notes)
 * @returns {HTMLElement}
 */
export function ListRow({
  icon: name = null,
  title,
  subtitle = null,
  trailing = null,
  onTap: tap,
  onLongPress: longPress = null,
  indent = 0,
  muted = false,
} = {}) {
  const lead = name
    ? el('span', { class: 'mob-listrow__icon' }, [icon(name, 20)])
    : null

  const textCol = el('div', { class: 'mob-listrow__text' }, [
    el('div', { class: 'mob-listrow__title', text: title == null ? '' : String(title) }),
    subtitle != null && subtitle !== ''
      ? el('div', { class: 'mob-listrow__subtitle', text: String(subtitle) })
      : null,
  ])

  const trail = trailing
    ? el('span', { class: 'mob-listrow__trailing' }, [trailing])
    : null

  const row = el('div', {
    class: `mob-listrow${muted ? ' mob-listrow--muted' : ''}`,
    role: 'button',
    tabindex: '0',
    style: indent ? { paddingLeft: `${12 + indent * 16}px` } : null,
  }, [lead, textCol, trail])

  // Long-press first (overflow/right-click replacement); its didFire() guard
  // lets us swallow the trailing tap so a long-press doesn't also navigate.
  let didFire = null
  if (longPress) didFire = onLongPress(row, longPress)
  if (tap) {
    onTap(row, (e) => {
      if (didFire && didFire()) return
      tap(e)
    })
  }
  // Keyboard activation (a11y) — Enter/Space act as tap.
  if (tap) {
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        tap(e)
      }
    })
  }
  return row
}

// ── BottomBar ─────────────────────────────────────────────────────────────────────

/**
 * Persistent bottom navigation (height var(--mob-bottombar-h) + safe-area).
 *
 * @param {object} opts
 * @param {Array<{id:string,icon:string,label:string}>} opts.tabs   v1: Home, Search
 * @param {{icon:string,onTap:(ev:Event)=>void}|null} [opts.fab=null]  centered raised FAB (New-note)
 * @param {(id:string)=>void} opts.onTab
 * @returns {{ root: HTMLElement, setActive(id:string):void }}
 */
export function BottomBar({ tabs = [], fab = null, onTab } = {}) {
  const tabEls = new Map()

  const makeTab = (tab) => {
    const node = el('button', {
      type: 'button',
      class: 'mob-tab',
      'aria-label': tab.label,
      title: tab.label,
      'data-tab': tab.id,
    }, [
      icon(tab.icon, 22),
      el('span', { class: 'mob-tab__label', text: tab.label }),
    ])
    onTap(node, () => { if (typeof onTab === 'function') onTab(tab.id) })
    tabEls.set(tab.id, node)
    return node
  }

  const children = []
  const tabNodes = tabs.map(makeTab)

  if (fab) {
    // Split the tabs around a centered FAB so it sits raised in the middle.
    const half = Math.ceil(tabNodes.length / 2)
    const fabBtn = el('button', {
      type: 'button',
      class: 'mob-fab',
      'aria-label': 'New note',
      title: 'New note',
    }, [icon(fab.icon || 'plus', 26)])
    onTap(fabBtn, (e) => { if (typeof fab.onTap === 'function') fab.onTap(e) })
    children.push(...tabNodes.slice(0, half), fabBtn, ...tabNodes.slice(half))
  } else {
    children.push(...tabNodes)
  }

  const root = el('nav', { class: 'mob-bottombar', role: 'tablist' }, children)

  return {
    root,
    setActive(id) {
      tabEls.forEach((node, tabId) => {
        node.classList.toggle('mob-tab--active', tabId === id)
        node.setAttribute('aria-selected', tabId === id ? 'true' : 'false')
      })
    },
  }
}
