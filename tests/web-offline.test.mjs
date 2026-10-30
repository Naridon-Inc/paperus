import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'

const origin = 'https://paperus.test'
const sourceRoot = new URL(process.env.PAPERUS_TEST_SOURCE_ROOT || '../', import.meta.url)
const workerSource = await fs.readFile(new URL('src/renderer/web/offline-worker.js', sourceRoot), 'utf8')
function worker({ failInstall = false, badScript = false, failPut = false, existing = false, base = "/", windows = [], otherCaches = [] } = {}) {
  const handlers = {}
  const entries = new Map(existing ? [['/index.html', new Response('previous working shell')], ['/nlconfig.js', new Response('old config')]] : [])
  let removed = false
  const cache = {
    async addAll(requests) {
      if (failInstall) throw new Error('Network unavailable')
      for (const request of requests) entries.set(new URL(request.url).pathname, new Response('html fallback'))
    },
    async put(key, response) { if (failPut) throw new Error('Quota exceeded'); entries.set(typeof key === 'string' ? key : new URL(key.url).pathname, response) },
    async match(key) { return entries.get(key)?.clone() },
  }
  const sandbox = {
    self: { location: { origin, href: origin + base + "sw.js" }, clients: { claim: async () => {}, matchAll: async () => windows }, addEventListener: (name, fn) => { handlers[name] = fn } },
    caches: { open: async () => cache, keys: async () => [...(existing ? [sandbox.__cacheName] : []), ...otherCaches], delete: async () => { removed = true; entries.clear() } },
    Request: class extends Request { constructor(url, opts) { super(new URL(url, origin), opts) } },
    Response, URL, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
    fetch: async request => {
      if (failInstall) throw new Error('Network unavailable')
      const path = new URL(typeof request === 'string' ? request : request.url, origin).pathname
      return new Response(path === '/nlconfig.js' ? 'new config' : badScript ? '<html>fallback</html>' : 'script', { headers: { 'Content-Type': path === '/nlconfig.js' || !badScript ? 'text/javascript' : 'text/html' } })
    },
  }
  vm.runInNewContext(workerSource.replace('__BUILD_VERSION__', 'test').replace('__PRECACHE_ASSETS__', '["/assets/app.js"]') + ';globalThis.__cacheName=CACHE', sandbox)
  return {
    entries, removed: () => removed,
    install() { let promise; handlers.install({ waitUntil: p => { promise = p } }); return promise },
    activate() { let promise; handlers.activate({ waitUntil: p => { promise = p } }); return promise },
    request(path) { let promise; handlers.fetch({ request: { method: 'GET', url: origin + path, mode: 'cors' }, respondWith: p => { promise = p } }); return promise },
  }
}

test('failed reinstall preserves an existing complete offline cache', async () => {
  const app = worker({ failInstall: true, existing: true })
  await assert.rejects(app.install())
  assert.equal(app.removed(), false)
  assert.equal(await app.entries.get('/index.html').text(), 'previous working shell')
})

test('HTML SPA fallback must not count as a downloaded JavaScript dependency', async () => {
  await assert.rejects(worker({ badScript: true }).install())
})

test('valid online runtime config is returned even when its cache write fails', async () => {
  const app = worker({ failPut: true, existing: true })
  assert.equal(await (await app.request('/nlconfig.js')).text(), 'new config')
})

test('API requests bypass the offline application shell', () => {
  assert.equal(worker({ existing: true }).request('/api/account/config'), undefined)
})

const teamSource = (await fs.readFile(new URL('src/renderer/src/p2p-team.js', sourceRoot), 'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\n/gm, '')
  .replace('export class P2PTeamManager', 'class P2PTeamManager')
function teams(disabled = false) {
  let clock = 0
  const entry = { teamId: 'team', rootKey: 'synthetic', notes: new Map([['note', { id: 'note' }]]), replicas: new Map(), _openNotes: new Set() }
  const engine = { network: { cloudProvider: null }, destroy() {} }
  const scope = {
    window: { addEventListener() {} }, document: { hidden: false, body: { classList: { contains: () => true } }, addEventListener() {} },
    navigator: { onLine: true }, Config: { CLOUD_SYNC_URL: 'wss://paperus.test/yjs' },
    localStorage: { getItem: key => disabled && key === 'notionless_cloud_sync_disabled' ? '1' : null },
    Date: { now: () => clock }, console,
    deriveNoteSwarmKey: async () => 'synthetic', openP2PDoc: async () => engine,
    setTimeout(fn, ms) { clock += ms; entry._openNotes.add('note'); entry.replicas.delete('note'); queueMicrotask(fn) }, clearTimeout() {},
  }
  vm.runInNewContext(teamSource + '\nglobalThis.Manager=P2PTeamManager;', scope)
  const manager = new scope.Manager(); manager._teams.set('team', entry)
  return { manager, entry, scope }
}

test('editor takeover does not count an unacknowledged background upload as success', async () => {
  const { manager, entry } = teams()
  assert.notEqual(await manager._syncClosedWebNote(entry, 'note'), true)
})

test('background mirror respects the explicit per-device cloud-sync opt-out', () => {
  const { manager, entry } = teams(true)
  assert.equal(manager._canWebSync(entry), false)
})

test('a failed first install removes only its newly created cache', async () => {
  const app = worker({ failInstall: true })
  await assert.rejects(app.install())
  assert.equal(app.removed(), true)
})

test('valid JavaScript and runtime configuration complete installation', async () => {
  const app = worker()
  await app.install()
  assert.equal(await app.entries.get('/assets/app.js').text(), 'script')
  assert.equal(await app.entries.get('/nlconfig.js').text(), 'new config')
})

const engineSource = await fs.readFile(new URL('src/renderer/src/engine.js', sourceRoot), 'utf8')
test('a failed local restore tears down the document before rejecting', async () => {
  let destroyed = false
  const originalError = new Error('IndexedDB open denied')
  const request = Promise.reject(originalError)
  request.catch(() => {})
  const scope = {
    setTimeout, clearTimeout,
    DocumentEngine: class {
      constructor() { this.persistence = { _db: request, whenSynced: Promise.resolve() } }
      destroy() { destroyed = true }
      connectP2P() { throw new Error('must not connect after failed restore') }
    },
  }
  vm.runInNewContext(engineSource.slice(engineSource.indexOf('export async function openP2PDoc')).replace('export async function', 'async function') + '\nglobalThis.open=openP2PDoc', scope)
  await assert.rejects(scope.open({ docId: 'synthetic', swarmKey: 'synthetic' }), error => error === originalError)
  assert.equal(destroyed, true)
})

test('subpath installations cache their own assets instead of the origin root', async () => {
  const app = worker({ base: '/notes/' })
  await app.install()
  assert.equal(await app.entries.get('/notes/assets/app.js').clone().text(), 'script')
  assert.equal(app.entries.has('/assets/app.js'), false)
  assert.equal(await (await app.request('/notes/assets/app.js')).text(), 'script')
  assert.equal(app.request('/notes/api/account/config'), undefined)
  assert.equal(app.request('/another-app/assets/app.js'), undefined)
})

test('background mirroring is skipped when no cloud mirror is configured', () => {
  const { manager, entry, scope } = teams()
  scope.Config.CLOUD_SYNC_URL = ''
  assert.equal(manager._canWebSync(entry), false)
})

test('a per-device mirror URL enables a configured background transfer', () => {
  const { manager, entry, scope } = teams()
  scope.Config.CLOUD_SYNC_URL = ''
  scope.localStorage.getItem = key => key === 'notionless_cloud_sync_url' ? 'wss://custom.test/yjs' : null
  assert.equal(manager._canWebSync(entry), true)
})

test('a blocked local database times out and tears down before any network connection', { timeout: 200 }, async () => {
  let destroyed = false
  const scope = {
    setTimeout: fn => setTimeout(fn, 0), clearTimeout,
    DocumentEngine: class {
      constructor() { this.persistence = { _db: new Promise(() => {}), whenSynced: new Promise(() => {}) } }
      destroy() { destroyed = true }
      connectP2P() { throw new Error('must not connect before local restore') }
    },
  }
  vm.runInNewContext(engineSource.slice(engineSource.indexOf('export async function openP2PDoc')).replace('export async function', 'async function') + '\nglobalThis.open=openP2PDoc', scope)
  await assert.rejects(scope.open({ docId: 'synthetic', swarmKey: 'synthetic' }), /Timed out restoring local document storage/)
  assert.equal(destroyed, true)
})

test('activation retains all older builds while a window may still need their assets', async () => {
  const app = worker({ windows: [{ url: origin + '/' }], otherCaches: ['paperus-web-%2F-oldest', 'paperus-web-%2F-previous'] })
  await app.activate()
  assert.equal(app.removed(), false)
})

test('activation without clients prunes old builds but leaves other application scopes alone', async () => {
  const old = worker({ otherCaches: ['paperus-web-%2F-previous'] })
  await old.activate()
  assert.equal(old.removed(), true)
  const other = worker({ otherCaches: ['paperus-web-%2Fother%2F-previous'] })
  await other.activate()
  assert.equal(other.removed(), false)
})
