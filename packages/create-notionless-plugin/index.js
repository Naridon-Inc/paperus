#!/usr/bin/env node
/**
 * @notionless/create-notionless-plugin
 *
 * Scaffolder for Paperus plugins. Two faces:
 *
 *  1. CLI  — `npm create @notionless/plugin` (or `create-notionless-plugin`):
 *            prompts for id / name / template, copies a template tree into the
 *            target dir, performs token substitution, and prints next steps.
 *
 *  2. API  — `import { scaffold, TEMPLATES, renderTemplate } from
 *            '@notionless/create-notionless-plugin'`. Reused by the host (via the
 *            `plugin:scaffold` IPC channel in plugin-manager.js) so an in-app
 *            scaffold uses the EXACT same template engine. `scaffold()` never prompts.
 *
 * Templates live in ./templates/<template>/ and mirror examples/plugins/*. Each
 * file may contain mustache-style tokens substituted from the options:
 *   {{id}} {{name}} {{description}} {{author}} {{license}} {{capabilitiesJson}}
 *   {{idSlug}}  (id with dots -> dashes, for css/identifiers)
 *
 * Pure Node, zero runtime dependencies (so it can run inside Electron main with
 * no install step). FROZEN CONTRACT v1.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, 'templates')

/** apiVersion this scaffolder emits. */
export const API_VERSION = '1'

/**
 * Registered templates. `capabilities` is the default capability set baked into
 * the generated plugin.json; callers can override via opts.capabilities.
 */
export const TEMPLATES = Object.freeze({
  'word-count': {
    title: 'Status-bar word count',
    description: 'Live word/char count in the footer via a status item.',
    capabilities: ['editor', 'ui'],
  },
  'custom-callout': {
    title: 'Custom CM6 block',
    description: 'A new Markdown block that round-trips to Markdown.',
    capabilities: ['editor'],
  },
  'ai-summarize': {
    title: 'AI command',
    description: 'A slash command + view that calls ctx.ai.complete().',
    capabilities: ['commands', 'ai', 'ui', 'editor'],
  },
  'magic-login': {
    title: 'Alternate login method',
    description: 'Registers an alternate unlock via ctx.auth.',
    capabilities: ['auth'],
  },
  'custom-section': {
    title: 'Sidebar section + view',
    description: 'Adds a sidebar section, a nav item, and a full view.',
    capabilities: ['ui', 'sections', 'views'],
  },
  blank: {
    title: 'Blank',
    description: 'A minimal do-nothing plugin you can grow.',
    capabilities: ['ui'],
  },
})

/** Reverse-DNS id rule from §2.1. */
const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Convert a reverse-DNS id into a css/identifier-safe slug. */
export function idToSlug(id) {
  return String(id).replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase()
}

/** Validate options for scaffolding; returns a normalized options object or throws. */
export function normalizeOptions(opts = {}) {
  const template = opts.template || 'blank'
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, template)) {
    throw new Error(`Unknown template "${template}". Valid: ${Object.keys(TEMPLATES).join(', ')}`)
  }
  const meta = TEMPLATES[template]

  const id = String(opts.id || '').trim()
  if (!ID_RE.test(id)) {
    throw new Error(`Invalid plugin id "${id}". Must be reverse-DNS, lowercase, e.g. com.acme.word-count`)
  }

  const name = String(opts.name || id.split('.').pop()).trim()
  const description = String(opts.description || meta.description).slice(0, 200)
  const author = String(opts.author || 'unknown').trim()
  const license = String(opts.license || 'MIT').trim()
  const capabilities = Array.isArray(opts.capabilities) && opts.capabilities.length
    ? opts.capabilities.slice()
    : meta.capabilities.slice()

  return { template, id, name, description, author, license, capabilities }
}

/** Build the token map used for substitution. */
export function buildTokens(opts) {
  return {
    id: opts.id,
    idSlug: idToSlug(opts.id),
    name: opts.name,
    description: opts.description,
    author: opts.author,
    license: opts.license,
    apiVersion: API_VERSION,
    capabilitiesJson: JSON.stringify(opts.capabilities),
  }
}

/** Replace {{token}} occurrences in a string from a token map. */
export function renderTemplate(content, tokens) {
  return String(content).replace(/\{\{(\w+)\}\}/g, (m, key) => (
    Object.prototype.hasOwnProperty.call(tokens, key) ? String(tokens[key]) : m
  ))
}

/** True if a path segment list contains a traversal/escape. */
function isUnsafeRelative(rel) {
  const parts = rel.split(/[\\/]+/)
  return parts.some((p) => p === '..' || p === '' && parts.length > 1) || path.isAbsolute(rel)
}

/** Recursively collect files (relative paths) under a dir. */
function listFiles(dir, base = dir) {
  /** @type {string[]} */
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFiles(full, base))
    } else if (entry.isFile()) {
      out.push(path.relative(base, full))
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Core scaffold (no prompting, no process exit) — reused by CLI + host (plugin:scaffold)
// ---------------------------------------------------------------------------

/**
 * Scaffold a plugin into `targetDir` from a template.
 *
 * @param {object} options
 * @param {string} options.template  one of TEMPLATES
 * @param {string} options.id        reverse-DNS id
 * @param {string} [options.name]
 * @param {string} [options.description]
 * @param {string} [options.author]
 * @param {string} [options.license]
 * @param {string[]} [options.capabilities]
 * @param {string} options.targetDir absolute destination directory (created if missing)
 * @param {boolean} [options.force]   overwrite existing files
 * @returns {{ dir: string, files: string[], manifest: object }}
 */
export function scaffold(options = {}) {
  const opts = normalizeOptions(options)
  const targetDir = options.targetDir
  if (!targetDir || typeof targetDir !== 'string') {
    throw new Error('scaffold(): options.targetDir (absolute path) is required')
  }

  const templateDir = path.join(TEMPLATES_DIR, opts.template)
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`)
  }

  const tokens = buildTokens(opts)
  const files = listFiles(templateDir)
  const written = []

  fs.mkdirSync(targetDir, { recursive: true })

  for (const rel of files) {
    // The `entry.js` template token allows renaming entry -> index.js etc.; we
    // keep the template's own filenames but still guard traversal.
    if (isUnsafeRelative(rel)) {
      throw new Error(`Unsafe template path rejected: ${rel}`)
    }
    const src = path.join(templateDir, rel)
    const dest = path.join(targetDir, rel)
    if (fs.existsSync(dest) && !options.force) {
      throw new Error(`Refusing to overwrite existing file: ${dest} (pass force:true)`)
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const raw = fs.readFileSync(src, 'utf8')
    fs.writeFileSync(dest, renderTemplate(raw, tokens), 'utf8')
    written.push(rel)
  }

  // Parse the generated manifest to return it (and to fail loudly on bad JSON).
  let manifest = null
  const manifestPath = path.join(targetDir, 'plugin.json')
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  }

  return { dir: targetDir, files: written, manifest }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Minimal stdin question helper (Promise-based). */
function ask(question, fallback) {
  return new Promise((resolve) => {
    process.stdout.write(fallback ? `${question} (${fallback}) ` : `${question} `)
    let answered = false
    const onData = (buf) => {
      if (answered) return
      answered = true
      process.stdin.off('data', onData)
      process.stdin.pause()
      const value = String(buf).trim()
      resolve(value || fallback || '')
    }
    process.stdin.resume()
    process.stdin.once('data', onData)
  })
}

/** Parse `--key value` / `--key=value` / `--flag` argv into a map. */
function parseArgv(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      if (!out._) out._ = []
      out._.push(a)
      continue
    }
    const eq = a.indexOf('=')
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1)
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[a.slice(2)] = argv[i + 1]
      i += 1
    } else {
      out[a.slice(2)] = true
    }
  }
  return out
}

async function runCli() {
  const args = parseArgv(process.argv.slice(2))

  if (args.help || args.h) {
    process.stdout.write(`create-notionless-plugin — scaffold a Paperus plugin

Usage:
  npm create @notionless/plugin
  create-notionless-plugin [dir] --template <t> --id <id> --name <name>

Options:
  --template   ${Object.keys(TEMPLATES).join(' | ')}
  --id         reverse-DNS id, e.g. com.acme.word-count
  --name       display name
  --author     author string
  --license    SPDX id (default MIT)
  --force      overwrite existing files
  --list       list templates and exit
  --help       show this help
`)
    return
  }

  if (args.list) {
    process.stdout.write('Available templates:\n')
    for (const [key, meta] of Object.entries(TEMPLATES)) {
      process.stdout.write(`  ${key.padEnd(16)} ${meta.title} — caps: [${meta.capabilities.join(', ')}]\n`)
    }
    return
  }

  const interactive = process.stdin.isTTY && !args.id

  let template = args.template
  let id = args.id
  let name = args.name

  if (interactive) {
    process.stdout.write('\nCreate a Paperus plugin\n\n')
    if (!template) {
      process.stdout.write(`Templates: ${Object.keys(TEMPLATES).join(', ')}\n`)
      template = await ask('Template:', 'word-count')
    }
    if (!id) id = await ask('Plugin id (reverse-DNS):', 'com.example.my-plugin')
    if (!name) name = await ask('Display name:', id.split('.').pop())
  }

  template = template || 'word-count'
  id = id || 'com.example.my-plugin'
  name = name || id.split('.').pop()

  const dirName = (args._ && args._[0]) || idToSlug(id)
  const targetDir = path.resolve(process.cwd(), dirName)

  let result
  try {
    result = scaffold({
      template,
      id,
      name,
      author: args.author,
      license: args.license,
      targetDir,
      force: Boolean(args.force),
    })
  } catch (err) {
    process.stderr.write(`\nError: ${err.message}\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write(`\nCreated ${template} plugin "${id}" in ${result.dir}\n`)
  process.stdout.write('Files:\n')
  for (const f of result.files) process.stdout.write(`  ${f}\n`)
  process.stdout.write(`\nNext steps:
  1. Copy this folder into your Paperus plugins dir (open it via the account
     menu ▸ Developer ▸ Plugins… ▸ "Open plugins folder").
  2. Edit index.js, then reload the plugin from the Plugins… panel.
  3. Read docs/PLUGIN_API_CONTRACT.md for the full ctx API.
\n`)
}

// Run as CLI only when invoked directly (not when imported by the Lab).
const isMain = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isMain) {
  runCli().catch((err) => {
    process.stderr.write(`\nFatal: ${err && err.message ? err.message : err}\n`)
    process.exitCode = 1
  })
}

export default scaffold
