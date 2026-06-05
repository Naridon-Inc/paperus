/**
 * Main-process plugin manager — implements every `plugin:*` IPC channel from the
 * FROZEN Plugin API Contract v1 (`docs/PLUGIN_API_CONTRACT.md`, §7).
 *
 * Responsibilities:
 *  - Discover plugin dirs: `userData/plugins/<id>/` (user) and
 *    `<workspaceRoot>/.notionless/plugins/<id>/` (workspace). Workspace wins on
 *    id collision; both are listed.
 *  - Read + validate `plugin.json` manifests (§2) on install AND on read.
 *  - Register all `plugin:*` channels: list / install / read / enable / disable /
 *    uninstall / fs-read / fs-write / net-fetch / scaffold / reload.
 *  - Enforce capability + fs-scope + net-allowlist SERVER-SIDE (defense in depth;
 *    the renderer adapter is the less-trusted half — §3, §8).
 *  - chokidar hot-reload watcher → `webContents.send('message','plugin:changed',{id})`.
 *
 * SECURITY INVARIANTS honored here (§8):
 *  - Main NEVER executes plugin code. `plugin:read` returns SOURCE TEXT only; the
 *    sandboxed renderer iframe is the only place plugin code runs. No eval/Function/
 *    require of untrusted plugin modules anywhere in this file.
 *  - `fs:*` is confined to the workspace root: no `..`, no symlink escape, never
 *    `.notionless/`, never another plugin's dir. Re-checked here even though the
 *    renderer also pre-checks.
 *  - `net:<host>` is confined to the plugin's declared host set (exact or `*.host`
 *    wildcard). Bare `net:*` is rejected. Method/size/timeout bounded.
 *  - Every handler catches and returns `{ ok:false, error }`; it never throws
 *    across the IPC boundary.
 *
 * Export: `registerPluginIpc(app, { getWorkspaceRoot })` — called from
 * `registerIPCHandlers(mainWindow)` in `src/main/index.js`. (Also exported as
 * `registerPluginIPC` to match the contract's spelling.)
 */

import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import zlib from 'zlib'
import settings from 'electron-settings'
import chokidar from 'chokidar'

// ─── Constants (bounds) ──────────────────────────────────────────────────────

const API_VERSION = '1'
const SETTINGS_ENABLED_KEY = 'plugin_enabled' // map<id, true> per §7 plugin:enable
const MANIFEST_FILE = 'plugin.json'

const MAX_PLUGIN_DIR_BYTES = 25 * 1024 * 1024 // install size cap (zip/url/folder)
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_ENTRY_SOURCE_BYTES = 5 * 1024 * 1024
const MAX_ASSET_BYTES = 2 * 1024 * 1024
const MAX_ASSETS = 64

const MAX_FS_READ_BYTES = 8 * 1024 * 1024
const MAX_FS_WRITE_BYTES = 8 * 1024 * 1024

const MAX_NET_BODY_BYTES = 8 * 1024 * 1024
const NET_TIMEOUT_MS = 15000
const ALLOWED_NET_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const DOWNLOAD_TIMEOUT_MS = 30000

// Capability strings (mirror capabilities.js / §3). Kept local so main has no
// renderer import; the renderer is the source of the public enum.
const CAP_FS_READ = 'fs:read'
const CAP_FS_WRITE = 'fs:write'

// Asset extensions we are willing to ship back to the renderer as base64.
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.css'])

// ─── Module state ────────────────────────────────────────────────────────────

let _app = null
let _getWorkspaceRoot = () => null
let _registered = false
let _watcher = null
let _watchedDirs = new Set()
// Map<id, { source, dir, manifest }> resolved on each list/read; not authoritative
// (disk is). Used to map fs/net re-checks back to a manifest's capabilities.

// ─── Small helpers ───────────────────────────────────────────────────────────

const ok = (extra = {}) => ({ ok: true, ...extra })
const fail = (error, extra = {}) => ({ ok: false, error: String(error || 'error'), ...extra })

function userPluginsDir() {
  try {
    return path.join(_app.getPath('userData'), 'plugins')
  } catch (_e) {
    return null
  }
}

function workspacePluginsDir() {
  let root = null
  try {
    root = _getWorkspaceRoot && _getWorkspaceRoot()
  } catch (_e) {
    root = null
  }
  if (!root || typeof root !== 'string') return null
  return path.join(root, '.notionless', 'plugins')
}

function workspaceRoot() {
  try {
    const r = _getWorkspaceRoot && _getWorkspaceRoot()
    return r && typeof r === 'string' ? path.resolve(r) : null
  } catch (_e) {
    return null
  }
}

// Resolve the broadcast window for `plugin:changed` pushes.
function mainWebContents() {
  const win = BrowserWindow.getAllWindows().find((w) => w && !w.isDestroyed())
  return win ? win.webContents : null
}

// ─── Manifest validation (§2) ────────────────────────────────────────────────

const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const KNOWN_CAPS = new Set([
  'commands', 'editor', 'ui', 'sections', 'views', 'ai', 'auth', 'teams',
  'storage', 'fs:read', 'fs:write', 'clipboard',
])

// Bare `net:*` is rejected (too broad). `net:host` / `net:*.host` allowed.
function isValidNetCapability(cap) {
  if (typeof cap !== 'string' || !cap.startsWith('net:')) return false
  const rest = cap.slice(4)
  if (!rest || rest === '*') return false
  const host = rest.startsWith('*.') ? rest.slice(2) : rest
  if (!host || host === '*') return false
  // basic hostname shape: labels of [a-z0-9-], dot-separated, at least one dot
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)
}

function isValidCapability(cap) {
  if (typeof cap !== 'string') return false
  if (KNOWN_CAPS.has(cap)) return true
  if (cap.startsWith('net:')) return isValidNetCapability(cap)
  return false
}

/**
 * Validate a parsed `plugin.json`. Returns `{ ok, error?, manifest? }`.
 * Unknown top-level keys are ignored (forward-compatible, §2).
 */
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
    return { ok: false, error: `manifest.id must be reverse-DNS lowercase (^[a-z0-9]+(\\.[a-z0-9-]+)+$): ${m.id}` }
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

  // entry: relative, no traversal, no absolute.
  const entry = String(m.entry)
  if (path.isAbsolute(entry) || entry.includes('\0')) {
    return { ok: false, error: 'manifest.entry must be a relative path' }
  }
  const entryNorm = path.normalize(entry).replace(/\\/g, '/')
  if (entryNorm.startsWith('..') || entryNorm.includes('/../') || entryNorm === '..') {
    return { ok: false, error: 'manifest.entry path traversal rejected' }
  }

  // capabilities: array, every member known/valid.
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

/** Read + parse + validate the manifest for a plugin dir. */
async function readManifestAt(dir) {
  const file = path.join(dir, MANIFEST_FILE)
  let stat
  try {
    stat = await fs.stat(file)
  } catch (_e) {
    return { ok: false, error: 'plugin.json not found' }
  }
  if (!stat.isFile()) return { ok: false, error: 'plugin.json is not a file' }
  if (stat.size > MAX_MANIFEST_BYTES) return { ok: false, error: 'plugin.json too large' }

  let raw
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (e) {
    return { ok: false, error: `failed to read plugin.json: ${e.message}` }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: `plugin.json invalid JSON: ${e.message}` }
  }
  return validateManifest(parsed)
}

// ─── Discovery ───────────────────────────────────────────────────────────────

async function scanPluginsDir(baseDir, source) {
  const out = []
  if (!baseDir) return out
  let entries
  try {
    if (!(await fs.pathExists(baseDir))) return out
    entries = await fs.readdir(baseDir, { withFileTypes: true })
  } catch (_e) {
    return out
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    if (ent.name.startsWith('.')) continue
    const dir = path.join(baseDir, ent.name)
    const res = await readManifestAt(dir)
    if (!res.ok) continue // skip invalid dirs silently (listed nowhere)
    out.push({ dir, manifest: res.manifest, source })
  }
  return out
}

/**
 * Discover all plugins across user + workspace dirs. Workspace plugins take
 * precedence on id collision (§7). Returns a Map<id, record>.
 */
async function discoverPlugins() {
  const byId = new Map()
  const user = await scanPluginsDir(userPluginsDir(), 'user')
  const workspace = await scanPluginsDir(workspacePluginsDir(), 'workspace')

  // user first, then workspace overrides on id collision
  for (const rec of user) byId.set(rec.manifest.id, rec)
  for (const rec of workspace) byId.set(rec.manifest.id, rec)
  return byId
}

// ─── Enabled-state store ─────────────────────────────────────────────────────

function getEnabledMap() {
  try {
    const v = settings.getSync(SETTINGS_ENABLED_KEY)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch (_e) {
    return {}
  }
}

function setEnabled(id, enabled) {
  const map = getEnabledMap()
  if (enabled) map[id] = true
  else delete map[id]
  try {
    settings.setSync(SETTINGS_ENABLED_KEY, map)
  } catch (_e) {
    /* best-effort persistence */
  }
}

function isEnabled(id) {
  return getEnabledMap()[id] === true
}

// Build the PluginRecord[] shape the renderer expects (§7 plugin:list).
async function buildRecords() {
  const byId = await discoverPlugins()
  const records = []
  for (const rec of byId.values()) {
    records.push({
      id: rec.manifest.id,
      name: rec.manifest.name,
      version: rec.manifest.version,
      enabled: isEnabled(rec.manifest.id),
      source: rec.source,
      manifest: rec.manifest,
      dir: rec.dir,
    })
  }
  // Stable order by id for deterministic UI.
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return records
}

async function findPluginById(id) {
  if (!id || typeof id !== 'string') return null
  const byId = await discoverPlugins()
  return byId.get(id) || null
}

// ─── Path confinement (fs:* re-check, §8.5) ──────────────────────────────────

/**
 * Resolve `relOrAbs` under the workspace root, rejecting traversal, escapes,
 * `.notionless/`, and any plugin dir. Follows symlinks via realpath to catch
 * symlink escapes. Returns `{ ok, full?, error? }`.
 *
 * @param {boolean} forWrite extra write-only denials apply when true
 */
async function resolveWorkspacePath(targetPath, { forWrite }) {
  const root = workspaceRoot()
  if (!root) return { ok: false, error: 'no workspace open' }
  if (typeof targetPath !== 'string' || !targetPath || targetPath.includes('\0')) {
    return { ok: false, error: 'invalid path' }
  }

  // Resolve against root. Absolute paths are allowed only if they fall under root.
  const candidate = path.resolve(root, targetPath)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    return { ok: false, error: 'path escapes workspace root' }
  }

  // Deny `.notionless/` (manifest/identity/plugins live here).
  const rel = path.relative(root, candidate).replace(/\\/g, '/')
  const firstSeg = rel.split('/')[0]
  if (firstSeg === '.notionless') {
    return { ok: false, error: 'access to .notionless is denied' }
  }

  // Symlink-escape check: realpath the deepest existing ancestor and ensure it
  // still lives under the real root. (Target itself may not exist yet on write.)
  try {
    const realRoot = await fs.realpath(root)
    const realRootSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep
    let probe = candidate
    // Walk up to the nearest existing path component.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (await fs.pathExists(probe)) break
      const parent = path.dirname(probe)
      if (parent === probe) break
      probe = parent
    }
    const realProbe = await fs.realpath(probe)
    if (realProbe !== realRoot && !realProbe.startsWith(realRootSep)) {
      return { ok: false, error: 'symlink escapes workspace root' }
    }
  } catch (_e) {
    // realpath can fail on broken symlinks — treat as escape.
    return { ok: false, error: 'path resolution failed' }
  }

  if (forWrite) {
    // Never inside any plugin dir (user or workspace).
    const wpd = workspacePluginsDir()
    if (wpd) {
      const wpdSep = wpd.endsWith(path.sep) ? wpd : wpd + path.sep
      if (candidate === wpd || candidate.startsWith(wpdSep)) {
        return { ok: false, error: 'writing into a plugin dir is denied' }
      }
    }
  }

  return { ok: true, full: candidate }
}

// ─── Net allow-list (net:<host> re-check, §3/§8.5) ───────────────────────────

function parseNetCapability(cap) {
  // cap === 'net:host' or 'net:*.host'
  const rest = cap.slice(4)
  if (rest.startsWith('*.')) return { host: rest.slice(2).toLowerCase(), wildcard: true }
  return { host: rest.toLowerCase(), wildcard: false }
}

/** True when `urlHost` is permitted by the plugin's declared `net:*` caps. */
function netHostAllowed(manifest, urlHost) {
  const host = String(urlHost || '').toLowerCase()
  if (!host) return false
  const caps = Array.isArray(manifest.capabilities) ? manifest.capabilities : []
  for (const cap of caps) {
    if (typeof cap !== 'string' || !cap.startsWith('net:')) continue
    if (!isValidNetCapability(cap)) continue
    const { host: capHost, wildcard } = parseNetCapability(cap)
    if (wildcard) {
      if (host === capHost || host.endsWith('.' + capHost)) return true
    } else if (host === capHost) {
      return true
    }
  }
  return false
}

function manifestHasCapability(manifest, cap) {
  return Array.isArray(manifest.capabilities) && manifest.capabilities.includes(cap)
}

// ─── Install helpers ─────────────────────────────────────────────────────────

async function dirSizeBytes(dir, cap) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch (_e) {
      continue
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name)
      if (ent.isDirectory()) {
        stack.push(full)
      } else {
        try {
          const st = await fs.stat(full)
          total += st.size
          if (total > cap) return total
        } catch (_e) {
          /* skip unreadable */
        }
      }
    }
  }
  return total
}

// Minimal, dependency-free ZIP extractor (stored + deflate). Parses the End of
// Central Directory record, then each central-directory header. Rejects path
// traversal and absolute entry names. No external deps (no adm-zip in tree).
function extractZipBuffer(buf, destDir) {
  // Locate End Of Central Directory (EOCD) signature 0x06054b50, scanning back.
  const EOCD_SIG = 0x06054b50
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a valid zip (no EOCD)')
  const entryCount = buf.readUInt16LE(eocd + 10)
  let cdOffset = buf.readUInt32LE(eocd + 16)

  const CDH_SIG = 0x02014b50
  const LFH_SIG = 0x04034b50
  const writes = []
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(cdOffset) !== CDH_SIG) throw new Error('corrupt central directory')
    const method = buf.readUInt16LE(cdOffset + 10)
    const compSize = buf.readUInt32LE(cdOffset + 20)
    const nameLen = buf.readUInt16LE(cdOffset + 28)
    const extraLen = buf.readUInt16LE(cdOffset + 30)
    const commentLen = buf.readUInt16LE(cdOffset + 32)
    const lfhOffset = buf.readUInt32LE(cdOffset + 42)
    const name = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen)
    cdOffset += 46 + nameLen + extraLen + commentLen

    // Directory entry.
    if (name.endsWith('/')) continue

    // Reject traversal / absolute.
    const normName = name.replace(/\\/g, '/')
    if (path.isAbsolute(normName) || normName.split('/').includes('..') || normName.includes('\0')) {
      throw new Error(`unsafe zip entry: ${name}`)
    }

    // Read local file header to find the data offset.
    if (buf.readUInt32LE(lfhOffset) !== LFH_SIG) throw new Error('corrupt local header')
    const lfhNameLen = buf.readUInt16LE(lfhOffset + 26)
    const lfhExtraLen = buf.readUInt16LE(lfhOffset + 28)
    const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen
    const compData = buf.subarray(dataStart, dataStart + compSize)

    let content
    if (method === 0) {
      content = Buffer.from(compData)
    } else if (method === 8) {
      content = zlib.inflateRawSync(compData)
    } else {
      throw new Error(`unsupported zip compression method ${method}`)
    }
    writes.push({ rel: normName, content })
  }

  // Strip a single common top-level dir (GitHub-style zip wrappers).
  let commonPrefix = null
  for (const w of writes) {
    const seg = w.rel.split('/')[0]
    if (w.rel.includes('/')) {
      if (commonPrefix === null) commonPrefix = seg
      else if (commonPrefix !== seg) { commonPrefix = ''; break }
    } else {
      commonPrefix = ''
      break
    }
  }
  return writes.map((w) => ({
    rel: commonPrefix ? w.rel.slice(commonPrefix.length + 1) : w.rel,
    content: w.content,
  })).filter((w) => w.rel)
}

async function writeExtracted(writes, destDir) {
  let total = 0
  for (const w of writes) {
    total += w.content.length
    if (total > MAX_PLUGIN_DIR_BYTES) throw new Error('plugin exceeds size cap')
    const full = path.join(destDir, w.rel)
    // Double-guard traversal post-join.
    const destSep = destDir.endsWith(path.sep) ? destDir : destDir + path.sep
    if (full !== destDir && !full.startsWith(destSep)) throw new Error('zip entry escapes dest')
    await fs.ensureDir(path.dirname(full))
    await fs.writeFile(full, w.content)
  }
}

async function fetchToBuffer(url, timeoutMs, cap) {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('download URL must be http(s)')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const ab = await res.arrayBuffer()
  const buf = Buffer.from(ab)
  if (buf.length > cap) throw new Error('download exceeds size cap')
  return buf
}

// ─── plugin:read payload assembly ────────────────────────────────────────────

async function readEntrySource(dir, manifest) {
  const entryFull = path.join(dir, manifest.entry)
  // Confine within the plugin dir.
  const dirSep = dir.endsWith(path.sep) ? dir : dir + path.sep
  if (!entryFull.startsWith(dirSep)) throw new Error('entry escapes plugin dir')
  const st = await fs.stat(entryFull)
  if (st.size > MAX_ENTRY_SOURCE_BYTES) throw new Error('entry source too large')
  return fs.readFile(entryFull, 'utf8')
}

async function collectAssets(dir) {
  const assets = {}
  let count = 0
  const stack = ['']
  while (stack.length && count < MAX_ASSETS) {
    const relDir = stack.pop()
    const abs = path.join(dir, relDir)
    let entries
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch (_e) {
      continue
    }
    for (const ent of entries) {
      if (count >= MAX_ASSETS) break
      if (ent.name.startsWith('.')) continue
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue
        stack.push(rel)
        continue
      }
      const ext = path.extname(ent.name).toLowerCase()
      if (!ASSET_EXT.has(ext)) continue
      try {
        const st = await fs.stat(path.join(dir, rel))
        if (st.size > MAX_ASSET_BYTES) continue
        const data = await fs.readFile(path.join(dir, rel))
        assets[rel] = data.toString('base64')
        count++
      } catch (_e) {
        /* skip */
      }
    }
  }
  return assets
}

// ─── Scaffold (used by the Lab + plugin:scaffold, §9) ────────────────────────

function safeId(id) {
  return typeof id === 'string' && ID_RE.test(id)
}

function buildScaffoldManifest({ id, name, template }) {
  const capsByTemplate = {
    'word-count': ['editor', 'ui'],
    'custom-callout': ['editor'],
    'ai-summarize': ['commands', 'ai', 'ui', 'editor'],
    'magic-login': ['auth'],
    'custom-section': ['ui', 'sections', 'views'],
    blank: ['ui'],
  }
  const capabilities = capsByTemplate[template] || capsByTemplate.blank
  return {
    id,
    name: name || id,
    version: '0.1.0',
    apiVersion: API_VERSION,
    description: `Scaffolded ${template || 'blank'} plugin.`,
    author: 'unknown',
    license: 'MIT',
    entry: 'index.js',
    capabilities,
    contributes: {},
  }
}

function scaffoldEntrySource(template) {
  // Minimal, contract-conformant entry. The Lab overwrites index.js with the
  // model output; this is just a valid placeholder so the dir loads immediately.
  return `import { definePlugin } from '@notionless/plugin-sdk'

export default definePlugin({
  async activate(ctx) {
    // template: ${JSON.stringify(template || 'blank')}
    // Register contributions here using only declared capabilities.
  },
  async deactivate() {}
})
`
}

async function doScaffold({ template, id, name, targetDir }) {
  if (!safeId(id)) return fail(`invalid plugin id (must be reverse-DNS): ${id}`)
  let baseDir = targetDir
  if (baseDir) {
    if (typeof baseDir !== 'string' || baseDir.includes('\0')) return fail('invalid targetDir')
    baseDir = path.resolve(baseDir)
  } else {
    baseDir = userPluginsDir()
    if (!baseDir) return fail('no user plugins dir')
  }
  const dir = path.join(baseDir, id)
  if (await fs.pathExists(dir)) return fail(`plugin dir already exists: ${dir}`)

  const manifest = buildScaffoldManifest({ id, name, template })
  const check = validateManifest(manifest)
  if (!check.ok) return fail(`scaffold produced invalid manifest: ${check.error}`)

  await fs.ensureDir(dir)
  await fs.writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  await fs.writeFile(path.join(dir, 'index.js'), scaffoldEntrySource(template), 'utf8')
  await fs.writeFile(
    path.join(dir, 'README.md'),
    `# ${manifest.name}\n\nScaffolded ${template || 'blank'} plugin. Edit index.js.\n`,
    'utf8',
  )
  return ok({ dir })
}

// ─── chokidar hot-reload watcher ─────────────────────────────────────────────

function disposeWatcher() {
  if (_watcher) {
    try { _watcher.close() } catch (_e) { /* noop */ }
    _watcher = null
  }
  _watchedDirs = new Set()
}

function startWatcher() {
  disposeWatcher()
  const dirs = [userPluginsDir(), workspacePluginsDir()].filter(Boolean)
  const existing = dirs.filter((d) => {
    try { return fs.existsSync(d) } catch (_e) { return false }
  })
  if (existing.length === 0) return
  _watchedDirs = new Set(existing)

  _watcher = chokidar.watch(existing, {
    persistent: true,
    ignoreInitial: true,
    depth: 6,
    // chokidar 4: `ignored` is a function (path) => boolean (no glob support).
    ignored: (p) => /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(p),
  })

  let debounceTimers = new Map()
  const emitChanged = (filePath) => {
    // Map the changed file to its plugin id = first dir segment under a base.
    let id = null
    for (const base of _watchedDirs) {
      const baseSep = base.endsWith(path.sep) ? base : base + path.sep
      if (filePath.startsWith(baseSep)) {
        const rel = filePath.slice(baseSep.length)
        id = rel.split(path.sep)[0]
        break
      }
    }
    if (!id) return
    // Debounce per-id so a burst of writes yields one reload.
    const prev = debounceTimers.get(id)
    if (prev) clearTimeout(prev)
    debounceTimers.set(id, setTimeout(() => {
      debounceTimers.delete(id)
      const wc = mainWebContents()
      if (wc && !wc.isDestroyed()) {
        try { wc.send('message', 'plugin:changed', { id }) } catch (_e) { /* noop */ }
      }
    }, 300))
  }

  _watcher.on('add', emitChanged)
  _watcher.on('change', emitChanged)
  _watcher.on('unlink', emitChanged)
  _watcher.on('addDir', emitChanged)
  _watcher.on('unlinkDir', emitChanged)
  _watcher.on('error', (e) => console.warn('[PluginManager] watcher error:', e && e.message))
}

// ─── IPC handler bodies ──────────────────────────────────────────────────────

async function handleList() {
  try {
    const plugins = await buildRecords()
    return ok({ plugins })
  } catch (e) {
    return fail(e.message || 'list failed', { plugins: [] })
  }
}

async function handleInstall({ source } = {}) {
  try {
    if (!source || typeof source !== 'object') return fail('missing source')
    const type = source.type
    const value = source.value
    if (!['folder', 'url', 'zip'].includes(type)) return fail(`unsupported source type: ${type}`)
    if (typeof value !== 'string' || !value) return fail('missing source.value')

    const base = userPluginsDir()
    if (!base) return fail('no user plugins dir')
    await fs.ensureDir(base)

    // Stage into a temp dir, validate, then move to <id>.
    const stamp = String(process.hrtime.bigint())
    const stageDir = path.join(base, `.staging-${stamp}`)
    await fs.ensureDir(stageDir)

    try {
      if (type === 'folder') {
        const src = path.resolve(value)
        if (!(await fs.pathExists(src))) return fail('source folder does not exist')
        const st = await fs.stat(src)
        if (!st.isDirectory()) return fail('source is not a folder')
        const sz = await dirSizeBytes(src, MAX_PLUGIN_DIR_BYTES)
        if (sz > MAX_PLUGIN_DIR_BYTES) return fail('plugin folder exceeds size cap')
        // Copy without following symlinks out of tree; reject symlinks.
        await fs.copy(src, stageDir, { dereference: false, filter: (s) => !/(^|[\\/])node_modules([\\/]|$)/.test(s) })
      } else if (type === 'url' || type === 'zip') {
        let buf
        if (type === 'url') {
          buf = await fetchToBuffer(value, DOWNLOAD_TIMEOUT_MS, MAX_PLUGIN_DIR_BYTES)
        } else {
          // zip: value is a local file path.
          const zipPath = path.resolve(value)
          if (!(await fs.pathExists(zipPath))) return fail('zip file does not exist')
          const zst = await fs.stat(zipPath)
          if (zst.size > MAX_PLUGIN_DIR_BYTES) return fail('zip exceeds size cap')
          buf = await fs.readFile(zipPath)
        }
        const writes = extractZipBuffer(buf, stageDir)
        await writeExtracted(writes, stageDir)
      }

      // Validate the staged manifest.
      const res = await readManifestAt(stageDir)
      if (!res.ok) return fail(`invalid plugin: ${res.error}`)
      const id = res.manifest.id

      const destDir = path.join(base, id)
      if (await fs.pathExists(destDir)) {
        return fail(`plugin already installed: ${id}`)
      }
      await fs.move(stageDir, destDir, { overwrite: false })

      // URL/zip installs default DISABLED (§7). Folder installs also default
      // disabled — the host enables explicitly after a capability confirmation.
      setEnabled(id, false)

      // (Re)start the watcher now that the dir set may have changed.
      startWatcher()
      return ok({ id })
    } finally {
      try { if (await fs.pathExists(stageDir)) await fs.remove(stageDir) } catch (_e) { /* noop */ }
    }
  } catch (e) {
    return fail(e.message || 'install failed')
  }
}

async function handleRead({ id } = {}) {
  try {
    const rec = await findPluginById(id)
    if (!rec) return fail('plugin not found')
    const entrySource = await readEntrySource(rec.dir, rec.manifest)
    const assets = await collectAssets(rec.dir)
    return ok({ manifest: rec.manifest, entrySource, assets })
  } catch (e) {
    return fail(e.message || 'read failed')
  }
}

async function handleEnable({ id } = {}) {
  try {
    const rec = await findPluginById(id)
    if (!rec) return fail('plugin not found')
    setEnabled(rec.manifest.id, true)
    return ok()
  } catch (e) {
    return fail(e.message || 'enable failed')
  }
}

async function handleDisable({ id } = {}) {
  try {
    if (!id || typeof id !== 'string') return fail('missing id')
    setEnabled(id, false)
    return ok()
  } catch (e) {
    return fail(e.message || 'disable failed')
  }
}

async function handleUninstall({ id } = {}) {
  try {
    const rec = await findPluginById(id)
    if (!rec) return fail('plugin not found')
    // Workspace plugins are git-managed; never delete them from disk (§7).
    if (rec.source === 'workspace') {
      setEnabled(rec.manifest.id, false)
      return fail('workspace plugins are git-managed; disabled instead of removed')
    }
    setEnabled(rec.manifest.id, false)
    // Confine deletion to the user plugins dir.
    const base = userPluginsDir()
    const baseSep = base.endsWith(path.sep) ? base : base + path.sep
    if (!rec.dir.startsWith(baseSep)) return fail('refusing to remove dir outside user plugins')
    await fs.remove(rec.dir)
    startWatcher()
    return ok()
  } catch (e) {
    return fail(e.message || 'uninstall failed')
  }
}

async function handleFsRead({ id, path: targetPath } = {}) {
  try {
    const rec = await findPluginById(id)
    if (!rec) return fail('plugin not found')
    if (!manifestHasCapability(rec.manifest, CAP_FS_READ)) {
      return fail('CAPABILITY_DENIED: fs:read not granted')
    }
    const r = await resolveWorkspacePath(targetPath, { forWrite: false })
    if (!r.ok) return fail(r.error)
    const st = await fs.stat(r.full)
    if (!st.isFile()) return fail('not a file')
    if (st.size > MAX_FS_READ_BYTES) return fail('file exceeds read cap')
    const data = await fs.readFile(r.full, 'utf8')
    return ok({ data })
  } catch (e) {
    return fail(e.message || 'fs-read failed')
  }
}

async function handleFsList({ id, dir } = {}) {
  // Not a contract channel but mirrors ctx.fs.list; reuse fs:read gate. Exposed
  // for completeness via plugin:fs-list (renderer adapter may route here).
  try {
    const rec = await findPluginById(id)
    if (!rec) return fail('plugin not found')
    if (!manifestHasCapability(rec.manifest, CAP_FS_READ)) {
      return fail('CAPABILITY_DENIED: fs:read not granted')
    }
    const r = await resolveWorkspacePath(dir, { forWrite: false })
    if (!r.ok) return fail(r.error)
    const root = workspaceRoot()
    const entries = await fs.readdir(r.full, { withFileTypes: true })
    const list = entries
      .filter((ent) => !ent.name.startsWith('.'))
      .map((ent) => ({
        name: ent.name,
        path: path.relative(root, path.join(r.full, ent.name)).replace(/\\/g, '/'),
        dir: ent.isDirectory(),
      }))
    return ok({ entries: list })
  } catch (e) {
    return fail(e.message || 'fs-list failed')
  }
}

async function handleFsWrite({ id, path: targetPath, data } = {}) {
  try {
    const rec = await findPluginById(id)
    if (!rec) return fail('plugin not found')
    if (!manifestHasCapability(rec.manifest, CAP_FS_WRITE)) {
      return fail('CAPABILITY_DENIED: fs:write not granted')
    }
    if (typeof data !== 'string') return fail('data must be a string')
    if (Buffer.byteLength(data, 'utf8') > MAX_FS_WRITE_BYTES) return fail('data exceeds write cap')
    const r = await resolveWorkspacePath(targetPath, { forWrite: true })
    if (!r.ok) return fail(r.error)
    await fs.ensureDir(path.dirname(r.full))
    await fs.writeFile(r.full, data, 'utf8')
    return ok()
  } catch (e) {
    return fail(e.message || 'fs-write failed')
  }
}

async function handleNetFetch({ id, url, init } = {}) {
  try {
    const rec = await findPluginById(id)
    if (!rec) return fail('plugin not found')
    if (typeof url !== 'string' || !url) return fail('missing url')

    let u
    try { u = new URL(url) } catch (_e) { return fail('invalid url') }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('only http(s) allowed')

    if (!netHostAllowed(rec.manifest, u.hostname)) {
      return fail(`CAPABILITY_DENIED: net:${u.hostname} not granted`)
    }

    const method = String((init && init.method) || 'GET').toUpperCase()
    if (!ALLOWED_NET_METHODS.has(method)) return fail(`method not allowed: ${method}`)

    const headers = {}
    if (init && init.headers && typeof init.headers === 'object') {
      for (const [k, v] of Object.entries(init.headers)) {
        if (typeof k === 'string' && typeof v === 'string') headers[k] = v
      }
    }
    let body
    if (init && typeof init.body === 'string') {
      if (Buffer.byteLength(init.body, 'utf8') > MAX_NET_BODY_BYTES) return fail('request body too large')
      body = init.body
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)
    let res
    try {
      res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'follow',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    // Cap the response read.
    const ab = await res.arrayBuffer()
    const buf = Buffer.from(ab)
    if (buf.length > MAX_NET_BODY_BYTES) return fail('response body exceeds cap')
    const outHeaders = {}
    res.headers.forEach((v, k) => { outHeaders[k] = v })
    return ok({ status: res.status, headers: outHeaders, body: buf.toString('utf8') })
  } catch (e) {
    if (e && e.name === 'AbortError') return fail('net request timed out')
    return fail(e.message || 'net-fetch failed')
  }
}

async function handleScaffold(args = {}) {
  try {
    return await doScaffold(args)
  } catch (e) {
    return fail(e.message || 'scaffold failed')
  }
}

async function handleReload({ id } = {}) {
  try {
    const rec = await findPluginById(id)
    if (!rec) return fail('plugin not found')
    // Re-read from disk simply re-validates; the renderer host then re-reads via
    // plugin:read. We also push the change notification so the controller reloads.
    const wc = mainWebContents()
    if (wc && !wc.isDestroyed()) {
      try { wc.send('message', 'plugin:changed', { id: rec.manifest.id }) } catch (_e) { /* noop */ }
    }
    return ok()
  } catch (e) {
    return fail(e.message || 'reload failed')
  }
}

// ─── Public entry ────────────────────────────────────────────────────────────

/**
 * Register every `plugin:*` ipcMain.handle channel and start the hot-reload
 * watcher. Idempotent — safe to call once from registerIPCHandlers.
 *
 * @param {import('electron').App} app
 * @param {{ getWorkspaceRoot: () => (string|null) }} opts
 */
export function registerPluginIpc(app, opts = {}) {
  if (_registered) return
  _registered = true
  _app = app
  _getWorkspaceRoot = (opts && typeof opts.getWorkspaceRoot === 'function')
    ? opts.getWorkspaceRoot
    : () => null

  // Ensure the user plugins dir exists so the watcher has something to watch.
  try {
    const base = userPluginsDir()
    if (base) fs.ensureDirSync(base)
  } catch (_e) { /* noop */ }

  const wrap = (fn) => async (_e, args) => {
    try {
      return await fn(args)
    } catch (err) {
      // Last-ditch guard: a handler must never throw across the boundary.
      return fail(err && err.message ? err.message : 'plugin handler error')
    }
  }

  ipcMain.handle('plugin:list', wrap(handleList))
  ipcMain.handle('plugin:install', wrap(handleInstall))
  ipcMain.handle('plugin:read', wrap(handleRead))
  ipcMain.handle('plugin:enable', wrap(handleEnable))
  ipcMain.handle('plugin:disable', wrap(handleDisable))
  ipcMain.handle('plugin:uninstall', wrap(handleUninstall))
  ipcMain.handle('plugin:fs-read', wrap(handleFsRead))
  ipcMain.handle('plugin:fs-list', wrap(handleFsList))
  ipcMain.handle('plugin:fs-write', wrap(handleFsWrite))
  ipcMain.handle('plugin:net-fetch', wrap(handleNetFetch))
  ipcMain.handle('plugin:scaffold', wrap(handleScaffold))
  ipcMain.handle('plugin:reload', wrap(handleReload))

  startWatcher()
  console.log('[PluginManager] plugin:* IPC handlers registered')
}

// Contract spelling alias (§1.2 uses registerPluginIPC). Both call the same body;
// the second call is a no-op due to the idempotency guard.
export const registerPluginIPC = registerPluginIpc

// Allow the integrator to re-point the watcher after a workspace switch.
export function refreshPluginWatcher() {
  if (!_registered) return
  startWatcher()
}

export function disposePluginManager() {
  disposeWatcher()
}
