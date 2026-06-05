# Magic Login (example plugin)

Adds **Unlock with Touch ID** as an alternate way to unlock the *same* team
identity, shown in the claim/login dialog.

## Surfaces exercised

- `ctx.auth.registerLoginMethod({ id, label, isAvailable, render, authenticate })`

## Capabilities

```json
["auth"]
```

## The invariant (read this)

A login method is an **alternate unlock of the SAME key**, never an alternate
identity proof. This method's `authenticate()` resolves to `{ password }` (case
a in §5.4). The host then runs the **unchanged** `deriveIdentity` tail with that
password:

```
deriveIdentity(password, H(teamId ‖ username))
  → roster.login / claim
  → identity.setIdentity
  → manager.refreshPresence
  → 'team:identity-ready'
```

So the re-derived Ed25519 keypair is byte-for-byte the one the team roster
already knows — Touch ID just unlocks it without retyping the password.

## Boundary notes

- The sandbox has **no** `window.api`, so it cannot prompt Touch ID or read
  `safeStorage` itself. Those are **host-only**. With the `auth` capability
  granted, the host runs `auth:prompt-touch-id` + `auth:secure-load` on the
  plugin's behalf and supplies the recovered password to `authenticate()`'s
  context (`ctxArg.unlockedPassword`).
- The unlocked secret is **transient**: it is returned to the host and never
  written to plugin storage.
- The plugin never touches `team-roster.js` op formats and cannot mutate the
  roster — it only supplies a credential the host validates against the canonical
  roster winner.
