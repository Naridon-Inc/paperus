import { app, shell, BrowserWindow, ipcMain, dialog, Menu, systemPreferences, safeStorage } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join, basename, extname } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'fs-extra'
import settings from 'electron-settings'
import { ManifestManager } from './manifest' // Import Manifest
import * as gitSync from './git-sync' // Obsidian-style git-repo sync
import { registerPluginIpc, refreshPluginWatcher } from './plugin-manager' // Sandboxed plugin system (main-process IPC + hot-reload watcher)
import { registerStudioIpc } from './plugin-studio/studio-manager' // Plugin Studio: agentic plugin builder (author-time, consent-gated, OFF by default)
import { resolveClaudeBin, resolveGeminiBin, resolveBin, cliEnv } from './plugin-studio/cli-discovery' // Robust harness discovery (login-shell PATH aware) shared with the Studio
import { WebSocketServer } from 'ws'
import { execFile } from 'child_process'
import http from 'http'
import path from 'path' // Ensure path is imported for protocol handler
import chokidar from 'chokidar'
import * as Sentry from "@sentry/electron/main";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
Object.assign(globalThis, { __filename, __dirname });

// Force-remove insecure switches if launcher/dev tooling injects them.
try {
  app.commandLine.removeSwitch('disable-web-security')
  app.commandLine.removeSwitch('allow-running-insecure-content')
} catch (e) {
  console.warn('[Security] Failed to remove insecure CLI switches:', e)
}

Sentry.init({
  dsn: "https://b099dd12c10c487532db7dd6a77221de@o4507310143045632.ingest.de.sentry.io/4510861406502992",
});

// Force app name (helpful in dev mode)
if (process.platform === 'darwin') {
  app.setName('Notionless')
}

let manifests = new Map(); // Map<rootPath, ManifestManager>
let mainWindowRef = null; // Set in createWindow(); used by the OAuth deep-link handler.

// ─── OAuth deep-link (custom protocol) ──────────────────────────────────────
// The desktop OAuth flow opens the system browser; the backend redirects the
// signed-in JWT back to `notionless://auth?token=...`. The OS hands that URL to
// this app, and we forward the token to the renderer to complete login.
function handleAuthDeepLink(url) {
  try {
    if (!url || typeof url !== 'string') return
    // Only act on our auth deep link; ignore other notionless:// links (e.g. open-url).
    if (!url.startsWith('notionless://auth')) return

    let token = null
    let error = null
    try {
      const parsed = new URL(url)
      token = parsed.searchParams.get('token')
      error = parsed.searchParams.get('error')
    } catch (_e) {
      // Fallback for malformed URLs that the WHATWG parser rejects.
      const m = /[?&]token=([^&]+)/.exec(url)
      if (m) token = decodeURIComponent(m[1])
    }

    const win = mainWindowRef && !mainWindowRef.isDestroyed()
      ? mainWindowRef
      : BrowserWindow.getAllWindows()[0]

    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      if (token) {
        win.webContents.send('auth:oauth-token', token)
      } else if (error) {
        win.webContents.send('auth:oauth-token', null, error)
      }
    }
  } catch (e) {
    console.warn('[Main] handleAuthDeepLink failed:', e)
  }
}

// Route ANY notionless:// deep link. Auth tokens complete desktop sign-in
// (legacy); everything else — invite/share links from the smart web landing,
// `notionless://invite#team=…` / `#share=…` — is forwarded to the renderer's
// 'open-url' handler, which reuses the same #team=/#share= parsers as the web
// flow. Used by all three OS entry points (macOS open-url, Windows/Linux
// second-instance + cold start) so deep links work cross-platform.
let pendingDeepLink = null
function routeDeepLink(url) {
  if (!url || typeof url !== 'string') return
  if (url.startsWith('notionless://auth')) { handleAuthDeepLink(url); return }
  const win = mainWindowRef && !mainWindowRef.isDestroyed()
    ? mainWindowRef
    : BrowserWindow.getAllWindows()[0]
  // Cold start from the protocol (e.g. macOS open-url before the window exists):
  // stash the link and flush it once the renderer is ready (see whenReady).
  if (!win) { pendingDeepLink = url; return }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  // The renderer registers its 'open-url' listener during page load, so wait for
  // did-finish-load if the window is still loading; otherwise send immediately.
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => win.webContents.send('message', 'open-url', url))
  } else {
    win.webContents.send('message', 'open-url', url)
  }
}

// Flush a deep link that arrived before any window existed (cold start).
function flushPendingDeepLink(win) {
  if (!pendingDeepLink || !win) return
  const url = pendingDeepLink
  pendingDeepLink = null
  win.webContents.once('did-finish-load', () => win.webContents.send('message', 'open-url', url))
}

async function getManifestForPath(filePath) {
  if (!filePath) return null
  // Find the manifest whose root path is the longest prefix of filePath
  let bestMatch = null;
  let maxLen = 0;
  
  for (const [root, manager] of manifests) {
    if (filePath.startsWith(root) && root.length > maxLen) {
      bestMatch = manager;
      maxLen = root.length;
    }
  }
  return bestMatch;
}

// Ensure a manifest exists for a root path
async function ensureManifest(rootPath) {
  // Safety: Prevent initializing manifest in heavy folders like Downloads/Home/Root
  const home = app.getPath('home');
  const downloads = app.getPath('downloads');
  const desktop = app.getPath('desktop');
  const documents = app.getPath('documents'); // Documents is usually safe, but let's be careful
  
  const unsafeRoots = [home, downloads, desktop, '/'];
  
  // Normalize paths for comparison
  const normalizedRoot = path.resolve(rootPath);
  
  if (unsafeRoots.some(u => normalizedRoot === path.resolve(u))) {
      console.log('[Main] Unsafe root detected, using Global Manifest instead:', rootPath);
      // Use the global "Loose Files" manifest stored in appData
      const userData = app.getPath('userData');
      const globalRoot = join(userData, 'GlobalWorkspace');
      await fs.ensureDir(globalRoot);
      
      // We map the *real* file path to this global manifest
      if (!manifests.has(globalRoot)) {
          const m = new ManifestManager(globalRoot);
          await m.init();
          manifests.set(globalRoot, m);
      }
      return manifests.get(globalRoot);
  }

  if (!manifests.has(rootPath)) {
    const m = new ManifestManager(rootPath);
    await m.init();
    manifests.set(rootPath, m);
    console.log('[Main] Manifest initialized for root:', rootPath);
  }
  return manifests.get(rootPath);
}

let fileWatcher = null
const ignoreNextChange = new Set() // Track files we just wrote ourselves

function setupFileWatcher(projectPath, mainWindow) {
  if (fileWatcher) fileWatcher.close()
  
  fileWatcher = chokidar.watch(projectPath, {
    ignored: /(^|[\/\\])\..|node_modules/, // ignore dotfiles and node_modules
    persistent: true,
    ignoreInitial: true,
    depth: 99
  })

  const fileHandler = (filePath) => {
    // If we just wrote this file, ignore the first change event from the OS
    if (ignoreNextChange.has(filePath)) {
        ignoreNextChange.delete(filePath)
        return
    }
    
    // We notify renderer, it decides what to do based on what's open
    console.log('[Main] File changed/updated:', filePath)
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('message', 'file-changed', filePath)
        // Also refresh project tree for adds
        mainWindow.webContents.send('message', 'refresh-project')
    }
  }

  fileWatcher.on('change', (filePath) => {
    if (ignoreNextChange.has(filePath)) {
        ignoreNextChange.delete(filePath)
        return
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('message', 'file-changed', filePath)
    }
  })

  fileWatcher.on('add', fileHandler)
  fileWatcher.on('unlink', (filePath) => {
      console.log('[Main] File deleted:', filePath)
      if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('message', 'refresh-project')
      }
  })
}

function createWindow() {
  // Check for updates
  autoUpdater.checkForUpdatesAndNotify()

  console.log('[Security] CLI switches:', {
    disableWebSecurity: app.commandLine.hasSwitch('disable-web-security'),
    allowRunningInsecureContent: app.commandLine.hasSwitch('allow-running-insecure-content')
  })

  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: false,
    titleBarStyle: 'hidden', 
    trafficLightPosition: { x: 18, y: 18 }, // Center vertically in 44px header
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  // Track the primary window for OAuth deep-link forwarding.
  mainWindowRef = mainWindow

  // Set up the application menu
  const isMac = process.platform === 'darwin'

  const menuTemplate = [
    // { role: 'appMenu' } (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    // { role: 'fileMenu' }
    {
      label: 'File',
      submenu: [
        {
          label: 'Save Version...',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow.webContents.send('message', 'save-version')
          }
        },
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('message', 'new-note')
          }
        },
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, { 
              properties: ['openDirectory', 'createDirectory'] 
            })
            if (!result.canceled && result.filePaths.length > 0) {
              const path = result.filePaths[0]
              settings.setSync('lastProject', path)
              
              // Initialize Manifest
              await ensureManifest(path)
              
              // Start File Watcher
              setupFileWatcher(path, mainWindow)

              // Re-point the plugin hot-reload watcher at the new workspace's
              // `.notionless/plugins/` dir (best-effort; never blocks open).
              try { refreshPluginWatcher() } catch (e) { console.warn('[Main] refreshPluginWatcher failed:', e) }

              // Reload or notify renderer
              mainWindow.webContents.send('message', 'refresh-project', path)
              mainWindow.reload()
            }
          }
        },
        {
          label: 'Save Workspace As...',
          click: () => {
            mainWindow.webContents.send('message', 'save-workspace')
          }
        },
        {
          label: 'Open Workspace...',
          click: () => {
            mainWindow.webContents.send('message', 'open-workspace')
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Speech',
          submenu: [
            { role: 'startSpeaking' },
            { role: 'stopSpeaking' }
          ]
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        {
          label: 'Zoom In',
          accelerator: 'CommandOrControl+=',
          role: 'zoomIn'
        },
        {
          label: 'Zoom Out',
          accelerator: 'CommandOrControl+-',
          role: 'zoomOut'
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://electronjs.org')
          }
        },
        ...(!isMac ? [
          { type: 'separator' },
          { role: 'about' }
        ] : [])
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(menuTemplate)
  Menu.setApplicationMenu(menu)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    try {
      const prefs = mainWindow.webContents.getLastWebPreferences()
      const effectivePrefs = {
        webSecurity: prefs?.webSecurity,
        allowRunningInsecureContent: prefs?.allowRunningInsecureContent,
        contextIsolation: prefs?.contextIsolation,
        sandbox: prefs?.sandbox,
        nodeIntegration: prefs?.nodeIntegration
      }
      const cliSwitches = {
        disableWebSecurity: app.commandLine.hasSwitch('disable-web-security'),
        allowRunningInsecureContent: app.commandLine.hasSwitch('allow-running-insecure-content')
      }
      console.log('[Security] Effective webPreferences:', effectivePrefs)
      console.log('[Security] CLI switches:', cliSwitches)
      mainWindow.webContents.executeJavaScript(
        `console.log('[Main->Renderer Security] Effective webPreferences', ${JSON.stringify(effectivePrefs)});
         console.log('[Main->Renderer Security] CLI switches', ${JSON.stringify(cliSwitches)});`
      ).catch(() => {})
    } catch (e) {
      console.warn('[Security] Could not read effective webPreferences:', e)
    }
  })

  // Full Screen Events
  mainWindow.on('enter-full-screen', () => {
    console.log('[Main] Entered full screen')
    mainWindow.webContents.send('message', 'enter-full-screen')
  })
  
  mainWindow.on('leave-full-screen', () => {
    console.log('[Main] Left full screen')
    mainWindow.webContents.send('message', 'leave-full-screen')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  
  return mainWindow
}

const ALLOWED_AI_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function buildSafeOllamaUrl(endpoint, requestPath) {
  const base = new URL(String(endpoint || 'http://127.0.0.1:11434'))
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new Error('Invalid Ollama endpoint protocol')
  }
  if (!ALLOWED_AI_HOSTS.has(base.hostname)) {
    throw new Error('Ollama endpoint must be localhost')
  }
  const target = new URL(requestPath, base)
  if (target.origin !== base.origin) {
    throw new Error('Cross-origin Ollama request blocked')
  }
  return target.toString()
}

// Register IPC Handlers (Global, only once)
function registerIPCHandlers(mainWindow) {
  // IPC Handlers
  ipcMain.on('open-external', (_, url) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      // For OAuth start URLs, signal desktop mode so the backend redirects the
      // JWT back to the notionless:// deep link instead of the web app.
      let outUrl = url
      try {
        if (/\/auth\/(github|google)(\b|\/|\?|$)/.test(url)) {
          const u = new URL(url)
          if (!u.searchParams.has('client')) u.searchParams.set('client', 'desktop')
          outUrl = u.toString()
        }
      } catch (_e) {
        // If URL parsing fails, fall back to opening the original URL unchanged.
        outUrl = url
      }
      shell.openExternal(outUrl)
    }
  })

  ipcMain.handle('settings:get', (_, key) => settings.getSync(key))
  ipcMain.handle('settings:set', (_, key, value) => settings.setSync(key, value))
  ipcMain.handle('settings:has', (_, key) => settings.hasSync(key))
  ipcMain.handle('app:getVersion', () => app.getVersion())

  // ─── Git-repo sync (isomorphic-git) ───
  ipcMain.handle('git:status', (_, dir) => gitSync.getStatus(dir))
  ipcMain.handle('git:init', (_, dir, remoteUrl) => gitSync.init(dir, remoteUrl))
  ipcMain.handle('git:setRemote', (_, dir, url) => gitSync.setRemote(dir, url))
  ipcMain.handle('git:sync', (_, dir, opts) => gitSync.sync(dir, opts))
  ipcMain.handle('git:clone', (_, dir, url, token) => gitSync.clone(dir, url, token))

  ipcMain.handle('fs:readFile', (_, path) => fs.readFile(path, 'utf8'))

  // Read a local image as a data: URL so the renderer can display it without
  // tripping webSecurity (file:// is blocked when the page is served over http
  // in dev). Used for page covers / local image embeds.
  ipcMain.handle('fs:readFileDataUrl', async (_, filePath) => {
    try {
      if (!filePath) return null
      let p = String(filePath).replace(/^file:\/\//, '')
      try { p = decodeURI(p) } catch (_e) { /* keep as-is */ }
      const buf = await fs.readFile(p)
      const ext = extname(p).toLowerCase()
      const mime = ({
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
        '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
      })[ext] || 'application/octet-stream'
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch (e) {
      console.warn('[Main] fs:readFileDataUrl failed:', e)
      return null
    }
  })

  // Touch ID & SafeStorage
  ipcMain.handle('auth:can-prompt-touch-id', () => {
      return process.platform === 'darwin' && systemPreferences.canPromptTouchID()
  })

  ipcMain.handle('auth:prompt-touch-id', async (_, reason) => {
      if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
          try {
              await systemPreferences.promptTouchID(reason)
              return true
          } catch (e) {
              console.error('Touch ID failed:', e)
              return false
          }
      }
      return false
  })

  ipcMain.handle('auth:secure-save', async (_, key, value) => {
      if (safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(value)
          // Store as base64 to ensure JSON compatibility in settings
          settings.setSync(`secure_${key}`, encrypted.toString('base64'))
          return true
      }
      return false
  })

  ipcMain.handle('auth:secure-load', async (_, key) => {
      if (safeStorage.isEncryptionAvailable()) {
          const encryptedStr = settings.getSync(`secure_${key}`)
          if (!encryptedStr) return null
          try {
              const buffer = Buffer.from(encryptedStr, 'base64')
              const decrypted = safeStorage.decryptString(buffer)
              return decrypted
          } catch (e) {
              console.error('Decryption failed:', e)
              return null
          }
      }
      return null
  })
  
  ipcMain.handle('auth:secure-clear', async (_, key) => {
      console.log('[Main] Clearing secure key:', key)
      settings.unsetSync(`secure_${key}`)
      return true
  })

  ipcMain.handle('ai:ollama-request', async (_, payload = {}) => {
    const endpoint = String(payload.endpoint || 'http://127.0.0.1:11434')
    const requestPath = String(payload.path || '/api/tags')
    const method = String(payload.method || 'GET').toUpperCase()
    const body = payload.body

    try {
      const url = buildSafeOllamaUrl(endpoint, requestPath)
      const controller = new AbortController()
      const timeoutVal = payload.timeout || (requestPath.includes('/generate') ? 60000 : 8000)
      const timeout = setTimeout(() => controller.abort(), timeoutVal)
      const headers = body ? { 'Content-Type': 'application/json' } : undefined

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      }).finally(() => clearTimeout(timeout))

      const text = await res.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch (_e) {
        data = null
      }

      return {
        ok: res.ok,
        status: res.status,
        data,
        text: data ? '' : text
      }
    } catch (e) {
      return {
        ok: false,
        status: 0,
        data: null,
        text: '',
        error: e?.message || 'Ollama request failed'
      }
    }
  })

  // ---- Claude Code backend: use the user's installed `claude` CLI as the Brain LLM.
  // No API key needed — it rides their existing Claude Code auth. We resolve the
  // binary to an absolute path and pass the prompt as an argv item (no shell), so
  // there's no injection surface. cwd is a temp dir so it never scans their repo.
  // Harness discovery is shared with Plugin Studio (cli-discovery.js): it probes
  // the canonical install dirs AND the user's real login-shell PATH, so a GUI
  // launch (minimal PATH) still finds `claude` in ~/.local/bin, `gemini` in
  // /opt/homebrew/bin, or anything installed via nvm/fnm/pnpm/volta/a custom dir.
  // claudeEnv() carries that full PATH so node-shebang CLIs (gemini) find `node`.
  const claudeEnv = () => cliEnv(app)

  // Probe a discovered CLI's `--version` to confirm it actually runs. Shared by
  // the claude / gemini / generic availability handlers below.
  const probeCli = (bin) => new Promise((resolve) => {
    if (!bin) return resolve({ ok: false, available: false })
    try {
      execFile(bin, ['--version'], { timeout: 6000, env: cliEnv(app) }, (err, stdout) => {
        if (err) resolve({ ok: false, available: false, error: err.message })
        else resolve({ ok: true, available: true, version: String(stdout || '').trim(), path: bin })
      })
    } catch (e) { resolve({ ok: false, available: false, error: e?.message }) }
  })

  ipcMain.handle('ai:claude-code-available', async () => probeCli(resolveClaudeBin(app)))

  // Parity probe for Gemini CLI ("or gemini or whatever they have").
  ipcMain.handle('ai:gemini-available', async () => probeCli(resolveGeminiBin(app)))

  // Generic: detect ANY harness the user has by command name (claude, gemini,
  // cursor-agent, aider, opencode, …). The renderer passes { name }.
  ipcMain.handle('ai:cli-available', async (_, payload = {}) => {
    const name = String(payload?.name || '').trim()
    if (!name) return { ok: false, available: false, error: 'No CLI name given.' }
    return probeCli(resolveBin(name, app))
  })

  ipcMain.handle('ai:claude-code', async (_, payload = {}) => {
    const bin = resolveClaudeBin(app)
    if (!bin) return { ok: false, error: 'Claude Code CLI not found. Install it from claude.com/code, then reopen this panel.' }
    const prompt = String(payload.prompt || '')
    if (!prompt.trim()) return { ok: false, error: 'Empty prompt.' }
    const args = ['-p', prompt]
    if (payload.model) args.push('--model', String(payload.model))
    return await new Promise((resolve) => {
      try {
        execFile(bin, args, {
          timeout: payload.timeout || 120000,
          maxBuffer: 8 * 1024 * 1024,
          cwd: app.getPath('temp'),
          env: claudeEnv(),
        }, (err, stdout, stderr) => {
          if (err) resolve({ ok: false, error: (stderr && String(stderr).trim()) || err.message })
          else resolve({ ok: true, text: String(stdout || '').trim() })
        })
      } catch (e) { resolve({ ok: false, error: e?.message || 'Claude Code execution failed' }) }
    })
  })

  // Generic coding-agent backend: drive ANY installed CLI headlessly as Brain's
  // answerer — `<cmd> <promptFlag> "<prompt>"` → stdout. Used for Gemini and
  // "whatever they have". Binary resolved via the shared (login-PATH-aware)
  // resolver; spawned with the full login PATH so node-shebang CLIs find node.
  ipcMain.handle('ai:cli-run', async (_, payload = {}) => {
    const name = String(payload?.cmd || payload?.name || '').trim()
    if (!name) return { ok: false, error: 'No coding-agent command given.' }
    const bin = resolveBin(name, app)
    if (!bin) return { ok: false, error: `${name} not found on this Mac. Install it and sign in, then retry.` }
    const prompt = String(payload.prompt || '')
    if (!prompt.trim()) return { ok: false, error: 'Empty prompt.' }
    const flag = String(payload.promptFlag || '-p')
    const args = [flag, prompt]
    if (payload.model) args.push(String(payload.modelFlag || '--model'), String(payload.model))
    if (Array.isArray(payload.extraArgs)) for (const a of payload.extraArgs) args.push(String(a))
    return await new Promise((resolve) => {
      try {
        execFile(bin, args, {
          timeout: payload.timeout || 120000,
          maxBuffer: 8 * 1024 * 1024,
          cwd: app.getPath('temp'),
          env: cliEnv(app),
        }, (err, stdout, stderr) => {
          if (err) resolve({ ok: false, error: (stderr && String(stderr).trim()) || err.message })
          else resolve({ ok: true, text: String(stdout || '').trim() })
        })
      } catch (e) { resolve({ ok: false, error: e?.message || `${name} execution failed` }) }
    })
  })

  // Open an external URL in the user's default browser (for Brain setup links).
  ipcMain.handle('shell:openExternal', async (_, url) => {
    try { await shell.openExternal(String(url)); return true } catch (_) { return false }
  })

  // PDF Export
  ipcMain.handle('export:pdf', async (event, options) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow
      
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: options.filename ? options.filename.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_') + '.pdf' : 'document.pdf',
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      })
      
      if (canceled || !filePath) return false
      
      // Force layout for printing to ensure content flows
      // We inject CSS to ensure height is auto and overflow is visible during print
      await win.webContents.insertCSS(`
        @media print {
          html, body {
            height: auto !important;
            overflow: visible !important;
          }
          #app, .window-layout, .main, .editor-container {
            height: auto !important;
            overflow: visible !important;
            position: static !important;
            display: block !important;
          }
          .ql-editor {
            height: auto !important;
            overflow: visible !important;
          }
          /* Hide non-printable elements */
          aside, header, footer, .tabs-header, .selection-toolbar, .link-tooltip {
            display: none !important;
          }
        }
      `)

      const pdfData = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: options.pageSize || 'A4',
        landscape: options.landscape || false,
        scale: (options.scale || 100) / 100,
        margins: { 
            top: 0.4,
            bottom: 0.4,
            left: 0.4,
            right: 0.4
        }
      })
      
      await fs.writeFile(filePath, pdfData)
      return true
    } catch (error) {
      console.error('PDF Export failed:', error)
      throw error
    }
  })
  ipcMain.handle('workspace:save', async (_, data) => {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
          filters: [{ name: 'Notionless Workspace', extensions: ['notionless-workspace'] }]
      })
      
      if (!canceled && filePath) {
          await fs.writeJson(filePath, data)
          return true
      }
      return false
  })

  ipcMain.handle('workspace:load', async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
          filters: [{ name: 'Notionless Workspace', extensions: ['notionless-workspace'] }],
          properties: ['openFile']
      })
      
      if (!canceled && filePaths.length > 0) {
          try {
              // Also start watcher if we loaded a workspace referencing a project?
              // The workspace file just contains pointers.
              // We should probably watch the 'lastProject' if it gets set.
              return await fs.readJson(filePaths[0])
          } catch (e) {
              console.error('Failed to load workspace:', e)
              return null
          }
      }
      return null
  })
  
  // Watch last project on startup if exists
  const lastProject = settings.getSync('lastProject')
  if (lastProject && fs.existsSync(lastProject)) {
      setupFileWatcher(lastProject, mainWindow)
  }

  ipcMain.handle('fs:getDocId', async (_, filePath) => {
    if (!filePath) return null;
    
    // 1. Try to find existing manifest (Longest prefix match)
    let manifestManager = await getManifestForPath(filePath);
    
    // 2. If no manifest found, treat the file's directory as a new implicit root
    if (!manifestManager) {
        const dir = path.dirname(filePath)
        console.log('[Main] No manifest found for file, initializing implicit root at:', dir)
        
        // This will now redirect unsafe roots to GlobalWorkspace
        manifestManager = await ensureManifest(dir)
    }
    
    if (!manifestManager) return null;
    
    // Normalize path to relative if it's within project root
    let storedPath = filePath;
    if (filePath.startsWith(manifestManager.projectPath)) {
        storedPath = filePath.replace(manifestManager.projectPath, '').replace(/^[\\\/]+/, '');
    }
    
    return await manifestManager.registerFile(storedPath)
  })

  ipcMain.handle('fs:getPathByDocId', async (_, docId) => {
    for (const manager of manifests.values()) {
        const relPath = manager.getPathByDocId(docId)
        if (relPath) {
            // Check if relPath is actually absolute (Global Manifest case)
            if (path.isAbsolute(relPath)) {
                return relPath
            }
            return join(manager.projectPath, relPath)
        }
    }
    return null
  })

  ipcMain.handle('fs:addRoot', async (_, rootPath) => {
      await ensureManifest(rootPath);
      return true;
  })

  ipcMain.handle('fs:saveSnapshot', async (_, { docId, metadata, data }) => {
    try {
      // We need to find WHICH manifest owns this docId.
      // This is tricky because docIds are UUIDs. 
      // We have to iterate all manifests? Or store a mapping docId -> rootPath.
      // Iterating is fine for now (workspaces are small).
      let manifestManager = null;
      for (const m of manifests.values()) {
          // This check is inefficient if we don't know the path.
          // BUT, we save snapshots to .notionless/history/docId.
          // We can check if that directory exists? 
          // Better: The Renderer should probably send the rootPath? 
          // Or we iterate.
          
          // Actually, 'fs:saveSnapshot' assumes we know where to save.
          // If we look at the implementation:
          // const historyDir = join(manifestManager.projectPath, '.opus', 'history', docId)
          // We can just try to see if this manifest KNOWS about this docId?
          // ManifestManager usually has a map of id -> path.
          if (m.getPathByDocId(docId)) {
              manifestManager = m;
              break;
          }
      }
      
      if (!manifestManager) {
          // If we can't find it by ID, maybe it's a new file?
          // But we can't save a snapshot without a location.
          console.warn('[Main] No manifest found for docId:', docId);
          return false;
      }
      
      const historyDir = join(manifestManager.projectPath, '.notionless', 'history', docId)
      await fs.ensureDir(historyDir)
      
      // Save metadata
      await fs.writeJson(join(historyDir, `${metadata.id}.json`), metadata)
      
      // Save binary
      await fs.writeFile(join(historyDir, `${metadata.id}.bin`), Buffer.from(data))
      
      // Prune old snapshots (keep 50)
      const files = await fs.readdir(historyDir)
      const snapshots = files.filter(f => f.endsWith('.json')).sort().reverse()
      
      if (snapshots.length > 50) {
        for (const file of snapshots.slice(50)) {
          const id = file.replace('.json', '')
          await fs.remove(join(historyDir, `${id}.json`))
          await fs.remove(join(historyDir, `${id}.bin`))
        }
      }
      return true
    } catch (e) {
      console.error('Snapshot save failed:', e)
      return false
    }
  })

  ipcMain.handle('fs:loadSnapshot', async (_, { docId, snapshotId }) => {
    try {
      let manifestManager = null;
      for (const m of manifests.values()) {
          if (m.getPathByDocId(docId)) {
              manifestManager = m;
              break;
          }
      }
      if (!manifestManager) return null
      
      const historyDir = join(manifestManager.projectPath, '.notionless', 'history', docId)
      
      // Try New Format (.bin)
      let path = join(historyDir, `${snapshotId}.bin`)
      if (await fs.pathExists(path)) {
        return await fs.readFile(path)
      }
      
      // Try Legacy Format (.snap) - treat as binary/text
      path = join(historyDir, `${snapshotId}.snap`)
      if (await fs.pathExists(path)) {
        return await fs.readFile(path)
      }
      
      // Try if ID already has extension
      path = join(historyDir, snapshotId)
      if (await fs.pathExists(path)) {
        return await fs.readFile(path)
      }
      
      return null
    } catch (e) {
      console.error('Snapshot load failed:', e)
      return null
    }
  })

  ipcMain.handle('fs:writeFile', async (_, path, contents) => {
    // 1. Register file in Manifest (Identity)
    let manifestManager = await getManifestForPath(path);
    if (manifestManager) {
      const relativePath = path.replace(manifestManager.projectPath + '/', '')
      await manifestManager.registerFile(relativePath)
    }

    // 2. Mark for watcher to ignore next change
    ignoreNextChange.add(path)

    // 3. Write the actual file (Projection)
    // Use outputFile to ensure parent directories exist
    await fs.outputFile(path, contents)
    
    // Safety: if watcher doesn't fire for some reason, don't leak memory
    setTimeout(() => ignoreNextChange.delete(path), 1000)
  })

  // ─── Company Brain persistent vector index ────────────────────────────────
  // The Brain (renderer rag-engine.js) keeps its embeddings in a single JSON file
  // under the project's own .notionless/ dir — the same trust boundary as the
  // user's Markdown notes — so a relaunch hydrates from disk instead of
  // re-embedding everything. These two handlers are the ONLY way the renderer
  // touches that file. Both confine the path strictly under the given project
  // root (the file lives at <root>/.notionless/brain-index.json and may never
  // escape it), mirroring the safety posture of the fs:* handlers.
  const resolveBrainIndexPath = (root) => {
    if (!root || typeof root !== 'string') return null
    const normalizedRoot = path.resolve(root)
    // Fixed, non-user-controlled filename inside the project's local-state dir.
    const indexPath = path.resolve(join(normalizedRoot, '.notionless', 'brain-index.json'))
    // Confinement: the resolved file must sit inside <root>/.notionless and not
    // traverse out of it (defense-in-depth even though the name is fixed).
    const confinedDir = path.resolve(join(normalizedRoot, '.notionless'))
    if (indexPath !== join(confinedDir, 'brain-index.json')) return null
    if (!indexPath.startsWith(confinedDir + path.sep)) return null
    return indexPath
  }

  // brain:index-load(root) → { ok:true, record } when present, else { ok:false }.
  // Never throws across IPC: a missing/corrupt file degrades to { ok:false } so the
  // renderer falls back to a clean rebuild.
  ipcMain.handle('brain:index-load', async (_, root) => {
    try {
      const indexPath = resolveBrainIndexPath(root)
      if (!indexPath) return { ok: false, error: 'invalid project root' }
      if (!(await fs.pathExists(indexPath))) return { ok: false }
      const record = await fs.readJson(indexPath)
      return { ok: true, record }
    } catch (e) {
      console.warn('[Main] brain:index-load failed:', e && e.message)
      return { ok: false, error: e && e.message }
    }
  })

  // brain:index-save(root, record) → { ok:true } | { ok:false, error }.
  // Writes the versioned index record, creating .notionless/ if needed.
  ipcMain.handle('brain:index-save', async (_, root, record) => {
    try {
      const indexPath = resolveBrainIndexPath(root)
      if (!indexPath) return { ok: false, error: 'invalid project root' }
      if (!record || typeof record !== 'object') return { ok: false, error: 'invalid record' }
      await fs.ensureDir(path.dirname(indexPath))
      await fs.writeJson(indexPath, record)
      return { ok: true }
    } catch (e) {
      console.warn('[Main] brain:index-save failed:', e && e.message)
      return { ok: false, error: e && e.message }
    }
  })

  ipcMain.handle('fs:getHistory', async (_, docId) => {
    try {
      let manifestManager = null;
      for (const m of manifests.values()) {
          if (m.getPathByDocId(docId)) {
              manifestManager = m;
              break;
          }
      }
      
      if (!manifestManager || !docId) {
          return []
      }
      
      const historyDir = join(manifestManager.projectPath, '.notionless', 'history', docId)
      
      if (!await fs.pathExists(historyDir)) {
          return []
      }
      
      const files = await fs.readdir(historyDir)
      const metadataFiles = files.filter(f => f.endsWith('.json'))
      
      const snapshots = []
      for (const file of metadataFiles) {
        try {
          const meta = await fs.readJson(join(historyDir, file))
          snapshots.push(meta)
        } catch (e) {
           // ignore bad files
        }
      }
      
      return snapshots.sort((a, b) => b.timestamp - a.timestamp)
    } catch (e) {
      console.error('Get history failed:', e)
      return []
    }
  })

  ipcMain.handle('fs:deleteSnapshot', async (_, { docId, snapshotId }) => {
      try {
          let manifestManager = null;
          for (const m of manifests.values()) {
              if (m.getPathByDocId(docId)) {
                  manifestManager = m;
                  break;
              }
          }
          if (!manifestManager) return false

          const historyDir = join(manifestManager.projectPath, '.notionless', 'history', docId)
          await fs.remove(join(historyDir, `${snapshotId}.json`))
          await fs.remove(join(historyDir, `${snapshotId}.bin`))
          return true
      } catch (e) {
          console.error('Delete snapshot failed:', e)
          return false
      }
  })

  ipcMain.handle('fs:createFile', (_, path) => fs.createFile(path))
  ipcMain.handle('fs:ensureDir', (_, dirPath) => fs.ensureDir(dirPath))
  ipcMain.handle('fs:pathExists', (_, path) => fs.pathExists(path))
  ipcMain.handle('fs:stat', async (_, path) => {
      try {
          const stats = await fs.stat(path)
          // Serialize essential methods as properties
          return {
              ...stats,
              isFile: stats.isFile(),
              isDirectory: stats.isDirectory()
          }
      } catch {
          return null
      }
  })

  ipcMain.handle('path:basename', (_, path, ext) => basename(path, ext))
  
  ipcMain.handle('fs:registerCloudFile', async (_, { path: filePath, docId }) => {
    // DO NOT use dirname(path) to create a new manifest in the subdirectory.
    // Instead, find the existing root manifest that covers this file.
    
    let rootManifest = await getManifestForPath(filePath)
    
    // If no existing manifest covers it, we might be outside the project root, which is bad for shared docs.
    // But getManifestForPath relies on `manifests` map which is populated by `ensureManifest`.
    // If we haven't loaded the project yet, it might be missing.
    // However, the renderer calls this *after* project load.
    
    if (!rootManifest) {
        // Fallback: Check parent directories until we find a .notionless folder or hit root
        let currentDir = path.dirname(filePath)
        while (currentDir !== path.dirname(currentDir)) {
            if (manifests.has(currentDir)) {
                rootManifest = manifests.get(currentDir)
                break
            }
            // Check disk for .notionless if not in memory?
            if (fs.existsSync(join(currentDir, '.notionless', 'manifest.json'))) {
                 rootManifest = await ensureManifest(currentDir)
                 break
            }
            currentDir = path.dirname(currentDir)
        }
    }
    
    if (rootManifest) {
        // Use path.relative from 'path' module, NOT path2.relative
        const relative = path.relative(rootManifest.projectPath, filePath)
        return await rootManifest.registerCloudFile(relative, docId)
    } else {
        console.error('[Main] No project manifest found for shared file:', filePath)
        // Should we create one? Probably not in a subdir like 'Shared/User/.notionless'
        return null
    }
  })
  ipcMain.handle('fs:isCloudDoc', async (_, docId) => {
    for (const manager of manifests.values()) {
        const doc = manager.data.documents[docId]
        if (doc && doc.tags && doc.tags.includes('cloud')) return true
    }
    return false
  })

  ipcMain.handle('fs:tagCloudDoc', async (_, docId) => {
    for (const manager of manifests.values()) {
        if (manager.data.documents[docId]) {
            await manager.addTag(docId, 'cloud')
            return true
        }
    }
    return false
  })

  ipcMain.handle('path:extname', (_, path) => extname(path))
  ipcMain.handle('path:dirname', (_, p) => path.dirname(p))
  
  ipcMain.handle('fs:updateLinks', async (_, oldPath, newPath) => {
      try {
          // Find project root to limit scope
          // Simplistic: Use parent dir of oldPath
          const dir = path.dirname(oldPath)
          // Ideally use manifestManager.projectPath
          let rootDir = dir
          let manifestManager = await getManifestForPath(oldPath);
          if (manifestManager) rootDir = manifestManager.projectPath
          
          // Recursive file walker
          async function getFiles(dir) {
            const dirents = await fs.readdir(dir, { withFileTypes: true });
            const files = await Promise.all(dirents.map((dirent) => {
              const res = join(dir, dirent.name);
              return dirent.isDirectory() ? getFiles(res) : res;
            }));
            return Array.prototype.concat(...files);
          }
          
          const files = await getFiles(rootDir)
          const mdFiles = files.filter(f => f.endsWith('.md') && f !== newPath)
          
          const oldPathEncoded = oldPath.replace(/ /g, '%20')
          const newPathEncoded = newPath.replace(/ /g, '%20')
          const newTitle = basename(newPath, '.md').replace(/_/g, ' ')
          
          const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const regexEncoded = new RegExp(`\\[(.*?)\\]\\(${escapeRegExp(oldPathEncoded)}\\)`, 'g')
          const regexRaw = new RegExp(`\\[(.*?)\\]\\(${escapeRegExp(oldPath)}\\)`, 'g')
          
          let updatedCount = 0
          
          for (const file of mdFiles) {
              try {
                  let content = await fs.readFile(file, 'utf8')
                  let changed = false
                  
                  if (regexEncoded.test(content)) {
                      content = content.replace(regexEncoded, `[${newTitle}](${newPathEncoded})`)
                      changed = true
                  }
                  
                  // Reset regex or recreate? replace does it global.
                  // But testing before replace might consume? No, .test() advances lastIndex if global.
                  // Safer to just replace.
                  
                  if (regexRaw.test(content)) {
                      content = content.replace(regexRaw, `[${newTitle}](${newPathEncoded})`)
                      changed = true
                  }
                  
                  if (changed) {
                      await fs.writeFile(file, content, 'utf8')
                      updatedCount++
                  }
              } catch (err) {
                  console.error('Link update error for file:', file, err)
              }
          }
          
          console.log(`[Main] Updated links in ${updatedCount} files`)
          return updatedCount
      } catch (e) {
          console.error('Update links failed:', e)
          return 0
      }
  })

  ipcMain.handle('fs:rename', async (_, oldPath, newPath) => {
    try {
      await fs.rename(oldPath, newPath)
      
      // Update Manifest
      let manifestManager = await getManifestForPath(oldPath);
      if (manifestManager) {
        const oldRel = oldPath.replace(manifestManager.projectPath + '/', '')
        // Note: renaming across roots is tricky. Assuming same root for now.
        if (newPath.startsWith(manifestManager.projectPath)) {
            const newRel = newPath.replace(manifestManager.projectPath + '/', '')
            const docId = manifestManager.getDocIdByPath(oldRel)
            if (docId) {
              await manifestManager.updatePath(docId, newRel)
            } else {
                await manifestManager.registerFile(newRel)
            }
        }
      }
      return true
    } catch (e) {
      console.error('Rename failed:', e)
      throw e
    }
  })
  
  ipcMain.handle('fs:reveal', (_, path) => {
      shell.showItemInFolder(path)
  })

  ipcMain.handle('fs:delete', async (_, path) => {
      try {
          await shell.trashItem(path)
          return true
      } catch (e) {
          console.error('Delete failed:', e)
          // Fallback to force delete if trash fails
          try {
              if (await fs.pathExists(path)) {
                  await fs.remove(path)
              }
              return true
          } catch (e2) {
              console.error('Force delete failed:', e2)
              throw e2
          }
      }
  })
  
  ipcMain.handle('fs:addTag', async (_, args) => {
      const { path, tag } = args || {}
      if (!path) return false
      
      const manifestManager = await getManifestForPath(path)
      if (manifestManager) {
          const rel = path.replace(manifestManager.projectPath + '/', '')
          // Normalize separators just in case (though Mac usually uses /)
          // Also try strict relative path if string replacement failed or left absolute
          
          let docId = manifestManager.getDocIdByPath(rel)
          
          // Fallback: Check if path is absolute but manifest stores relative, try to compute relative manually
          if (!docId && path.startsWith(manifestManager.projectPath)) {
             const manualRel = path.substring(manifestManager.projectPath.length + 1)
             docId = manifestManager.getDocIdByPath(manualRel)
          }
          
          console.log('[Main] Adding tag:', tag, 'to', rel, 'docId:', docId)

          if (docId) {
              await manifestManager.addTag(docId, tag)
              return true
          } else {
              // Auto-register if missing?
              console.log('[Main] Doc ID not found for tag, registering file first...')
              docId = await manifestManager.registerFile(rel)
              await manifestManager.addTag(docId, tag)
              return true
          }
      }
      return false
  })

  ipcMain.handle('dialog:showOpenDialog', (_, options) => dialog.showOpenDialog(mainWindow, options))
  ipcMain.handle('dialog:showSaveDialog', (_, options) => dialog.showSaveDialog(mainWindow, options))
  ipcMain.handle('dialog:showMessageBox', (_, options) => dialog.showMessageBox(mainWindow, options))

  ipcMain.handle('win:getPath', () => mainWindow.path)
  ipcMain.handle('win:isFullScreen', () => mainWindow.isFullScreen())

  ipcMain.handle('fs:getDirectoryTree', async (_, dirPath) => {
    let tagsMap = new Map();
    // Use getManifestForPath to find the manifest covering this directory
    const manifestManager = await getManifestForPath(dirPath);
    
    if (manifestManager && manifestManager.data && manifestManager.data.documents) {
        for (const doc of Object.values(manifestManager.data.documents)) {
            if (doc.path && doc.tags && doc.tags.length > 0) {
                // Ensure we resolve absolute path correctly
                const absPath = join(manifestManager.projectPath, doc.path);
                tagsMap.set(absPath, doc.tags);
            }
        }
    }
    
    return await getDirectoryTree(dirPath, { extensions: /\.(note|md)$/, tagsMap })
  })

  ipcMain.handle('fs:listMarkdownFilesRecursive', async (_, rootDir) => {
    try {
      if (!rootDir) return []
      const queue = [rootDir]
      const visited = new Set()
      const files = []
      const MAX_DIRS = 50000
      const MAX_FILES = 200000

      while (queue.length > 0 && visited.size < MAX_DIRS && files.length < MAX_FILES) {
        const dirPath = queue.shift()
        if (!dirPath || visited.has(dirPath)) continue
        visited.add(dirPath)

        let dir
        try {
          dir = await fs.opendir(dirPath)
        } catch (_e) {
          continue
        }

        for await (const dirent of dir) {
          const name = dirent.name || ''
          if (!name || name.startsWith('.')) continue
          const childPath = join(dirPath, name)
          if (dirent.isDirectory()) {
            queue.push(childPath)
            continue
          }
          const ext = extname(name).toLowerCase()
          if (ext === '.md' || ext === '.note') files.push(childPath)
          if (files.length >= MAX_FILES) break
        }
      }

      return files
    } catch (e) {
      console.error('[Main] fs:listMarkdownFilesRecursive failed:', e)
      return []
    }
  })

  // Find pages that link to a given page — by `(doc:docId)` markdown links or
  // `[[Wiki Title]]` references. Scans every .md under rootDir node-side and
  // returns one entry per linking file with a short snippet around the match.
  ipcMain.handle('fs:findBacklinks', async (_, rootDir, opts = {}) => {
    try {
      if (!rootDir) return []
      const { docId, titles = [], excludePath } = opts
      const titleList = (Array.isArray(titles) ? titles : [titles])
        .filter(Boolean)
        .map(t => String(t).trim().toLowerCase())
      if (!docId && titleList.length === 0) return []

      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const patterns = []
      if (docId) patterns.push(new RegExp('\\(doc:' + esc(docId) + '\\)'))
      // [[Title]] / [[Title|alias]] / [[Title#section]] — case-insensitive
      for (const t of titleList) {
        patterns.push(new RegExp('\\[\\[\\s*' + esc(t) + '\\s*(\\||#|\\]\\])', 'i'))
      }

      // Reuse the recursive lister inline.
      const queue = [rootDir]
      const visited = new Set()
      const mdFiles = []
      const MAX_DIRS = 50000
      const MAX_FILES = 50000
      while (queue.length > 0 && visited.size < MAX_DIRS && mdFiles.length < MAX_FILES) {
        const dirPath = queue.shift()
        if (!dirPath || visited.has(dirPath)) continue
        visited.add(dirPath)
        let dir
        try { dir = await fs.opendir(dirPath) } catch (_e) { continue }
        for await (const dirent of dir) {
          const name = dirent.name || ''
          if (!name || name.startsWith('.')) continue
          const childPath = join(dirPath, name)
          if (dirent.isDirectory()) { queue.push(childPath); continue }
          const ext = extname(name).toLowerCase()
          if (ext === '.md' || ext === '.note') mdFiles.push(childPath)
        }
      }

      const results = []
      for (const filePath of mdFiles) {
        if (excludePath && filePath === excludePath) continue
        let content
        try { content = await fs.readFile(filePath, 'utf8') } catch (_e) { continue }
        const hit = patterns.find(re => re.test(content))
        if (!hit) continue
        // Build a snippet from the first matching line.
        const lines = content.split('\n')
        let snippet = ''
        let lineNo = 0
        for (let i = 0; i < lines.length; i++) {
          if (patterns.some(re => re.test(lines[i]))) {
            snippet = lines[i].trim().slice(0, 160)
            lineNo = i + 1
            break
          }
        }
        results.push({ path: filePath, name: basename(filePath), snippet, line: lineNo })
        if (results.length >= 500) break
      }
      return results
    } catch (e) {
      console.error('[Main] fs:findBacklinks failed:', e)
      return []
    }
  })

  // Sandboxed plugin system: register the plugin:* IPC channels and start the
  // hot-reload watcher. Defensive — registerPluginIpc never throws across the
  // boundary and is idempotent, so a duplicate call (e.g. on reload) is a no-op.
  try {
    registerPluginIpc(app, { getWorkspaceRoot: () => settings.getSync('lastProject') || null })
  } catch (e) {
    console.warn('[Main] Plugin IPC registration failed (plugins disabled):', e)
  }

  // Plugin Studio (author-time, consent-gated, OFF by default). Gated by the same
  // VITE_FEATURE_PLUGINS_STUDIO flag as the renderer's Features.pluginStudio.
  // registerStudioIpc is idempotent and never throws across IPC, so a duplicate or
  // flag-off call is a safe no-op. The studio root is derived from userData, never
  // the vault — getWorkspaceRoot is passed for signature parity but unused inside.
  try {
    const studioEnabled = (() => {
      const v = process.env.VITE_FEATURE_PLUGINS_STUDIO
      return v === 'true' || v === '1'
    })()
    if (studioEnabled) {
      registerStudioIpc(app, {
        getWorkspaceRoot: () => settings.getSync('lastProject') || null,
        getMainWindow: () => mainWindow,
      })
    }
  } catch (e) {
    console.warn('[Main] Studio IPC registration failed (studio disabled):', e)
  }

  console.log('[Main] IPC Handlers Registered')
}

const constants = {
  DIRECTORY: 'directory',
  FILE: 'file',
};

async function getDirectoryTree(path, options) {
  const name = basename(path);
  const item = { path, name };
  let stats;

  try { stats = await fs.stat(path); } catch (e) { return null; }

  if (stats.isFile()) {
    const ext = extname(path).toLowerCase();
    if (options && options.extensions && !options.extensions.test(ext)) { return null; }
    item.extension = ext;
    item.type = constants.FILE;
    
    if (options && options.tagsMap && options.tagsMap.has(path)) {
        item.tags = options.tagsMap.get(path);
    }
  } else if (stats.isDirectory()) {
    // Skip hidden folders
    if (name.startsWith('.')) return null;
    
    item.type = constants.DIRECTORY;
    item.children = [];
    item.hasChildren = true; // Assume yes for UI

    // Safe scan using opendir (Iterator) to prevent OOM on huge folders
    try {
        const dir = await fs.opendir(path);
        let count = 0;
        const MAX_ITEMS = 500;
        
        for await (const dirent of dir) {
            if (count >= MAX_ITEMS) break;
            
            // Skip hidden
            if (dirent.name.startsWith('.')) continue;
            
            const childPath = join(path, dirent.name);
            
            if (dirent.isDirectory()) {
                item.children.push({
                    path: childPath,
                    name: dirent.name,
                    type: constants.DIRECTORY,
                    children: [],
                    hasChildren: true
                });
            } else {
                const ext = extname(dirent.name).toLowerCase();
                if (!options || !options.extensions || options.extensions.test(ext)) {
                    item.children.push({
                        path: childPath,
                        name: dirent.name,
                        type: constants.FILE,
                        extension: ext
                    });
                }
            }
            count++;
        }
    } catch (ex) {
        console.error('Failed to scan directory:', path, ex);
        // Return empty children but valid item
    }
    
    // Sort logic (Folders first)
    item.children.sort((a, b) => {
        if (a.type === b.type) { if (a.path < b.path) { return -1; } return 1; }
        if (a.type === constants.DIRECTORY) { return -1; } return 1;
      });

  } else {
    return null;
  }
  return item;
}

// Disable HW Acceleration to prevent potential GPU-related OOM/Crashes
// Must be called before app is ready
app.disableHardwareAcceleration()

// Emergency Settings Cleanup (Run before app ready to prevent OOM on bad settings)
try {
    const userData = app.getPath('userData');
    const settingsPath = join(userData, 'Settings'); // electron-settings default file
    if (fs.existsSync(settingsPath)) {
        const stats = fs.statSync(settingsPath);
        if (stats.size > 1024 * 1024) { // > 1MB
            console.warn('[Main] Settings file too large, resetting:', stats.size);
            fs.unlinkSync(settingsPath);
        }
    }
} catch (e) {
    console.error('[Main] Failed to check settings size:', e);
}

// Auto Updater Logic
function setupAutoUpdater() {
  autoUpdater.logger = console
  autoUpdater.autoDownload = true

  autoUpdater.on('error', (message) => {
    console.error('There was a problem updating the application')
    console.error(message)
  })

  autoUpdater.on('update-available', () => {
    console.log('Update available')
  })

  autoUpdater.on('update-downloaded', () => {
    console.log('Update downloaded')
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'A new version of Notionless is ready. Quit and install now?',
      buttons: ['Yes', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })
}

// Single-instance lock — required on Windows/Linux so the OAuth deep link
// (notionless://auth?token=...) is delivered to the already-running instance
// via 'second-instance' instead of spawning a new process. Harmless on macOS,
// which uses the 'open-url' event instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // Windows/Linux: the protocol URL arrives as a CLI argument.
    const url = argv.find((a) => typeof a === 'string' && a.startsWith('notionless://'))
    if (url) routeDeepLink(url)
    const win = mainWindowRef && !mainWindowRef.isDestroyed()
      ? mainWindowRef
      : BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

app.whenReady().then(() => {
  setupAutoUpdater()

  // Check for updates immediately
  if (app.isPackaged) {
    autoUpdater.checkForUpdates()
  }

  // SAFETY RESET: Clear knownProjects to prevent crash loops from bad state
  // Only needed once, but safe to keep for stability during dev
  try {
      const known = settings.getSync('knownProjects') || []
      const unsafe = known.filter(p => p.includes('Downloads') || p === '/' || p === app.getPath('home'))
      if (unsafe.length > 0) {
          console.log('[Main] Cleaning unsafe projects from settings:', unsafe)
          settings.setSync('knownProjects', known.filter(p => !unsafe.includes(p)))
      }
  } catch (e) {
      console.error('Failed to clean settings:', e)
  }

  // Protocol Handler
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('notionless', process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('notionless')
  }

  // Start Local Signaling Server (Port 4444)
  startSignalingServer()

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()
  registerIPCHandlers(mainWindow)

  // If a notionless:// link launched us (open-url before the window existed),
  // deliver it now that the renderer is loading.
  flushPendingDeepLink(mainWindow)

  // Windows/Linux cold start: the app may have been launched directly by the OS
  // to handle a notionless:// link, which arrives as a process argument.
  if (process.platform !== 'darwin') {
    const deepLink = process.argv.find((a) => typeof a === 'string' && a.startsWith('notionless://'))
    if (deepLink) {
      // Defer until the renderer can receive the IPC message.
      mainWindow.webContents.once('did-finish-load', () => routeDeepLink(deepLink))
    }
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Initialize Manifest if lastProject exists (Backwards compatibility)
app.whenReady().then(async () => {
  const lastProject = settings.getSync('lastProject')
  if (lastProject && fs.existsSync(lastProject)) {
    await ensureManifest(lastProject)
  }
  
  // Also load known roots?
  const known = settings.getSync('knownProjects') || []
  for (const root of known) {
      if (fs.existsSync(root)) {
          await ensureManifest(root)
      }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('open-url', (event, url) => {
    event.preventDefault()
    // macOS delivers notionless:// links here (auth + invite/share). routeDeepLink
    // dispatches auth to sign-in and forwards invite/share links to the renderer.
    routeDeepLink(url)
})

// Handle Signaling Server Port Conflicts Gracefully
process.on('uncaughtException', (err) => {
    if (err.code === 'EADDRINUSE' && String(err.port) === '4444') {
        console.log('[Main] Signaling server port 4444 busy, skipping.')
        return // Ignore
    }
    console.error('[Main] Uncaught Exception:', err)
    // Optional: app.quit() or dialog?
    // Let electron default handler take over if not EADDRINUSE?
    // If we attach this listener, we prevent default behavior (crash dialog).
})

function startSignalingServer() {
    const port = 4444
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('Notionless Signaling Server')
    })
    
    const wss = new WebSocketServer({ server })
    const topics = new Map()
    
    wss.on('connection', (conn) => {
        conn.on('message', (message) => {
            try {
                const msg = JSON.parse(message)
                if (msg && msg.type === 'publish') {
                    const receivers = topics.get(msg.topic)
                    if (receivers) {
                        receivers.forEach(receiver => {
                            if (receiver !== conn) receiver.send(message)
                        })
                    }
                } else if (msg && msg.type === 'subscribe') {
                    (msg.topics || []).forEach(topicName => {
                        let receivers = topics.get(topicName)
                        if (!receivers) {
                            receivers = new Set()
                            topics.set(topicName, receivers)
                        }
                        receivers.add(conn)
                    })
                } else if (msg && msg.type === 'unsubscribe') {
                    (msg.topics || []).forEach(topicName => {
                        const receivers = topics.get(topicName)
                        if (receivers) receivers.delete(conn)
                    })
                } else if (msg && msg.type === 'ping') {
                    conn.send(JSON.stringify({ type: 'pong' }))
                }
            } catch (e) {
                // Ignore invalid json
            }
        })
        
        conn.on('close', () => {
            topics.forEach(receivers => receivers.delete(conn))
        })
    })
    
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log('[Main] Signaling server port 4444 busy, assuming another instance is running.')
        } else {
            console.error('[Main] Signaling server error:', e)
        }
    })
    
    try {
        server.listen(port, '0.0.0.0', () => {
            console.log(`[Main] Local Signaling Server running on port ${port}`)
        })
    } catch (e) {
        console.log('[Main] Failed to start signaling server:', e.message)
    }
}
