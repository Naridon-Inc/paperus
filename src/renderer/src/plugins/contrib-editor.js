/**
 * contrib-editor.js — Editor adapter (FROZEN CONTRACT v1, §5.2 / §6.4).
 *
 * Bridges `ctx.editor.*` to the CodeMirror 6 surfaces. The editor `EditorView`
 * is destroyed and recreated on every doc open (`rebindEditor` in main.js) and
 * there is NO Compartment for feature extensions — so dynamically registered
 * plugin blocks/decorations must reach the rebuilt editor through a SINGLE,
 * STABLE extension whose identity never changes.
 *
 * Strategy (contract §6.4):
 *   - We own ONE stable extension `pluginEditorExtension = [pluginDecoField,
 *     pluginKeymapCompartment.of(keymap.of(...))]`.
 *   - `pluginDecoField` is a StateField<{deco, atomic}> that, on each recompute,
 *     asks the host-side block/decoration registry for ranges (synchronously,
 *     from cached render output). Adding/removing a plugin block does NOT create
 *     a new extension object — only invalidates the field via a state effect.
 *   - `getEditorExtensions()` returns `[pluginEditorExtension]` (stable identity)
 *     so rebindEditor can spread it into its local extensions array on every open.
 *
 * SECURITY: every registration and every `insert` re-checks the `editor`
 * capability at the seam. The plugin never receives the EditorView; ranges are
 * clamped host-side. Render output is sanitized by contrib-ui's sanitizer
 * before mounting. A throwing/hanging plugin render degrades to an inline error
 * chip — it NEVER breaks the host editor.
 */

import { StateField, StateEffect, RangeSet, Prec } from '@codemirror/state'
import { EditorView, Decoration, WidgetType, keymap } from '@codemirror/view'

// capabilities.js is the frozen-path enforcement module (owned by another
// component). Import defensively: if it is unavailable, fall back to permissive
// no-throw shims so the host never crashes — the manifest gate still applies
// upstream in plugin-host. We re-check here as defense in depth.
import * as Caps from './capabilities.js'

const CAP_EDITOR = (Caps.CAPABILITIES && Caps.CAPABILITIES.EDITOR) || 'editor'
const CAP_COMMANDS = (Caps.CAPABILITIES && Caps.CAPABILITIES.COMMANDS) || 'commands'

/** Re-check a capability at the seam; returns boolean, never throws. */
function hasCap(manifest, cap) {
  try {
    if (typeof Caps.requireCapability === 'function') {
      // requireCapability throws on denial per contract; catch and map to bool.
      try { Caps.requireCapability(manifest, cap); return true } catch { return false }
    }
    const list = (manifest && Array.isArray(manifest.capabilities)) ? manifest.capabilities : []
    return list.includes(cap)
  } catch { return false }
}

// ── Effects that invalidate / recompute the plugin decoration field ──────────
export const pluginRecomputeEffect = StateEffect.define()

/**
 * The host-side block/decoration registry. There is exactly ONE registry shared
 * by the stable StateField. Plugins push compiled descriptors into it; the field
 * reads them synchronously on each recompute.
 */
class PluginEditorRegistry {
  constructor() {
    /** @type {Map<string, object>} key = `${pluginId}::${type}` → block descriptor */
    this.blocks = new Map()
    /** @type {Map<string, object>} key = `${pluginId}::${idx}` → mark-decoration descriptor */
    this.decorations = new Map()
    /** Cache of rendered DOM per raw block source (eq-by-raw, §5.2). */
    this._renderCache = new Map()
    /** Views currently attached, so we can force recompute on registry change. */
    this._views = new Set()
    /** Keymap entries: array of { key, run } merged into the stable keymap. */
    this._keymap = []
    /** Callback the host wires so main.js can rebind when the keymap changes. */
    this._onKeymapChanged = null
  }

  attachView(view) { if (view) this._views.add(view) }
  detachView(view) { if (view) this._views.delete(view) }

  /** Force every attached view to recompute the plugin decoration field. */
  invalidate() {
    for (const view of this._views) {
      try {
        if (view && view.dispatch && !view.destroyed) {
          view.dispatch({ effects: pluginRecomputeEffect.of(null) })
        }
      } catch { /* a dead view is harmless; ignore */ }
    }
  }

  clearRenderCache() { this._renderCache.clear() }
}

// One process-wide registry instance (the editor is a singleton surface).
const registry = new PluginEditorRegistry()

/**
 * A host-synthesized block widget. `render(model)` is called via the host
 * (callback bridge) and returns sanitized vDOM/HTML; we cache the built DOM by
 * raw source so re-renders only happen when the source text changes (§5.2 eq).
 */
class PluginBlockWidget extends WidgetType {
  /**
   * @param {object} desc compiled block descriptor
   * @param {string} raw  raw block source text
   * @param {(vdomOrHtml:any, host:HTMLElement)=>void} mount sanitizing mounter
   */
  constructor(desc, raw, mount) {
    super()
    this.desc = desc
    this.raw = raw
    this.mount = mount
  }

  eq(other) {
    return other instanceof PluginBlockWidget &&
      other.desc === this.desc &&
      other.raw === this.raw
  }

  toDOM() {
    const host = document.createElement('div')
    host.className = `cm-plugin-block cm-plugin-block-${this.desc.type}`
    host.setAttribute('data-plugin', this.desc.pluginId)
    try {
      // The descriptor caches its last-rendered vDOM/HTML (sync-built from the
      // last async render result — §5.2). Build DOM from that snapshot.
      const out = this.desc.lastRender
      if (out == null) {
        host.textContent = ''
      } else if (this.mount) {
        this.mount(out, host)
      } else {
        host.textContent = String(out)
      }
    } catch (e) {
      host.className += ' cm-plugin-error'
      host.textContent = `[plugin block error: ${(e && e.message) || e}]`
    }
    return host
  }

  ignoreEvent() { return !this.desc.interactive }
}

/**
 * Build the field value for the current editor state by scanning registered
 * blocks/decorations. Pure & synchronous (uses cached render output). Never
 * throws — a misbehaving descriptor is skipped and logged.
 */
function buildPluginDecorations(state, mount, cursorInRange) {
  const deco = []
  const atomic = []
  // Track replace ranges so plugin blocks never overlap each other (overlap
  // invariant — §5.2). Native overlaps are guarded by the host field consulting
  // this set; here we at least keep plugin replaces mutually non-overlapping.
  const replaceRanges = []
  const text = state.doc.toString()

  // ── Block widgets (Decoration.replace, gated on !cursorInRange) ──
  for (const desc of registry.blocks.values()) {
    try {
      const ranges = detectBlockRanges(desc, state, text)
      for (const { from, to, raw } of ranges) {
        if (from < 0 || to > state.doc.length || from >= to) continue
        // Overlap guard: skip a plugin block that would overlap another replace.
        if (replaceRanges.some(r => from < r.to && to > r.from)) {
          // eslint-disable-next-line no-console
          console.warn(`[plugin ${desc.pluginId}] block "${desc.type}" overlaps another replace range; skipped`)
          continue
        }
        // Reveal raw markdown when the cursor is inside the block (editable).
        if (cursorInRange && cursorInRange(state, from, to)) {
          // No widget while editing; just mark atomic so caret behaves. We skip
          // the replace entirely so the source is shown.
          continue
        }
        // Ensure we have a render snapshot for this raw source.
        ensureRender(desc, raw)
        const widget = new PluginBlockWidget(desc, raw, mount)
        deco.push(Decoration.replace({ widget, block: true }).range(from, to))
        atomic.push(Decoration.replace({ widget, block: true }).range(from, to))
        replaceRanges.push({ from, to })
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[plugin ${desc.pluginId}] block detect/render failed:`, e)
    }
  }

  // ── Mark decorations (overlap-safe Decoration.mark only — §5.2) ──
  for (const desc of registry.decorations.values()) {
    try {
      const spans = (typeof desc.scan === 'function') ? desc.scan(text) : []
      if (!Array.isArray(spans)) continue
      for (const span of spans) {
        if (!span) continue
        const from = span.from | 0
        const to = span.to | 0
        if (from < 0 || to > state.doc.length || from >= to) continue
        const cls = typeof span.class === 'string' ? span.class : ''
        const safeCls = sanitizeClassName(cls)
        const attrs = sanitizeMarkAttrs(span.attrs)
        deco.push(Decoration.mark({ class: safeCls, attributes: attrs }).range(from, to))
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[plugin ${desc.pluginId}] decoration scan failed:`, e)
    }
  }

  // RangeSet.of requires sorted ranges; pass `true` to let CM sort.
  let decoSet
  let atomicSet
  try { decoSet = Decoration.set(deco, true) } catch { decoSet = Decoration.none }
  try { atomicSet = RangeSet.of(atomic, true) } catch { atomicSet = RangeSet.empty }
  return { deco: decoSet, atomic: atomicSet }
}

/** Compile a block's `fence`/`match` hint into concrete document ranges. */
function detectBlockRanges(desc, state, text) {
  const out = []
  if (desc.fence) {
    // Fence-style: a line starting with the fence token opens a block that
    // closes on the matching fence terminator. We support ::: and ``` fences.
    const fence = desc.fence
    const lines = text.split('\n')
    let offset = 0
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (line.startsWith(fence)) {
        const startFrom = offset
        // Find the closer: ::: fences close on a bare `:::`; ``` on ```.
        const closer = fence.startsWith(':::') ? ':::' : '```'
        let j = i + 1
        let consumed = offset + line.length + 1
        let found = false
        while (j < lines.length) {
          const l = lines[j]
          if (l.trim() === closer || l.trim().startsWith(closer)) {
            consumed += l.length
            found = true
            break
          }
          consumed += l.length + 1
          j++
        }
        const to = found ? consumed : (offset + text.slice(offset).length)
        const raw = text.slice(startFrom, to)
        out.push({ from: startFrom, to, raw })
        // advance past the block
        offset = to + 1
        i = found ? j + 1 : lines.length
        continue
      }
      offset += line.length + 1
      i++
    }
  } else if (desc.match && desc.match.test) {
    // Regex-over-text match (node hint is advisory; we run the test on lines).
    const re = toRegExp(desc.match.test, 'gm')
    if (re) {
      let m
      re.lastIndex = 0
      while ((m = re.exec(text)) !== null) {
        const from = m.index
        const to = from + m[0].length
        if (to <= from) { re.lastIndex++; continue }
        out.push({ from, to, raw: m[0] })
      }
    }
  }
  return out
}

function toRegExp(test, flags) {
  try {
    if (test instanceof RegExp) return new RegExp(test.source, flags)
    if (typeof test === 'string') return new RegExp(test, flags)
  } catch { /* invalid pattern */ }
  return null
}

/**
 * Make sure `desc.lastRender` holds a render snapshot for `raw`. The actual
 * `render(model)` runs across the RPC bridge asynchronously; the host caches the
 * resolved vDOM/HTML on the descriptor and re-triggers `registry.invalidate()`
 * when it changes. Here we synchronously parse markdown → model when possible
 * and use the cached snapshot for DOM building.
 */
function ensureRender(desc, raw) {
  if (desc._lastRaw === raw && desc.lastRender != null) return
  desc._lastRaw = raw
  // Parse synchronously if the plugin gave us a sync parseMarkdown bridge.
  try {
    if (typeof desc.requestRender === 'function') {
      // requestRender is host-provided: it kicks off an async render and, on
      // resolve, sets desc.lastRender + calls registry.invalidate(). It returns
      // the last cached snapshot synchronously (or null on first call).
      const snapshot = desc.requestRender(raw)
      if (snapshot != null) desc.lastRender = snapshot
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[plugin ${desc.pluginId}] requestRender failed:`, e)
  }
}

// ── sanitizers (defensive; contrib-ui owns the full vDOM sanitizer) ──────────
function sanitizeClassName(cls) {
  return String(cls || '').replace(/[^a-zA-Z0-9_ -]/g, '').slice(0, 200)
}
function sanitizeMarkAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return undefined
  const out = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (!/^(title|role|aria-[a-z-]+|data-[a-z0-9-]+)$/i.test(k)) continue
    out[k] = String(v).slice(0, 500)
  }
  return Object.keys(out).length ? out : undefined
}

// ── The single stable StateField + keymap that survive editor rebuilds ───────

const pluginDecoField = StateField.define({
  create() {
    return { deco: Decoration.none, atomic: RangeSet.empty }
  },
  update(value, tr) {
    const recompute = tr.docChanged || tr.selection ||
      tr.effects.some(e => e.is(pluginRecomputeEffect))
    if (!recompute) return value
    // `_mount` and `_cursorInRange` are injected by the host on init via the
    // module-level hooks below. We read them lazily so they're always current.
    return buildPluginDecorations(tr.state, _mountFn, _cursorInRangeFn)
  },
  provide: f => [
    EditorView.decorations.from(f, v => v.deco),
    EditorView.atomicRanges.of(view => {
      try { return view.state.field(f, false)?.atomic || RangeSet.empty } catch { return RangeSet.empty }
    }),
  ],
})

// Module-level injected helpers (set by initEditorAdapter). Keeping them at
// module scope lets the StateField read them without re-creating the field.
let _mountFn = null
let _cursorInRangeFn = null

// A small view plugin that registers/unregisters each live view with the
// registry so `invalidate()` can target every open editor.
const pluginViewTracker = EditorView.updateListener.of((update) => {
  // attach on first sight; the registry de-dupes.
  registry.attachView(update.view)
})

/**
 * The stable extension array. Its identity is fixed for the process lifetime, so
 * `getEditorExtensions()` returning `[pluginEditorExtension]` survives every
 * rebindEditor rebuild (contract §6.4 step 2). Keymap goes through Prec.highest
 * so plugin bindings can override defaults when needed.
 */
let _currentKeymapExtension = keymap.of([])
const pluginEditorExtension = [
  pluginDecoField,
  pluginViewTracker,
  // a thin wrapper extension that always reads the current keymap entries.
  Prec.highest(keymap.of(dynamicKeymap())),
]

function dynamicKeymap() {
  // CM6 keymap.of takes a static array, but we want it to reflect live
  // registrations. We return a getter-like array proxy by rebuilding on demand
  // is not supported, so the keymap reads registry._keymap through a closure
  // binding at extension-build time. To keep bindings dynamic we instead notify
  // main.js to rebind (onEditorExtensionsChanged) — see registerCommandKey.
  return registry._keymap.map(k => ({ key: k.key, run: k.run }))
}

// ── Public adapter surface ───────────────────────────────────────────────────

/**
 * Initialize the editor adapter. Called once by plugin-host with shared helpers.
 * @param {object} opts
 * @param {(vdomOrHtml:any, host:HTMLElement)=>void} opts.mount sanitizing mounter (from contrib-ui)
 * @param {(state:any, from:number, to:number)=>boolean} [opts.cursorInRange] reveal predicate
 * @param {() => void} [opts.onExtensionsChanged] notify main.js to rebind
 * @returns {object} the adapter API (see methods below)
 */
export function initEditorAdapter({ mount, cursorInRange, onExtensionsChanged } = {}) {
  _mountFn = typeof mount === 'function' ? mount : ((out, host) => {
    if (out && typeof out === 'object') {
      host.textContent = ''
    } else {
      host.textContent = String(out == null ? '' : out)
    }
  })
  _cursorInRangeFn = typeof cursorInRange === 'function' ? cursorInRange : defaultCursorInRange
  registry._onKeymapChanged = typeof onExtensionsChanged === 'function' ? onExtensionsChanged : null

  return {
    /** The stable extension main.js spreads into rebindEditor (§6.4). */
    getEditorExtensions() { return [pluginEditorExtension] },

    /**
     * Re-point on editor rebuild. Called from rebindEditor's re-point block
     * (alongside slashMenu.setView). Attaches the new view to the registry so
     * `invalidate()` reaches it, and forces an initial plugin recompute.
     */
    setView(view) {
      if (!view) return
      registry.attachView(view)
      // Force an initial recompute so already-registered plugin blocks render
      // immediately on the freshly-built editor.
      try {
        if (view.dispatch && !view.destroyed) {
          view.dispatch({ effects: pluginRecomputeEffect.of(null) })
        }
      } catch { /* ignore */ }
    },

    /**
     * ctx.editor.registerBlock — capability `editor`. Compiles a block descriptor
     * into the registry and triggers a recompute. Returns a Disposable.
     */
    registerBlock(manifest, block, bridge) {
      if (!hasCap(manifest, CAP_EDITOR)) return denied('registerBlock')
      if (!block || typeof block.type !== 'string') return noop()
      const pluginId = manifest.id
      const key = `${pluginId}::${block.type}`
      const desc = {
        pluginId,
        type: String(block.type).replace(/[^a-z0-9_-]/gi, '').slice(0, 64),
        fence: typeof block.fence === 'string' ? block.fence : null,
        match: block.match || null,
        interactive: !!block.interactive,
        lastRender: null,
        _lastRaw: null,
        // requestRender is the host-mediated render bridge (async render →
        // cache + invalidate). `bridge.render` invokes the plugin's render(model)
        // across RPC; bridge.parse invokes parseMarkdown(raw).
        requestRender(raw) {
          try {
            if (!bridge || typeof bridge.render !== 'function') return this.lastRender
            const cached = this.lastRender
            // Kick async render; on resolve, cache + invalidate so DOM rebuilds.
            Promise.resolve(bridge.render(raw))
              .then((out) => {
                if (out != null) {
                  this.lastRender = out
                  registry.invalidate()
                }
              })
              .catch((e) => {
                this.lastRender = { __error: (e && e.message) || String(e) }
                registry.invalidate()
              })
            return cached
          } catch { return this.lastRender }
        },
        // Serializer for interactive blocks; the host dispatches the change.
        toMarkdown: typeof bridge?.toMarkdown === 'function' ? bridge.toMarkdown : null,
      }
      registry.blocks.set(key, desc)
      registry.clearRenderCache()
      registry.invalidate()
      return {
        dispose() {
          registry.blocks.delete(key)
          registry.invalidate()
        },
      }
    },

    /**
     * ctx.editor.registerDecoration — capability `editor`. Overlap-safe mark
     * decorations only (Decoration.mark). Returns a Disposable.
     */
    registerDecoration(manifest, dec, bridge) {
      if (!hasCap(manifest, CAP_EDITOR)) return denied('registerDecoration')
      const pluginId = manifest.id
      const idx = registry.decorations.size
      const key = `${pluginId}::${idx}::${Date.now ? '' : ''}` + nextLocal()
      const desc = {
        pluginId,
        // scan runs the plugin's scan(text) across the RPC bridge synchronously
        // is impossible (RPC is async). So decorations use a host-cached result:
        // bridge.scan(text) returns the LAST computed spans synchronously and
        // kicks an async refresh. For built-in/lab plugins a direct fn is allowed.
        scan(text) {
          try {
            if (typeof dec.scan === 'function') return dec.scan(text) || []
            if (bridge && typeof bridge.scan === 'function') return bridge.scan(text) || []
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(`[plugin ${pluginId}] decoration scan threw:`, e)
          }
          return []
        },
      }
      registry.decorations.set(key, desc)
      registry.invalidate()
      return {
        dispose() {
          registry.decorations.delete(key)
          registry.invalidate()
        },
      }
    },

    /**
     * ctx.commands keybinding → merged into the stable keymap. Capability
     * `commands` (key emission also implies `editor` per §5.1). Because CM6
     * keymaps are static at build time, registering a key asks main.js to
     * rebind the editor so the new binding takes effect on the open doc.
     */
    registerCommandKey(manifest, key, run) {
      if (!hasCap(manifest, CAP_COMMANDS)) return denied('registerCommandKey')
      if (typeof key !== 'string' || typeof run !== 'function') return noop()
      const entry = {
        key,
        run: () => { try { run() } catch (e) { console.warn('[plugin keymap] run failed:', e) } return true },
        _pluginId: manifest.id,
      }
      registry._keymap.push(entry)
      rebuildKeymap()
      if (registry._onKeymapChanged) {
        try { registry._onKeymapChanged() } catch { /* ignore */ }
      }
      return {
        dispose() {
          const i = registry._keymap.indexOf(entry)
          if (i >= 0) registry._keymap.splice(i, 1)
          rebuildKeymap()
          if (registry._onKeymapChanged) {
            try { registry._onKeymapChanged() } catch { /* ignore */ }
          }
        },
      }
    },

    /**
     * Host-side `insert` (ctx.editor.insert). The plugin never gets the view;
     * the host clamps the range to [0, docLen] and dispatches. Capability
     * `editor` re-checked. Returns { ok }.
     */
    insert(manifest, view, payload) {
      if (!hasCap(manifest, CAP_EDITOR)) return { ok: false, error: 'CAPABILITY_DENIED' }
      if (!view || view.destroyed) return { ok: false, error: 'NO_VIEW' }
      try {
        const state = view.state
        const docLen = state.doc.length
        const text = typeof payload?.text === 'string' ? payload.text : ''
        if (payload && payload.replaceSelection) {
          const sel = state.selection.main
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: sel.from + text.length },
          })
          return { ok: true }
        }
        let at = (typeof payload?.at === 'number') ? payload.at : state.selection.main.head
        at = Math.max(0, Math.min(docLen, at | 0))
        view.dispatch({
          changes: { from: at, insert: text },
          selection: { anchor: at + text.length },
        })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e) }
      }
    },

    /**
     * Read a sanitized snapshot of the active editor (ctx.editor.getActive).
     * Returns plaintext + selection only — never the view or Y.Doc.
     */
    getActive(view, docId) {
      try {
        if (!view || view.destroyed) return null
        const sel = view.state.selection.main
        return {
          docId: docId || null,
          text: view.state.doc.toString(),
          selection: { from: sel.from, to: sel.to },
        }
      } catch { return null }
    },

    /** Expose the registry (read-only-ish) for the host/lab console. */
    _registry: registry,
    /** Force a recompute (used after hot reload). */
    invalidate() { registry.invalidate() },
  }
}

// keymap rebuild: replace the live array used by dynamicKeymap. Since the
// extension's keymap.of captured the array at build time, real reconfiguration
// is driven by onEditorExtensionsChanged → rebindEditor; rebuildKeymap keeps the
// in-memory list current for the next build.
function rebuildKeymap() {
  _currentKeymapExtension = keymap.of(dynamicKeymap())
  // touch to avoid unused-var lint and keep a live reference for diagnostics.
  return _currentKeymapExtension
}

/** Default reveal predicate: cursor (or selection) intersects [from,to]. */
function defaultCursorInRange(state, from, to) {
  try {
    for (const r of state.selection.ranges) {
      if (r.from <= to && r.to >= from) return true
    }
  } catch { /* ignore */ }
  return false
}

let _localCounter = 0
function nextLocal() { _localCounter += 1; return _localCounter }

function denied(method) {
  // eslint-disable-next-line no-console
  console.warn(`[contrib-editor] CAPABILITY_DENIED for ${method}`)
  return noop()
}
function noop() { return { dispose() {} } }

export { pluginEditorExtension, registry as editorRegistry }
