import { Config } from './config'
import { e2eeManager } from './e2ee'

export class AuthClient {
  constructor() {
    this.token = localStorage.getItem('auth_token');
    this.user = JSON.parse(localStorage.getItem('auth_user') || 'null');
    this.cache = {
        teams: null,
        teamsTimestamp: 0
    }
    this.e2ee = {
        publicKey: null,
        privateKey: null // Only in memory
    }
  }

  async unlockE2EE(password) {
      if (!this.user || !this.user.encryptedPrivateKey || !this.user.keySalt) {
          // If no keys in DB, generate them
          console.log('[AuthClient] No E2EE keys found, generating...');
          const keys = await e2eeManager.generateUserKeyPair();
          const { encryptedPrivateKey, salt } = await e2eeManager.encryptPrivateKey(keys.privateKey, password);
          
          await this.updateE2EEKeys(keys.publicKey, encryptedPrivateKey, salt);
          
          this.e2ee.publicKey = keys.publicKey;
          this.e2ee.privateKey = keys.privateKey;
          return true;
      }

      try {
          const privateKey = await e2eeManager.decryptPrivateKey(
              this.user.encryptedPrivateKey,
              password,
              this.user.keySalt
          );
          this.e2ee.publicKey = this.user.publicKey;
          this.e2ee.privateKey = privateKey;
          console.log('[AuthClient] E2EE Unlocked');
          return true;
      } catch (e) {
          console.error('[AuthClient] Failed to unlock E2EE:', e);
          return false;
      }
  }

  async updateE2EEKeys(publicKey, encryptedPrivateKey, keySalt) {
      const url = await this.getUrl('/auth/e2ee-keys');
      const res = await fetch(url, {
          method: 'PUT',
          headers: this.headers,
          body: JSON.stringify({ publicKey, encryptedPrivateKey, keySalt })
      });
      if (!res.ok) throw new Error('Failed to update E2EE keys');
      const data = await res.json();
      if (data.user) {
          await this.setSession(this.token, data.user);
      }
  }
  
  // Helper to get dynamic URL
  async getUrl(path) {
      const baseUrl = await Config.getApiUrl();
      return `${baseUrl}${path}`;
  }

  get headers() {
    const token = this.token || localStorage.getItem('auth_token');
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  }

  setSession = async (token, user) => {
    this.token = token;
    this.user = user;
    
    if (token) localStorage.setItem('auth_token', token);
    else localStorage.removeItem('auth_token');

    if (user) localStorage.setItem('auth_user', JSON.stringify(user));
    else localStorage.removeItem('auth_user');
    
    // Also save to Electron settings if available
    if (window.api && window.api.setSettings) {
        try {
            await window.api.setSettings('auth_token', token);
            await window.api.setSettings('auth_user', user);
        } catch (e) {
            console.error('Failed to save session to Electron settings', e);
        }
    }

    if (token && user) {
        window.dispatchEvent(new CustomEvent('auth:login', { detail: { user } }));
    }
  }

  logout = async () => {
    console.log('[AuthClient] Logging out');
    this.token = null;
    this.user = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    this.cache.teams = null;
    
    if (window.api && window.api.setSettings) {
        try {
            await window.api.setSettings('auth_token', null);
            await window.api.setSettings('auth_user', null);
        } catch (e) {}
    }
    
    window.dispatchEvent(new CustomEvent('auth:logout'));
  }

// Store a JWT obtained from an OAuth flow (web fragment or desktop deep link)
// and persist it across both LocalStorage and Electron settings.
_consumeToken(token) {
    if (!token) return;
    this.token = token;
    localStorage.setItem('auth_token', token);
    if (window.api && window.api.setSettings) {
        window.api.setSettings('auth_token', token);
    }
}

// Desktop OAuth deep-link callback: when the system browser completes GitHub/
// Google sign-in, main forwards the JWT here. Reuses the same token-handling
// path as the web `consumeOAuthRedirect`, then refreshes the user profile so
// the login completes (dispatches `auth:login` via setSession).
initDesktopOAuthListener() {
    try {
        if (this._desktopOAuthListenerReady) return;
        if (!(window.api && typeof window.api.onAuthToken === 'function')) return;
        this._desktopOAuthListenerReady = true;
        window.api.onAuthToken((token, error) => {
            if (error || !token) {
                console.warn('[AuthClient] OAuth deep-link error:', error || 'no token');
                return;
            }
            this._consumeToken(token);
            // Fetch profile and broadcast login so the UI updates.
            this.getMe(true).catch((e) =>
                console.warn('[AuthClient] getMe after OAuth deep-link failed:', e && e.message));
        });
    } catch (e) {
        console.warn('[AuthClient] initDesktopOAuthListener failed:', e && e.message);
    }
}

// Parse an OAuth redirect of the form `#auth_token=<jwt>&provider=github`,
// persist the session, then scrub the fragment from the URL.
consumeOAuthRedirect() {
    try {
        const hash = (typeof window !== 'undefined' && window.location && window.location.hash) || '';
        if (!hash.includes('auth_token=')) return;
        const params = new URLSearchParams(hash.replace(/^#/, ''));
        const token = params.get('auth_token');
        this._consumeToken(token);
        // Clean the URL so the token doesn't linger in history.
        const clean = window.location.pathname + window.location.search;
        window.history.replaceState(null, '', clean || '/');
    } catch (e) {
        console.warn('[AuthClient] OAuth redirect parse failed:', e.message);
    }
}

async loadSession() {
    // 0. Consume an OAuth redirect (e.g. GitHub) that handed us a JWT in the URL fragment.
    this.consumeOAuthRedirect();

    // 0b. Desktop: listen for the OAuth deep-link callback (system-browser flow).
    this.initDesktopOAuthListener();

    // 1. Try LocalStorage directly first
    const localToken = localStorage.getItem('auth_token');
    const localUser = localStorage.getItem('auth_user');
    
    if (localToken && localToken !== 'null' && localToken !== 'undefined') {
        this.token = localToken;
        try {
            this.user = localUser && localUser !== 'undefined' ? JSON.parse(localUser) : null;
        } catch (e) { this.user = null; }
    }

    // 2. Try Electron/API Settings
    if (window.api && window.api.getSettings) {
        try {
            const t = await window.api.getSettings('auth_token');
            const u = await window.api.getSettings('auth_user');
            
            if (t && t !== 'null') {
                if (!this.token || this.token !== t) {
                    this.token = t;
                    this.user = u;
                    localStorage.setItem('auth_token', t);
                    localStorage.setItem('auth_user', JSON.stringify(u));
                }
            } else if (this.token) {
                await window.api.setSettings('auth_token', this.token);
                await window.api.setSettings('auth_user', this.user);
            }
        } catch (e) {
            console.error('[AuthClient] Error accessing settings:', e);
        }
    }
}

  async login(email, password) {
    const url = await this.getUrl('/auth/login');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Login failed');
    }

    const data = await res.json();
    await this.setSession(data.token, data.user);
    this.cache.teams = null;
    return data.user;
  }

  // Optional Google sign-in. `credential` is the ID token from Google Identity
  // Services. Used purely as a collaboration identity for sync / P2P.
  async loginWithGoogle(credential) {
    const url = await this.getUrl('/auth/google');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Google sign-in failed');
    }

    const data = await res.json();
    await this.setSession(data.token, data.user);
    this.cache.teams = null;
    return data.user;
  }

  async register(email, password, displayName) {
    const url = await this.getUrl('/auth/register');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Registration failed');
    }

    const data = await res.json();
    await this.setSession(data.token, data.user);
    return data.user;
  }

  async getMe(force = false) {
    if (!force && this.user) return this.user;
    if (!this.token) return null;

    try {
      const url = await this.getUrl('/auth/me');
      const res = await fetch(url, { headers: this.headers });
      if (res.ok) {
        const user = await res.json();
        await this.setSession(this.token, user);
        return user;
      } else {
        if (res.status === 401 || res.status === 403) {
            console.error('[AuthClient] Session invalid or expired (401/403). Logging out.');
            try {
                await this.clearSecureToken();
            } catch (err) {
                console.warn('[AuthClient] Failed to clear secure token:', err);
            }
            await this.logout();
        }
        return null;
      }
    } catch (e) {
      console.warn('[AuthClient] getMe check failed (offline?):', e);
      return this.user; 
    }
  }

  async getTeams(force = false) {
    if (!force && this.cache.teams && (Date.now() - this.cache.teamsTimestamp < 300000)) {
        return this.cache.teams;
    }
    
    if (!this.token) return [];
    
    try {
      const url = await this.getUrl('/teams');
      const res = await fetch(url, { headers: this.headers });
      
      if (res.status === 401 || res.status === 403) {
          console.error('[AuthClient] /teams returned 401/403. Session may be invalid.');
          this.logout();
          return [];
      }
      
      if (!res.ok) throw new Error('Failed to fetch teams');
      const teams = await res.json();
      this.cache.teams = teams;
      this.cache.teamsTimestamp = Date.now();
      return teams;
    } catch (e) {
        console.warn('[AuthClient] getTeams failed:', e)
        return this.cache.teams || []
    }
  }
  
  async createTeam(name) {
    const url = await this.getUrl('/teams');
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error('Failed to create team');
    this.cache.teams = null;
    return await res.json();
  }
  
  async getTeamDetails(id) {
    const url = await this.getUrl(`/teams/${id}`);
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new Error('Failed to fetch team details');
    return await res.json();
  }
  
  async inviteMember(teamId, email) {
    const url = await this.getUrl(`/teams/${teamId}/invite`);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ email })
    });
    if (!res.ok) throw new Error('Failed to invite member');
    return await res.json();
  }

  async getInviteLink(teamId) {
    const url = await this.getUrl(`/teams/${teamId}/invite-link`);
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new Error('Failed to get invite link');
    return await res.json();
  }

  async revokeInviteLink(teamId) {
    const url = await this.getUrl(`/teams/${teamId}/revoke-invite`);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers
    });
    if (!res.ok) throw new Error('Failed to revoke invite link');
    return await res.json();
  }

  async joinViaLink(token) {
    const url = await this.getUrl('/teams/join-via-link');
    const res = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ token })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to join team');
    }
    this.cache.teams = null;
    return await res.json();
  }

  async changePassword(oldPassword, newPassword) {
    const url = await this.getUrl('/auth/change-password');
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ oldPassword, newPassword })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to change password');
    }
    return await res.json();
  }

  async forgotPassword(email) {
    const url = await this.getUrl('/auth/forgot-password');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    return await res.json();
  }

  async resetPassword(token, newPassword) {
    const url = await this.getUrl('/auth/reset-password');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to reset password');
    }
    return await res.json();
  }

  async getDocumentTeams(docId) {
    const url = await this.getUrl(`/teams/documents/${docId}/teams`);
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new Error('Failed to fetch document access');
    return await res.json();
  }

  async getSharedDocuments() {
    if (!this.token) return [];
    const url = await this.getUrl('/documents/shared');
    const res = await fetch(url, { headers: this.headers });
    if (res.status === 401 || res.status === 403) {
        console.error('[AuthClient] /shared returned 401/403. Logging out.');
        this.logout();
        return [];
    }
    if (!res.ok) throw new Error('Failed to fetch shared documents');
    return await res.json();
  }

  async shareFolder(folderId, email, role = 'VIEW') {
    const url = await this.getUrl(`/documents/folders/${folderId}/share`);
    const res = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ email, role })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to share folder');
    }
    return await res.json();
  }

  async removeFolderShare(folderId, userId) {
    const url = await this.getUrl(`/documents/folders/${folderId}/share`);
    const res = await fetch(url, {
        method: 'DELETE',
        headers: this.headers,
        body: JSON.stringify({ userId })
    });
    if (!res.ok) throw new Error('Failed to remove folder share');
    return await res.json();
  }

  async getFolderPermissions(folderId) {
    const url = await this.getUrl(`/documents/folders/${folderId}/permissions`);
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) return [];
    return await res.json();
  }

  async getDocumentMetadata(docId) {
    try {
      const url = await this.getUrl(`/documents/${docId}/metadata`);
      const res = await fetch(url, { headers: this.headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to fetch document metadata');
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async setPublicRole(docId, role) {
    const url = await this.getUrl(`/documents/${docId}/public`);
    const res = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ role })
    });
    if (!res.ok) throw new Error('Failed to update public access');
    return await res.json();
  }

  async linkDocumentToTeam(teamId, docId, name) {
    const url = await this.getUrl(`/teams/${teamId}/documents`);
    const res = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ docId, name })
    });
    if (!res.ok) throw new Error('Failed to share document');
    return await res.json();
  }

  async setUsername(username) {
    const url = await this.getUrl('/auth/username');
    const res = await fetch(url, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({ username })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to set username');
    }
    const data = await res.json();
    if (data.user) {
        await this.setSession(this.token, data.user);
    }
    return data;
  }

  async searchUsers(query) {
      const url = await this.getUrl(`/auth/users/search?q=${encodeURIComponent(query)}`);
      const res = await fetch(url, { headers: this.headers });
      if (!res.ok) return [];
      return await res.json();
  }
  
  async getNotifications() {
      try {
          const url = await this.getUrl('/auth/notifications');
          const res = await fetch(url, { headers: this.headers });
          if (res.status === 401 || res.status === 403) {
              console.error('[AuthClient] /notifications returned 401/403. Logging out.');
              this.logout();
              return [];
          }
          if (!res.ok) return [];
          return await res.json();
      } catch (e) {
          console.warn('Notifications fetch failed:', e)
          return []
      }
  }
  
  async clearNotification(id) {
      const url = await this.getUrl('/auth/notifications/clear');
      await fetch(url, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ id })
      });
  }

  async shareDocument(docId, userId, role, extraBody = {}) {
      const payload = { role, ...extraBody };
      if (userId) payload.userId = userId;
      const url = await this.getUrl(`/documents/${docId}/share`);
      const res = await fetch(url, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(payload)
      });
      if (!res.ok) {
          const text = await res.text();
          throw new Error('Failed to share: ' + text);
      }
      return await res.json();
  }

  async getDocumentPermissions(docId) {
      if (!this.token) return [];
      try {
          const url = await this.getUrl(`/teams/documents/${docId}/permissions`);
          const res = await fetch(url, { headers: this.headers });
          if (res.status === 401 || res.status === 403) {
              console.error('[AuthClient] /permissions returned 401/403. Logging out.');
              this.logout();
              return [];
          }
          if (res.status === 404) return [];
          if (!res.ok) return [];
          return await res.json();
      } catch (e) {
          return []
      }
  }

  async updateDocumentMetadata(docId, metadata) {
      const url = await this.getUrl(`/documents/${docId}/metadata-update`);
      const res = await fetch(url, {
          method: 'PUT',
          headers: this.headers,
          body: JSON.stringify(metadata)
      });
      if (!res.ok) {
          throw new Error('Failed to update metadata');
      }
      return await res.json();
  }

  async removePermission(docId, userId) {
      const url = await this.getUrl(`/documents/${docId}/share`);
      await fetch(url, {
          method: 'DELETE',
          headers: this.headers,
          body: JSON.stringify({ userId })
      });
  }

  // ─── WebAuthn Passkey Methods ───

  async registerPasskey(friendlyName) {
      const { startRegistration } = await import('@simplewebauthn/browser');

      // 1. Get challenge from server
      const challengeUrl = await this.getUrl('/auth/webauthn/register-challenge');
      const challengeRes = await fetch(challengeUrl, {
          method: 'POST',
          headers: this.headers
      });
      if (!challengeRes.ok) throw new Error('Failed to get registration challenge');
      const options = await challengeRes.json();

      // 2. Create credential via browser WebAuthn API
      const credential = await startRegistration(options);

      // 3. Send to server for verification
      const verifyUrl = await this.getUrl('/auth/webauthn/register');
      const verifyRes = await fetch(verifyUrl, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({
              credential,
              origin: window.location.origin,
              friendlyName: friendlyName || null,
              prfCapable: !!credential.clientExtensionResults?.prf
          })
      });
      if (!verifyRes.ok) {
          const err = await verifyRes.json();
          throw new Error(err.error || 'Passkey registration failed');
      }
      return await verifyRes.json();
  }

  async loginWithPasskey(email) {
      const { startAuthentication } = await import('@simplewebauthn/browser');

      // 1. Get challenge
      const challengeUrl = await this.getUrl('/auth/webauthn/login-challenge');
      const challengeRes = await fetch(challengeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
      });
      if (!challengeRes.ok) {
          const err = await challengeRes.json();
          throw new Error(err.error || 'Failed to get login challenge');
      }
      const options = await challengeRes.json();

      // 2. Authenticate via browser WebAuthn API
      const credential = await startAuthentication(options);

      // 3. Verify with server
      const verifyUrl = await this.getUrl('/auth/webauthn/login');
      const verifyRes = await fetch(verifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              email,
              credential,
              origin: window.location.origin
          })
      });
      if (!verifyRes.ok) {
          const err = await verifyRes.json();
          throw new Error(err.error || 'Passkey login failed');
      }

      const data = await verifyRes.json();
      await this.setSession(data.token, data.user);
      this.cache.teams = null;
      return data.user;
  }

  async getPasskeys() {
      const url = await this.getUrl('/auth/webauthn/credentials');
      const res = await fetch(url, { headers: this.headers });
      if (!res.ok) return [];
      return await res.json();
  }

  async deletePasskey(id) {
      const url = await this.getUrl(`/auth/webauthn/credentials/${id}`);
      const res = await fetch(url, { method: 'DELETE', headers: this.headers });
      if (!res.ok) throw new Error('Failed to delete passkey');
      return await res.json();
  }

  // ─── MVK Wrap Methods ───

  async storeMvkWrap(type, wrap, metadata) {
      const url = await this.getUrl('/auth/mvk-wraps');
      const res = await fetch(url, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ type, wrap, metadata })
      });
      if (!res.ok) throw new Error('Failed to store MVK wrap');
      return await res.json();
  }

  async getMvkWraps() {
      const url = await this.getUrl('/auth/mvk-wraps');
      const res = await fetch(url, { headers: this.headers });
      if (!res.ok) return [];
      return await res.json();
  }

  async deleteMvkWrap(id) {
      const url = await this.getUrl(`/auth/mvk-wraps/${id}`);
      const res = await fetch(url, { method: 'DELETE', headers: this.headers });
      if (!res.ok) throw new Error('Failed to delete MVK wrap');
      return await res.json();
  }

  // ─── Local-First Vault Key (accountless / passwordless E2EE) ───

  /**
   * Obtain the master vault key WITHOUT requiring an account password.
   *
   * Priority:
   *   1. A vault key already stored locally in the OS keychain (safeStorage).
   *   2. A password-derived key, if a password is supplied (legacy/account path).
   *      The derived key is also persisted locally so future unlocks are
   *      passwordless on this device.
   *   3. A freshly generated random key, persisted locally.
   *
   * Returns the raw vault key (Uint8Array). Also caches it on `this._mvk` so the
   * existing MVK-based document flows keep working unchanged.
   *
   * NOTE: This only changes WHERE the vault key comes from. The encryption
   * format of documents and private keys is untouched, so already-encrypted
   * documents remain decryptable via the unchanged password/MVK/PRF/Touch ID
   * paths. The local key is only usable on devices that have safeStorage
   * (Electron); web builds have no `window.api.invoke` and fall through to the
   * password-derived path.
   */
  async ensureVaultKey(password = null) {
    await e2eeManager.ensureReady();

    const canSecureStore = !!(window.api && typeof window.api.invoke === 'function');

    // 1. Stored local key takes priority — fully passwordless on this device.
    if (canSecureStore) {
      try {
        const storedB64 = await window.api.invoke('auth:secure-load', 'e2ee_vault_key');
        if (storedB64) {
          const key = e2eeManager.fromBase64(storedB64);
          this._mvk = key;
          return key;
        }
      } catch (e) {
        console.warn('[AuthClient] ensureVaultKey: secure-load failed:', e && e.message);
      }
    }

    // 2. Password-derived key (legacy/account path). Persisted locally so the
    //    next unlock on this device can skip the password.
    if (password) {
      const { kek } = await e2eeManager.deriveKEKFromPassword(password);
      this._mvk = kek;
      if (canSecureStore) {
        try {
          await window.api.invoke('auth:secure-save', 'e2ee_vault_key', e2eeManager.toBase64(kek));
        } catch (e) {
          console.warn('[AuthClient] ensureVaultKey: secure-save (password) failed:', e && e.message);
        }
      }
      return kek;
    }

    // 3. Freshly generated random key (accountless local-first), persisted locally.
    const key = await e2eeManager.generateVaultKey();
    this._mvk = key;
    if (canSecureStore) {
      try {
        await window.api.invoke('auth:secure-save', 'e2ee_vault_key', e2eeManager.toBase64(key));
      } catch (e) {
        console.warn('[AuthClient] ensureVaultKey: secure-save (generated) failed:', e && e.message);
      }
    }
    return key;
  }

  // ─── PRF Vault Unlock (Passwordless E2EE) ───

  /**
   * Setup MVK system for a user who already has password-encrypted keys.
   * Creates an MVK, wraps it with the password KEK, stores the wrap on server.
   * Optionally also wraps with PRF if a prfOutput is provided.
   */
  async setupMVK(password, prfOutput = null) {
      const mvk = await e2eeManager.generateMVK();

      // Wrap MVK with password-derived KEK
      const { kek: passwordKEK, salt } = await e2eeManager.deriveKEKFromPassword(password);
      const passwordWrap = await e2eeManager.wrapMVK(mvk, passwordKEK);
      await this.storeMvkWrap('password', passwordWrap, { salt });

      // If PRF output available, also create a PRF wrap
      if (prfOutput) {
          const prfKEK = await e2eeManager.deriveKEKFromPRF(prfOutput);
          const prfWrap = await e2eeManager.wrapMVK(mvk, prfKEK);
          await this.storeMvkWrap('webauthn_prf', prfWrap);
      }

      // Re-encrypt the user's private key with MVK (migrate from password-direct to MVK)
      if (this.e2ee.privateKey) {
          const encryptedWithMVK = await e2eeManager.encryptPrivateKeyWithMVK(this.e2ee.privateKey, mvk);
          // Store locally for this session
          await window.api?.invoke('auth:secure-save', 'mvk_encrypted_pk', encryptedWithMVK);
      }

      // Store MVK in session memory (cleared on tab close for web)
      this._mvk = mvk;
      return true;
  }

  /**
   * Unlock vault using WebAuthn PRF extension (passwordless).
   * Fetches the PRF wrap from server, derives KEK from PRF output, unwraps MVK.
   */
  async unlockWithPRF(prfOutput) {
      const wraps = await this.getMvkWraps();
      const prfWrap = wraps.find(w => w.type === 'webauthn_prf');
      if (!prfWrap) throw new Error('No PRF wrap found — set up passkey vault first');

      const prfKEK = await e2eeManager.deriveKEKFromPRF(prfOutput);
      const mvk = await e2eeManager.unwrapMVK(prfWrap.wrap, prfKEK);
      this._mvk = mvk;

      // Decrypt private key with MVK
      const encryptedPK = await window.api?.invoke('auth:secure-load', 'mvk_encrypted_pk');
      if (encryptedPK) {
          this.e2ee.privateKey = await e2eeManager.decryptPrivateKeyWithMVK(encryptedPK, mvk);
          this.e2ee.publicKey = this.user?.publicKey;
          console.log('[AuthClient] Vault unlocked via PRF');
      }
      return true;
  }

  /**
   * Unlock vault with password via MVK system.
   * Falls back to direct decryption if no MVK wraps exist.
   */
  async unlockVault(password) {
      const wraps = await this.getMvkWraps();
      const passwordWrap = wraps.find(w => w.type === 'password');

      if (!passwordWrap) {
          // No MVK system set up — use legacy direct decryption, then migrate
          const result = await this.unlockE2EE(password);
          if (result && this.e2ee.privateKey) {
              // Migrate to MVK on first successful unlock
              await this.setupMVK(password);
          }
          return result;
      }

      // Derive KEK from password and unwrap MVK
      const { kek } = await e2eeManager.deriveKEKFromPassword(password, passwordWrap.metadata?.salt);
      const mvk = await e2eeManager.unwrapMVK(passwordWrap.wrap, kek);
      this._mvk = mvk;

      // Decrypt private key using legacy method (stored on server encrypted with password)
      // Then re-encrypt with MVK for local use
      if (this.user?.encryptedPrivateKey && this.user?.keySalt) {
          try {
              this.e2ee.privateKey = await e2eeManager.decryptPrivateKey(
                  this.user.encryptedPrivateKey, password, this.user.keySalt
              );
              this.e2ee.publicKey = this.user.publicKey;

              // Cache MVK-encrypted private key locally
              const encryptedWithMVK = await e2eeManager.encryptPrivateKeyWithMVK(this.e2ee.privateKey, mvk);
              await window.api?.invoke('auth:secure-save', 'mvk_encrypted_pk', encryptedWithMVK);

              console.log('[AuthClient] Vault unlocked via password + MVK');
              return true;
          } catch (e) {
              console.error('[AuthClient] MVK vault unlock failed:', e);
              return false;
          }
      }
      return false;
  }

  /**
   * Add a PRF-based MVK wrap for an existing user (re-wrap flow).
   * User must already have their vault unlocked (this._mvk is set).
   */
  async addPrfMvkWrap(prfOutput) {
      if (!this._mvk) throw new Error('Vault must be unlocked first');
      const prfKEK = await e2eeManager.deriveKEKFromPRF(prfOutput);
      const prfWrap = await e2eeManager.wrapMVK(this._mvk, prfKEK);
      await this.storeMvkWrap('webauthn_prf', prfWrap);
      return true;
  }

  // ─── Document Key Wrap Methods ───

  async storeDocumentKeyWrap(docId, userId, wrappedKey) {
      const url = await this.getUrl(`/documents/${docId}/key-wraps`);
      const res = await fetch(url, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ userId, wrappedKey })
      });
      if (!res.ok) throw new Error('Failed to store document key wrap');
      return await res.json();
  }

  async storeDocumentKeyWrapsBatch(docId, wraps) {
      const url = await this.getUrl(`/documents/${docId}/key-wraps/batch`);
      const res = await fetch(url, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ wraps })
      });
      if (!res.ok) throw new Error('Failed to store document key wraps');
      return await res.json();
  }

  async getDocumentKeyWrap(docId) {
      const url = await this.getUrl(`/documents/${docId}/key-wrap`);
      const res = await fetch(url, { headers: this.headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to get document key wrap');
      const data = await res.json();
      return data.wrappedKey;
  }

  // ─── Biometrics & Secure Storage (Electron) ───

  async canUseBiometrics() {
      if (window.api && window.api.invoke) {
          return await window.api.invoke('auth:can-prompt-touch-id');
      }
      return false;
  }

  async promptBiometrics(reason) {
      if (window.api && window.api.invoke) {
          return await window.api.invoke('auth:prompt-touch-id', reason);
      }
      return false;
  }

  async saveSecureToken(token) {
      if (window.api && window.api.invoke) {
          await window.api.invoke('auth:secure-save', 'token', token);
      }
  }

  async loadSecureToken() {
      if (window.api && window.api.invoke) {
          return await window.api.invoke('auth:secure-load', 'token');
      }
      return null;
  }

  async clearSecureToken() {
      if (window.api && window.api.invoke) {
          await window.api.invoke('auth:secure-clear', 'token');
      }
  }

  // ─── Touch ID Vault Unlock (Electron only) ───

  /**
   * Setup Touch ID vault unlock.
   * Wraps MVK with a random KEK, stores KEK in safeStorage (requires Touch ID),
   * and uploads the Touch ID MVK wrap to the server.
   * Vault must already be unlocked (this._mvk exists).
   */
  async setupTouchID() {
      if (!this._mvk) throw new Error('Vault must be unlocked first');
      if (!(await this.canUseBiometrics())) throw new Error('Touch ID not available');

      // Prompt Touch ID to confirm user intent
      const ok = await this.promptBiometrics('Enable Touch ID for vault unlock');
      if (!ok) throw new Error('Touch ID authentication cancelled');

      // Generate random KEK for Touch ID
      await e2eeManager.ensureReady();
      const touchIdKEK = await e2eeManager.generateMVK(); // 32 random bytes, same size as KEK

      // Wrap MVK with this KEK
      const touchIdWrap = await e2eeManager.wrapMVK(this._mvk, touchIdKEK);

      // Store KEK in Electron safeStorage (protected by system Keychain / Touch ID)
      const kekBase64 = e2eeManager.toBase64(touchIdKEK);
      await window.api.invoke('auth:secure-save', 'touchid_kek', kekBase64);

      // Upload the wrapped MVK to the server
      await this.storeMvkWrap('touchid', touchIdWrap);

      console.log('[AuthClient] Touch ID vault unlock enabled');
      return true;
  }

  /**
   * Unlock vault using Touch ID.
   * Loads KEK from safeStorage (triggers Touch ID), fetches wrap from server, unwraps MVK.
   */
  async unlockWithTouchID() {
      if (!(await this.canUseBiometrics())) throw new Error('Touch ID not available');

      // Prompt Touch ID
      const ok = await this.promptBiometrics('Unlock your Paperus vault');
      if (!ok) throw new Error('Touch ID authentication cancelled');

      // Load KEK from safeStorage
      const kekBase64 = await window.api.invoke('auth:secure-load', 'touchid_kek');
      if (!kekBase64) throw new Error('No Touch ID KEK found — set up Touch ID first');

      const touchIdKEK = e2eeManager.fromBase64(kekBase64);

      // Fetch Touch ID wrap from server
      const wraps = await this.getMvkWraps();
      const touchIdWrap = wraps.find(w => w.type === 'touchid');
      if (!touchIdWrap) throw new Error('No Touch ID wrap on server');

      // Unwrap MVK
      const mvk = await e2eeManager.unwrapMVK(touchIdWrap.wrap, touchIdKEK);
      this._mvk = mvk;

      // Decrypt private key
      const encryptedPK = await window.api.invoke('auth:secure-load', 'mvk_encrypted_pk');
      if (encryptedPK) {
          this.e2ee.privateKey = await e2eeManager.decryptPrivateKeyWithMVK(encryptedPK, mvk);
          this.e2ee.publicKey = this.user?.publicKey;
      }

      console.log('[AuthClient] Vault unlocked via Touch ID');
      return true;
  }

  /**
   * Check if Touch ID vault unlock is set up.
   */
  async isTouchIDSetup() {
      if (!(await this.canUseBiometrics())) return false;
      const kekBase64 = await window.api.invoke('auth:secure-load', 'touchid_kek');
      return !!kekBase64;
  }
}

export const authClient = new AuthClient();
authClient.setSession = authClient.setSession.bind(authClient);
authClient.logout = authClient.logout.bind(authClient);
