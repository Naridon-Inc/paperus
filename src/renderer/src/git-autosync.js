/**
 * Background git auto-sync (Obsidian-style).
 *
 * When enabled, periodically commits + pushes/pulls the workspace to the user's
 * own git repo.
 *   - Electron: operates on the local note folder via `window.api.git` (Node).
 *   - Web: there is no native filesystem, so it collects the user's notes from
 *     the cloud filesystem proxy and syncs them through the in-browser git
 *     engine (`./git-sync-web`, isomorphic-git + lightning-fs).
 * No-op until a repo URL + token are configured. Fires a `git:autosync` window
 * event with the result so the UI can show a status.
 */
import { authClient } from './auth-client'

let timer = null
let running = false

// Is this the Electron build (native git in the main process)?
function hasElectronGit() {
  return typeof window !== 'undefined' && window.api && window.api.git
}

/**
 * Resolve a git engine. Electron uses the native `window.api.git`; the web
 * build lazily loads the in-browser shim. Returns `{ engine, isWeb }`.
 */
async function getGitEngine() {
  if (hasElectronGit()) return { engine: window.api.git, isWeb: false }
  try {
    const m = await import('./git-sync-web')
    return { engine: m.gitApiShim || m.default, isWeb: true }
  } catch (e) {
    return null
  }
}

/**
 * Web only: walk the cloud filesystem proxy and collect the user's markdown
 * notes as `{ path, content }` so they can be committed into the in-browser
 * repo. Returns null if collection isn't feasible (so the caller logs it
 * rather than silently pretending an empty sync carried real data).
 */
async function collectWebNotes() {
  try {
    const { fileSystem } = await import('./filesystem-proxy')
    const fsp = fileSystem && fileSystem.current
    if (!fsp || typeof fsp.getDirectoryTree !== 'function') return null

    const files = []
    const seen = new Set()

    const walk = async (nodePath) => {
      const tree = await fsp.getDirectoryTree(nodePath).catch(() => null)
      if (!tree || !Array.isArray(tree.children)) return
      for (const child of tree.children) {
        if (child.type === 'directory') {
          if (!seen.has(child.path)) { seen.add(child.path); await walk(child.path) }
        } else if (child.type === 'file') {
          if (seen.has(child.path)) continue
          seen.add(child.path)
          // readFile is async (cloud bodies are fetched from the backend, which
          // reconstructs them from Yjs updates) — always await it.
          const content = await fsp.readFile(child.path).catch((e) => {
            console.warn('[git-autosync] readFile failed for', child.path, e && e.message)
            return ''
          })
          // Build a clean relative path for the repo (strip cloud:/folder: scheme).
          const rel = String(child.name || child.path).replace(/^(cloud:|folder:)/, '')
          const safe = /\.md$/i.test(rel) ? rel : rel + '.md'
          // Surface empty bodies so a "successful" sync that pushed nothing real
          // is never silent (e.g. RELAY_ONLY backend with no persisted content).
          if (!content || String(content).trim().length === 0) {
            console.warn('[git-autosync] empty body for note', safe, '(path:', child.path + ')')
          }
          files.push({ path: safe, content: content || '' })
        }
      }
    }

    await walk('root')
    return files
  } catch (e) {
    return null
  }
}

async function getConfig() {
  if (!(typeof window !== 'undefined' && window.api)) return null
  const known = await window.api.getSettings('knownProjects').catch(() => null)
  const dir = Array.isArray(known) && known.length ? known[0] : null
  const remote = (await window.api.getSettings('git_remote').catch(() => null)) || '';
  const token = await window.api.invoke('auth:secure-load', 'git_token').catch(() => null)
  return { dir, remote, token }
}

export async function runOnce() {
  if (running) return { ok: false, error: 'already running' }
  const resolved = await getGitEngine()
  if (!resolved) return { ok: false, error: 'no git engine' }
  const { engine, isWeb } = resolved

  const cfg = await getConfig()
  // Electron needs a local folder; web syncs the cloud notes into /repo so no
  // local `dir` is required.
  if (!cfg || !cfg.remote || !cfg.token || (!isWeb && !cfg.dir)) {
    return { ok: false, error: 'not configured' }
  }

  running = true
  try {
    const user = authClient.user
    const author = user ? { name: user.displayName || user.email, email: user.email } : null
    const opts = {
      token: cfg.token,
      remoteUrl: cfg.remote,
      author,
      message: 'Auto-sync notes',
    }
    if (isWeb) {
      const files = await collectWebNotes()
      if (files == null) {
        console.warn('[git-autosync] could not collect cloud notes; syncing repo state only')
      } else {
        opts.files = files
      }
    }
    const res = await engine.sync(cfg.dir, opts)
    window.dispatchEvent(new CustomEvent('git:autosync', { detail: res }))
    return res
  } catch (e) {
    window.dispatchEvent(new CustomEvent('git:autosync', { detail: { ok: false, error: e.message } }))
    return { ok: false, error: e.message }
  } finally {
    running = false
  }
}

export function stopAutoSync() {
  if (timer) { clearInterval(timer); timer = null }
}

/**
 * (Re)start the auto-sync loop based on saved settings. Safe to call repeatedly
 * (e.g. after the user changes settings).
 */
export async function startAutoSync() {
  stopAutoSync()
  // Works on Electron (native git) and on the web build (in-browser shim).
  if (!(typeof window !== 'undefined' && window.api)) return

  const enabled = await window.api.getSettings('git_autosync_enabled').catch(() => false)
  if (!enabled) return

  const intervalMin = Math.max(1, Number(await window.api.getSettings('git_autosync_interval').catch(() => 0)) || 5)
  timer = setInterval(() => { runOnce().catch(() => {}) }, intervalMin * 60 * 1000)

  // Run once shortly after boot so a fresh session pushes/pulls promptly.
  setTimeout(() => { runOnce().catch(() => {}) }, 15000)
}
