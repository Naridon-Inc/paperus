/**
 * Plugin Studio — context-bundle writer + `plugin/` seeding.
 *
 * Implements §2 of the FROZEN Plugin Studio Contract v1.
 *
 * Writes the harness-agnostic grounding bundle into `build-<id>/`:
 *   AGENTS.md   CLAUDE.md   GEMINI.md   .cursorrules   (all identical guide text)
 *   CAPABILITIES.md         (the passed `capabilitiesMarkdown`, verbatim)
 *   llms.txt                (copy of docs/llms.txt)
 *   types.d.ts              (copy of packages/plugin-sdk/types.d.ts)
 *   docs/PLUGIN_API_CONTRACT.md
 *   examples/<id>/…         (copies of examples/plugins/<id>)
 *   plugin/                 (seeded from a template, or remixed from an example)
 *
 * Everything here is PUBLIC — repo docs, types, examples. No notes, no keys, no
 * vault access. Sources are read from the app's repo root (resolved relative to
 * this module via import.meta.url) so it works both packaged and in dev.
 *
 * The deliverable is the `plugin/` subdir ONLY; the rest is grounding.
 */

import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

const API_VERSION = '1'
const MANIFEST_FILE = 'plugin.json'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// this file: <repo>/src/main/plugin-studio/context-bundle.js → repo root is ../../..
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

const KNOWN_EXAMPLES = ['word-count', 'custom-callout', 'ai-summarize', 'magic-login', 'custom-section']
const KNOWN_TEMPLATES = new Set([...KNOWN_EXAMPLES, 'blank'])

const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/

// ─── Source path helpers (repo-relative; tolerant of absence) ─────────────────

function repoFile(...segs) {
  return path.join(REPO_ROOT, ...segs)
}

/** Read a repo file as UTF-8, returning '' if it is missing/unreadable. */
async function readRepoFileSafe(rel) {
  try {
    const f = repoFile(...rel.split('/'))
    if (!(await fs.pathExists(f))) return ''
    return await fs.readFile(f, 'utf8')
  } catch (_e) {
    return ''
  }
}

// ─── Author guide extraction (PLUGIN_AUTHOR_GUIDE from author-guide.js) ───────

/**
 * Best-effort extraction of the exported `PLUGIN_AUTHOR_GUIDE` markdown string
 * from the renderer module `src/renderer/src/plugins/author-guide.js`. We avoid
 * importing the renderer module (it may pull in browser-only deps), so we read
 * the file text and pull the first backtick-delimited template literal that
 * follows the export. If anything fails we degrade to ''.
 */
async function readAuthorGuide() {
  try {
    const src = await readRepoFileSafe('src/renderer/src/plugins/author-guide.js')
    if (!src) return ''
    // Find: export const PLUGIN_AUTHOR_GUIDE = `…`
    const marker = 'PLUGIN_AUTHOR_GUIDE'
    const at = src.indexOf(marker)
    if (at < 0) return ''
    const tick = src.indexOf('`', at)
    if (tick < 0) return ''
    // Find the matching closing backtick (ignore escaped \`).
    let i = tick + 1
    let out = ''
    while (i < src.length) {
      const ch = src[i]
      if (ch === '\\' && i + 1 < src.length) {
        out += src[i + 1]
        i += 2
        continue
      }
      if (ch === '`') break
      out += ch
      i += 1
    }
    // Unescape `${` sequences that were written as \${ in the source.
    return out.replace(/\\\$\{/g, '${')
  } catch (_e) {
    return ''
  }
}

// ─── Combined AGENTS.md guide text ────────────────────────────────────────────

/**
 * The harness-agnostic guide = repo-root AGENTS.md + the PLUGIN_AUTHOR_GUIDE,
 * with a short Studio-specific preamble pointing the harness at the bundle.
 */
async function buildAgentsGuide() {
  const agents = await readRepoFileSafe('AGENTS.md')
  const guide = await readAuthorGuide()
  const preamble = [
    '# Plugin Studio workspace',
    '',
    'You are an author-time coding agent working **only** inside this workspace dir.',
    'The deliverable is the `plugin/` subdir — edit `plugin/plugin.json`,',
    '`plugin/index.js`, and any assets there. Do not touch files outside `plugin/`',
    'except to read the grounding bundle in this directory:',
    '',
    '- `CAPABILITIES.md` — the LIVE capability + surface catalog for this host.',
    '- `docs/PLUGIN_API_CONTRACT.md` — the frozen runtime plugin contract.',
    '- `types.d.ts` — the plugin SDK types.',
    '- `llms.txt` — a condensed orientation.',
    '- `examples/` — working example plugins to learn from / copy patterns.',
    '',
    'When done, the plugin must pass `node --check` on every `.js` and a manifest',
    'validation. Declare only the capabilities you actually use.',
    '',
    '---',
    '',
  ].join('\n')

  const parts = [preamble]
  if (agents) parts.push(agents.trim(), '')
  if (guide) {
    parts.push('---', '', '# Plugin Author Guide', '', guide.trim(), '')
  }
  return parts.join('\n')
}

// ─── examples/ copy ───────────────────────────────────────────────────────────

async function copyExamples(destExamplesDir) {
  await fs.ensureDir(destExamplesDir)
  for (const ex of KNOWN_EXAMPLES) {
    const src = repoFile('examples', 'plugins', ex)
    try {
      if (await fs.pathExists(src)) {
        await fs.copy(src, path.join(destExamplesDir, ex), {
          dereference: false,
          filter: (s) => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(s),
        })
      }
    } catch (_e) {
      /* best-effort: skip a missing/unreadable example */
    }
  }
}

// ─── plugin/ scaffolding (replicated minimal output of plugin:scaffold) ───────

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

/** Derive a safe reverse-DNS plugin id for a fresh scaffold. */
function defaultScaffoldId(buildId, template) {
  const t = (KNOWN_TEMPLATES.has(template) ? template : 'blank').replace(/[^a-z0-9-]/g, '-')
  return `com.studio.build-${buildId}-${t}`
}

/**
 * Seed `plugin/`. When `remixFrom` names a known example, copy it. Otherwise
 * scaffold from `template`. Always leaves a valid, loadable plugin dir.
 *
 * @returns {Promise<{ ok:boolean, error?:string }>}
 */
async function seedPluginDir(destPluginDir, { template, remixFrom, buildId }) {
  await fs.ensureDir(destPluginDir)

  // Remix path: copy an example plugin verbatim.
  if (remixFrom && KNOWN_EXAMPLES.includes(remixFrom)) {
    const src = repoFile('examples', 'plugins', remixFrom)
    if (await fs.pathExists(src)) {
      await fs.copy(src, destPluginDir, {
        dereference: false,
        filter: (s) => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(s),
      })
      return { ok: true }
    }
    // fall through to scaffold if the example is somehow missing
  }

  // Scaffold path: write a minimal valid plugin.
  const tmpl = KNOWN_TEMPLATES.has(template) ? template : 'blank'
  const id = defaultScaffoldId(buildId, tmpl)
  const manifest = buildScaffoldManifest({ id, name: id, template: tmpl })
  await fs.writeFile(
    path.join(destPluginDir, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  )
  await fs.writeFile(path.join(destPluginDir, 'index.js'), scaffoldEntrySource(tmpl), 'utf8')
  await fs.writeFile(
    path.join(destPluginDir, 'README.md'),
    `# ${manifest.name}\n\nScaffolded ${tmpl} plugin. Edit index.js.\n`,
    'utf8',
  )
  return { ok: true }
}

// ─── Public: write the full bundle into an existing build dir ─────────────────

/**
 * Write the entire context bundle into `buildDirPath` and seed its `plugin/`.
 *
 * @param {string} buildDirPath absolute path to build-<id>/
 * @param {object} opts
 * @param {number} opts.buildId
 * @param {string} [opts.template]
 * @param {string} [opts.remixFrom]
 * @param {string} [opts.capabilitiesMarkdown]  written verbatim to CAPABILITIES.md
 * @param {string} [opts.goal]
 * @returns {Promise<{ ok:boolean, error?:string }>}
 */
export async function writeContextBundle(buildDirPath, opts = {}) {
  try {
    const {
      buildId, template, remixFrom, capabilitiesMarkdown, goal,
    } = opts
    await fs.ensureDir(buildDirPath)

    // 1. The harness-agnostic guide → AGENTS.md / CLAUDE.md / GEMINI.md / .cursorrules
    const guide = await buildAgentsGuide()
    const guideText = guide || '# Plugin Studio workspace\n\nEdit the `plugin/` subdir.\n'
    await fs.writeFile(path.join(buildDirPath, 'AGENTS.md'), guideText, 'utf8')
    await fs.writeFile(path.join(buildDirPath, 'CLAUDE.md'), guideText, 'utf8')
    await fs.writeFile(path.join(buildDirPath, 'GEMINI.md'), guideText, 'utf8')
    await fs.writeFile(path.join(buildDirPath, '.cursorrules'), guideText, 'utf8')

    // 2. CAPABILITIES.md — passed in verbatim (generated renderer-side).
    const capsMd = typeof capabilitiesMarkdown === 'string' && capabilitiesMarkdown
      ? capabilitiesMarkdown
      : '# Capabilities\n\n(No live capability catalog was provided.)\n'
    await fs.writeFile(path.join(buildDirPath, 'CAPABILITIES.md'), capsMd, 'utf8')

    // 3. llms.txt + types.d.ts (verbatim copies; empty file if source missing).
    await fs.writeFile(path.join(buildDirPath, 'llms.txt'), await readRepoFileSafe('docs/llms.txt'), 'utf8')
    await fs.writeFile(path.join(buildDirPath, 'types.d.ts'), await readRepoFileSafe('packages/plugin-sdk/types.d.ts'), 'utf8')

    // 4. docs/PLUGIN_API_CONTRACT.md
    const docsDir = path.join(buildDirPath, 'docs')
    await fs.ensureDir(docsDir)
    await fs.writeFile(
      path.join(docsDir, 'PLUGIN_API_CONTRACT.md'),
      await readRepoFileSafe('docs/PLUGIN_API_CONTRACT.md'),
      'utf8',
    )

    // 5. examples/
    await copyExamples(path.join(buildDirPath, 'examples'))

    // 6. A short goal note (helps the harness orient when it re-reads the dir).
    if (typeof goal === 'string' && goal.trim()) {
      await fs.writeFile(path.join(buildDirPath, 'GOAL.md'), `# Build goal\n\n${goal.trim()}\n`, 'utf8')
    }

    // 7. Seed plugin/
    const seed = await seedPluginDir(path.join(buildDirPath, 'plugin'), { template, remixFrom, buildId })
    if (!seed.ok) return { ok: false, error: seed.error || 'failed to seed plugin dir' }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'failed to write context bundle' }
  }
}

export { KNOWN_EXAMPLES, KNOWN_TEMPLATES, ID_RE, buildScaffoldManifest }
