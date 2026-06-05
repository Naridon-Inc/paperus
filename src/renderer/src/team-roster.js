/**
 * team-roster.js — the signed, append-only team membership roster (the security
 * core of the zero-account model).
 *
 * THE PROBLEM: with no server, anyone holding the team link can write to the
 * shared CRDT. So "who is alice?" cannot be answered by trusting a writable map.
 *
 * THE DESIGN:
 *   - `rosterClaims` is an append-only Y.Array of SIGNED claim ops. Appends are
 *     commutative and we never delete or overwrite, so the log itself can't be
 *     tampered with destructively — only added to.
 *   - Each op carries the claimant's Ed25519 `idPublicKey` and a detached
 *     signature over its own canonical bytes. `validateOp()` rejects any op whose
 *     signature doesn't verify against its OWN public key — so you cannot forge an
 *     op "from" a key you don't hold.
 *   - Membership is a DERIVED view recomputed locally from the log on every
 *     change (`reconcile()`), never trusted from the wire. Every honest peer
 *     computes the SAME winner from the SAME log, so they converge with no
 *     coordination. The canonical winner for a username = the valid `claim` op
 *     with the smallest `createdAt` (tiebreak: lexicographically smaller
 *     `idPublicKey`, which is clock-skew independent).
 *   - LOGIN re-derives the keypair from username+password and accepts ONLY if the
 *     derived public key equals the canonical winner's. Wrong password → different
 *     key → rejected, with no overwrite and no presence under that name.
 *
 * HONEST LIMITS (surface in UI/docs):
 *   - `createdAt` is self-asserted; a malicious peer can backdate a forged claim
 *     to SQUAT a username label (R3). It still cannot impersonate the real holder
 *     at login (that needs the password), and it grants no extra access — every
 *     member already has the link (R9). The roster governs DISPLAY identity, not
 *     access. The link is the front door; the password protects your identity.
 */
import { e2eeManager } from './e2ee'

const CLAIMS_ARRAY = 'rosterClaims'
const OP_VERSION = 1

/** Deterministic bytes a signature covers (fixed field order, '|' delimited). */
function canonicalString(op) {
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

function normUser(u) {
  return String(u || '').trim().toLowerCase()
}

export class RosterManager {
  /**
   * @param {DocumentEngine} rootEngine the team root doc engine
   * @param {string} teamId
   */
  constructor(rootEngine, teamId) {
    this.engine = rootEngine
    this.teamId = teamId
    this.doc = rootEngine.doc
    this.claims = this.doc.getArray(CLAIMS_ARRAY)
    this.members = new Map() // username -> { username, displayName, color, idPublicKey, createdAt }
    this._observer = () => { this.reconcile() }
    this.claims.observe(this._observer)
    this.reconcile()
  }

  destroy() {
    try { this.claims.unobserve(this._observer) } catch (_e) {}
    this.members.clear()
  }

  // ── Op validation + reconcile ──────────────────────────────────────────────

  /** True iff the op is well-formed AND its signature verifies against its own key. */
  async validateOp(op) {
    if (!op || typeof op !== 'object') return false
    if (op.v !== OP_VERSION) return false
    if (op.op !== 'claim' && op.op !== 'rev') return false
    if (!op.username || !op.idPublicKey || !op.sig) return false
    if (typeof op.createdAt !== 'number' || !isFinite(op.createdAt)) return false
    return e2eeManager.verifyDetached(op.sig, canonicalString(op), op.idPublicKey)
  }

  /**
   * Recompute the canonical membership view from the append-only log. Honest
   * peers all reach the same result. Emits `team:roster-updated` when the view
   * changes.
   */
  async reconcile() {
    const ops = this.claims.toArray()

    // Validate signatures (in parallel) once, keep only authentic ops.
    const valid = []
    await Promise.all(ops.map(async (op) => {
      if (await this.validateOp(op)) valid.push(op)
    }))

    // 1) Winner per username from `claim` ops: smallest createdAt, tiebreak by
    //    smaller idPublicKey.
    const winners = new Map() // username -> claim op
    for (const op of valid) {
      if (op.op !== 'claim') continue
      const u = normUser(op.username)
      const cur = winners.get(u)
      if (!cur) { winners.set(u, op); continue }
      if (op.createdAt < cur.createdAt ||
          (op.createdAt === cur.createdAt && op.idPublicKey < cur.idPublicKey)) {
        winners.set(u, op)
      }
    }

    // 2) Apply the latest `rev` (profile edit) signed by the canonical winner.
    const revs = new Map() // username -> latest rev op by the winner
    for (const op of valid) {
      if (op.op !== 'rev') continue
      const u = normUser(op.username)
      const winner = winners.get(u)
      if (!winner || op.idPublicKey !== winner.idPublicKey) continue // only the holder may edit
      const cur = revs.get(u)
      if (!cur || op.createdAt > cur.createdAt) revs.set(u, op)
    }

    const next = new Map()
    for (const [u, claim] of winners) {
      const rev = revs.get(u)
      next.set(u, {
        username: claim.username,
        displayName: (rev && rev.displayName) || claim.displayName || claim.username,
        color: (rev && rev.color) || claim.color || '',
        idPublicKey: claim.idPublicKey,
        createdAt: claim.createdAt,
      })
    }

    // Diff to avoid spurious events.
    const changed = next.size !== this.members.size ||
      [...next].some(([u, e]) => {
        const p = this.members.get(u)
        return !p || p.idPublicKey !== e.idPublicKey || p.displayName !== e.displayName || p.color !== e.color
      })

    this.members = next
    if (changed && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('team:roster-updated', {
        detail: { teamId: this.teamId, members: this.getMembers() },
      }))
    }
    return this.members
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Canonical entry for a username, or null. */
  winnerFor(username) {
    return this.members.get(normUser(username)) || null
  }

  /** All canonical members (sorted by claim time). */
  getMembers() {
    return [...this.members.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  isTaken(username) {
    return this.members.has(normUser(username))
  }

  // ── Mutations (signed) ───────────────────────────────────────────────────────

  async _append(op) {
    const sig = await e2eeManager.signDetached(canonicalString(op), this._privateKey)
    this.doc.transact(() => { this.claims.push([{ ...op, sig }]) }, 'roster')
    await this.reconcile()
  }

  /**
   * Claim a username for this identity, or no-op if this identity already owns
   * it. Returns { ok, reason }. `reason` ∈ 'claimed' | 'already-owner' |
   * 'taken' (a different key holds it).
   *
   * @param {object} args { username, displayName?, color?, identity:{publicKey,privateKey}, now? }
   */
  async claim({ username, displayName, color, identity, now }) {
    if (!username || !identity || !identity.publicKey || !identity.privateKey) {
      return { ok: false, reason: 'invalid' }
    }
    await this.reconcile()
    const existing = this.winnerFor(username)
    if (existing) {
      if (existing.idPublicKey === identity.publicKey) return { ok: true, reason: 'already-owner' }
      return { ok: false, reason: 'taken' }
    }
    this._privateKey = identity.privateKey
    const op = {
      v: OP_VERSION,
      op: 'claim',
      username: normUser(username),
      displayName: displayName || username,
      color: color || '',
      idPublicKey: identity.publicKey,
      createdAt: typeof now === 'number' ? now : Date.now(),
    }
    await this._append(op)
    return { ok: true, reason: 'claimed' }
  }

  /**
   * Verify a login: the supplied identity (re-derived from username+password)
   * must match the canonical winner's public key. Does NOT write anything.
   * Returns { ok, reason }. `reason` ∈ 'ok' | 'unclaimed' | 'wrong-key'.
   */
  async login({ username, identity }) {
    await this.reconcile()
    const existing = this.winnerFor(username)
    if (!existing) return { ok: false, reason: 'unclaimed' }
    if (!identity || existing.idPublicKey !== identity.publicKey) return { ok: false, reason: 'wrong-key' }
    return { ok: true, reason: 'ok' }
  }

  /**
   * Append a signed profile edit (displayName/color). Only the current holder's
   * key is honored at reconcile time. Returns { ok, reason }.
   */
  async updateProfile({ username, displayName, color, identity, now }) {
    if (!identity || !identity.publicKey || !identity.privateKey) return { ok: false, reason: 'invalid' }
    const existing = this.winnerFor(username)
    if (!existing) return { ok: false, reason: 'unclaimed' }
    if (existing.idPublicKey !== identity.publicKey) return { ok: false, reason: 'not-owner' }
    this._privateKey = identity.privateKey
    const op = {
      v: OP_VERSION,
      op: 'rev',
      username: normUser(username),
      displayName: displayName || existing.displayName,
      color: color || existing.color,
      idPublicKey: identity.publicKey,
      createdAt: typeof now === 'number' ? now : Date.now(),
    }
    await this._append(op)
    return { ok: true, reason: 'updated' }
  }
}
