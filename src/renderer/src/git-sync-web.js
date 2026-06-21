/**
 * Git-repo sync for the WEB build — the browser-side mirror of
 * `src/main/git-sync.js` (which runs in the Electron main process via Node).
 *
 * On Electron, notes already live as Markdown files in a project folder, so the
 * Node module can simply `git add` the folder. On the web build there is no
 * native filesystem: notes live in the CLOUD backend. So here we keep a
 * dedicated in-browser filesystem (`@isomorphic-git/lightning-fs`, backed by
 * IndexedDB) at a fixed working dir `/repo`, sync the user's notes INTO it, and
 * run the same git operations against it using `isomorphic-git` + its
 * browser HTTP transport (`isomorphic-git/http/web`).
 *
 * The relay server is NOT involved — this is pure browser ↔ git-host. Auth is
 * the user's token (PAT or OAuth access token), supplied per call and never
 * persisted here (the UI stores it via `auth:secure-save`/`auth:secure-load`).
 *
 * v1 LIMITATION — cloud-notes → LightningFS bridge:
 *   This module cannot reach the app's note store on its own. The caller must
 *   hand it the markdown files to commit, either via `syncFiles(files, opts)`
 *   directly or via `git.sync(dir, { files, ... })` (see the shim's `sync`).
 *   If no files are provided, `sync` still commits/pulls/pushes whatever is
 *   already in `/repo` so the Settings UI can connect and report real status —
 *   it does NOT pretend a no-op succeeded with new data.
 */
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import FS from '@isomorphic-git/lightning-fs'

// Singleton browser filesystem (IndexedDB-backed) and the fixed working dir.
const fs = new FS('notionless-git')
const DIR = '/repo'

const DEFAULT_AUTHOR = { name: 'Paperus', email: 'notes@notionless.local' }

function onAuth(token) {
  // GitHub/GitLab accept a token as the HTTP basic username.
  return () => ({ username: token, password: 'x-oauth-basic' })
}

function authorOf(author) {
  return {
    name: (author && author.name) || DEFAULT_AUTHOR.name,
    email: (author && author.email) || DEFAULT_AUTHOR.email,
  }
}

async function pathExists(p) {
  try {
    await fs.promises.stat(p)
    return true
  } catch (e) {
    return false
  }
}

async function ensureDir(p) {
  try {
    await fs.promises.mkdir(p)
  } catch (e) {
    // EEXIST is fine; anything else propagates.
    if (e && e.code !== 'EEXIST') throw e
  }
}

// Recursively create the parent directories for a file path inside DIR.
async function ensureParents(filepath) {
  const parts = filepath.split('/').filter(Boolean)
  parts.pop() // drop the filename
  let cur = DIR
  for (const seg of parts) {
    cur += '/' + seg
    await ensureDir(cur)
  }
}

export async function isRepo(dir = DIR) {
  return pathExists((dir || DIR) + '/.git')
}

async function currentBranch() {
  try {
    return (await git.currentBranch({ fs, dir: DIR, fullname: false })) || 'main'
  } catch (e) {
    return 'main'
  }
}

export async function getStatus() {
  await ensureDir(DIR)
  if (!(await isRepo())) return { initialized: false }

  const remotes = await git.listRemotes({ fs, dir: DIR }).catch(() => [])
  const origin = remotes.find((r) => r.remote === 'origin')
  const branch = await currentBranch()
  const matrix = await git.statusMatrix({ fs, dir: DIR }).catch(() => [])
  // A row is [filepath, headStatus, workdirStatus, stageStatus]; (1,1,1) = unchanged.
  const changed = matrix.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1))

  return {
    initialized: true,
    branch,
    remote: origin ? origin.url : null,
    changedCount: changed.length,
    changedFiles: changed.slice(0, 50).map((row) => row[0]),
  }
}

export async function setRemote(url) {
  const remotes = await git.listRemotes({ fs, dir: DIR }).catch(() => [])
  if (remotes.find((r) => r.remote === 'origin')) {
    await git.deleteRemote({ fs, dir: DIR, remote: 'origin' })
  }
  if (url) await git.addRemote({ fs, dir: DIR, remote: 'origin', url })
}

async function writeGitignore() {
  const giPath = DIR + '/.gitignore'
  if (!(await pathExists(giPath))) {
    await fs.promises.writeFile(giPath, ['.DS_Store', 'node_modules/', '.opus/history/', '*.tmp', ''].join('\n'))
  }
}

export async function init(remoteUrl) {
  await ensureDir(DIR)
  if (!(await isRepo())) {
    await git.init({ fs, dir: DIR, defaultBranch: 'main' })
  }
  // Keep internal/transient files out of the user's repo.
  await writeGitignore()
  if (remoteUrl) await setRemote(remoteUrl)
  return getStatus()
}

export async function commitAll(message, author) {
  const matrix = await git.statusMatrix({ fs, dir: DIR })
  let changes = 0
  for (const [filepath, head, workdir, stage] of matrix) {
    if (head === 1 && workdir === 1 && stage === 1) continue // unmodified
    if (workdir === 0) {
      await git.remove({ fs, dir: DIR, filepath })
    } else {
      await git.add({ fs, dir: DIR, filepath })
    }
    changes++
  }
  if (changes === 0) return { committed: false, oid: null, changes: 0 }
  const oid = await git.commit({
    fs,
    dir: DIR,
    message: message || 'Update notes',
    author: authorOf(author),
  })
  return { committed: true, oid, changes }
}

export async function push(token) {
  const ref = await currentBranch()
  return git.push({ fs, http, dir: DIR, remote: 'origin', ref, onAuth: onAuth(token) })
}

export async function pull(token, author) {
  const ref = await currentBranch()
  // Fetch first so a brand-new remote (no upstream yet) fails cleanly here.
  await git.fetch({ fs, http, dir: DIR, remote: 'origin', ref, singleBranch: true, tags: false, onAuth: onAuth(token) })
  await git.pull({
    fs,
    http,
    dir: DIR,
    ref,
    singleBranch: true,
    author: authorOf(author),
    fastForward: true,
    onAuth: onAuth(token),
  })
}

export async function clone(url, token) {
  await ensureDir(DIR)
  await git.clone({ fs, http, dir: DIR, url, singleBranch: true, depth: 50, onAuth: onAuth(token) })
  return getStatus()
}

// Write an array of { path, content } markdown files into /repo, creating any
// intermediate folders. Relative paths only (leading slashes are stripped).
async function writeFiles(files) {
  if (!Array.isArray(files)) return 0
  let written = 0
  for (const f of files) {
    if (!f || !f.path) continue
    const rel = String(f.path).replace(/^\/+/, '')
    if (!rel) continue
    const full = DIR + '/' + rel
    await ensureParents(rel)
    await fs.promises.writeFile(full, f.content == null ? '' : String(f.content))
    written++
  }
  return written
}

/**
 * Sync an explicit set of markdown files to the remote, Obsidian-style:
 * clone (if /repo isn't a repo yet) → write files → add → commit → pull
 * (best-effort, fast-forward) → push.
 *
 * @param {Array<{path:string, content:string}>} files
 * @param {{ token:string, remoteUrl:string, author?:object, message?:string }} opts
 * @returns {{ ok:boolean, committed:object|null, pulled:boolean, pushed:boolean, error:string|null, status:object|null }}
 */
export async function syncFiles(files = [], opts = {}) {
  const { token, remoteUrl, author, message } = opts
  if (!token) return { ok: false, error: 'No git token configured' }
  if (!remoteUrl) return { ok: false, error: 'No git remote configured' }

  await ensureDir(DIR)

  const result = { ok: true, committed: null, pulled: false, pushed: false, error: null }

  try {
    if (!(await isRepo())) {
      // No repo yet: try to clone the remote so we build on its history.
      // If the remote is empty/unreachable, fall back to a fresh local repo.
      try {
        await clone(remoteUrl, token)
      } catch (e) {
        await init(remoteUrl)
        result.cloneError = e.message
      }
    } else if (remoteUrl) {
      await setRemote(remoteUrl)
    }
    await writeGitignore()

    await writeFiles(files)

    result.committed = await commitAll(message || 'Sync notes', author)

    // Pull is best-effort: a fresh/empty remote has nothing to fetch.
    try {
      await pull(token, author)
      result.pulled = true
    } catch (e) {
      result.pullError = e.message
    }

    await push(token)
    result.pushed = true
  } catch (e) {
    result.ok = false
    result.error = e.message
  }

  result.status = await getStatus().catch(() => null)
  return result
}

/**
 * One-button sync (commit → pull → push), Obsidian-style. Mirrors the Electron
 * module's `sync(dir, opts)` signature so the existing Settings UI works
 * unchanged. The `dir` argument is IGNORED on web (we always use `/repo`).
 *
 * The note files to commit are passed via `opts.files` (an array of
 * { path, content }). If `opts.files` is omitted, this still commits/pulls/
 * pushes whatever is already in `/repo` — it does not fabricate a success.
 */
export async function sync(dir, opts = {}) {
  return syncFiles(opts.files || [], opts)
}

/**
 * A `window.api.git`-compatible object so the existing Git Sync settings panel
 * (team.js) works on the web build without modification. The `dir` arguments
 * are accepted for signature parity but ignored (web always uses `/repo`).
 */
export const gitApiShim = {
  status: (dir) => getStatus(),
  init: (dir, remoteUrl) => init(remoteUrl),
  setRemote: (dir, url) => setRemote(url),
  sync: (dir, opts) => sync(dir, opts),
  clone: (dir, url, token) => clone(url, token),
}

export default gitApiShim
