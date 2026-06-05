/**
 * Plugin Studio — main-process StudioManager.
 *
 * Implements EVERY `studio:*` IPC channel from the FROZEN Plugin Studio
 * Contract v1 (`docs/PLUGIN_STUDIO_CONTRACT.md`, §3):
 *
 *   Workspace lifecycle:  studio:create-workspace · list-builds · read-build ·
 *                         delete-build · open-external
 *   Confined filesystem:  studio:fs-read · fs-write · fs-list   (studio-root only)
 *   Build / ship:         studio:build-check · export · install-build
 *   Agent driver:         studio:agent-detect · agent-start · agent-send · agent-cancel
 *
 * Conventions inherited from the host (§ "Conventions"):
 *  - Every handler catches and returns a JSON-serializable `{ ok, …, error? }`
 *    and NEVER throws across the IPC boundary.
 *  - Streamed agent events ride the existing `message` channel:
 *      webContents.send('message', 'studio:event', { sessionId, ev })
 *  - `buildId` is a persisted MONOTONIC INTEGER (workspace.allocateBuildId);
 *    `sessionId` is a monotonic integer owned here. Never Date.now()/random.
 *
 * SECURITY INVARIANTS (§10):
 *  - The studio root is `<userData>/plugin-studio`, computed fresh per call;
 *    NEVER the notes vault, NEVER `.notionless/`. `studio:fs-*` is confined with
 *    the same rigor as `plugin-manager.resolveWorkspacePath`.
 *  - The bundle contains only PUBLIC docs/types/examples — no notes, no keys.
 *  - `studio:install-build` defaults the plugin DISABLED so the normal
 *    capability-approval flow gates activation.
 *  - Main never executes the produced plugin code; `build-check` only runs
 *    `node --check` (syntax) and a manifest validation.
 *
 * Export: `registerStudioIpc(app, { getWorkspaceRoot, getMainWindow })`.
 * Idempotent (`_registered` guard), mirroring `registerPluginIpc`. Gated by the
 * caller (the feature flag check lives at the call site in index.js).
 */

import { ipcMain, BrowserWindow, shell } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import { spawn } from 'child_process'
import settings from 'electron-settings'
import chokidar from 'chokidar'

import {
  studioRoot,
  buildsRoot,
  buildDir,
  pluginDir,
  allocateBuildId,
  parseBuildIdFromName,
  resolveStudioPath,
  studioFsRead,
  studioFsWrite,
  studioFsList,
  listPluginFiles,
} from './workspace.js'
import { writeContextBundle } from './context-bundle.js'
import { buildNlpluginZip } from './zip.js'

// The agent provider registry (separate builder). Imported defensively so a
// missing/partial module never breaks workspace lifecycle or fs channels.
import * as providerRegistry from './agent-providers/index.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const API_VERSION = '1'
const MANIFEST_FILE = 'plugin.json'
const SETTINGS_ENABLED_KEY = 'plugin_enabled' // shared with plugin-manager.js (§7)

const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_ENTRY_SOURCE_BYTES = 5 * 1024 * 1024
const MAX_ASSET_BYTES = 2 * 1024 * 1024
const MAX_ASSETS = 128
const MAX_PLUGIN_DIR_BYTES = 25 * 1024 * 1024
const NODE_CHECK_TIMEOUT_MS = 10000

const ASSET_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.css',
])

// ─── Module state ──────────────────────────────────────────────────────────────

let _app = null
let _getMainWindow = () => null
let _registered = false
let _watcher = null
let _nextSessionId = 1
const _sessions = new Map() // sessionId → { session, providerId, buildId }
const _watchDebounce = new Map() // buildId → timer

// ─── Helpers ────────────────────────────────────────────────────────────────────

const ok = (extra = {}) => ({ ok: true, ...extra })
const fail = (error, extra = {}) => ({ ok: false, error: String(error || 'error'), ...extra })

function isPosInt(n) {
  return Number.isInteger(n) && n > 0
}

/** Resolve a webContents to push studio:event over the `message` channel. */
function mainWebContents() {
  try {
    const win = (_getMainWindow && _getMainWindow()) || null
    if (win && !win.isDestroyed && !win.isDestroyed()) return win.webContents
  } catch (_e) { /* fall through */ }
  const any = BrowserWindow.getAllWindows().find((w) => w && !w.isDestroyed())
  return any ? any.webContents : null
}

function sendStudioEvent(sessionId, ev) {
  const wc = mainWebContents()
  if (wc && !wc.isDestroyed()) {
    try { wc.send('message', 'studio:event', { sessionId, ev }) } catch (_e) { /* noop */ }
  }
}

// ─── Manifest validation (replicated pure function — single source is §2) ─────
// plugin-manager.js does not export validateManifest; this is a verbatim copy of
// its pure validator so build-check / install agree with the host exactly.

const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const KNOWN_CAPS = new Set([
  'commands', 'editor', 'ui', 'sections', 'views', 'ai', 'auth', 'teams',
  'storage', 'fs:read', 'fs:write', 'clipboard',
])

function isValidNetCapability(cap) {
  if (typeof cap !== 'string' || !cap.startsWith('net:')) return false
  const rest = cap.slice(4)
  if (!rest || rest === '*') return false
  const host = rest.startsWith('*.') ? rest.slice(2) : rest
  if (!host || host === '*') return false
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)
}

function isValidCapability(cap) {
  if (typeof cap !== 'string') return false
  if (KNOWN_CAPS.has(cap)) return true
  if (cap.startsWith('net:')) return isValidNetCapability(cap)
  return false
}

/** Returns `{ ok, error?, manifest? }`. Mirror of plugin-manager.validateManifest. */
function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    return { ok: false, error: 'manifest is not an object' }
  }
  const reqStr = ['id', 'name', 'version', 'apiVersion', 'description', 'author', 'license', 'entry']
  for (const k of reqStr) {
    if (typeof m[k] !== 'string' || !m[k].trim()) {
      return { ok: false, error: `manifest.${k} is required and must be a non-empty string` }
    }
  }
  if (!ID_RE.test(m.id)) {
    return { ok: false, error: `manifest.id must be reverse-DNS lowercase: ${m.id}` }
  }
  if (m.name.length > 60) return { ok: false, error: 'manifest.name exceeds 60 chars' }
  if (!SEMVER_RE.test(m.version)) return { ok: false, error: `manifest.version must be semver: ${m.version}` }
  if (m.apiVersion !== API_VERSION) {
    return { ok: false, error: `manifest.apiVersion must be "${API_VERSION}" (got "${m.apiVersion}")` }
  }
  if (m.description.length > 200) return { ok: false, error: 'manifest.description exceeds 200 chars' }
  if (m.minHostVersion != null && (typeof m.minHostVersion !== 'string' || !SEMVER_RE.test(m.minHostVersion))) {
    return { ok: false, error: 'manifest.minHostVersion must be semver when present' }
  }
  const entry = String(m.entry)
  if (path.isAbsolute(entry) || entry.includes('\0')) {
    return { ok: false, error: 'manifest.entry must be a relative path' }
  }
  const entryNorm = path.normalize(entry).replace(/\\/g, '/')
  if (entryNorm.startsWith('..') || entryNorm.includes('/../') || entryNorm === '..') {
    return { ok: false, error: 'manifest.entry path traversal rejected' }
  }
  if (!Array.isArray(m.capabilities)) {
    return { ok: false, error: 'manifest.capabilities must be an array' }
  }
  for (const cap of m.capabilities) {
    if (!isValidCapability(cap)) {
      return { ok: false, error: `manifest.capabilities contains an invalid/too-broad capability: ${JSON.stringify(cap)}` }
    }
  }
  if (m.icon != null) {
    const icon = String(m.icon)
    if (path.isAbsolute(icon) || path.normalize(icon).replace(/\\/g, '/').startsWith('..')) {
      return { ok: false, error: 'manifest.icon must be a safe relative path' }
    }
  }
  return { ok: true, manifest: m }
}

// ─── Enabled-state store (shared key with plugin-manager.js) ──────────────────

function setEnabled(id, enabled) {
  let map = {}
  try {
    const v = settings.getSync(SETTINGS_ENABLED_KEY)
    if (v && typeof v === 'object' && !Array.isArray(v)) map = v
  } catch (_e) { /* default {} */ }
  if (enabled) map[id] = true
  else delete map[id]
  try { settings.setSync(SETTINGS_ENABLED_KEY, map) } catch (_e) { /* best-effort */ }
}

// ─── Build metadata / listing ──────────────────────────────────────────────────

/** Read plugin.json for a build → parsed object or null (no throw). */
async function readBuildManifest(buildId) {
  try {
    const file = path.join(pluginDir(_app, buildId), MANIFEST_FILE)
    if (!(await fs.pathExists(file))) return null
    const st = await fs.stat(file)
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return null
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch (_e) {
    return null
  }
}

// ─── studio:create-workspace ────────────────────────────────────────────────────

async function handleCreateWorkspace(args = {}) {
  try {
    const {
      goal, template, capabilitiesMarkdown, remixFrom,
    } = args || {}
    const buildId = await allocateBuildId(_app)
    if (!isPosInt(buildId)) return fail('failed to allocate buildId')

    const dir = buildDir(_app, buildId)
    await fs.ensureDir(dir)

    const res = await writeContextBundle(dir, {
      buildId,
      template: typeof template === 'string' ? template : undefined,
      remixFrom: typeof remixFrom === 'string' ? remixFrom : undefined,
      capabilitiesMarkdown: typeof capabilitiesMarkdown === 'string' ? capabilitiesMarkdown : undefined,
      goal: typeof goal === 'string' ? goal : undefined,
    })
    if (!res.ok) return fail(res.error || 'failed to write context bundle')

    // Persist a tiny meta sidecar for list-builds (createdAt + goal).
    try {
      await fs.writeFile(
        path.join(dir, '.studio-meta.json'),
        JSON.stringify({ buildId, createdAt: Date.now(), goal: typeof goal === 'string' ? goal : '' }) + '\n',
        'utf8',
      )
    } catch (_e) { /* best-effort */ }

    ensureWatcher()
    return ok({ buildId, dir })
  } catch (e) {
    return fail((e && e.message) || 'create-workspace failed')
  }
}

// ─── studio:list-builds ──────────────────────────────────────────────────────────

async function handleListBuilds() {
  try {
    const base = buildsRoot(_app)
    if (!(await fs.pathExists(base))) return ok({ builds: [] })
    const entries = await fs.readdir(base, { withFileTypes: true })
    const builds = []
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const buildId = parseBuildIdFromName(ent.name)
      if (!isPosInt(buildId)) continue
      const dir = path.join(base, ent.name)
      let createdAt = 0
      let goal
      try {
        const metaRaw = await fs.readFile(path.join(dir, '.studio-meta.json'), 'utf8')
        const meta = JSON.parse(metaRaw)
        if (meta && Number.isFinite(meta.createdAt)) createdAt = meta.createdAt
        if (meta && typeof meta.goal === 'string' && meta.goal) goal = meta.goal
      } catch (_e) {
        // Fall back to dir mtime.
        try { const st = await fs.stat(dir); createdAt = st.mtimeMs } catch (_e2) { /* 0 */ }
      }
      builds.push({ buildId, dir, name: ent.name, createdAt, ...(goal ? { goal } : {}) })
    }
    builds.sort((a, b) => b.buildId - a.buildId)
    return ok({ builds })
  } catch (e) {
    return fail((e && e.message) || 'list-builds failed', { builds: [] })
  }
}

// ─── studio:read-build ────────────────────────────────────────────────────────

async function handleReadBuild(args = {}) {
  try {
    const buildId = args && args.buildId
    if (!isPosInt(buildId)) return fail('invalid buildId')
    const pdir = pluginDir(_app, buildId)
    if (!(await fs.pathExists(pdir))) return fail('build not found')

    const manifest = await readBuildManifest(buildId)

    // entrySource: the manifest's entry (default plugin/index.js → index.js inside plugin/).
    let entrySource = ''
    const entryRel = (manifest && typeof manifest.entry === 'string' && manifest.entry) || 'index.js'
    try {
      const entryFull = path.join(pdir, entryRel)
      const pdirSep = pdir.endsWith(path.sep) ? pdir : pdir + path.sep
      if (entryFull.startsWith(pdirSep)) {
        const st = await fs.stat(entryFull)
        if (st.isFile() && st.size <= MAX_ENTRY_SOURCE_BYTES) {
          entrySource = await fs.readFile(entryFull, 'utf8')
        }
      }
    } catch (_e) { /* entry missing → '' */ }

    // assets: non-entry plugin/ files → base64 (bounded).
    const assets = {}
    let count = 0
    const stack = ['']
    const normEntry = entryRel.replace(/\\/g, '/')
    while (stack.length && count < MAX_ASSETS) {
      const relDir = stack.pop()
      const absDir = path.join(pdir, relDir)
      let entries
      try { entries = await fs.readdir(absDir, { withFileTypes: true }) } catch (_e) { continue }
      for (const ent of entries) {
        if (count >= MAX_ASSETS) break
        if (ent.name === 'node_modules' || ent.name === '.git') continue
        const rel = (relDir ? `${relDir}/${ent.name}` : ent.name).replace(/\\/g, '/')
        if (ent.isDirectory()) { stack.push(rel); continue }
        if (rel === normEntry) continue
        const ext = path.extname(ent.name).toLowerCase()
        if (!ASSET_EXT.has(ext)) continue
        try {
          const st = await fs.stat(path.join(pdir, rel))
          if (st.size > MAX_ASSET_BYTES) continue
          const data = await fs.readFile(path.join(pdir, rel))
          assets[rel] = data.toString('base64')
          count++
        } catch (_e) { /* skip */ }
      }
    }

    const files = await listPluginFiles(_app, buildId)
    return ok({ manifest: manifest || null, entrySource, assets, files })
  } catch (e) {
    return fail((e && e.message) || 'read-build failed')
  }
}

// ─── studio:delete-build / open-external ──────────────────────────────────────

async function handleDeleteBuild(args = {}) {
  try {
    const buildId = args && args.buildId
    if (!isPosInt(buildId)) return fail('invalid buildId')
    const dir = buildDir(_app, buildId)
    if (!(await fs.pathExists(dir))) return ok() // already gone → success
    // Confine: must be under buildsRoot.
    const base = buildsRoot(_app)
    const baseSep = base.endsWith(path.sep) ? base : base + path.sep
    if (!dir.startsWith(baseSep)) return fail('refusing to delete outside builds root')
    try {
      await shell.trashItem(dir)
    } catch (_e) {
      // Fallback: hard remove (trash can fail on some FS).
      await fs.remove(dir)
    }
    return ok()
  } catch (e) {
    return fail((e && e.message) || 'delete-build failed')
  }
}

async function handleOpenExternal(args = {}) {
  try {
    const buildId = args && args.buildId
    if (!isPosInt(buildId)) return fail('invalid buildId')
    const dir = buildDir(_app, buildId)
    if (!(await fs.pathExists(dir))) return fail('build not found')
    const err = await shell.openPath(dir)
    if (err) return fail(err)
    return ok()
  } catch (e) {
    return fail((e && e.message) || 'open-external failed')
  }
}

// ─── studio:fs-read / fs-write / fs-list (confined) ───────────────────────────

async function handleFsRead(args = {}) {
  const { buildId, path: target } = args || {}
  if (!isPosInt(buildId)) return fail('invalid buildId')
  return studioFsRead(_app, buildId, target)
}

async function handleFsWrite(args = {}) {
  const { buildId, path: target, data } = args || {}
  if (!isPosInt(buildId)) return fail('invalid buildId')
  return studioFsWrite(_app, buildId, target, data)
}

async function handleFsList(args = {}) {
  const { buildId, dir } = args || {}
  if (!isPosInt(buildId)) return fail('invalid buildId')
  return studioFsList(_app, buildId, dir)
}

// ─── studio:build-check ───────────────────────────────────────────────────────

/** Run `node --check file` (cwd = plugin/). Returns null on pass, or an error string. */
function nodeCheckFile(file, cwd) {
  return new Promise((resolve) => {
    let done = false
    let child
    const finish = (val) => { if (!done) { done = true; resolve(val) } }
    try {
      child = spawn(process.execPath, ['--check', file], { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      finish(`${file}: ${(e && e.message) || 'spawn failed'}`)
      return
    }
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch (_e) { /* noop */ }
      finish(`${file}: node --check timed out`)
    }, NODE_CHECK_TIMEOUT_MS)
    if (child.stderr) {
      child.stderr.on('data', (d) => { stderr += String(d) })
    }
    child.on('error', (e) => { clearTimeout(timer); finish(`${file}: ${(e && e.message) || 'check failed'}`) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) finish(null)
      else finish(stderr.trim() || `${file}: syntax error (exit ${code})`)
    })
  })
}

/** Recursively collect .js files under a dir, relative to that dir. */
async function collectJsFiles(dir) {
  const out = []
  const stack = ['']
  while (stack.length) {
    const relDir = stack.pop()
    const absDir = path.join(dir, relDir)
    let entries
    try { entries = await fs.readdir(absDir, { withFileTypes: true }) } catch (_e) { continue }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue
      const rel = relDir ? path.join(relDir, ent.name) : ent.name
      if (ent.isDirectory()) { stack.push(rel); continue }
      if (ent.isFile() && path.extname(ent.name).toLowerCase() === '.js') out.push(rel)
    }
  }
  return out
}

async function handleBuildCheck(args = {}) {
  try {
    const buildId = args && args.buildId
    if (!isPosInt(buildId)) return fail('invalid buildId')
    const pdir = pluginDir(_app, buildId)
    if (!(await fs.pathExists(pdir))) return fail('build not found')

    const errors = []

    // 1) node --check on every .js in plugin/
    const jsFiles = await collectJsFiles(pdir)
    for (const rel of jsFiles) {
      const res = await nodeCheckFile(rel, pdir)
      if (res) errors.push(res)
    }

    // 2) manifest validation
    const manifestFile = path.join(pdir, MANIFEST_FILE)
    if (!(await fs.pathExists(manifestFile))) {
      errors.push('plugin.json not found')
    } else {
      let parsed = null
      try {
        parsed = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
      } catch (e) {
        errors.push(`plugin.json invalid JSON: ${(e && e.message) || 'parse error'}`)
      }
      if (parsed) {
        const v = validateManifest(parsed)
        if (!v.ok) errors.push(`manifest: ${v.error}`)
      }
    }

    // NOTE: top-level `ok:true` means the handler RAN; errors[] carries failures.
    return ok({ errors })
  } catch (e) {
    return fail((e && e.message) || 'build-check failed', { errors: [String((e && e.message) || 'build-check failed')] })
  }
}

// ─── studio:export ────────────────────────────────────────────────────────────

async function handleExport(args = {}) {
  try {
    const buildId = args && args.buildId
    if (!isPosInt(buildId)) return fail('invalid buildId')
    const pdir = pluginDir(_app, buildId)
    if (!(await fs.pathExists(pdir))) return fail('build not found')

    const manifest = await readBuildManifest(buildId)
    const pluginId = (manifest && typeof manifest.id === 'string' && ID_RE.test(manifest.id))
      ? manifest.id
      : `build-${buildId}`
    const outPath = path.join(buildDir(_app, buildId), `${pluginId}.nlplugin`)

    const res = await buildNlpluginZip(pdir, outPath)
    if (!res.ok) return fail(res.error || 'export failed')
    return ok({ path: res.path })
  } catch (e) {
    return fail((e && e.message) || 'export failed')
  }
}

// ─── studio:install-build ──────────────────────────────────────────────────────
// Reuses the EXISTING plugin:install folder path semantics. plugin-manager.js
// does not export handleInstall, so we replicate its folder-install body here:
// copy plugin/ → a staging dir under the studio root, validate the manifest,
// move into userData/plugins/<id>, default DISABLED. Activation still goes
// through the normal capability-approval flow.

async function dirSizeBytes(dir, cap) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = await fs.readdir(cur, { withFileTypes: true }) } catch (_e) { continue }
    for (const ent of entries) {
      const full = path.join(cur, ent.name)
      if (ent.isDirectory()) stack.push(full)
      else {
        try { const st = await fs.stat(full); total += st.size; if (total > cap) return total } catch (_e) { /* skip */ }
      }
    }
  }
  return total
}

async function handleInstallBuild(args = {}) {
  try {
    const buildId = args && args.buildId
    if (!isPosInt(buildId)) return fail('invalid buildId')
    const pdir = pluginDir(_app, buildId)
    if (!(await fs.pathExists(pdir))) return fail('build not found')

    // Validate the deliverable manifest before touching userData/plugins.
    const manifestFile = path.join(pdir, MANIFEST_FILE)
    if (!(await fs.pathExists(manifestFile))) return fail('plugin.json not found')
    let parsed
    try { parsed = JSON.parse(await fs.readFile(manifestFile, 'utf8')) } catch (e) {
      return fail(`plugin.json invalid JSON: ${(e && e.message) || 'parse error'}`)
    }
    const v = validateManifest(parsed)
    if (!v.ok) return fail(`invalid plugin: ${v.error}`)
    const id = v.manifest.id

    // Size cap (mirror plugin-manager install bound).
    const sz = await dirSizeBytes(pdir, MAX_PLUGIN_DIR_BYTES)
    if (sz > MAX_PLUGIN_DIR_BYTES) return fail('plugin folder exceeds size cap')

    const userPlugins = path.join(_app.getPath('userData'), 'plugins')
    await fs.ensureDir(userPlugins)
    const destDir = path.join(userPlugins, id)
    if (await fs.pathExists(destDir)) return fail(`plugin already installed: ${id}`)

    // Stage under the studio root (kept off the vault), then move into userData/plugins/<id>.
    const stageDir = path.join(studioRoot(_app), `.install-staging-${String(process.hrtime.bigint())}`)
    await fs.ensureDir(stageDir)
    try {
      await fs.copy(pdir, stageDir, {
        dereference: false,
        filter: (s) => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(s),
      })
      // Re-validate the staged copy (defense in depth).
      const stagedManifest = path.join(stageDir, MANIFEST_FILE)
      const v2 = validateManifest(JSON.parse(await fs.readFile(stagedManifest, 'utf8')))
      if (!v2.ok) return fail(`invalid plugin: ${v2.error}`)
      await fs.move(stageDir, destDir, { overwrite: false })
    } finally {
      try { if (await fs.pathExists(stageDir)) await fs.remove(stageDir) } catch (_e) { /* noop */ }
    }

    // Default DISABLED so the normal capability-approval/enable flow gates it.
    setEnabled(id, false)

    // Nudge the plugin-manager watcher consumer: the renderer will re-list.
    const wc = mainWebContents()
    if (wc && !wc.isDestroyed()) {
      try { wc.send('message', 'plugin:changed', { id }) } catch (_e) { /* noop */ }
    }

    return ok({ id })
  } catch (e) {
    return fail((e && e.message) || 'install-build failed')
  }
}

// ─── Agent driver (delegates to the imported provider registry) ───────────────

function listProvidersSafe() {
  try {
    if (typeof providerRegistry.listProviders === 'function') {
      const list = providerRegistry.listProviders()
      return Array.isArray(list) ? list : []
    }
  } catch (_e) { /* fall through */ }
  return []
}

function getProviderSafe(id) {
  try {
    if (typeof providerRegistry.getProvider === 'function') {
      return providerRegistry.getProvider(id) || null
    }
    // Fallback: scan listProviders.
    return listProvidersSafe().find((p) => p && p.id === id) || null
  } catch (_e) {
    return null
  }
}

async function handleAgentDetect() {
  try {
    const providers = []
    for (const p of listProvidersSafe()) {
      if (!p || typeof p.id !== 'string') continue
      let det = { available: false }
      try {
        if (typeof p.detect === 'function') det = await p.detect()
      } catch (e) {
        det = { available: false, reason: (e && e.message) || 'detect failed' }
      }
      providers.push({
        id: p.id,
        label: typeof p.label === 'string' ? p.label : p.id,
        kind: typeof p.kind === 'string' ? p.kind : 'cli',
        available: !!(det && det.available),
        ...(det && det.version ? { version: det.version } : {}),
        ...(det && det.reason ? { reason: det.reason } : {}),
      })
    }
    return ok({ providers })
  } catch (e) {
    return fail((e && e.message) || 'agent-detect failed', { providers: [] })
  }
}

async function handleAgentStart(args = {}) {
  try {
    const {
      buildId, providerId, goal, model,
    } = args || {}
    if (!isPosInt(buildId)) return fail('invalid buildId')
    if (typeof providerId !== 'string' || !providerId) return fail('missing providerId')
    const workspaceDir = buildDir(_app, buildId)
    if (!(await fs.pathExists(workspaceDir))) return fail('build not found')

    const provider = getProviderSafe(providerId)
    if (!provider || typeof provider.createSession !== 'function') {
      return fail(`unknown provider: ${providerId}`)
    }

    const sessionId = _nextSessionId++
    const systemContext = [
      'Plugin Studio workspace. Read CLAUDE.md / AGENTS.md / GEMINI.md, CAPABILITIES.md,',
      'docs/PLUGIN_API_CONTRACT.md, types.d.ts and examples/ in this directory.',
      'Edit ONLY the plugin/ subdir. It must pass node --check and manifest validation.',
    ].join(' ')

    const onEvent = (ev) => {
      try {
        if (ev && typeof ev === 'object' && typeof ev.type === 'string') sendStudioEvent(sessionId, ev)
      } catch (_e) { /* never throw out of an event callback */ }
    }

    let session
    try {
      session = provider.createSession({
        workspaceDir,
        systemContext,
        goal: typeof goal === 'string' ? goal : '',
        model: typeof model === 'string' ? model : undefined,
        onEvent,
      })
    } catch (e) {
      return fail(`failed to start session: ${(e && e.message) || 'createSession threw'}`)
    }
    if (!session || typeof session.send !== 'function' || typeof session.cancel !== 'function') {
      return fail('provider returned an invalid session')
    }

    _sessions.set(sessionId, { session, providerId, buildId })
    ensureWatcher()
    return ok({ sessionId })
  } catch (e) {
    return fail((e && e.message) || 'agent-start failed')
  }
}

async function handleAgentSend(args = {}) {
  try {
    const { sessionId, message } = args || {}
    if (!isPosInt(sessionId)) return fail('invalid sessionId')
    const entry = _sessions.get(sessionId)
    if (!entry) return fail('session not found')
    try {
      await entry.session.send(typeof message === 'string' ? message : '')
    } catch (e) {
      return fail(`send failed: ${(e && e.message) || 'session.send threw'}`)
    }
    return ok()
  } catch (e) {
    return fail((e && e.message) || 'agent-send failed')
  }
}

async function handleAgentCancel(args = {}) {
  try {
    const { sessionId } = args || {}
    if (!isPosInt(sessionId)) return fail('invalid sessionId')
    const entry = _sessions.get(sessionId)
    if (!entry) return ok() // already gone
    try { entry.session.cancel() } catch (_e) { /* best-effort */ }
    _sessions.delete(sessionId)
    return ok()
  } catch (e) {
    return fail((e && e.message) || 'agent-cancel failed')
  }
}

// ─── Studio chokidar watcher → studio:event file events (§3.5) ────────────────

function disposeWatcher() {
  if (_watcher) {
    try { _watcher.close() } catch (_e) { /* noop */ }
    _watcher = null
  }
  for (const t of _watchDebounce.values()) clearTimeout(t)
  _watchDebounce.clear()
}

/**
 * Watch each build's `plugin/` subdir and push a `studio:event` `file` event
 * (sessionId:0 — file events are session-agnostic; the renderer routes by
 * relative path + buildId via the changed path). We emit a synthetic event that
 * carries the relative-to-build-dir path so the renderer can hot-reload.
 */
function ensureWatcher() {
  // Watch the whole builds root (depth-limited) so newly created builds are seen.
  const base = buildsRoot(_app)
  if (!base) return
  if (_watcher) return // already watching the builds root
  try { fs.ensureDirSync(base) } catch (_e) { /* noop */ }

  _watcher = chokidar.watch(base, {
    persistent: true,
    ignoreInitial: true,
    depth: 8,
    ignored: (p) => /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p),
  })

  const emit = (filePath, action) => {
    // Only care about files under some build-<id>/plugin/.
    const baseSep = base.endsWith(path.sep) ? base : base + path.sep
    if (!filePath.startsWith(baseSep)) return
    const rel = filePath.slice(baseSep.length)
    const seg = rel.split(path.sep)
    const buildId = parseBuildIdFromName(seg[0])
    if (!isPosInt(buildId)) return
    if (seg[1] !== 'plugin') return // only the deliverable triggers hot-reload
    const relToBuild = seg.join('/') // e.g. plugin/index.js
    const key = `${buildId}:${relToBuild}`
    const prev = _watchDebounce.get(key)
    if (prev) clearTimeout(prev)
    _watchDebounce.set(key, setTimeout(() => {
      _watchDebounce.delete(key)
      // sessionId 0 = "not from a specific agent session" (external editor, etc.)
      // `path` is relative to the build dir, e.g. plugin/index.js (§4.1).
      sendStudioEvent(0, { type: 'file', path: relToBuild, action, buildId })
    }, 250))
  }

  _watcher.on('add', (p) => emit(p, 'create'))
  _watcher.on('change', (p) => emit(p, 'write'))
  _watcher.on('unlink', (p) => emit(p, 'delete'))
  _watcher.on('error', (e) => console.warn('[StudioManager] watcher error:', e && e.message))
}

// ─── Public entry ──────────────────────────────────────────────────────────────

/**
 * Register every `studio:*` ipcMain.handle channel. Idempotent. The caller
 * (index.js) is responsible for the `Features.pluginStudio` gate: when the flag
 * is off, this is simply never called and every channel is absent (the renderer
 * client normalizes the missing channel to `{ ok:false, error:'unsupported' }`).
 *
 * @param {import('electron').App} app
 * @param {{ getWorkspaceRoot?: () => (string|null), getMainWindow?: () => (import('electron').BrowserWindow|null) }} opts
 */
export function registerStudioIpc(app, opts = {}) {
  if (_registered) return
  _registered = true
  _app = app
  _getMainWindow = (opts && typeof opts.getMainWindow === 'function') ? opts.getMainWindow : () => null
  // getWorkspaceRoot is accepted for signature parity but intentionally UNUSED:
  // the studio root is always derived from userData, never the vault (§1).

  try { fs.ensureDirSync(studioRoot(app)) } catch (_e) { /* noop */ }
  try { fs.ensureDirSync(buildsRoot(app)) } catch (_e) { /* noop */ }

  // Hand the electron `app` to the CLI/external provider registry so it can
  // resolve the claude/gemini binaries (they probe the home dir). Defensive:
  // the registry never throws from configure().
  try {
    if (typeof providerRegistry.configure === 'function') providerRegistry.configure({ app })
  } catch (_e) { /* noop */ }

  const wrap = (fn) => async (_e, args) => {
    try {
      return await fn(args)
    } catch (err) {
      return fail(err && err.message ? err.message : 'studio handler error')
    }
  }

  ipcMain.handle('studio:create-workspace', wrap(handleCreateWorkspace))
  ipcMain.handle('studio:list-builds', wrap(handleListBuilds))
  ipcMain.handle('studio:read-build', wrap(handleReadBuild))
  ipcMain.handle('studio:delete-build', wrap(handleDeleteBuild))
  ipcMain.handle('studio:open-external', wrap(handleOpenExternal))

  ipcMain.handle('studio:fs-read', wrap(handleFsRead))
  ipcMain.handle('studio:fs-write', wrap(handleFsWrite))
  ipcMain.handle('studio:fs-list', wrap(handleFsList))

  ipcMain.handle('studio:build-check', wrap(handleBuildCheck))
  ipcMain.handle('studio:export', wrap(handleExport))
  ipcMain.handle('studio:install-build', wrap(handleInstallBuild))

  ipcMain.handle('studio:agent-detect', wrap(handleAgentDetect))
  ipcMain.handle('studio:agent-start', wrap(handleAgentStart))
  ipcMain.handle('studio:agent-send', wrap(handleAgentSend))
  ipcMain.handle('studio:agent-cancel', wrap(handleAgentCancel))

  ensureWatcher()
  console.log('[StudioManager] studio:* IPC handlers registered')
}

export function disposeStudioManager() {
  disposeWatcher()
  for (const { session } of _sessions.values()) {
    try { session.cancel() } catch (_e) { /* noop */ }
  }
  _sessions.clear()
}
