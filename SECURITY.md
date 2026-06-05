# Security Policy

Notionless is **end-to-end encrypted, zero-account, and peer-to-peer**. No server
ever holds a readable copy of your notes, your password, or your keys. We take
security seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately using
**[GitHub's private vulnerability reporting](../../security/advisories/new)**
(the *Security → Report a vulnerability* button on this repository). This opens a
private advisory visible only to you and the maintainers.

When you report, please include:

- A description of the issue and the **impact** (what an attacker can do).
- **Steps to reproduce** or a proof-of-concept.
- The affected version / commit and platform (desktop macOS, or the
  iOS/Android companion).
- Any suggested remediation, if you have one.

**What to expect:**

- We aim to **acknowledge** your report within a few days.
- We'll work with you to confirm the issue, assess severity, and prepare a fix.
- We'll credit you in the advisory and release notes unless you'd rather stay
  anonymous.
- Please give us a reasonable window to ship a fix before any public disclosure
  (coordinated disclosure).

## Scope

In scope:

- The desktop app (`src/main`, `src/renderer`) and the mobile companion
  (`apps/mobile-native`).
- The cryptographic core: identity derivation, the signed roster, key
  derivation, and the E2EE transport (`team-keys`, `team-roster`, `e2ee`,
  `engine`).
- The signaling relay (`backend/`).

Out of scope:

- The **documented, accepted tradeoffs** below — these are design decisions, not
  bugs. If you have a *new* attack that breaks an invariant we claim to hold,
  that's in scope.
- Third-party dependencies (report those upstream, though we're glad to know).
- The dev-only web build (`src/renderer/web/`), which is not a shipped surface.

## Threat model & accepted tradeoffs

The full threat model — what the relay can and cannot see, exactly how a note is
encrypted, and the per-feature caveats — is documented in
**[docs/SECURITY.md](docs/SECURITY.md)**. In short, these are **known and
accepted**, not vulnerabilities:

- **The team link is the entire access boundary.** Anyone with the
  `notionless-team:` link can read the team roster and **brute-force a member's
  password offline** (mitigated by Argon2id + a password-strength meter + an
  optional join secret).
- **No revocation / forward secrecy.** Removing a member means rotating the team
  key — i.e. creating a new team. A previously-shared link cannot be un-shared.
- **Availability needs ≥1 member online.** There is no always-on replica; if
  every peer is offline, no one can sync.
- **Presence labels are unsigned.** The signed roster — not presence — is the
  source of truth for membership.
- **A pairing link grants full team access for 72 hours.** Treat
  `notionless-pair:` links like passwords; they expire, but a leaked live link is
  a live team key until it does.

If your finding is that one of these invariants can be broken in a way the model
*doesn't* already disclose — for example, the relay being able to recover
plaintext, a roster forgery that survives `reconcile()`, or plaintext CRDT ops
leaking to peers despite E2EE — that is exactly what we want to hear about.

## Supported versions

Notionless is pre-1.0 / beta. Security fixes land on `master` and ship in the
next release. We don't backport to older tagged releases — please test against
the latest `master` or release before reporting.
