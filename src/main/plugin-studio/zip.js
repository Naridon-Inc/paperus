/**
 * Plugin Studio — dependency-free `.nlplugin` (ZIP) writer.
 *
 * Implements §3.3 (`studio:export`) of the FROZEN Plugin Studio Contract v1.
 *
 * This is the EXACT reverse of `plugin-manager.extractZipBuffer`: it emits a
 * standard ZIP archive (local file headers + central directory + EOCD) with
 * each entry DEFLATE-compressed via `zlib.deflateRawSync` (method 8), which
 * `extractZipBuffer` reads back with `zlib.inflateRawSync`. No external
 * dependency — `zlib` ships with Node.
 *
 * Entry names are stored as forward-slash relative paths (POSIX), matching the
 * traversal checks `extractZipBuffer` performs on read.
 */

import fs from 'fs-extra'
import path from 'path'
import zlib from 'zlib'

const LFH_SIG = 0x04034b50
const CDH_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const DEFLATE = 8
const STORE = 0

const MAX_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_BYTES = 25 * 1024 * 1024
const MAX_ENTRIES = 4096

// ─── CRC-32 (ZIP/PKZIP polynomial) ────────────────────────────────────────────

let CRC_TABLE = null
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  CRC_TABLE = table
  return table
}

function crc32(buf) {
  const table = crcTable()
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ─── Recursive file collection ────────────────────────────────────────────────

/**
 * Collect every regular file under `srcDir` as `{ rel, content }`, where `rel`
 * is a POSIX-relative path. Skips node_modules / .git / dotfiles-at-root that
 * would not belong in a shipped plugin? — we keep dotfiles inside plugin/ since
 * assets like .well-known are rare; we only skip node_modules and .git.
 *
 * @returns {Promise<Array<{ rel:string, content:Buffer }>>}
 */
async function collectFiles(srcDir) {
  const out = []
  const stack = ['']
  while (stack.length && out.length < MAX_ENTRIES) {
    const relDir = stack.pop()
    const absDir = path.join(srcDir, relDir)
    let entries
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch (_e) {
      continue
    }
    for (const ent of entries) {
      if (out.length >= MAX_ENTRIES) break
      if (ent.name === 'node_modules' || ent.name === '.git') continue
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name
      const abs = path.join(srcDir, rel)
      if (ent.isDirectory()) {
        stack.push(rel)
        continue
      }
      if (!ent.isFile()) continue // skip symlinks/sockets/etc.
      let content
      try {
        content = await fs.readFile(abs)
      } catch (_e) {
        continue
      }
      if (content.length > MAX_ENTRY_BYTES) {
        throw new Error(`entry exceeds size cap: ${rel}`)
      }
      out.push({ rel: rel.replace(/\\/g, '/'), content })
    }
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

// ─── DOS date/time (constant, deterministic) ──────────────────────────────────

// 1980-01-01 00:00:00 — a fixed timestamp keeps exports byte-stable.
const DOS_TIME = 0
const DOS_DATE = 0x21 // (year 1980, month 1, day 1)

// ─── Public: build a .nlplugin zip ────────────────────────────────────────────

/**
 * Zip the contents of `srcDir` into a ZIP archive at `outPath`. Entry names are
 * relative to `srcDir` (so zipping `plugin/` yields `plugin.json`, `index.js`,
 * … at the archive root — exactly what `plugin:install` / `extractZipBuffer`
 * expects).
 *
 * @param {string} srcDir absolute source dir (the `plugin/` deliverable)
 * @param {string} outPath absolute output `.nlplugin` path
 * @returns {Promise<{ ok:boolean, path?:string, error?:string }>}
 */
export async function buildNlpluginZip(srcDir, outPath) {
  try {
    if (typeof srcDir !== 'string' || !srcDir) return { ok: false, error: 'missing srcDir' }
    if (typeof outPath !== 'string' || !outPath) return { ok: false, error: 'missing outPath' }
    if (!(await fs.pathExists(srcDir))) return { ok: false, error: 'source dir does not exist' }

    const files = await collectFiles(srcDir)
    if (files.length === 0) return { ok: false, error: 'nothing to zip (empty plugin dir)' }

    const localParts = []
    const centralParts = []
    let offset = 0
    let totalUncompressed = 0

    for (const f of files) {
      const nameBuf = Buffer.from(f.rel, 'utf8')
      const crc = crc32(f.content)
      const uncompSize = f.content.length
      totalUncompressed += uncompSize
      if (totalUncompressed > MAX_TOTAL_BYTES) {
        return { ok: false, error: 'plugin exceeds size cap' }
      }

      // Compress with raw deflate (matches inflateRawSync on read).
      let method = DEFLATE
      let data = zlib.deflateRawSync(f.content)
      // If deflate did not shrink it (tiny/incompressible), store uncompressed.
      if (data.length >= uncompSize) {
        method = STORE
        data = f.content
      }
      const compSize = data.length

      // ── Local file header ──
      const lfh = Buffer.alloc(30)
      lfh.writeUInt32LE(LFH_SIG, 0)
      lfh.writeUInt16LE(20, 4) // version needed
      lfh.writeUInt16LE(0, 6) // flags
      lfh.writeUInt16LE(method, 8)
      lfh.writeUInt16LE(DOS_TIME, 10)
      lfh.writeUInt16LE(DOS_DATE, 12)
      lfh.writeUInt32LE(crc, 14)
      lfh.writeUInt32LE(compSize, 18)
      lfh.writeUInt32LE(uncompSize, 22)
      lfh.writeUInt16LE(nameBuf.length, 26)
      lfh.writeUInt16LE(0, 28) // extra len
      localParts.push(lfh, nameBuf, data)

      // ── Central directory header ──
      const cdh = Buffer.alloc(46)
      cdh.writeUInt32LE(CDH_SIG, 0)
      cdh.writeUInt16LE(20, 4) // version made by
      cdh.writeUInt16LE(20, 6) // version needed
      cdh.writeUInt16LE(0, 8) // flags
      cdh.writeUInt16LE(method, 10)
      cdh.writeUInt16LE(DOS_TIME, 12)
      cdh.writeUInt16LE(DOS_DATE, 14)
      cdh.writeUInt32LE(crc, 16)
      cdh.writeUInt32LE(compSize, 20)
      cdh.writeUInt32LE(uncompSize, 24)
      cdh.writeUInt16LE(nameBuf.length, 28)
      cdh.writeUInt16LE(0, 30) // extra len
      cdh.writeUInt16LE(0, 32) // comment len
      cdh.writeUInt16LE(0, 34) // disk number start
      cdh.writeUInt16LE(0, 36) // internal attrs
      cdh.writeUInt32LE(0, 38) // external attrs
      cdh.writeUInt32LE(offset, 42) // local header offset
      centralParts.push(cdh, nameBuf)

      offset += lfh.length + nameBuf.length + data.length
    }

    const centralStart = offset
    const centralBuf = Buffer.concat(centralParts)
    const centralSize = centralBuf.length

    // ── End of central directory ──
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(EOCD_SIG, 0)
    eocd.writeUInt16LE(0, 4) // disk number
    eocd.writeUInt16LE(0, 6) // central dir start disk
    eocd.writeUInt16LE(files.length, 8) // entries on this disk
    eocd.writeUInt16LE(files.length, 10) // total entries
    eocd.writeUInt32LE(centralSize, 12)
    eocd.writeUInt32LE(centralStart, 16)
    eocd.writeUInt16LE(0, 20) // comment len

    const archive = Buffer.concat([...localParts, centralBuf, eocd])

    await fs.ensureDir(path.dirname(outPath))
    await fs.writeFile(outPath, archive)
    return { ok: true, path: outPath }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'zip failed' }
  }
}
