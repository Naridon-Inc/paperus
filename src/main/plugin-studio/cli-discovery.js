/**
 * Plugin Studio — CLI binary discovery helpers (single source of truth).
 *
 * FROZEN CONTRACT (docs/PLUGIN_STUDIO_CONTRACT.md §4.2, §5.1):
 *   Exports `{ resolveClaudeBin, claudeEnv, resolveGeminiBin }`.
 *   These are the same probes the Brain's `ai:claude-code*` handlers use
 *   (index.js imports them from here), so the desktop app discovers harnesses
 *   identically whether you pick "Use Claude Code" in Company Brain or a CLI
 *   provider in Plugin Studio.
 *
 * Why this is more than a hardcoded list:
 *   A macOS app launched from Finder/Dock inherits a *minimal* PATH
 *   (`/usr/bin:/bin:/usr/sbin:/sbin`) — NOT your shell's PATH. So `~/.local/bin`
 *   (where the native `claude` installer puts the binary) and `/opt/homebrew/bin`
 *   (gemini) are invisible, and a CLI installed via nvm/fnm/pnpm/volta/bun/a
 *   custom dir would never be found. Worse, `gemini` is a `#!/usr/bin/env node`
 *   script: even once located it dies with "env: node: No such file or directory"
 *   unless `node` is on the spawn PATH.
 *
 *   So discovery here is three-tier: (1) probe the canonical install dirs, then
 *   (2) fall back to the user's REAL login-shell PATH (we ask `$SHELL -lic` for it,
 *   which runs ~/.zshrc and therefore nvm/fnm/volta hooks), and (3) a generic
 *   `resolveBin(name)` so "whatever harness they have" is discoverable, not just
 *   claude/gemini. `cliEnv()` then spawns with that full login PATH so node-shebang
 *   CLIs resolve `node`.
 *
 * The call sites pass the electron `app` explicitly (`resolveClaudeBin(app)`,
 * `resolveGeminiBin(app)`, `claudeEnv(app)`); we also fall back to electron's own
 * `app` import so a zero-arg call still works. Every function is defensive and
 * never throws.
 */

import { join, delimiter, isAbsolute } from 'path'
import fs from 'fs-extra'
import { spawnSync } from 'child_process'
import { app as electronApp } from 'electron'

function homeDir(app) {
  const a = app || electronApp
  try {
    if (a && typeof a.getPath === 'function') return a.getPath('home')
  } catch (_) { /* fall through */ }
  return process.env.HOME || process.env.USERPROFILE || ''
}

/** Canonical bin dirs to probe before falling back to the login shell. */
function commonBinDirs(app) {
  const home = homeDir(app)
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.claude', 'local'),
    join(home, 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.deno', 'bin'),
    join(home, '.volta', 'bin'),
    '/opt/local/bin',
  ]
}

// ── login-shell PATH ─────────────────────────────────────────────────────────
// Resolved at most once per process (spawning a login shell is ~50-200ms).
let _loginPathTried = false
let _loginPathCache = null

/**
 * Ask the user's real login shell for its PATH. This is the durable fix for the
 * macOS GUI minimal-PATH problem and for nvm/fnm/volta installs that only exist
 * once ~/.zshrc has run. Cached; defensive; returns null on any failure.
 * @param {import('electron').App} [app]
 * @returns {string|null}
 */
export function loginPath(app) {
  if (_loginPathTried) return _loginPathCache
  _loginPathTried = true
  _loginPathCache = null
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    // -l login (sources profile), -i interactive (sources rc → nvm/fnm/volta),
    // -c run command. Sentinel-wrap so prompt/banner noise on stdout is ignored.
    const r = spawnSync(shell, ['-lic', 'printf "__NLPATH__%s__NLEND__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 4000,
      env: { ...process.env },
    })
    const out = (r && (r.stdout || '')) || ''
    const m = out.match(/__NLPATH__([\s\S]*?)__NLEND__/)
    if (m && m[1] && m[1].includes('/')) _loginPathCache = m[1].trim()
  } catch (_) { /* fall back to process.env.PATH + common dirs */ }
  return _loginPathCache
}

/** Merged, de-duped search path: process PATH ∪ login PATH ∪ common bin dirs. */
function searchDirs(app) {
  const seen = new Set()
  const out = []
  const add = (p) => {
    if (!p) return
    for (const seg of String(p).split(delimiter)) {
      if (seg && !seen.has(seg)) { seen.add(seg); out.push(seg) }
    }
  }
  add(process.env.PATH)
  add(loginPath(app))
  for (const d of commonBinDirs(app)) add(d)
  return out
}

function isExecutableFile(p) {
  try {
    const st = fs.statSync(p)
    if (!st.isFile()) return false
    fs.accessSync(p, fs.constants.X_OK)
    return true
  } catch (_) { return false }
}

/**
 * Resolve any CLI by name across the merged search path — the core of "whatever
 * harness they have". An absolute/relative path is validated as-is.
 * @param {string} name e.g. 'claude', 'gemini', 'cursor-agent', 'aider'
 * @param {import('electron').App} [app]
 * @returns {string|null} absolute path or null
 */
export function resolveBin(name, app) {
  if (!name) return null
  if (isAbsolute(name) || name.includes('/')) return isExecutableFile(name) ? name : null
  for (const dir of searchDirs(app)) {
    const cand = join(dir, name)
    if (isExecutableFile(cand)) return cand
  }
  return null
}

/**
 * Resolve the absolute path to the user's installed `claude` CLI, or null.
 * Fast-paths the canonical native-install locations, then the generic resolver.
 * @param {import('electron').App} [app]
 * @returns {string|null}
 */
export function resolveClaudeBin(app) {
  const home = homeDir(app)
  const fast = [
    join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(home, '.local', 'bin', 'claude'),
    join(home, '.npm-global', 'bin', 'claude'),
  ]
  for (const c of fast) { if (isExecutableFile(c)) return c }
  return resolveBin('claude', app)
}

/**
 * Resolve the absolute path to the user's installed `gemini` CLI, or null.
 * Twin of resolveClaudeBin per the contract (§4.2 "Gemini CLI").
 * @param {import('electron').App} [app]
 * @returns {string|null}
 */
export function resolveGeminiBin(app) {
  const home = homeDir(app)
  const fast = [
    join(home, '.local', 'bin', 'gemini'),
    '/opt/homebrew/bin/gemini',
    '/usr/local/bin/gemini',
    join(home, '.npm-global', 'bin', 'gemini'),
  ]
  for (const c of fast) { if (isExecutableFile(c)) return c }
  return resolveBin('gemini', app)
}

/**
 * Env for spawning a discovered CLI: carry the user's full login PATH so
 * node-shebang CLIs (gemini) and tools that shell out can find `node`/etc. This
 * is the spawn-side half of the macOS GUI-PATH fix.
 * @param {import('electron').App} [app]
 * @returns {NodeJS.ProcessEnv}
 */
export function cliEnv(app) {
  const merged = searchDirs(app).join(delimiter)
  return { ...process.env, PATH: merged }
}

// Backward-compatible contract name (index.js + the providers import `claudeEnv`).
export const claudeEnv = cliEnv

export default { resolveClaudeBin, resolveGeminiBin, resolveBin, claudeEnv, cliEnv, loginPath }
