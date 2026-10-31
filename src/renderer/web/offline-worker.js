/* Only application files belong in this cache. Notes stay in IndexedDB;
 * account APIs, health checks and sync traffic must always reach the server. */
const ROOT = new URL('./', self.location.href)
const PREFIX = `paperus-web-${encodeURIComponent(ROOT.pathname)}-`
const CACHE = PREFIX + '__BUILD_VERSION__'
const ASSETS = __PRECACHE_ASSETS__
const scoped = path => new URL(path.replace(/^\//, ''), ROOT).pathname
const STATIC = new Set(ASSETS.map(scoped))

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const existed = (await caches.keys()).includes(CACHE)
    const cache = await caches.open(CACHE)
    try {
      // Do not activate until every dependency is downloaded and validated.
      // SPA servers can return index.html with status 200 for missing assets.
      const urls = [...ASSETS, '/nlconfig.js']
      for (let start = 0; start < urls.length; start += 8) {
        await Promise.all(urls.slice(start, start + 8).map(async url => {
          const request = new Request(new URL(scoped(url), ROOT.origin), { cache: 'reload' })
          const response = await fetch(request)
          const type = response.headers.get('Content-Type') || ''
          if (!response.ok ||
              (/\.m?js$/.test(url) && !/javascript|ecmascript/.test(type)) ||
              (/\.css$/.test(url) && !/text\/css/.test(type)) ||
              (!/\.html$/.test(url) && /text\/html/.test(type))) {
            throw new Error(`Invalid offline dependency: ${url}`)
          }
          await cache.put(scoped(url), response)
        }))
      }
    } catch (error) {
      // A rollback can reinstall a retained version. Never delete the working
      // cache which an older open tab still needs if that reinstall fails.
      if (!existed) await caches.delete(CACHE)
      throw error
    }
    // Updates wait for old tabs to close, or an explicit user refresh.
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Multiple old tabs can span more than one release. Keep their caches until
    // an activation without open clients; retaining just one old build is unsafe.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const hasOpenClients = clients.some(client => {
      const url = new URL(client.url)
      return url.origin === ROOT.origin && url.pathname.startsWith(ROOT.pathname)
    })
    if (!hasOpenClients) {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name)
      }
    }
    await self.clients.claim()
  })())
})

self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting()
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (!url.pathname.startsWith(ROOT.pathname)) return
  const path = '/' + url.pathname.slice(ROOT.pathname.length)
  if (path.startsWith('/api/') || path === '/health' ||
      path === '/signaling' || path.startsWith('/yjs/')) return

  if (path === '/nlconfig.js') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)
      try {
        const response = await fetch(request, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok || !/javascript/.test(response.headers.get('Content-Type') || '')) throw new Error('Invalid runtime config')
        try { await cache.put(scoped('/nlconfig.js'), response.clone()) } catch (_) { /* online response still wins */ }
        return response
      } catch (error) {
        return await cache.match(scoped('/nlconfig.js')) || Response.error()
      } finally { clearTimeout(timeout) }
    })())
    return
  }

  if (request.mode === 'navigate' || STATIC.has(url.pathname) || path.startsWith('/assets/')) {
    event.respondWith((async () => {
      const key = request.mode === 'navigate' ? scoped('/index.html') : url.pathname
      const current = await caches.open(CACHE)
      const cached = await current.match(key)
      if (cached) return cached
      // An older tab may still request a content-hashed chunk from its build.
      if (path.startsWith('/assets/')) {
        for (const name of await caches.keys()) {
          if (!name.startsWith(PREFIX)) continue
          const old = await (await caches.open(name)).match(key)
          if (old) return old
        }
      }
      return fetch(request)
    })())
  }
})
