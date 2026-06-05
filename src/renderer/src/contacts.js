/**
 * contacts.js — a cross-team address book + a sealed peer-to-peer "inbox" so you
 * can share a note directly with a *person* you've met, not just copy a link.
 *
 * Two pieces:
 *
 *  1. ContactStore — every identity you've ever shared a team with, deduped by
 *     Ed25519 public key and persisted GLOBALLY (across teams/projects). It is
 *     populated automatically from each team's signed roster (`team:roster-updated`).
 *     Your own identities are excluded via `markSelf`.
 *
 *  2. Inbox — each identity has a P2P "inbox" doc whose address derives from its
 *     PUBLIC key (`team-keys.deriveInboxKeys`), so any contact can reach it. To
 *     send a note you drop a sealed offer into the recipient's inbox; the offer's
 *     payload (note title + the note's swarm/E2EE keys) is sealed to the
 *     recipient's identity (`e2ee.wrapKeyForIdentity`), so even though the inbox
 *     topic isn't secret, only the recipient can open the offer. Opening a
 *     received offer is exactly opening a `share:v2` note (it carries the same
 *     swarmKey + e2eeKey).
 *
 * Availability is the same P2P trade-off as the rest of the app: delivery
 * happens while the sender (who keeps the outbound room open for the session)
 * and the recipient are both online; once received, the offer is stored locally
 * and is yours for good.
 */
import { openP2PDoc } from './engine'
import { deriveInboxKeys } from './team-keys'
import { e2eeManager } from './e2ee'

const CONTACTS_KEY = 'notionless_contacts'         // { [pubKey]: contact }
const RECEIVED_KEY = 'notionless_inbox_received'   // [offer, ...]

// ── persistence (global; Electron settings or browser localStorage) ──────────
async function _loadRaw(key) {
  try {
    if (typeof window !== 'undefined' && window.api && window.api.getSettings) {
      const v = await window.api.getSettings(key)
      if (v && typeof v === 'object') return v
      if (typeof v === 'string' && v) { try { return JSON.parse(v) } catch { return null } }
      return null
    }
    if (typeof localStorage !== 'undefined') { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null }
  } catch (_e) { /* ignore */ }
  return null
}
async function _saveRaw(key, val) {
  try {
    if (typeof window !== 'undefined' && window.api && window.api.setSettings) {
      await window.api.setSettings(key, JSON.stringify(val)); return
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(val))
  } catch (_e) { /* ignore */ }
}

function _now() { return Date.now() }
function _uuid() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID() } catch (_e) {}
  return `${_now()}-${Math.floor(Math.random() * 1e9)}`
}
function _emit(name, detail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }))
}

// ── ContactStore ─────────────────────────────────────────────────────────────
class ContactStore {
  constructor() { this._self = new Set() }

  /** Exclude one of my own identities (a per-team pubkey) from the book. */
  markSelf(pubKey) { if (pubKey) this._self.add(pubKey) }
  isSelf(pubKey) { return this._self.has(pubKey) }

  async _all() { return (await _loadRaw(CONTACTS_KEY)) || {} }

  /** All known contacts (excluding me), sorted by name. */
  async list() {
    const all = await this._all()
    return Object.values(all)
      .filter((c) => c && c.pubKey && !this._self.has(c.pubKey))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  }

  /** Capture everyone in a team's roster into the global book. */
  async recordRosterMembers(teamId, members) {
    const all = await this._all()
    let changed = false
    for (const m of members || []) {
      const pub = m && m.idPublicKey
      if (!pub || this._self.has(pub)) continue
      const name = m.displayName || m.username || 'Member'
      const ex = all[pub]
      if (!ex) {
        all[pub] = { pubKey: pub, name, color: m.color || '', teamIds: [teamId], firstSeen: _now(), lastSeen: _now() }
        changed = true
      } else {
        if (ex.name !== name) { ex.name = name; changed = true }
        if (!Array.isArray(ex.teamIds)) ex.teamIds = []
        if (!ex.teamIds.includes(teamId)) { ex.teamIds.push(teamId); changed = true }
        ex.lastSeen = _now()
      }
    }
    if (changed) { await _saveRaw(CONTACTS_KEY, all); _emit('contacts:updated', {}) }
  }

  async remove(pubKey) {
    const all = await this._all()
    if (all[pubKey]) { delete all[pubKey]; await _saveRaw(CONTACTS_KEY, all); _emit('contacts:updated', {}) }
  }
}

export const contactStore = new ContactStore()

// ── Received offers (persisted "Shared with me") ─────────────────────────────
export async function getReceivedOffers() { return (await _loadRaw(RECEIVED_KEY)) || [] }

async function _addReceivedOffer(offer) {
  const list = await getReceivedOffers()
  if (list.some((o) => o.id === offer.id)) return false
  list.push(offer)
  await _saveRaw(RECEIVED_KEY, list)
  _emit('inbox:received-updated', { offer })
  return true
}

export async function removeReceivedOffer(id) {
  const list = await getReceivedOffers()
  const next = list.filter((o) => o.id !== id)
  if (next.length !== list.length) { await _saveRaw(RECEIVED_KEY, next); _emit('inbox:received-updated', {}) }
}

// ── Inbox transport ──────────────────────────────────────────────────────────
const _outbox = new Map() // recipientPub -> engine (kept alive for the session)
const _inbox = new Map()  // myPub -> engine

/**
 * Drop a sealed note-offer into a contact's inbox.
 * @param {string} recipientPubKey base64 Ed25519 public key
 * @param {object} offer { type:'note', title, swarmKey, e2eeKey, fromName, fromPub }
 * @returns {Promise<string>} the offer id
 */
export async function sendNoteToContact(recipientPubKey, offer) {
  if (!recipientPubKey) throw new Error('sendNoteToContact: recipient required')
  await e2eeManager.ensureReady()
  const { docId, swarmKey, e2eeKey } = await deriveInboxKeys(recipientPubKey)
  let engine = _outbox.get(recipientPubKey)
  if (!engine) {
    engine = await openP2PDoc({ docId, swarmKey, e2eeKey })
    _outbox.set(recipientPubKey, engine)
    try { await engine.whenSynced() } catch (_e) {}
  }
  const offers = engine.doc.getArray('offers')
  // Seal the offer to the recipient: random one-time key encrypts the payload,
  // the one-time key is sealed to the recipient's identity. Nobody else (even
  // someone who joins the public inbox topic) can read it.
  const oneTime = await e2eeManager.generateDocumentKey()
  const ct = e2eeManager.encryptString(JSON.stringify(offer), oneTime)
  const wk = await e2eeManager.wrapKeyForIdentity(oneTime, recipientPubKey)
  const id = _uuid()
  engine.doc.transact(() => {
    offers.push([{ id, to: recipientPubKey, wk, ct, at: _now() }])
  })
  return id
}

/**
 * Subscribe to MY inbox: decrypt offers addressed to me, persist them, and call
 * onOffer for each new one. Idempotent per pubkey.
 * @param {object} identity { publicKey, privateKey, displayName? }
 * @param {(offer:object)=>void} onOffer
 * @returns {Promise<object|null>} the inbox engine
 */
export async function startInbox(identity, onOffer) {
  if (!identity || !identity.publicKey || !identity.privateKey) return null
  if (_inbox.has(identity.publicKey)) return _inbox.get(identity.publicKey)
  await e2eeManager.ensureReady()
  const { docId, swarmKey, e2eeKey } = await deriveInboxKeys(identity.publicKey)
  const engine = await openP2PDoc({ docId, swarmKey, e2eeKey })
  _inbox.set(identity.publicKey, engine)

  const offers = engine.doc.getArray('offers')
  const seen = new Set((await getReceivedOffers()).map((o) => o.id))
  let draining = false
  const drain = async () => {
    if (draining) return
    draining = true
    try {
      for (const blob of offers.toArray()) {
        if (!blob || !blob.id || seen.has(blob.id)) continue
        if (blob.to !== identity.publicKey) continue
        seen.add(blob.id)
        try {
          const oneTime = await e2eeManager.unwrapKeyForIdentity(blob.wk, identity.publicKey, identity.privateKey)
          const json = e2eeManager.decryptString(blob.ct, oneTime)
          if (!json) continue
          const offer = JSON.parse(json)
          offer.id = blob.id
          offer.receivedAt = _now()
          const isNew = await _addReceivedOffer(offer)
          if (isNew && onOffer) { try { onOffer(offer) } catch (_e) {} }
        } catch (_e) { /* not addressed to me / corrupt — ignore */ }
      }
    } finally { draining = false }
  }
  offers.observe(() => { drain() })
  engine.whenSynced().then(() => drain()).catch(() => {})
  drain()
  return engine
}

/** Tear down all inbox/outbox rooms (e.g. on full reset). */
export function stopAllInbox() {
  for (const e of _outbox.values()) { try { e.destroy() } catch (_e) {} }
  for (const e of _inbox.values()) { try { e.destroy() } catch (_e) {} }
  _outbox.clear(); _inbox.clear()
}
