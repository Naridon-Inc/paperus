/**
 * Git-repo sync for the Electron main process — "like Obsidian".
 *
 * Notes already live as Markdown files in a project folder. This module turns
 * that folder into a git repo and syncs it to the user's OWN remote (GitHub,
 * etc.) using isomorphic-git. The relay server is NOT involved — this is pure
 * peer ↔ git-host. Auth is the user's token (PAT or OAuth access token),
 * supplied per call and never persisted here (the renderer stores it in the OS
 * keychain via safeStorage).
 */
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import fs from 'fs-extra'
import path from 'path'

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

export async function isRepo(dir) {
  return fs.pathExists(path.join(dir, '.git'))
}

async function currentBranch(dir) {
  try {
    return (await git.currentBranch({ fs, dir, fullname: false })) || 'main'
  } catch (e) {
    return 'main'
  }
}

export async function getStatus(dir) {
  if (!dir) return { initialized: false, error: 'No folder open' }
  if (!(await isRepo(dir))) return { initialized: false }

  const remotes = await git.listRemotes({ fs, dir }).catch(() => [])
  const origin = remotes.find((r) => r.remote === 'origin')
  const branch = await currentBranch(dir)
  const matrix = await git.statusMatrix({ fs, dir }).catch(() => [])
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

export async function setRemote(dir, url) {
  const remotes = await git.listRemotes({ fs, dir }).catch(() => [])
  if (remotes.find((r) => r.remote === 'origin')) {
    await git.deleteRemote({ fs, dir, remote: 'origin' })
  }
  if (url) await git.addRemote({ fs, dir, remote: 'origin', url })
}

export async function init(dir, remoteUrl) {
  if (!(await isRepo(dir))) {
    await git.init({ fs, dir, defaultBranch: 'main' })
  }
  // Keep internal/transient files out of the user's repo.
  const giPath = path.join(dir, '.gitignore')
  if (!(await fs.pathExists(giPath))) {
    await fs.writeFile(giPath, ['.DS_Store', 'node_modules/', '.opus/history/', '*.tmp', ''].join('\n'))
  }
  if (remoteUrl) await setRemote(dir, remoteUrl)
  return getStatus(dir)
}

export async function commitAll(dir, message, author) {
  const matrix = await git.statusMatrix({ fs, dir })
  let changes = 0
  for (const [filepath, head, workdir, stage] of matrix) {
    if (head === 1 && workdir === 1 && stage === 1) continue // unmodified
    if (workdir === 0) {
      await git.remove({ fs, dir, filepath })
    } else {
      await git.add({ fs, dir, filepath })
    }
    changes++
  }
  if (changes === 0) return { committed: false, oid: null, changes: 0 }
  const oid = await git.commit({
    fs,
    dir,
    message: message || 'Update notes',
    author: authorOf(author),
  })
  return { committed: true, oid, changes }
}

export async function push(dir, token) {
  const ref = await currentBranch(dir)
  return git.push({ fs, http, dir, remote: 'origin', ref, onAuth: onAuth(token) })
}

export async function pull(dir, token, author) {
  const ref = await currentBranch(dir)
  // Fetch first so a brand-new remote (no upstream yet) fails cleanly here.
  await git.fetch({ fs, http, dir, remote: 'origin', ref, singleBranch: true, tags: false, onAuth: onAuth(token) })
  await git.pull({
    fs,
    http,
    dir,
    ref,
    singleBranch: true,
    author: authorOf(author),
    fastForward: true,
    onAuth: onAuth(token),
  })
}

export async function clone(dir, url, token) {
  await fs.ensureDir(dir)
  await git.clone({ fs, http, dir, url, singleBranch: true, depth: 50, onAuth: onAuth(token) })
  return getStatus(dir)
}

/**
 * One-button sync (commit → pull → push), Obsidian-style.
 * Returns a structured result the UI can summarize. Never throws for the
 * common "remote is empty / first push" case.
 */
export async function sync(dir, opts = {}) {
  const { token, message, author, remoteUrl } = opts
  if (!token) return { ok: false, error: 'No git token configured' }

  if (!(await isRepo(dir))) {
    await init(dir, remoteUrl)
  } else if (remoteUrl) {
    await setRemote(dir, remoteUrl)
  }

  const result = { ok: true, committed: null, pulled: false, pushed: false, error: null }

  try {
    result.committed = await commitAll(dir, message, author)

    // Pull is best-effort: a fresh/empty remote has nothing to fetch.
    try {
      await pull(dir, token, author)
      result.pulled = true
    } catch (e) {
      result.pullError = e.message
    }

    await push(dir, token)
    result.pushed = true
  } catch (e) {
    result.ok = false
    result.error = e.message
  }

  result.status = await getStatus(dir).catch(() => null)
  return result
}
