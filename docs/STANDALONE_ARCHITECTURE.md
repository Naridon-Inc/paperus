# Standalone Architecture

Notionless is a **standalone, local-first** application: it works fully offline with
**no account, no login, and no cloud service holding your data**. This document
describes how the app runs on its own and how optional peer-to-peer collaboration
is layered on top without introducing a backend that stores anything.

## 1. What "standalone" means

- **No accounts.** There is no sign-up, no email/OAuth login, no JWT, and no
  server-side user database. Install the app and start writing.
- **Local-first storage.** Notes are plain Markdown files on disk (Electron) or in
  IndexedDB (web). Your data is yours and lives on your device.
- **Offline by default.** Everything works with no network. Collaboration is an
  optional layer, not a requirement.
- **Free and open source.** No subscriptions, no tiers, no telemetry-gated
  features.

## 2. Platform targets

The same renderer codebase runs on two targets:

| | Electron (desktop) | Web |
| :--- | :--- | :--- |
| Storage | Native filesystem via IPC (`.md` files) | IndexedDB |
| Offline persistence | `y-indexeddb` | (in-memory / IndexedDB) |
| Local signaling | Local server on port 4444 | Remote relay (`VITE_SIGNALING_URL`) |
| Secret-at-rest | OS `safeStorage` (best-effort) | session-scoped only |

Identity vs projection: each document has a stable UUID (tracked in
`.notionless/manifest.json` by `ManifestManager`) that is independent of its `.md`
filename, so files can be renamed or moved without losing collaboration identity.

## 3. Collaboration without a backend

Collaboration is **pure peer-to-peer** over WebRTC, using Yjs CRDTs:

- Each open document is a `Y.Doc` driven through the `openP2PDoc` chokepoint in
  `engine.js` (`new DocumentEngine → setupE2EE → connectP2P → presence`).
- Sync runs over `y-webrtc`; offline persistence over `y-indexeddb` (Electron);
  presence over Awareness.
- Content is **end-to-end encrypted** with libsodium. When encrypted, only AEAD
  ciphertext travels over the wire (via a `transportDoc`); the plaintext CRDT
  stays local.

### The only server: a stateless signaling relay

The single server component is a tiny **WebRTC signaling relay** (`backend/`,
`/signaling` WS + `/health`). It does publish/subscribe of hashed
`notionless-<hash>` topics to help peers find each other and **stores nothing** —
no notes, no keys, no users. It can be self-hosted, or you can point at any relay
via `VITE_SIGNALING_URL`. (The remaining account/billing/cloud-sync code in the
backend is legacy SaaS material slated for removal.)

## 4. Teams: install → create → share one link

- **Create a team**, share **one link** (`notionless-team:<teamRootKey>`), and
  teammates join instantly with no account.
- Each member picks a per-team **username + password**, which deterministically
  derives an Ed25519 identity keypair (`Argon2id(password, salt = H(teamId ‖
  username))`). Nothing is sent to a server; the same credentials re-derive the
  same key on any device.
- Membership lives in a **signed, append-only roster CRDT** (`team-roster.js`),
  reconciled locally so forged entries are ignored and login is accepted only on a
  public-key match.
- A team is one root `Y.Doc` (roster + note tree) plus per-note `Y.Doc`s opened
  lazily, each in its own E2EE/swarm room derived from the single team key
  (`team-keys.js`).
- A **per-note least-privilege share** (`notionless-share:v2.<swarmKey>.<e2eeKey>`)
  grants exactly one note — never the team index or roster.

## 5. Honest tradeoffs (zero-server identity)

- The link is the team's front door: anyone who ever had it can rejoin (no
  revocation without rotating the team key).
- Anyone with the link can read the roster and brute-force a member's password
  offline; mitigated by Argon2id, a password-strength meter, and an optional
  `joinSecret`.
- Presence labels are unsigned; the signed roster is the source of truth for
  membership.
- The web build can only hold secrets in session-scoped storage; Electron uses OS
  `safeStorage`.
