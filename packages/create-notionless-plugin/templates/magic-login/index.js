import { definePlugin } from '@notionless/plugin-sdk'

/**
 * Magic Login — exercises `ctx.auth.registerLoginMethod`.
 *
 * Capabilities: ["auth"]
 *
 * INVARIANT (contract §5.4 / §8.7): a login method is an *alternate unlock of
 * the SAME key*, never an alternate identity proof. This method returns
 * `{ password }` (case a) which the host feeds into the UNCHANGED deriveIdentity
 * tail (deriveIdentity → roster.login → identity.setIdentity → refreshPresence →
 * 'team:identity-ready'). The plugin never touches team-roster op formats and
 * never persists the secret in its own storage.
 *
 * Boundary detail: the sandbox has NO window.api, so it cannot itself prompt
 * Touch ID or read safeStorage. Those are HOST-ONLY. Per the contract, the host
 * runs `auth:prompt-touch-id` + `auth:secure-load` on the plugin's behalf when
 * it accepts the method, and the unlocked credential reaches the plugin
 * transiently as the resolved value of the host-mediated unlock that `auth`
 * grants. This example models that as a single resolved password string; the
 * `auth` capability is what makes the host perform the secure unlock for us.
 *
 * (Only `ctx.auth` is used below — the plugin declares ONLY `auth`, so it
 * cannot and does not reach any other namespace.)
 */

export default definePlugin({
  async activate(ctx) {
    this._disposables = []

    const method = ctx.auth.registerLoginMethod({
      id: 'touchid',
      label: 'Unlock with Touch ID',

      // The host owns the safeStorage check; it resolves availability when it
      // evaluates this method for a given team. Returning `true` lets the host
      // surface the Touch-ID card; if no stored blob exists, the host's
      // re-check hides it and the dialog falls back to password entry.
      isAvailable: async (teamId) => typeof teamId === 'string' && teamId.length > 0,

      // Optional custom card body rendered in the claim/login dialog as vDOM
      // (the host sanitizes and mounts it).
      render: () => ({
        tag: 'div',
        attrs: { class: 'magic-login-card' },
        children: [
          {
            tag: 'div',
            attrs: { class: 'magic-login-icon', 'aria-hidden': 'true' },
            children: ['🔑'],
          },
          { tag: 'p', children: ['Use Touch ID to unlock this team identity.'] },
          {
            tag: 'button',
            attrs: { class: 'magic-login-btn', type: 'button' },
            children: ['Unlock with Touch ID'],
          },
        ],
      }),

      // The unlock. The host performs the Touch-ID prompt + safeStorage decrypt
      // (auth capability) and hands the recovered password into `ctxArg.profile`
      // -free flow; we return it so the host runs the UNCHANGED deriveIdentity
      // path with it. We NEVER fabricate or guess a password — if the host could
      // not unlock a stored credential it signals that and we reject so the
      // dialog falls back to manual entry.
      authenticate: async (ctxArg) => {
        const unlocked = ctxArg && ctxArg.unlockedPassword
        if (typeof unlocked !== 'string' || unlocked.length === 0) {
          throw new Error('Touch ID unlock unavailable; please enter your password.')
        }
        // Case (a): credential-source. Host derives the SAME key from this.
        return { password: unlocked }
      },
    })

    this._disposables.push(method)
  },

  async deactivate() {
    for (const d of this._disposables || []) {
      try { d.dispose() } catch { /* ignore */ }
    }
    this._disposables = []
  },
})
