import Store from './store'
import { Features } from './features'

export class SidebarManager {
    constructor(context) {
        this.context = context
        this.sharedDocIds = new Set()
    }

    async renderSidebarLists() {
        await this.updateLimitBanner()
        // Render the Favorites + Recent sections at the top of the sidebar.
        await this.renderFavorites()
        await this.renderRecents()
        // Render the local-first Teamspaces groups (above the file tree).
        await this.renderTeamspaces()
        const teamList = document.getElementById('teamspaces-list')
        const sharedList = document.getElementById('shared-list')

        // Accountless "Join shared doc via link/code" affordance. Mounted once
        // into the Shared section and kept independent of the auth-gated list
        // below so it works even when not signed in.
        this._renderJoinSharedAffordance()

        // Cloud, account-based teams are removed in the open-source build. P2P
        // teams render via P2PTeamManager (main.js renderP2PTeams) into the
        // #teamspaces-list host, so the legacy authClient-driven team/shared
        // list is skipped entirely (no sign-in wall, no auth-client import at
        // boot). IMPORTANT: do NOT clear #teamspaces-list here — it is owned by
        // the P2P render; clearing it would wipe the Teams section on every
        // sidebar refresh.
        if (!Features.teams) {
            if (sharedList) sharedList.innerHTML = ''
            this.sharedDocIds.clear()
            return
        }

        if (!teamList) return

        try {
            const { authClient } = await import('./auth-client')
            let user = null
            let teams = []
            let sharedDocs = []

            // Try to fetch data, fallback to cache if offline
            try {
                user = await authClient.getMe()
                if (user) {
                    teams = await authClient.getTeams()
                    sharedDocs = await authClient.getSharedDocuments()
                    
                    // Update cache
                    localStorage.setItem('cached_teams', JSON.stringify(teams))
                    localStorage.setItem('cached_shared_docs', JSON.stringify(sharedDocs))
                    localStorage.setItem('cached_user_status', 'active')
                } else {
                    localStorage.removeItem('cached_user_status')
                }
            } catch (e) {
                console.warn('[Sidebar] Offline or fetch failed, using cache:', e)
                // Use cache
                if (localStorage.getItem('cached_user_status') === 'active') {
                    // Fake a user object just to trigger rendering
                    user = { id: -1, email: 'offline' } 
                    teams = JSON.parse(localStorage.getItem('cached_teams') || '[]')
                    sharedDocs = JSON.parse(localStorage.getItem('cached_shared_docs') || '[]')
                }
            }

            // Defensive dedupe by doc id to prevent duplicate shared entries in UI
            sharedDocs = Array.from(
                new Map((sharedDocs || [])
                    .filter((d) => d && d.id)
                    .map((d) => [d.id, d])
                ).values()
            )
            
            teamList.innerHTML = '' 
            
            if (!user) {
                teamList.innerHTML = '<div style="padding: 4px 12px; font-size: 12px; color: #999; font-style: italic;">Sign in to view teams</div>'
                if (sharedList) sharedList.innerHTML = ''
                this.sharedDocIds.clear()
                return
            }

            // 0. E2EE Status Check
            if (user.encryptedPrivateKey && !authClient.e2ee.privateKey) {
                const vaultItem = document.createElement('div');
                vaultItem.style.cssText = 'margin: 8px; padding: 10px; background: #fff4e5; border: 1px solid #ffe2b3; border-radius: 6px; cursor: pointer;';
                vaultItem.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px; color: #856404;">
                        <i class="fas fa-lock" style="font-size: 12px;"></i>
                        <span style="font-size: 11px; font-weight: 600;">Vault Locked</span>
                    </div>
                    <div style="font-size: 10px; color: #856404; margin-top: 4px; opacity: 0.8;">Unlock to access encrypted notes.</div>
                `;
                vaultItem.onclick = () => window.dispatchEvent(new CustomEvent('cmd:open-team-manager'));
                teamList.appendChild(vaultItem);
            }
            
            // 1. Fetch shared documents to track which local files are shared
            // (Already fetched above or loaded from cache)
            this.sharedDocIds = new Set(sharedDocs.map(d => d.id))
            
            // Teams already fetched above
            
            if (teams.length === 0) {
                // If user is logged in but has no teams, show explicit empty state or "Join Team" hint
                // But don't say "No teamspaces joined" if it looks like an error.
                // Actually "No teamspaces joined" is correct.
                
                // Check if user is actually logged in to avoid confusion
                if (user && user.id) {
                     teamList.innerHTML = `
                        <div style="padding: 12px; text-align: center; color: #999; border: 1px dashed #eee; border-radius: 6px; margin: 8px;">
                            <div style="font-size: 11px; margin-bottom: 8px;">You haven't joined any teamspaces.</div>
                            <button id="sidebar-create-team-btn" style="background: white; border: 1px solid #ddd; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; color: #555;">Create Team</button>
                        </div>
                     `
                     const btn = document.getElementById('sidebar-create-team-btn')
                     if(btn) btn.onclick = () => document.getElementById('create-team-btn').click()
                } else {
                     teamList.innerHTML = '<div style="padding: 4px 12px; font-size: 12px; color: #999; font-style: italic;">No teamspaces joined</div>'
                }
            } else {
                for (const team of teams) {
                    const teamItem = document.createElement('div')
                    teamItem.className = 'sidebar-team-item'
                    
                    const header = document.createElement('div')
                    header.className = 'sidebar-team-header'
                    header.innerHTML = `
                        <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; margin-right: 4px;">
                            <i class="fas fa-chevron-circle-right" style="font-size: 10px; color: #c4c4c4; transition: transform 0.2s;"></i>
                        </div>
                        <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; margin-right: 6px;">
                            <i class="fas fa-home" style="font-size: 12px; color: #ea4e43;"></i>
                        </div>
                        <span style="font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${team.name}</span>
                    `
                    
                    const children = document.createElement('div')
                    children.className = 'sidebar-team-children'
                    
                    let isLoaded = false
                    
                    header.onclick = async (e) => {
                        e.stopPropagation()
                        const caret = header.querySelector('.fa-chevron-circle-right')
                        if (children.classList.contains('expanded')) {
                            children.classList.remove('expanded')
                            header.classList.remove('expanded')
                            if (caret) caret.style.transform = 'rotate(0deg)'
                        } else {
                            children.classList.add('expanded')
                            header.classList.add('expanded')
                            if (caret) caret.style.transform = 'rotate(90deg)'
                            
                            if (!isLoaded) {
                                children.innerHTML = '<div class="sidebar-doc-item loading">Loading...</div>'
                                try {
                                    const details = await authClient.getTeamDetails(team.id)
                                    const docs = details.documents || []
                                    
                                    children.innerHTML = ''
                                    
                                    if (docs.length === 0) {
                                        children.innerHTML = '<div class="sidebar-empty-msg">No documents</div>'
                                    } else {
                                        docs.forEach(doc => {
                                            const docItem = document.createElement('div')
                                            docItem.className = 'sidebar-doc-item'
                                            docItem.dataset.docId = doc.id
                                            docItem.innerHTML = `
                                                <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; margin-left: 20px; margin-right: 6px;">
                                                    <i class="far fa-file-alt" style="font-size: 12px; color: #999;"></i>
                                                </div>
                                                <span class="doc-name-label" style="font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${(doc.name || 'Untitled').replace(/\.(md|txt)$/, '').replace(/_/g, ' ')}</span>
                                                <i class="fas fa-globe" style="font-size: 10px; color: #ccc; margin-left: 4px;" title="Shared with ${team.name}"></i>
                                            `
                                            docItem.onclick = () => {
                                                window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: { id: doc.id, name: doc.name } }))
                                            }
                                            children.appendChild(docItem)
                                        })
                                    }
                                    isLoaded = true
                                } catch (e) {
                                    children.innerHTML = '<div class="sidebar-empty-msg" style="color:red;">Failed to load</div>'
                                    console.error(e)
                                }
                            }
                        }
                    }
                    
                    teamItem.appendChild(header)
                    teamItem.appendChild(children)
                    teamList.appendChild(teamItem)
                }
            }

            // 2. Render Shared Section
            // Backend already excludes own docs, so sharedDocs = only docs from others
            if (sharedList) {
                sharedList.innerHTML = ''

                if (sharedDocs.length === 0) {
                    sharedList.innerHTML = '<div style="padding: 8px 16px; font-size: 12px; color: #bbb; font-style: italic;">No shared documents</div>'
                } else {
                    // Group by owner, then by folder within each owner
                    const byOwner = new Map();
                    sharedDocs.forEach(doc => {
                        const ownerName = doc.creator ? ((doc.creator.displayName || doc.creator.email || 'Unknown').split('@')[0]) : 'Unknown';
                        if (!byOwner.has(ownerName)) byOwner.set(ownerName, { folders: new Map(), loose: [] });
                        const ownerData = byOwner.get(ownerName);

                        if (doc.folder && doc.folder.name) {
                            if (!ownerData.folders.has(doc.folder.name)) {
                                ownerData.folders.set(doc.folder.name, []);
                            }
                            ownerData.folders.get(doc.folder.name).push(doc);
                        } else {
                            ownerData.loose.push(doc);
                        }
                    });

                    const sortedOwners = Array.from(byOwner.keys()).sort();

                    sortedOwners.forEach(owner => {
                        const ownerSection = document.createElement('div');
                        ownerSection.className = 'sidebar-team-item';

                        const header = document.createElement('div');
                        header.className = 'sidebar-team-header';
                        header.innerHTML = `
                            <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; margin-right: 4px;">
                                <i class="fas fa-chevron-circle-right" style="font-size: 10px; color: #c4c4c4; transition: transform 0.2s;"></i>
                            </div>
                            <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; margin-right: 6px;">
                                <i class="fas fa-user-circle" style="font-size: 12px; color: #007bff;"></i>
                            </div>
                            <span style="font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${owner}</span>
                        `;

                        const children = document.createElement('div');
                        children.className = 'sidebar-team-children';

                        const ownerData = byOwner.get(owner);

                        // Render folders first
                        const sortedFolders = Array.from(ownerData.folders.keys()).sort();
                        sortedFolders.forEach(folderName => {
                            const folderItem = document.createElement('div');
                            folderItem.style.cssText = 'margin-left: 8px;';

                            const folderHeader = document.createElement('div');
                            folderHeader.className = 'sidebar-doc-item';
                            folderHeader.style.cssText = 'font-weight: 500;';
                            folderHeader.innerHTML = `
                                <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; margin-left: 12px; margin-right: 4px;">
                                    <i class="fas fa-chevron-circle-right" style="font-size: 9px; color: #c4c4c4; transition: transform 0.2s;"></i>
                                </div>
                                <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; margin-right: 6px;">
                                    <i class="fas fa-folder" style="font-size: 11px; color: #e8a838;"></i>
                                </div>
                                <span style="font-size: 12px; color: #333;">${folderName}</span>
                            `;

                            const folderChildren = document.createElement('div');
                            folderChildren.style.cssText = 'display: none; margin-left: 12px;';

                            ownerData.folders.get(folderName).forEach(doc => {
                                folderChildren.appendChild(this._createSharedDocItem(doc));
                            });

                            folderHeader.onclick = (e) => {
                                e.stopPropagation();
                                const caret = folderHeader.querySelector('.fa-chevron-circle-right');
                                const isOpen = folderChildren.style.display !== 'none';
                                folderChildren.style.display = isOpen ? 'none' : 'block';
                                caret.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
                                const folderIcon = folderHeader.querySelector('.fa-folder, .fa-folder-open');
                                if (folderIcon) {
                                    folderIcon.className = isOpen ? 'fas fa-folder' : 'fas fa-folder-open';
                                }
                            };

                            folderItem.appendChild(folderHeader);
                            folderItem.appendChild(folderChildren);
                            children.appendChild(folderItem);
                        });

                        // Render loose docs (not in folders)
                        ownerData.loose.forEach(doc => {
                            children.appendChild(this._createSharedDocItem(doc));
                        });

                        // Toggle Logic
                        header.onclick = (e) => {
                            e.stopPropagation();
                            const caret = header.querySelector('.fa-chevron-circle-right');
                            children.classList.toggle('expanded');
                            header.classList.toggle('expanded');
                            if (children.classList.contains('expanded')) {
                                caret.style.transform = 'rotate(90deg)';
                            } else {
                                caret.style.transform = 'rotate(0deg)';
                            }
                        };

                        ownerSection.appendChild(header);
                        ownerSection.appendChild(children);
                        sharedList.appendChild(ownerSection);
                    });
                }
            }
        } catch (e) {
            console.error('Failed to render sidebar lists:', e)
        }
    }

    _createSharedDocItem(doc) {
        const docItem = document.createElement('div');
        docItem.className = 'sidebar-doc-item';
        docItem.dataset.docId = doc.id;
        docItem.innerHTML = `
            <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; margin-left: 20px; margin-right: 6px;">
                <i class="far fa-file-alt" style="font-size: 12px; color: #999;"></i>
            </div>
            <span class="doc-name-label" style="font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">
                ${(doc.name || 'Untitled').replace(/\.(md|txt)$/, '').replace(/_/g, ' ')}
            </span>
        `;
        docItem.onclick = () => {
            window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: { id: doc.id, name: doc.name } }));
        };
        return docItem;
    }

    /**
     * Mount a "Join via link / code" affordance into the Shared section.
     * Lets anyone paste a share link or room code to open and sync a document
     * peer-to-peer — no account required. Idempotent: reuses an existing node
     * so repeated renders don't duplicate or wipe it.
     */
    _renderJoinSharedAffordance() {
        const section = document.getElementById('shared-section');
        const sharedList = document.getElementById('shared-list');
        if (!section) return;

        let row = document.getElementById('join-shared-row');
        if (!row) {
            row = document.createElement('div');
            row.id = 'join-shared-row';
            row.style.cssText = 'padding: 4px 12px 8px 0px;';
            row.innerHTML = `
                <div id="join-shared-trigger" class="sidebar-doc-item" style="font-size: 12px; color: #2383e2; cursor: pointer; display: flex; align-items: center;">
                    <div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;margin-right:0;">
                        <i class="fas fa-link" style="font-size: 11px;"></i>
                    </div>
                    <span>Join via link or code</span>
                </div>
                <div id="join-shared-form" style="display: none; margin-top: 8px;">
                    <input type="text" id="join-shared-input" placeholder="Paste share link or code" style="width: 100%; padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                    <div style="display: flex; gap: 6px; margin-top: 6px;">
                        <button class="btn btn-secondary" id="join-shared-cancel" style="font-size: 11px; padding: 4px 8px;">Cancel</button>
                        <button class="btn" id="join-shared-go" style="font-size: 11px; padding: 4px 8px;">Join</button>
                    </div>
                    <div id="join-shared-error" style="display: none; color: #d32f2f; font-size: 11px; margin-top: 4px;"></div>
                </div>
            `;
            // Insert at the top of the Shared section, before the auth-gated list.
            if (sharedList && sharedList.parentNode === section) {
                section.insertBefore(row, sharedList);
            } else {
                section.appendChild(row);
            }

            const trigger = row.querySelector('#join-shared-trigger');
            const form = row.querySelector('#join-shared-form');
            const input = row.querySelector('#join-shared-input');
            const errorEl = row.querySelector('#join-shared-error');
            const cancelBtn = row.querySelector('#join-shared-cancel');
            const goBtn = row.querySelector('#join-shared-go');

            const showError = (msg) => {
                errorEl.textContent = msg;
                errorEl.style.display = msg ? 'block' : 'none';
            };

            trigger.onclick = () => {
                form.style.display = 'block';
                trigger.style.display = 'none';
                showError('');
                input.focus();
            };

            cancelBtn.onclick = () => {
                form.style.display = 'none';
                trigger.style.display = 'flex';
                input.value = '';
                showError('');
            };

            const submit = async () => {
                showError('');
                const raw = input.value.trim();
                if (!raw) { showError('Paste a team or share link.'); return; }
                let handled = false;
                try {
                    const p2p = await import('./p2p');
                    // 1) A team link grants the whole shared workspace.
                    const teamKey = p2p.parseTeamCode(raw);
                    if (teamKey) {
                        window.dispatchEvent(new CustomEvent('cmd:join-team', { detail: { rootKey: teamKey } }));
                        handled = true;
                    } else {
                        // 2) Otherwise treat it as a single-doc share token (v1 or v2).
                        const token = p2p.parseShareToken(raw);
                        if (token) {
                            window.dispatchEvent(new CustomEvent('cmd:join-shared-room', { detail: { token } }));
                            handled = true;
                        }
                    }
                } catch (e) {
                    console.error('[Sidebar] Failed to parse link:', e);
                }
                if (!handled) { showError('That doesn’t look like a valid team or share link.'); return; }
                form.style.display = 'none';
                trigger.style.display = 'flex';
                input.value = '';
            };

            goBtn.onclick = submit;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') cancelBtn.click();
            };
        }
    }


    async renderWorkspace(inputTrees, files = []) {
        const treeContainer = document.getElementById('file-tree')
        if (treeContainer) {
            treeContainer.style.display = 'block'
            treeContainer.innerHTML = ''
        }
        
        if (!treeContainer) return
        
        const list = document.createElement('ul')
        list.className = 'tree-list'
        
        let trees = inputTrees;
        
        // Use File System Abstraction
        if (this.context.fileSystem && this.context.fileSystem.isCloud) {
             // Cloud Mode: Load Root
             trees = [];
             try {
                 const rootTree = await this.context.fileSystem.getDirectoryTree('root');
                 trees.push(rootTree);
             } catch (e) {
                 console.error('Failed to load cloud root:', e);
             }
        }
        
        trees.forEach(tree => {
            const rootLi = document.createElement('li')
            const div = document.createElement('div')
            div.className = 'tree-item section-header'
            div.style.fontWeight = '600'
            div.style.color = '#555'
            div.dataset.path = tree.path
            div.style.paddingLeft = '12px' 
            
            div.innerHTML = `<i class="fas fa-chevron-circle-down tree-icon"></i> ${tree.name}`
            rootLi.appendChild(div)
            
            const childUl = document.createElement('ul')
            childUl.className = 'tree-list nested-list expanded' 
            
            if (tree.children) {
                tree.children.forEach(child => {
                    if (child.name === 'Shared') return
                    if (child.name.startsWith('.')) return
                    childUl.appendChild(this.createNode(child))
                })
            }
            
            rootLi.appendChild(childUl)
            list.appendChild(rootLi)
            
            div.addEventListener('click', (e) => {
                e.stopPropagation()
                const isExpanded = childUl.classList.toggle('expanded')
                div.querySelector('.tree-icon').className = isExpanded 
                    ? 'fas fa-chevron-circle-down tree-icon' 
                    : 'fas fa-chevron-circle-right tree-icon'
            })
            
            div.addEventListener('contextmenu', (e) => {
                const ctxMenu = this.context.getContextMenu()
                if (ctxMenu) {
                    ctxMenu.show(e, tree.path, 'directory', { isRoot: true })
                }
            })
        })
        
        if (files.length > 0) {
            const filesLi = document.createElement('li')
            const div = document.createElement('div')
            div.className = 'tree-item section-header'
            div.style.fontWeight = '600'
            div.style.color = '#555'
            div.style.paddingLeft = '12px' 
            div.style.marginTop = '10px'
            
            const { authClient } = await import('./auth-client')
            const user = await authClient.getMe().catch(() => null)
            const isWeb = !window.api.onMessage;
            
            const listTitle = isWeb ? 'Drafts (Local)' : 'Open Files'
            div.innerHTML = `<i class="fas fa-chevron-circle-down tree-icon"></i> ${listTitle}`
            filesLi.appendChild(div)
            
            const filesUl = document.createElement('ul')
            filesUl.className = 'tree-list nested-list expanded'
            
            for (const filePath of files) {
                if (await window.api.pathExists(filePath)) {
                    const name = await window.api.basename(filePath)
                    const displayName = name.replace(/_/g, ' ')
                    const li = document.createElement('li')
                    const itemDiv = document.createElement('div')
                    itemDiv.className = 'tree-item'
                    itemDiv.dataset.path = filePath
                    itemDiv.innerHTML = `<i class="far fa-file-alt tree-icon"></i> ${displayName}`
                    itemDiv.addEventListener('click', () => this.context.openFile(filePath))
                    li.appendChild(itemDiv)
                    filesUl.appendChild(li)
                }
            }
            
            filesLi.appendChild(filesUl)
            list.appendChild(filesLi)
        }
        
        treeContainer.appendChild(list)
    }

    createNode(item) {
        const li = document.createElement('li')
        const div = document.createElement('div')
        div.className = 'tree-item'
        div.dataset.path = item.path
        
        div.addEventListener('contextmenu', (e) => {
            const ctxMenu = this.context.getContextMenu()
            if (ctxMenu) {
                ctxMenu.show(e, item.path, item.type)
            }
        })

        const icon = document.createElement('i')
        icon.className = item.type === 'directory' 
            ? 'fas fa-chevron-circle-right tree-icon' 
            : 'far fa-file-alt tree-icon'
            
        div.appendChild(icon)
        
        const label = document.createElement('span')
        label.className = 'doc-name-label'
        label.textContent = item.name.replace(/_/g, ' ')
        label.style.whiteSpace = 'nowrap'
        label.style.overflow = 'hidden'
        label.style.textOverflow = 'ellipsis'
        label.style.flex = '1'
        label.title = item.name.replace(/_/g, ' ')
        
        div.appendChild(label)
        
        // Stored locally Icon
        const statusIcon = document.createElement('i')
        statusIcon.className = 'fas fa-desktop'
        statusIcon.style.fontSize = '10px'
        statusIcon.style.color = '#ccc'
        statusIcon.style.marginLeft = 'auto'
        statusIcon.title = 'Stored locally'
        div.appendChild(statusIcon)
        
        // Shared Icon (Owned)
        if (item.type !== 'directory') {
            if (this.context.fileSystem && this.context.fileSystem.getDocId) {
                this.context.fileSystem.getDocId(item.path).then(docId => {
                     if (docId && this.sharedDocIds.has(docId)) {
                         const sharedIcon = document.createElement('i')
                         sharedIcon.className = 'fas fa-share-alt'
                         sharedIcon.style.fontSize = '10px'
                         sharedIcon.style.color = '#007bff'
                         sharedIcon.style.marginLeft = '4px'
                         sharedIcon.title = 'Shared Document'
                         div.insertBefore(sharedIcon, statusIcon)
                     }
                })
            }
        }

        li.appendChild(div)

        if (item.type === 'directory') { 
            const childUl = document.createElement('ul')
            childUl.className = 'tree-list nested-list'
            
            if (item.children && item.children.length > 0) {
                item.children.forEach(child => {
                    if (child.name.startsWith('.')) return
                    childUl.appendChild(this.createNode(child))
                })
            }
            li.appendChild(childUl)

            div.addEventListener('click', async (e) => {
                e.stopPropagation()
                const isExpanded = childUl.classList.toggle('expanded')
                icon.className = isExpanded 
                    ? 'fas fa-chevron-circle-down tree-icon' 
                    : 'fas fa-chevron-circle-right tree-icon'
                    
                if (isExpanded && childUl.children.length === 0) {
                    // Use abstracted getDirectoryTree
                    let subTree = null;
                    if (this.context.fileSystem && this.context.fileSystem.getDirectoryTree) {
                         subTree = await this.context.fileSystem.getDirectoryTree(item.path);
                    } else {
                         // Fallback for legacy local (shouldn't happen if wired correctly)
                         subTree = await window.api.invoke('fs:getDirectoryTree', item.path)
                    }

                    if (subTree && subTree.children) {
                        childUl.innerHTML = '' 
                        subTree.children.forEach(child => {
                            if (child.name.startsWith('.')) return
                            childUl.appendChild(this.createNode(child))
                        })
                    } else {
                        const empty = document.createElement('li')
                        empty.innerHTML = '<span style="color: #ccc; font-size: 11px; padding-left: 20px;">(Empty)</span>'
                        childUl.appendChild(empty)
                    }
                }
            })
        } else {
            div.addEventListener('click', () => this.context.openFile(item.path))
        }

        return li
    }

    revealLocalItem(activeItem) {
        if (!activeItem) return

        let node = activeItem
        while (node && node !== document.body) {
            // Expand local tree nested folders
            if (node.classList && node.classList.contains('nested-list') && !node.classList.contains('expanded')) {
                node.classList.add('expanded')
                const li = node.parentElement
                const header = li ? Array.from(li.children).find((c) => c.classList && c.classList.contains('tree-item')) : null
                if (header) {
                    const icon = header.querySelector('.tree-icon')
                    if (icon) icon.className = 'fas fa-chevron-circle-down tree-icon'
                }
            }

            // Expand shared/team style sections
            if (node.classList && node.classList.contains('sidebar-team-children') && !node.classList.contains('expanded')) {
                node.classList.add('expanded')
                const parent = node.parentElement
                const header = parent ? parent.querySelector('.sidebar-team-header') : null
                if (header) {
                    header.classList.add('expanded')
                    const caret = header.querySelector('.fa-chevron-circle-right')
                    if (caret) caret.style.transform = 'rotate(90deg)'
                }
            }

            node = node.parentElement
        }

        activeItem.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }

    updateSelection(type, id) {
        document.querySelectorAll('.tree-item, .sidebar-doc-item, .sidebar-team-header').forEach(el => el.classList.remove('active'))
        let activeItem = null
        if (type === 'local') {
            const safeId = id.replace(/["\\]/g, '\\$&')
            activeItem = document.querySelector(`.tree-item[data-path="${safeId}"], .sidebar-doc-item[data-path="${safeId}"]`)
        } else if (type === 'cloud') {
            activeItem = document.querySelector(`[data-doc-id="${id}"]`)
        }
        if (activeItem) {
            if (type === 'local') this.revealLocalItem(activeItem)
            activeItem.classList.add('active')
        }
    }

    // Local-first, pure-P2P build: there is no billing and no cloud account, so
    // there is nothing to upsell. Kept as a no-op (callers still invoke it) that
    // clears any stale banner markup.
    async updateLimitBanner() {
        const container = document.getElementById('sidebar-limit-container')
        if (container) container.innerHTML = ''
    }

    /**
     * Ensure a top-of-sidebar section (Favorites / Recent) exists and is mounted
     * at the very top of the scroll area, in a stable order. Returns the inner
     * list container element to render rows into. Idempotent.
     */
    _ensureTopSection(id, title, order) {
        const scroll = document.getElementById('sidebar-scroll-area')
        if (!scroll) return null
        let section = document.getElementById(id)
        if (!section) {
            section = document.createElement('div')
            section.className = 'sidebar-section'
            section.id = id
            section.dataset.topOrder = String(order)
            const listId = `${id}-list`
            section.innerHTML = `
                <div class="sidebar-section-header"><span>${title}</span></div>
                <div id="${listId}"></div>
            `
            // Insert keeping ascending data-top-order, before any non-top section.
            const existingTops = Array.from(scroll.children).filter(c => c.dataset && c.dataset.topOrder)
            let ref = null
            for (const c of existingTops) {
                if (Number(c.dataset.topOrder) > order) { ref = c; break }
            }
            if (!ref) {
                // Insert before the first non-top section (e.g. "Private").
                ref = Array.from(scroll.children).find(c => !(c.dataset && c.dataset.topOrder)) || null
            }
            scroll.insertBefore(section, ref)
        }
        return document.getElementById(`${id}-list`)
    }

    /** Render the "⭐ Favorites" section. */
    async renderFavorites() {
        const favorites = this.context.getFavorites ? this.context.getFavorites() : null
        const list = this._ensureTopSection('favorites-section', 'Favorites', 0)
        if (!list) return
        const section = document.getElementById('favorites-section')
        const items = favorites ? favorites.getList() : []
        if (!items.length) {
            // Hide the whole section when there are no favorites.
            if (section) section.style.display = 'none'
            list.innerHTML = ''
            return
        }
        if (section) section.style.display = ''
        list.innerHTML = ''
        items.forEach((entry) => {
            const row = document.createElement('div')
            row.className = 'sidebar-doc-item'
            if (entry.type === 'cloud') row.dataset.docId = entry.docId
            else if (entry.path) row.dataset.path = entry.path
            const name = (entry.name || 'Untitled').replace(/\.(md|txt)$/, '').replace(/_/g, ' ')
            row.innerHTML = `
                <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex: 0 0 16px; margin: 0;">
                    <i class="fas fa-star" style="font-size: 11px; color: #f0ad4e;"></i>
                </div>
                <span class="doc-name-label" style="font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${name}</span>
                <i class="fas fa-times fav-remove" title="Remove from favorites"></i>
            `
            row.onclick = (e) => {
                if (e.target.classList && e.target.classList.contains('fav-remove')) return
                favorites.open(entry)
            }
            const removeBtn = row.querySelector('.fav-remove')
            if (removeBtn) {
                removeBtn.onclick = async (e) => {
                    e.stopPropagation()
                    await favorites.remove(entry.id)
                    await this.renderFavorites()
                    window.dispatchEvent(new CustomEvent('favorites:changed'))
                }
            }
            list.appendChild(row)
        })
    }

    /** Render the "🕘 Recent" section. */
    async renderRecents() {
        const recents = this.context.getRecents ? this.context.getRecents() : null
        const list = this._ensureTopSection('recents-section', 'Recent', 1)
        if (!list) return
        const section = document.getElementById('recents-section')
        const items = recents ? recents.getList() : []
        if (!items.length) {
            if (section) section.style.display = 'none'
            list.innerHTML = ''
            return
        }
        if (section) section.style.display = ''
        list.innerHTML = ''
        items.forEach((entry) => {
            const row = document.createElement('div')
            row.className = 'sidebar-doc-item'
            if (entry.type === 'cloud') row.dataset.docId = entry.docId
            else if (entry.path) row.dataset.path = entry.path
            const name = (entry.name || 'Untitled').replace(/\.(md|txt)$/, '').replace(/_/g, ' ')
            row.innerHTML = `
                <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex: 0 0 16px; margin: 0;">
                    <i class="far fa-clock" style="font-size: 11px; color: #999;"></i>
                </div>
                <span class="doc-name-label" style="font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${name}</span>
            `
            row.onclick = () => recents.open(entry)
            list.appendChild(row)
        })
    }

    /**
     * Render the local-first "Teamspaces" groups above the file tree. ADDITIVE:
     * this is a separate top-section that does not touch the existing file tree
     * (which keeps rendering unassigned notes). The actual group DOM is produced
     * by TeamspacesManager.render(); this method just owns the host section.
     */
    async renderTeamspaces() {
        const tsManager = this.context.getTeamspaces ? this.context.getTeamspaces() : null
        if (!tsManager) return
        const list = this._ensureTopSection('local-teamspaces-section', 'Teamspaces', 2)
        if (!list) return
        const section = document.getElementById('local-teamspaces-section')

        // Mount an "add" button into the section header once.
        if (section) {
            const header = section.querySelector('.sidebar-section-header')
            if (header && !header.querySelector('.ts-add-btn')) {
                const add = document.createElement('i')
                add.className = 'fas fa-plus icon-btn ts-add-btn'
                add.title = 'Create teamspace'
                add.style.cssText = 'font-size:12px;cursor:pointer;opacity:0.6;margin-left:auto;'
                add.onclick = (e) => {
                    e.stopPropagation()
                    window.dispatchEvent(new CustomEvent('cmd:create-teamspace'))
                }
                // Wrap the title and the button so the header lays out nicely.
                header.style.display = 'flex'
                header.style.alignItems = 'center'
                header.appendChild(add)
            }
        }

        // Ensure a stable host node inside the list and let the manager fill it.
        let host = document.getElementById('teamspaces-host')
        if (!host) {
            host = document.createElement('div')
            host.id = 'teamspaces-host'
            list.appendChild(host)
        }
        tsManager.render(host)

        // Show an inline empty-state hint when there are no teamspaces yet, so
        // the "+" entry point is always discoverable. The section stays visible.
        let hint = document.getElementById('teamspaces-empty-hint')
        if (!tsManager.getList().length) {
            if (!hint) {
                hint = document.createElement('div')
                hint.id = 'teamspaces-empty-hint'
                hint.style.cssText = 'padding:4px 12px 4px 14px;font-size:11px;color:#bbb;font-style:italic;cursor:pointer;'
                hint.textContent = 'No teamspaces — click + to create one.'
                hint.onclick = () => window.dispatchEvent(new CustomEvent('cmd:create-teamspace'))
                host.appendChild(hint)
            }
        } else if (hint) {
            hint.remove()
        }
        if (section) section.style.display = ''
    }

    toggleSearchView() {
        const tree = document.getElementById('file-tree')
        const searchView = document.getElementById('search-view')
        if (searchView.style.display === 'none') {
            tree.style.display = 'none'
            searchView.style.display = 'flex'
            this.renderSearchView()
        } else {
            searchView.style.display = 'none'
            tree.style.display = 'block'
        }
    }

    toggleProfileView() {
        const tree = document.getElementById('file-tree')
        const profile = document.getElementById('profile-view')
        if (profile.style.display === 'none') {
            tree.style.display = 'none'
            profile.style.display = 'flex'
            this.renderProfileView()
        } else {
            profile.style.display = 'none'
            tree.style.display = 'block'
        }
    }
}
