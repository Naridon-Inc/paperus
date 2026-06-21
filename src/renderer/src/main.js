import './style.css'
// Dark palette overrides — MUST come after style.css so its
// :root[data-theme="dark"] rules win the cascade. theme.applyStoredTheme()
// (called below, before first paint) sets data-theme on <html>.
import './theme-dark.css'
import './plugins/plugins.css'
import { applyStoredTheme, getThemePreference, setTheme } from './theme'
import Store from './store'
import { Features } from './features'
import { initPluginSystem } from './plugins/plugin-host'
import { openPluginSettings } from './plugins/plugin-settings'
import { HistoryManager } from './history'
import { PropertiesManager } from './properties'
import { ContextMenu } from './context-menu'
import { Indexer } from './indexer'
import { CommandPalette } from './command-palette'
import { DocumentEngine, openP2PDoc } from './engine'
import { ProjectionManager } from './projection'
import { SharePopover } from './share'
import { NotificationCenter } from './notifications'
import { MoreMenu } from './more-menu'
import { NewTabModal } from './new-tab-modal'
import { SidebarManager } from './sidebar-manager'
import { TabManager } from './tab-manager'
import { sharedFileManager } from './shared-file-manager'
import { AIHome } from './ai-home'
import { authClient } from './auth-client'
import { e2eeManager } from './e2ee'
import { createEditor, getText, setText, setReadOnly } from './cm-editor'
import { SlashMenu } from './slash'
import { WikiAutocomplete } from './wiki-autocomplete'
import { CommentManager } from './comments'
import { SelectionToolbar } from './selection-toolbar'
import { BacklinksPanel } from './backlinks'
import { PageHeader } from './page-header'
import { TemplatePicker } from './templates'
import { Favorites } from './favorites'
import { Recents } from './recents'
import { ExportMenu } from './export'
import { ImportManager } from './import'
import { TrashManager } from './trash'
import { TeamspacesManager } from './teamspaces'
import { P2PTeamManager } from './p2p-team'
import {
  openCreateTeamDialog, openJoinTeamDialog, openClaimDialog, openInviteDialog, openRosterDialog,
  openCreateNoteDialog, openNoteAccessDialog,
} from './team-dialogs'
import { identity } from './identity'
import { contactStore, startInbox, getReceivedOffers, removeReceivedOffer } from './contacts'
import { syncDotColor, syncDotTitle, openSyncPopover } from './cloud-sync'
import { openServerDialog, flashConnectToastIfPending } from './server-config'
import { applyEditorFont, loadEditorFont } from './fonts'
import { CompanyBrainCenter } from './brain-drawer'
import { AIDock } from './ai-dock'
import { sparkIcon } from './brain-service-logos'
import { maybeShowOnboarding } from './onboarding'
import { initReminderWatcher, parseISODate, formatDateLabel } from './cm-mention'
import { GraphView } from './graph-view'
import { todayISO, buildDailyNoteBody, findNoteByTitle } from './daily-notes'
import { mountReactSurface, unmountReactSurface } from './react/mount'
import { buildHostBridge } from './react/host-bridge'
import { taskScan } from './task-scan'
import { inboxStore } from './inbox-store'
import { toggleFocusMode } from './cm-focus'
import { yCollab } from 'y-codemirror.next'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'

// Apply the persisted theme (light/dark/system) to <html> BEFORE first paint so
// there's no light flash on launch. Runs synchronously as the module loads.
applyStoredTheme()

// DEBUG: Verify script execution
console.log('Main JS executing...')

window.appState = { isSettingsOpen: false }

const app = document.getElementById('app')
const sharePopover = new SharePopover()
window.sharePopover = sharePopover // automation/debug handle (like window.cmView)
let notificationCenter
let moreMenu
let aiHome
const ENABLE_AI_HOME = false

window.onerror = function(message, source, lineno, colno, error) {
  const div = document.createElement('div');
  div.style.position = 'fixed';
  div.style.top = '0';
  div.style.left = '0';
  div.style.width = '100%';
  div.style.background = '#ffebeb';
  div.style.color = '#cc0000';
  div.style.padding = '20px';
  div.style.zIndex = '9999';
  div.style.fontFamily = 'monospace';
  div.textContent = `Error: ${message}\nSource: ${source}:${lineno}`;
  if (document.body) document.body.appendChild(div);
  console.error(error);
};

let cmView // CodeMirror EditorView
let slashMenu
let wikiAutocomplete
let commentManager
let selectionToolbar
let teamManager
let historyManager
let propertiesManager
let contextMenu
let indexer
let cmdPalette
let companyBrainCenter
let aiDock = null // Company Brain docked as a right-hand panel
let docEngine // Active DocumentEngine
let projectionManager // Active Projection

// Event Handler References (for cleanup)
let activeDirectory = null // Track focused folder for context creation
let currentOpenPath = null // Absolute path of the currently open local file (for backlinks / sub-pages)
let currentTeamNote = null // { teamId, noteId } when a synced P2P team note is open (else null)
let backlinksPanel = null // Lazy BacklinksPanel instance
let pageHeader = null // Page icon/cover header
let templatePicker = null // Template picker overlay
let favorites = null // Favorites / pinned items manager
let recentsManager = null // Recently-opened docs tracker
let exportMenu = null // Export popover (Markdown / HTML / PDF)
let importManager = null // Import popover (CSV -> database / Markdown -> note)
let trashManager = null // Soft-delete / Trash view manager
let teamspacesManager = null // Local-first teamspaces (sidebar groupings)
let p2pTeamManager = null // Zero-account, pure-P2P teams (synced workspaces)
let graphView = null // Lazy GraphView overlay (force-directed map of notes)
window.isUpdatingFromYjs = false // Global mutex for Projection safety

let newTabModal
let openFile = loadFileContent // Default handler, re-assigned in init for tab logic
let sidebarManager
let tabManager
let e2eeReadOnlyLocked = false

// ── Plugin system (gated by Features.plugins; all access defensive) ──────────
let pluginController = null // controller from initPluginSystem(hostHooks)
let reactHost = null // shared host bridge for React-island surfaces (built once, lazily)
// Last editor bind args, so the host can trigger a rebindEditor() when a plugin
// (de)registers an editor extension that must apply to the already-open doc.
let currentYText = null
let currentEngine = null

/**
 * Destroys the current CodeMirror view and creates a new one with yCollab binding.
 * CRITICAL: Must pass doc: yText.toString() to EditorState.create — yCollab does NOT
 * sync existing Y.Text content into an empty editor, only future changes.
 */
function rebindEditor(yText, engine) {
    // Remember the active bind so the plugin host can ask for a rebind when a
    // plugin (de)registers an editor extension that must apply to the open doc.
    currentYText = yText
    currentEngine = engine
    const editorParent = document.getElementById('editor')

    // Scrub old-format cursor data before creating yCollab
    engine.awareness.getStates().forEach((state, clientId) => {
        if (state.cursor && typeof state.cursor.index === 'number') {
            if (clientId === engine.awareness.clientID) {
                engine.awareness.setLocalStateField('cursor', null)
            }
        }
    })

    // Destroy existing CM view
    if (cmView) {
        cmView.destroy()
        cmView = null
    }

    // Build extensions with yCollab + update listeners
    const extensions = [
        yCollab(yText, engine.awareness, { undoManager: engine.undoManager }),
        EditorView.updateListener.of(update => {
            if (update.docChanged) handleTextChange(update)
            if (update.selectionSet) {
                handleSelectionChange()
                if (selectionToolbar) selectionToolbar.update(update.view)
            }
            // Slash menu trigger/filter on doc changes
            if (update.docChanged && slashMenu) {
                const pos = update.state.selection.main.head
                if (slashMenu.isOpen) {
                    slashMenu.updateFilter(update.state, pos)
                } else {
                    slashMenu.checkTrigger(update.state, pos)
                }
            }
            // [[ wiki-link autocomplete
            if (update.docChanged && wikiAutocomplete) {
                const pos = update.state.selection.main.head
                if (wikiAutocomplete.isOpen) {
                    wikiAutocomplete.updateFilter(update.state, pos)
                } else {
                    wikiAutocomplete.checkTrigger(update.state, pos)
                }
            }
        }),
        CommentManager.extension,
        EditorView.domEventHandlers({
            keydown(e) {
                if (slashMenu && slashMenu.handleKey(e)) return true
                if (wikiAutocomplete && wikiAutocomplete.handleKey(e)) return true
                // Cmd+Shift+M to add comment
                if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'm') {
                    e.preventDefault()
                    if (commentManager) commentManager.startNewComment()
                    return true
                }
                return false
            },
            click(e, view) {
                // Click on comment highlight → open popover
                if (commentManager && commentManager.handleClick(e)) return true
                // Cmd+Click (Mac) or Ctrl+Click (Win/Linux) to open links
                if (!(e.metaKey || e.ctrlKey)) return false
                const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
                if (pos == null) return false
                const tree = syntaxTree(view.state)
                let url = null
                tree.iterate({
                    from: pos, to: pos,
                    enter(node) {
                        if (node.name === 'URL') {
                            url = view.state.doc.sliceString(node.from, node.to)
                        }
                        if (node.name === 'Link') {
                            // Find URL child
                            const cursor = node.node.cursor()
                            if (cursor.firstChild()) {
                                do {
                                    if (cursor.name === 'URL') {
                                        url = view.state.doc.sliceString(cursor.from, cursor.to)
                                    }
                                } while (cursor.nextSibling())
                            }
                        }
                    }
                })
                if (url) {
                    e.preventDefault()
                    if (window.api?.send) {
                        window.api.send('open-external', url)
                    } else {
                        window.open(url, '_blank')
                    }
                    return true
                }
                return false
            }
        }),
    ]

    // Plugin-contributed CM6 extensions (blocks/decorations/keymaps). The host
    // returns a STABLE extension array; spread it before createEditor so the
    // plugin editor surfaces apply to this view. Defensive: never blocks the
    // editor if the plugin system is off or throws.
    if (Features.plugins && pluginController) {
        try {
            const pluginExts = pluginController.getEditorExtensions()
            if (Array.isArray(pluginExts) && pluginExts.length) extensions.push(...pluginExts)
        } catch (e) { console.warn('[plugins] getEditorExtensions failed:', e) }
    }

    cmView = createEditor(editorParent, {
        doc: yText.toString(),
        placeholder: 'Start writing...',
        extensions,
    })
    window.cmView = cmView

    // Update slash menu with new view
    if (!slashMenu) {
        slashMenu = new SlashMenu(cmView, {
            onCreatePage: () => { void createSubPage() },
            onTemplate: () => { if (templatePicker) templatePicker.open() }
        })
    } else {
        slashMenu.setView(cmView)
    }

    // Wiki-link [[ autocomplete
    if (!wikiAutocomplete) {
        wikiAutocomplete = new WikiAutocomplete(cmView, {
            getRoot: async () => Store.projectPath || (await window.api.getSettings('knownProjects').catch(() => null) || [])[0]
        })
    } else {
        wikiAutocomplete.setView(cmView)
    }

    // Update selection toolbar
    if (!selectionToolbar) {
        selectionToolbar = new SelectionToolbar()
        selectionToolbar.onComment(() => commentManager?.startNewComment())
    }
    selectionToolbar.setView(cmView)

    // Update comment manager with new view and engine
    if (!commentManager) {
        commentManager = new CommentManager(engine)
    } else {
        commentManager.setDocEngine(engine)
    }
    commentManager.setView(cmView)
    commentManager.updateHighlights()

    // Re-point plugin editor helpers across the CM6 rebuild (mirrors slashMenu).
    if (Features.plugins && pluginController) {
        try { pluginController.setEditorView(cmView) } catch (e) { console.warn('[plugins] setEditorView failed:', e) }
    }
}

function isIndexedDbOpenError(reason) {
    const msg = String(reason?.message || reason || '')
    return msg.includes('indexedDB.open') && msg.includes('UnknownError')
}

async function probeIndexedDBHealth() {
    if (typeof indexedDB === 'undefined') return false
    return await new Promise((resolve) => {
        const probeName = `opus-idb-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`
        let settled = false
        try {
            const req = indexedDB.open(probeName)
            req.onupgradeneeded = () => {}
            req.onsuccess = () => {
                try {
                    req.result.close()
                    indexedDB.deleteDatabase(probeName)
                } catch (_) {}
                if (!settled) {
                    settled = true
                    resolve(true)
                }
            }
            req.onerror = () => {
                if (!settled) {
                    settled = true
                    resolve(false)
                }
            }
        } catch (_) {
            if (!settled) {
                settled = true
                resolve(false)
            }
        }
        setTimeout(() => {
            if (!settled) {
                settled = true
                resolve(false)
            }
        }, 1500)
    })
}

function setE2EELockedState(locked, reason = 'Locked: unlock Vault to open this encrypted document') {
    e2eeReadOnlyLocked = !!locked
    setReadOnly(cmView, e2eeReadOnlyLocked)
    if (e2eeReadOnlyLocked) {
        const statusEl = document.getElementById('file-status')
        if (statusEl) statusEl.textContent = reason
    }
}

/**
 * Ensures the first line of the document is a Markdown H1 (# Title) matching the title.
 */
async function ensureH1Title(title) {
    // The page now has a dedicated big title (the filename), rendered above the
    // body by PageHeader. The body is freeform Markdown — a leading "# " is just
    // content, not the title — so renaming a note must NOT inject/rewrite a body
    // H1 (that produced a duplicate title). Decoupled: this is now a no-op.
    return;

    /* eslint-disable no-unreachable */
    if (!docEngine || window.isUpdatingFromYjs) return;

    const cleanTitle = title.replace(/\.md$/, '').replace(/_/g, ' ');
    const fullText = docEngine.text.toString();
    // If the doc opens with YAML front-matter (page icon/cover), the H1 lives
    // below it — leave title/H1 syncing alone to avoid corrupting the block.
    if (/^---\n[\s\S]*?\n---/.test(fullText)) return;
    const lines = fullText.split('\n');
    const firstLine = lines[0];

    // Already correct
    if (firstLine === `# ${cleanTitle}`) return;

    // Check if first line is already a markdown H1
    const h1Match = firstLine.match(/^# (.*)$/);
    if (h1Match) {
        const existingTitle = h1Match[1].trim();
        if (existingTitle.toLowerCase() === cleanTitle.toLowerCase()) return;
        // Only replace placeholder titles
        const placeholders = ['Heading', 'Untitled', 'Cloud Document', 'New Note', ''];
        if (!placeholders.includes(existingTitle)) return;
    }

    // If first line is not an H1 at all, only act on empty/placeholder docs
    if (!h1Match) {
        const firstLineText = firstLine.trim();
        if (firstLineText && fullText.trim().length > 0) return;
    }

    // Safety: don't touch if first line is too long
    if (firstLine.length > 200) return;

    console.log('[Main] Correcting H1 title to:', cleanTitle);
    const newFirstLine = `# ${cleanTitle}`;
    docEngine.doc.transact(() => {
        docEngine.text.delete(0, firstLine.length);
        docEngine.text.insert(0, newFirstLine);
    }, 'ensure-h1');
    /* eslint-enable no-unreachable */
}

// Global UI Helper: Update Header Meta (Edited time + Presence)
async function updateHeaderMeta() {
    const editStatus = document.getElementById('edit-status');
    const presenceContainer = document.getElementById('presence-avatars');
    if (!editStatus || !presenceContainer) return;

    if (!docEngine) {
        editStatus.textContent = '';
        presenceContainer.innerHTML = '';
        return;
    }

    // 1. Update Last Edited Time
    try {
        // Only fetch if we are connected to cloud or at least trying to
        const isCloudDoc = docEngine.cloudProvider && (docEngine.cloudProvider.shouldConnect || docEngine.cloudProvider.wsconnected);
        
        // Cache metadata fetch to avoid excessive server calls (max once every 5 seconds)
        const now = Date.now();
        if (isCloudDoc && (!window._lastMetaFetch || now - window._lastMetaFetch > 5000)) {
            window._lastMetaFetch = now;
            const metadata = await authClient.getDocumentMetadata(docEngine.docId).catch(() => null);
            if (metadata && metadata.updatedAt) {
                window._cachedDocMetadata = metadata;
            }
        }

        const metadata = window._cachedDocMetadata;
        if (metadata && metadata.updatedAt) {
            const date = new Date(metadata.updatedAt);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            
            let timeStr = 'Just now';
            if (diffMins >= 1440) timeStr = `${Math.floor(diffMins / 1440)}d ago`;
            else if (diffMins >= 60) timeStr = `${Math.floor(diffMins / 60)}h ago`;
            else if (diffMins > 0) timeStr = `${diffMins}m ago`;
            
            editStatus.textContent = `Edited ${timeStr}`;
        } else {
            editStatus.textContent = '';
        }
    } catch (e) { 
        editStatus.textContent = ''; 
    }

    // 2. Update Presence Avatars
    const states = docEngine.presence.awareness.getStates();
    const activeUsers = [];
    const typingUsers = [];
    // Get my ID to exclude from typing indicator
    const myId = docEngine.presence.awareness.getLocalState()?.user?.id;

    states.forEach((state, clientID) => {
        if (state.user) {
            activeUsers.push({ ...state.user, clientID });
            if (state.user.isTyping && state.user.id !== myId) {
                typingUsers.push(state.user.name || 'Someone');
            }
        }
    });

    // Update Typing Indicator
    if (typingUsers.length > 0) {
        const text = typingUsers.length > 2 
            ? `${typingUsers.length} people are typing...` 
            : `${typingUsers.join(' and ')} ${typingUsers.length === 1 ? 'is' : 'are'} typing...`;
        editStatus.textContent = text;
        editStatus.style.color = '#007bff';
        editStatus.style.fontWeight = '500';
    } else {
        editStatus.style.color = '#999';
        editStatus.style.fontWeight = '400';
    }

    // Deduplicate by user ID (keep most recent client)
    const uniqueUsers = Array.from(new Map(activeUsers.map(u => [u.id, u])).values());

    // 3. Fetch Inactive Users (Those with permissions but not currently in awareness)
    try {
        const isCloudDoc = docEngine.cloudProvider && (docEngine.cloudProvider.shouldConnect || docEngine.cloudProvider.wsconnected);
        const permissions = isCloudDoc ? await authClient.getDocumentPermissions(docEngine.docId).catch(() => []) : [];
        const activeUserIds = new Set(uniqueUsers.map(u => u.id));
        
        permissions.forEach(p => {
            if (p.user && !activeUserIds.has(p.user.id)) {
                // Determine user name and color
                const nameToUse = (p.user.displayName || p.user.email || 'User');
                const name = (nameToUse.split('@')[0] || 'User');
                // Deterministic color
                const color = docEngine.presence.generateColor(p.user.email || 'user@notionless.app');
                
                uniqueUsers.push({
                    name,
                    email: p.user.email,
                    id: p.user.id,
                    color,
                    inactive: true,
                    // Mock last viewed for now if not in DB
                    lastViewed: p.lastViewedAt || null 
                });
            } else if (p.team && !p.user) {
                // Shared with a team
                uniqueUsers.push({
                    name: p.team.name,
                    email: 'Team Workspace',
                    id: 'team-' + p.team.id,
                    color: '#007bff',
                    inactive: true,
                    lastViewed: null
                });
            }
        });
    } catch (e) {}

    presenceContainer.innerHTML = uniqueUsers.map(u => {
        const initials = (u.name || u.email || '?')[0].toUpperCase();
        let metaText = 'Active now';
        
        if (u.inactive) {
            if (u.lastViewed) {
                const date = new Date(u.lastViewed);
                const now = new Date();
                const diffMs = now - date;
                const diffMins = Math.floor(diffMs / 60000);
                
                let timeStr = 'Just now';
                if (diffMins >= 43200) timeStr = `${Math.floor(diffMins / 43200)}mo ago`;
                else if (diffMins >= 1440) timeStr = `${Math.floor(diffMins / 1440)}d ago`;
                else if (diffMins >= 60) timeStr = `${Math.floor(diffMins / 60)}h ago`;
                else if (diffMins > 0) timeStr = `${diffMins}m ago`;
                
                metaText = `Last viewed ${timeStr}`;
            } else {
                metaText = 'Shared with access';
            }
        }

        return `
            <div class="presence-avatar ${u.inactive ? 'inactive' : ''}" style="background: ${u.color || '#ccc'}; opacity: ${u.inactive ? 0.6 : 1}" data-user-id="${u.id}">
                ${initials}
                <div class="presence-tooltip">
                    <div class="pt-header">${u.name}</div>
                    <div class="pt-email">${u.email}</div>
                    <div class="pt-meta">${metaText}</div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Build a Favorites/Recents item descriptor for the currently open document.
 * Returns null when nothing is open. Resolves the display name from the title
 * input, falling back to the file/doc name.
 */
function getCurrentDocFavItem() {
    const titleEl = document.getElementById('doc-title')
    const name = (titleEl && titleEl.value && titleEl.value.trim()) || 'Untitled'
    if (currentOpenPath && typeof currentOpenPath === 'string' && !currentOpenPath.startsWith('cloud:')) {
        return { type: 'local', path: currentOpenPath, name }
    }
    if (docEngine && docEngine.docId) {
        const docId = docEngine.docId
        // Local docs use a path-like docId (contains a slash); cloud docs don't.
        const isCloud = !docId.includes('/') && !docId.includes('\\')
        if (isCloud) return { type: 'cloud', docId, name }
        if (currentOpenPath) return { type: 'local', path: currentOpenPath, name }
    }
    return null
}

/** Sync the header star button (#fav-btn) icon to the real favorite state. */
function updateFavButtonState() {
    const favBtn = document.getElementById('fav-btn')
    if (!favBtn) return
    const icon = favBtn.querySelector('i')
    if (!icon) return
    const item = getCurrentDocFavItem()
    const isFav = item && favorites && favorites.isFavorite(item)
    if (isFav) {
        icon.className = 'fas fa-star'
        icon.style.color = '#f0ad4e'
        favBtn.title = 'Remove from favorites'
    } else {
        icon.className = 'far fa-star'
        icon.style.color = ''
        favBtn.title = 'Add to favorites'
    }
}

// There is no account/sign-in in the open-source build. Any legacy 'open-login'
// dispatch is a no-op — teams are joined by link and identity is per-team
// (username + password) via the P2P claim dialog, not a global account.
window.addEventListener('open-login', () => {
    console.log('[Main] open-login ignored — no accounts in this build (use Teams → Create/Join)')
})

// Listen for logout
window.addEventListener('auth:logout', async () => {
    console.log('[Main] Logout event received')
    if (sidebarManager) await sidebarManager.renderSidebarLists()
    if (teamManager) await teamManager.updateView()
    await updateHeaderMeta()
})

// Listen for login
window.addEventListener('auth:login', async (e) => {
    console.log('[Main] Login event received, triggering cloud connect for active document...')
    const user = e.detail ? e.detail.user : (await import('./auth-client').then(m => m.authClient.getMe()));
    
    // Update Workspace Header
    if (user) {
        const label = document.getElementById('workspace-label');
        const icon = document.getElementById('workspace-icon');
    const nameToUse = (user && (user.displayName || user.email)) ? (user.displayName || user.email) : 'Personal';
    const initials = (nameToUse && nameToUse.length > 0) ? nameToUse[0].toUpperCase() : 'P'
    if (label) label.textContent = (nameToUse.split('@')[0] || 'Personal');
    if (icon) icon.textContent = initials;
    }

    if (docEngine && teamManager && authClient.token) {
        teamManager.engine = docEngine
        await teamManager.connect()
    }
    if (sidebarManager) await sidebarManager.renderSidebarLists()
    await updateHeaderMeta()
})

// Listen for team updates
window.addEventListener('teams:updated', async () => {
    console.log('[Main] Teams updated, refreshing sidebar...')
    if (sidebarManager) await sidebarManager.renderSidebarLists()
})

// Listen for new notifications (invites/shares)
window.addEventListener('notification:new', async () => {
    console.log('[Main] New notification, refreshing sidebar...')
    if (sidebarManager) await sidebarManager.renderSidebarLists()
})

app.innerHTML = `
  <div class="window-layout">
    <div class="wrapper">
        <aside id="sidebar">
          <div class="sidebar-header-area">
             <!-- Top bar: workspace switcher pinned to the very top (cleared past
                  the traffic lights) + the collapse toggle. The empty space drags. -->
             <div class="ws-switcher" id="account-btn">
                <div class="workspace-icon" id="workspace-icon">P</div>
                <span id="workspace-label" class="ws-name">Personal</span>
                <svg class="ws-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
             </div>
             <button class="icon-btn sidebar-toggle-inner" id="sidebar-collapse-btn" title="Close Sidebar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="9" y1="3" x2="9" y2="21"></line>
                </svg>
             </button>
          </div>

          <div class="sidebar-nav-list">
             <!-- App rail: Home / Chat / Calendar / Inbox + Search. The active app
                  expands to its label; clicking swaps the contextual nav below. -->
             <div class="appnav" id="appnav">
                <button class="appnav-btn is-active" id="home-btn" data-view="home" title="Home"><svg viewBox="0 0 24 24" fill="none"><path d="M4 11l8-6 8 6M6 10v8a1 1 0 001 1h10a1 1 0 001-1v-8M10 19v-5h4v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="appnav-label">Home</span></button>
                <button class="appnav-btn" id="chat-btn" data-view="chat" title="Chat — Company Brain"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7a2 2 0 012-2h10a2 2 0 012 2v6a2 2 0 01-2 2H9l-4 3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><span class="appnav-label">Chat</span></button>
                <button class="appnav-btn" id="calendar-btn" data-view="calendar" title="Calendar — daily notes, due dates & reminders"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="15" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M4 9.5h16M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span class="appnav-label">Calendar</span></button>
                <button class="appnav-btn" id="email-btn" data-view="inbox" title="Inbox — Mail"><svg viewBox="0 0 24 24" fill="none"><path d="M4 13l2-7h12l2 7v4a1 1 0 01-1 1H5a1 1 0 01-1-1z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 13h4l1 2h6l1-2h4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><span class="appnav-label">Inbox</span></button>
                <div class="appnav-spacer"></div>
                <button class="appnav-btn appnav-btn--ghost" id="search-btn" title="Search (⌘K)"><svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.7"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
             </div>
          </div>

          <div class="sidebar-content" id="sidebar-scroll-area">

             <!-- ===== HOME VIEW ===== -->
             <div class="sb-view" id="sb-view-home">
                 <!-- Private Section -->
                 <div class="sidebar-section">
                     <div class="sidebar-section-header">
                         <span>Private</span>
                         <div class="shdr-actions">
                            <i class="fas fa-folder-plus icon-btn" id="add-folder-btn" title="Open Local Folder"></i>
                            <i class="fas fa-file-import icon-btn" id="import-btn" title="Import Files"></i>
                            <i class="fas fa-plus icon-btn" id="add-btn" title="Add Page"></i>
                         </div>
                     </div>
                     <div id="file-tree" class="file-tree"></div>
                 </div>

                 <!-- Teamspaces Section -->
                 <div class="sidebar-section" id="teamspaces-section">
                     <div class="sidebar-section-header">
                        <span>Teamspaces</span>
                        <div class="shdr-actions">
                           <i class="fas fa-server icon-btn" id="team-server-btn" title="Connect to your team's server"></i>
                           <i class="fas fa-mobile-alt icon-btn" id="link-device-btn" title="Link a device"></i>
                           <i class="fas fa-link icon-btn" id="join-team-btn" title="Join a team"></i>
                           <i class="fas fa-plus icon-btn" id="create-team-btn" title="Create a team"></i>
                        </div>
                     </div>
                     <div id="teamspaces-list"></div>
                 </div>

                 <!-- Shared Section -->
                 <div class="sidebar-section" id="shared-section">
                     <div class="sidebar-section-header">Shared</div>
                     <div id="shared-list"></div>
                 </div>

                 <!-- Apps -->
                 <div class="sidebar-section">
                     <div class="sidebar-section-header">Apps</div>
                     <button class="sb-app-row" id="tasks-btn" title="Tasks — every checkbox across your notes"><span class="sb-folder-ic"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 12l2.4 2.4L15.5 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>Tasks</span></button>
                     <button class="sb-app-row" id="graph-btn" title="Graph view (⌘⇧G)"><span class="sb-folder-ic"><svg viewBox="0 0 24 24" fill="none"><circle cx="5.5" cy="6" r="2" stroke="currentColor" stroke-width="1.7"/><circle cx="18.5" cy="6" r="2" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="18" r="2" stroke="currentColor" stroke-width="1.7"/><path d="M7.3 7.2l3.4 8.8M16.7 7.2l-3.4 8.8M7.5 6h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span><span>Graph</span></button>
                     <button class="sb-app-row" id="inbox-btn" title="Notifications"><span class="sb-folder-ic"><svg viewBox="0 0 24 24" fill="none"><path d="M6 9.5a6 6 0 0112 0c0 4.5 2 5.5 2 5.5H4s2-1 2-5.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 19a2 2 0 004 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span><span>Notifications</span><span class="utility-badge" id="inbox-unread-badge" style="display:none;"></span></button>
                     <button class="sb-app-row" id="trash-btn" title="Trash"><span class="sb-folder-ic"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></span><span>Trash</span></button>
                 </div>
             </div>

             <!-- ===== CHAT VIEW ===== -->
             <div class="sb-view" id="sb-view-chat" style="display:none;">
                 <button class="sb-primary" id="chat-new-thread" title="Start a new chat"><svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>New chat</span></button>
                 <div class="sidebar-section-header">Agents</div>
                 <div id="sb-agents-row" class="sb-agents"></div>
                 <div id="sb-chat-recent"><div class="sb-empty">Your chats will appear here.</div></div>
             </div>

             <!-- ===== CALENDAR VIEW ===== -->
             <div class="sb-view" id="sb-view-calendar" style="display:none;">
                 <button class="sb-primary" id="cal-new-event"><svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>New event</span></button>
                 <div class="sb-mini" id="sb-cal-mini"></div>
                 <div class="sidebar-section-header">My calendars</div>
                 <button class="sb-cal-row" id="cal-daily"><span class="sb-dot" style="background:#2383E2"></span><span>Daily notes</span></button>
                 <button class="sb-cal-row" id="cal-due"><span class="sb-dot" style="background:#5B9A6B"></span><span>Tasks &amp; due dates</span></button>
                 <!-- Connected CalDAV calendars (painted by renderCalendarNav from
                      calendar:calendars; visibility toggles via calendar:calendarSetVisible). -->
                 <div id="sb-cal-connected"></div>
                 <div class="sb-mail-sep"></div>
                 <button class="sb-cal-row" id="cal-add-account"><span class="sb-folder-ic"><svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span><span>Add calendar account</span></button>
             </div>

             <!-- ===== INBOX (MAIL) VIEW ===== -->
             <!-- Painted by renderMailNav() from the Email surface's published
                  email:nav-state (accounts + folders). Clicks dispatch email:cmd
                  back to the surface — one sidebar, no second folder rail. -->
             <div class="sb-view" id="sb-view-inbox" style="display:none;">
                 <div id="sb-mail-nav"></div>
             </div>

             <!-- Hidden Views -->
             <div id="search-view" style="display: none;"></div>
             <div id="profile-view" style="display: none;"></div>
          </div>

          <div class="sidebar-bottom">
              <div class="ws-foot-row">
                  <button class="ws-newchat" id="newchat-btn" title="New chat — Company Brain">
                      <svg class="ws-newchat__icon" viewBox="0 0 24 24" fill="none"><path d="M5 8c1-2 3-3 5-2M12 4c4 0 7 3 7 7 0 4-3 7-7 7-1 0-2 0-3-1l-4 1 1-4c-1-1-1-2-1-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      <span class="ws-newchat__label">New chat</span>
                  </button>
                  <button class="ws-compose" id="sidebar-compose-btn" title="New page">
                      <svg viewBox="0 0 24 24" fill="none"><path d="M4 20l3.5-1L18 8.5 15.5 6 5 16.5 4 20z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 7.5L16.5 10" stroke="currentColor" stroke-width="1.6"/></svg>
                  </button>
              </div>
          </div>
        </aside>
        
        <div class="main">

            <!-- Tabs Header in Main Content -->
            <div class="tabs-header">
                <!-- Spacer for traffic lights (visible only when sidebar collapsed) -->
                <div class="traffic-lights-spacer collapsed-only" id="tl-spacer"></div>
                
                <!-- Expand Button (Visible only when sidebar collapsed) -->
                <button class="icon-btn sidebar-toggle-outer collapsed-only" id="sidebar-expand-btn" title="Open Sidebar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="3" y1="12" x2="21" y2="12"></line>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                </button>
                
                <div class="tab-list" id="tab-list"></div>
                <button class="icon-btn new-tab-btn" id="add-tab-btn" title="New Tab"><i class="fas fa-plus"></i></button>
            </div>
            
      <header class="app-header">
        <div class="header-left" style="display: flex; align-items: center; gap: 4px; flex: 1;">
           <div id="breadcrumbs" style="font-size: 13px; color: #999; display: flex; align-items: center; white-space: nowrap; margin-right: 4px;"></div>
           <span id="doc-title-sizer"></span>
           <input type="text" id="doc-title" placeholder="Untitled" class="seamless-title">
           <div id="visibility-badge" class="visibility-badge" style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #999; padding: 2px 4px; cursor: pointer; user-select: none;">
               <i class="fas fa-lock" style="font-size: 10px;"></i>
               <span>Private</span>
           </div>
        </div>
        <div class="header-right" id="header-right" style="display: flex; align-items: center; gap: 4px;">
            <button class="icon-btn ai-dock-toggle" id="ai-dock-toggle" title="Ask AI  (⌘J)" aria-label="Ask AI">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.9 5.6a3 3 0 001.5 1.5L21 12l-5.6 1.9a3 3 0 00-1.5 1.5L12 21l-1.9-5.6a3 3 0 00-1.5-1.5L3 12l5.6-1.9a3 3 0 001.5-1.5L12 3z" fill="currentColor"/></svg>
            </button>
            <span id="edit-status" style="font-size: 13px; color: #999; margin-right: 4px;"></span>
            <div id="presence-avatars" class="presence-avatars"></div>
            <!-- Share button will be inserted here -->
        </div>
      </header>
      <main>
        <!-- Home View (Inside Content Area) -->
        <div id="home-view" style="display: none;"></div>
        
        <!-- Dedicated Company Brain View -->
        <div id="brain-view" style="display: none;"></div>

        <!-- React-island surfaces (Tasks / Calendar / Inbox / Email). Mounted lazily. -->
        <div id="tasks-view" style="display: none;"></div>
        <div id="calendar-view" style="display: none;"></div>
        <div id="inbox-view" style="display: none;"></div>
        <div id="email-view" style="display: none;"></div>

        <div class="editor-container" style="position: relative;">
          <!-- Title removed from here -->
          <div id="editor"></div>
        </div>
        <!-- TOC Container -->
        <div id="toc-container" class="toc-container"></div>
      </main>
      <footer>
        <div class="stats">
          <div class="cursor-stats" id="cursor-pos">1:1</div>
          <div class="file-stats" id="word-count">0L 0W</div>
          <div class="file-name" id="file-status"></div>
          <div class="time" id="clock">--:--</div>
        </div>
      </footer>
    </div>
  </div>
</div>
`

/* Drag-resize the sidebar from its right edge (width persisted, like the
   Workspace Shell's resizable panes). Double-click resets to the default. */
function setupSidebarResizer() {
    const sidebar = document.getElementById('sidebar')
    if (!sidebar || sidebar.querySelector('.sidebar-resizer')) return
    const KEY = 'paperus_sidebar_w'; const MIN = 200; const MAX = 460; const DEF = 240
    const clamp = (n) => Math.max(MIN, Math.min(MAX, Math.round(n)))
    const apply = (w) => { sidebar.style.width = `${w}px`; sidebar.style.minWidth = `${w}px`; sidebar.style.maxWidth = `${w}px` }
    let saved = 0
    try { saved = parseInt(localStorage.getItem(KEY), 10) } catch { /* noop */ }
    if (saved >= MIN && saved <= MAX) apply(saved)
    const handle = document.createElement('div')
    handle.className = 'sidebar-resizer'
    handle.title = 'Drag to resize · double-click to reset'
    sidebar.appendChild(handle)
    let startX = 0; let startW = 0
    const onMove = (e) => apply(clamp(startW + (e.clientX - startX)))
    const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.classList.remove('sidebar-resizing')
        try { localStorage.setItem(KEY, String(parseInt(sidebar.style.width, 10) || DEF)) } catch { /* noop */ }
    }
    handle.addEventListener('mousedown', (e) => {
        if (sidebar.classList.contains('collapsed')) return
        e.preventDefault()
        startX = e.clientX; startW = sidebar.offsetWidth
        document.body.classList.add('sidebar-resizing')
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
    })
    handle.addEventListener('dblclick', () => { apply(DEF); try { localStorage.setItem(KEY, String(DEF)) } catch { /* noop */ } })
}

async function updateVisibilityStatus() {
    const badge = document.getElementById('visibility-badge')
    if (!badge) return
    
    if (!docEngine) {
        badge.style.display = 'none'
        return
    }
    
    // Check if it's a cloud doc or a shared local doc
    const isCloudDoc = docEngine.docId && !docEngine.docId.includes('/') && !docEngine.docId.includes('\\');
    
    if (!isCloudDoc) {
        badge.innerHTML = `<i class="fas fa-lock" style="font-size: 10px;"></i> <span>Private</span>`;
        badge.style.color = '#999';
        badge.style.display = 'flex';
        return;
    }

    badge.style.display = 'flex'
    
    // Create Dropdown Container if missing
    let dropdown = document.getElementById('workspace-dropdown')
    if (!dropdown) {
        dropdown = document.createElement('div')
        dropdown.id = 'workspace-dropdown'
        dropdown.className = 'dropdown-menu'
        dropdown.style.display = 'none'
        document.body.appendChild(dropdown)
        
        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && !badge.contains(e.target)) {
                dropdown.style.display = 'none'
            }
        })
        
        badge.addEventListener('click', async (e) => {
            e.stopPropagation()
            e.preventDefault()
            
            if (dropdown.style.display === 'block') {
                dropdown.style.display = 'none'
                return
            }

            const rect = badge.getBoundingClientRect()
            dropdown.style.top = (rect.bottom + 4) + 'px'
            dropdown.style.left = rect.left + 'px'
            dropdown.style.display = 'block'
            
            // Populate Dropdown
            dropdown.innerHTML = '<div style="padding: 8px; color: #999;">Loading...</div>'
            
            try {
                const { authClient } = await import('./auth-client')
                const teams = await authClient.getTeams()
                const user = await authClient.getMe()
                
                dropdown.innerHTML = `
                    <div class="dropdown-header" style="padding: 4px 8px; font-size: 11px; color: #999; font-weight: 600;">Move to...</div>
                    <div class="dropdown-item" data-id="personal" style="padding: 6px 8px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-user" style="width: 14px;"></i> Personal
                    </div>
                    ${teams.map(t => `
                        <div class="dropdown-item" data-id="${t.id}" style="padding: 6px 8px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-users" style="width: 14px;"></i> ${t.name}
                        </div>
                    `).join('')}
                `
                
                dropdown.querySelectorAll('.dropdown-item').forEach(item => {
                    item.addEventListener('mouseenter', () => item.style.background = '#f5f5f5')
                    item.addEventListener('mouseleave', () => item.style.background = 'white')
                    item.addEventListener('click', async () => {
                        const targetId = item.dataset.id
                        if (targetId === 'personal') {
                            alert('Moved to Personal (Mock)')
                        } else {
                            alert(`Moved to Team ${targetId} (Mock)`)
                        }
                        dropdown.style.display = 'none'
                        await updateVisibilityStatus() 
                    })
                })
                
            } catch (e) {
                dropdown.innerHTML = `<div style="padding: 8px; color: red;">Error: ${e.message}</div>`
            }
        })
    }
    
    try {
        const { authClient } = await import('./auth-client')
        const perms = await authClient.getDocumentPermissions(docEngine.docId)
        if (perms && perms.length > 0) {
            badge.innerHTML = `<i class="fas fa-users" style="font-size: 10px;"></i> <span>Shared</span> <i class="fas fa-chevron-circle-down" style="font-size: 8px; margin-left: 2px;"></i>`
            badge.style.color = '#555'
        } else {
            badge.innerHTML = `<i class="fas fa-lock" style="font-size: 10px;"></i> <span>Private</span> <i class="fas fa-chevron-circle-down" style="font-size: 8px; margin-left: 2px;"></i>`
            badge.style.color = '#999'
        }
    } catch (e) {
        badge.innerHTML = `<i class="fas fa-lock" style="font-size: 10px;"></i> <span>Private</span>`
    }
}

// ── Plugin system wiring ─────────────────────────────────────────────────────
// Everything below is defensive: each hook is independently try/catch-wrapped so
// a misbehaving plugin (or a missing surface) can never break the host. The host
// (plugin-host.js) ALSO defaults every missing hook to a no-op, so a partial bag
// is safe; we still implement the full §6 shape for fidelity.

/** Mount a top sidebar section into #sidebar-scroll-area (mirrors _ensureTopSection). */
function pluginEnsureSidebarSection(id, title, order) {
    const scroll = document.getElementById('sidebar-scroll-area')
    if (!scroll) return null
    let section = document.getElementById(id)
    if (!section) {
        section = document.createElement('div')
        section.className = 'sidebar-section plugin-section'
        section.id = id
        section.dataset.topOrder = String(Number.isFinite(order) ? order : 5)
        const listId = `${id}-list`
        const header = document.createElement('div')
        header.className = 'sidebar-section-header'
        const span = document.createElement('span')
        span.textContent = String(title || '')
        header.appendChild(span)
        const list = document.createElement('div')
        list.id = listId
        section.appendChild(header)
        section.appendChild(list)
        const ord = Number(section.dataset.topOrder)
        const existingTops = Array.from(scroll.children).filter(c => c.dataset && c.dataset.topOrder)
        let ref = null
        for (const c of existingTops) { if (Number(c.dataset.topOrder) > ord) { ref = c; break } }
        if (!ref) ref = Array.from(scroll.children).find(c => !(c.dataset && c.dataset.topOrder)) || null
        scroll.insertBefore(section, ref)
    }
    return document.getElementById(`${id}-list`)
}

/** Build the §6 hostHooks bag wired to the real editor / sidebar / AI / auth surfaces. */
function buildPluginHostHooks() {
    const noop = () => {}
    // Command bus: 'cmd:<id>' window CustomEvents (the host dispatches these for
    // execute + nav + team actions; we route them back to the plugin handler).
    const commandHandlers = new Map()
    const registerCommand = (id, handler) => {
        if (!id || typeof handler !== 'function') return
        const listener = (ev) => { try { handler(ev && ev.detail) } catch (e) { console.warn('[plugins] command handler threw:', e) } }
        commandHandlers.set(id, listener)
        window.addEventListener(`cmd:${id}`, listener)
    }
    const unregisterCommand = (id) => {
        const listener = commandHandlers.get(id)
        if (listener) { window.removeEventListener(`cmd:${id}`, listener); commandHandlers.delete(id) }
    }

    // Slash menu: push plugin items into the live SlashMenu items array. The menu
    // only natively executes `md`/`action` items, so plugin items insert their
    // optional `md`/`insertText` (best-effort) — richer run() needs a command.
    const registerSlash = (s) => {
        if (!s || !slashMenu || !Array.isArray(slashMenu.items)) return
        const md = typeof s.md === 'string' ? s.md : (typeof s.insertText === 'string' ? s.insertText : '')
        slashMenu.items.push({
            label: String(s.label || 'Plugin command'),
            icon: s.icon || '<i class="fas fa-puzzle-piece"></i>',
            md,
            _plugin: true,
        })
        if (Array.isArray(slashMenu.filteredItems)) slashMenu.filteredItems = slashMenu.items
    }
    const unregisterSlash = (label) => {
        if (!slashMenu || !Array.isArray(slashMenu.items)) return
        slashMenu.items = slashMenu.items.filter(i => !(i._plugin && i.label === label))
        slashMenu.filteredItems = slashMenu.items
    }

    return {
        // Editor extensions (the host delegates to contrib-editor.getEditorExtension()).
        getEditorExtensions: () => {
            try { return pluginController ? pluginController.getEditorExtensions() : [] } catch { return [] }
        },
        // The host invokes this cb (with a no-op arg) whenever a plugin (de)registers
        // an extension that must apply to the open doc → trigger a full rebind.
        onEditorExtensionsChanged: (_cb) => {
            try { if (currentYText && currentEngine) rebindEditor(currentYText, currentEngine) } catch (e) { console.warn('[plugins] editor rebind failed:', e) }
        },
        registerCommand,
        unregisterCommand,
        registerSlash,
        unregisterSlash,

        sidebar: {
            addSection: ({ id, title, order, mount } = {}) => {
                try {
                    const el = pluginEnsureSidebarSection(id, title, order)
                    if (el && typeof mount === 'function') mount(el)
                } catch (e) { console.warn('[plugins] addSection failed:', e) }
            },
            removeSection: (id) => { try { const s = document.getElementById(id); if (s) s.remove() } catch { /* noop */ } },
        },

        addView: ({ id, mount } = {}) => {
            try {
                const main = document.querySelector('main')
                if (!main) return { show: noop, hide: noop }
                let view = document.getElementById(`plugin-${id}-view`)
                if (!view) {
                    view = document.createElement('div')
                    view.id = `plugin-${id}-view`
                    view.className = 'plugin-view'
                    view.style.display = 'none'
                    main.appendChild(view)
                    if (typeof mount === 'function') mount(view)
                }
                return {
                    show: () => { try { showPluginView(`plugin-${id}-view`) } catch { /* noop */ } },
                    hide: () => { if (view) view.style.display = 'none' },
                }
            } catch (e) { console.warn('[plugins] addView failed:', e); return { show: noop, hide: noop } }
        },
        removeView: (id) => { try { const v = document.getElementById(`plugin-${id}-view`); if (v) v.remove() } catch { /* noop */ } },

        addNavItem: ({ id, label, icon, onClick } = {}) => {
            try {
                const list = document.querySelector('.sidebar-nav-list')
                if (!list || document.getElementById(`plugin-nav-${id}`)) return
                const row = document.createElement('div')
                row.className = 'sidebar-item plugin-nav-item'
                row.id = `plugin-nav-${id}`
                row.innerHTML = `${icon || '<i class="fas fa-puzzle-piece"></i>'} <span></span>`
                row.querySelector('span').textContent = String(label || '')
                row.addEventListener('click', () => { try { if (typeof onClick === 'function') onClick() } catch (e) { console.warn('[plugins] nav onClick threw:', e) } })
                list.appendChild(row)
            } catch (e) { console.warn('[plugins] addNavItem failed:', e) }
        },
        removeNavItem: (id) => { try { const r = document.getElementById(`plugin-nav-${id}`); if (r) r.remove() } catch { /* noop */ } },

        addToolbarItem: ({ id, icon, title, onClick } = {}) => {
            try {
                if (!selectionToolbar || !selectionToolbar.toolbar) return
                if (document.getElementById(`plugin-toolbar-${id}`)) return
                const btn = document.createElement('button')
                btn.className = 'toolbar-btn plugin-toolbar-btn'
                btn.id = `plugin-toolbar-${id}`
                btn.title = String(title || '')
                btn.innerHTML = icon ? `<i class="fas ${icon}"></i>` : String(title || '?')
                btn.addEventListener('mousedown', (e) => {
                    e.preventDefault(); e.stopPropagation()
                    try { if (typeof onClick === 'function') onClick() } catch (err) { console.warn('[plugins] toolbar onClick threw:', err) }
                })
                selectionToolbar.toolbar.appendChild(btn)
            } catch (e) { console.warn('[plugins] addToolbarItem failed:', e) }
        },
        removeToolbarItem: (id) => { try { const b = document.getElementById(`plugin-toolbar-${id}`); if (b) b.remove() } catch { /* noop */ } },

        addStatusItem: ({ id, location } = {}) => {
            try {
                const target = location === 'header'
                    ? (document.getElementById('header-right') || document.querySelector('.header-right'))
                    : document.querySelector('footer .stats')
                if (!target) return { set: noop }
                let el = document.getElementById(`plugin-status-${id}`)
                if (!el) {
                    el = document.createElement('div')
                    el.id = `plugin-status-${id}`
                    el.className = location === 'header' ? 'plugin-status-header' : 'plugin-status-footer'
                    target.appendChild(el)
                }
                return { set: (text) => { el.textContent = String(text == null ? '' : text) } }
            } catch (e) { console.warn('[plugins] addStatusItem failed:', e); return { set: noop } }
        },
        removeStatusItem: (id) => { try { const e = document.getElementById(`plugin-status-${id}`); if (e) e.remove() } catch { /* noop */ } },

        addSettingsSection: noop, // settings UI surface is optional; host no-ops it safely

        ai: {
            registerProvider: (providerId, impl) => {
                try {
                    const eng = companyBrainCenter && companyBrainCenter.engine
                    if (eng && typeof eng.registerProvider === 'function') eng.registerProvider(providerId, impl)
                } catch (e) { console.warn('[plugins] ai.registerProvider failed:', e) }
            },
            unregisterProvider: (providerId) => {
                try {
                    const eng = companyBrainCenter && companyBrainCenter.engine
                    if (eng && typeof eng.unregisterProvider === 'function') eng.unregisterProvider(providerId)
                } catch { /* noop */ }
            },
            // complete/embed run host-side against the CURRENT backend so the
            // plugin never sees the key. Degrade to empty results if unavailable.
            complete: async (opts) => {
                try {
                    const eng = companyBrainCenter && companyBrainCenter.engine
                    if (eng && typeof eng.complete === 'function') return await eng.complete(opts)
                } catch (e) { console.warn('[plugins] ai.complete failed:', e) }
                return { text: '' }
            },
            embed: async (text) => {
                try {
                    const eng = companyBrainCenter && companyBrainCenter.engine
                    if (eng && typeof eng.embedText === 'function') return await eng.embedText(text)
                } catch (e) { console.warn('[plugins] ai.embed failed:', e) }
                return []
            },
        },

        // Company Brain tool hooks (Phase 4): a plugin tool lands in the SAME
        // RAGEngine.toolRegistry the agent loop already reads, so no loop change is
        // needed. The RAGEngine instance is companyBrainCenter.engine (set up in
        // initPlugins via the same companyBrainCenter the ai hooks use above).
        brain: {
            registerTool: (toolId, impl) => {
                try {
                    const eng = companyBrainCenter && companyBrainCenter.engine
                    if (eng && typeof eng.registerTool === 'function') {
                        eng.registerTool({
                            id: toolId,
                            description: impl && impl.description,
                            parameters: impl && impl.parameters,
                            handler: impl && impl.handler,
                            source: 'plugin',
                        })
                    }
                } catch (e) { console.warn('[plugins] brain.registerTool failed:', e) }
            },
            unregisterTool: (toolId) => {
                try {
                    const eng = companyBrainCenter && companyBrainCenter.engine
                    if (eng && typeof eng.unregisterTool === 'function') eng.unregisterTool(toolId)
                } catch { /* noop */ }
            },
            listTools: () => {
                try {
                    const eng = companyBrainCenter && companyBrainCenter.engine
                    if (eng && typeof eng.listTools === 'function') return eng.listTools()
                } catch { /* noop */ }
                return []
            },
        },

        auth: {
            // Login-method registration: surface to the claim/login dialog. The
            // team-dialogs module exposes a registry when available; otherwise the
            // contrib-auth adapter falls back here and we stash for later pickup.
            registerLoginMethod: (method) => {
                try {
                    window.__pluginLoginMethods = window.__pluginLoginMethods || []
                    window.__pluginLoginMethods.push(method)
                    window.dispatchEvent(new CustomEvent('plugin:login-method-registered', { detail: method }))
                } catch (e) { console.warn('[plugins] registerLoginMethod failed:', e) }
            },
            unregisterLoginMethod: (id) => {
                try {
                    if (Array.isArray(window.__pluginLoginMethods)) {
                        window.__pluginLoginMethods = window.__pluginLoginMethods.filter(m => m && m.id !== id)
                    }
                    window.dispatchEvent(new CustomEvent('plugin:login-method-unregistered', { detail: { id } }))
                } catch { /* noop */ }
            },
        },

        teams: {
            list: () => {
                try {
                    if (p2pTeamManager && typeof p2pTeamManager.getTeams === 'function') {
                        const teams = p2pTeamManager.getTeams() || []
                        // Strip the rootKey secret before it reaches any adapter/plugin.
                        return teams.map(t => ({ id: t.id, name: t.name, noteCount: t.noteCount }))
                    }
                } catch (e) { console.warn('[plugins] teams.list failed:', e) }
                return []
            },
            members: (teamId) => {
                try {
                    if (p2pTeamManager && typeof p2pTeamManager.getRosterMembers === 'function') {
                        const members = p2pTeamManager.getRosterMembers(teamId) || []
                        return members.map(m => ({ username: m.username, displayName: m.displayName, publicKey: m.idPublicKey }))
                    }
                } catch { /* noop */ }
                return []
            },
            addTeamAction: noop, // team-action menu injection is optional; safe no-op
            removeTeamAction: noop,
        },

        // Plugin-scoped key/value storage, persisted via electron-settings under a
        // namespaced key. Never exposes the raw settings store to plugins.
        storage: {
            get: async (ns, key) => {
                try { const all = (await window.api.invoke('settings:get', `plugin_storage_${ns}`)) || {}; return all[key] } catch { return undefined }
            },
            set: async (ns, key, value) => {
                try {
                    const k = `plugin_storage_${ns}`
                    const all = (await window.api.invoke('settings:get', k)) || {}
                    all[key] = value
                    await window.api.invoke('settings:set', k, all)
                    return { ok: true }
                } catch (e) { return { ok: false, error: String(e && e.message || e) } }
            },
            delete: async (ns, key) => {
                try {
                    const k = `plugin_storage_${ns}`
                    const all = (await window.api.invoke('settings:get', k)) || {}
                    delete all[key]
                    await window.api.invoke('settings:set', k, all)
                    return { ok: true }
                } catch (e) { return { ok: false, error: String(e && e.message || e) } }
            },
            keys: async (ns) => {
                try { const all = (await window.api.invoke('settings:get', `plugin_storage_${ns}`)) || {}; return Object.keys(all) } catch { return [] }
            },
        },

        // Capability-gated filesystem, confined to the workspace by the MAIN process.
        fs: {
            read: async (id, p) => { try { return await window.api.invoke('plugin:fs-read', { id, path: p }) } catch (e) { return { ok: false, error: String(e && e.message || e) } } },
            list: async (id, dir) => { try { const r = await window.api.invoke('plugin:fs-list', { id, dir }); return (r && r.ok && r.entries) || [] } catch { return [] } },
            write: async (id, p, data) => { try { return await window.api.invoke('plugin:fs-write', { id, path: p, data }) } catch (e) { return { ok: false, error: String(e && e.message || e) } } },
        },

        // Capability-gated network fetch, host-allow-listed by the MAIN process.
        net: {
            fetch: async (id, url, init) => { try { return await window.api.invoke('plugin:net-fetch', { id, url, init }) } catch (e) { return { ok: false, error: String(e && e.message || e) } } },
        },

        // Host lifecycle events the host fans out to plugins (sanitized host-side).
        on: (event, cb) => {
            if (typeof cb !== 'function') return
            const map = {
                'note:open': 'plugin-host:note-open',
                'note:save': 'plugin-host:note-save',
                'note:change': 'plugin-host:note-change',
                'team:updated': 'team:list-updated',
                'file:changed': 'plugin-host:file-changed',
            }
            const winEvent = map[event] || `plugin-host:${event}`
            window.addEventListener(winEvent, (ev) => { try { cb(ev && ev.detail) } catch (e) { console.warn('[plugins] lifecycle cb threw:', e) } })
        },
    }
}

/** Initialize the plugin host + Plugin Lab once, behind Features.plugins. */
async function initPlugins() {
    if (!Features.plugins) return
    try {
        const hostHooks = buildPluginHostHooks()
        pluginController = await initPluginSystem(hostHooks)
        window.__pluginController = pluginController

        // Listen for host-dispatched UI signals.
        window.addEventListener('plugin:show-view', (ev) => {
            try { const id = ev && ev.detail && ev.detail.id; if (id) showPluginView(`plugin-${id}-view`) } catch { /* noop */ }
        })
        window.addEventListener('plugin:notify', (ev) => {
            try {
                const n = ev && ev.detail
                if (notificationCenter && n) notificationCenter.show(n.title || n.message || '', n.type || 'info')
            } catch { /* noop */ }
        })

        // The in-app Plugin Lab / Studio authoring UIs are retired — plugin authoring
        // now lives in the @paperus/plugin-sdk + the `create-notionless-plugin`
        // scaffolder, and installed plugins are managed from the account menu ▸
        // Developer ▸ Plugins… (openPluginSettings). The plugin RUNTIME below stays.
    } catch (e) {
        console.warn('[plugins] plugin system init failed (app continues):', e)
    }
}

/**
 * Hide every top-level content surface inside <main> except `exceptId`.
 * The content views (home, Company Brain, Plugin Lab, Plugin Studio) are mutually
 * exclusive — routing every view-switch through this is what stops two of them
 * from rendering stacked. Pass null/undefined to hide all of them (e.g. when
 * showing the editor).
 */
function hideContentViews(exceptId) {
    const ids = ['home-view', 'brain-view', 'tasks-view', 'calendar-view', 'inbox-view', 'email-view']
    for (const id of ids) {
        if (id === exceptId) continue
        const v = document.getElementById(id)
        if (v) v.style.display = 'none'
    }
    document.querySelectorAll('.plugin-view').forEach(v => { if (v.id !== exceptId) v.style.display = 'none' })
}

/** Show one #plugin-*-view, hiding the home/brain/editor surfaces (mirrors showCompanyBrainPage). */
function showPluginView(viewId) {
    hideContentViews(viewId)
    const editor = document.querySelector('.editor-container')
    if (editor) editor.style.display = 'none'
    const target = document.getElementById(viewId)
    if (target) target.style.display = 'flex'
}

/** Build the shared React-island host bridge once (rag-engine, scan, inbox, nav). */
function buildReactHost() {
    return buildHostBridge({
        api: window.api,
        identity,
        tabManager,
        p2p: p2pTeamManager,
        openFile: (p) => openFile(p),
        dates: { parseISODate, formatDateLabel, todayISO },
        daily: {
            openDailyNote: (iso) => openDailyNote(iso),
            openTodaysDailyNote: () => openDailyNote(todayISO()),
        },
        scan: {
            getScan: () => taskScan.getScan(),
            requestScan: (o) => taskScan.requestScan(o),
            toggleTask: (t, d) => taskScan.toggleTask(t, d),
        },
        inbox: {
            getItems: () => inboxStore.getItems(),
            accept: (it) => inboxStore.accept(it),
            dismiss: (it) => inboxStore.dismiss(it),
            markAllRead: () => inboxStore.markAllRead(),
            unreadCount: () => inboxStore.unreadCount(),
        },
        events: {
            create: (payload) => createCalendarEvent(payload),
        },
        getBrain: () => (companyBrainCenter ? companyBrainCenter.engine : null),
        toast: (msg) => flashHint(msg),
    })
}

/**
 * Show one of the React-island surfaces (Tasks / Calendar / Inbox / Email) as a
 * full content surface, lazily mounting it. Mirrors the old showPlugin*Page flow
 * (hide editor + document header/footer, show the view), but routes through the
 * island mount bridge instead of the retired vanilla Lab UIs.
 */
function showReactSurfacePage(viewId, surfaceKey) {
    try {
        currentOpenPath = null
        if (backlinksPanel) backlinksPanel.clear()
        if (pageHeader) pageHeader.clear()

        const editor = document.querySelector('.editor-container')
        const mainWrapper = document.querySelector('main')
        const header = document.querySelector('.app-header')
        const footer = document.querySelector('footer')
        const target = document.getElementById(viewId)

        document.querySelectorAll('.tree-item.active, .sidebar-doc-item.active, .sidebar-item.active').forEach(el => el.classList.remove('active'))

        // Sync the contextual sidebar to the surface (Calendar → calendar nav,
        // Email → inbox nav). Tasks/Notifications have no dedicated panel → Home.
        const SIDEBAR_FOR_SURFACE = { calendar: 'calendar', email: 'inbox' }
        setSidebarView(SIDEBAR_FOR_SURFACE[surfaceKey] || 'home')

        hideContentViews(viewId)
        if (editor) editor.style.display = 'none'
        if (mainWrapper) mainWrapper.style.display = 'flex'
        // Each island is its own full surface — no document header / editor footer.
        if (header) header.style.display = 'none'
        if (footer) footer.style.display = 'none'
        if (target) {
            target.style.display = 'flex'
            try {
                if (!reactHost) reactHost = buildReactHost()
                mountReactSurface(target, surfaceKey, reactHost)
            } catch (e) { console.warn('[islands] mount failed:', e) }
        }
    } catch (e) { console.warn('[islands] showReactSurfacePage failed:', e) }
}

/**
 * Wire the notes-derived engines that feed Tasks / Calendar / Inbox. Providers are
 * injected here (the engines stay framework- and app-agnostic). Called once after
 * the managers exist.
 */
function initDerivedEngines() {
    try {
        taskScan.init({
            getRoots: async () => {
                const roots = new Set()
                if (Store.projectPath) roots.add(Store.projectPath)
                const known = (await window.api.getSettings('knownProjects').catch(() => null)) || []
                for (const k of known) if (k) roots.add(k)
                return [...roots]
            },
            getOpenTeamDocs: async () => {
                // v1: only the currently-open team note (live Y.Text → in-place toggle).
                try {
                    if (currentTeamNote && p2pTeamManager && docEngine && docEngine.text) {
                        const { teamId, noteId } = currentTeamNote
                        const meta = p2pTeamManager.getNoteMeta ? p2pTeamManager.getNoteMeta(teamId, noteId) : null
                        return [{
                            source: `team:${teamId}:${noteId}`,
                            title: (meta && meta.title) || 'Team note',
                            getText: () => { try { return docEngine.text.toString() } catch { return '' } },
                            ytext: docEngine.text,
                        }]
                    }
                } catch (_e) { /* noop */ }
                return []
            },
        })
        inboxStore.init({
            getScan: () => taskScan.getScan(),
            getMyHandles: () => {
                const set = new Set()
                try {
                    for (const t of (p2pTeamManager ? p2pTeamManager.getTeams() : [])) {
                        const id = identity.getIdentity(t.teamId)
                        if (id && id.username) set.add(String(id.username).toLowerCase())
                    }
                } catch (_e) { /* noop */ }
                return set
            },
        })
        // Reflect inbox unread on the bottom utility badge.
        window.addEventListener('inbox:items-updated', (e) => {
            try {
                const n = (e && e.detail && e.detail.unread) || 0
                const badge = document.getElementById('inbox-unread-badge')
                if (badge) {
                    badge.textContent = n > 9 ? '9+' : String(n)
                    badge.style.display = n > 0 ? 'inline-flex' : 'none'
                }
            } catch (_e) { /* noop */ }
        })
        // Prime once so the badge + first surface open are warm.
        try { taskScan.requestScan() } catch (_e) { /* noop */ }
        try { Promise.resolve(inboxStore.getItems()).catch(() => {}) } catch (_e) { /* noop */ }
    } catch (e) { console.warn('[islands] derived-engine init failed:', e) }
}

async function init() {
  try {
    window.scrollTo(0, 0)
    document.documentElement.scrollLeft = 0
    document.body.scrollLeft = 0

    console.log('[Paperus] Init starting...')
    
    window.addEventListener('unhandledrejection', (event) => {
        if (isIndexedDbOpenError(event?.reason)) {
            window.__opusIndexedDbEnabled = false
            console.warn('[Main] Suppressed IndexedDB open rejection; persistence disabled for this session.')
            event.preventDefault()
        }
    })
    
    window.__opusIndexedDbEnabled = await probeIndexedDBHealth()
    if (!window.__opusIndexedDbEnabled) {
        console.warn('[Main] IndexedDB probe failed; running in memory-only mode for this session.')
    }
    
    // Local-first, no cloud account: the workspace defaults to "Personal".
    // A P2P team identity (Phase 4) updates this label when the user joins one.
    {
        const label = document.getElementById('workspace-label')
        const icon = document.getElementById('workspace-icon')
        if (label) label.textContent = 'Personal'
        if (icon) icon.textContent = 'P'
    }

    document.title = 'Paperus'
    
    const titleInput = document.getElementById('doc-title')
    const sizer = document.getElementById('doc-title-sizer')
    
    function resizeTitle() {
        sizer.textContent = titleInput.value || titleInput.placeholder
        titleInput.style.width = (sizer.offsetWidth + 2) + 'px'
    }
    
    titleInput.addEventListener('input', resizeTitle)
    titleInput.addEventListener('change', handleTitleChange)
    resizeTitle()
    
    // Initialize CodeMirror editor (empty — will be populated when a doc loads)
    const editorParent = document.getElementById('editor')
    cmView = createEditor(editorParent, { placeholder: 'Start writing...' })
    window.cmView = cmView
    console.log('[Paperus] CodeMirror 6 initialized')

    const headerRight = document.querySelector('.header-right')
    const shareBtn = document.createElement('button')
    shareBtn.className = 'btn-text' 
    shareBtn.id = 'share-btn'
    shareBtn.innerHTML = 'Share'
    shareBtn.style.fontWeight = '500'
    shareBtn.onclick = async () => {
        if (!docEngine) return alert('Open a document first')
        const title = document.getElementById('doc-title').value || 'Untitled'
        // Team note → emit a least-privilege share:v2 link (this note only),
        // never the team root key. Standalone docs use the v1 swarm flow.
        if (currentTeamNote && p2pTeamManager) {
            try {
                const link = await p2pTeamManager.noteShareLink(currentTeamNote.teamId, currentTeamNote.noteId)
                const share = await buildSharePayload(title, link, currentTeamNote.teamId)
                sharePopover.open(docEngine.docId, title, docEngine, { link, note: true, share })
                return
            } catch (err) { console.warn('[Share] team-note link failed, falling back', err) }
        }
        sharePopover.open(docEngine.docId, title, docEngine)
    }
    headerRight.appendChild(shareBtn)

    const favBtn = document.createElement('button')
    favBtn.className = 'icon-btn'
    favBtn.id = 'fav-btn'
    favBtn.title = 'Favorite'
    favBtn.innerHTML = '<i class="far fa-star"></i>'
    favBtn.onclick = () => {
        const icon = favBtn.querySelector('i')
        if (icon.classList.contains('far')) {
            icon.className = 'fas fa-star'
            icon.style.color = '#f0ad4e'
        } else {
            icon.className = 'far fa-star'
            icon.style.color = ''
        }
    }
    headerRight.appendChild(favBtn)
    
    const sidebar = document.getElementById('sidebar')
    const collapseBtn = document.getElementById('sidebar-collapse-btn')
    const expandBtn = document.getElementById('sidebar-expand-btn')
    const toggleSidebar = () => { sidebar.classList.toggle('collapsed') }
    if (collapseBtn) collapseBtn.addEventListener('click', toggleSidebar)
    if (expandBtn) expandBtn.addEventListener('click', toggleSidebar)
    
    // Special "view" tabs (Company Brain / Plugin Lab / Plugin Studio) get their
    // OWN tab in the bar instead of overlaying the active file tab. Their tab keys
    // are '@'-prefixed so they never collide with file paths; switching to one
    // routes to its show() instead of loadFileContent.
    const VIEW_TABS = {
        '@brain': { title: 'Company Brain', show: () => showCompanyBrainPage() },
        '@tasks': { title: 'Tasks', show: () => showReactSurfacePage('tasks-view', 'tasks') },
        '@calendar': { title: 'Calendar', show: () => showReactSurfacePage('calendar-view', 'calendar') },
        '@inbox': { title: 'Inbox', show: () => showReactSurfacePage('inbox-view', 'inbox') },
        '@email': { title: 'Email', show: () => showReactSurfacePage('email-view', 'email') },
    }
    tabManager = new TabManager(async (path) => {
        const view = VIEW_TABS[path]
        if (view) { view.show(); return }
        await loadFileContent(path)
    })
    tabManager.onEmptyState = showNoFileSelected
    tabManager.init(NewTabModal, createNewNote)
    
    openFile = async (path) => {
        const name = await window.api.basename(path)
        // Always open in its own tab. addTab dedupes — if the file is already open
        // it switches to that tab instead of creating a duplicate — and it drives
        // loadFileContent for us, so we never replace the current tab's document.
        tabManager.addTab(path, name)
    }
    
    sidebarManager = new SidebarManager({
        openFile: (path) => openFile(path),
        showHomePage: () => showNoFileSelected(),
        getIndexer: () => indexer,
        getContextMenu: () => contextMenu,
        getTeamManager: () => teamManager,
        getDocEngine: () => docEngine,
        getFavorites: () => favorites,
        getRecents: () => recentsManager,
        getTeamspaces: () => teamspacesManager,
        getTrash: () => trashManager
    })
    
    // Cloud, account-based teams (team.js) are removed in the open-source build.
    // teamManager stays null on purpose: every `if (teamManager)` branch below
    // becomes a no-op, so no sign-in / account / cloud-team modal can ever open.
    // Teams are pure P2P now — see P2PTeamManager + team-dialogs.js.
    teamManager = null
    historyManager = new HistoryManager()
    propertiesManager = new PropertiesManager()
    contextMenu = new ContextMenu()
    indexer = new Indexer()
    cmdPalette = new CommandPalette(indexer)
    notificationCenter = new NotificationCenter()
    companyBrainCenter = new CompanyBrainCenter({ openFile: (p) => openFile(p) })
    // Debug handle (also lets headless probes inspect agents/engine/tools).
    try { window.companyBrainCenter = companyBrainCenter } catch (_) { /* no-op */ }
    // Company Brain docked as a right-hand panel (the design's "chat on the
    // side"), reusing the same engine. Mounted as the 3rd column of .wrapper.
    aiDock = new AIDock({
        getBrain: () => companyBrainCenter,
        getDocContext: () => {
            const t = document.getElementById('doc-title')
            const v = t && t.value ? t.value.trim() : ''
            return v ? { label: v } : null
        },
        onToggle: (isOpen) => {
            const btn = document.getElementById('ai-dock-toggle')
            if (btn) btn.classList.toggle('is-active', isOpen)
        },
    })
    {
        const wrapper = document.querySelector('.wrapper')
        if (wrapper) aiDock.mount(wrapper)
        const toggleBtn = document.getElementById('ai-dock-toggle')
        if (toggleBtn) toggleBtn.addEventListener('click', () => aiDock.toggle())
        setupSidebarResizer()
    }
    moreMenu = new MoreMenu(docEngine)
    {
        const editorContainer = document.querySelector('.editor-container')
        if (editorContainer) {
            backlinksPanel = new BacklinksPanel(editorContainer, { openFile: (p) => openFile(p) })
            pageHeader = new PageHeader(editorContainer, { getEngine: () => docEngine })
        }
    }
    templatePicker = new TemplatePicker({
        getView: () => cmView,
        getCurrentMarkdown: () => (docEngine ? docEngine.text.toString() : (cmView ? cmView.state.doc.toString() : '')),
        getCurrentTitle: () => (document.getElementById('doc-title')?.value || 'Template')
    })

    // Favorites / Recents (Notion-style workspace features). Page-level
    // full-width / lock toggles live in the single header "•••" MoreMenu.
    favorites = new Favorites()
    recentsManager = new Recents()
    await favorites.load().catch(() => {})
    await recentsManager.load().catch(() => {})

    // Export / Import (additive). ExportMenu reads the live markdown + title;
    // ImportManager reuses createNewNote for Markdown import and the active
    // CodeMirror view / DocumentEngine for CSV -> database insertion.
    exportMenu = new ExportMenu({
        getMarkdown: () => (docEngine ? docEngine.text.toString() : (cmView ? cmView.state.doc.toString() : '')),
        getTitle: () => (document.getElementById('doc-title')?.value || 'document')
    })
    importManager = new ImportManager({
        getCmView: () => cmView,
        getDocEngine: () => docEngine,
        createNote: (content) => createNewNote(content)
    })

    // Trash (soft-delete) + Teamspaces (local-first sidebar groupings).
    // Both persist via window.api.setSettings and degrade gracefully on web.
    trashManager = new TrashManager({
        getProjectRoot: async () => Store.projectPath || (await window.api.getSettings('knownProjects').catch(() => null) || [])[0] || null,
        reloadProject: async () => { await loadProject(null) }
    })
    await trashManager.load().catch(() => {})
    teamspacesManager = new TeamspacesManager({
        openFile: (p) => openFile(p),
        reloadProject: async () => { await loadProject(null) }
    })
    await teamspacesManager.load().catch(() => {})

    // Zero-account, pure-P2P teams. Reconnects any joined teams from local
    // settings, then renders them into the "Teams" sidebar section.
    p2pTeamManager = new P2PTeamManager()
    window.p2pTeamManager = p2pTeamManager
    // Wire Tasks/Calendar/Inbox derived-data engines now that managers exist.
    initDerivedEngines()
    // Capture whether we were launched from an invite/share link BEFORE
    // handleP2PDeepLink() strips it from the address bar — first-run onboarding
    // must stand down when a deep link is driving the session.
    const hadDeepLink = typeof window !== 'undefined' && !!(window.location && (window.location.hash || window.location.search))
    p2pTeamManager.init()
        .then(() => { renderP2PTeams(); handleP2PDeepLink(); maybeFirstRunOnboarding(hadDeepLink) })
        .catch((e) => console.warn('[Main] P2P team init failed', e))

    // Sandboxed plugin system: app.innerHTML exists and window.p2pTeamManager is
    // set, so it's safe to init the host now. Fully gated + defensive — a broken
    // plugin can never prevent the app from starting (errors are swallowed).
    if (Features.plugins) {
        initPlugins().catch((e) => console.warn('[plugins] initPlugins rejected (app continues):', e))
    }

    // Apply persisted editor font/appearance on startup (CSS variables on :root).
    await loadEditorFont().catch(() => {})
    applyEditorFont()

    // @date reminder watcher (self-mounts, degrades gracefully; web + Electron).
    try { initReminderWatcher() } catch (e) { console.warn('reminder watcher init failed', e) }

    // Mount an unobtrusive Export trigger into the header (next to Share/Star).
    {
        const headerRightEl = document.getElementById('header-right') || document.querySelector('.header-right')
        if (headerRightEl && !document.getElementById('export-btn')) {
            const exportBtn = document.createElement('button')
            exportBtn.className = 'icon-btn'
            exportBtn.id = 'export-btn'
            exportBtn.title = 'Export / Import'
            exportBtn.innerHTML = '<i class="fas fa-file-export"></i>'
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                window.dispatchEvent(new CustomEvent('cmd:export', { detail: { anchor: exportBtn } }))
            })
            headerRightEl.appendChild(exportBtn)
        }
    }

    // Wire the existing header star button to real, persisted favorites.
    // Additive: the original inline onclick does a visual flip; this listener
    // persists the change and re-syncs the icon to the authoritative state.
    {
        const favBtnEl = document.getElementById('fav-btn')
        if (favBtnEl) {
            favBtnEl.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('cmd:toggle-favorite'))
            })
        }
    }

    // Kick off background git auto-sync if the user enabled it.
    import('./git-autosync').then(m => m.startAutoSync()).catch(() => {})
    if (ENABLE_AI_HOME) {
      aiHome = new AIHome({
        getIndexNodes: () => (indexer && Array.isArray(indexer.index)) ? indexer.index : [],
        openFile: (path) => openFile(path)
      })
    } else {
      aiHome = null
    }

    setInterval(updateHeaderMeta, 30000);

    const debouncedUpdateHeaderMeta = () => {
        clearTimeout(window._headerMetaTimer);
        window._headerMetaTimer = setTimeout(() => updateHeaderMeta(), 500);
    };
    
    window.addEventListener('presence:update', () => {
        debouncedUpdateHeaderMeta();
    });

    setInterval(updateClock, 1000)
    updateClock()

    const homeBtn = document.getElementById('home-btn')
    if (homeBtn) {
        homeBtn.addEventListener('click', async () => {
            if (teamManager && teamManager.isOpen) teamManager.close()
            if (ENABLE_AI_HOME) showHomePage()
            else showNoFileSelected()
        })
    }

    const accountBtn = document.getElementById('account-btn')
    if (accountBtn) {
        accountBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            renderWorkspacePopover()
        })
    }
    
    const searchBtn = document.getElementById('search-btn')
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            if (cmdPalette) cmdPalette.open()
        })
    }
    
    const inboxBtn = document.getElementById('inbox-btn')
    if (inboxBtn) {
        inboxBtn.addEventListener('click', () => {
            tabManager.addTab('@inbox', 'Inbox')
        })
    }

    // Chat (rail) + New chat (footer) + the Chat-view agent all open Company Brain.
    const openBrain = () => tabManager.addTab('@brain', 'Company Brain')
    const chatBtn = document.getElementById('chat-btn')
    if (chatBtn) chatBtn.addEventListener('click', openBrain)
    const newchatBtn = document.getElementById('newchat-btn')
    if (newchatBtn) newchatBtn.addEventListener('click', openBrain)
    const chatNewThread = document.getElementById('chat-new-thread')
    if (chatNewThread) chatNewThread.addEventListener('click', () => { openBrain(); if (companyBrainCenter) companyBrainCenter.newThread() })
    const composeBtn = document.getElementById('sidebar-compose-btn')
    if (composeBtn) composeBtn.addEventListener('click', () => { void createNewNote() })

    const tasksBtn = document.getElementById('tasks-btn')
    if (tasksBtn) tasksBtn.addEventListener('click', () => { tabManager.addTab('@tasks', 'Tasks') })

    const calendarBtn = document.getElementById('calendar-btn')
    if (calendarBtn) calendarBtn.addEventListener('click', () => { tabManager.addTab('@calendar', 'Calendar') })
    const calNewEvent = document.getElementById('cal-new-event')
    if (calNewEvent) calNewEvent.addEventListener('click', () => { tabManager.addTab('@calendar', 'Calendar') })
    // Connect an external (CalDAV) calendar account — open the Calendar surface,
    // which hosts the account wizard, and ask it to open via calendar:cmd.
    const calAddAccount = document.getElementById('cal-add-account')
    if (calAddAccount) {
        calAddAccount.addEventListener('click', () => {
            window.__calCmd = { type: 'add-account' } // cold-open intent if the surface isn't mounted yet
            tabManager.addTab('@calendar', 'Calendar')
            window.dispatchEvent(new CustomEvent('calendar:cmd', { detail: { type: 'add-account' } }))
        })
    }

    const emailBtn = document.getElementById('email-btn')
    if (emailBtn) emailBtn.addEventListener('click', () => { tabManager.addTab('@email', 'Email') })

    // The Mail (Inbox) sidebar nav — Compose, account switcher and real folders —
    // is painted by renderMailNav() into #sb-mail-nav from the Email surface's
    // published email:nav-state, and its clicks dispatch email:cmd back. (Wiring
    // lives with renderMailNav near the other contextual-sidebar renderers.)

    // App rail: the clicked app expands to show its label AND swaps the contextual
    // nav panel below (Home / Chat / Calendar / Inbox). `.is-active` is its own
    // class so it never collides with the tree/doc `.active` selection.
    const appnav = document.getElementById('appnav')
    if (appnav) {
        appnav.addEventListener('click', (e) => {
            const btn = e.target.closest('.appnav-btn')
            if (!btn || btn.classList.contains('appnav-btn--ghost')) return
            appnav.querySelectorAll('.appnav-btn').forEach((b) => b.classList.remove('is-active'))
            btn.classList.add('is-active')
            if (btn.dataset.view) setSidebarView(btn.dataset.view)
        })
    }

    const graphBtn = document.getElementById('graph-btn')
    if (graphBtn) {
        graphBtn.addEventListener('click', () => openGraphView())
    }

    // Global shortcuts for the quick features. Capture phase + stopImmediate so a
    // claimed combo (e.g. ⌘⇧G) wins over CodeMirror's own keymap (find-previous).
    document.addEventListener('keydown', (e) => {
        if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
        const k = e.key.toLowerCase()
        if (k === 'd') {
            e.preventDefault(); e.stopImmediatePropagation()
            void openTodaysDailyNote()
        } else if (k === 'g') {
            e.preventDefault(); e.stopImmediatePropagation()
            if (graphView && graphView.isOpen()) graphView.close()
            else openGraphView()
        } else if (k === 'f' && cmView) {
            e.preventDefault(); e.stopImmediatePropagation()
            const on = toggleFocusMode(cmView)
            flashHint(on ? 'Focus mode on' : 'Focus mode off')
        }
    }, true)

    // ⌘J / Ctrl-J toggles the Company Brain side dock.
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
            e.preventDefault(); e.stopImmediatePropagation()
            if (aiDock) aiDock.toggle()
        }
    }, true)

    // Free a React-island surface's root + listeners when its tab closes.
    tabManager.onTabClose = (path) => {
        const map = { '@tasks': 'tasks-view', '@calendar': 'calendar-view', '@inbox': 'inbox-view', '@email': 'email-view' }
        const vid = map[path]
        if (vid) { const el = document.getElementById(vid); if (el) { try { unmountReactSurface(el) } catch (_e) { /* noop */ } } }
    }

    const trashBtn = document.getElementById('trash-btn')
    if (trashBtn) {
        trashBtn.addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('cmd:open-trash'))
        })
    }
    
    const addBtn = document.getElementById('add-btn')
    if (addBtn) {
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            void createNewNote()
        })
    }

    const addFolderBtn = document.getElementById('add-folder-btn')
    if (addFolderBtn) {
        addFolderBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            void openProject()
        })
    }

    const importBtn = document.getElementById('import-btn')
    if (importBtn) {
        importBtn.addEventListener('click', async (e) => {
            e.stopPropagation()
            const result = await window.api.invoke('dialog:showOpenDialog', {
                properties: ['openFile', 'multiSelections'],
                filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
            })
            if (!result.canceled && result.filePaths.length > 0) {
                const currentPath = Store.projectPath || (await window.api.getSettings('knownProjects'))[0]
                if (!currentPath) return alert('No project open')
                for (const filePath of result.filePaths) {
                    try {
                        const content = await window.api.readFile(filePath)
                        const name = await window.api.basename(filePath)
                        let newPath = `${currentPath}/${name}`
                        if (await window.api.pathExists(newPath)) {
                            const namePart = name.replace(/\.[^/.]+$/, "")
                            const ext = await window.api.extname(name)
                            newPath = `${currentPath}/${namePart}_imported${ext}`
                        }
                        await window.api.writeFile(newPath, content)
                    } catch (err) { console.error('Import failed for', filePath, err) }
                }
                await loadProject(null)
            }
        })
    }

    const createTeamBtn = document.getElementById('create-team-btn')
    if (createTeamBtn) {
        createTeamBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            window.dispatchEvent(new CustomEvent('cmd:create-team'))
        })
    }

    const joinTeamBtn = document.getElementById('join-team-btn')
    if (joinTeamBtn) {
        joinTeamBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            window.dispatchEvent(new CustomEvent('cmd:join-team'))
        })
    }

    const linkDeviceBtn = document.getElementById('link-device-btn')
    if (linkDeviceBtn) {
        linkDeviceBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            window.dispatchEvent(new CustomEvent('cmd:link-device'))
        })
    }

    // Team-managed server: point the app at the team's own self-hosted relay
    // (signaling + optional always-on sync) at runtime — no rebuild, and once
    // connected nothing depends on Naridon. See server-config.js.
    const teamServerBtn = document.getElementById('team-server-btn')
    if (teamServerBtn) {
        teamServerBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            openServerDialog()
        })
    }

    // If a server connect/disconnect just reloaded the app, flash a one-shot
    // confirmation toast so the switch doesn't feel silent. See server-config.js.
    flashConnectToastIfPending()

    window.addEventListener('cmd:properties', () => {
        const activeItem = document.querySelector('.tree-item.active')
        if (activeItem) propertiesManager.open(activeItem.dataset.path)
        else alert('Select a file to view properties')
    })

    window.addEventListener('cmd:history', () => {
        const activeItem = document.querySelector('.tree-item.active')
        if (activeItem && docEngine) historyManager.open(activeItem.dataset.path, docEngine.docId, docEngine.text.toString())
        else alert('Select a file first')
    })
    
    window.addEventListener('restore-version', async (e) => {
      if (docEngine) {
        try {
          await docEngine.snapshots.restoreSnapshotWithKey(e.detail.snapshotId, e.detail.key)
          await saveCurrentFile() 
          alert('Version restored successfully.')
        } catch (err) { alert('Restore failed: ' + err.message) }
      }
    })

    window.addEventListener('ctx:new-note', async (e) => {
        activeDirectory = e.detail
        await createNewNote()
        activeDirectory = null
    })
    
    window.addEventListener('ctx:refresh', async () => { await loadProject(null) })
    
    window.addEventListener('cmd:open-file', (e) => {
        if (teamManager && teamManager.isOpen) teamManager.close()
        openFile(e.detail)
    })

    // Toggle favorite for the currently open document (local path or cloud docId).
    window.addEventListener('cmd:toggle-favorite', async () => {
        if (!favorites) return
        const item = getCurrentDocFavItem()
        if (!item) { alert('Open a document first to favorite it.'); return }
        const nowFav = await favorites.toggle(item)
        updateFavButtonState()
        if (sidebarManager && sidebarManager.renderFavorites) await sidebarManager.renderFavorites()
        const statusEl = document.getElementById('file-status')
        if (statusEl) {
            const prev = statusEl.textContent
            statusEl.textContent = nowFav ? 'Added to favorites' : 'Removed from favorites'
            setTimeout(() => { statusEl.textContent = prev }, 1500)
        }
    })

    // A favorite was removed from the sidebar — keep the header star in sync.
    window.addEventListener('favorites:changed', () => {
        updateFavButtonState()
    })

    // Open the Export popover (Markdown / HTML / PDF) for the current document.
    window.addEventListener('cmd:export', (e) => {
        if (!exportMenu) return
        const anchor = (e.detail && e.detail.anchor) || document.getElementById('export-btn')
        exportMenu.open(anchor)
    })

    // Open the Import popover (CSV -> database / Markdown -> note).
    window.addEventListener('cmd:import', (e) => {
        if (!importManager) return
        const anchor = (e.detail && e.detail.anchor) || document.getElementById('export-btn')
        importManager.open(anchor)
    })

    // Record an opened doc into Recents (and refresh the sidebar Recent section).
    window.addEventListener('cmd:opened-doc', async (e) => {
        if (!recentsManager) return
        const item = e.detail
        if (!item || (!item.path && !item.docId)) return
        await recentsManager.push(item)
        if (sidebarManager && sidebarManager.renderRecents) await sidebarManager.renderRecents()
        updateFavButtonState()
    })

    // Clicking a page-link chip ([Title](doc:id) or [[Wiki Title]]) → open it.
    window.addEventListener('cmd:open-page', async (e) => {
        const target = e.detail || {}
        if (teamManager && teamManager.isOpen) teamManager.close()
        try {
            if (target.kind === 'doc' && target.value) {
                const p = await window.api.invoke('fs:getPathByDocId', target.value).catch(() => null)
                if (p) { openFile(p); return }
                // Fall back to cloud open by docId.
                window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: { id: target.value, name: target.title } }))
                return
            }
            if (target.kind === 'wiki' && target.value) {
                const existing = await resolveWikiTitle(target.value)
                if (existing) { openFile(existing); return }
                // Obsidian-style: create the page on first click.
                await createPageWithTitle(target.value)
            }
        } catch (err) {
            console.warn('[Main] open-page failed:', err)
        }
    })
    
    window.addEventListener('cmd:open-cloud-doc', async (e) => {
        const detail = e.detail
        const docId = typeof detail === 'object' ? detail.id : detail
        
        // Try to get name from detail, or lookup from sidebar, or fallback
        let docName = typeof detail === 'object' ? detail.name : null
        if (!docName) {
            const docEl = document.querySelector(`[data-doc-id="${docId}"] .doc-name-label`);
            if (docEl) docName = docEl.textContent;
        }
        if (!docName) docName = 'Cloud Document';
        
        console.log('[Main] Opening cloud doc:', docId, docName);
        hideNoFileSelected();

        if (docEngine && docEngine.docId === docId) {
             console.log('[Main] Cloud doc already open, updating selection');
             sidebarManager.updateSelection('cloud', docId);
             
             // Refresh UI state for the already open doc
             const metadata = docEngine.doc.getMap('metadata');
             const name = metadata.get('filename') || docName;
             const cleanName = name.replace(/\.md$/, '').replace(/_/g, ' ');
             document.getElementById('doc-title').value = cleanName;
             
             updateHeaderMeta();
             ensureH1Title(cleanName);
             return
        }

        // --- 1. PREPARE UI & LOCK PROJECTION ---
        window.isUpdatingFromYjs = true;

        if (projectionManager) {
            console.log('[Main] Destroying old projection manager');
            projectionManager.destroy();
            projectionManager = null;
        }
        
        document.getElementById('doc-title').value = docName;
        document.getElementById('file-status').textContent = docName;
        window.api.setSettings('lastOpenedFile', `cloud:${docId}:${encodeURIComponent(docName)}`);
        
        if (tabManager) {
            tabManager.updateCurrentTab(`cloud:${docId}`, docName);
        }
        
        sidebarManager.updateSelection('cloud', docId);
        await updateHeaderMeta();
        
        if (teamManager && teamManager.isOpen) teamManager.close();
        if (docEngine) {
            console.log('[Main] Destroying old engine');
            docEngine.destroy();
        }
        
        // --- 2. ENGINE SETUP ---
        docEngine = new DocumentEngine(docId);
        
        // Fetch E2EE metadata
        let encryptedReadyForSync = true
        setE2EELockedState(false)
        try {
            const metadata = await authClient.getDocumentMetadata(docId).catch(() => null);
            if (metadata && metadata.isEncrypted) {
                console.log('[Main] Document is E2EE encrypted, unlocking...');
                const perms = await authClient.getDocumentPermissions(docId);
                const myPerm = perms.find(p => p.userId === authClient.user?.id);
                
                if (myPerm && myPerm.wrappedKey) {
                    if (!authClient.e2ee.privateKey) {
                        encryptedReadyForSync = false
                        // Vault is locked, need password
                        const needsUnlock = confirm('This document is encrypted. Unlock your Vault to view it. Cloud sync is blocked until unlocked.');
                        if (needsUnlock && teamManager) {
                            teamManager.open();
                            teamManager.currentSection = 'account';
                            teamManager.updateView();
                        }
                        setE2EELockedState(true)
                    } else {
                        const docKey = await e2eeManager.unwrapDocumentKey(
                            myPerm.wrappedKey,
                            authClient.e2ee.publicKey,
                            authClient.e2ee.privateKey
                        );
                        await docEngine.setupE2EE(docKey);
                        setE2EELockedState(false)
                    }
                } else if (metadata.createdBy === authClient.user?.id) {
                    // Owner but no permission record? (Shouldn't happen with current backend)
                    console.warn('[Main] Owner has no wrapped key for encrypted doc');
                    encryptedReadyForSync = false
                    setE2EELockedState(true, 'Encrypted doc is missing your key envelope')
                }
            }
        } catch (e) { console.error('[Main] E2EE initialization failed:', e); }

        docEngine.presence.bind();

        // Set user for presence
        if (authClient.user) {
            docEngine.presence.setUser({
                id: authClient.user.id,
                name: authClient.user.displayName || authClient.user.email.split('@')[0],
                email: authClient.user.email,
                color: docEngine.presence.generateColor(authClient.user.email)
            });
        }

        if (moreMenu) moreMenu.docEngine = docEngine;
        
        if (teamManager) {
            teamManager.engine = docEngine;
            if (encryptedReadyForSync) {
                await teamManager.connect();
            } else {
                console.warn('[Main] Skipping cloud connection: encrypted document is not unlocked');
            }
            
            // Re-broadcast user state after cloud connection
            if (authClient.user && encryptedReadyForSync) {
                docEngine.presence.setUser({
                    id: authClient.user.id,
                    name: authClient.user.displayName || authClient.user.email.split('@')[0],
                    email: authClient.user.email,
                    color: docEngine.presence.generateColor(authClient.user.email)
                });
            }
            teamManager.close();
        }
        
        const yText = docEngine.text;

       // --- 3. SYNC LOGIC ---
       docEngine.whenSynced().then(async () => {
            const rawContentSync = yText.toString();
            console.log('[Main] Yjs synced, length:', rawContentSync.length);

            // Recreate CodeMirror with yCollab binding
            rebindEditor(yText, docEngine);
            console.log('[Main] yCollab binding active for cloud doc');

             // Unlock projection
             window.isUpdatingFromYjs = false;

             // Reflect favorite state and record into Recents (cloud doc).
             updateFavButtonState();
             window.dispatchEvent(new CustomEvent('cmd:opened-doc', { detail: { type: 'cloud', docId, name: docName } }));

             // Sync Title from Metadata
             const metadata = docEngine.getMap ? docEngine.getMap('metadata') : docEngine.doc.getMap('metadata');
             const syncTitle = async (event) => {
                 if (window.isUpdatingFromYjs) return;
                 const name = metadata.get('filename') || docName;
                 const cleanName = name.replace(/\.md$/, '').replace(/_/g, ' ');

                 const currentInput = document.getElementById('doc-title').value;
                 if (currentInput !== cleanName) {
                     document.getElementById('doc-title').value = cleanName;
                     document.getElementById('file-status').textContent = cleanName;

                     if (event && event.transaction.origin !== 'user-rename' && event.transaction.origin !== 'sync-from-h1') {
                         await renameFile(name);
                     }
                 }

                 if (event) {
                     await ensureH1Title(cleanName);
                 }
             };
             metadata.observe(syncTitle);
             syncTitle();
        });
    });
    
    // Join an accountless shared document over P2P (share-via-link/room code).
    // The share code IS the swarm key — no cloud, no account required.
    // Join an accountless shared document over P2P. Accepts either a parsed
    // share token { version, ... } (from the sidebar) or a raw { code } (legacy).
    //   v1: swarm-password share — code is the swarm key, no AEAD.
    //   v2: least-privilege E2EE note share — carries swarm key + E2EE key.
    // Both route through the openP2PDoc chokepoint so encrypted shares bind the
    // WebRTC provider to the transport doc (R1).
    window.addEventListener('cmd:join-shared-room', async (e) => {
        const detail = e.detail || {}
        let token = detail.token
        if (!token && detail.code) token = { version: 1, code: detail.code }
        if (!token) return

        let docId; let swarmKey; let e2eeKey; let tabKey
        if (token.version === 2) {
            swarmKey = token.swarmKey; e2eeKey = token.e2eeKey
            docId = `shared-${String(swarmKey).slice(0, 16)}`
            tabKey = `shared:v2:${String(swarmKey).slice(0, 8)}`
        } else {
            swarmKey = token.code; e2eeKey = null
            docId = `shared-${swarmKey}`
            tabKey = `shared:${swarmKey}`
        }
        const docName = detail.name || detail.title || 'Shared Document'
        console.log('[Main] Joining shared room (P2P), v' + (token.version || 1))
        hideNoFileSelected()

        if (docEngine && docEngine.docId === docId) {
            sidebarManager.updateSelection('cloud', docId)
            return
        }

        const guest = { id: `guest-${String(swarmKey).slice(0, 6)}`, name: 'Guest', color: '', email: '' }
        const engine = await openP2PDoc({ docId, swarmKey, e2eeKey, identity: guest })
        mountP2PEngineInEditor(engine, { docName, tabKey })
    })

    // ── Zero-account P2P teams ──────────────────────────────────────────────────

    window.addEventListener('cmd:create-team', () => {
        if (p2pTeamManager) openCreateTeamDialog(p2pTeamManager)
    })

    window.addEventListener('cmd:join-team', async (e) => {
        if (!p2pTeamManager) return
        const rootKey = e.detail && e.detail.rootKey
        if (rootKey) {
            // Came from a parsed link/deep-link: join immediately, then claim identity.
            try {
                const { teamId } = await p2pTeamManager.joinTeam(rootKey)
                renderP2PTeams()
                openClaimDialog(p2pTeamManager, teamId, {})
            } catch (err) {
                alert('Could not join team: ' + (err.message || err))
            }
        } else {
            openJoinTeamDialog(p2pTeamManager)
        }
    })

    // Desktop "Link a device" (parent side): mint a pairing payload for a team and
    // hand it to a phone. Lazily imported so the dialog never touches startup.
    window.addEventListener('cmd:link-device', async (e) => {
        if (!p2pTeamManager) return
        const teamId = e.detail && e.detail.teamId
        try {
            const { openDeviceLinkDialog } = await import('./device-link-dialog')
            openDeviceLinkDialog(p2pTeamManager, teamId)
        } catch (err) {
            console.warn('[link-device] could not open device link dialog', err)
        }
    })

    window.addEventListener('cmd:open-team', (e) => {
        const teamId = e.detail && e.detail.teamId
        if (teamId && p2pTeamManager) openRosterDialog(p2pTeamManager, teamId)
    })

    window.addEventListener('cmd:copy-team-link', async (e) => {
        const teamId = e.detail && e.detail.teamId
        if (teamId && p2pTeamManager) openInviteDialog(p2pTeamManager, teamId)
    })

    window.addEventListener('cmd:open-team-note', async (e) => {
        const { teamId, noteId } = (e.detail || {})
        if (teamId && noteId) await openTeamNote(teamId, noteId)
    })

    // A restricted note the current member can't decrypt. Its ciphertext still
    // replicates locally (availability), but there's no key to open it as an editor.
    window.addEventListener('cmd:note-no-access', (e) => {
        const { teamId, noteId } = (e.detail || {})
        alert('This note is restricted — you don’t have the key to read it.\n\n'
            + 'It still syncs in the background so the team keeps a copy, but you can’t open it. '
            + 'Ask a member who has access to grant you.')
        if (teamId && noteId && p2pTeamManager) openNoteAccessDialog(p2pTeamManager, teamId, noteId)
    })

    // Resolve the data needed to seal a note to a contact's inbox: the note's
    // swarm + e2ee keys (from its share:v2 link) plus my identity (sender label).
    async function buildSharePayload(title, link, teamId) {
        try {
            const { parseShareToken } = await import('./p2p')
            const token = parseShareToken(link)
            if (!token || token.version !== 2) return null
            const me = teamId ? identity.getIdentity(teamId) : null
            return {
                title: title || 'Untitled',
                swarmKey: token.swarmKey,
                e2eeKey: token.e2eeKey,
                fromName: me ? me.displayName : '',
                fromPub: me ? me.publicKey : '',
            }
        } catch (_e) { return null }
    }

    // A contact sealed a note straight into my inbox → toast with Open/Dismiss.
    // Accepting is exactly opening a share:v2 (the offer carries swarm + e2ee keys).
    function showOfferToast(offer) {
        if (!offer) return
        const who = offer.fromName ? `${offer.fromName} shared` : 'Someone shared'
        const toast = document.createElement('div')
        toast.className = 'offer-toast'

        const body = document.createElement('div')
        body.className = 'offer-toast-body'
        const ic = document.createElement('i'); ic.className = 'fas fa-inbox'
        const text = document.createElement('div'); text.className = 'offer-toast-text'
        const strong = document.createElement('strong'); strong.textContent = who
        const span = document.createElement('span'); span.textContent = offer.title || 'a note'
        text.append(strong, span)
        body.append(ic, text)

        const actions = document.createElement('div')
        actions.className = 'offer-toast-actions'
        const openBtn = document.createElement('button'); openBtn.className = 'offer-open'; openBtn.textContent = 'Open'
        const dismissBtn = document.createElement('button'); dismissBtn.className = 'offer-dismiss'; dismissBtn.title = 'Dismiss'; dismissBtn.textContent = '×'
        actions.append(openBtn, dismissBtn)

        toast.append(body, actions)
        let stack = document.getElementById('offer-toast-stack')
        if (!stack) { stack = document.createElement('div'); stack.id = 'offer-toast-stack'; document.body.appendChild(stack) }
        stack.appendChild(toast)

        const close = () => { try { toast.remove() } catch (_e) {} }
        // Open / Dismiss are terminal actions → consume the persisted offer so it
        // doesn't resurface on the next launch. Auto-close (timeout) leaves it
        // pending so an unseen offer comes back next boot.
        openBtn.onclick = () => {
            window.dispatchEvent(new CustomEvent('cmd:join-shared-room', {
                detail: { token: { version: 2, swarmKey: offer.swarmKey, e2eeKey: offer.e2eeKey }, name: offer.title },
            }))
            if (offer.id) removeReceivedOffer(offer.id)
            close()
        }
        dismissBtn.onclick = () => { if (offer.id) removeReceivedOffer(offer.id); close() }
        setTimeout(close, 15000)
    }

    // Re-render the Teams sidebar section whenever team state changes.
    window.addEventListener('team:list-updated', () => renderP2PTeams())
    window.addEventListener('team:tree-updated', () => renderP2PTeams())

    // ── Contacts book + sealed inbox ────────────────────────────────────────────
    // Every roster we see feeds the global address book; my own identity opens its
    // P2P inbox so contacts can share a note directly with me (no link copy).
    window.addEventListener('team:roster-updated', (e) => {
        renderP2PTeams()
        const { teamId, members } = (e.detail || {})
        if (teamId && members) contactStore.recordRosterMembers(teamId, members)
    })
    window.addEventListener('team:identity-ready', (e) => {
        renderP2PTeams()
        const teamId = e.detail && e.detail.teamId
        if (!teamId) return
        const me = identity.getIdentity(teamId)
        if (!me || !me.publicKey || !me.privateKey) return
        contactStore.markSelf(me.publicKey)
        startInbox(me, (offer) => showOfferToast(offer)).catch((err) => console.warn('[Inbox] start failed', err))
    })
    // Re-surface any offers received while we were away (toast only fires for
    // *new* arrivals; these persisted and were never opened/dismissed).
    setTimeout(() => {
        getReceivedOffers().then((list) => { (list || []).forEach((o) => showOfferToast(o)) }).catch(() => {})
    }, 2500)
    // Refresh the online-for-sync dot as peers connect/drop (throttled — these fire often).
    let _syncDotTimer = null
    window.addEventListener('sync:status', () => {
        if (_syncDotTimer) return
        _syncDotTimer = setTimeout(() => { _syncDotTimer = null; renderP2PTeams() }, 800)
    })

    window.addEventListener('cmd:share-file', async (e) => {
        if (!docEngine) return alert('Please open a document first.')
        if (currentTeamNote && p2pTeamManager) {
            try {
                const link = await p2pTeamManager.noteShareLink(currentTeamNote.teamId, currentTeamNote.noteId)
                const share = await buildSharePayload(e.detail, link, currentTeamNote.teamId)
                sharePopover.open(docEngine.docId, e.detail, docEngine, { link, note: true, share })
                return
            } catch (err) { console.warn('[Share] team-note link failed, falling back', err) }
        }
        sharePopover.open(docEngine.docId, e.detail, docEngine)
    })
    
    window.addEventListener('cmd:connect-cloud', async () => {
        if (e2eeReadOnlyLocked) {
            console.warn('[Main] Blocked cloud connect: encrypted doc is locked')
            return
        }
        // Tag this doc as cloud-backed so future opens always connect
        if (docEngine) {
            window.api.invoke('fs:tagCloudDoc', docEngine.docId).catch(() => {})
        }
        if (teamManager && teamManager.engine) await teamManager.connect()
        else if (docEngine && teamManager) {
             teamManager.engine = docEngine
             await teamManager.connect()
        }
    })
    
    window.addEventListener('cmd:open-team-manager', () => { if (teamManager) teamManager.open() })
    
    window.addEventListener('e2ee:unlocked', async () => {
        if (!docEngine || !authClient?.user || !authClient?.e2ee?.privateKey) return
        if (docEngine.isEncrypted) {
            setE2EELockedState(false)
            return
        }
        try {
            const metadata = await authClient.getDocumentMetadata(docEngine.docId).catch(() => null)
            if (!metadata || !metadata.isEncrypted) {
                setE2EELockedState(false)
                return
            }
            const perms = await authClient.getDocumentPermissions(docEngine.docId)
            const myPerm = perms.find(p => p.userId === authClient.user?.id)
            if (!myPerm || !myPerm.wrappedKey) return
            const docKey = await e2eeManager.unwrapDocumentKey(
                myPerm.wrappedKey,
                authClient.e2ee.publicKey,
                authClient.e2ee.privateKey
            )
            await docEngine.setupE2EE(docKey)
            setE2EELockedState(false)
            if (teamManager) {
                teamManager.engine = docEngine
                await teamManager.connect()
            }
        } catch (e) {
            console.error('[Main] Failed to activate E2EE after unlock:', e)
        }
    })

    window.addEventListener('cmd:reset-formatting', async (e) => {
        if (!docEngine) return;
        // In native markdown mode, "reset formatting" is a no-op since content IS markdown
        console.log('[Main] Reset formatting requested — native markdown mode, no conversion needed');
        alert('Document is already in native markdown format.');
    })

    window.addEventListener('cmd:copy-link', async () => {
        if (!docEngine) return alert('Open a note first.')
        let link
        if (currentTeamNote && p2pTeamManager) {
            // Team note → least-privilege share:v2 link.
            try { link = await p2pTeamManager.noteShareLink(currentTeamNote.teamId, currentTeamNote.noteId) } catch (_e) { /* fall through */ }
        }
        if (!link) {
            // Standalone doc → mint/reuse a v1 swarm share code and bind it.
            try {
                const { generateRoomCode, buildShareLink } = await import('./p2p')
                if (!docEngine._shareCode) {
                    docEngine._shareCode = generateRoomCode()
                    docEngine.connectP2P(docEngine._shareCode)
                }
                link = buildShareLink(docEngine._shareCode)
            } catch (err) { console.warn('[Main] copy-link failed', err); return }
        }
        try { await navigator.clipboard.writeText(link) } catch (_e) {}
        alert('Link copied')
    })
    
    window.addEventListener('cmd:duplicate-file', async () => {
        if (!docEngine) return
        const content = docEngine.text.toString()
        let newContent = content
        const match = content.match(/^# (.*)(\n|$)/)
        if (match) newContent = content.replace(match[0], `# ${match[1]} (Copy)\n`)
        else newContent = `# Copy of Untitled\n${content}`
        await createNewNote(newContent) 
    })
    
    window.addEventListener('cmd:trash-file', async (e) => {
        // Prefer an explicit path from the event detail (context menu), else the
        // selected tree item, else the currently open local file.
        const explicit = e && e.detail && (typeof e.detail === 'string' ? e.detail : e.detail.path)
        const activeItem = document.querySelector('.tree-item.active')
        const targetPath = explicit
            || (activeItem && activeItem.dataset.path)
            || (currentOpenPath && !String(currentOpenPath).startsWith('cloud:') ? currentOpenPath : null)
        if (!targetPath) return
        if (!confirm('Move to trash?')) return
        // Soft-delete: move into .trash/ and record an undoable entry. Falls back
        // to the legacy hard-delete (OS trash) only if the soft-delete path fails.
        let moved = null
        if (trashManager) moved = await trashManager.trashFile(targetPath).catch(() => null)
        if (!moved) {
            await window.api.invoke('fs:delete', targetPath)
        }
        await loadProject(null)
        showNoFileSelected()
    })

    // Open the Trash view (soft-deleted items with Restore / Delete permanently).
    window.addEventListener('cmd:open-trash', async () => {
        if (!trashManager) return
        if (teamManager && teamManager.isOpen) teamManager.close()
        await trashManager.open()
    })

    // Assign a note to a teamspace. Detail may be { path, name } / { docId, name },
    // or empty to use the currently open document.
    window.addEventListener('cmd:add-to-teamspace', async (e) => {
        if (!teamspacesManager) return
        let item = e && e.detail ? e.detail : null
        if (!item || (!item.path && !item.docId)) {
            item = getCurrentDocFavItem() // reuses the local/cloud descriptor builder
        }
        const host = document.getElementById('teamspaces-host')
        await teamspacesManager.promptAssign(item, host)
    })

    // Create a new (local-first) teamspace grouping.
    window.addEventListener('cmd:create-teamspace', async () => {
        if (!teamspacesManager) return
        const host = document.getElementById('teamspaces-host')
        await teamspacesManager.promptCreate(host)
    })

    if (window.api && window.api.onMessage) {
        window.api.onMessage((type, ...args) => {
            if (type === 'file-changed') {
                const filePath = args[0]
                // If it's the active document and NOT currently saving
                if (projectionManager && projectionManager.path === filePath) {
                    // Trigger a reload check
                    projectionManager.checkExternalChange()
                }
                if (companyBrainCenter) {
                    companyBrainCenter.handleFileChanged(filePath)
                }
                // Re-broadcast as a DOM event so the task-scan engine can invalidate.
                try { window.dispatchEvent(new CustomEvent('fs:file-changed', { detail: filePath })) } catch (_e) { /* noop */ }
            } else if (type === 'plugin:changed') {
                // Hot-reload: a plugin's files changed on disk (or plugin:reload was
                // invoked). Re-load that one plugin's sandbox. Fully defensive.
                if (Features.plugins && pluginController && typeof pluginController.reload === 'function') {
                    const payload = args[0] || {}
                    Promise.resolve(pluginController.reload(payload.id)).catch((e) => console.warn('[plugins] reload failed:', e))
                }
            } else if (type === 'refresh-project') {
                const projectPath = args[0] || Store.projectPath;
                if (projectPath) {
                    Store.init(projectPath)
                    loadProject(projectPath)
                    if (companyBrainCenter) {
                        companyBrainCenter.initializeWorkspace(projectPath)
                    }
                }
            } else if (type === 'new-note') createNewNote()
            else if (type === 'save-version') promptSaveVersion()
            else if (type === 'save-workspace') saveWorkspace()
            else if (type === 'open-workspace') openWorkspace()
            else if (type === 'enter-full-screen') document.body.classList.add('is-fullscreen')
            else if (type === 'leave-full-screen') document.body.classList.remove('is-fullscreen')
            
            if (type === 'open-cloud-doc') {
                const docId = args[0]
                // Try to find the doc name from sidebar or other sources
                let docName = 'Cloud Document';
                const docEl = document.querySelector(`[data-doc-id="${docId}"] .doc-name-label`);
                if (docEl) docName = docEl.textContent;
                
                window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: { id: docId, name: docName } }));
            } else if (type === 'open-url') {
                const url = args[0] || ''
                // P2P invite/share deep links from the smart landing:
                //   notionless://invite#team=<key>    → join a team workspace
                //   notionless://invite#share=<token> → open one shared note
                // Reuse the SAME parsers as the web #team=/#share= flow so desktop
                // and web behave identically. (teamManager is null in this build —
                // there is no account; the bare ?key=/?token= branch below only
                // keeps older links working.)
                import('./p2p').then(({ parseTeamCode, parseShareToken }) => {
                    const teamKey = parseTeamCode(url)
                    if (teamKey) {
                        window.dispatchEvent(new CustomEvent('cmd:join-team', { detail: { rootKey: teamKey } }))
                        return
                    }
                    const token = parseShareToken(url)
                    if (token) {
                        window.dispatchEvent(new CustomEvent('cmd:join-shared-room', { detail: { token } }))
                        return
                    }
                    try {
                        const u = new URL(url)
                        const legacyKey = u.searchParams.get('key') || u.searchParams.get('token')
                        if (legacyKey) window.dispatchEvent(new CustomEvent('cmd:join-team', { detail: { rootKey: legacyKey } }))
                    } catch (_e) { /* not a parseable URL — ignore */ }
                }).catch((e) => console.error('[Main] open-url deep link failed', e))
            }

            // Bridge IPC push messages for the React surfaces onto the window event
            // bus that host.on(...) listens to. The Email/Calendar islands subscribe
            // to email:new / email:syncProgress / calendar:changed this way.
            if (typeof type === 'string' && (type.startsWith('email:') || type.startsWith('calendar:') || type.startsWith('mcp:'))) {
                try { window.dispatchEvent(new CustomEvent(type, { detail: args[0] })) } catch (_e) { /* noop */ }
                if (type === 'calendar:changed') renderCalendarNav()
            }
        })
    }

    if (window.api && window.api.invoke) {
        window.api.invoke('win:isFullScreen').then(isFull => {
            if (isFull) document.body.classList.add('is-fullscreen')
        }).catch(e => {
            console.debug('[Main] Fullscreen check failed (likely reload):', e.message);
        })
    }

  const lastProject = await window.api.getSettings('lastProject')
  console.log('[Paperus] Last project:', lastProject)
  const isWeb = typeof window !== 'undefined' && (document.body.classList.contains('is-web') || !window.api || !window.api.onMessage);

  if (lastProject) {
    const exists = await window.api.pathExists(lastProject)
    if (exists) {
      Store.init(lastProject)
      await sidebarManager.renderSidebarLists()
      await sharedFileManager.sync()
      await loadProject(lastProject)
      const lastFile = await window.api.getSettings('lastOpenedFile')
      if (lastFile) {
          if (lastFile.startsWith('cloud:')) {
              const parts = lastFile.split(':')
              setTimeout(() => { window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: { id: parts[1], name: parts.length > 2 ? decodeURIComponent(parts[2]) : 'Cloud Document' } })) }, 100)
          } else if (await window.api.pathExists(lastFile)) {
              openFile(lastFile)
          } else if (isWeb) {
              await createNewNote()
          } else {
              showNoFileSelected()
          }
      } else if (isWeb) {
          await createNewNote()
      } else {
          showNoFileSelected()
      }
    } else if (isWeb) {
        await createNewNote()
    } else {
        showNoFileSelected()
    }
  } else if (isWeb) {
      console.log('[Web] Initializing fresh state for web...');
      const labelEl = document.getElementById('workspace-label');
      if (labelEl) labelEl.textContent = 'Personal';
      
      await sidebarManager.renderSidebarLists();
      await loadProject(null); // Load virtual project for drafts
      
      const user = await authClient.getMe();
      if (!user) {
          console.log('[Web] No user session, showing auth hero...');
          showNoFileSelected();
      } else if (tabManager && tabManager.tabs.length === 0) {
          const sharedDocs = await authClient.getSharedDocuments().catch(() => []);
          if (sharedDocs.length > 0) {
              const firstDoc = sharedDocs[0];
              window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: { id: firstDoc.id, name: firstDoc.name } }));
          } else {
              await createNewNote();
          }
      } else {
          showNoFileSelected();
      }
  } else {
      await sidebarManager.renderSidebarLists()
      showNoFileSelected()
  }

    // 11. Global Click Listener to close popovers and dropdowns
    document.addEventListener('mousedown', (e) => {
        // Close Workspace Popover if clicking outside
        const popover = document.getElementById('workspace-popover');
        const workspaceBtn = document.getElementById('account-btn');
        if (popover && popover.style.display === 'block' && 
            !popover.contains(e.target) && !workspaceBtn.contains(e.target)) {
            popover.style.display = 'none';
        }

        // Close Inbox Drawer if clicking outside
        const inboxDrawer = document.getElementById('notification-center');
        const inboxBtn = document.getElementById('inbox-btn');
        
        // Find if any parent is the inbox drawer or button
        const isInboxClick = e.target.closest('#notification-center') || e.target.closest('#inbox-btn');

        if (inboxDrawer && notificationCenter && notificationCenter.isOpen && !isInboxClick) {
            console.log('[Main] Closing inbox drawer due to outside click');
            notificationCenter.toggle();
        }
    }, true);

    console.log('[Paperus] Init complete!')
  } catch (error) {
    console.error('[Paperus] FATAL ERROR during init:', error)
    alert('Failed to initialize: ' + error.message)
  }
}

/** Open the installed-plugins manager (account ▸ Developer ▸ Plugins…). */
function openPluginsSettings() {
    const c = window.__pluginController
    if (!c) { flashHint('Plugins are still loading…'); return }
    const controller = {
        list: () => { try { return c.list ? c.list() : [] } catch { return [] } },
        enable: (id) => Promise.resolve(c.enable ? c.enable(id) : null),
        disable: (id) => Promise.resolve(c.disable ? c.disable(id) : null),
        reload: (id) => Promise.resolve(c.reload ? c.reload(id) : null),
        quickstartUrl: 'https://github.com/Naridon-Inc/paperus/blob/master/docs/PLUGIN_SYSTEM.md',
    }
    try { openPluginSettings(controller) } catch (e) { console.warn('[plugins] settings open failed:', e) }
}

async function renderWorkspacePopover() {
    let popover = document.getElementById('workspace-popover')
    if (!popover) {
        popover = document.createElement('div')
        popover.id = 'workspace-popover'
        popover.className = 'workspace-popover'
        document.body.appendChild(popover)
        document.addEventListener('click', (e) => {
            const btn = document.getElementById('account-btn')
            if (popover.style.display === 'flex' && !popover.contains(e.target) && !btn.contains(e.target)) popover.style.display = 'none'
        })
    }
    if (popover.style.display === 'flex') {
        popover.style.display = 'none'
        return
    }
    popover.style.display = 'flex'
    const btn = document.getElementById('account-btn')
    const rect = btn.getBoundingClientRect()
    popover.style.top = (rect.bottom + 4) + 'px'
    popover.style.left = (rect.left + 4) + 'px'
    popover.innerHTML = '<div style="padding: 20px; color: #999; text-align: center;">Loading...</div>'
    try {
        // No account, no sign-in: this is a local-first workspace menu. The folder
        // on disk is your workspace; teams are separate, peer-to-peer, and joined
        // by link (see the Teams section in the sidebar).
        const appVersion = await (window.api?.getAppVersion ? window.api.getAppVersion() : Promise.resolve('1.0.6'))
        const labelEl = document.getElementById('workspace-label')
        const currentProject = (labelEl && labelEl.textContent) ? labelEl.textContent : 'Personal'
        const initials = currentProject.trim().charAt(0).toUpperCase() || 'P'
        popover.innerHTML = `
            <div class="wp-header-section">
                <div class="wp-workspace-info">
                    <div class="workspace-icon-large">${initials}</div>
                    <div class="wp-workspace-details">
                        <div class="wp-workspace-name">${currentProject}</div>
                        <div class="wp-plan-badge">Local · on this device</div>
                    </div>
                </div>
            </div>
            <div class="wp-section-header">Workspace</div>
            <div class="wp-menu-list">
                <div class="wp-menu-item" id="wp-open-folder"><i class="fas fa-folder-open" style="width:16px;text-align:center;color:#999;"></i> <span>Open folder</span></div>
                <div class="wp-menu-item" id="wp-load-workspace"><i class="fas fa-project-diagram" style="width:16px;text-align:center;color:#999;"></i> <span>Load workspace…</span></div>
                <div class="wp-menu-item" id="wp-save-workspace"><i class="fas fa-save" style="width:16px;text-align:center;color:#999;"></i> <span>Save workspace…</span></div>
            </div>
            <div class="wp-divider"></div>
            <div class="wp-section-header">Teams · peer-to-peer</div>
            <div class="wp-menu-list">
                <div class="wp-menu-item" id="wp-new-team"><i class="fas fa-plus" style="width:16px;text-align:center;color:#999;"></i> <span>New team</span></div>
                <div class="wp-menu-item" id="wp-join-team"><i class="fas fa-link" style="width:16px;text-align:center;color:#999;"></i> <span>Join with a link</span></div>
            </div>
            ${Features.plugins ? `
            <div class="wp-divider"></div>
            <div class="wp-section-header">Developer</div>
            <div class="wp-menu-list">
                <div class="wp-menu-item" id="wp-plugins"><i class="fas fa-puzzle-piece" style="width:16px;text-align:center;color:#999;"></i> <span>Plugins…</span></div>
                <div class="wp-menu-item" id="wp-plugin-docs"><i class="fas fa-book" style="width:16px;text-align:center;color:#999;"></i> <span>Plugin SDK quickstart</span></div>
            </div>
            ` : ''}
            <div class="wp-divider"></div>
            <div class="wp-section-header">Appearance</div>
            <div class="wp-theme-row">
                <div class="wp-theme-seg" role="group" aria-label="Theme">
                    <button class="wp-theme-opt" data-theme-pref="light" type="button"><i class="fas fa-sun"></i> Light</button>
                    <button class="wp-theme-opt" data-theme-pref="dark" type="button"><i class="fas fa-moon"></i> Dark</button>
                    <button class="wp-theme-opt" data-theme-pref="system" type="button"><i class="fas fa-desktop"></i> System</button>
                </div>
            </div>
            <div class="wp-footer-info">Local-first · no account · peer-to-peer · v${appVersion || '1.0.6'}</div>
        `
        // Theme segmented control: reflect current preference + wire clicks.
        const syncThemeButtons = () => {
            const pref = getThemePreference()
            popover.querySelectorAll('.wp-theme-opt').forEach((b) => {
                b.classList.toggle('active', b.dataset.themePref === pref)
            })
        }
        syncThemeButtons()
        popover.querySelectorAll('.wp-theme-opt').forEach((b) => {
            b.onclick = (ev) => {
                ev.stopPropagation() // keep the popover open while switching
                setTheme(b.dataset.themePref)
                syncThemeButtons()
            }
        })
        const hide = () => { popover.style.display = 'none' }
        document.getElementById('wp-open-folder').onclick = async () => { hide(); await openProject() }
        document.getElementById('wp-load-workspace').onclick = async () => { hide(); await openWorkspace() }
        document.getElementById('wp-save-workspace').onclick = async () => { hide(); await saveWorkspace() }
        document.getElementById('wp-new-team').onclick = () => { hide(); window.dispatchEvent(new CustomEvent('cmd:create-team')) }
        document.getElementById('wp-join-team').onclick = () => { hide(); window.dispatchEvent(new CustomEvent('cmd:join-team')) }
        const wpPlugins = document.getElementById('wp-plugins')
        if (wpPlugins) wpPlugins.onclick = () => { hide(); openPluginsSettings() }
        const wpPluginDocs = document.getElementById('wp-plugin-docs')
        if (wpPluginDocs) wpPluginDocs.onclick = () => { hide(); try { window.api.invoke('shell:openExternal', 'https://github.com/Naridon-Inc/paperus/blob/master/docs/PLUGIN_SYSTEM.md') } catch (_e) { /* noop */ } }
    } catch (e) { popover.innerHTML = `<div style="padding: 10px; color: red;">Error: ${e.message}</div>` }
}

function boot() {
  try {
    if (!window.api) throw new Error('window.api is not available (preload not loaded / contextBridge missing)')
    void init()
  } catch (e) {
    console.error('[Paperus] Boot failed:', e)
    alert('Boot failed: ' + (e && e.message ? e.message : String(e)))
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
else boot()

async function saveWorkspace() {
    const knownProjects = await window.api.getSettings('knownProjects') || []
    const knownFiles = await window.api.getSettings('knownFiles') || []
    await window.api.invoke('workspace:save', { projects: knownProjects, files: knownFiles, version: 1 })
}

async function openWorkspace() {
    const data = await window.api.invoke('workspace:load')
    if (data && data.projects) {
        await window.api.setSettings('knownProjects', data.projects || [])
        await window.api.setSettings('knownFiles', data.files || [])
        if (data.projects.length > 0) {
            await window.api.setSettings('lastProject', data.projects[0])
            Store.init(data.projects[0])
        }
        await loadProject(null)
    }
}

async function promptSaveVersion() {
  const activeItem = document.querySelector('.tree-item.active')
  if (!activeItem) return alert('No file open')
  const name = await new Promise(resolve => {
    const div = document.createElement('div')
    div.className = 'input-modal'
    div.innerHTML = `<div class="input-box"><h3>Name this Version</h3><input type="text" id="version-name" placeholder="e.g. Draft 1" autofocus><div class="input-actions"><button class="btn btn-secondary" id="cancel-version">Cancel</button><button class="btn" id="confirm-version">Save</button></div></div>`
    document.body.appendChild(div)
    const input = div.querySelector('input')
    const confirm = div.querySelector('#confirm-version')
    const cancel = div.querySelector('#cancel-version')
    input.focus()
    const cleanup = () => div.remove()
    confirm.onclick = () => { const val = input.value.trim(); if (val) { cleanup(); resolve(val) } }
    cancel.onclick = () => { cleanup(); resolve(null) }
    input.onkeydown = (e) => { if (e.key === 'Enter') confirm.click(); if (e.key === 'Escape') cancel.click() }
  })
  if (name) await saveCurrentFile(name)
}

async function createNewNote(initialContent = null) {
  const activeItem = document.querySelector('.tree-item.active')
  let currentPath = Store.projectPath 
  if (activeDirectory) currentPath = activeDirectory
  else if (activeItem) currentPath = await window.api.invoke('path:dirname', activeItem.dataset.path)
  const isWeb = typeof window !== 'undefined' && (document.body.classList.contains('is-web') || !window.api || !window.api.onMessage);
  if (!currentPath) {
    const knownProjects = await window.api.getSettings('knownProjects') || []
    if (knownProjects.length > 0) currentPath = knownProjects[0]
    else if (isWeb) currentPath = 'root'
    else return alert('No project open to create file in.')
  }
  hideNoFileSelected()
  let baseName = 'Untitled'
  let filename = `${baseName}.md`
  if (initialContent) {
      const match = initialContent.match(/^# (.*)(\n|$)/)
      if (match) {
          const title = match[1].trim().replace(/[\\/:*?"<>|]/g, '')
          if (title) { baseName = title.replace(/ /g, '_').toLowerCase(); filename = `${baseName}.md` }
      }
  }
  let counter = 1
  while (await window.api.pathExists(`${currentPath}/${filename}`)) { filename = `${baseName}_${counter}.md`; counter++ }
  const path = `${currentPath}/${filename}`
  // Body starts empty — the title lives in the separate #doc-title field (the
  // filename), so don't seed a redundant empty "# " heading into the body.
  await window.api.writeFile(path, initialContent || '')
  
  if (isWeb) {
      const knownFiles = await window.api.getSettings('knownFiles') || []
      if (!knownFiles.includes(path)) {
          knownFiles.push(path)
          await window.api.setSettings('knownFiles', knownFiles)
      }
  }

  // Show the title immediately (otherwise it stays blank until the Yjs sync
  // callback fires, so a new note looks like a plain untitled body).
  const titleEl = document.getElementById('doc-title')
  if (titleEl) { titleEl.value = baseName.replace(/_/g, ' '); titleEl.placeholder = 'Untitled' }

  await loadProject(null)
  // Focus + select the title so the user can type the name straight away.
  // Prefer the big page title (the top-bar input is hidden once a doc is open).
  openFile(path).then(() => { setTimeout(() => { const t = document.querySelector('.page-title') || document.getElementById('doc-title'); if (t) { t.focus(); if (t.select) t.select() } }, 200) })
}

// ── Nested pages & wiki-links ──────────────────────────────────────────────

/** Find a local .md file whose title matches a wiki-link target, else null. */
async function resolveWikiTitle(title) {
  const root = Store.projectPath || (await window.api.getSettings('knownProjects') || [])[0]
  if (!root) return null
  const wanted = String(title).trim().toLowerCase()
  const files = await window.api.invoke('fs:listMarkdownFilesRecursive', root).catch(() => [])
  for (const p of files) {
    const base = (await window.api.basename(p)).replace(/\.(md|note)$/i, '')
    const variants = [base.toLowerCase(), base.replace(/_/g, ' ').toLowerCase()]
    if (variants.includes(wanted)) return p
  }
  return null
}

/** Create a new top-level page titled `title` and open it. */
async function createPageWithTitle(title) {
  const clean = String(title).trim().replace(/[\\/:*?"<>|]/g, '') || 'Untitled'
  await createNewNote(`# ${clean}\n`)
}

// ── Quick features: Daily Notes · Graph view · Focus mode ────────────────────

/** Small transient toast for lightweight feature feedback. */
function flashHint(msg) {
  let el = document.getElementById('feature-hint-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'feature-hint-toast'
    el.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(8px);'
      + 'background:#2c2c30;color:#fff;padding:8px 14px;border-radius:9px;'
      + 'font:13px -apple-system,system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,0.22);'
      + 'z-index:5000;opacity:0;transition:opacity .16s ease, transform .16s ease;pointer-events:none;'
    document.body.appendChild(el)
  }
  el.textContent = msg
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)' })
  clearTimeout(flashHint._t)
  flashHint._t = setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateX(-50%) translateY(8px)'
  }, 1600)
}

/** Open (or create) today's daily note — thin alias kept for the ⌘⇧D shortcut. */
async function openTodaysDailyNote() { return openDailyNote(todayISO()) }

/**
 * Open (or create) the daily note for `iso` (YYYY-MM-DD; defaults to today).
 * Targets the open P2P team when a team note is active (we know its teamId);
 * otherwise the local vault. If neither exists, nudge the user to open a folder.
 */
async function openDailyNote(iso) {
  const dateStr = iso || todayISO()
  // 1) P2P team context.
  if (currentTeamNote && p2pTeamManager) {
    const teamId = currentTeamNote.teamId
    try {
      const tree = p2pTeamManager.getNotesTree(teamId)
      const existing = findNoteByTitle(tree, dateStr)
      let noteId = existing ? existing.id : null
      if (!noteId) {
        noteId = await p2pTeamManager.createNote(teamId, { title: dateStr })
        flashHint(`Created daily note · ${dateStr}`)
      }
      window.dispatchEvent(new CustomEvent('cmd:open-team-note', { detail: { teamId, noteId } }))
      return
    } catch (e) {
      console.warn('[daily] team path failed, trying local:', e)
    }
  }
  // 2) Local vault.
  try {
    const existing = await resolveWikiTitle(dateStr)
    if (existing) { openFile(existing); return }
  } catch (_e) { /* fall through to create */ }
  const root = Store.projectPath || (await window.api.getSettings('knownProjects').catch(() => null) || [])[0]
  if (!root) {
    flashHint('Open a folder (or a team) to start daily notes')
    document.getElementById('add-folder-btn')?.click()
    return
  }
  await createNewNote(buildDailyNoteBody(dateStr))
  flashHint(`Created daily note · ${dateStr}`)
}

/**
 * Create a calendar "event" = append a dated task line to the relevant daily
 * note, WITHOUT navigating away (the calendar surface stays put and refreshes
 * via the task scan). Mirrors openDailyNote's team-first / local-fallback
 * resolution. Returns { ok, scope, path? } or { ok:false, error }.
 *
 * payload: { iso, title, remind?, allDay?, time? }
 */
async function createCalendarEvent({ iso, title, remind = false, allDay = true, time = '' } = {}) {
  const dateStr = iso || todayISO()
  const clean = String(title || '').trim().replace(/\r?\n/g, ' ') || 'Untitled event'
  const timePart = (!allDay && time) ? ` ${String(time).trim()}` : ''
  const token = remind ? `${dateStr} remind` : dateStr
  const line = `- [ ] ${clean}${timePart} @date(${token})`

  // 1) P2P team context — append into the team daily note's CRDT text.
  if (currentTeamNote && p2pTeamManager) {
    try {
      const teamId = currentTeamNote.teamId
      const tree = p2pTeamManager.getNotesTree(teamId)
      const existing = findNoteByTitle(tree, dateStr)
      const noteId = existing ? existing.id : await p2pTeamManager.createNote(teamId, { title: dateStr })
      const engine = await p2pTeamManager.openNote(teamId, noteId)
      const ytext = engine && engine.text
      if (ytext) {
        const cur = ytext.toString()
        const sep = cur && !/\n$/.test(cur) ? '\n' : ''
        ytext.insert(ytext.length, `${sep}${line}\n`)
        try { taskScan.requestScan({ force: true }) } catch (_e) { /* noop */ }
        flashHint(`Added event · ${dateStr}`)
        return { ok: true, scope: 'team' }
      }
    } catch (e) {
      console.warn('[event] team path failed, trying local:', e)
    }
  }

  // 2) Local vault — append to the existing daily note, or create it.
  const root = Store.projectPath || (await window.api.getSettings('knownProjects').catch(() => null) || [])[0]
  if (!root) {
    flashHint('Open a folder (or a team) to add events')
    return { ok: false, error: 'no-root' }
  }
  let path = null
  try { path = await resolveWikiTitle(dateStr) } catch (_e) { path = null }
  if (path) {
    const cur = await window.api.readFile(path).catch(() => '')
    const sep = cur && !/\n$/.test(cur) ? '\n' : ''
    await window.api.writeFile(path, `${cur}${sep}${line}\n`)
  } else {
    path = `${root}/${dateStr}.md`
    await window.api.writeFile(path, `${buildDailyNoteBody(dateStr)}\n${line}\n`)
    try { await loadProject(null) } catch (_e) { /* tree refresh best-effort */ }
  }
  try { taskScan.requestScan({ force: true }) } catch (_e) { /* noop */ }
  flashHint(`Added event · ${dateStr}`)
  return { ok: true, scope: 'local', path }
}

/**
 * Assemble graph data for the GraphView overlay:
 *  - P2P team open → nodes = note tree, edges = parent→child structure.
 *  - Local vault    → nodes = .md files, edges = [[wiki-links]] resolved by title.
 */
async function gatherGraphData() {
  if (currentTeamNote && p2pTeamManager) {
    try {
      const teamId = currentTeamNote.teamId
      const tree = p2pTeamManager.getNotesTree(teamId)
      const nodes = []
      const edges = []
      const walk = (list, parentId) => {
        for (const n of (list || [])) {
          if (n.deleted) continue
          nodes.push({ id: n.id, title: n.title || 'Untitled' })
          if (parentId) edges.push({ from: parentId, to: n.id })
          if (Array.isArray(n.children) && n.children.length) walk(n.children, n.id)
        }
      }
      walk(Array.isArray(tree) ? tree : (tree ? [tree] : []), null)
      return { nodes, edges }
    } catch (e) {
      console.warn('[graph] team gather failed:', e)
    }
  }
  // Local vault link graph.
  const root = Store.projectPath || (await window.api.getSettings('knownProjects').catch(() => null) || [])[0]
  if (!root) return { nodes: [], edges: [] }
  const files = await window.api.invoke('fs:listMarkdownFilesRecursive', root).catch(() => [])
  const capped = files.slice(0, 600)
  const byTitle = new Map()
  const nodes = []
  for (const p of capped) {
    const base = (await window.api.basename(p)).replace(/\.(md|note)$/i, '')
    nodes.push({ id: p, title: base.replace(/_/g, ' ') })
    byTitle.set(base.toLowerCase(), p)
    byTitle.set(base.replace(/_/g, ' ').toLowerCase(), p)
  }
  const WIKILINK_RE = /\[\[([^[\]|#]+?)(?:#[^[\]|]*)?(?:\|[^[\]]+?)?\]\]/g
  const edges = []
  for (const p of capped) {
    let text = ''
    try { text = await window.api.readFile(p) } catch (_e) { continue }
    if (!text) continue
    WIKILINK_RE.lastIndex = 0
    let m = WIKILINK_RE.exec(text)
    while (m !== null) {
      const target = byTitle.get(String(m[1]).trim().toLowerCase())
      if (target && target !== p) edges.push({ from: p, to: target })
      m = WIKILINK_RE.exec(text)
    }
  }
  return { nodes, edges }
}

/** Open the graph overlay (lazily constructed). */
function openGraphView() {
  if (!graphView) {
    graphView = new GraphView({
      openNode: (node) => {
        graphView.close()
        if (currentTeamNote && p2pTeamManager) {
          window.dispatchEvent(new CustomEvent('cmd:open-team-note', { detail: { teamId: currentTeamNote.teamId, noteId: node.id } }))
        } else {
          openFile(node.id)
        }
      },
    })
  }
  graphView.open(gatherGraphData)
}

/**
 * Create a sub-page nested under the current page and insert a [[link]] to it
 * at the cursor. The child lives in a folder named after the parent page so the
 * sidebar shows it nested (Notion-style). Falls back to a sibling page if no
 * file is currently open.
 */
async function createSubPage() {
  if (!currentOpenPath || (typeof currentOpenPath === 'string' && currentOpenPath.startsWith('cloud:'))) {
    await createNewNote('# Untitled\n')
    return
  }
  try {
    const parentDir = await window.api.invoke('path:dirname', currentOpenPath)
    const parentBase = (await window.api.basename(currentOpenPath)).replace(/\.(md|note)$/i, '')
    const childDir = `${parentDir}/${parentBase}`
    const title = 'Untitled'
    let filename = `${title}.md`
    let counter = 1
    while (await window.api.pathExists(`${childDir}/${filename}`)) { filename = `${title}_${counter}.md`; counter++ }
    const childPath = `${childDir}/${filename}`
    await window.api.writeFile(childPath, `# ${title}\n`)

    // Insert a wiki-link to the child at the cursor in the parent doc.
    const linkTitle = filename.replace(/\.md$/i, '').replace(/_/g, ' ')
    if (cmView) {
      const pos = cmView.state.selection.main.head
      const line = cmView.state.doc.lineAt(pos)
      const prefix = line.text.trim().length > 0 ? '\n' : ''
      const insert = `${prefix}[[${linkTitle}]]\n`
      cmView.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } })
    }

    await loadProject(null)
    openFile(childPath).then(() => { setTimeout(() => { const t = document.querySelector('.page-title') || document.getElementById('doc-title'); if (t) t.focus() }, 200) })
  } catch (e) {
    console.warn('[Main] createSubPage failed, falling back to sibling note:', e)
    await createNewNote('# Untitled\n')
  }
}

let saveTimer
let renameTimer
let typingTimer

async function renameFile(newTitle) {
    if (!newTitle || newTitle === 'Untitled') return
    const activeItem = document.querySelector('.tree-item.active, .sidebar-doc-item.active')
    if (!activeItem) return
    const oldPath = activeItem.dataset.path
    if (!oldPath) return; 
    
    // Cloud Support
    if (oldPath.startsWith('cloud:')) {
        const docId = oldPath.split(':')[1];
        if (tabManager) tabManager.updateCurrentTab(oldPath, newTitle);
        document.getElementById('file-status').textContent = newTitle;
        // Also update sidebar if it has a label
        const label = activeItem.querySelector('.doc-name-label');
        if (label) label.textContent = newTitle;
        return;
    }
    
    const dir = await window.api.invoke('path:dirname', oldPath)
    const ext = await window.api.invoke('path:extname', oldPath) || '.md'
    const safeTitle = newTitle.replace(/[\\/:*?"<>|]/g, '_')
    const newPath = `${dir}/${safeTitle}${ext}`
    
    if (oldPath === newPath) return
    try {
        await window.api.invoke('fs:rename', oldPath, newPath)
        
        // Update lastOpenedFile if it was the one renamed
        const lastFile = await window.api.getSettings('lastOpenedFile');
        if (lastFile === oldPath) {
            await window.api.setSettings('lastOpenedFile', newPath);
        }
        
        activeItem.dataset.path = newPath
        
        // Update tree label
        const textNode = Array.from(activeItem.childNodes).find(n => n.nodeType === 3)
        if (textNode) textNode.textContent = ' ' + newTitle + ext
        
        if (projectionManager && projectionManager.path === oldPath) {
            projectionManager.path = newPath
        }
        if (tabManager) tabManager.updateCurrentTab(newPath, newTitle + ext)
        
        document.getElementById('file-status').textContent = newTitle + ext
        let recents = await window.api.getSettings('recentFiles') || []
        recents = recents.map(p => p === oldPath ? newPath : p)
        await window.api.setSettings('recentFiles', recents)
        // Keep Favorites/Recents entries pointing at the renamed local file.
        try {
            const newName = (newTitle + ext).replace(/\.(md|txt)$/, '').replace(/_/g, ' ')
            if (favorites && favorites.renamePath) await favorites.renamePath(oldPath, newPath, newName)
            if (recentsManager && recentsManager.renamePath) await recentsManager.renamePath(oldPath, newPath, newName)
            if (sidebarManager) {
                if (sidebarManager.renderFavorites) await sidebarManager.renderFavorites()
                if (sidebarManager.renderRecents) await sidebarManager.renderRecents()
            }
        } catch (e) { console.warn('[Main] favorites/recents rename sync failed:', e) }
        window.api.invoke('fs:updateLinks', oldPath, newPath)
    } catch (err) { console.error('Rename failed:', err) }
}

function handleTextChange(update) {
  if (window.appState && window.appState.isSettingsOpen) return
  if (window.isUpdatingFromYjs) return

  const fullText = update.state.doc.toString()
  const textTrimmed = fullText.trim()
  const words = textTrimmed ? textTrimmed.split(/\s+/).length : 0
  const lines = update.state.doc.lines

  const wordCountEl = document.getElementById('word-count');
  if (wordCountEl) wordCountEl.textContent = `${lines}L ${words}W`

    // Title/body are decoupled (Notion model): the title is the filename, edited
    // via the big page title. A leading body "# " is plain content and must NOT
    // hijack the filename, so the legacy body-H1 → title sync is disabled.

    if (docEngine && docEngine.presence) {
        docEngine.presence.setTyping(true)
        clearTimeout(typingTimer)
        typingTimer = setTimeout(() => {
            if (docEngine && docEngine.presence) docEngine.presence.setTyping(false)
        }, 1000)
    }
    clearTimeout(saveTimer)
    const fileStatusEl = document.getElementById('file-status');
    if (fileStatusEl) fileStatusEl.textContent = 'Unsaved...'
    saveTimer = setTimeout(() => saveCurrentFile(), 1000)
}

setInterval(async () => {
    if (docEngine && docEngine.docId) {
        try {
            await saveCurrentFile('Auto-Backup')
            if (docEngine.snapshots) await docEngine.snapshots.pruneSnapshots()
        } catch (e) { console.error('[Auto-Snapshot] Failed:', e) }
    }
}, 10 * 60 * 1000)

async function handleTitleChange(e) {
  if (window.appState && window.appState.isSettingsOpen) return
  const newTitle = e.target.value.trim() || 'Untitled'

  // Synced P2P team note: the title lives in the team's note index (tree), not
  // on the filesystem. Rename it there and skip the local file save path.
  if (currentTeamNote && p2pTeamManager) {
      await p2pTeamManager.renameNote(currentTeamNote.teamId, currentTeamNote.noteId, newTitle)
      renderP2PTeams()
      return
  }

  if (docEngine) {
      docEngine.doc.transact(() => {
          docEngine.doc.getMap('metadata').set('filename', newTitle);
      }, 'user-rename');
  }

  await renameFile(newTitle)
  await saveCurrentFile()
}

async function saveCurrentFile(versionLabel = null) {
  if (window.isUpdatingFromYjs) {
      console.log('[Main] Save skipped: Document is currently loading or migrating');
      return;
  }
  if (e2eeReadOnlyLocked) {
      console.log('[Main] Save skipped: encrypted document requires vault unlock');
      return;
  }
  // Synced P2P team notes have no filesystem projection — content persists via
  // the per-note CRDT + each peer's IndexedDB. Nothing to write here.
  if (currentTeamNote) {
      return;
  }

  let path = null;
  let docId = null

  const activeItem = document.querySelector('.tree-item.active, .sidebar-doc-item.active')
  if (activeItem) {
      path = activeItem.dataset.path
      docId = activeItem.dataset.docId
  }

  if (!path && projectionManager) path = projectionManager.path
  if (!docId && docEngine) docId = docEngine.docId

  if (!path && !docId) return

  document.getElementById('file-status').textContent = 'Saving...'

  const title = document.getElementById('doc-title').value || 'Untitled'
  let bodyContent
  try {
    // Raw markdown from Yjs — no conversion needed
    bodyContent = docEngine ? docEngine.text.toString() : (cmView ? cmView.state.doc.toString() : '')

    // Data loss prevention
    if ((!bodyContent || bodyContent.trim().length < 5) && docEngine && docEngine.text.length > 10) {
        console.error('[Main] Suspiciously small output, aborting save to prevent data loss');
        return;
    }

    if (path) {
        await Promise.race([
            window.api.writeFile(path, bodyContent),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Save timeout')), 5000))
        ])
    }

    // Authoritative Cloud Save
    if (docId && authClient.token) {
        console.log(`[Main] Pushing authoritative content for ${docId} to Cloud via REST...`);
        const url = await authClient.getUrl(`/documents/${docId}/save`);

        let contentToSave = bodyContent;
        if (docEngine && docEngine.isEncrypted && docEngine.docKey) {
            const enc = e2eeManager.encryptUpdate(new TextEncoder().encode(bodyContent), docEngine.docKey);
            contentToSave = 'e2ee:' + e2eeManager.toBase64(enc);
        }

        fetch(url, {
            method: 'POST',
            headers: authClient.headers,
            body: JSON.stringify({
                content: contentToSave,
                name: title,
                isEncrypted: docEngine?.isEncrypted
            })
        })
        .then(() => { void updateHeaderMeta(); })
        .catch(e => console.warn('[Main] Cloud REST save failed:', e));
    }

    if (versionLabel && docEngine) await docEngine.snapshots.createSnapshot(versionLabel)

    const filename = path ? await window.api.basename(path) : title
    const displayName = filename.replace(/_/g, ' ')
    document.getElementById('file-status').textContent = `${displayName} (Saved)`
    setTimeout(() => { document.getElementById('file-status').textContent = displayName }, 2000)
  } catch (err) {
      console.error('Save failed:', err);
      document.getElementById('file-status').textContent = 'Save Failed!'
  }
}

function handleSelectionChange() {
  if (!cmView) return
  const sel = cmView.state.selection.main
  const line = cmView.state.doc.lineAt(sel.head)
  document.getElementById('cursor-pos').textContent = `${line.number}:${sel.head - line.from + 1}`
}

function updateClock() {
  const now = new Date()
  document.getElementById('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function openProject() {
  const result = await window.api.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (!result.canceled && result.filePaths.length > 0) {
    const path = result.filePaths[0]
    await window.api.setSettings('lastProject', path)
    const known = await window.api.getSettings('knownProjects') || []
    if (!known.includes(path)) { known.push(path); await window.api.setSettings('knownProjects', known) }
    document.getElementById('editor').style.display = 'block'
    Store.init(path)
    await loadProject(path)
    showNoFileSelected()
  }
}

async function openFileExternal() {
  const result = await window.api.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'note'] }] })
  if (!result.canceled && result.filePaths.length > 0) {
    const path = result.filePaths[0]
    let knownFiles = await window.api.getSettings('knownFiles') || []
    if (!knownFiles.includes(path)) { knownFiles.push(path); await window.api.setSettings('knownFiles', knownFiles) }
    await loadProject(null)
    openFile(path)
  }
}

function sanitizeKnownFiles(files = []) {
  const unique = []
  const seen = new Set()
  for (const raw of Array.isArray(files) ? files : []) {
    const p = String(raw || '').trim().replace(/\\/g, '/')
    if (!p) continue
    if (p.startsWith('cloud:')) continue
    if (p.startsWith('folder:')) continue
    if (/\.migration-backup$/i.test(p)) continue
    if (/\.local_conflict$/i.test(p)) continue
    if (seen.has(p)) continue
    seen.add(p)
    unique.push(p)
  }
  return unique
}

async function loadProject(path) {
  let knownProjects = await window.api.getSettings('knownProjects') || []
  if (path && !knownProjects.includes(path)) {
      if ((await window.api.extname(path)) === '') { knownProjects.push(path); await window.api.setSettings('knownProjects', knownProjects) }
  }
  const knownFilesRaw = await window.api.getSettings('knownFiles') || []
  const knownFiles = sanitizeKnownFiles(knownFilesRaw)
  if (knownFiles.length !== knownFilesRaw.length) {
      await window.api.setSettings('knownFiles', knownFiles)
  }
  if (knownProjects.length === 0 && knownFiles.length === 0) {
      await sidebarManager.renderWorkspace([], [])
      return
  }
  if (indexer) { for (const p of knownProjects) indexer.buildIndex(p).catch(console.error) }
  if (companyBrainCenter) { for (const p of knownProjects) companyBrainCenter.initializeWorkspace(p).catch(console.error) }
  const trees = []
  for (const p of knownProjects) { if (await window.api.pathExists(p)) { const t = await window.api.invoke('fs:getDirectoryTree', p); if (t) trees.push(t) } }
  await sidebarManager.renderWorkspace(trees, knownFiles)
  document.getElementById('file-tree').style.display = 'block'
  document.getElementById('home-view').style.display = 'none'
  document.getElementById('profile-view').style.display = 'none'
  const workspaceLabel = document.getElementById('workspace-label')
  if (workspaceLabel) {
      // Only update label to folder name if NO user is logged in (Local Mode)
      // If logged in, the header represents the User/Team context, not the local folder.
      if (!authClient.user) {
          if (path) workspaceLabel.textContent = await window.api.basename(path)
          else if (knownProjects.length > 0) workspaceLabel.textContent = await window.api.basename(knownProjects[0])
          else workspaceLabel.textContent = 'Personal'
      }
  }
}

/**
 * Mount an already-opened P2P engine (shared doc or team note) into the editor,
 * mirroring the local/cloud mount path. Tears down any prior projection/engine.
 * `teamNote` (or null) records whether title edits should rename a team note.
 */
function mountP2PEngineInEditor(engine, { docName, tabKey, teamNote = null } = {}) {
    window.isUpdatingFromYjs = true
    if (projectionManager) { projectionManager.destroy(); projectionManager = null }
    const titleEl = document.getElementById('doc-title')
    if (titleEl) titleEl.value = docName || 'Untitled'
    const statusEl = document.getElementById('file-status')
    if (statusEl) statusEl.textContent = docName || 'Untitled'
    if (tabManager && tabKey) tabManager.updateCurrentTab(tabKey, docName || 'Untitled')

    if (docEngine && docEngine !== engine) docEngine.destroy()
    // Leaving a team note? Let the manager re-form its background ciphertext
    // replica (it was suppressed while open as a full editor).
    if (currentTeamNote && p2pTeamManager
        && (!teamNote || teamNote.noteId !== currentTeamNote.noteId)) {
        try { p2pTeamManager.closeNote(currentTeamNote.teamId, currentTeamNote.noteId) } catch (_e) {}
    }
    docEngine = engine
    if (moreMenu) moreMenu.docEngine = docEngine
    currentOpenPath = null
    currentTeamNote = teamNote

    docEngine.whenSynced().then(() => {
        rebindEditor(docEngine.text, docEngine)
        window.isUpdatingFromYjs = false
        if (pageHeader) pageHeader.render()
        if (backlinksPanel) backlinksPanel.clear()
    })
}

/** Open a synced team note in its own per-note P2P room. */
async function openTeamNote(teamId, noteId) {
    if (!p2pTeamManager) return
    hideNoFileSelected()
    const meta = p2pTeamManager.getNoteMeta(teamId, noteId)
    const docName = (meta && meta.title) || 'Untitled'
    if (docEngine && docEngine.docId === noteId) return
    try {
        const engine = await p2pTeamManager.openNote(teamId, noteId)
        mountP2PEngineInEditor(engine, {
            docName,
            tabKey: `team:${teamId}:${noteId}`,
            teamNote: { teamId, noteId },
        })
    } catch (e) {
        if (e && e.code === 'NO_ACCESS') {
            window.dispatchEvent(new CustomEvent('cmd:note-no-access', { detail: { teamId, noteId } }))
            return
        }
        console.error('[Main] open team note failed', e)
    }
}

/**
 * On startup, honor a team/share deep-link in the address bar
 * (`#team=<key>` or `#share=<token>`), then STRIP the secret from the URL so it
 * isn't left in history / shoulder-surfed (R4).
 */
async function handleP2PDeepLink() {
    if (typeof window === 'undefined' || !window.location) return
    const hash = window.location.hash || ''
    const search = window.location.search || ''
    const raw = hash || search
    if (!raw) return
    try {
        const { parseTeamCode, parseShareToken } = await import('./p2p')
        const teamKey = parseTeamCode(raw)
        if (teamKey) {
            window.dispatchEvent(new CustomEvent('cmd:join-team', { detail: { rootKey: teamKey } }))
        } else {
            const token = parseShareToken(raw)
            if (token) window.dispatchEvent(new CustomEvent('cmd:join-shared-room', { detail: { token } }))
            else return
        }
        // Remove the secret from the address bar (keep path; drop hash/query).
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname)
        }
    } catch (e) {
        console.warn('[Main] deep-link parse failed', e)
    }
}

/** Render the P2P "Teams" sidebar section (teams + their synced note trees). */
function renderP2PTeams() {
    const host = document.getElementById('teamspaces-list')
    if (!host) return
    host.innerHTML = ''
    if (!p2pTeamManager) return
    const teams = p2pTeamManager.getTeams()
    if (!teams.length) {
        const hint = document.createElement('div')
        hint.style.cssText = 'padding: 4px 12px 10px; font-size: 11px; color: #aaa; line-height: 1.5;'
        hint.innerHTML = 'No teams yet. <b style="color:#888;font-weight:600;">Create one</b> or <b style="color:#888;font-weight:600;">join with a link</b> — no account needed. Teammates sync directly, peer-to-peer.'
        host.appendChild(hint)
        return
    }

    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    teams.forEach((team) => {
        const group = document.createElement('div')
        group.className = 'ts-group'

        const online = p2pTeamManager.getOnlinePeers(team.teamId)
        // ≥1 OTHER member online = latest state is reachable (the P2P availability
        // contract). In always-on cloud mode the box covers availability instead,
        // so the dot reflects that (see cloud-sync.js).
        const live = online.others > 0
        const dotColor = syncDotColor({ live })
        const syncTitle = syncDotTitle({ live, others: online.others })

        const header = document.createElement('div')
        header.className = 'ts-group-header expanded'
        header.innerHTML = `
            <i class="fas fa-chevron-circle-right ts-caret" style="font-size:12px;color:#bbb;width:14px;"></i>
            <span class="ts-group-icon"><i class="fas fa-users" style="font-size:12px;color:#ea4e43;"></i></span>
            <span class="ts-group-name" style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(team.name)}</span>
            <span class="p2p-online-dot" title="${esc(syncTitle)}" style="width:7px;height:7px;border-radius:50%;background:${dotColor};margin-right:6px;flex-shrink:0;cursor:pointer;"></span>
            <span class="ts-group-actions" style="display:none;gap:4px;">
                <i class="fas fa-plus icon-btn p2p-add-note" title="New note" style="font-size:11px;opacity:0.7;"></i>
                <i class="fas fa-user-friends icon-btn p2p-roster" title="Members" style="font-size:11px;opacity:0.7;"></i>
                <i class="fas fa-link icon-btn p2p-invite" title="Invite link" style="font-size:11px;opacity:0.7;"></i>
            </span>`

        const children = document.createElement('div')
        children.className = 'ts-group-children expanded'

        const tree = p2pTeamManager.getNotesTree(team.teamId)
        const renderNodes = (nodes, depth) => {
            nodes.forEach((node) => {
                const row = document.createElement('div')
                row.className = 'sidebar-doc-item'
                const locked = !!node.locked // restricted note we can't decrypt
                row.style.cssText = `display:flex;align-items:center;padding:2px 8px;cursor:${locked ? 'default' : 'pointer'};`
                const title = (node.title || 'Untitled')
                // Icon: 🔒 for no-access restricted, key for restricted-with-access, file otherwise.
                const icon = locked
                    ? '<i class="fas fa-lock" style="font-size:11px;color:#bbb;"></i>'
                    : (node.restricted
                        ? '<i class="fas fa-key" style="font-size:11px;color:#c79a3a;"></i>'
                        : '<i class="far fa-file-alt" style="font-size:12px;color:#999;"></i>')
                // Restricted-with-access gets a "Who can access" action; locked rows get nothing.
                const accessBtn = (node.restricted && !locked)
                    ? '<i class="fas fa-user-lock p2p-note-access" title="Who can access" style="opacity:0;font-size:11px;color:#ccc;padding:0 4px;"></i>'
                    : ''
                const delBtn = locked ? '' : '<i class="fas fa-times p2p-del-note" title="Delete" style="opacity:0;font-size:11px;color:#ccc;padding:0 4px;"></i>'
                row.innerHTML = `
                    <div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;margin-left:${depth * 14}px;margin-right:0;">
                        ${icon}
                    </div>
                    <span style="font-size:13px;color:${locked ? '#aaa' : '#333'};font-style:${locked ? 'italic' : 'normal'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${esc(title)}</span>
                    ${accessBtn}${delBtn}`
                row.onmouseenter = () => { row.querySelectorAll('.p2p-del-note,.p2p-note-access').forEach((x) => { x.style.opacity = '0.8' }) }
                row.onmouseleave = () => { row.querySelectorAll('.p2p-del-note,.p2p-note-access').forEach((x) => { x.style.opacity = '0' }) }
                row.onclick = (ev) => {
                    if (ev.target.classList.contains('p2p-del-note') || ev.target.classList.contains('p2p-note-access')) return
                    if (locked) {
                        window.dispatchEvent(new CustomEvent('cmd:note-no-access', { detail: { teamId: team.teamId, noteId: node.id } }))
                        return
                    }
                    window.dispatchEvent(new CustomEvent('cmd:open-team-note', { detail: { teamId: team.teamId, noteId: node.id } }))
                }
                const access = row.querySelector('.p2p-note-access')
                if (access) access.onclick = (ev) => {
                    ev.stopPropagation()
                    openNoteAccessDialog(p2pTeamManager, team.teamId, node.id)
                }
                const del = row.querySelector('.p2p-del-note')
                if (del) del.onclick = async (ev) => {
                    ev.stopPropagation()
                    if (confirm(`Delete "${title}"? This removes it for the whole team.`)) {
                        await p2pTeamManager.deleteNote(team.teamId, node.id)
                        renderP2PTeams()
                    }
                }
                children.appendChild(row)
                if (node.children && node.children.length) renderNodes(node.children, depth + 1)
            })
        }
        if (tree.length) renderNodes(tree, 0)
        else {
            const empty = document.createElement('div')
            empty.style.cssText = 'font-size:11px;color:#bbb;font-style:italic;padding:2px 8px 2px 28px;'
            empty.textContent = 'No notes yet.'
            children.appendChild(empty)
        }

        header.onmouseenter = () => { const a = header.querySelector('.ts-group-actions'); if (a) a.style.display = 'flex' }
        header.onmouseleave = () => { const a = header.querySelector('.ts-group-actions'); if (a) a.style.display = 'none' }
        header.onclick = (ev) => {
            if (ev.target.closest('.ts-group-actions')) return
            const expanded = children.classList.toggle('expanded')
            children.style.display = expanded ? 'block' : 'none'
            header.classList.toggle('expanded', expanded)
        }
        const dotEl = header.querySelector('.p2p-online-dot')
        if (dotEl) dotEl.onclick = (ev) => {
            ev.stopPropagation()
            openSyncPopover(dotEl)
        }
        const addBtn = header.querySelector('.p2p-add-note')
        if (addBtn) addBtn.onclick = (ev) => {
            ev.stopPropagation()
            openCreateNoteDialog(p2pTeamManager, team.teamId, {
                afterCreate: (noteId) => {
                    renderP2PTeams()
                    window.dispatchEvent(new CustomEvent('cmd:open-team-note', { detail: { teamId: team.teamId, noteId } }))
                },
            })
        }
        const rosterBtn = header.querySelector('.p2p-roster')
        if (rosterBtn) rosterBtn.onclick = (ev) => { ev.stopPropagation(); window.dispatchEvent(new CustomEvent('cmd:open-team', { detail: { teamId: team.teamId } })) }
        const inviteBtn = header.querySelector('.p2p-invite')
        if (inviteBtn) inviteBtn.onclick = (ev) => { ev.stopPropagation(); window.dispatchEvent(new CustomEvent('cmd:copy-team-link', { detail: { teamId: team.teamId } })) }

        group.appendChild(header)
        group.appendChild(children)
        host.appendChild(group)
    })
}

async function loadFileContent(path) {
  if (typeof path === 'string' && path.startsWith('cloud:')) {
      const cloudDocId = path.slice('cloud:'.length).split(':')[0].replace(/\.migration-backup$/i, '').trim()
      if (cloudDocId) {
          window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: { id: cloudDocId } }))
          return
      }
  }

  await window.api.setSettings('lastOpenedFile', path)
  currentOpenPath = path
  sidebarManager.updateSelection('local', path)
  if (teamManager && teamManager.isOpen) teamManager.close()
  // Opening a local file leaves any open team note → re-form its background replica.
  if (currentTeamNote && p2pTeamManager) {
      try { p2pTeamManager.closeNote(currentTeamNote.teamId, currentTeamNote.noteId) } catch (_e) {}
      currentTeamNote = null
  }
  hideNoFileSelected()
  
  // --- 1. PREPARE UI & LOCK PROJECTION ---
  window.isUpdatingFromYjs = true;

  const activeItem = document.querySelector(`.tree-item[data-path="${path}"]`)

  if (projectionManager) {
      console.log('[Main] Destroying old projection manager');
      projectionManager.destroy();
      projectionManager = null;
  }

  if (docEngine) { docEngine.destroy(); docEngine = null }
  
  // --- ENGINE SETUP ---
  const docId = await window.api.invoke('fs:getDocId', path)
  if (!docId) { 
      console.error('Failed to resolve document identity for:', path); 
      if (!await window.api.pathExists(path)) {
          alert(`Document "${await window.api.basename(path)}" no longer exists at its recorded path.\n\nIt may have been moved or renamed.`);
          showNoFileSelected();
      }
      window.isUpdatingFromYjs = false;
      return; 
  }
  
  docEngine = new DocumentEngine(docId)
  setE2EELockedState(false)
  docEngine.presence.bind();

  // Set user for presence
  if (authClient.user) {
      docEngine.presence.setUser({
          id: authClient.user.id,
          name: authClient.user.displayName || authClient.user.email.split('@')[0],
          email: authClient.user.email,
          color: docEngine.presence.generateColor(authClient.user.email)
      });
  }

  if (moreMenu) moreMenu.docEngine = docEngine
  
  await docEngine.whenSynced()
  
  // Create an automatic snapshot on open to preserve state before any migration/sync
  if (window.api && window.api.onMessage) {
      console.log('[Main] Creating pre-load snapshot for:', docId);
      docEngine.snapshots.createSnapshot('Auto: Doc Open').catch(e => console.warn('[Main] Auto-snapshot failed:', e));
  }

  if (authClient.token) {
      // Connect to cloud if doc is known to be shared OR is tagged as cloud-backed in the manifest
      const isShared = sidebarManager && sidebarManager.sharedDocIds && sidebarManager.sharedDocIds.has(docId);
      const isCloudTagged = await window.api.invoke('fs:isCloudDoc', docId).catch(() => false);
      if (isShared || isCloudTagged) {
          console.log('[Main] Local doc is shared, connecting to cloud sync...');
          let encryptedReadyForSync = true
          
          // E2EE Setup for shared local docs
          const metadata = await authClient.getDocumentMetadata(docId).catch(() => null);
          if (metadata && metadata.isEncrypted) {
              const perms = await authClient.getDocumentPermissions(docId);
              const myPerm = perms.find(p => p.userId === authClient.user?.id);
              if (myPerm && myPerm.wrappedKey && authClient.e2ee.privateKey) {
                  const docKey = await e2eeManager.unwrapDocumentKey(
                      myPerm.wrappedKey,
                      authClient.e2ee.publicKey,
                      authClient.e2ee.privateKey
                  );
                  await docEngine.setupE2EE(docKey);
                  setE2EELockedState(false)
              } else if (metadata.createdBy === authClient.user?.id) {
                  // I am the owner, I should have the key or need to generate one
                  // Actually, for already encrypted docs, I should have a permission record with the key
                  if (myPerm && myPerm.wrappedKey && authClient.e2ee.privateKey) {
                      const docKey = await e2eeManager.unwrapDocumentKey(myPerm.wrappedKey, authClient.e2ee.publicKey, authClient.e2ee.privateKey);
                      await docEngine.setupE2EE(docKey);
                      setE2EELockedState(false)
                  } else {
                      encryptedReadyForSync = false
                      setE2EELockedState(true, 'Encrypted shared doc: unlock Vault to sync')
                  }
              } else {
                  encryptedReadyForSync = false
                  setE2EELockedState(true, 'Encrypted shared doc: no wrapped key found')
              }
          }

          if (teamManager) {
              teamManager.engine = docEngine;
              if (encryptedReadyForSync) {
                  await teamManager.connect();
              } else {
                  console.warn('[Main] Skipping cloud connection: encrypted shared doc is not unlocked');
              }
          }
          
          // Re-broadcast user state after cloud connection to ensure others see us
          if (authClient.user && encryptedReadyForSync) {
              docEngine.presence.setUser({
                  id: authClient.user.id,
                  name: authClient.user.displayName || authClient.user.email.split('@')[0],
                  email: authClient.user.email,
                  color: docEngine.presence.generateColor(authClient.user.email)
              });
          }
      } else {
          console.log('[Main] Local doc is private, skipping cloud sync.');
      }
  }
  
  const yText = docEngine.text

       // --- 3. SYNC LOGIC ---
       docEngine.whenSynced().then(async () => {
            const rawContent = yText.toString();
            console.log('[Main] Yjs synced, length:', rawContent.length);

            // If Yjs is empty, seed from disk
            if (yText.length === 0) {
                const fileContent = await window.api.readFile(path);
                if (fileContent && fileContent.trim().length > 0) {
                    console.log('[Main] Yjs empty, seeding raw markdown from disk');
                    docEngine.doc.transact(() => {
                        yText.insert(0, fileContent);
                    }, 'seed-from-disk');
                    console.log('[Main] Seeding complete, yText len:', yText.length);
                }
            }

            // Recreate CodeMirror with yCollab binding
            rebindEditor(yText, docEngine);

       // Unlock projection after binding
       window.isUpdatingFromYjs = false;
       console.log('[Main] yCollab binding active. yText len:', yText.length);

       // Render the page icon/cover header from front-matter.
       if (pageHeader) pageHeader.render()

       // Refresh the "Linked references" (backlinks) panel for this page.
       if (backlinksPanel) backlinksPanel.update(path, docId).catch(() => {})

       // Reflect the real favorite state on the header star button.
       updateFavButtonState()

       // Sync Title
       const metadata = docEngine.doc.getMap('metadata');
       const syncTitle = async (event) => {
           if (window.isUpdatingFromYjs) return;
           const name = metadata.get('filename') || await window.api.basename(path);
           const cleanName = name.replace(/\.md$/, '').replace(/_/g, ' ');
           const currentInput = document.getElementById('doc-title').value;

           if (currentInput !== cleanName) {
                document.getElementById('doc-title').value = cleanName;
                document.getElementById('file-status').textContent = cleanName;

                if (event && event.transaction.origin !== 'user-rename' && event.transaction.origin !== 'sync-from-h1') {
                    await renameFile(name);
                }
           }

           // Programmatic set above doesn't fire input events — push the value
           // into the big page title too.
           if (pageHeader) pageHeader.syncTitle();

           if (event) {
               await ensureH1Title(cleanName);
           }
       };
       metadata.observe(syncTitle);
       syncTitle();
  });

  projectionManager = new ProjectionManager(docEngine, path)
  await projectionManager.reconcile() 
  projectionManager.mount() 
  
  document.querySelectorAll('.tree-item, .sidebar-doc-item, .sidebar-item').forEach(el => el.classList.remove('active'))
  if (activeItem) activeItem.classList.add('active')
  await updateVisibilityStatus()
  await updateHeaderMeta()
  const rawName = await window.api.basename(path)
  const displayFileName = rawName.replace(/\.md$/, '').replace(/_/g, ' ')
  document.getElementById('file-status').textContent = displayFileName
  if (tabManager) tabManager.updateCurrentTab(path, displayFileName)
  const breadcrumbs = document.getElementById('breadcrumbs')
  if (breadcrumbs) {
      if (Store.projectPath && path.startsWith(Store.projectPath)) {
          const rel = path.substring(Store.projectPath.length + 1)
          const parts = rel.split('/')
          if (parts.length > 1) { breadcrumbs.innerHTML = parts.slice(0, -1).map(p => `<span class="crumb">${p.replace(/_/g, ' ')}</span><span style="margin: 0 4px; color: #ccc;">/</span>`).join(''); breadcrumbs.style.display = 'flex' } 
          else { breadcrumbs.innerHTML = ''; breadcrumbs.style.display = 'none' }
      } else breadcrumbs.style.display = 'none'
  }
  let recents = await window.api.getSettings('recentFiles') || []
  recents = recents.filter(f => f !== path); recents.unshift(path); if (recents.length > 10) recents = recents.slice(0, 10); await window.api.setSettings('recentFiles', recents)

  // Track in the Notion-style Recents list (local file).
  window.dispatchEvent(new CustomEvent('cmd:opened-doc', { detail: { type: 'local', path, name: displayFileName } }))
}

function showHomePage() {
  void showNoFileSelected()
}

/**
 * On a genuine first launch (no saved workspace, no joined team, not opened via
 * an invite link), overlay the Paperus welcome screen on top of the normal empty
 * state. Wired to the three real first-run actions; dismissing reveals the
 * workspace underneath. Shown at most once (gated in onboarding.js).
 */
async function maybeFirstRunOnboarding(hadDeepLink) {
  try {
    const isWeb = typeof window !== 'undefined' && (document.body.classList.contains('is-web') || !window.api || !window.api.onMessage)
    const hasTeams = !!(p2pTeamManager && typeof p2pTeamManager.getTeams === 'function' && p2pTeamManager.getTeams().length)
    let hasProject = false
    try { hasProject = !!(window.api && await window.api.getSettings('lastProject')) } catch (_e) { /* settings unavailable */ }
    maybeShowOnboarding({
      isWeb,
      hasTeams,
      hasProject,
      hadDeepLink,
      handlers: {
        onStartWriting: () => { if (isWeb) { void createNewNote() } else { void openProject() } },
        onCreateTeam: () => window.dispatchEvent(new CustomEvent('cmd:create-team')),
        onJoinTeam: () => window.dispatchEvent(new CustomEvent('cmd:join-team')),
        onSkip: () => { /* empty state already mounted underneath */ }
      }
    })
  } catch (e) {
    console.warn('[Main] onboarding check failed', e)
  }
}

// ── Contextual sidebar ─────────────────────────────────────────────────────
// The app rail (Home / Chat / Calendar / Inbox) swaps the nav panel below it,
// mirroring the Workspace Shell design. Each panel is a `.sb-view`; only the
// active app's panel is shown. Safe to call before the panels exist (no-op).
function setSidebarView(view) {
  const valid = ['home', 'chat', 'calendar', 'inbox']
  const v = valid.includes(view) ? view : 'home'
  const panels = document.querySelectorAll('.sb-view')
  if (!panels.length) return
  panels.forEach((el) => { el.style.display = el.id === `sb-view-${v}` ? '' : 'none' })
  // Keep the rail highlight in sync when the view changes programmatically.
  document.querySelectorAll('#appnav .appnav-btn').forEach((b) => {
    if (b.dataset.view) b.classList.toggle('is-active', b.dataset.view === v)
  })
  if (v === 'calendar') { renderMiniMonth(); renderCalendarNav() }
  if (v === 'chat') { renderAgentAvatars(); renderChatRecents() }
  if (v === 'inbox') renderMailNav()
}

// Fill the Chat view's "Recent" list from the Company Brain's saved threads
// (newest first). Clicking a row opens the Brain tab and switches to that
// conversation. Kept in sync via the `brain:threads-changed` event the brain
// fires on every save/load.
function renderChatRecents() {
  const host = document.getElementById('sb-chat-recent')
  if (!host) return
  const threads = (companyBrainCenter && Array.isArray(companyBrainCenter.threads)) ? companyBrainCenter.threads : []
  const recent = threads
    .filter((t) => t && t.id && Array.isArray(t.messages) && t.messages.length)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .slice(0, 30)
  if (!recent.length) {
    host.innerHTML = '<div class="sb-empty">Your chats will appear here.</div>'
    return
  }
  const activeId = companyBrainCenter ? companyBrainCenter.activeThreadId : null
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // Group newest-first into time buckets (Today / Yesterday / Previous 7|30 days /
  // Older), reusing the brain's bucket logic so labels match the threads panel.
  const ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older']
  const bucketOf = (t) => {
    const ts = t.updatedAt || t.createdAt || 0
    return (companyBrainCenter && typeof companyBrainCenter._bucketFor === 'function') ? companyBrainCenter._bucketFor(ts) : 'Older'
  }
  const groups = new Map()
  recent.forEach((t) => { const b = bucketOf(t); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(t) })
  const rowHTML = (t) => `
    <button class="sb-chat-row${t.id === activeId ? ' is-active' : ''}" data-tid="${esc(t.id)}" title="${esc(t.title || 'Untitled chat')}">
      <svg class="sb-chat-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H10l-4 3v-3H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      <span class="sb-chat-nm">${esc(t.title || 'Untitled chat')}</span>
    </button>`
  host.innerHTML = ORDER.filter((b) => groups.has(b)).map((b) => `
    <div class="sidebar-section-header sb-time-header">${b}</div>
    ${groups.get(b).map(rowHTML).join('')}`).join('')
  host.querySelectorAll('.sb-chat-row').forEach((row) => {
    row.addEventListener('click', () => {
      const tid = row.dataset.tid
      if (!tid) return
      tabManager.addTab('@brain', 'Company Brain')
      if (companyBrainCenter) companyBrainCenter.switchThread(tid)
    })
  })
}
window.addEventListener('brain:threads-changed', () => renderChatRecents())

// Paint the Agents avatar row (a horizontal strip of circular persona avatars +
// a dashed "New agent"). Clicking an agent selects it and opens the Brain on a
// fresh chat bound to that persona; the dashed button opens the agent builder.
function renderAgentAvatars() {
  const host = document.getElementById('sb-agents-row')
  if (!host || !companyBrainCenter) return
  const agents = Array.isArray(companyBrainCenter.agents) ? companyBrainCenter.agents : []
  const activeId = companyBrainCenter.activeAgentId
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const cell = (a) => `
    <button class="sb-agent${a.id === activeId ? ' is-active' : ''}" data-aid="${esc(a.id)}" title="${esc(a.name)}">
      ${companyBrainCenter.agentAvatarHTML(a, { size: 34 })}
      <span class="sb-agent-nm">${esc(a.name)}</span>
    </button>`
  host.innerHTML = agents.map(cell).join('') + `
    <button class="sb-agent sb-agent--new" id="sb-agent-new" title="New agent">
      <span class="sb-agent-ic"><svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
      <span class="sb-agent-nm">New agent</span>
    </button>`
  host.querySelectorAll('.sb-agent[data-aid]').forEach((b) => {
    b.addEventListener('click', () => {
      tabManager.addTab('@brain', 'Company Brain')
      companyBrainCenter.setActiveAgent(b.dataset.aid, { newChat: true })
      renderAgentAvatars()
    })
  })
  const newBtn = host.querySelector('#sb-agent-new')
  if (newBtn) newBtn.addEventListener('click', () => companyBrainCenter.openAgentBuilder())
}
window.addEventListener('brain:agents-changed', () => renderAgentAvatars())

// ── Mail (Inbox) sidebar nav ────────────────────────────────────────────────
// Painted into #sb-mail-nav from the Email surface's published `email:nav-state`
// (accounts + real folders + active selection). Clicks dispatch `email:cmd` back
// to the surface — the same vanilla↔island event seam chat recents uses. This is
// what lets Mail live in the ONE main sidebar (no second folder rail).
let lastMailState = null

const MAIL_FOLDER_ICONS = {
  inbox: '<path d="M4 13l2-7h12l2 7v4a1 1 0 01-1 1H5a1 1 0 01-1-1z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 13h4l1 2h6l1-2h4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  starred: '<path d="M12 4l2 5 5 .5-4 3.5 1.5 5L12 15l-4.5 3 1.5-5-4-3.5 5-.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  sent: '<path d="M5 12l4-8h6l4 8M5 12v6a1 1 0 001 1h12a1 1 0 001-1v-6M5 12h14" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  drafts: '<path d="M7 4h7l4 4v12a1 1 0 01-1 1H7a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M13 4v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  archive: '<path d="M4 7h16v3H4zM5 10v8a1 1 0 001 1h12a1 1 0 001-1v-8M10 13h4" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  junk: '<path d="M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M5 7h14M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  folder: '<path d="M4 7a1 1 0 011-1h4l2 2h8a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
}

// special-use / name → {label, order, icon}. Mirrors email/FolderList.classifyFolder.
function mailClassifyFolder(f) {
  const su = String(f.specialUse || f.special_use || '').toLowerCase().replace(/\\/g, '')
  const nm = String(f.name || f.path || '').toLowerCase()
  if (su.includes('inbox') || nm === 'inbox') return { label: 'Inbox', order: 0, icon: 'inbox' }
  if (su.includes('flag') || su.includes('star')) return { label: f.name || 'Starred', order: 0.5, icon: 'starred' }
  if (su.includes('sent') || nm === 'sent') return { label: f.name || 'Sent', order: 1, icon: 'sent' }
  if (su.includes('draft') || nm === 'drafts') return { label: f.name || 'Drafts', order: 2, icon: 'drafts' }
  if (su.includes('archive') || nm === 'archive') return { label: f.name || 'Archive', order: 3, icon: 'archive' }
  if (su.includes('junk') || su.includes('spam') || nm === 'junk' || nm === 'spam') return { label: f.name || 'Junk', order: 4, icon: 'junk' }
  if (su.includes('trash') || su.includes('deleted') || nm === 'trash') return { label: f.name || 'Trash', order: 5, icon: 'trash' }
  return null
}

const MAIL_DEFAULT_FOLDERS = [
  { path: 'INBOX', name: 'Inbox', specialUse: '\\Inbox' },
  { path: 'Sent', name: 'Sent', specialUse: '\\Sent' },
  { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts' },
  { path: 'Trash', name: 'Trash', specialUse: '\\Trash' },
]

// Render the Mail nav from the last published state (or a cold-start skeleton).
function renderMailNav() {
  const host = document.getElementById('sb-mail-nav')
  if (!host) return
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const st = lastMailState || {}
  const accounts = Array.isArray(st.accounts) ? st.accounts : []
  const hasFolders = Array.isArray(st.folders) && st.folders.length
  const folders = hasFolders ? st.folders : MAIL_DEFAULT_FOLDERS
  const activeAccountId = st.activeAccountId || (accounts[0] && accounts[0].id) || null
  const unified = !!st.unified || activeAccountId === '*'
  const activeFolder = st.activeFolder || 'INBOX'

  const icon = (k) => `<span class="sb-folder-ic"><svg viewBox="0 0 24 24" fill="none">${MAIL_FOLDER_ICONS[k] || MAIL_FOLDER_ICONS.folder}</svg></span>`
  const ct = (n) => (Number(n) > 0 ? `<span class="sb-ct">${Number(n) > 999 ? '999+' : Number(n)}</span>` : '')

  let html = '<button class="sb-primary" data-mail="compose"><svg viewBox="0 0 24 24" fill="none"><path d="M4 20l3.5-1L18 8.5 15.5 6 5 16.5 4 20z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 7.5L16.5 10" stroke="currentColor" stroke-width="1.6"/></svg><span>Compose</span></button>'

  // Account switcher — only when there's more than one mailbox.
  if (accounts.length > 1) {
    const totalUnread = accounts.reduce((s, a) => s + (Number(a.unread) || 0), 0)
    html += '<div class="sb-mail-accts">'
    html += `<button class="sb-acct-row${unified ? ' is-active' : ''}" data-mail="acct" data-id="*">`
      + '<span class="sb-acct-av sb-acct-av--all"><svg viewBox="0 0 24 24" fill="none"><path d="M4 13l2-7h12l2 7v4a1 1 0 01-1 1H5a1 1 0 01-1-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 13h4l1 2h6l1-2h4" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>'
      + '<span class="sb-acct-nm">All inboxes</span>' + ct(totalUnread) + '</button>'
    for (const a of accounts) {
      const on = !unified && a.id === activeAccountId
      const initial = esc(String(a.name || a.email || '?').trim().slice(0, 1).toUpperCase())
      html += `<button class="sb-acct-row${on ? ' is-active' : ''}" data-mail="acct" data-id="${esc(a.id)}" title="${esc(a.email || '')}">`
        + `<span class="sb-acct-av" style="background:${esc(a.color || 'var(--pp-ws-accent)')}">${initial}</span>`
        + `<span class="sb-acct-nm">${esc(a.name || a.email || 'Mailbox')}</span>` + ct(a.unread) + '</button>'
    }
    html += '</div><div class="sb-mail-sep"></div>'
  }

  // Folder rows — hidden while "All inboxes" is active (that view IS the merge).
  if (!unified) {
    const specials = []
    const others = []
    for (const f of folders) {
      const c = mailClassifyFolder(f)
      if (c) specials.push({ f, c }); else others.push(f)
    }
    specials.sort((a, b) => a.c.order - b.c.order)
    for (const { f, c } of specials) {
      const on = (f.path || f.name) === activeFolder
      html += `<button class="sb-folder${on ? ' is-active' : ''}" data-mail="folder" data-path="${esc(f.path || f.name)}">`
        + icon(c.icon) + `<span class="sb-folder-nm">${esc(c.label)}</span>` + ct(f.unread) + '</button>'
    }
    if (others.length) {
      html += '<div class="sb-mail-subhead">More</div>'
      others.sort((a, b) => String(a.name || a.path).localeCompare(String(b.name || b.path)))
      for (const f of others) {
        const on = (f.path || f.name) === activeFolder
        html += `<button class="sb-folder${on ? ' is-active' : ''}" data-mail="folder" data-path="${esc(f.path || f.name)}">`
          + icon('folder') + `<span class="sb-folder-nm">${esc(f.name || f.path)}</span>` + ct(f.unread) + '</button>'
      }
    }
  }

  // Footer — add / manage accounts.
  html += '<div class="sb-mail-sep"></div><div class="sb-mail-foot">'
  html += '<button class="sb-folder" data-mail="add"><span class="sb-folder-ic"><svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span><span class="sb-folder-nm">Add account</span></button>'
  html += '<button class="sb-folder" data-mail="manage"><span class="sb-folder-ic"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M12 3v2M12 19v2M21 12h-2M5 12H3M18.4 5.6l-1.4 1.4M7 17l-1.4 1.4M18.4 18.4 17 17M7 7 5.6 5.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span><span class="sb-folder-nm">Manage</span></button>'
  html += '</div>'

  host.innerHTML = html
  host.querySelectorAll('[data-mail]').forEach((el) => {
    el.addEventListener('click', () => {
      const kind = el.dataset.mail
      if (kind === 'compose') mailCmd({ type: 'compose' })
      else if (kind === 'add') mailCmd({ type: 'add-account' })
      else if (kind === 'manage') mailCmd({ type: 'manage' })
      else if (kind === 'acct') mailCmd({ type: 'account', id: el.dataset.id })
      else if (kind === 'folder') mailCmd({ type: 'folder', path: el.dataset.path })
    })
  })
}

// Dispatch a sidebar→surface mail command, opening the Email tab first. The
// desired selection is also stashed on window.__mailNav so a cold-mounting
// surface can apply it before the live event arrives.
function mailCmd(detail) {
  try {
    const prev = window.__mailNav || {}
    if (detail.type === 'account') window.__mailNav = { accountId: detail.id, folder: prev.folder || null }
    else if (detail.type === 'folder') {
      const acct = (lastMailState && lastMailState.activeAccountId) || prev.accountId || null
      window.__mailNav = { accountId: acct, folder: detail.path }
    }
    tabManager.addTab('@email', 'Email')
    window.dispatchEvent(new CustomEvent('email:cmd', { detail }))
  } catch (e) { console.warn('[mail] cmd failed', e) }
}

window.addEventListener('email:nav-state', (e) => { lastMailState = (e && e.detail) || null; renderMailNav() })

// ── Calendar sidebar: connected CalDAV calendars ─────────────────────────────
// Paints #sb-cal-connected from calendar:calendars; each row toggles its own
// visibility (calendar:calendarSetVisible) and nudges the Calendar surface to
// refetch via a calendar:changed event. The account wizard lives in the surface.
const CAL_EYE = '<svg viewBox="0 0 24 24" fill="none"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.5"/></svg>'
const CAL_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 4l16 16M10 5.2A9.7 9.7 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3 3.6M6.2 7.4A17 17 0 002 12s3.5 7 10 7a9.6 9.6 0 003.3-.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'

async function renderCalendarNav() {
  const host = document.getElementById('sb-cal-connected')
  if (!host) return
  if (!(window.api && window.api.invoke)) { host.innerHTML = ''; return }
  let cals = []
  try {
    const res = await window.api.invoke('calendar:calendars', {})
    if (res && res.ok) cals = res.calendars || []
  } catch (_e) { /* offline or calendar IPC not registered */ }
  if (!cals.length) { host.innerHTML = ''; return }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const isOn = (c) => c.visible !== 0 && c.visible !== false
  host.innerHTML = cals.map((c) => (
    `<button class="sb-cal-row${isOn(c) ? '' : ' is-hidden'}" data-cal-id="${esc(c.id)}" title="${esc(c.name || '')}">`
    + `<span class="sb-dot" style="background:${esc(c.color || '#9B9A97')}"></span>`
    + `<span class="sb-cal-nm">${esc(c.name || 'Calendar')}</span>`
    + `<span class="sb-cal-eye">${isOn(c) ? CAL_EYE : CAL_EYE_OFF}</span></button>`
  )).join('')
  host.querySelectorAll('[data-cal-id]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.dataset.calId
      const cal = cals.find((c) => String(c.id) === String(id))
      const next = !(cal && isOn(cal))
      try {
        await window.api.invoke('calendar:calendarSetVisible', { calendarId: id, visible: next })
        window.dispatchEvent(new CustomEvent('calendar:changed', { detail: { calendarId: id } }))
      } catch (_e) { /* noop */ }
      renderCalendarNav()
    })
  })
}

// Render a month into the Calendar view's mini-month. Today is marked; clicking
// a day opens the Calendar surface. `ref` (a Date) drives prev/next navigation.
let _miniMonthRef = null
function renderMiniMonth(ref) {
  const host = document.getElementById('sb-cal-mini')
  if (!host) return
  const base = ref instanceof Date ? ref : (_miniMonthRef || new Date())
  _miniMonthRef = base
  const year = base.getFullYear()
  const month = base.getMonth()
  const today = new Date()
  const isThisMonth = today.getFullYear() === year && today.getMonth() === month
  const monthName = base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const firstDow = new Date(year, month, 1).getDay()
  const dayCount = new Date(year, month + 1, 0).getDate()
  const dows = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  let cells = ''
  for (let i = 0; i < firstDow; i += 1) cells += '<div class="sb-mini-day sb-mini-empty"></div>'
  for (let d = 1; d <= dayCount; d += 1) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isToday = isThisMonth && today.getDate() === d
    cells += `<div class="sb-mini-day${isToday ? ' is-today' : ''}" data-iso="${iso}">${d}</div>`
  }
  host.innerHTML = `
    <div class="sb-mini-head">
      <span class="sb-mini-title">${monthName}</span>
      <div class="sb-mini-nav">
        <button class="sb-mini-arrow" data-mini="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" fill="none"><path d="M14 7l-5 5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="sb-mini-arrow" data-mini="1" aria-label="Next month"><svg viewBox="0 0 24 24" fill="none"><path d="M10 7l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    </div>
    <div class="sb-mini-grid">
      ${dows.map((x) => `<div class="sb-mini-dow">${x}</div>`).join('')}
      ${cells}
    </div>`
  host.querySelectorAll('.sb-mini-arrow').forEach((a) => {
    a.addEventListener('click', () => { renderMiniMonth(new Date(year, month + Number(a.dataset.mini), 1)) })
  })
  host.querySelectorAll('.sb-mini-day[data-iso]').forEach((cell) => {
    cell.addEventListener('click', () => {
      try { tabManager.addTab('@calendar', 'Calendar') } catch (_e) { /* noop */ }
    })
  })
}

async function showNoFileSelected() {
  console.log('[UI] Showing no-file state')
  currentOpenPath = null
  if (backlinksPanel) backlinksPanel.clear()
  if (pageHeader) pageHeader.clear()
  const home = document.getElementById('home-view')
  const mainWrapper = document.querySelector('main')
  const header = document.querySelector('.app-header')
  const footer = document.querySelector('footer')
  const tabs = document.querySelector('.tabs-header')
  document.querySelectorAll('.tree-item.active, .sidebar-doc-item.active, .sidebar-item.active').forEach(el => el.classList.remove('active'))
  setSidebarView('home')
  if (home) {
      hideContentViews('home-view')
      home.style.display = 'flex'
      const editor = document.querySelector('.editor-container')
      if (editor) editor.style.display = 'none'
      if (mainWrapper) mainWrapper.style.display = 'flex'
      if (header) header.style.display = 'flex'
      if (footer) footer.style.display = 'flex'
      if (tabs) tabs.style.display = 'flex'
      const titleInput = document.getElementById('doc-title')
      if (titleInput) { titleInput.value = ''; titleInput.placeholder = 'Select a document'; titleInput.disabled = true }
  }
  if (!home) return
  home.innerHTML = `
    <div style="display:flex; width:100%; height:100%; align-items:center; justify-content:center; padding:32px;">
      <div style="text-align:center; max-width:520px;">
        <div style="font-size:24px; font-weight:600; margin-bottom:8px; color:#222;">Select a document to start</div>
        <div style="font-size:14px; color:#666; margin-bottom:20px;">Open a file from the sidebar, create a new note, or open a local folder.</div>
        <div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap;">
          <button id="no-file-new-note" class="btn">New Note</button>
          <button id="no-file-open-folder" class="btn btn-secondary">Open Folder</button>
        </div>
      </div>
    </div>
  `
  const newNoteBtn = document.getElementById('no-file-new-note')
  const openFolderBtn = document.getElementById('no-file-open-folder')
  if (newNoteBtn) newNoteBtn.onclick = () => { void createNewNote() }
  if (openFolderBtn) openFolderBtn.onclick = () => { void openProject() }
}

function hideNoFileSelected() {
  const editor = document.querySelector('.editor-container')
  const mainEl = document.querySelector('main')
  const footer = document.querySelector('footer')
  const header = document.querySelector('.app-header')
  hideContentViews(null) // editor takes over: hide home/brain/lab/studio
  if (mainEl) mainEl.style.display = 'flex'
  if (editor) editor.style.display = 'flex'
  if (footer) footer.style.display = 'flex'
  // A document is active again — restore the doc header the Brain page hid.
  if (header) header.style.display = 'flex'
  const titleInput = document.getElementById('doc-title')
  if (titleInput) {
    titleInput.disabled = false
    if (titleInput.placeholder === 'Home' || titleInput.placeholder === 'Select a document' || titleInput.placeholder === 'Company Brain') titleInput.placeholder = 'Untitled'
  }
  setReadOnly(cmView, false)
}

async function showCompanyBrainPage() {
  currentOpenPath = null
  if (backlinksPanel) backlinksPanel.clear()
  if (pageHeader) pageHeader.clear()
  
  const home = document.getElementById('home-view')
  const brain = document.getElementById('brain-view')
  const editor = document.querySelector('.editor-container')
  const mainWrapper = document.querySelector('main')
  const header = document.querySelector('.app-header')
  const footer = document.querySelector('footer')
  const tabs = document.querySelector('.tabs-header')
  
  document.querySelectorAll('.tree-item.active, .sidebar-doc-item.active, .sidebar-item.active').forEach(el => el.classList.remove('active'))
  
  setSidebarView('chat')

  hideContentViews('brain-view')
  if (brain) {
      brain.style.display = 'flex'
      if (companyBrainCenter) {
          // Trigger workspace index if not loaded
          if (companyBrainCenter.engine.status === 'idle' && Store.projectPath) {
              companyBrainCenter.initializeWorkspace(Store.projectPath)
          }
      }
  }
  if (editor) editor.style.display = 'none'
  if (mainWrapper) mainWrapper.style.display = 'flex'
  // The Brain is its own surface (its own topbar) — it doesn't need the document
  // header (title/breadcrumb/visibility) OR the editor footer (cursor/word-count/
  // clock). hideNoFileSelected restores both when a note takes over again.
  if (header) header.style.display = 'none'
  if (footer) footer.style.display = 'none'
  if (tabs) tabs.style.display = 'flex'
}
