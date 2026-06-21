import { authClient } from './auth-client'
import { WebsocketProvider } from 'y-websocket'
import { Config } from './config'
import { Features } from './features'

export class TeamManager {
  constructor() {
    this.engine = null
    this.isOpen = false
    this.activeTeam = null
    this.currentSection = 'account' // 'account', 'teams', 'privacy'
  }

  toggleView() {
      if (this.isOpen) {
          this.close()
      } else {
          this.open()
      }
  }

  async open(engine = null) {
    if (engine) this.engine = engine
    this.isOpen = true
    
    // Create Modal Overlay
    let overlay = document.getElementById('settings-overlay')
    if (!overlay) {
        overlay = document.createElement('div')
        overlay.id = 'settings-overlay'
        overlay.className = 'settings-modal-overlay'
        overlay.innerHTML = `
            <div class="settings-modal">
                <div class="settings-sidebar" id="settings-sidebar">
                    <div class="settings-sidebar-user" id="settings-user-info"></div>
                    
                    <div class="settings-sidebar-header">Account</div>
                    <div class="settings-sidebar-item active" data-section="account">
                        <i class="fas fa-user-circle" style="width:16px;text-align:center;"></i> My account
                    </div>
                    <div class="settings-sidebar-item" data-section="settings">
                        <i class="fas fa-cog" style="width:16px;text-align:center;"></i> Settings
                    </div>
                    <div class="settings-sidebar-item" data-section="appearance">
                        <i class="fas fa-font" style="width:16px;text-align:center;"></i> Appearance
                    </div>
                    <div class="settings-sidebar-item" data-section="notifications">
                        <i class="fas fa-bell" style="width:16px;text-align:center;"></i> Notifications
                    </div>
                    
                    <div class="settings-sidebar-header">Workspace</div>
                    <div class="settings-sidebar-item" data-section="sync">
                        <i class="fab fa-git-alt" style="width:16px;text-align:center;"></i> Git Sync
                    </div>
                    <div class="settings-sidebar-item" data-section="sharelink">
                        <i class="fas fa-link" style="width:16px;text-align:center;"></i> Share via link
                    </div>
                    <div class="settings-sidebar-item" data-section="teams">
                        <i class="fas fa-users" style="width:16px;text-align:center;"></i> Teamspaces
                    </div>
                    <div class="settings-sidebar-item" data-section="members">
                        <i class="fas fa-user-friends" style="width:16px;text-align:center;"></i> Members
                    </div>

                    <div style="margin-top:auto; padding: 12px; font-size:11px; color:#999;">
                        Paperus v1.0.1
                    </div>
                </div>
                <div class="settings-content" id="settings-content"></div>
                <div style="position: absolute; top: 16px; right: 16px; cursor: pointer; color: #999; font-size: 20px; z-index:10;" id="settings-close">&times;</div>
            </div>
        `
        document.body.appendChild(overlay)
        
        document.getElementById('settings-close').onclick = () => this.close()
        overlay.onclick = (e) => {
            if (e.target === overlay) this.close()
        }
        
        // Sidebar Navigation
        const items = overlay.querySelectorAll('.settings-sidebar-item')
        items.forEach(item => {
            item.onclick = () => {
                items.forEach(i => i.classList.remove('active'))
                item.classList.add('active')
                this.currentSection = item.dataset.section
                this.updateView()
            }
        })
    }
    
    overlay.classList.add('open')
    
    await this.updateView()
  }

  close() {
    this.isOpen = false
    const overlay = document.getElementById('settings-overlay')
    if (overlay) overlay.classList.remove('open')
  }
  
  toggleDocControls(show) {
      // No-op (Modal doesn't hide controls anymore)
  }
  
  async updateView() {
    const user = await authClient.getMe(true) // Force refresh to get latest username/status
    const content = document.getElementById('settings-content')
    const userInfo = document.getElementById('settings-user-info')
    
    if (!content) {
        console.log('[TeamManager] updateView skipped: #settings-content not found (modal probably closed)');
        return;
    }

    if (userInfo) {
        if (user) {
            userInfo.innerHTML = `
                <div style="width: 24px; height: 24px; background: #333; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px;">
                    ${((user && (user.displayName || user.email || '?'))[0] || '?').toUpperCase()}
                </div>
                <div style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;">${(user && user.email) || 'No email'}</div>
            `
        } else {
            userInfo.innerHTML = 'Not signed in'
        }
    }
    
    this.renderMainArea(content, user)
  }
  
  renderSidebar(container, user) {
     // Handled in HTML template in open()
  }
  
  renderMainArea(container, user) {
      container.innerHTML = ''
      
      if (this.currentSection === 'account') {
          if (user) {
              this.renderAccountProfile(container, user)
          } else {
              this.renderLogin(container)
          }
      } else if (this.currentSection === 'teams') {
          if (user) {
              this.renderTeams(container, user)
          } else {
               container.innerHTML = `
                <div style="text-align: center; margin-top: 40px; color: #666;">
                    <i class="fas fa-lock" style="font-size: 24px; margin-bottom: 16px; opacity: 0.3;"></i>
                    <p>Please sign in to manage teams.</p>
                    <button class="btn" id="btn-goto-login">Sign In</button>
                    </div>
               `
               const btn = document.getElementById('btn-goto-login')
               if(btn) btn.onclick = () => {
                   this.currentSection = 'account'
                   this.updateView()
               }
          }
      } else if (this.currentSection === 'sync') {
          this.renderGitSync(container)
      } else if (this.currentSection === 'sharelink') {
          this.renderShareLink(container)
      } else if (this.currentSection === 'settings') {
          this.renderSettings(container)
      } else if (this.currentSection === 'appearance') {
          this.renderAppearance(container)
      } else {
          container.innerHTML = `<div style="padding: 20px; color: #999;">Section ${this.currentSection} under construction.</div>`
      }
  }

  async _gitDir() {
      try {
          const known = await window.api.getSettings('knownProjects');
          if (Array.isArray(known) && known.length) return known[0];
      } catch (e) { /* ignore */ }
      return null;
  }

  async renderGitSync(container) {
      // Git sync runs in the desktop app (it operates on your local note files).
      if (!(window.api && window.api.git)) {
          container.innerHTML = `
            <h2>Git Sync</h2>
            <div class="settings-section">
              <p style="color:#666;">Git sync is available in the Paperus desktop app, where your notes live as Markdown files on disk. Open the desktop app to connect a repository.</p>
            </div>`;
          return;
      }

      const dir = await this._gitDir();
      const savedRemote = (await window.api.getSettings('git_remote')) || '';
      const hasToken = !!(await window.api.invoke('auth:secure-load', 'git_token').catch(() => null));
      const autosyncEnabled = !!(await window.api.getSettings('git_autosync_enabled'));
      const autosyncInterval = (await window.api.getSettings('git_autosync_interval')) || 5;

      container.innerHTML = `
        <h2>Git Sync <span style="font-size:12px;font-weight:400;color:#999;">— your notes, your repo</span></h2>
        <div class="settings-section">
            <p style="font-size:13px;color:#666;margin-top:0;">
                Sync this workspace to your own git repository (like Obsidian). Your notes are pushed straight to GitHub — our server is never involved. Data stays yours.
            </p>

            <div style="font-size:12px;color:#888;margin-bottom:16px;">
                Folder: <code style="background:#f3f3f3;padding:2px 6px;border-radius:4px;">${dir || 'No workspace open'}</code>
            </div>

            <label style="display:block;font-weight:500;margin-bottom:6px;">Repository URL</label>
            <input type="text" id="git-remote" value="${savedRemote}" placeholder="https://github.com/you/my-notes.git" style="width:100%;padding:10px;margin-bottom:16px;border:1px solid #ddd;border-radius:4px;">

            <label style="display:block;font-weight:500;margin-bottom:6px;">Personal Access Token ${hasToken ? '<span style="color:#00a080;font-size:11px;">(saved)</span>' : ''}</label>
            <input type="password" id="git-token" placeholder="${hasToken ? '•••••••• (leave blank to keep)' : 'ghp_xxx — needs repo scope'}" style="width:100%;padding:10px;margin-bottom:6px;border:1px solid #ddd;border-radius:4px;">
            <div style="font-size:11px;color:#999;margin-bottom:20px;">
                Create one at <a href="#" id="git-token-link" style="color:#2eaadc;">github.com/settings/tokens</a> with <b>repo</b> scope. Stored encrypted in your OS keychain — never sent to our server.
            </div>

            <div style="display:flex;gap:10px;margin-bottom:20px;">
                <button class="btn" id="git-connect-btn">Save & Connect</button>
                <button class="btn btn-primary" id="git-sync-btn"><i class="fab fa-git-alt" style="margin-right:6px;"></i>Sync Now</button>
            </div>

            <div id="git-status-box" style="font-size:12px;color:#666;background:#f9f9f9;border:1px solid #eee;border-radius:6px;padding:12px;">Checking status…</div>

            <div style="margin-top:18px;padding-top:16px;border-top:1px solid #eee;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <input type="checkbox" id="git-autosync" ${autosyncEnabled ? 'checked' : ''}>
                <label for="git-autosync" style="font-size:13px;">Auto-sync every</label>
                <input type="number" id="git-autosync-interval" value="${autosyncInterval}" min="1" max="120" style="width:56px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;">
                <span style="font-size:13px;">minutes</span>
            </div>
        </div>
      `;

      const tokenLink = document.getElementById('git-token-link');
      if (tokenLink) tokenLink.onclick = (e) => { e.preventDefault(); const u = 'https://github.com/settings/tokens/new?scopes=repo&description=Paperus'; if (window.api.send) window.api.send('open-external', u); else window.open(u, '_blank'); };

      const statusBox = document.getElementById('git-status-box');
      const refreshStatus = async () => {
          if (!dir) { statusBox.textContent = 'Open a folder to enable sync.'; return; }
          try {
              const s = await window.api.git.status(dir);
              if (!s || !s.initialized) { statusBox.innerHTML = 'Not a git repo yet. Add a repository URL and click <b>Save & Connect</b>.'; return; }
              statusBox.innerHTML = `
                  <div>Branch: <b>${s.branch}</b></div>
                  <div>Remote: ${s.remote ? `<code>${s.remote}</code>` : '<i>none</i>'}</div>
                  <div>Uncommitted changes: <b>${s.changedCount}</b></div>`;
          } catch (e) {
              statusBox.textContent = 'Status error: ' + e.message;
          }
      };
      refreshStatus();

      const saveToken = async () => {
          const t = document.getElementById('git-token').value.trim();
          if (t) await window.api.invoke('auth:secure-save', 'git_token', t);
          return t || (await window.api.invoke('auth:secure-load', 'git_token').catch(() => null));
      };

      document.getElementById('git-connect-btn').onclick = async () => {
          if (!dir) return alert('Open a folder first.');
          const remote = document.getElementById('git-remote').value.trim();
          await window.api.setSettings('git_remote', remote);
          await saveToken();
          try {
              await window.api.git.init(dir, remote);
              await refreshStatus();
              alert('Connected. Your workspace is now a git repo.');
          } catch (e) { alert('Connect failed: ' + e.message); }
      };

      document.getElementById('git-sync-btn').onclick = async () => {
          if (!dir) return alert('Open a folder first.');
          const btn = document.getElementById('git-sync-btn');
          const remote = document.getElementById('git-remote').value.trim();
          await window.api.setSettings('git_remote', remote);
          const token = await saveToken();
          if (!token) return alert('Add a Personal Access Token first.');
          const user = authClient.user;
          const author = user ? { name: user.displayName || user.email, email: user.email } : null;
          btn.disabled = true; btn.textContent = 'Syncing…';
          try {
              const res = await window.api.git.sync(dir, { token, remoteUrl: remote, author, message: 'Sync notes' });
              if (res.ok) {
                  const parts = [];
                  if (res.committed && res.committed.committed) parts.push(`committed ${res.committed.changes} change(s)`);
                  if (res.pulled) parts.push('pulled');
                  if (res.pushed) parts.push('pushed');
                  alert('Synced ✓ ' + (parts.length ? '(' + parts.join(', ') + ')' : '(already up to date)'));
              } else {
                  alert('Sync failed: ' + (res.error || 'unknown error'));
              }
              await refreshStatus();
          } catch (e) {
              alert('Sync failed: ' + e.message);
          } finally {
              btn.disabled = false; btn.innerHTML = '<i class="fab fa-git-alt" style="margin-right:6px;"></i>Sync Now';
          }
      };

      const persistAutosync = async () => {
          const en = document.getElementById('git-autosync').checked;
          const iv = Math.max(1, parseInt(document.getElementById('git-autosync-interval').value, 10) || 5);
          await window.api.setSettings('git_autosync_enabled', en);
          await window.api.setSettings('git_autosync_interval', iv);
          try { const m = await import('./git-autosync'); m.startAutoSync(); } catch (e) { /* ignore */ }
      };
      document.getElementById('git-autosync').onchange = persistAutosync;
      document.getElementById('git-autosync-interval').onchange = persistAutosync;
  }

  /**
   * Accountless "Share via link / room code".
   * Generates a random room code for the currently open document, starts a P2P
   * swarm on that code, and shows a copyable link/code. Any peer who opens the
   * link joins the same swarm and syncs this doc peer-to-peer — no login, no
   * account, no team membership. This is ADDITIVE to account-based sharing.
   */
  async renderShareLink(container) {
      const p2p = await import('./p2p');

      if (!this.engine) {
          container.innerHTML = `
            <h2>Share via link</h2>
            <div class="settings-section">
                <p style="color:#666;">Open a document first, then come back here to generate a peer-to-peer share link.</p>
            </div>`;
          return;
      }

      // Reuse an already-generated code for this doc (so reopening the panel
      // shows the same link), otherwise mint a fresh one.
      this._shareRooms = this._shareRooms || {};
      let roomCode = this._shareRooms[this.engine.docId];
      if (!roomCode) {
          roomCode = p2p.generateRoomCode();
          this._shareRooms[this.engine.docId] = roomCode;
      }
      const shareLink = p2p.buildShareLink(roomCode);
      const shareCode = p2p.buildShareCode(roomCode);

      container.innerHTML = `
        <h2>Share via link <span style="font-size:12px;font-weight:400;color:#999;">— no account needed</span></h2>
        <div class="settings-section">
            <p style="font-size:13px;color:#666;margin-top:0;">
                Anyone with this link can open and edit this document with you, peer-to-peer.
                No sign-in, no team — the relay only brokers the connection and never sees your notes.
            </p>

            <label style="display:block;font-weight:500;margin-bottom:6px;">Share link</label>
            <div style="display:flex;gap:8px;margin-bottom:16px;">
                <input type="text" id="share-link-input" readonly value="${shareLink}" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:12px;">
                <button class="btn" id="share-copy-link">Copy link</button>
            </div>

            <label style="display:block;font-weight:500;margin-bottom:6px;">Room code</label>
            <div style="display:flex;gap:8px;margin-bottom:16px;">
                <input type="text" id="share-code-input" readonly value="${shareCode}" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:12px;">
                <button class="btn btn-secondary" id="share-copy-code">Copy code</button>
            </div>

            <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
                <button class="btn btn-primary" id="share-start-btn">Start sharing</button>
                <span id="share-status" style="font-size:12px;color:#888;"></span>
            </div>
            <div style="font-size:11px;color:#999;">
                Keep this window open while collaborating — closing the app stops the peer connection.
            </div>
        </div>
      `;

      const statusEl = document.getElementById('share-status');
      const setStatus = (txt) => { if (statusEl) statusEl.textContent = txt; };

      const copy = async (text, btn, label) => {
          try {
              await navigator.clipboard.writeText(text);
          } catch (_e) {
              const inp = document.createElement('textarea');
              inp.value = text; document.body.appendChild(inp); inp.select();
              try { document.execCommand('copy'); } catch (_e2) { /* ignore */ }
              inp.remove();
          }
          if (btn) {
              const orig = btn.textContent;
              btn.textContent = 'Copied!';
              setTimeout(() => { btn.textContent = orig; }, 1500);
          }
      };

      document.getElementById('share-copy-link').onclick = (e) =>
          copy(shareLink, e.currentTarget, 'link');
      document.getElementById('share-copy-code').onclick = (e) =>
          copy(shareCode, e.currentTarget, 'code');

      document.getElementById('share-start-btn').onclick = () => {
          if (!this.engine) return;
          // Connect this document's swarm to the shared room code. P2PNetwork
          // uses the code as both topic seed and WebRTC password.
          this.engine.connectP2P(roomCode);
          setStatus('Sharing active — send the link to a collaborator.');
          // Reflect peer count as it changes.
          const onSync = (ev) => {
              const d = ev.detail || {};
              if (d.docId && d.docId !== this.engine?.docId) return;
              const peers = (d.p2p && d.p2p.peers) || this.engine?.network?.peerCount || 0;
              setStatus(peers > 0
                  ? `Sharing active — ${peers} peer${peers !== 1 ? 's' : ''} connected.`
                  : 'Sharing active — waiting for a collaborator…');
          };
          window.addEventListener('sync:status', onSync);
      };
  }

  renderSettings(container) {
      container.innerHTML = `
        <h2>Preferences</h2>
        <div class="settings-section">
            <h3>Appearance</h3>
            <div class="settings-row">
                <label>Theme</label>
                <select style="padding: 4px;">
                    <option>Light</option>
                    <option>Dark</option>
                    <option>System</option>
                </select>
            </div>
        </div>
        <div class="settings-section">
            <h3>Editor</h3>
            <div class="settings-row">
                <div>
                    <label>Spell check</label>
                    <div class="desc">Check spelling while typing</div>
                </div>
                <input type="checkbox" checked>
            </div>
        </div>
      `
  }

  /**
   * Appearance settings — editor font family, size and line height.
   * Delegates to fonts.js, which persists + applies changes immediately
   * (CSS variables on :root). Cross-platform (Electron + web).
   */
  async renderAppearance(container) {
      container.innerHTML = '<div style="padding:20px;color:#999;">Loading…</div>'
      try {
          const fonts = await import('./fonts')
          await fonts.loadEditorFont().catch(() => {})
          fonts.applyEditorFont()
          fonts.renderAppearanceSettings(container)
      } catch (e) {
          container.innerHTML = `<div style="padding:20px;color:#d9534f;">Appearance settings failed to load: ${e.message}</div>`
      }
  }

  renderAccountProfile(container, user) {
      if (!user) return this.renderLogin(container);
      
      container.innerHTML = `
        <div style="max-width: 500px; margin: 0 auto;">
            <h2 style="margin-bottom: 30px;">Account</h2>
            
            <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 40px; padding-bottom: 30px; border-bottom: 1px solid #eee;">
                <div style="width: 80px; height: 80px; background: #333; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 600;">
                    ${((user && (user.displayName || user.email || '?'))[0] || '?').toUpperCase()}
                    </div>
                <div>
                    <div style="font-size: 20px; font-weight: 600; margin-bottom: 4px;">${(user && user.displayName) || 'User'}</div>
                    <div style="color: #666;">${(user && user.email) || 'No email'}</div>
                </div>
            </div>

            <div style="margin-bottom: 30px;">
                <label style="display: block; font-weight: 500; margin-bottom: 8px;">Display Name</label>
                <div style="display: flex; gap: 10px;">
                    <input type="text" value="${(user && user.displayName) || ''}" disabled style="flex: 1; padding: 10px; background: #f9f9f9; border: 1px solid #eee; border-radius: 4px; color: #666;">
                </div>
                    </div>
                    
            <div style="margin-bottom: 30px; background: #f0f7ff; padding: 16px; border-radius: 8px; border: 1px solid #cce5ff;">
                <label style="display: block; font-weight: 500; margin-bottom: 8px; color: #004085;">Unique Username</label>
                ${!user.isUsernameSet ? `
                    <div style="font-size: 12px; color: #555; margin-bottom: 12px;">
                        Set a unique username (e.g. @john.doe) to let others invite you easily. You can only set this once.
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <div style="display: flex; align-items: center; background: white; border: 1px solid #b8daff; border-radius: 4px; padding: 0 10px; flex: 1;">
                            <span style="color: #999; font-weight: 500;">@</span>
                            <input type="text" id="username-input" placeholder="username" style="border: none; outline: none; padding: 8px 4px; width: 100%; font-size: 13px;">
                </div>
                        <button class="btn" id="btn-save-username" style="background: #007bff; color: white; border: none;">Save</button>
                    </div>
                    <div id="username-error" style="color: #d32f2f; font-size: 11px; margin-top: 4px; display: none;"></div>
                ` : `
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #004085; font-weight: 600;">
                        <span>@${user.username}</span>
                        <i class="fas fa-check-circle" title="Verified" style="color: #00a080;"></i>
                    </div>
                `}
                    </div>
                    
            <div style="margin-bottom: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                <h4 style="margin-top: 0;">Security</h4>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <button class="btn btn-secondary" id="btn-change-password">Change Password</button>

                    <div id="e2ee-status-box" style="margin-top: 10px; padding: 12px; background: #f8f9fa; border: 1px solid #eee; border-radius: 6px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                            <span style="font-size: 13px; font-weight: 500;">End-to-End Encryption</span>
                            <span id="e2ee-badge" style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #eee; color: #666;">Locked</span>
                        </div>
                        <div id="e2ee-desc" style="font-size: 11px; color: #666; margin-bottom: 12px;">
                            Enable E2EE to protect your notes with a private vault key. Only you and your collaborators will have the keys.
                        </div>
                        <button class="btn btn-small" id="btn-unlock-e2ee" style="width: 100%; border: 1px solid #ddd; background: white; color: #333;">Unlock Vault</button>
                    </div>

                    <div id="touchid-box" style="margin-top: 10px; padding: 12px; background: #f8f9fa; border: 1px solid #eee; border-radius: 6px; display: none;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                            <span style="font-size: 13px; font-weight: 500;"><i class="fas fa-fingerprint" style="margin-right: 6px;"></i>Touch ID Unlock</span>
                            <span id="touchid-badge" style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #eee; color: #666;">Off</span>
                        </div>
                        <div style="font-size: 11px; color: #666; margin-bottom: 12px;">
                            Use Touch ID to unlock your vault instantly without typing your password.
                        </div>
                        <button class="btn btn-small" id="btn-setup-touchid" style="width: 100%; border: 1px solid #ddd; background: white; color: #333;">Enable Touch ID</button>
                    </div>

                    ${Features.passkeys ? `
                    <div id="passkeys-box" style="margin-top: 10px; padding: 12px; background: #f8f9fa; border: 1px solid #eee; border-radius: 6px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                            <span style="font-size: 13px; font-weight: 500;"><i class="fas fa-key" style="margin-right: 6px;"></i>Passkeys</span>
                            <span id="passkey-count" style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #eee; color: #666;">0</span>
                        </div>
                        <div style="font-size: 11px; color: #666; margin-bottom: 12px;">
                            Sign in with biometrics or a security key instead of your password.
                        </div>
                        <div id="passkey-list" style="margin-bottom: 8px;"></div>
                        <button class="btn btn-small" id="btn-add-passkey" style="width: 100%; border: 1px solid #007bff; background: #f0f7ff; color: #007bff;">
                            <i class="fas fa-plus" style="margin-right: 4px;"></i> Add Passkey
                        </button>
                    </div>` : ''}
                </div>
                </div>
                
            <button class="btn btn-secondary" id="btn-logout" style="color: #d32f2f; border-color: #d32f2f1a; background: #d32f2f0d;">Sign Out</button>
        </div>
      `
      
      document.getElementById('btn-change-password').onclick = () => {
          this.showInputModal('Change Password', 'Enter Old Password', (oldPass) => {
              if (oldPass) {
                  this.showInputModal('Change Password', 'Enter New Password', async (newPass) => {
                      if (newPass) {
                          try {
                              await authClient.changePassword(oldPass, newPass)
                              alert('Password changed successfully')
                          } catch (e) {
                              alert(e.message)
                          }
                      }
                  })
              }
          })
      }
      
      document.getElementById('btn-logout').onclick = () => {
          authClient.logout()
          this.updateView()
      }

      const e2eeBtn = document.getElementById('btn-unlock-e2ee');
      const e2eeBadge = document.getElementById('e2ee-badge');
      const e2eeDesc = document.getElementById('e2ee-desc');

      if (authClient.e2ee.privateKey) {
          e2eeBadge.textContent = 'Unlocked';
          e2eeBadge.style.background = '#e6fffa';
          e2eeBadge.style.color = '#00a080';
          e2eeBtn.textContent = 'Vault Active';
          e2eeBtn.disabled = true;
          e2eeDesc.textContent = 'Your private keys are active. Encrypted documents can be opened.';
      }

      if (e2eeBtn && !authClient.e2ee.privateKey) {
          e2eeBtn.onclick = async () => {
              // Try Touch ID first if available
              const hasTouchID = await authClient.isTouchIDSetup().catch(() => false);
              if (hasTouchID) {
                  e2eeBtn.textContent = 'Unlocking...';
                  try {
                      await authClient.unlockWithTouchID();
                      window.dispatchEvent(new CustomEvent('e2ee:unlocked'));
                      this.updateView();
                      return;
                  } catch (e) {
                      console.warn('[Settings] Touch ID unlock failed, falling back to password:', e.message);
                  }
              }

              this.showInputModal('Unlock Vault', 'Enter vault password (or login password)', async (pass) => {
                  if (pass) {
                      e2eeBtn.textContent = 'Unlocking...';
                      const success = await authClient.unlockVault(pass);
                      if (success) {
                          window.dispatchEvent(new CustomEvent('e2ee:unlocked'))
                          this.updateView();
                      } else {
                          alert('Failed to unlock vault. Incorrect password?');
                          e2eeBtn.textContent = 'Unlock Vault';
                      }
                  }
              }, 'password');
          }
      }

      // ─── Touch ID Setup ───
      const touchIdBox = document.getElementById('touchid-box');
      const touchIdBadge = document.getElementById('touchid-badge');
      const touchIdBtn = document.getElementById('btn-setup-touchid');

      authClient.canUseBiometrics().then(async (canUse) => {
          if (!canUse) return; // Not on macOS or no Touch ID hardware
          touchIdBox.style.display = 'block';

          const isSetup = await authClient.isTouchIDSetup().catch(() => false);
          if (isSetup) {
              touchIdBadge.textContent = 'Enabled';
              touchIdBadge.style.background = '#e6fffa';
              touchIdBadge.style.color = '#00a080';
              touchIdBtn.textContent = 'Touch ID Active';
              touchIdBtn.disabled = true;
              touchIdBtn.style.opacity = '0.6';
          } else {
              touchIdBtn.onclick = async () => {
                  if (!authClient.e2ee.privateKey || !authClient._mvk) {
                      alert('Please unlock your vault first before enabling Touch ID.');
                      return;
                  }
                  touchIdBtn.textContent = 'Setting up...';
                  touchIdBtn.disabled = true;
                  try {
                      await authClient.setupTouchID();
                      this.updateView();
                  } catch (e) {
                      alert('Touch ID setup failed: ' + e.message);
                      touchIdBtn.textContent = 'Enable Touch ID';
                      touchIdBtn.disabled = false;
                  }
              };
          }
      });

      // ─── Passkeys Management ───
      const passKeyList = document.getElementById('passkey-list');
      const passKeyCount = document.getElementById('passkey-count');
      const addPasskeyBtn = document.getElementById('btn-add-passkey');

      if (Features.passkeys && passKeyList && passKeyCount && addPasskeyBtn) {
      authClient.getPasskeys().then(keys => {
          passKeyCount.textContent = keys.length;
          if (keys.length > 0) {
              passKeyList.innerHTML = keys.map(k => `
                  <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0;" data-cred-id="${k.id}">
                      <div>
                          <div style="font-size: 12px; font-weight: 500;">${k.friendlyName || 'Passkey'}</div>
                          <div style="font-size: 10px; color: #999;">
                              ${k.deviceType === 'multiDevice' ? '<i class="fas fa-cloud"></i> Synced' : '<i class="fas fa-desktop"></i> This device'}
                              ${k.prfCapable ? ' &middot; <i class="fas fa-shield-alt"></i> PRF' : ''}
                              &middot; ${k.lastUsedAt ? 'Last used ' + new Date(k.lastUsedAt).toLocaleDateString() : 'Never used'}
                          </div>
                      </div>
                      <button class="passkey-delete-btn" data-id="${k.id}" style="border: none; background: none; color: #999; cursor: pointer; font-size: 14px;" title="Remove passkey">&times;</button>
                  </div>
              `).join('');

              passKeyList.querySelectorAll('.passkey-delete-btn').forEach(btn => {
                  btn.onclick = async () => {
                      if (!confirm('Remove this passkey? You won\'t be able to sign in with it anymore.')) return;
                      try {
                          await authClient.deletePasskey(parseInt(btn.dataset.id));
                          this.updateView();
                      } catch (e) {
                          alert('Failed to remove passkey: ' + e.message);
                      }
                  };
              });
          }
      }).catch(() => {});

      addPasskeyBtn.onclick = async () => {
          this.showInputModal('Add Passkey', 'Give this passkey a name (e.g. "MacBook", "iPhone")', async (name) => {
              if (!name) return;
              addPasskeyBtn.textContent = 'Registering...';
              addPasskeyBtn.disabled = true;
              try {
                  const result = await authClient.registerPasskey(name);

                  // If vault is unlocked and passkey supports PRF, offer to add vault wrap
                  if (result.prfCapable && authClient._mvk) {
                      if (confirm('This passkey supports PRF. Enable passwordless vault unlock with it?')) {
                          // Re-authenticate with PRF to get the output
                          try {
                              const { startAuthentication } = await import('@simplewebauthn/browser');
                              const challengeUrl = await authClient.getUrl('/auth/webauthn/login-challenge');
                              const challengeRes = await fetch(challengeUrl, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ email: user.email })
                              });
                              const options = await challengeRes.json();
                              options.extensions = { prf: { eval: { first: new TextEncoder().encode('notionless-vault-key') } } };
                              const assertion = await startAuthentication(options);
                              const prfOutput = assertion.clientExtensionResults?.prf?.results?.first;
                              if (prfOutput) {
                                  await authClient.addPrfMvkWrap(prfOutput);
                              }
                          } catch (prfErr) {
                              console.warn('[Settings] PRF wrap setup failed (non-fatal):', prfErr);
                          }
                      }
                  }

                  this.updateView();
              } catch (e) {
                  alert('Passkey registration failed: ' + e.message);
                  addPasskeyBtn.textContent = 'Add Passkey';
                  addPasskeyBtn.disabled = false;
              }
          });
      };
      } // end Features.passkeys

      const saveUsernameBtn = document.getElementById('btn-save-username')
      if (saveUsernameBtn) {
          saveUsernameBtn.onclick = async () => {
              const input = document.getElementById('username-input')
              const error = document.getElementById('username-error')
              const username = input.value.trim()
              
              if (!username) return
              
              try {
                  saveUsernameBtn.disabled = true
                  saveUsernameBtn.textContent = '...'
                  error.style.display = 'none'
                  
                  await authClient.setUsername(username)
                  this.updateView()
                  alert('Username set successfully!')
              } catch (e) {
                  error.textContent = e.message
                  error.style.display = 'block'
                  saveUsernameBtn.disabled = false
                  saveUsernameBtn.textContent = 'Save'
              }
          }
      }
      
  }

  // Loads Google Identity Services on demand and renders the official button.
  async _mountGoogleSignIn(clientId) {
    const container = document.getElementById('google-signin-container');
    if (!container) return;

    const ensureScript = () => new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
      const existing = document.getElementById('gis-script');
      if (existing) { existing.addEventListener('load', () => resolve()); existing.addEventListener('error', () => reject(new Error('load failed'))); return; }
      const s = document.createElement('script');
      s.id = 'gis-script';
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load Google Sign-In'));
      document.head.appendChild(s);
    });

    try {
      await ensureScript();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          try {
            await authClient.loginWithGoogle(response.credential);
            this.updateView();
          } catch (e) {
            alert(e.message);
          }
        },
      });
      window.google.accounts.id.renderButton(container, {
        theme: 'outline', size: 'large', width: 360, text: 'continue_with',
      });
    } catch (e) {
      console.warn('[Auth] Google Sign-In unavailable:', e.message);
      container.innerHTML = '';
    }
  }

  async renderLogin(container) {
    const biometricsAvailable = await authClient.canUseBiometrics();
    const secureToken = await authClient.loadSecureToken();
    const googleClientId = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || '';
    const showGoogle = Features.googleAuth && !!googleClientId;
    const showGithub = Features.githubAuth;
    const apiBase = await Config.getApiUrl();

    container.innerHTML = `
      <div style="max-width: 400px; margin: 0 auto; padding-top: 40px;">
        <h2 style="margin-bottom: 24px;">Sign In <span style="font-size:12px;font-weight:400;color:#999;">(optional)</span></h2>
        <p style="color: #666; margin-bottom: 24px;">Paperus works fully offline. Sign in only if you want to sync across devices or collaborate in real time.</p>

        ${showGithub ? `
            <button class="btn" id="btn-github-login" style="width: 100%; justify-content: center; margin-bottom: 12px; padding: 10px; background: #24292f; color: #fff; border: none;">
                <i class="fab fa-github" style="margin-right: 8px;"></i> Sign in with GitHub
            </button>
        ` : ''}

        ${showGoogle ? `
            <div id="google-signin-container" style="margin-bottom: 12px; display: flex; justify-content: center;"></div>
        ` : ''}

        ${(showGithub || showGoogle) ? `
            <div style="display: flex; align-items: center; gap: 10px; margin: 20px 0;">
                <div style="flex: 1; height: 1px; background: #eee;"></div>
                <span style="color: #999; font-size: 13px;">OR</span>
                <div style="flex: 1; height: 1px; background: #eee;"></div>
            </div>
        ` : ''}

        ${biometricsAvailable && secureToken ? `
            <button class="btn" id="btn-biometric-login" style="width: 100%; justify-content: center; margin-bottom: 20px; padding: 10px; background: #fff; color: #333; border: 1px solid #ddd;">
                <i class="fas fa-fingerprint" style="margin-right: 8px;"></i> Sign in with Touch ID
            </button>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
                <div style="flex: 1; height: 1px; background: #eee;"></div>
                <span style="color: #999; font-size: 13px;">OR</span>
                <div style="flex: 1; height: 1px; background: #eee;"></div>
            </div>
        ` : ''}

        <div class="form-group">
            <label style="display: block; margin-bottom: 8px; font-weight: 500;">Email</label>
            <input type="email" id="login-email" placeholder="name@example.com" style="width: 100%; padding: 10px; margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px;">
        </div>
        
        <div class="form-group">
            <label style="display: block; margin-bottom: 8px; font-weight: 500;">Password</label>
            <input type="password" id="login-password" placeholder="••••••••" style="width: 100%; padding: 10px; margin-bottom: 24px; border: 1px solid #ddd; border-radius: 4px;">
            <div style="text-align: right; margin-top: -20px; margin-bottom: 20px;">
                <a href="#" id="link-forgot-password" style="font-size: 12px; color: #666; text-decoration: none;">Forgot Password?</a>
            </div>
        </div>
        
        <button class="btn" id="btn-login" style="width: 100%; justify-content: center; margin-bottom: 12px; padding: 10px;">Sign In</button>
        
        <div style="display: flex; align-items: center; gap: 10px; margin: 20px 0;">
            <div style="flex: 1; height: 1px; background: #eee;"></div>
            <span style="color: #999; font-size: 13px;">OR</span>
            <div style="flex: 1; height: 1px; background: #eee;"></div>
        </div>
        
        <div class="form-group">
             <label style="display: block; margin-bottom: 8px; font-weight: 500;">Display Name (Optional)</label>
             <input type="text" id="reg-name" placeholder="John Doe" style="width: 100%; padding: 10px; margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px;">
        </div>
        
        <button class="btn btn-secondary" id="btn-register" style="width: 100%; justify-content: center; padding: 10px;">Create Account</button>
      </div>
    `
    
    // Google Sign-In (optional)
    if (showGoogle) this._mountGoogleSignIn(googleClientId);

    // GitHub Sign-In (OAuth redirect)
    const githubBtn = document.getElementById('btn-github-login');
    if (githubBtn) {
        githubBtn.onclick = () => {
            const url = `${apiBase}/auth/github`;
            // Electron: open in the system browser; web: navigate in place.
            if (window.api && window.api.send) {
                window.api.send('open-external', url);
            } else {
                window.location.href = url;
            }
        };
    }

    // Biometric Login Handler
    const bioBtn = document.getElementById('btn-biometric-login');
    if (bioBtn) {
        bioBtn.onclick = async () => {
            const success = await authClient.promptBiometrics('Sign in to Paperus');
            if (success) {
                const token = await authClient.loadSecureToken();
                if (token) {
                    await authClient.setSession(token, null);
                    const user = await authClient.getMe(true);
                    if (user) {
                        this.updateView();
                    } else {
                        alert('Session expired or invalid. Please log in with password.');
                    }
                }
            }
        }
    }

    document.getElementById('btn-login').onclick = async () => {
        const email = document.getElementById('login-email').value
        const pass = document.getElementById('login-password').value
        if (!email || !pass) return alert('Enter email and password')
        
        try {
            await authClient.login(email, pass)
            
            if (biometricsAvailable) {
                // Check if already saved? No API for that yet, just overwrite or ask.
                // Simple prompt for now.
                if (confirm('Enable Touch ID for future sign-ins?')) {
                    await authClient.saveSecureToken(authClient.token);
                }
            }
            
            this.updateView()
        } catch (e) {
            alert(e.message)
        }
    }
    
    document.getElementById('btn-register').onclick = async () => {
        const email = document.getElementById('login-email').value
        const pass = document.getElementById('login-password').value
        const name = document.getElementById('reg-name').value
        
        if (!email || !pass) return alert('Enter email and password')
        
        try {
            await authClient.register(email, pass, name)
            this.updateView()
        } catch (e) {
            alert(e.message)
        }
    }
    
    document.getElementById('link-forgot-password').onclick = (e) => {
        e.preventDefault()
        this.renderForgotPassword(container)
    }
  }

  renderForgotPassword(container) {
      container.innerHTML = `
        <div style="max-width: 400px; margin: 0 auto; padding-top: 40px;">
            <button id="btn-back-login" style="background: none; border: none; color: #666; cursor: pointer; display: flex; align-items: center; gap: 6px; margin-bottom: 20px; padding: 0;">
                <i class="fas fa-arrow-left"></i> Back to Login
            </button>
            <h2 style="margin-bottom: 24px;">Reset Password</h2>
            <p style="color: #666; margin-bottom: 24px;">Enter your email to receive a reset link (simulated).</p>
            
            <div class="form-group">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Email</label>
                <input type="email" id="reset-email" placeholder="name@example.com" style="width: 100%; padding: 10px; margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px;">
            </div>
            
            <button class="btn" id="btn-send-reset" style="width: 100%; justify-content: center; padding: 10px;">Send Reset Link</button>
        </div>
      `
      
      document.getElementById('btn-back-login').onclick = () => this.renderLogin(container)
      
      document.getElementById('btn-send-reset').onclick = async () => {
          const email = document.getElementById('reset-email').value
          if (!email) return alert('Enter email')
          
          try {
              const res = await authClient.forgotPassword(email)
              
              if (res.not_found) {
                  const doRegister = confirm(`${res.message}\n\nWould you like to create a new account?`)
                  if (doRegister) {
                      this.renderLogin(container)
                  }
                  return
              }
              
              alert(res.message)
              
              // Pre-fill token if in debug mode (simulated email)
              let debugToken = ''
              if (res.debug_token) {
                  console.log('Debug Token:', res.debug_token)
                  debugToken = res.debug_token
                  alert(`[DEBUG] Token: ${debugToken}`) // Show to user for easy copy
              }
              
              this.renderResetPasswordForm(container, email, debugToken)
          } catch (e) {
              alert('Error: ' + e.message)
          }
      }
  }
  
  renderResetPasswordForm(container, email, prefillToken = '') {
      container.innerHTML = `
        <div style="max-width: 400px; margin: 0 auto; padding-top: 40px;">
            <h2 style="margin-bottom: 24px;">Set New Password</h2>
            <p style="color: #666; margin-bottom: 24px;">Check the backend console for the token sent to <b>${email}</b>.</p>
            
            <div class="form-group">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Reset Token</label>
                <input type="text" id="reset-token" placeholder="Paste token here" value="${prefillToken}" style="width: 100%; padding: 10px; margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px;">
            </div>
            
            <div class="form-group">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">New Password</label>
                <input type="password" id="new-password" placeholder="••••••••" style="width: 100%; padding: 10px; margin-bottom: 24px; border: 1px solid #ddd; border-radius: 4px;">
            </div>
            
            <button class="btn" id="btn-confirm-reset" style="width: 100%; justify-content: center; padding: 10px;">Reset Password</button>
        </div>
      `
      
      document.getElementById('btn-confirm-reset').onclick = async () => {
          const token = document.getElementById('reset-token').value
          const newPass = document.getElementById('new-password').value
          
          if (!token || !newPass) return alert('Fill all fields')
          
          try {
              await authClient.resetPassword(token, newPass)
              alert('Password reset successful! Please login.')
              this.renderLogin(container)
          } catch (e) {
              alert(e.message)
          }
      }
  }
  
  async renderTeams(container, user) {
      if (this.activeTeam) {
          // Render Detail View
          this.renderTeamDetails(container, this.activeTeam)
          return
      }
      
      // Render List View
      const teams = await authClient.getTeams().catch((e) => {
          console.error('Failed to load teams:', e)
          return []
      })
      
      container.innerHTML = `
        <div style="max-width: 800px; margin: 0 auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
                <h2 style="margin: 0;">Teams</h2>
                <button class="btn" id="btn-new-team">
                    <i class="fas fa-plus" style="margin-right: 8px;"></i> New Team
                </button>
            </div>
            
            ${teams.length === 0 ? 
                `<div style="text-align: center; padding: 60px 0; color: #999; border: 2px dashed #eee; border-radius: 8px;">
                    <i class="fas fa-users" style="font-size: 32px; margin-bottom: 16px; opacity: 0.3;"></i>
                    <p>You haven't joined any teams yet.</p>
                </div>` 
                : 
                `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px;">
                    ${teams.map(t => `
                        <div class="team-card" data-id="${t.id}" style="background: white; border: 1px solid #eee; border-radius: 8px; padding: 20px; cursor: pointer; transition: box-shadow 0.2s;">
                            <div style="font-weight: 600; font-size: 16px; margin-bottom: 8px;">${t.name}</div>
                            <div style="font-size: 13px; color: #666; display: flex; align-items: center; gap: 6px;">
                                <i class="fas fa-user-tag" style="font-size: 11px;"></i> ${t.role}
                            </div>
                        </div>
                    `).join('')}
                </div>`
            }
        </div>
      `
      
      document.getElementById('btn-new-team').onclick = () => {
          // Use custom input modal instead of prompt
          this.showInputModal('Create Team', 'Enter team name', async (name) => {
              if (name) {
                  try {
                      await authClient.createTeam(name)
                      this.updateView()
                      window.dispatchEvent(new CustomEvent('teams:updated'))
                  } catch (e) {
                      alert('Failed to create team: ' + e.message)
                  }
              }
          })
      }
      
      container.querySelectorAll('.team-card').forEach(card => {
          card.addEventListener('click', () => {
              this.activeTeam = card.dataset.id
              this.updateView()
          })
          card.addEventListener('mouseenter', () => card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)')
          card.addEventListener('mouseleave', () => card.style.boxShadow = 'none')
      })
  }
  
  async renderTeamDetails(container, teamId) {
    container.innerHTML = '<div style="padding: 20px; color: #999;">Loading team details...</div>'
    
    try {
        const team = await authClient.getTeamDetails(teamId)
        
        container.innerHTML = `
            <div style="max-width: 800px; margin: 0 auto;">
                <button id="btn-back-teams" style="background: none; border: none; color: #666; cursor: pointer; display: flex; align-items: center; gap: 6px; margin-bottom: 20px; padding: 0;">
                    <i class="fas fa-arrow-left"></i> Back to Teams
                </button>
                
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 1px solid #eee; padding-bottom: 20px;">
                    <div>
                        <h2 style="margin: 0 0 4px 0;">${team.name}</h2>
                        <div style="font-size: 13px; color: #999;">${team.members.length} member${team.members.length !== 1 ? 's' : ''}</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary" id="btn-invite">
                            <i class="fas fa-user-plus" style="margin-right: 8px;"></i> Invite Member
                        </button>
                        <button class="btn btn-secondary" id="btn-invite-link">
                            <i class="fas fa-link" style="margin-right: 8px;"></i> Invite Link
                        </button>
                    </div>
                </div>
                
                <div style="margin-bottom: 40px; border-bottom: 1px solid #eee; padding-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <h3 style="margin: 0; font-size: 16px;">Documents</h3>
                        <button class="btn btn-small" id="btn-sync-current">
                            <i class="fas fa-cloud-upload-alt" style="margin-right: 6px;"></i> Sync Current File
                        </button>
                    </div>
                    
                    ${team.documents.length === 0 ? 
                        '<div style="background: #f9f9f9; padding: 30px; border-radius: 8px; text-align: center; color: #999;">No documents shared with this team yet.</div>' : 
                        `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;">
                            ${team.documents.map(d => `
                                <div class="doc-card" onclick="window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: '${d.id}' }))" style="background: white; border: 1px solid #eee; border-radius: 8px; padding: 16px; cursor: pointer; transition: box-shadow 0.2s;">
                                    <div style="margin-bottom: 12px; width: 32px; height: 32px; background: #f0f7ff; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #0066cc;">
                                        <i class="far fa-file-alt"></i>
                                    </div>
                                    <div style="font-weight: 500; font-size: 14px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${d.name}</div>
                                    <div style="font-size: 11px; color: #999;">Updated ${new Date(d.updatedAt || d.updated_at).toLocaleDateString()}</div>
                                </div>
                            `).join('')}
                        </div>`
                    }
                </div>
                
                <div style="padding-top: 16px;">
                    <h3 style="margin: 0 0 16px 0; font-size: 16px;">Members</h3>
                    <div style="background: white; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
                        ${team.members.map(m => `
                            <div style="padding: 12px 16px; border-bottom: 1px solid #f9f9f9; display: flex; align-items: center; justify-content: space-between;">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <div style="width: 28px; height: 28px; background: #eee; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #666;">
                                        ${((m && (m.displayName || m.email || '?'))[0] || '?').toUpperCase()}
                                    </div>
                                    <div>
                                        <div style="font-size: 13px; font-weight: 500; color: #333;">${(m && m.displayName) || (m && m.email) || 'Unknown'}</div>
                                        <div style="font-size: 11px; color: #999;">${(m && m.email) || 'No email'}</div>
                                    </div>
                                </div>
                                <div style="font-size: 11px; padding: 4px 8px; background: #f5f5f5; border-radius: 4px; color: #666; text-transform: capitalize;">
                                    ${m.role}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `
        
        document.getElementById('btn-back-teams').onclick = () => {
            this.activeTeam = null
            this.updateView()
        }
        
        document.querySelectorAll('.doc-card').forEach(card => {
            card.addEventListener('mouseenter', () => card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)')
            card.addEventListener('mouseleave', () => card.style.boxShadow = 'none')
        })
        
        const inviteBtn = document.getElementById('btn-invite')
        if (inviteBtn) inviteBtn.onclick = () => {
            this.showInputModal('Invite Member', 'Enter email address', (email) => {
                if (email) {
                    authClient.inviteMember(teamId, email)
                        .then(() => {
                            alert('Invitation sent!')
                            this.renderTeamDetails(container, teamId)
                        })
                        .catch(e => alert(e.message))
                }
            })
        }
        
        const linkBtn = document.getElementById('btn-invite-link')
        if (linkBtn) linkBtn.onclick = async () => {
            try {
                const res = await authClient.getInviteLink(teamId)
                const link = res.link
                
                // Show modal with link and revoke option
                const div = document.createElement('div')
                div.className = 'input-modal'
                div.innerHTML = `
                    <div class="input-box" style="width: 400px;">
                        <h3>Invite Link</h3>
                        <p style="color: #666; font-size: 13px; margin-bottom: 16px; margin-top: -8px;">Share this link to let others join your team instantly.</p>
                        
                        <div style="display: flex; gap: 8px; margin-bottom: 24px;">
                            <input type="text" value="${link}" readonly style="flex: 1; margin-bottom: 0; background: #f9f9f9; color: #666; font-family: monospace; font-size: 12px;">
                            <button class="btn" id="copy-link" style="margin: 0; white-space: nowrap;">Copy</button>
                        </div>
                        
                        <div class="input-actions" style="border-top: 1px solid #eee; padding-top: 16px; margin-top: 8px; justify-content: space-between;">
                            <button class="btn btn-secondary" id="revoke-link" style="color: #d32f2f; border-color: #ffebee; background: #fff5f5; margin: 0;">Revoke Link</button>
                            <button class="btn btn-secondary" id="close-modal" style="margin: 0;">Close</button>
                        </div>
                    </div>
                `
                document.body.appendChild(div)
                
                div.querySelector('#copy-link').onclick = () => {
                    navigator.clipboard.writeText(link)
                    alert('Copied!')
                }
                
                div.querySelector('#revoke-link').onclick = async () => {
                    if (confirm('Are you sure? The current link will stop working.')) {
                        await authClient.revokeInviteLink(teamId)
                        div.remove()
                        alert('Link revoked')
                    }
                }
                
                div.querySelector('#close-modal').onclick = () => div.remove()
                
            } catch (e) {
                alert(e.message)
            }
        }
        
        const syncBtn = document.getElementById('btn-sync-current')
        if (syncBtn) syncBtn.onclick = async () => {
            if (!this.engine) return alert('No local document open to sync.')
            
            const title = document.getElementById('doc-title').value || 'Untitled'
            const docId = this.engine.docId 
            
            try {
                const baseUrl = await Config.getApiUrl()
                await fetch(`${baseUrl}/teams/${teamId}/documents`, {
                    method: 'POST',
                    headers: authClient.headers,
                    body: JSON.stringify({ docId, name: title })
                })
                alert('Document synced successfully!')
                this.renderTeamDetails(container, teamId)
                this.connectCloud()
            } catch (e) {
                alert('Sync failed: ' + e.message)
            }
        }
        
    } catch (e) {
        container.innerHTML = `<div style="color: red; padding: 20px;">Failed to load team details: ${e.message}</div>`
    }
  }

  async connect(docEngine) {
      this.engine = docEngine || this.engine
      if (!this.engine || !authClient.token) return

      // Always connect cloud for persistence + relay (must await so cloudProvider is set
      // before whenSynced() checks it)
      await this.connectCloud()

      // Also connect P2P for direct peer sync (reduces latency, adds resilience)
      // P2P runs alongside cloud — both feed the same Y.Doc, CRDTs merge naturally.
      // If cloud goes down, P2P still works. If P2P has no peers, cloud still works.
      this.connectP2P()
  }

  connectP2P() {
      if (!this.engine) return
      console.log('[Team] Connecting to P2P Swarm...')
      // Use docId as the room key (shared secret)
      this.engine.connectP2P(this.engine.docId)
  }

  async connectCloud() {
      if (!this.engine || !authClient.token) return
      
      // Prevent duplicate connection if already connected/connecting
      if (this.engine.cloudProvider && this.engine.cloudProvider.wsconnected) {
          console.log('[Team] Already connected to Cloud')
          return
      }
      
      // If we have an existing provider but it's disconnected, reuse it or destroy?
      // Better to destroy and recreate to ensure clean slate with current token.
      if (this.engine.cloudProvider) {
          this.engine.cloudProvider.destroy()
          this.engine.cloudProvider = null
      }
      
      const rawWsUrl = await Config.getWsUrl();
      // Force wss:// when the page itself is served over https to avoid mixed-content blocks
      const isHttps = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
      const WS_URL = isHttps ? rawWsUrl.replace(/^ws:\/\//, 'wss://') : rawWsUrl;
      
      console.log('[Team] Connecting to Cloud at:', WS_URL, 'Room:', 'yjs/' + this.engine.docId)
      
      const syncDoc = this.engine.isEncrypted ? this.engine.transportDoc : this.engine.doc;
      
      const wsProvider = new WebsocketProvider(
          WS_URL, 
          'yjs/' + this.engine.docId, 
          syncDoc,
          { 
              params: { auth: authClient.token },
              awareness: this.engine.presence.awareness
          }
      )
      
      // Connection Status UI Update
      const updateStatus = () => {
          const dot = document.getElementById('sync-status-dot');
          if (!dot) return;
          const cloudOk = wsProvider.wsconnected;
          const p2pOk = this.engine?.network?.connected;
          const peers = this.engine?.network?.peerCount || 0;

          if (cloudOk && p2pOk) {
              dot.style.background = '#22c55e';
              dot.title = `Cloud + P2P (${peers} peer${peers !== 1 ? 's' : ''})`;
          } else if (cloudOk) {
              dot.style.background = '#22c55e';
              dot.title = 'Cloud Sync';
          } else if (p2pOk) {
              dot.style.background = '#f59e0b';
              dot.title = `P2P Only (${peers} peer${peers !== 1 ? 's' : ''}) — Cloud offline`;
          } else {
              dot.style.background = '#ef4444';
              dot.title = 'Offline — changes saved locally';
          }
      };

      wsProvider.on('status', event => {
          console.log('[Cloud] Status:', event.status);
          updateStatus();
          this._emitSyncStatus()
      });

      wsProvider.on('sync', isSynced => {
          console.log('[Cloud] Synced:', isSynced);
          wsProvider.synced = isSynced;
          this._emitSyncStatus()
      });

      wsProvider.on('connection-close', (event) => {
          if (!event) return
          console.warn('[Cloud] Connection closed:', event.code, event.reason)
          if (event.code === 1008 || event.code === 4001) {
              console.error('[Cloud] Auth failed, stopping reconnection')
              wsProvider.destroy()
          }
          this._emitSyncStatus()
      })
      
      this.engine.cloudProvider = wsProvider

      // Also listen for P2P status changes to update the combined status dot
      window.addEventListener('sync:status', updateStatus)
  }

  _emitSyncStatus() {
      if (!this.engine) return
      window.dispatchEvent(new CustomEvent('sync:status', {
          detail: this.engine.syncStatus
      }))
  }

  showInputModal(title, placeholder, callback, type = 'text') {
      const div = document.createElement('div')
      div.className = 'input-modal'
      div.innerHTML = `
        <div class="input-box">
          <h3>${title}</h3>
          <input type="${type}" placeholder="${placeholder}" autofocus>
          <div class="input-actions">
            <button class="btn btn-secondary" id="cancel-input">Cancel</button>
            <button class="btn" id="confirm-input">OK</button>
          </div>
        </div>
      `
      document.body.appendChild(div)
      const input = div.querySelector('input')
      const confirm = div.querySelector('#confirm-input')
      const cancel = div.querySelector('#cancel-input')
      
      input.focus()
      
      const cleanup = () => div.remove()
      
      confirm.onclick = () => {
          const val = input.value.trim()
          cleanup()
          callback(val)
      }
      
      cancel.onclick = () => {
          cleanup()
          callback(null)
      }
      
      input.onkeydown = (e) => {
          if (e.key === 'Enter') confirm.click()
          if (e.key === 'Escape') cancel.click()
      }
  }
}
