/**
 * identity.js — the session identity store for P2P teams.
 *
 * A "P2P identity" is the deterministic Ed25519 keypair you get from a team's
 * (username + password) via team-keys.deriveIdentity. The PRIVATE key proves
 * you're you (signs roster claims, future writes); the PUBLIC key is what the
 * team roster records.
 *
 * Storage policy (security caveat R4):
 *   - PRIVATE keys live in session MEMORY only. They are never written to
 *     localStorage. (An optional encrypted-at-rest cache via Electron
 *     `safeStorage` can be wired through the documented hooks below; until then
 *     re-login re-derives the key, which is cheap UX and the safest default.)
 *   - A NON-SECRET profile (username, displayName, color, publicKey) is
 *     persisted per team so we can show "you're alice" and pre-fill the username
 *     on the next launch without holding the password.
 *
 * Identities are per-team: the same person may be `alice` in two teams with two
 * distinct keypairs, so everything is keyed by `teamId`.
 */

const PROFILE_KEY = 'notionless_id_profiles' // { [teamId]: {username, displayName, color, publicKey} }

function isWeb() {
  return typeof document !== 'undefined' && document.body && document.body.classList.contains('is-web')
}

function generateColor(seed) {
  const s = String(seed || '')
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`
}

class IdentityStore {
  constructor() {
    // teamId -> { username, displayName, color, publicKey, privateKey }
    this._byTeam = new Map()
    this._profiles = null // lazy-loaded non-secret cache
  }

  // ── Non-secret profile persistence (username/displayName/color/publicKey) ──

  async _loadProfiles() {
    if (this._profiles) return this._profiles
    let raw = null
    try {
      if (typeof window !== 'undefined' && window.api && window.api.getSettings) {
        raw = await window.api.getSettings(PROFILE_KEY)
      } else if (typeof localStorage !== 'undefined') {
        raw = localStorage.getItem(PROFILE_KEY)
      }
    } catch (e) { /* ignore */ }
    let parsed = {}
    if (raw && typeof raw === 'object') parsed = raw
    else if (typeof raw === 'string' && raw) { try { parsed = JSON.parse(raw) } catch { parsed = {} } }
    this._profiles = parsed && typeof parsed === 'object' ? parsed : {}
    return this._profiles
  }

  async _saveProfiles() {
    const data = this._profiles || {}
    try {
      if (typeof window !== 'undefined' && window.api && window.api.setSettings) {
        await window.api.setSettings(PROFILE_KEY, JSON.stringify(data))
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(data))
      }
    } catch (e) { /* ignore */ }
  }

  /** The stored non-secret profile for a team (no privateKey), or null. */
  async getProfile(teamId) {
    const profiles = await this._loadProfiles()
    return profiles[teamId] || null
  }

  // ── Active session identity ──────────────────────────────────────────────

  /**
   * Record the unlocked identity for a team (full keypair, in memory) and
   * persist its non-secret profile.
   * @param {string} teamId
   * @param {object} id { username, displayName?, color?, publicKey, privateKey }
   */
  async setIdentity(teamId, id) {
    if (!teamId || !id || !id.publicKey || !id.privateKey) {
      throw new Error('setIdentity: teamId + full keypair required')
    }
    const displayName = id.displayName || id.username || 'Anonymous'
    const color = id.color || generateColor(id.publicKey)
    const full = {
      username: id.username,
      displayName,
      color,
      publicKey: id.publicKey,
      privateKey: id.privateKey,
    }
    this._byTeam.set(teamId, full)

    const profiles = await this._loadProfiles()
    profiles[teamId] = { username: id.username, displayName, color, publicKey: id.publicKey }
    this._profiles = profiles
    await this._saveProfiles()
    return full
  }

  /** Full identity (incl. privateKey) for a team, if unlocked this session. */
  getIdentity(teamId) {
    return this._byTeam.get(teamId) || null
  }

  /** True if the private key for this team is available in memory. */
  isUnlocked(teamId) {
    return this._byTeam.has(teamId)
  }

  /** Drop the in-memory keypair (e.g. on lock). Profile stays for username pre-fill. */
  lock(teamId) {
    this._byTeam.delete(teamId)
  }

  /** Forget a team entirely (memory + persisted profile). */
  async forget(teamId) {
    this._byTeam.delete(teamId)
    const profiles = await this._loadProfiles()
    if (profiles[teamId]) { delete profiles[teamId]; this._profiles = profiles; await this._saveProfiles() }
  }

  /**
   * Awareness/presence descriptor for a team's identity. Falls back to the
   * persisted profile (no privateKey) so a still-locked member still renders a
   * label. `id` is the publicKey so cursors are stable across sessions.
   */
  presenceUser(teamId) {
    const full = this._byTeam.get(teamId)
    if (full) {
      return { id: full.publicKey, name: full.displayName, color: full.color, email: '' }
    }
    const cached = this._profiles && this._profiles[teamId]
    if (cached) return { id: cached.publicKey, name: cached.displayName, color: cached.color, email: '' }
    return null
  }

  /** Git commit author derived from a team identity (used by git-sync). */
  gitAuthor(teamId) {
    const p = this._byTeam.get(teamId) || (this._profiles && this._profiles[teamId])
    if (!p) return null
    return { name: p.displayName || p.username || 'Anonymous', email: `${p.username || 'anon'}@notionless.local` }
  }
}

export const identity = new IdentityStore()
export { generateColor, isWeb }
