// studio-capabilities-md.js — generates the LIVE `CAPABILITIES.md` the Studio
// workspace is seeded with (Frozen Plugin Studio Contract v1, §2, §5.2, §6.3).
//
// This is the differentiator the design (PLUGIN_STUDIO.md §5) calls out: rather
// than a static doc, the catalog is produced from the RUNNING host so it lists
// exactly what is extensible *right now* — every capability, the `ctx`/RPC method
// that needs it, whether it is sensitive (needs explicit user approval), and what
// is currently registered on each surface.
//
// It is generated renderer-side and passed verbatim into `studio:create-workspace`
// as `capabilitiesMarkdown`; main writes it to `build-<id>/CAPABILITIES.md` byte
// for byte. The agent (any harness) reads it as grounding.
//
// PURE renderer module: introspects `../capabilities.js` and `../contrib-editor.js`
// plus an OPTIONAL live controller snapshot. No node/electron imports (web-safe).
// Defensive: never throws — a missing controller or registry degrades gracefully.

import {
  CAPABILITIES,
  METHOD_CAPABILITY,
  describeCapability,
  isSensitiveCapability,
} from '../capabilities.js'

// editorRegistry is exported as `{ pluginEditorExtension, registry as editorRegistry }`.
// We only read its `.blocks` / `.decorations` maps (counts), never mutate it.
import { editorRegistry } from '../contrib-editor.js'

/* ------------------------------------------------------------------------- *
 * Static descriptions of each extensible surface (the "what can I build" map).
 * Keyed by capability string. Each entry names the ctx call(s) authors use.
 * ------------------------------------------------------------------------- */

const SURFACE_GUIDE = Object.freeze({
  [CAPABILITIES.COMMANDS]: {
    title: 'Commands & keybindings',
    ctx: 'ctx.commands.register({ id, title, keybinding?, run })',
    notes: 'Register a command (optionally with a keyboard shortcut). Commands appear in the palette.',
  },
  [CAPABILITIES.EDITOR]: {
    title: 'Editor blocks & decorations',
    ctx: 'ctx.editor.registerBlock({ type, fence?, match?, render }) · ctx.editor.insert(text) · ctx.editor.getActive()',
    notes: 'Add a fenced block type that renders custom output, decorate text, or read/insert into the active note.',
  },
  [CAPABILITIES.UI]: {
    title: 'UI surfaces',
    ctx: 'ctx.ui.statusItem({ text, onClick }) · ctx.ui.panel(...) · ctx.ui.toolbarItem(...) · ctx.ui.notify(...) · ctx.ui.modal(...)',
    notes: 'Add a status-bar item, a toolbar button, a side panel, a notification, or a modal. Render returns sanitized HTML / vDOM, never DOM nodes.',
  },
  [CAPABILITIES.SECTIONS]: {
    title: 'Sidebar sections',
    ctx: 'ctx.ui.sidebarSection({ id, title, render })',
    notes: 'Add a collapsible section to the left sidebar.',
  },
  [CAPABILITIES.VIEWS]: {
    title: 'Full-page views & settings',
    ctx: 'ctx.ui.view({ id, title, render }) · ctx.ui.settingsSection({ id, title, render })',
    notes: 'Add a dedicated full-page view and/or a section in Settings.',
  },
  [CAPABILITIES.AI]: {
    title: 'AI backend',
    ctx: 'ctx.ai.complete({ prompt, onToken? }) · ctx.ai.embed(text) · ctx.ai.registerProvider(...)',
    notes: 'Use the host AI backend (tokens only — your API key is NEVER exposed to the plugin), or register a new AI provider.',
  },
  [CAPABILITIES.AUTH]: {
    title: 'Login / unlock methods',
    ctx: 'ctx.auth.registerLoginMethod({ id, label, authenticate })',
    notes: 'Add an alternate way to unlock the local identity (e.g. biometrics, passkey). SENSITIVE — user must approve.',
  },
  [CAPABILITIES.TEAMS]: {
    title: 'Teams',
    ctx: 'ctx.teams.onTeamOpen(cb) · ctx.teams.registerTeamAction(...) · ctx.teams.list()',
    notes: 'See team names and PUBLIC roster fields (never keys), react to team-open, add a team action.',
  },
  [CAPABILITIES.STORAGE]: {
    title: 'Namespaced storage',
    ctx: 'ctx.storage.get(key) · ctx.storage.set(key, value) · ctx.storage.delete(key) · ctx.storage.keys()',
    notes: 'Persist your own settings, namespaced to this plugin.',
  },
  [CAPABILITIES.FS_READ]: {
    title: 'Filesystem read',
    ctx: 'ctx.fs.read(path) · ctx.fs.list(dir)',
    notes: 'Read files inside the workspace. SENSITIVE — user must approve.',
  },
  [CAPABILITIES.FS_WRITE]: {
    title: 'Filesystem write',
    ctx: 'ctx.fs.write(path, data)',
    notes: 'Write files inside the workspace. SENSITIVE — user must approve.',
  },
  [CAPABILITIES.CLIPBOARD]: {
    title: 'Clipboard',
    ctx: 'ctx.ui.clipboardWrite(text) · ctx.ui.clipboardRead()',
    notes: 'Read/write the clipboard (only on a user gesture).',
  },
})

// The dynamic net:<host> capability is described inline (it is not a fixed enum).
const NET_GUIDE = Object.freeze({
  title: 'Network egress',
  ctx: 'ctx.net.fetch(url, opts) — requires a declared net:<host> capability',
  notes: 'Make network requests, but ONLY to hosts you declare as `net:api.example.com` (or `net:*.example.com`). `net:*` is rejected. SENSITIVE — user must approve.',
})

/* ------------------------------------------------------------------------- *
 * Group RPC methods by the capability they require (introspected from
 * METHOD_CAPABILITY in capabilities.js).
 * ------------------------------------------------------------------------- */

function methodsByCapability() {
  const out = new Map()
  try {
    for (const method of Object.keys(METHOD_CAPABILITY)) {
      const cap = METHOD_CAPABILITY[method]
      if (!out.has(cap)) out.set(cap, [])
      out.get(cap).push(method)
    }
  } catch (_) { /* defensive */ }
  return out
}

/* ------------------------------------------------------------------------- *
 * Read the live registry snapshot (what is registered RIGHT NOW). Optional —
 * `controller.registrySnapshot()` returns `{ surface: value[] }`. Plus the
 * editor block/decoration registry. All reads are guarded.
 * ------------------------------------------------------------------------- */

function liveRegistryCounts(controller) {
  const counts = {}
  try {
    if (controller && typeof controller.registrySnapshot === 'function') {
      const snap = controller.registrySnapshot() || {}
      for (const name of Object.keys(snap)) {
        const list = snap[name]
        counts[name] = Array.isArray(list) ? list.length : 0
      }
    }
  } catch (_) { /* ignore */ }
  // Editor blocks/decorations live in their own singleton registry.
  try {
    if (editorRegistry) {
      if (editorRegistry.blocks && typeof editorRegistry.blocks.size === 'number') {
        counts.editorBlocks = editorRegistry.blocks.size
      }
      if (editorRegistry.decorations && typeof editorRegistry.decorations.size === 'number') {
        counts.editorDecorations = editorRegistry.decorations.size
      }
    }
  } catch (_) { /* ignore */ }
  return counts
}

function fmtRegistryLine(counts) {
  const keys = Object.keys(counts)
  if (!keys.length) return '_No plugins currently contribute to any surface (a clean host)._'
  const parts = keys
    .filter((k) => counts[k] > 0)
    .map((k) => `${k}: ${counts[k]}`)
  if (!parts.length) return '_No plugins currently contribute to any surface (a clean host)._'
  return parts.join(' · ')
}

/* ------------------------------------------------------------------------- *
 * The public entry: build the full CAPABILITIES.md string.
 * ------------------------------------------------------------------------- */

/**
 * Build the live `CAPABILITIES.md` markdown for the Studio workspace bundle.
 *
 * @param {object} [controller] the live plugin controller (from initPluginSystem).
 *        Only `registrySnapshot()` is read, defensively. May be omitted.
 * @returns {string} the markdown document (always a string; never throws).
 */
export function buildCapabilitiesMarkdown(controller) {
  try {
    const methods = methodsByCapability()
    const counts = liveRegistryCounts(controller)

    const lines = []
    lines.push('# Notionless — live capability catalog (`apiVersion: "1"`)')
    lines.push('')
    lines.push(
      'This file is generated from the **running** Notionless host at the moment '
      + 'this workspace was created. It is the authoritative list of what a plugin '
      + 'can extend RIGHT NOW, the `ctx` call that registers each surface, the '
      + 'capability string the manifest must declare, and whether that capability is '
      + '**sensitive** (the user must explicitly approve it at install).',
    )
    lines.push('')
    lines.push('> Declare ONLY the capabilities your plugin actually uses. The host '
      + 're-checks every privileged call against the manifest — undeclared calls are '
      + 'denied with `CAPABILITY_DENIED`. Sensitive capabilities (`fs:*`, `auth`, '
      + '`net:<host>`) trigger an explicit approval prompt before first enable.')
    lines.push('')

    // ── Live registry summary ────────────────────────────────────────────────
    lines.push('## Currently registered (this host)')
    lines.push('')
    lines.push(fmtRegistryLine(counts))
    lines.push('')

    // ── Per-capability surface guide ─────────────────────────────────────────
    lines.push('## Capabilities & surfaces')
    lines.push('')

    const order = [
      CAPABILITIES.COMMANDS,
      CAPABILITIES.EDITOR,
      CAPABILITIES.UI,
      CAPABILITIES.SECTIONS,
      CAPABILITIES.VIEWS,
      CAPABILITIES.AI,
      CAPABILITIES.AUTH,
      CAPABILITIES.TEAMS,
      CAPABILITIES.STORAGE,
      CAPABILITIES.CLIPBOARD,
      CAPABILITIES.FS_READ,
      CAPABILITIES.FS_WRITE,
    ]

    for (const cap of order) {
      const guide = SURFACE_GUIDE[cap]
      if (!guide) continue
      const sensitive = isSensitiveCapability(cap)
      const desc = (() => {
        try { return describeCapability(cap) } catch (_) { return guide.title }
      })()
      lines.push(`### \`${cap}\`${sensitive ? '  — ⚠ sensitive (needs approval)' : ''}`)
      lines.push('')
      lines.push(`**${guide.title}** — ${desc}`)
      lines.push('')
      lines.push(`- ctx: \`${guide.ctx}\``)
      const ms = methods.get(cap)
      if (ms && ms.length) {
        lines.push(`- RPC methods: ${ms.map((m) => `\`${m}\``).join(', ')}`)
      }
      if (guide.notes) lines.push(`- ${guide.notes}`)
      lines.push('')
    }

    // ── net:<host> (dynamic) ─────────────────────────────────────────────────
    lines.push('### `net:<host>`  — ⚠ sensitive (needs approval)')
    lines.push('')
    lines.push(`**${NET_GUIDE.title}** — ${NET_GUIDE.notes}`)
    lines.push('')
    lines.push(`- ctx: \`${NET_GUIDE.ctx}\``)
    const netMethods = methods.get('net')
    if (netMethods && netMethods.length) {
      lines.push(`- RPC methods: ${netMethods.map((m) => `\`${m}\``).join(', ')}`)
    }
    lines.push('')

    // ── Footer: the deliverable shape ────────────────────────────────────────
    lines.push('## Deliverable')
    lines.push('')
    lines.push('Write your plugin into the `plugin/` subfolder of this workspace:')
    lines.push('')
    lines.push('- `plugin/plugin.json` — the manifest (id reverse-DNS, name, version, '
      + '`apiVersion: "1"`, description, author, license, entry, capabilities[]).')
    lines.push('- `plugin/index.js` — the ESM entry: '
      + '`import { definePlugin } from "@notionless/plugin-sdk"` then '
      + '`export default definePlugin({ async activate(ctx) { … } })`.')
    lines.push('- any assets (e.g. `plugin/style.css`).')
    lines.push('')
    lines.push('See `docs/PLUGIN_API_CONTRACT.md`, `types.d.ts`, and the `examples/` '
      + 'folder in this workspace for working references.')
    lines.push('')

    return lines.join('\n')
  } catch (e) {
    // Absolute last resort: a minimal valid doc so workspace creation never fails.
    return [
      '# Notionless — capability catalog (apiVersion "1")',
      '',
      '_(The live catalog could not be generated: '
        + ((e && e.message) || String(e)) + '.)_',
      '',
      'Declare only the capabilities you use. See docs/PLUGIN_API_CONTRACT.md and the',
      'examples/ folder. Write your plugin into the plugin/ subfolder.',
      '',
    ].join('\n')
  }
}

export default buildCapabilitiesMarkdown
