// Development-only same-origin fixture: built web app plus the real local relay.
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'

const root = path.resolve('dist-web')
const port = Number(process.env.PAPERUS_TEST_PORT || 18083)
const prefix = (process.env.PAPERUS_TEST_PREFIX || '').replace(/\/$/, '')
const relay = new URL(process.env.PAPERUS_RELAY_URL || 'http://127.0.0.1:19008')
const normalize = pathname => prefix && pathname.startsWith(prefix + '/') ? pathname.slice(prefix.length) : pathname
const types = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.wasm': 'application/wasm' }
const server = http.createServer(async (req, res) => {
  const pathname = normalize(new URL(req.url, 'http://localhost').pathname)
  if (pathname === '/health' || pathname.startsWith('/api/')) {
    const upstream = http.request(new URL(pathname, relay), { method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers)
      response.pipe(res)
    })
    upstream.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(upstream)
    return
  }
  if (pathname === '/nlconfig.js') {
    const ws = `ws://${req.headers.host}${prefix}`
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' })
    res.end('window.__NL_CONFIG=' + JSON.stringify({ SIGNALING_URL: ws + '/signaling', CLOUD_SYNC_URL: ws + '/yjs' }) + ';')
    return
  }
  try {
    const filename = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname))
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return }
    const data = await fs.readFile(filename)
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    res.end(data)
  } catch (_) { res.writeHead(404); res.end() }
})
const sockets = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const target = new URL(normalize(new URL(req.url, 'http://localhost').pathname), relay)
  target.protocol = 'ws:'
  sockets.handleUpgrade(req, socket, head, client => {
    const remote = new WebSocket(target)
    const pending = []
    client.on('message', (data, binary) => {
      if (remote.readyState === WebSocket.OPEN) remote.send(data, { binary })
      else pending.push([data, binary])
    })
    remote.on('open', () => { for (const [data, binary] of pending) remote.send(data, { binary }); pending.length = 0 })
    remote.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }) })
    remote.on('error', () => client.close())
    client.on('error', () => remote.close())
    remote.on('close', () => client.close())
    client.on('close', () => remote.close())
  })
})
server.listen(port, '127.0.0.1', () => console.log(`Browser fixture: http://localhost:${port}${prefix}/`))
