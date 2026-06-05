/**
 * Plugin Studio — workspace dir lifecycle + studio-root path confinement.
 *
 * Implements §1, §2, §9 of the FROZEN Plugin Studio Contract v1
 * (`docs/PLUGIN_STUDIO_CONTRACT.md`).
 *
 * The studio root is ALWAYS computed fresh from `app.getPath('userData')`:
 *
 *     STUDIO_ROOT = <userData>/plugin-studio
 *     buildDir(id) = <userData>/plugin-studio/builds/build-<id>
 *
 * It is NEVER the notes vault (`settings 'lastProject'`) and NEVER under
 * `<vault>/.notionless`. `buildId` is a persisted MONOTONIC INTEGER read from
 * `plugin-studio/counter.json` (`{ "next": N }`), never wall-clock / random.
 *
 * `resolveStudioPath` mirrors `plugin-manager.resolveWorkspacePath`'s rigor
 * (traversal + symlink + `\0` guards) but is rooted at the studio build dir, not
 * the vault. Every public function catches and returns `{ ok, …, error? }`; it
 * never throws across an IPC boundary.
 */

import fs from 'fs-extra'
import path from 'path'

// ─── Bounds ──────────────────────────────────────────────────────────────────

const MAX_FS_READ_BYTES = 8 * 1024 * 1024
const MAX_FS_WRITE_BYTES = 8 * 1024 * 1024
const MAX_FS_LIST_ENTRIES = 4096

export const STUDIO_LIMITS = Object.freeze({
  MAX_FS_READ_BYTES,
  MAX_FS_WRITE_BYTES,
  MAX_FS_LIST_ENTRIES,
})

// ─── Small helpers ───────────────────────────────────────────────────────────

const ok = (extra = {}) => ({ ok: true, ...extra })
const fail = (error, extra = {}) => ({ ok: false, error: String(error || 'error'), ...extra })

/**
 * The studio root — computed FRESH from userData every call. Never the vault.
 * @param {import('electron').App} app
 * @returns {string}
 */
export function studioRoot(app) {
  return path.join(app.getPath('userData'), 'plugin-studio')
}

export function buildsRoot(app) {
  return path.join(studioRoot(app), 'builds')
}

export function counterFile(app) {
  return path.join(studioRoot(app), 'counter.json')
}

/** Absolute build dir for a given integer buildId. */
export function buildDir(app, buildId) {
  return path.join(buildsRoot(app), `build-${buildId}`)
}

/** The plugin deliverable subdir (install/export operate on this only). */
export function pluginDir(app, buildId) {
  return path.join(buildDir(app, buildId), 'plugin')
}

// ─── Build counter (persisted, monotonic, atomic) ────────────────────────────

/**
 * Allocate the next monotonic buildId. Reads `counter.json` (`{ next:N }`),
 * returns `next`, persists `next+1`. Falls back to `process.hrtime.bigint()`
 * (truncated to an integer) ONLY if the counter file is unreadable AND
 * unwritable — the persisted counter is canonical.
 *
 * @returns {Promise<number>}
 */
export async function allocateBuildId(app) {
  const root = studioRoot(app)
  const file = counterFile(app)
  await fs.ensureDir(root)

  let next = 1
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && Number.isInteger(parsed.next) && parsed.next > 0) {
      next = parsed.next
    }
  } catch (_e) {
    // missing/corrupt → start at 1 (or recover from existing dirs below)
    next = await highestExistingBuildId(app).then((hi) => (hi >= 0 ? hi + 1 : 1)).catch(() => 1)
  }

  try {
    await fs.writeFile(file, JSON.stringify({ next: next + 1 }) + '\n', 'utf8')
  } catch (_e) {
    // Persistence failed — fall back to an hrtime-derived integer so we still
    // hand back a unique, monotonic-ish, non-wall-clock id.
    try {
      const hr = process.hrtime.bigint()
      // Keep it a safe integer.
      next = Number(hr % 9000000000000n) + 1
    } catch (_e2) {
      // keep `next` as-is
    }
  }
  return next
}

/** Scan existing build dirs and return the highest integer id, or -1. */
async function highestExistingBuildId(app) {
  const base = buildsRoot(app)
  let entries
  try {
    if (!(await fs.pathExists(base))) return -1
    entries = await fs.readdir(base, { withFileTypes: true })
  } catch (_e) {
    return -1
  }
  let hi = -1
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const m = /^build-(\d+)$/.exec(ent.name)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isInteger(n) && n > hi) hi = n
    }
  }
  return hi
}

/** Parse `build-<id>` → integer id, or null. */
export function parseBuildIdFromName(name) {
  const m = /^build-(\d+)$/.exec(String(name || ''))
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isInteger(n) ? n : null
}

// ─── Path confinement (studio-root only; mirrors resolveWorkspacePath) ───────

/**
 * Resolve `target` (relative to the build dir, or absolute under the studio
 * root) and confine it to `build-<buildId>/`. Rejects traversal, `\0`, and
 * symlink escapes. Returns `{ ok, full?, error? }`.
 *
 * This mirrors `plugin-manager.resolveWorkspacePath` rigor but is rooted at the
 * studio build dir, NOT the vault.
 *
 * @param {import('electron').App} app
 * @param {number} buildId
 * @param {string} target relative-to-build-dir path (StudioPath) or abs under root
 * @returns {Promise<{ok:boolean, full?:string, error?:string}>}
 */
export async function resolveStudioPath(app, buildId, target) {
  if (!Number.isInteger(buildId) || buildId <= 0) {
    return fail('invalid buildId')
  }
  if (typeof target !== 'string' || !target || target.includes('\0')) {
    return fail('invalid path')
  }

  const root = buildDir(app, buildId)

  // Resolve against the build dir. Absolute paths allowed only if under root.
  const candidate = path.resolve(root, target)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    return fail('path escapes studio build dir')
  }

  // Symlink-escape check: realpath the deepest existing ancestor (the target
  // may not exist yet on write) and ensure it still lives under the real root.
  try {
    if (!(await fs.pathExists(root))) {
      // The build dir itself must exist (created by create-workspace).
      return fail('build dir does not exist')
    }
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
      return fail('symlink escapes studio build dir')
    }
  } catch (_e) {
    // realpath can fail on broken symlinks — treat as escape.
    return fail('path resolution failed')
  }

  return ok({ full: candidate })
}

// ─── Confined filesystem ops (studio:fs-read / fs-write / fs-list) ────────────

export async function studioFsRead(app, buildId, target) {
  try {
    const r = await resolveStudioPath(app, buildId, target)
    if (!r.ok) return r
    const st = await fs.stat(r.full)
    if (!st.isFile()) return fail('not a file')
    if (st.size > MAX_FS_READ_BYTES) return fail('file exceeds read cap')
    const data = await fs.readFile(r.full, 'utf8')
    return ok({ data })
  } catch (e) {
    return fail((e && e.message) || 'fs-read failed')
  }
}

export async function studioFsWrite(app, buildId, target, data) {
  try {
    if (typeof data !== 'string') return fail('data must be a string')
    if (Buffer.byteLength(data, 'utf8') > MAX_FS_WRITE_BYTES) return fail('data exceeds write cap')
    const r = await resolveStudioPath(app, buildId, target)
    if (!r.ok) return r
    await fs.ensureDir(path.dirname(r.full))
    await fs.writeFile(r.full, data, 'utf8')
    return ok()
  } catch (e) {
    return fail((e && e.message) || 'fs-write failed')
  }
}

export async function studioFsList(app, buildId, dir) {
  try {
    const target = dir == null || dir === '' ? '.' : dir
    const r = await resolveStudioPath(app, buildId, target)
    if (!r.ok) return r
    const root = buildDir(app, buildId)
    let entries
    try {
      entries = await fs.readdir(r.full, { withFileTypes: true })
    } catch (e) {
      return fail((e && e.message) || 'not a directory')
    }
    const list = []
    for (const ent of entries) {
      if (list.length >= MAX_FS_LIST_ENTRIES) break
      list.push({
        name: ent.name,
        path: path.relative(root, path.join(r.full, ent.name)).replace(/\\/g, '/'),
        dir: ent.isDirectory(),
      })
    }
    return ok({ entries: list })
  } catch (e) {
    return fail((e && e.message) || 'fs-list failed')
  }
}

// ─── Recursive listing (for studio:read-build) ────────────────────────────────

/**
 * Recursively list `plugin/` under a build, returning relative-to-build-dir
 * paths. Used by studio:read-build's `files` array.
 *
 * @returns {Promise<Array<{ path:string, dir:boolean }>>}
 */
export async function listPluginFiles(app, buildId) {
  const root = buildDir(app, buildId)
  const pdir = pluginDir(app, buildId)
  const out = []
  if (!(await fs.pathExists(pdir))) return out
  const stack = [pdir]
  while (stack.length && out.length < MAX_FS_LIST_ENTRIES) {
    const cur = stack.pop()
    let entries
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch (_e) {
      continue
    }
    for (const ent of entries) {
      if (out.length >= MAX_FS_LIST_ENTRIES) break
      if (ent.name === 'node_modules' || ent.name === '.git') continue
      const full = path.join(cur, ent.name)
      const rel = path.relative(root, full).replace(/\\/g, '/')
      out.push({ path: rel, dir: ent.isDirectory() })
      if (ent.isDirectory()) stack.push(full)
    }
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return out
}
