/**
 * device-link.js — the SHARED device-linking (mobile companion pairing) protocol.
 *
 * This is the authoritative, transport-agnostic logic for pairing a desktop
 * "parent" with a mobile "companion" leaf peer, per docs/MOBILE_COMPANION.md.
 * It is PURE LOGIC: no DOM, no `window`, no side effects — so it can be unit
 * tested under plain Node, exactly like team-keys.js. (It only touches the
 * global `crypto.getRandomValues` for id generation, guarded for absence, and
 * delegates ALL crypto/key derivation to team-keys.js / e2ee.js — it never
 * reimplements a hash, a key, or a signature.)
 *
 * ── The model (see §2 of MOBILE_COMPANION.md) ──────────────────────────────
 * Pairing moves exactly ONE secret — the team's `teamRootKey` — from desktop to
 * phone, wrapped with a fresh `deviceId` and an `expiresAt`. From that single
 * secret the companion re-derives EVERYTHING (`deriveTeamKeys` / `deriveNoteKeys`)
 * and re-derives its OWN identity locally from a password the human types on the
 * phone (`deriveIdentity` → self-signed roster claim). The pairing payload
 * therefore carries NO private identity key and NO per-note keys — those are
 * derivable and would only enlarge the secret surface.
 *
 *   PairingPayload v1 (parent → companion):
 *     { v, teamRootKey, teamId?, teamName?, deviceId, deviceName?,
 *       suggestedUsername?, parentUsername?, expiresAt }
 *   Only `teamRootKey` is secret. `deviceId` tags this phone; `expiresAt`
 *   time-gates a leaked link. Everything else is a non-secret UX hint that the
 *   companion re-derives + verifies (`verifyPairingPayload`).
 *
 * ── Transport forms ───────────────────────────────────────────────────────
 *   Primary (copy/paste):   notionless-pair:v1.<base64url(JSON(payload))>
 *   Deep-link variant:      notionless://pair#v1.<base64url(JSON(payload))>
 *   Degrades gracefully:    notionless-team:<teamRootKey>  (no deviceId/expiry)
 *   Short numeric code:     a digit-only rendering of the SAME base64url payload,
 *                           grouped for read-aloud (build/parse below). Reversible
 *                           and lossless; just an alternate channel for the link.
 *
 * ── Total-failure safety ──────────────────────────────────────────────────
 * Every PARSE function returns `null` on anything malformed and NEVER throws.
 * BUILD/serialize functions validate their inputs and throw only on programmer
 * error (e.g. a missing `teamRootKey`), never on attacker-controlled text.
 */
import { e2eeManager } from './e2ee'
import { deriveTeamId, deriveTeamKeys, deriveIdentity } from './team-keys'

// ── Constants ───────────────────────────────────────────────────────────────

/** Pairing payload schema version. Bump only on a breaking shape change. */
export const PAIR_VERSION = 1

/** Copy/paste prefix, sibling to p2p.js SHARE_PREFIX / TEAM_PREFIX. */
export const PAIR_PREFIX = 'notionless-pair:'

/** Deep-link form recognized by a native (Capacitor) scheme handler. */
export const PAIR_DEEPLINK_PREFIX = 'notionless://pair'

/** Bare team-code prefix accepted as a graceful-degrade pairing source. */
export const TEAM_PREFIX = 'notionless-team:'

/** Default pairing-link lifetime: 72 hours (ms). A leaked link is useless after. */
export const DEFAULT_PAIR_TTL_MS = 72 * 60 * 60 * 1000

/** Roster-claim op tag used for an (optional) device-authorization note. */
const DEVICE_OP_VERSION = 1

// base64url alphabet, indexed → used by the numeric-code codec (2 decimal digits
// per char, value 00..63). It is a stable, total ordering; do not reorder.
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

// ── Small, dependency-free helpers (no DOM, no throw on parse) ────────────────

/** Cross-env CSPRNG fill; falls back to Math.random only if no crypto exists. */
function _randomBytes(n) {
  const buf = new Uint8Array(n)
  const g =
    (typeof globalThis !== 'undefined' && globalThis.crypto) ||
    (typeof crypto !== 'undefined' ? crypto : null)
  if (g && typeof g.getRandomValues === 'function') {
    g.getRandomValues(buf)
  } else {
    for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  return buf
}

/** Bytes → base64url (no padding), cross-env (browser btoa or Node Buffer). */
function _bytesToB64url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  let b64
  if (typeof btoa === 'function') {
    b64 = btoa(bin)
  } else if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(bytes).toString('base64')
  } else {
    return null
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url (no padding) → bytes, or null if it is not valid base64. */
function _b64urlToBytes(s) {
  if (typeof s !== 'string' || !s) return null
  // Reject anything outside the URL-safe alphabet up front (stay total).
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  try {
    if (typeof atob === 'function') {
      const bin = atob(b64)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(b64, 'base64'))
    }
  } catch (_e) { /* fall through */ }
  return null
}

/** UTF-8 string → base64url, or null. */
function _strToB64url(str) {
  try {
    let bytes
    if (typeof TextEncoder !== 'undefined') {
      bytes = new TextEncoder().encode(str)
    } else if (typeof Buffer !== 'undefined') {
      bytes = new Uint8Array(Buffer.from(str, 'utf-8'))
    } else {
      return null
    }
    return _bytesToB64url(bytes)
  } catch (_e) { return null }
}

/** base64url → UTF-8 string, or null. */
function _b64urlToStr(s) {
  const bytes = _b64urlToBytes(s)
  if (!bytes) return null
  try {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes)
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf-8')
  } catch (_e) { /* fall through */ }
  return null
}

/** Generate a short, opaque device id, e.g. "dev_9f2a4c…" (12 hex chars). */
export function generateDeviceId() {
  const bytes = _randomBytes(6)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return `dev_${hex}`
}

// ── 1. Build the pairing payload (parent / desktop side) ─────────────────────

/**
 * Build a PairingPayload object from team key material + a (generated) device id.
 * The ONLY secret it carries is `teamRootKey`; the rest are non-secret hints.
 * The companion re-derives `teamId` and verifies it (`verifyPairingPayload`).
 *
 * Throws only on programmer error (missing `teamRootKey`) — it never consumes
 * attacker-controlled text, so there is nothing to fail safely on here.
 *
 * @param {object} args
 * @param {string}  args.teamRootKey       the team's sole secret (18B base64url).
 * @param {string} [args.teamId]           convenience; defaults to deriveTeamId().
 * @param {string} [args.teamName]         non-secret display hint.
 * @param {string} [args.deviceId]         tag for THIS phone; minted if omitted.
 * @param {string} [args.deviceName]       non-secret device label.
 * @param {string} [args.suggestedUsername] pre-fill hint for the claim screen.
 * @param {string} [args.parentUsername]   who paired it (display only).
 * @param {number} [args.ttlMs]            link lifetime; default 72h.
 * @param {number} [args.now]              injectable clock (ms) for tests.
 * @returns {Promise<object>} a frozen PairingPayload v1.
 */
export async function buildPairingPayload({
  teamRootKey,
  teamId,
  teamName,
  deviceId,
  deviceName,
  suggestedUsername,
  parentUsername,
  ttlMs = DEFAULT_PAIR_TTL_MS,
  now,
} = {}) {
  if (!teamRootKey || typeof teamRootKey !== 'string') {
    throw new Error('buildPairingPayload: teamRootKey is required')
  }
  const resolvedTeamId = teamId || (await deriveTeamId(teamRootKey))
  const base = typeof now === 'number' ? now : Date.now()
  const ttl = typeof ttlMs === 'number' && isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_PAIR_TTL_MS

  const payload = {
    v: PAIR_VERSION,
    teamRootKey: String(teamRootKey),
    teamId: resolvedTeamId,
    deviceId: deviceId || generateDeviceId(),
    expiresAt: base + ttl,
  }
  // Optional non-secret hints — included only when provided so the payload (and
  // thus the link/code) stays as small as possible.
  if (teamName) payload.teamName = String(teamName)
  if (deviceName) payload.deviceName = String(deviceName)
  if (suggestedUsername) payload.suggestedUsername = String(suggestedUsername)
  if (parentUsername) payload.parentUsername = String(parentUsername)

  return payload
}

// ── 2. Serialize / parse: copyable link form ────────────────────────────────

/**
 * Serialize a PairingPayload to the copyable link form
 *   "notionless-pair:v1.<base64url(JSON(payload))>"
 * or, when `deepLink` is true, the
 *   "notionless://pair#v1.<base64url(JSON(payload))>"
 * variant. Throws only if the payload can't be JSON-encoded (programmer error).
 *
 * @param {object} payload  a PairingPayload (typically from buildPairingPayload).
 * @param {object} [opts]
 * @param {boolean} [opts.deepLink=false] emit the notionless:// deep-link form.
 * @returns {string}
 */
export function serializePairingLink(payload, { deepLink = false } = {}) {
  if (!payload || typeof payload !== 'object' || !payload.teamRootKey) {
    throw new Error('serializePairingLink: invalid payload')
  }
  const version = payload.v || PAIR_VERSION
  const json = JSON.stringify(payload)
  const b64 = _strToB64url(json)
  if (b64 == null) throw new Error('serializePairingLink: encoding unavailable')
  const body = `v${version}.${b64}`
  return deepLink ? `${PAIR_DEEPLINK_PREFIX}#${body}` : `${PAIR_PREFIX}${body}`
}

/**
 * Parse ANY pasted pairing string into a PairingPayload, or `null`.
 * NEVER throws. Accepts, in order of preference:
 *   1. "notionless-pair:v1.<b64url>"           (full payload)
 *   2. "notionless://pair#v1.<b64url>"          (deep-link variant)
 *   3. a URL/string containing "#pair=" / "?pair=" carrying "v1.<b64url>"
 *   4. a bare "v1.<b64url>" body
 *   5. "notionless-team:<key>" / "#team=" / "?team="  (graceful degrade →
 *      synthesized minimal payload: just teamRootKey, no deviceId/expiry)
 *   6. a numeric short-code (delegates to parseNumericCode)
 *
 * The returned object is a best-effort PairingPayload; callers MUST still run
 * `verifyPairingPayload` (teamId re-derive + expiry check) before trusting it.
 *
 * @param {string} input
 * @returns {object|null}
 */
export function parsePairingLink(input) {
  if (input == null) return null
  const raw = String(input).trim()
  if (!raw) return null

  // Pull out a "vN.<b64url>" body from the various carriers, if present.
  let body = null
  if (raw.startsWith(PAIR_PREFIX)) {
    body = raw.slice(PAIR_PREFIX.length).trim()
  } else if (raw.startsWith(PAIR_DEEPLINK_PREFIX)) {
    const hash = raw.indexOf('#')
    if (hash >= 0) body = raw.slice(hash + 1).trim()
  } else {
    const m = raw.match(/[#?&]pair=([^#?&\s]+)/)
    if (m) {
      try { body = decodeURIComponent(m[1]) } catch (_e) { body = m[1] }
    } else if (/^v\d+\.[A-Za-z0-9_-]+$/.test(raw)) {
      body = raw
    }
  }

  if (body) {
    const dot = body.indexOf('.')
    if (dot > 0) {
      const tag = body.slice(0, dot)
      const b64 = body.slice(dot + 1)
      const vMatch = /^v(\d+)$/.exec(tag)
      if (vMatch) {
        const json = _b64urlToStr(b64)
        const obj = _safeJson(json)
        const norm = _normalizePayload(obj)
        if (norm) return norm
      }
    }
    return null
  }

  // Graceful degrade: a plain team code/link → minimal payload.
  const teamKey = _parseTeamKey(raw)
  if (teamKey) {
    return _normalizePayload({ v: PAIR_VERSION, teamRootKey: teamKey })
  }

  // Last: maybe it's a numeric short-code.
  return parseNumericCode(raw)
}

/** Convenience: build a payload and immediately serialize it to a link. */
export async function buildPairingLink(args = {}, opts = {}) {
  const payload = await buildPairingPayload(args)
  return serializePairingLink(payload, opts)
}

// ── 3. Serialize / parse: short numeric code form ────────────────────────────

/**
 * Render a PairingPayload (or an already-serialized link) as a DIGIT-ONLY code,
 * grouped for read-aloud (e.g. "041553 …"). It is a lossless, reversible
 * encoding of the SAME base64url payload body: each base64url char maps to a
 * fixed two-digit index (00..63), so the code is just an alternate transport.
 *
 * NOTE: this is a transport rendering, NOT a "6-digit PIN" — the team secret
 * cannot fit in a handful of digits, and the doc forbids shrinking the secret.
 * Use it for read-aloud/manual entry where a paste channel isn't available.
 *
 * @param {object|string} payloadOrBody PairingPayload object OR a "vN.<b64url>"
 *                                       body OR a full "notionless-pair:" link.
 * @param {object} [opts]
 * @param {number} [opts.group=4] insert a space every N digits (0 = no grouping).
 * @returns {string}
 */
export function serializeNumericCode(payloadOrBody, { group = 4 } = {}) {
  let body
  if (typeof payloadOrBody === 'string') {
    body = _extractBody(payloadOrBody)
    if (!body) throw new Error('serializeNumericCode: unrecognized link/body')
  } else if (payloadOrBody && typeof payloadOrBody === 'object') {
    body = serializePairingLink(payloadOrBody).slice(PAIR_PREFIX.length)
  } else {
    throw new Error('serializeNumericCode: invalid input')
  }
  let digits = ''
  for (let i = 0; i < body.length; i++) {
    const idx = _bodyCharToIndex(body[i])
    if (idx < 0) throw new Error('serializeNumericCode: non-encodable char in body')
    digits += String(idx).padStart(2, '0')
  }
  if (!group || group < 1) return digits
  return digits.replace(new RegExp(`(.{${group}})`, 'g'), '$1 ').trim()
}

/**
 * Parse a numeric short-code (any spacing/grouping) back into a PairingPayload,
 * or `null`. NEVER throws. Inverse of `serializeNumericCode`.
 *
 * @param {string} input
 * @returns {object|null}
 */
export function parseNumericCode(input) {
  if (input == null) return null
  const digits = String(input).replace(/\D/g, '')
  if (!digits || digits.length % 2 !== 0) return null
  let body = ''
  for (let i = 0; i < digits.length; i += 2) {
    const n = parseInt(digits.slice(i, i + 2), 10)
    const ch = _indexToBodyChar(n)
    if (ch == null) return null
    body += ch
  }
  // `body` is a "vN.<b64url>"; reuse the link parser for the heavy lifting.
  return parsePairingLink(`${PAIR_PREFIX}${body}`)
}

// ── 4. Verify + derive the companion's joinable material ─────────────────────

/**
 * Validate a parsed PairingPayload WITHOUT side effects: re-derive `teamId` from
 * the carried `teamRootKey` and confirm it matches the hint (if any), and check
 * `expiresAt`. NEVER throws — returns a result object.
 *
 * @param {object} payload   from parsePairingLink.
 * @param {object} [opts]
 * @param {number} [opts.now] injectable clock (ms) for tests.
 * @returns {Promise<{ok:boolean, reason:string, teamId?:string}>}
 *   reason ∈ 'ok' | 'invalid' | 'expired' | 'team-id-mismatch'
 */
export async function verifyPairingPayload(payload, { now } = {}) {
  if (!payload || typeof payload !== 'object' || !payload.teamRootKey) {
    return { ok: false, reason: 'invalid' }
  }
  const at = typeof now === 'number' ? now : Date.now()
  if (typeof payload.expiresAt === 'number' && isFinite(payload.expiresAt) && at > payload.expiresAt) {
    return { ok: false, reason: 'expired' }
  }
  let teamId
  try {
    teamId = await deriveTeamId(payload.teamRootKey)
  } catch (_e) {
    return { ok: false, reason: 'invalid' }
  }
  if (payload.teamId && payload.teamId !== teamId) {
    return { ok: false, reason: 'team-id-mismatch' }
  }
  return { ok: true, reason: 'ok', teamId }
}

/**
 * Derive everything the companion needs to JOIN the team swarm and decrypt team
 * content, from a parsed payload — i.e. the team root doc's join material. This
 * delegates entirely to team-keys.js (`deriveTeamKeys`); it adds NO new crypto.
 * Returns `null` if the payload is unusable (NEVER throws).
 *
 * Per-note keys are intentionally NOT returned here: the companion derives those
 * lazily per-note via `deriveNoteKeys(teamRootKey, noteId)` when a tab opens.
 *
 * @param {object} payload  from parsePairingLink (after verifyPairingPayload).
 * @returns {Promise<{teamRootKey,teamId,teamDocId,swarmKey,e2eeKey,deviceId?,deviceName?,teamName?,suggestedUsername?}|null>}
 */
export async function deriveCompanionTeamMaterial(payload) {
  if (!payload || typeof payload !== 'object' || !payload.teamRootKey) return null
  try {
    const keys = await deriveTeamKeys(payload.teamRootKey)
    return {
      ...keys, // { teamRootKey, teamId, teamDocId, swarmKey, e2eeKey }
      deviceId: payload.deviceId || null,
      deviceName: payload.deviceName || null,
      teamName: payload.teamName || null,
      suggestedUsername: payload.suggestedUsername || null,
    }
  } catch (_e) {
    return null
  }
}

/**
 * Derive the companion's OWN deterministic Ed25519 identity from the password the
 * human types on the phone (plus the team scope from the payload). This is the
 * key the companion SELF-SIGNS its roster claim/login with — the parent cannot
 * sign on its behalf (the roster's validateOp checks each op against its own
 * idPublicKey). Pure delegation to team-keys.deriveIdentity. NEVER throws —
 * returns null on bad input.
 *
 * @param {object} payload   parsed payload (provides teamRootKey/teamId scope).
 * @param {object} creds     { username, password, joinSecret? }
 * @returns {Promise<{publicKey:string, privateKey:string, teamId:string, username:string}|null>}
 */
export async function deriveCompanionIdentity(payload, { username, password, joinSecret = '' } = {}) {
  if (!payload || typeof payload !== 'object' || !payload.teamRootKey) return null
  if (!username || typeof password !== 'string' || password.length === 0) return null
  try {
    const teamId = payload.teamId || (await deriveTeamId(payload.teamRootKey))
    const id = await deriveIdentity(teamId, username, password, joinSecret)
    return { ...id, teamId, username: String(username).trim().toLowerCase() }
  } catch (_e) {
    return null
  }
}

// ── 5. Companion's self-signed device-authorization claim ────────────────────

/**
 * Build the canonical bytes + op skeleton the COMPANION self-signs as its roster
 * "device-authorization" claim. Per MOBILE_COMPANION.md §2.4 and invariant R3,
 * device tagging rides in `displayName` (the `(deviceName)` suffix) — we add NO
 * new signed roster field, so `canonicalString` here MUST byte-match
 * team-roster.js exactly: [v|op|username|displayName|color|idPublicKey|createdAt].
 *
 * This returns the unsigned op plus the exact string to sign; the caller signs
 * with the COMPANION's own private key (e2eeManager.signDetached) and appends the
 * result to the roster — there is no "parent-signed claim for the companion".
 * NEVER throws — returns null on bad input.
 *
 * @param {object} args
 * @param {string}  args.username        the companion's (possibly device-specific) username.
 * @param {object}  args.identity        { publicKey } of the companion's own key.
 * @param {string} [args.deviceName]     appended to displayName as the device marker.
 * @param {string} [args.displayName]    explicit displayName (overrides the suffix builder).
 * @param {string} [args.color]
 * @param {number} [args.now]            createdAt (ms); defaults to Date.now().
 * @returns {{ op: object, canonical: string }|null}
 */
export function buildDeviceClaimData({
  username,
  identity,
  deviceName,
  displayName,
  color = '',
  now,
} = {}) {
  if (!username || !identity || !identity.publicKey) return null
  const user = String(username).trim().toLowerCase()
  const display = displayName ||
    (deviceName ? `${username} (${deviceName})` : String(username))
  const op = {
    v: DEVICE_OP_VERSION,
    op: 'claim',
    username: user,
    displayName: display,
    color: color || '',
    idPublicKey: identity.publicKey,
    createdAt: typeof now === 'number' ? now : Date.now(),
  }
  return { op, canonical: _canonicalClaimString(op) }
}

/**
 * Produce a fully-signed device-authorization claim op, ready to push onto the
 * roster's `rosterClaims` array. Signs the canonical bytes with the COMPANION's
 * OWN private key via e2eeManager.signDetached. NEVER throws — returns null on
 * bad input or a signing failure.
 *
 * @param {object} args  same as buildDeviceClaimData PLUS
 *                       identity.privateKey (required to sign).
 * @returns {Promise<object|null>} the signed op `{ ...op, sig }`.
 */
export async function signDeviceClaim(args = {}) {
  const built = buildDeviceClaimData(args)
  if (!built) return null
  const priv = args.identity && args.identity.privateKey
  if (!priv) return null
  try {
    const sig = await e2eeManager.signDetached(built.canonical, priv)
    return { ...built.op, sig }
  } catch (_e) {
    return null
  }
}

// ── Internal: payload normalization, JSON, team-key + body parsing ───────────

/** JSON.parse that never throws — returns null on any failure. */
function _safeJson(str) {
  if (typeof str !== 'string' || !str) return null
  try {
    const v = JSON.parse(str)
    return v && typeof v === 'object' ? v : null
  } catch (_e) { return null }
}

/**
 * Coerce a candidate object into a well-typed PairingPayload, or null. Drops
 * unknown fields, enforces the secret + version, and normalizes types so the
 * rest of the module can trust the shape without re-checking.
 */
function _normalizePayload(obj) {
  if (!obj || typeof obj !== 'object') return null
  if (!obj.teamRootKey || typeof obj.teamRootKey !== 'string') return null
  const out = {
    v: typeof obj.v === 'number' ? obj.v : PAIR_VERSION,
    teamRootKey: obj.teamRootKey,
  }
  if (typeof obj.teamId === 'string') out.teamId = obj.teamId
  if (typeof obj.teamName === 'string') out.teamName = obj.teamName
  if (typeof obj.deviceId === 'string') out.deviceId = obj.deviceId
  if (typeof obj.deviceName === 'string') out.deviceName = obj.deviceName
  if (typeof obj.suggestedUsername === 'string') out.suggestedUsername = obj.suggestedUsername
  if (typeof obj.parentUsername === 'string') out.parentUsername = obj.parentUsername
  if (typeof obj.expiresAt === 'number' && isFinite(obj.expiresAt)) out.expiresAt = obj.expiresAt
  return out
}

/** Extract a bare team root key from a team code/link, or null. */
function _parseTeamKey(raw) {
  if (raw.startsWith(TEAM_PREFIX)) {
    const key = raw.slice(TEAM_PREFIX.length).trim()
    return key || null
  }
  const m = raw.match(/[#?&]team=([^#?&\s]+)/)
  if (m) {
    try { return decodeURIComponent(m[1]) || null } catch (_e) { return m[1] || null }
  }
  return null
}

/** Pull a "vN.<b64url>" body out of any pairing link form, or null. */
function _extractBody(raw) {
  const s = String(raw).trim()
  if (s.startsWith(PAIR_PREFIX)) {
    const b = s.slice(PAIR_PREFIX.length).trim()
    return /^v\d+\.[A-Za-z0-9_-]+$/.test(b) ? b : null
  }
  if (s.startsWith(PAIR_DEEPLINK_PREFIX)) {
    const hash = s.indexOf('#')
    if (hash >= 0) {
      const b = s.slice(hash + 1).trim()
      return /^v\d+\.[A-Za-z0-9_-]+$/.test(b) ? b : null
    }
  }
  return /^v\d+\.[A-Za-z0-9_-]+$/.test(s) ? s : null
}

// Body chars are: digits 0-9 for the version, '.' separator, and base64url
// chars for the payload. The numeric codec maps each to a fixed index 00..63
// (base64url) or 62/63-adjacent slots. To keep a single clean alphabet we encode
// the WHOLE body against an extended table: base64url (0..63) + '.' (no collision
// because '.' is not in the base64url alphabet). Version digits are themselves
// base64url chars ('0'..'9' live in the alphabet), so only '.' needs a slot.
const _DOT_INDEX = 64 // reserved slot for '.' (two digits "64")

function _bodyCharToIndex(ch) {
  if (ch === '.') return _DOT_INDEX
  const i = B64URL_ALPHABET.indexOf(ch)
  return i // -1 if not found
}

function _indexToBodyChar(n) {
  if (n === _DOT_INDEX) return '.'
  if (n >= 0 && n < B64URL_ALPHABET.length) return B64URL_ALPHABET[n]
  return null
}

/**
 * Byte-identical to team-roster.js canonicalString(). Duplicated (not imported)
 * on purpose: this module must stay free of any Y.Doc/engine dependency so it
 * remains Node-importable, and the canonical order is a stable wire contract. If
 * team-roster.js ever changes its field order, BOTH must change together.
 */
function _canonicalClaimString(op) {
  return [
    op.v,
    op.op,
    String(op.username || '').trim().toLowerCase(),
    op.displayName || '',
    op.color || '',
    op.idPublicKey || '',
    op.createdAt || 0,
  ].join('|')
}
