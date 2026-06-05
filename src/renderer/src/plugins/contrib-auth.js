/**
 * contrib-auth.js — Auth adapter (FROZEN CONTRACT v1, §5.4 / §8.7).
 *
 * Bridges `ctx.auth.registerLoginMethod(...)` into the `loginMethods` registry
 * that `openClaimDialog` renders. Enforces the NORMATIVE invariant: a login
 * method is an *alternate unlock of the SAME key*, never an alternate identity
 * proof.
 *
 * The plugin's `authenticate(...)` may return ONLY:
 *   (a) { password }                         → host runs UNCHANGED deriveIdentity
 *   (b) { publicKey, privateKey }            → key-at-rest restore (NO derivation)
 *
 * In case (b) the host VERIFIES the returned publicKey equals the roster's
 * canonical winner for that username BEFORE accepting; mismatch ⇒ rejected.
 * The plugin never touches team-roster op formats. Secrets are transient.
 *
 * This adapter does NOT itself perform deriveIdentity / roster.login — that tail
 * is the host's (`hostHooks.auth.registerLoginMethod` wires the method into the
 * claim dialog, which already owns the unchanged post-unlock tail). This adapter
 * is responsible for: capability gating, normalizing the method, validating the
 * `authenticate` result shape, and enforcing the key invariant via the host's
 * roster-winner lookup before the host accepts.
 */

import * as Caps from './capabilities.js'

const C = Caps.CAPABILITIES || {}
const CAP_AUTH = C.AUTH || 'auth'

function hasCap(manifest, cap) {
  try {
    if (typeof Caps.requireCapability === 'function') {
      try { Caps.requireCapability(manifest, cap); return true } catch { return false }
    }
    const list = (manifest && Array.isArray(manifest.capabilities)) ? manifest.capabilities : []
    return list.includes(cap)
  } catch { return false }
}

/**
 * Validate & normalize the result of a plugin `authenticate(...)`. Returns one
 * of the two allowed shapes, or throws a typed error the host surfaces.
 * @param {any} result
 * @returns {{ kind:'password', password:string } | { kind:'keypair', publicKey:string, privateKey:string }}
 */
export function normalizeAuthResult(result) {
  if (!result || typeof result !== 'object') {
    throw authError('BAD_PARAMS', 'Login method returned no credentials.')
  }
  const hasPassword = typeof result.password === 'string' && result.password.length > 0
  const hasKeypair = typeof result.publicKey === 'string' && typeof result.privateKey === 'string'
    && result.publicKey.length > 0 && result.privateKey.length > 0

  if (hasPassword && hasKeypair) {
    // Ambiguous → prefer the explicit credential-source path, but reject to be
    // strict: a method must return exactly ONE shape.
    throw authError('BAD_PARAMS', 'Login method returned both a password and a keypair; return exactly one.')
  }
  if (hasPassword) {
    return { kind: 'password', password: result.password }
  }
  if (hasKeypair) {
    return { kind: 'keypair', publicKey: result.publicKey, privateKey: result.privateKey }
  }
  throw authError('BAD_PARAMS', 'Login method must return { password } or { publicKey, privateKey }.')
}

function authError(code, message) {
  const e = new Error(message)
  e.code = code
  return e
}

/**
 * Initialize the auth adapter.
 * @param {object} hostHooks the §6 host hooks bag (expects hostHooks.auth.*).
 * @returns {object} adapter API
 */
export function initAuthAdapter(hostHooks = {}) {
  const registered = new Map() // id → { manifest }

  return {
    /**
     * ctx.auth.registerLoginMethod — capability `auth`. Wires a method into the
     * claim/login dialog's `loginMethods` registry.
     *
     * @param {object} manifest plugin manifest (for capability + id namespacing)
     * @param {object} method   { id, label, isAvailable?, render?, authenticate }
     * @param {object} bridge   host-mediated callback bridge:
     *        bridge.authenticate(ctxArg) → Promise<rawResult>
     *        bridge.isAvailable(teamId)  → Promise<boolean>
     *        bridge.render(mountToken)   → vDOM/HTML (optional)
     * @returns {{dispose():void}}
     */
    registerLoginMethod(manifest, method, bridge) {
      if (!hasCap(manifest, CAP_AUTH)) return denied('registerLoginMethod')
      if (!method || typeof method.id !== 'string' || typeof method.label !== 'string') {
        // eslint-disable-next-line no-console
        console.warn('[contrib-auth] invalid login method descriptor; ignored')
        return noop()
      }
      const id = `${manifest.id}.${method.id}`.replace(/[^a-z0-9_.-]/gi, '-').slice(0, 120)

      // The host-facing login-method object. The host's claim dialog calls
      // `authenticate(ctxArg)`; we wrap it so the result is validated and, for
      // the keypair path, the key invariant is enforced against the roster
      // winner BEFORE the host accepts. The host provides the winner lookup via
      // `ctxArg.rosterWinnerPublicKey` (already resolved host-side), so this
      // adapter never reads team-roster internals.
      const hostMethod = {
        id,
        label: String(method.label).slice(0, 60),

        async isAvailable(teamId) {
          try {
            if (bridge && typeof bridge.isAvailable === 'function') {
              return !!(await bridge.isAvailable(teamId))
            }
            return true
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(`[contrib-auth] ${id} isAvailable failed:`, e)
            return false
          }
        },

        // optional custom card body — returns vDOM/HTML (sanitized by contrib-ui).
        hasRender: !!(bridge && typeof bridge.render === 'function'),
        async render(mountToken) {
          if (!bridge || typeof bridge.render !== 'function') return ''
          try { return await bridge.render(mountToken) } catch { return '' }
        },

        /**
         * Called by the host claim dialog. `ctxArg` carries:
         *   { teamId, username, profile, rosterWinnerPublicKey }
         * Returns a NORMALIZED, INVARIANT-CHECKED unlock result the host feeds
         * into its unchanged post-unlock tail:
         *   - { kind:'password', password }  → host runs deriveIdentity
         *   - { kind:'keypair', publicKey, privateKey } → host restores key
         * Throws (typed) on denial / shape error / invariant violation.
         */
        async authenticate(ctxArg) {
          if (!bridge || typeof bridge.authenticate !== 'function') {
            throw authError('UNSUPPORTED_METHOD', 'Login method has no authenticate().')
          }
          const safeCtx = {
            teamId: ctxArg && ctxArg.teamId,
            username: ctxArg && ctxArg.username,
            profile: sanitizeProfile(ctxArg && ctxArg.profile),
          }
          let raw
          try {
            raw = await bridge.authenticate(safeCtx)
          } catch (e) {
            throw authError('INTERNAL', `Login method failed: ${(e && e.message) || e}`)
          }
          const norm = normalizeAuthResult(raw)

          // INVARIANT (§8.7): for the keypair path, the returned publicKey MUST
          // equal the roster's canonical winner for this username. The host
          // resolved the winner and passed it in `ctxArg.rosterWinnerPublicKey`.
          if (norm.kind === 'keypair') {
            const winner = ctxArg && ctxArg.rosterWinnerPublicKey
            if (winner != null && winner !== '' && norm.publicKey !== winner) {
              throw authError('CAPABILITY_DENIED',
                'Login method returned a key that does not match this member\'s roster identity.')
            }
            // If there is NO winner yet (first claim), a keypair-restore cannot
            // prove identity for a pre-existing username; the host treats this as
            // a fresh claim only if it chooses to. We pass it through; the host's
            // unchanged roster.claim/login tail is the final gate.
          }
          return norm
        },
      }

      if (hostHooks.auth && typeof hostHooks.auth.registerLoginMethod === 'function') {
        try { hostHooks.auth.registerLoginMethod(hostMethod) } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[contrib-auth] host registerLoginMethod failed:', e)
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn('[contrib-auth] host did not provide auth.registerLoginMethod; method inert')
      }
      registered.set(id, { manifest })

      return {
        dispose() {
          registered.delete(id)
          if (hostHooks.auth && typeof hostHooks.auth.unregisterLoginMethod === 'function') {
            try { hostHooks.auth.unregisterLoginMethod(id) } catch { /* ignore */ }
          }
        },
      }
    },

    /** Dispose all login methods registered through this adapter instance. */
    disposeAll() {
      for (const id of Array.from(registered.keys())) {
        if (hostHooks.auth && typeof hostHooks.auth.unregisterLoginMethod === 'function') {
          try { hostHooks.auth.unregisterLoginMethod(id) } catch { /* ignore */ }
        }
      }
      registered.clear()
    },
  }
}

/** Only public, non-secret profile fields cross to the plugin. */
function sanitizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null
  return {
    username: typeof profile.username === 'string' ? profile.username : undefined,
    displayName: typeof profile.displayName === 'string' ? profile.displayName : undefined,
    publicKey: typeof profile.publicKey === 'string' ? profile.publicKey : undefined,
  }
}

function denied(method) {
  // eslint-disable-next-line no-console
  console.warn(`[contrib-auth] CAPABILITY_DENIED for ${method}`)
  return noop()
}
function noop() { return { dispose() {} } }
