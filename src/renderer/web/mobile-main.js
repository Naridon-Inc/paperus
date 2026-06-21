/**
 * mobile-main.js — the Notionless mobile COMPANION entry (installable PWA).
 *
 * Per docs/MOBILE_COMPANION.md, the companion is the SAME vanilla renderer
 * (`src/renderer/src/`) booted with a mocked `window.api` over IndexedDB/
 * localStorage — like the dev-only web build — but with two differences:
 *
 *   1. A HARD pairing gate. On launch we check for stored pairing creds; if they
 *      are absent / malformed / expired we render the Link screen and STOP. We
 *      never open the team, the swarm, or a note while unlinked (§2.5).
 *   2. Leaf discipline. The companion is a leaf, not a replica (§1): it syncs
 *      foreground-only (we tear the WebRTC mesh down on backgrounding and
 *      re-open it on foreground, §3.3) and keeps offline IndexedDB on
 *      (`is-mobile`, never `is-web` — §4.5).
 *
 * The `window.api` mock below is the SAME mock as web-main.js (localStorage
 * settings + IndexedDB snapshots + git shim + desktop-API stubs). It is copied
 * verbatim — and MUST run synchronously at page load — because early module
 * guards read `window.api` (R: install-before-import). Desktop-only IPC
 * (`win:*`, `auth:*` Touch ID, native dialogs) is stubbed here, never invoked.
 */

import { fileSystem } from '../src/filesystem-proxy'
import { showLinkScreen } from './mobile-link-screen'

// ════════════════════════════════════════════════════════════════════════════
//  window.api mock — copied verbatim from web-main.js (do not fork behavior).
//  IndexedDB helper for binary snapshot storage.
// ════════════════════════════════════════════════════════════════════════════

const snapshotDB = {
    _db: null,
    async open() {
        if (this._db) return this._db
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('notionless-snapshots', 1)
            req.onupgradeneeded = () => {
                const db = req.result
                if (!db.objectStoreNames.contains('snapshots')) {
                    db.createObjectStore('snapshots', { keyPath: ['docId', 'snapshotId'] })
                }
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: ['docId', 'snapshotId'] })
                }
            }
            req.onsuccess = () => { this._db = req.result; resolve(this._db) }
            req.onerror = () => reject(req.error)
        })
    },
    async saveSnapshot(docId, metadata, data) {
        const db = await this.open()
        const tx = db.transaction(['snapshots', 'metadata'], 'readwrite')
        tx.objectStore('snapshots').put({ docId, snapshotId: metadata.id, data })
        tx.objectStore('metadata').put({ docId, snapshotId: metadata.id, ...metadata })
        return new Promise((resolve, reject) => {
            tx.oncomplete = resolve
            tx.onerror = () => reject(tx.error)
        })
    },
    async loadSnapshot(docId, snapshotId) {
        const db = await this.open()
        const tx = db.transaction('snapshots', 'readonly')
        const req = tx.objectStore('snapshots').get([docId, snapshotId])
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result?.data || null)
            req.onerror = () => reject(req.error)
        })
    },
    async getHistory(docId) {
        const db = await this.open()
        const tx = db.transaction('metadata', 'readonly')
        const store = tx.objectStore('metadata')
        const results = []
        return new Promise((resolve, reject) => {
            const cursor = store.openCursor()
            cursor.onsuccess = () => {
                const c = cursor.result
                if (c) {
                    if (c.value.docId === docId) results.push(c.value)
                    c.continue()
                } else {
                    resolve(results)
                }
            }
            cursor.onerror = () => reject(cursor.error)
        })
    },
    async deleteSnapshot(docId, snapshotId) {
        const db = await this.open()
        const tx = db.transaction(['snapshots', 'metadata'], 'readwrite')
        tx.objectStore('snapshots').delete([docId, snapshotId])
        tx.objectStore('metadata').delete([docId, snapshotId])
    }
}

// Simple UUID v4 generator for web
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// Cloud doc registry (maps docId -> metadata, stored in localStorage)
const cloudDocRegistry = {
    _key: 'notionless_cloud_docs',
    _load() {
        try { return JSON.parse(localStorage.getItem(this._key) || '{}') } catch { return {} }
    },
    _save(data) {
        localStorage.setItem(this._key, JSON.stringify(data))
    },
    register(docId, path) {
        const data = this._load()
        data[docId] = { path, tags: ['cloud'], registeredAt: Date.now() }
        this._save(data)
    },
    getDocId(path) {
        if (path.startsWith('cloud:')) return path.replace('cloud:', '')
        const data = this._load()
        for (const [id, entry] of Object.entries(data)) {
            if (entry.path === path) return id
        }
        return null
    },
    getPath(docId) {
        const data = this._load()
        return data[docId]?.path || ('cloud:' + docId)
    },
    isCloudDoc(docId) {
        const data = this._load()
        return !!(data[docId]?.tags?.includes('cloud'))
    },
    tagCloud(docId) {
        const data = this._load()
        if (data[docId]) {
            data[docId].tags = data[docId].tags || []
            if (!data[docId].tags.includes('cloud')) data[docId].tags.push('cloud')
            this._save(data)
        }
    }
}

// Comprehensive Mock for Web/Mobile Parity
window.api = {
    getSettings: async (key) => {
        const val = localStorage.getItem('setting_' + key);
        if (val === null) return null;
        try { return JSON.parse(val); } catch { return val; }
    },
    setSettings: async (key, value) => {
        localStorage.setItem('setting_' + key, JSON.stringify(value));
    },
    getAppVersion: async () => {
        return localStorage.getItem('setting_appVersion') || '1.0.6';
    },
    pathExists: async (p) => {
        if (!p) return false;
        if (p.startsWith('cloud:') && !p.includes('/')) return true;
        if (p.startsWith('folder:') && !p.includes('/')) return true;

        if (p.startsWith('root/') || (p.includes('/') && p.endsWith('.md'))) {
            const knownFiles = JSON.parse(localStorage.getItem('setting_knownFiles') || '[]');
            if (knownFiles.includes(p)) return true;
        }

        return false;
    },
    basename: async (p) => {
        if (!p) return '';
        const parts = p.split('/');
        return parts[parts.length - 1];
    },
    dirname: async (p) => {
        if (!p) return 'root';
        const parts = p.split('/');
        if (parts.length <= 1) return 'root';
        return parts.slice(0, -1).join('/');
    },
    extname: async (p) => {
        if (!p) return '';
        const idx = p.lastIndexOf('.');
        return idx > -1 ? p.substring(idx) : '';
    },
    readFile: async (p) => {
        return localStorage.getItem('vfs_' + p) || '';
    },
    writeFile: async (p, content) => {
        localStorage.setItem('vfs_' + p, content);
        const knownFiles = JSON.parse(localStorage.getItem('setting_knownFiles') || '[]');
        if (!knownFiles.includes(p)) {
            knownFiles.push(p);
            localStorage.setItem('setting_knownFiles', JSON.stringify(knownFiles));
        }
    },
    ensureDir: async () => true,
    invoke: async (channel, ...args) => {
        // Document identity
        if (channel === 'fs:getDocId') {
            const path = args[0]
            // Check registry first
            const existing = cloudDocRegistry.getDocId(path)
            if (existing) return existing
            // For cloud: paths, extract the ID
            if (path && path.startsWith('cloud:')) return path.replace('cloud:', '').split(':')[0]
            // For local-style paths (e.g. root/Untitled_7.md), generate a UUID and register it
            if (path) {
                const newId = generateUUID()
                cloudDocRegistry.register(newId, path)
                return newId
            }
            return null
        }
        if (channel === 'fs:getPathByDocId') {
            return cloudDocRegistry.getPath(args[0])
        }
        if (channel === 'fs:isCloudDoc') {
            return cloudDocRegistry.isCloudDoc(args[0])
        }
        if (channel === 'fs:tagCloudDoc') {
            cloudDocRegistry.tagCloud(args[0])
            return true
        }
        if (channel === 'fs:registerCloudFile') {
            const { path, docId } = args[0]
            cloudDocRegistry.register(docId, path)
            return docId
        }

        // Path utilities
        if (channel === 'path:dirname') return args[0].split('/').slice(0, -1).join('/');
        if (channel === 'path:extname') {
            const p = args[0] || '';
            const idx = p.lastIndexOf('.');
            return idx > -1 ? p.substring(idx) : '';
        }

        // File operations
        if (channel === 'fs:rename') {
            const oldPath = args[0];
            const newPath = args[1];
            const content = localStorage.getItem('vfs_' + oldPath);
            if (content !== null) {
                localStorage.setItem('vfs_' + newPath, content);
                localStorage.removeItem('vfs_' + oldPath);
            }
            const knownFiles = JSON.parse(localStorage.getItem('setting_knownFiles') || '[]');
            const idx = knownFiles.indexOf(oldPath);
            if (idx > -1) {
                knownFiles[idx] = newPath;
                localStorage.setItem('setting_knownFiles', JSON.stringify(knownFiles));
            }
            return true;
        }
        if (channel === 'fs:delete') {
            const path = args[0];
            localStorage.removeItem('vfs_' + path);
            const knownFiles = JSON.parse(localStorage.getItem('setting_knownFiles') || '[]');
            const idx = knownFiles.indexOf(path);
            if (idx > -1) {
                knownFiles.splice(idx, 1);
                localStorage.setItem('setting_knownFiles', JSON.stringify(knownFiles));
            }
            return true;
        }
        if (channel === 'fs:writeFile') {
            const path = args[0];
            const content = args[1];
            localStorage.setItem('vfs_' + path, content);
            return true;
        }
        if (channel === 'fs:stat') {
            return null; // No physical filesystem on web/mobile
        }
        if (channel === 'fs:updateLinks') return true;

        // Snapshots — stored in IndexedDB for binary data
        if (channel === 'fs:saveSnapshot') {
            const { docId, metadata, data } = args[0]
            await snapshotDB.saveSnapshot(docId, metadata, data)
            return true
        }
        if (channel === 'fs:loadSnapshot') {
            const { docId, snapshotId } = args[0]
            return await snapshotDB.loadSnapshot(docId, snapshotId)
        }
        if (channel === 'fs:getHistory') {
            return await snapshotDB.getHistory(args[0])
        }
        if (channel === 'fs:deleteSnapshot') {
            const { docId, snapshotId } = args[0]
            await snapshotDB.deleteSnapshot(docId, snapshotId)
            return true
        }

        // Window — desktop-only; stubbed on mobile.
        if (channel === 'win:isFullScreen') return false;

        // Auth/Biometrics — not available on mobile PWA (Touch ID is Electron-only).
        if (channel === 'auth:can-prompt-touch-id') return false;
        if (channel === 'auth:prompt-touch-id') return false;
        if (channel === 'auth:secure-save') {
            // On web/mobile, use sessionStorage for sensitive data (cleared on tab close)
            const [key, value] = [args[0], args[1]]
            sessionStorage.setItem('secure_' + key, typeof value === 'string' ? value : JSON.stringify(value))
            return true
        }
        if (channel === 'auth:secure-load') {
            const val = sessionStorage.getItem('secure_' + args[0])
            if (val === null) return null
            try { return JSON.parse(val) } catch { return val }
        }

        return null;
    },
    showOpenDialog: async (options) => {
        // Web/mobile fallback: use native file picker via <input type="file">
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            if (options?.filters) {
                const exts = options.filters.flatMap(f => f.extensions || []);
                if (exts.length) input.accept = exts.map(e => '.' + e).join(',');
            }
            if (options?.properties?.includes('multiSelections')) input.multiple = true;
            input.onchange = () => {
                if (input.files && input.files.length > 0) {
                    const paths = Array.from(input.files).map(f => f.name);
                    resolve({ canceled: false, filePaths: paths, files: Array.from(input.files) });
                } else {
                    resolve({ canceled: true, filePaths: [] });
                }
            };
            input.oncancel = () => resolve({ canceled: true, filePaths: [] });
            input.click();
        });
    },
    onMessage: () => {
        // No-op — no Electron IPC messages on mobile.
    }
};

// Git Sync shim (web/mobile build) — backs window.api.git with an in-browser
// engine (isomorphic-git + lightning-fs) loaded lazily. Identical to web-main.js.
if (typeof window !== 'undefined' && window.api && !window.api.git) {
    let _gitEnginePromise = null;
    const getEngine = () => {
        if (!_gitEnginePromise) _gitEnginePromise = import('../src/git-sync-web');
        return _gitEnginePromise.then((m) => m.gitApiShim || m.default);
    };

    const collectCloudNotes = async () => {
        try {
            const fsp = fileSystem && fileSystem.current;
            if (!fsp || typeof fsp.getDirectoryTree !== 'function') return null;
            const files = [];
            const seen = new Set();
            const walk = async (nodePath) => {
                const tree = await fsp.getDirectoryTree(nodePath).catch(() => null);
                if (!tree || !Array.isArray(tree.children)) return;
                for (const child of tree.children) {
                    if (child.type === 'directory') {
                        if (!seen.has(child.path)) { seen.add(child.path); await walk(child.path); }
                    } else if (child.type === 'file') {
                        if (seen.has(child.path)) continue;
                        seen.add(child.path);
                        const content = await fsp.readFile(child.path).catch(() => '');
                        const rel = String(child.name || child.path).replace(/^(cloud:|folder:)/, '');
                        const safe = /\.md$/i.test(rel) ? rel : rel + '.md';
                        files.push({ path: safe, content: content || '' });
                    }
                }
            };
            await walk('root');
            return files;
        } catch (e) { return null; }
    };

    window.api.git = {
        status: async (dir) => (await getEngine()).status(dir),
        init: async (dir, remoteUrl) => (await getEngine()).init(dir, remoteUrl),
        setRemote: async (dir, url) => (await getEngine()).setRemote(dir, url),
        sync: async (dir, opts = {}) => {
            if (!opts.files) {
                const files = await collectCloudNotes();
                if (files == null) console.warn('[git-mobile] could not collect cloud notes; syncing repo state only');
                else opts = { ...opts, files };
            }
            return (await getEngine()).sync(dir, opts);
        },
        clone: async (dir, url, token) => (await getEngine()).clone(dir, url, token),
    };

    try {
        if (localStorage.getItem('setting_knownProjects') === null) {
            localStorage.setItem('setting_knownProjects', JSON.stringify(['/repo']));
        }
    } catch (e) { /* ignore */ }
}

// ════════════════════════════════════════════════════════════════════════════
//  Companion pairing gate + leaf lifecycle.
// ════════════════════════════════════════════════════════════════════════════

const PAIRING_CREDS_KEY = 'mobile_pairing_creds'

/**
 * Read + validate stored pairing creds (§2.5). Returns the creds object when
 * present and not expired, otherwise null. NEVER throws (a malformed blob is
 * treated as "unlinked", which routes to the Link screen).
 */
function loadStoredCreds() {
    let raw = null
    try { raw = localStorage.getItem(PAIRING_CREDS_KEY) } catch (_e) { return null }
    if (!raw) return null
    try {
        const creds = JSON.parse(raw)
        if (!creds || !creds.teamRootKey) return null
        if (creds.expiresAt && Date.now() > creds.expiresAt) return null
        return creds
    } catch (_e) {
        return null
    }
}

/** Persist verified pairing creds. */
function storeCreds(creds) {
    try { localStorage.setItem(PAIRING_CREDS_KEY, JSON.stringify(creds)) } catch (_e) { /* ignore */ }
}

/**
 * Foreground/background leaf discipline (§3.3). WebRTC teardown on backgrounding
 * is NOT automatic — the companion drives it. On `hidden` we disconnect every
 * open engine's P2P mesh (keeping the local Y.Doc + IndexedDB intact); on
 * `visible` we reconnect them through the SAME path they were opened with.
 *
 * We reach engines via the live `p2pTeamManager` that the shared renderer
 * (`main.js`) installs on `window`. Reconnecting the root is enough to re-enter
 * the team swarm; any open note tabs re-open through their own engines, so we
 * also reconnect every engine we can enumerate.
 */
function wireForegroundLifecycle() {
    const forEachEngine = (fn) => {
        const mgr = typeof window !== 'undefined' ? window.p2pTeamManager : null
        if (!mgr || !mgr._teams) return
        for (const entry of mgr._teams.values()) {
            try {
                if (entry && entry.rootEngine) fn(entry.rootEngine, entry)
                if (entry && entry.replicas) {
                    for (const r of entry.replicas.values()) {
                        if (r && typeof r === 'object' && typeof r.disconnectP2P === 'function') fn(r, entry)
                    }
                }
            } catch (_e) { /* keep iterating */ }
        }
    }

    const goBackground = () => {
        forEachEngine((engine) => {
            try { if (typeof engine.disconnectP2P === 'function') engine.disconnectP2P() } catch (_e) { /* ignore */ }
        })
    }
    const goForeground = () => {
        forEachEngine((engine, entry) => {
            try {
                // Re-open the swarm for this engine. The team's swarm key lives on
                // the entry; reuse it so we rebind to the SAME encrypted transport.
                if (typeof engine.connectP2P !== 'function') return
                if (engine.network) return // already connected
                const swarmKey = entry && entry.keys && entry.keys.swarmKey
                if (swarmKey && engine === entry.rootEngine) engine.connectP2P(swarmKey)
                else if (engine._lastSwarmKey) engine.connectP2P(engine._lastSwarmKey)
            } catch (_e) { /* ignore */ }
        })
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') goBackground()
        else goForeground()
    })
    // iOS Safari / PWA: pagehide/pageshow are the reliable bfcache hooks.
    window.addEventListener('pagehide', goBackground)
    window.addEventListener('pageshow', () => { if (document.visibilityState !== 'hidden') goForeground() })
}

/** Register the minimal offline service worker (production only). */
function registerServiceWorker() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const isProd = !(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV)
    if (!isProd) return
    window.addEventListener('load', () => {
        // The SW lives at public/sw.js and is copied verbatim to the dist root as
        // ./sw.js (see vite.mobile.config.mjs publicDir). Register at scope './'.
        navigator.serviceWorker.register('./sw.js').catch((e) => {
            console.warn('[Mobile] service worker registration failed', e)
        })
    })
}

/**
 * Boot the companion renderer AFTER the gate passes. Persists creds, derives the
 * team keys + joins the team through the existing `openP2PDoc`/p2p-team seam, then
 * hands off to the shared renderer (`main.js`). Identity unlock (claim/login
 * against the signed roster) happens inside the shared renderer's normal flow.
 */
async function bootCompanion(creds) {
    storeCreds(creds)

    // Clear the HTML skeleton, if any.
    const app = document.getElementById('app')
    if (app) app.innerHTML = ''

    // Enforce the leaf invariant (R6): the companion is a LEAF, never a replica.
    // `P2PTeamManager._reconcileReplicas` only early-returns on `is-web`; the
    // mobile surface is `is-mobile`, so without this it would start background
    // ciphertext replication. Until the planned p2p-team.js guard (doc §4.5/§5)
    // extends that check to `is-mobile`, we neutralize replication for the
    // companion here — additively, before the manager boots — by making it a
    // no-op on the prototype. (We don't own p2p-team.js; this is the safe,
    // self-contained guard.)
    try {
        const { P2PTeamManager } = await import('../src/p2p-team')
        if (P2PTeamManager && P2PTeamManager.prototype &&
            !P2PTeamManager.prototype.__mobileLeafGuarded) {
            P2PTeamManager.prototype._reconcileReplicas = async function _reconcileReplicasLeafNoop() { /* leaf: no background replication */ }
            P2PTeamManager.prototype.__mobileLeafGuarded = true
        }
    } catch (e) {
        console.warn('[Mobile] could not install leaf replication guard', e)
    }

    await fileSystem.init()

    // Make the team known to the renderer BEFORE it boots so its team list +
    // sidebar hydrate the paired team. We persist into the same `p2p_teams`
    // setting that P2PTeamManager.init() reads, so joining is idempotent: if the
    // team is already saved we add nothing, otherwise we seed it and let the
    // manager's own _openRoot reconnect it through openP2PDoc.
    try {
        const { deriveTeamId } = await import('../src/team-keys')
        const teamId = creds.teamId || (await deriveTeamId(creds.teamRootKey))
        const raw = localStorage.getItem('setting_p2p_teams')
        let teams = []
        try { teams = raw ? JSON.parse(raw) : [] } catch (_e) { teams = [] }
        if (!Array.isArray(teams)) teams = []
        if (!teams.some((t) => t && (t.teamId === teamId || t.rootKey === creds.teamRootKey))) {
            teams.push({ teamId, rootKey: creds.teamRootKey, name: creds.teamName || 'Team' })
            localStorage.setItem('setting_p2p_teams', JSON.stringify(teams))
        }
    } catch (e) {
        console.warn('[Mobile] could not pre-seed team; renderer will still offer Join', e)
    }

    // Hand off to the shared renderer. P2PTeamManager.init() reconnects the team
    // root via openP2PDoc (E2EE-before-transport, R1); the foreground/background
    // wiring keeps it leaf-only. This also constructs + exposes window.p2pTeamManager
    // (main.js:1599), identity, the roster, IndexedDB, and builds the (now-hidden)
    // desktop DOM that the new shell sits beside.
    await import('../src/main.js')

    // From-scratch mobile VIEW layer (replaces the abandoned ./mobile.css reskin).
    // mobile-shell.css carries the desktop-hide rule
    // (`body.is-mobile .window-layout { display:none !important }`) and is imported
    // AFTER main.js's style.css so equal-specificity rules resolve in the shell's
    // favor (the same load-order trick the old mobile.css relied on). Then mount
    // the new shell as the PRIMARY UI. The shell reads window.p2pTeamManager +
    // identity internally; it never constructs managers or touches openP2PDoc.
    // (The old src/renderer/web/mobile.css is no longer imported by the companion —
    // it is abandoned for the view layer; the file stays on disk and its .ml-*
    // link-gate styles are self-injected by mobile-link-screen.js, so they are
    // unaffected.)
    try { await import('./mobile/mobile-shell.css') } catch (e) { console.warn('[Mobile] mobile-shell.css failed to load', e) }
    try {
        const { mountMobileApp } = await import('./mobile/app-shell')
        mountMobileApp({ teamManager: window.p2pTeamManager })
    } catch (e) {
        console.error('[Mobile] mobile shell mount failed', e)
    }

    wireForegroundLifecycle()
    registerServiceWorker()

    console.log('[Mobile] Paperus companion booted (leaf, foreground-only)')
}

// ── Hard gate ────────────────────────────────────────────────────────────────

async function bootstrap() {
    // Mark the surface as MOBILE (full offline client) — never 'is-web', so
    // engine.js keeps IndexedDB persistence on (§4.5).
    document.body.classList.add('is-mobile')

    const creds = loadStoredCreds()
    if (!creds) {
        // HARD STOP: unlinked. Render the Link screen and DO NOT boot the renderer,
        // open the swarm, or touch any note. The screen calls back with verified
        // creds, which boots the companion.
        const app = document.getElementById('app')
        if (app) app.innerHTML = ''
        const screen = showLinkScreen({
            onLinked: async (verified) => {
                await bootCompanion(verified)
                screen.destroy()
            },
        })
        return
    }

    await bootCompanion(creds)
}

bootstrap()
