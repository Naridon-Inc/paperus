/*
 * MCP subsystem — IPC surface. `registerMcpIpc(app, { getMainWindow })`.
 *
 * Bridges the renderer's Company Brain to the main-process McpManager so the
 * agentic chat loop can list and call tools from any configured MCP server.
 *
 * Renderer → main (all return { ok, ... }):
 *   mcp:list                          → { servers:[…] }            (config + live status)
 *   mcp:tools                         → { tools:[…] }              (flattened, for tool registration)
 *   mcp:add        { config }         → { id, status, toolCount }
 *   mcp:update     { id, patch }      → { status, toolCount }
 *   mcp:remove     { id }             → {}
 *   mcp:reconnect  { id }             → { status, toolCount }
 *   mcp:test       { config }         → { toolCount, tools }
 *   mcp:import     { json }           → { added:[ids] }
 *   mcp:call       { server, tool, args } → { text, isError }      (the Brain's tool dispatch)
 *
 * main → renderer:  webContents.send('message', 'mcp:changed', { reason })
 */
import { ipcMain } from 'electron'
import { McpManager } from './manager.js'

let _registered = false
let _getMainWindow = () => null
let _mgr = null

const ok = (extra = {}) => ({ ok: true, ...extra })
const fail = (err) => ({ ok: false, error: err && err.message ? err.message : (typeof err === 'string' ? err : 'mcp error') })

function changed(reason) {
  try {
    const win = _getMainWindow()
    if (win && win.webContents && !win.webContents.isDestroyed?.()) {
      win.webContents.send('message', 'mcp:changed', { reason })
    }
  } catch (_e) { /* noop */ }
}

async function handleList() { return ok({ servers: _mgr.list() }) }
async function handleTools() { return ok({ tools: _mgr.tools() }) }

async function handleAdd(args) {
  const r = await _mgr.add((args && args.config) || {})
  if (r.ok) changed('add')
  return r
}

async function handleUpdate(args) {
  const r = await _mgr.update(args && args.id, (args && args.patch) || {})
  if (r.ok) changed('update')
  return r
}

async function handleRemove(args) {
  const r = await _mgr.remove(args && args.id)
  if (r.ok) changed('remove')
  return r
}

async function handleReconnect(args) {
  const r = await _mgr.connect(args && args.id)
  changed('reconnect')
  return r
}

async function handleTest(args) { return _mgr.test((args && args.config) || {}) }

async function handleImport(args) {
  const r = await _mgr.importJson(args && args.json)
  if (r.ok) changed('import')
  return r
}

async function handleCall(args) {
  if (!args || !args.server || !args.tool) return fail('server and tool are required')
  return _mgr.callTool(args.server, args.tool, args.args || {})
}

/**
 * @param {{ getMainWindow?: () => import('electron').BrowserWindow|null }} opts
 */
export function registerMcpIpc(app, opts = {}) {
  if (_registered) return
  _registered = true
  _getMainWindow = (opts && typeof opts.getMainWindow === 'function') ? opts.getMainWindow : () => null

  try {
    _mgr = new McpManager()
  } catch (e) {
    console.warn('[McpIpc] manager init failed; MCP disabled:', e && e.message)
    return
  }

  const wrap = (fn) => async (_event, args) => {
    try { return await fn(args) } catch (err) { return fail(err) }
  }

  ipcMain.handle('mcp:list', wrap(handleList))
  ipcMain.handle('mcp:tools', wrap(handleTools))
  ipcMain.handle('mcp:add', wrap(handleAdd))
  ipcMain.handle('mcp:update', wrap(handleUpdate))
  ipcMain.handle('mcp:remove', wrap(handleRemove))
  ipcMain.handle('mcp:reconnect', wrap(handleReconnect))
  ipcMain.handle('mcp:test', wrap(handleTest))
  ipcMain.handle('mcp:import', wrap(handleImport))
  ipcMain.handle('mcp:call', wrap(handleCall))

  // Connect enabled servers in the background, then tell the renderer to (re)register
  // their tools. Never blocks startup; a dead server just shows an error status.
  Promise.resolve(_mgr.connectAll()).then(() => changed('startup')).catch(() => {})

  try {
    app.on('before-quit', () => { Promise.resolve(_mgr.dispose()).catch(() => {}) })
  } catch (_e) { /* noop */ }

  console.log('[McpIpc] mcp:* IPC handlers registered')
}
