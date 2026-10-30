import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Precache the complete build, including lazy chunks, fonts and WASM. A shell
// without its dynamic imports is not an offline application.
export function offlineWeb() {
  let output
  return {
    name: 'paperus-offline',
    apply: 'build',
    configResolved(config) { output = path.resolve(config.root, config.build.outDir) },
    async closeBundle() {
      const files = []
      async function walk(dir) {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          const filename = path.join(dir, entry.name)
          if (entry.isDirectory()) await walk(filename)
          else if (!filename.endsWith('.map') && !['sw.js', 'nlconfig.js'].includes(entry.name)) files.push(filename)
        }
      }
      await walk(output)
      files.sort()
      const hash = createHash('sha256')
      for (const filename of files) hash.update(filename.slice(output.length)).update(await fs.readFile(filename))
      const assets = files.map(filename => '/' + path.relative(output, filename).split(path.sep).join('/'))
      const template = await fs.readFile(new URL('../src/renderer/web/offline-worker.js', import.meta.url), 'utf8')
      hash.update(template)
      await fs.writeFile(path.join(output, 'sw.js'), template
        .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16))
        .replace('__PRECACHE_ASSETS__', JSON.stringify(assets)))
    },
  }
}
