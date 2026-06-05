/**
 * team-keys.js — the single source of truth for every key/id derivation in the
 * zero-account P2P model. All domain-separation labels live here so the scheme
 * can be audited in one place. Crypto primitives come from e2ee.js (libsodium).
 *
 * One secret rules a team: `teamRootKey` (an 18-byte base64url string, the thing
 * inside a `notionless-team:` link). Everything else is derived from it with a
 * labelled BLAKE2b hash, so the link is the team's entire access boundary:
 *
 *   teamId       = H("notionless:team:id"    ‖ teamRootKey)        [16B → hex]
 *   teamDocId    = "team-" + teamId
 *   teamSwarmKey = H("notionless:team:swarm" ‖ teamRootKey)        [32B → hex]   (y-webrtc topic seed + password)
 *   teamE2EEKey  = H("notionless:team:e2ee"  ‖ teamRootKey)        [32B → base64](setupE2EE symmetric key)
 *   noteSwarmKey = H("notionless:note:swarm" ‖ teamRootKey ‖ noteId)
 *   noteE2EEKey  = H("notionless:note:e2ee"  ‖ teamRootKey ‖ noteId)
 *
 * Identity (anti-impersonation, NOT access control — see R5):
 *   idSalt    = H("notionless:id:salt" ‖ teamId ‖ username ‖ joinSecret)  [16B]
 *   idKeyPair = Argon2id-MODERATE(password, idSalt) → Ed25519 seed → keypair
 *
 * The `teamId` in the id-salt means the SAME username+password derives a
 * DIFFERENT key in every team (independent rosters), while still re-deriving the
 * SAME key for that team on any device (no salt is ever stored).
 */
import { e2eeManager } from './e2ee'

// crypto_pwhash_SALTBYTES — libsodium's Argon2id salt length.
const SALT_BYTES = 16
// crypto_secretbox_KEYBYTES — symmetric AEAD key length.
const KEY_BYTES = 32

export const LABELS = {
  TEAM_ID: 'notionless:team:id',
  TEAM_SWARM: 'notionless:team:swarm',
  TEAM_E2EE: 'notionless:team:e2ee',
  NOTE_SWARM: 'notionless:note:swarm',
  NOTE_E2EE: 'notionless:note:e2ee',
  ID_SALT: 'notionless:id:salt',
  INBOX_ID: 'notionless:inbox:id',
  INBOX_SWARM: 'notionless:inbox:swarm',
  INBOX_E2EE: 'notionless:inbox:e2ee',
}

/** Stable short team id (hex) from the root key. */
export async function deriveTeamId(teamRootKey) {
  const h = await e2eeManager.hashConcat(16, LABELS.TEAM_ID, teamRootKey)
  return e2eeManager.toHex(h)
}

/** y-webrtc swarm key (topic seed + password) for the team root doc. Hex string. */
export async function deriveTeamSwarmKey(teamRootKey) {
  const h = await e2eeManager.hashConcat(KEY_BYTES, LABELS.TEAM_SWARM, teamRootKey)
  return e2eeManager.toHex(h)
}

/** setupE2EE symmetric key for the team root doc. base64 (crypto_secretbox key). */
export async function deriveTeamE2EEKey(teamRootKey) {
  const h = await e2eeManager.hashConcat(KEY_BYTES, LABELS.TEAM_E2EE, teamRootKey)
  return e2eeManager.toBase64(h)
}

/** Per-note swarm key. Hex string. */
export async function deriveNoteSwarmKey(teamRootKey, noteId) {
  const h = await e2eeManager.hashConcat(KEY_BYTES, LABELS.NOTE_SWARM, teamRootKey, String(noteId))
  return e2eeManager.toHex(h)
}

/** Per-note setupE2EE key. base64. */
export async function deriveNoteE2EEKey(teamRootKey, noteId) {
  const h = await e2eeManager.hashConcat(KEY_BYTES, LABELS.NOTE_E2EE, teamRootKey, String(noteId))
  return e2eeManager.toBase64(h)
}

/**
 * Resolve every key a member needs from just the team link secret. `teamDocId`
 * is the Y.Doc guid of the root doc; `swarmKey`/`e2eeKey` feed `openP2PDoc`.
 */
export async function deriveTeamKeys(teamRootKey) {
  const [teamId, swarmKey, e2eeKey] = await Promise.all([
    deriveTeamId(teamRootKey),
    deriveTeamSwarmKey(teamRootKey),
    deriveTeamE2EEKey(teamRootKey),
  ])
  return { teamRootKey, teamId, teamDocId: `team-${teamId}`, swarmKey, e2eeKey }
}

/** Per-note keys for the lazily-opened note doc. `docId` is the note's own guid. */
export async function deriveNoteKeys(teamRootKey, noteId) {
  const [swarmKey, e2eeKey] = await Promise.all([
    deriveNoteSwarmKey(teamRootKey, noteId),
    deriveNoteE2EEKey(teamRootKey, noteId),
  ])
  return { docId: String(noteId), swarmKey, e2eeKey }
}

/**
 * Per-identity INBOX address, derived from the recipient's PUBLIC key. Any
 * contact who knows your public key can derive this and drop a sealed note-offer
 * into your inbox doc — that's the whole point (cross-team direct sharing, no
 * link needed).
 *
 * Security note: unlike team/note keys (derived from a *secret* root key), this
 * is derived from a *public* value, so the swarm topic and the transport key are
 * NOT secret — anyone who knows your pubkey can join the room and read raw
 * blobs. Confidentiality of an offer therefore comes entirely from sealing it to
 * the recipient (`e2ee.wrapKeyForIdentity`), never from this key. The transport
 * key just lets us reuse the standard `openP2PDoc` encrypted path unchanged.
 *
 * @param {string} idPublicKey base64 Ed25519 public key of the inbox owner
 * @returns {Promise<{docId:string, swarmKey:string, e2eeKey:string}>}
 */
export async function deriveInboxKeys(idPublicKey) {
  const pub = String(idPublicKey)
  const [idH, swarm, e2ee] = await Promise.all([
    e2eeManager.hashConcat(16, LABELS.INBOX_ID, pub),
    e2eeManager.hashConcat(KEY_BYTES, LABELS.INBOX_SWARM, pub),
    e2eeManager.hashConcat(KEY_BYTES, LABELS.INBOX_E2EE, pub),
  ])
  return {
    docId: `inbox-${e2eeManager.toHex(idH)}`,
    swarmKey: e2eeManager.toHex(swarm),
    e2eeKey: e2eeManager.toBase64(e2ee),
  }
}

/**
 * Deterministically derive a member's Ed25519 identity keypair for a team.
 * Same (teamId, username, password[, joinSecret]) → same keypair anywhere; the
 * teamId domain-separates rosters between teams.
 *
 * @param {string} teamId      from deriveTeamId
 * @param {string} username
 * @param {string} password
 * @param {string} [joinSecret] optional high-entropy value mixed into the salt
 *                              to raise the offline-guessing bar (R5). Must be
 *                              the same for all members of a team if used.
 * @returns {Promise<{publicKey:string, privateKey:string}>}
 */
export async function deriveIdentity(teamId, username, password, joinSecret = '') {
  const salt = await e2eeManager.hashConcat(
    SALT_BYTES,
    LABELS.ID_SALT,
    String(teamId),
    String(username).trim().toLowerCase(),
    String(joinSecret || ''),
  )
  return e2eeManager.deriveIdentityKeyPair(salt, password, { moderate: true })
}
