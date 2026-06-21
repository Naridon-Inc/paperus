/**
 * p2p-team.js — the P2P team workspace manager.
 *
 * A team is:
 *   - ONE root Y.Doc (guid = teamDocId), E2EE + P2P, holding:
 *       • `rosterClaims` (Y.Array)  — signed membership log (RosterManager)
 *       • `notes`        (Y.Map)    — the note index / tree (tombstoned deletes)
 *       • `teamMeta`     (Y.Map)    — { name }
 *   - MANY per-note Y.Docs, each in its own swarm/E2EE room, opened lazily when
 *     a note is opened (via the `openP2PDoc` chokepoint).
 *
 * Every key (root + per-note swarm/E2EE) derives from the single `teamRootKey`
 * inside the team link (team-keys.js). The relay only ever sees BLAKE2b-hashed
 * topics and AEAD ciphertext.
 *
 * Persistence: the joined-team list (incl. each rootKey — the team's read
 * capability) is stored LOCALLY only (Electron settings / web localStorage),
 * never sent anywhere. This is the documented web-at-rest tradeoff (R4).
 */
import * as Y from 'yjs'
import { openP2PDoc } from './engine'
import {
  generateTeamKey, buildTeamLink, buildTeamCode, buildShareV2Link,
} from './p2p'
import { deriveTeamKeys, deriveNoteKeys, deriveNoteSwarmKey } from './team-keys'
import { RosterManager } from './team-roster'
import { identity } from './identity'
import { e2eeManager } from './e2ee'

// Max concurrent background ciphertext replicas per team (one y-webrtc room each).
// Keeps total WebRTC connections sane on small teams; the tail replicates lazily.
const MAX_REPLICAS = 12

const TEAMS_KEY = 'p2p_teams' // [{ teamId, rootKey, name }]

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export class P2PTeamManager {
  constructor() {
    // teamId -> { teamId, rootKey, name, keys, rootEngine, roster, _notesObserver }
    this._teams = new Map()
    this._ready = false
  }

  // ── Lifecycle / persistence ────────────────────────────────────────────────

  async init() {
    if (this._ready) return
    this._ready = true
    const saved = await this._loadSaved()
    // Reconnect each persisted team's root doc (small N; teams are personal).
    for (const t of saved) {
      try { await this._openRoot(t.rootKey, t.name) } catch (e) { console.warn('[P2PTeam] reconnect failed', t.teamId, e) }
    }
    this._emitTeams()
  }

  async _loadSaved() {
    try {
      const raw = await window.api.getSettings(TEAMS_KEY)
      if (Array.isArray(raw)) return raw
      if (typeof raw === 'string' && raw) return JSON.parse(raw)
    } catch (e) { /* ignore */ }
    return []
  }

  async _persist() {
    const list = [...this._teams.values()].map((t) => ({ teamId: t.teamId, rootKey: t.rootKey, name: t.name }))
    try { await window.api.setSettings(TEAMS_KEY, JSON.stringify(list)) } catch (e) { /* ignore */ }
  }

  // ── Root doc open ────────────────────────────────────────────────────────────

  /** Open (or return) the connected root engine for a team root key. */
  async _openRoot(rootKey, fallbackName) {
    const keys = await deriveTeamKeys(rootKey)
    const existing = this._teams.get(keys.teamId)
    if (existing && existing.rootEngine) return existing

    // Presence on the root doc uses our identity for this team if unlocked.
    const presence = identity.presenceUser(keys.teamId)
    const rootEngine = await openP2PDoc({
      docId: keys.teamDocId,
      swarmKey: keys.swarmKey,
      e2eeKey: keys.e2eeKey,
      identity: presence || undefined,
    })

    const roster = new RosterManager(rootEngine, keys.teamId)
    const teamMeta = rootEngine.doc.getMap('teamMeta')
    const notes = rootEngine.doc.getMap('notes')
    const noteAcl = rootEngine.doc.getMap('noteAcl')

    const entry = {
      teamId: keys.teamId,
      rootKey,
      keys,
      name: teamMeta.get('name') || fallbackName || 'Team',
      rootEngine,
      roster,
      notes,
      teamMeta,
      noteAcl,
      // noteId -> { contentKey, title, encMeta } for restricted notes WE can read.
      // Built async by _resolveRestricted so getNotesTree stays synchronous.
      restrictedCache: new Map(),
      // noteId -> replicate-only engine ('pending' while opening) for background
      // ciphertext replication.
      replicas: new Map(),
      // noteIds currently open as full editor tabs (they replicate themselves,
      // so the background replication manager skips them).
      _openNotes: new Set(),
    }

    // React to remote tree/name changes: emit the tree immediately (locked
    // placeholders + normal notes), then async-resolve any restricted titles
    // we can decrypt and reconcile background replicas.
    entry._notesObserver = () => {
      this._emitTree(entry.teamId)
      this._resolveRestricted(entry)
      this._reconcileReplicas(entry)
    }
    notes.observe(entry._notesObserver)
    // A grant (new wrap added to an ACL) lets us unlock a note we couldn't before.
    entry._aclObserver = () => this._resolveRestricted(entry)
    noteAcl.observeDeep(entry._aclObserver)
    entry._metaObserver = () => {
      const n = teamMeta.get('name')
      if (n && n !== entry.name) { entry.name = n; this._emitTeams() }
    }
    teamMeta.observe(entry._metaObserver)

    this._teams.set(keys.teamId, entry)
    // Kick off initial restricted-title resolution + background replication.
    this._resolveRestricted(entry)
    this._reconcileReplicas(entry)
    return entry
  }

  _get(teamId) {
    const t = this._teams.get(teamId)
    if (!t) throw new Error(`Unknown team ${teamId}`)
    return t
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /** Create a brand-new team. Returns { teamId, rootKey, link, name }. */
  async createTeam(name) {
    const rootKey = generateTeamKey()
    const entry = await this._openRoot(rootKey, name)
    entry.name = name || 'Team'
    entry.teamMeta.set('name', entry.name)
    await this._persist()
    this._emitTeams()
    return { teamId: entry.teamId, rootKey, link: buildTeamLink(rootKey), code: buildTeamCode(rootKey), name: entry.name }
  }

  /**
   * Join an existing team from its root key. Connects the root doc and waits
   * briefly for the roster/tree to sync. Returns { teamId, name }. The caller
   * then prompts for claim-or-login (identity), which is separate from joining.
   */
  async joinTeam(rootKey) {
    const entry = await this._openRoot(rootKey)
    await this._persist()
    // Give the swarm a moment to deliver existing roster/tree state.
    await this._waitForFirstSync(entry)
    this._emitTeams()
    this._emitTree(entry.teamId)
    return { teamId: entry.teamId, name: entry.name }
  }

  async _waitForFirstSync(entry, timeoutMs = 4000) {
    const net = entry.rootEngine.network
    if (!net) return
    if (net.connected) return
    await new Promise((resolve) => {
      const done = () => resolve()
      const t = setTimeout(done, timeoutMs)
      const onStatus = (e) => {
        if (e.detail && e.detail.docId === entry.rootEngine.docId) { clearTimeout(t); window.removeEventListener('sync:status', onStatus); resolve() }
      }
      window.addEventListener('sync:status', onStatus)
    })
  }

  getTeams() {
    return [...this._teams.values()].map((t) => ({ teamId: t.teamId, name: t.name, rootKey: t.rootKey }))
  }

  getRoster(teamId) { return this._get(teamId).roster }
  /** The reconciled member list for a team (defensive wrapper over the roster). */
  getRosterMembers(teamId) {
    try {
      const r = this.getRoster(teamId)
      return (r && typeof r.getMembers === 'function') ? r.getMembers() : []
    } catch (_e) { return [] }
  }
  getKeys(teamId) { return this._get(teamId).keys }
  getName(teamId) { return this._get(teamId).name }

  /**
   * How many members are currently online on the team's root doc (via awareness).
   * `others` excludes this client — the availability contract is "≥1 OTHER member
   * online keeps the latest reachable". Returns { total, others }.
   */
  getOnlinePeers(teamId) {
    const t = this._teams.get(teamId)
    if (!t || !t.rootEngine || !t.rootEngine.awareness) return { total: 0, others: 0 }
    const total = t.rootEngine.awareness.getStates().size
    return { total, others: Math.max(0, total - 1) }
  }

  /** Build the nested note tree (excluding tombstoned notes). */
  getNotesTree(teamId) {
    const t = this._teams.get(teamId)
    if (!t) return []
    const all = []
    t.notes.forEach((v, id) => {
      if (!v || v.deleted) return
      if (v.restricted) {
        const cached = t.restrictedCache.get(id)
        // Structural fields (parentId/order) stay plaintext so the tree builds
        // for everyone; only the title is gated on holding the content key.
        if (cached) {
          all.push({
            id, parentId: v.parentId || null, order: v.order, createdAt: v.createdAt,
            restricted: true, hasAccess: true, title: cached.title,
          })
        } else {
          all.push({
            id, parentId: v.parentId || null, order: v.order, createdAt: v.createdAt,
            restricted: true, hasAccess: false, locked: true, title: 'Restricted',
          })
        }
        return
      }
      all.push({ ...v, id })
    })
    const byParent = new Map()
    for (const n of all) {
      const p = n.parentId || null
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p).push(n)
    }
    const sortFn = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0)
    const build = (parentId) => (byParent.get(parentId) || []).sort(sortFn).map((n) => ({ ...n, children: build(n.id) }))
    return build(null)
  }

  /**
   * Create a note. Pass `{ restricted: true, grantTo: [memberPubKey, ...] }` to
   * make it readable only by the listed members (the creator is always included).
   * Restricted notes still replicate their ciphertext to every member — only the
   * content key (and thus the title, via `encMeta`) is withheld.
   */
  async createNote(teamId, {
    title = 'Untitled', parentId = null, restricted = false, grantTo = [],
  } = {}) {
    const t = this._get(teamId)
    const id = uid('note')
    const siblings = []
    t.notes.forEach((v) => { if (v && !v.deleted && (v.parentId || null) === (parentId || null)) siblings.push(v) })
    const order = siblings.reduce((m, s) => Math.max(m, s.order ?? 0), 0) + 1
    const base = { id, parentId: parentId || null, order, createdAt: Date.now(), deleted: false }

    if (!restricted) {
      t.rootEngine.doc.transact(() => { t.notes.set(id, { ...base, title }) }, 'team')
      this._reconcileReplicas(t)
      return id
    }

    const me = identity.getIdentity(teamId)
    if (!me || !me.publicKey || !me.privateKey) {
      throw new Error('Claim your identity before creating a restricted note')
    }
    // Random content key (NOT derived) — only ACL members get it, wrapped to
    // their Ed25519 identity via a sealed box. Creator is always a grantee.
    const contentKey = await e2eeManager.generateDocumentKey()
    const encMeta = await e2eeManager.encryptString(JSON.stringify({ title }), contentKey)
    const grantees = [...new Set([me.publicKey, ...(grantTo || [])])].filter(Boolean)
    const wraps = []
    for (const pk of grantees) {
      // eslint-disable-next-line no-await-in-loop
      wraps.push([pk, await e2eeManager.wrapKeyForIdentity(contentKey, pk)])
    }
    t.rootEngine.doc.transact(() => {
      t.notes.set(id, { ...base, restricted: true, encMeta })
      const acl = new Y.Map()
      t.noteAcl.set(id, acl)
      for (const [pk, w] of wraps) acl.set(pk, w)
    }, 'team')
    // Cache so the creator sees the title immediately (no decrypt round-trip).
    t.restrictedCache.set(id, { contentKey, title, encMeta })
    this._reconcileReplicas(t)
    return id
  }

  async renameNote(teamId, noteId, title) {
    const t = this._get(teamId)
    const cur = t.notes.get(noteId)
    if (!cur) return false
    if (cur.restricted) {
      // Title lives in encMeta; re-encrypt it under the same content key.
      const unlocked = await this._unlockNote(t, noteId)
      if (!unlocked) return false // can't rename what you can't read
      const encMeta = await e2eeManager.encryptString(JSON.stringify({ title }), unlocked.contentKey)
      t.rootEngine.doc.transact(() => { t.notes.set(noteId, { ...cur, encMeta }) }, 'team')
      t.restrictedCache.set(noteId, { contentKey: unlocked.contentKey, title, encMeta })
      this._emitTree(teamId)
      return true
    }
    t.rootEngine.doc.transact(() => { t.notes.set(noteId, { ...cur, title }) }, 'team')
    return true
  }

  async moveNote(teamId, noteId, parentId, order) {
    const t = this._get(teamId)
    const cur = t.notes.get(noteId)
    if (!cur) return false
    t.rootEngine.doc.transact(() => {
      t.notes.set(noteId, { ...cur, parentId: parentId || null, order: order ?? cur.order })
    }, 'team')
    return true
  }

  /** Tombstone a note (CRDT-safe deletion — never hard-removes the key). */
  async deleteNote(teamId, noteId) {
    const t = this._get(teamId)
    const cur = t.notes.get(noteId)
    if (!cur) return false
    t.rootEngine.doc.transact(() => {
      t.notes.set(noteId, { ...cur, deleted: true, deletedAt: Date.now() })
    }, 'team')
    return true
  }

  getNoteMeta(teamId, noteId) {
    const t = this._teams.get(teamId)
    return t ? (t.notes.get(noteId) || null) : null
  }

  /**
   * Open a per-note doc engine (E2EE + P2P) for editing. Each call returns a
   * fresh engine; the caller (main.js) owns its lifecycle and destroys it on
   * tab switch, exactly like cloud docs.
   */
  async openNote(teamId, noteId) {
    const t = this._get(teamId)
    const meta = t.notes.get(noteId)
    if (!meta) throw new Error(`Unknown note ${noteId}`)
    // Swarm key is ALWAYS derived → every member replicates. Only the content
    // key differs: derived for normal notes, unwrapped-per-member for restricted.
    const { swarmKey, e2eeKey: derivedKey } = await deriveNoteKeys(t.rootKey, noteId)
    let e2eeKey = derivedKey
    if (meta.restricted) {
      const unlocked = await this._unlockNote(t, noteId)
      if (!unlocked) {
        const err = new Error('You do not have access to this restricted note')
        err.code = 'NO_ACCESS'
        throw err
      }
      e2eeKey = unlocked.contentKey
    }
    // Mark open + retire any background replica: the full editor engine
    // replicates the same room and we don't want two providers on one note.
    t._openNotes.add(noteId)
    this._dropReplica(t, noteId)
    const presence = identity.presenceUser(teamId)
    const engine = await openP2PDoc({
      docId: noteId,
      swarmKey,
      e2eeKey,
      identity: presence || undefined,
    })
    return engine
  }

  /**
   * Tell the manager a note's editor tab was closed. Re-forms a background
   * replica so the note stays reachable for the rest of the team.
   */
  closeNote(teamId, noteId) {
    const t = this._teams.get(teamId)
    if (!t) return
    t._openNotes.delete(noteId)
    this._reconcileReplicas(t)
  }

  /**
   * Resolve a member's access to a note. For normal notes everyone has access;
   * for restricted notes, access means holding a wrap in `noteAcl[id]`.
   * Returns { restricted, hasAccess, contentKey|null, title }.
   */
  async resolveNoteAccess(teamId, noteId) {
    const t = this._get(teamId)
    const meta = t.notes.get(noteId)
    if (!meta) return { restricted: false, hasAccess: false, contentKey: null, title: null }
    if (!meta.restricted) {
      return { restricted: false, hasAccess: true, contentKey: null, title: meta.title }
    }
    const unlocked = await this._unlockNote(t, noteId)
    if (!unlocked) return { restricted: true, hasAccess: false, contentKey: null, title: null }
    return {
      restricted: true, hasAccess: true, contentKey: unlocked.contentKey, title: unlocked.title,
    }
  }

  /**
   * Grant a member access to a restricted note. Any current key-holder can do
   * this (Notion-style "anyone with access can share"): we unwrap the content
   * key, re-wrap it to the new member's identity, and add it to the note's ACL.
   */
  async grantAccess(teamId, noteId, memberPubKey) {
    const t = this._get(teamId)
    const meta = t.notes.get(noteId)
    if (!meta || !meta.restricted) return { ok: false, reason: 'not-restricted' }
    const member = t.roster.getMembers().find((m) => m.idPublicKey === memberPubKey)
    if (!member) return { ok: false, reason: 'unknown-member' }
    const unlocked = await this._unlockNote(t, noteId)
    if (!unlocked) return { ok: false, reason: 'no-access' }
    const acl = t.noteAcl.get(noteId)
    if (!acl) return { ok: false, reason: 'not-restricted' }
    if (acl.get(memberPubKey)) return { ok: true, already: true }
    const wrapped = await e2eeManager.wrapKeyForIdentity(unlocked.contentKey, memberPubKey)
    t.rootEngine.doc.transact(() => { acl.set(memberPubKey, wrapped) }, 'team')
    return { ok: true }
  }

  /**
   * The access list for a restricted note: every roster member, flagged with
   * whether they currently hold a wrap. Normal notes return all-access.
   */
  getNoteAccessList(teamId, noteId) {
    const t = this._get(teamId)
    const meta = t.notes.get(noteId)
    const members = t.roster.getMembers()
    if (!meta || !meta.restricted) {
      return members.map((m) => ({ ...m, hasAccess: true }))
    }
    const acl = t.noteAcl.get(noteId)
    return members.map((m) => ({ ...m, hasAccess: !!(acl && acl.get(m.idPublicKey)) }))
  }

  /**
   * Unwrap a restricted note's content key for the current identity and decrypt
   * its title. Returns { contentKey, title } or null if we have no access.
   */
  async _unlockNote(entry, noteId) {
    const meta = entry.notes.get(noteId)
    if (!meta || !meta.restricted) return null
    const me = identity.getIdentity(entry.teamId)
    if (!me || !me.publicKey || !me.privateKey) return null
    const acl = entry.noteAcl.get(noteId)
    if (!acl) return null
    const wrapped = acl.get(me.publicKey)
    if (!wrapped) return null
    try {
      const contentKey = await e2eeManager.unwrapKeyForIdentity(wrapped, me.publicKey, me.privateKey)
      let title = 'Untitled'
      if (meta.encMeta) {
        const json = await e2eeManager.decryptString(meta.encMeta, contentKey)
        if (json) { try { title = JSON.parse(json).title || title } catch (_e) { /* keep default */ } }
      }
      return { contentKey, title }
    } catch (_e) {
      return null
    }
  }

  /**
   * Fill `restrictedCache` for every restricted note we can decrypt, refresh
   * titles whose `encMeta` changed (remote rename), and prune tombstoned notes.
   * Emits the tree if anything changed so locked rows flip to titles.
   */
  async _resolveRestricted(entry) {
    const ids = []
    entry.notes.forEach((v, id) => { if (v && !v.deleted && v.restricted) ids.push(id) })
    let changed = false
    for (const id of ids) {
      const meta = entry.notes.get(id)
      const cached = entry.restrictedCache.get(id)
      if (cached) {
        if (cached.encMeta !== meta.encMeta && cached.contentKey) {
          // Title was renamed remotely — re-decrypt with the key we already hold.
          // eslint-disable-next-line no-await-in-loop
          const json = meta.encMeta ? await e2eeManager.decryptString(meta.encMeta, cached.contentKey) : null
          let title = cached.title
          if (json) { try { title = JSON.parse(json).title || title } catch (_e) { /* keep */ } }
          entry.restrictedCache.set(id, { ...cached, title, encMeta: meta.encMeta })
          changed = true
        }
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      const unlocked = await this._unlockNote(entry, id)
      if (unlocked) { entry.restrictedCache.set(id, { ...unlocked, encMeta: meta.encMeta }); changed = true }
    }
    for (const id of [...entry.restrictedCache.keys()]) {
      const v = entry.notes.get(id)
      if (!v || v.deleted) { entry.restrictedCache.delete(id); changed = true }
    }
    if (changed) this._emitTree(entry.teamId)
  }

  /** Re-apply presence on the root doc after identity unlock. */
  refreshPresence(teamId) {
    const t = this._teams.get(teamId)
    if (!t || !t.rootEngine) return
    const presence = identity.presenceUser(teamId)
    if (presence) t.rootEngine.presence.setUser(presence)
    // Now that we hold our private key, unlock any restricted notes granted to us.
    this._resolveRestricted(t)
  }

  // ── Eager background replication (Electron only) ───────────────────────────
  //
  // So that ≥1 online member keeps every note reachable, each member holds a
  // background "replicate-only" connection to every note's swarm room: it syncs
  // the encrypted transport doc (ciphertext) and persists it to IndexedDB
  // (`<id>:enc`) WITHOUT ever decrypting. No content key needed — replication and
  // decryption are separable (swarm key governs who replicates; content key
  // governs who reads). Notes open in a full editor tab replicate themselves, so
  // we skip those. Capped at MAX_REPLICAS concurrent rooms (small-team target).

  _isWeb() {
    return typeof document !== 'undefined' && !!document.body && document.body.classList.contains('is-web')
  }

  async _reconcileReplicas(entry) {
    if (this._isWeb()) return // web build is dev-only; no durable ciphertext
    const live = []
    entry.notes.forEach((v, id) => { if (v && !v.deleted) live.push({ id, createdAt: v.createdAt ?? 0 }) })
    // Most-recently-created first so the freshest notes replicate within the cap.
    live.sort((a, b) => b.createdAt - a.createdAt)
    const open = entry._openNotes
    const candidates = live.filter((n) => !open.has(n.id))
    const want = candidates.slice(0, MAX_REPLICAS).map((n) => n.id)
    const wantSet = new Set(want)
    if (candidates.length > MAX_REPLICAS) {
      // No silent truncation: be explicit that the tail replicates lazily (on open).
      console.warn(`[P2PTeam] ${candidates.length} notes but replica cap is ${MAX_REPLICAS}; `
        + `${candidates.length - MAX_REPLICAS} replicate lazily when opened.`)
    }
    // Drop replicas no longer wanted (tombstoned, opened as editor, or over cap).
    for (const id of [...entry.replicas.keys()]) {
      if (!wantSet.has(id)) this._dropReplica(entry, id)
    }
    // Add missing replicas.
    for (const id of want) {
      if (entry.replicas.has(id)) continue
      entry.replicas.set(id, 'pending') // reserve the slot against double-open races
      try {
        // eslint-disable-next-line no-await-in-loop
        const swarmKey = await deriveNoteSwarmKey(entry.rootKey, id)
        // Re-check: the note may have been opened/deleted while we awaited.
        const meta = entry.notes.get(id)
        if (entry.replicas.get(id) !== 'pending' || open.has(id) || !meta || meta.deleted) {
          if (entry.replicas.get(id) === 'pending') entry.replicas.delete(id)
          continue
        }
        // eslint-disable-next-line no-await-in-loop
        const eng = await openP2PDoc({ docId: id, swarmKey, replicaOnly: true })
        if (open.has(id)) { try { eng.destroy() } catch (_e) {} entry.replicas.delete(id); continue }
        entry.replicas.set(id, eng)
      } catch (e) {
        if (entry.replicas.get(id) === 'pending') entry.replicas.delete(id)
        console.warn('[P2PTeam] replica open failed', id, e)
      }
    }
  }

  _dropReplica(entry, noteId) {
    const eng = entry.replicas.get(noteId)
    entry.replicas.delete(noteId)
    if (eng && eng !== 'pending') { try { eng.destroy() } catch (_e) {} }
  }

  inviteLink(teamId) { return buildTeamLink(this._get(teamId).rootKey) }
  inviteCode(teamId) { return buildTeamCode(this._get(teamId).rootKey) }

  /** Least-privilege per-note share link (`share:v2`). */
  async noteShareLink(teamId, noteId) {
    const t = this._get(teamId)
    const meta = t.notes.get(noteId)
    const { swarmKey, e2eeKey: derivedKey } = await deriveNoteKeys(t.rootKey, noteId)
    let e2eeKey = derivedKey
    if (meta && meta.restricted) {
      // External share of a restricted note hands out its random content key —
      // only possible if we hold it. (Deliberate: the sharer opts in.)
      const unlocked = await this._unlockNote(t, noteId)
      if (!unlocked) { const e = new Error('You do not have access to this restricted note'); e.code = 'NO_ACCESS'; throw e }
      e2eeKey = unlocked.contentKey
    }
    return buildShareV2Link(swarmKey, e2eeKey)
  }

  /** Leave a team locally (stops syncing; tombstone-aware data stays with peers). */
  async leaveTeam(teamId) {
    const t = this._teams.get(teamId)
    if (!t) return
    try { t.notes.unobserve(t._notesObserver) } catch (_e) {}
    try { t.teamMeta.unobserve(t._metaObserver) } catch (_e) {}
    try { t.noteAcl.unobserveDeep(t._aclObserver) } catch (_e) {}
    try { for (const eng of t.replicas.values()) { try { eng.destroy() } catch (_e) {} } } catch (_e) {}
    t.replicas.clear()
    try { t.roster.destroy() } catch (_e) {}
    try { t.rootEngine.destroy() } catch (_e) {}
    this._teams.delete(teamId)
    await identity.forget(teamId)
    await this._persist()
    this._emitTeams()
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  _emitTeams() {
    window.dispatchEvent(new CustomEvent('team:list-updated', { detail: { teams: this.getTeams() } }))
  }

  _emitTree(teamId) {
    window.dispatchEvent(new CustomEvent('team:tree-updated', { detail: { teamId, tree: this.getNotesTree(teamId) } }))
  }
}
