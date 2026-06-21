# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Notionless is an **open-source, local-first, zero-account, pure-P2P** Notion alternative. It ships as an Electron **desktop (Mac) app** — there is **no hosted web app**. (A web build under `src/renderer/web/` still exists, but it is **dev-only**: run it alongside an Electron instance for local collaboration/sync testing. It is not deployed and is not a product surface.) The editor is **CodeMirror 6** editing **native Markdown** (with live-preview decorations), and Yjs CRDTs power real-time collaboration. Notes are plain Markdown files on disk.

There are **no accounts and no login**: you install the app, create a team, and share **one link**. The invite is a `notionless://invite#team=…` deep link that opens the installed desktop app and joins instantly with a per-team username + password (used only to derive a local identity — never sent to a server); teammates without the app install it first. Sync is peer-to-peer over WebRTC; the only thing hosted (at `oss.naridon.com`) is a tiny stateless **WebRTC signaling relay** that brokers connections and stores nothing.

## Commands

### Development
```bash
# Electron app (renderer + main process)
pnpm run dev

# Electron app + backend simultaneously
pnpm run dev:m

# Backend only (from backend/)
cd backend && pnpm run dev

# Web version build
pnpm run build:web
```

### Build & Package
```bash
pnpm run build          # electron-vite build
pnpm run dist           # Build + electron-builder (produces installers)
pnpm run pack           # Build + electron-builder --dir (unpacked)
```

### Backend (signaling relay)
```bash
cd backend
pnpm run start          # Production: node src/index.js
pnpm run dev            # Development: nodemon src/index.js
```
The backend is being collapsed into a stateless WebRTC signaling relay (no
database). There is **no Prisma/Postgres step** in the target architecture.

### Deployment
```bash
# Deploy the signaling relay to AWS Lightsail
pnpm run deploy:lightsail
```

### Docker (local dev)
```bash
docker-compose up       # Starts the signaling relay
```

## Architecture

### Multi-Platform Strategy

The shipping product is **Electron desktop only**. A web build still exists from a shared renderer codebase, but it is **dev-only** (local collaboration/sync testing) and is never deployed.

- **Electron** (`src/main/` + `src/renderer/src/`): the product. Full desktop app with native filesystem access via IPC. `electron-vite` bundles main, preload, and renderer processes.
- **Web** (`src/renderer/web/`) — *dev-only, not deployed*: `web-main.js` bootstraps the same renderer code with a mock `window.api` that maps filesystem operations onto browser storage (IndexedDB). Built with `vite.web.config.mjs` (relative asset base), output goes to `dist-web/`. Useful for running a second peer in a browser against the relay during P2P testing.
- The web build uses `@` alias pointing to `src/renderer/src/` so it imports the same modules as Electron.

### Core Concepts

**Editor**: The editor is **CodeMirror 6** (`src/renderer/src/cm-editor.js`) editing **native Markdown** — the buffer is Markdown text, not a separate rich-text model. A custom `HighlightStyle` makes the Markdown look like a document, and the `cm-hide-markers.js` live-preview decorations hide/soften syntax markers (`#`, `**`, backticks) while the cursor is elsewhere. CodeMirror plugins under `cm-*.js` add block-level features (callouts, columns, toggles, embeds, images, math, mermaid, mentions, TOC, transclusion, etc.). CRDT collaboration is wired via `yCollab` (y-codemirror.next) in `main.js`. (The legacy Quill blots under `src/renderer/src/blots/` are dead code from the pre-CM6 editor and are no longer imported.)

**Identity vs Projection**: The system separates document identity (stable UUID tracked in `.notionless/manifest.json`) from projection (the `.md` file on disk). `ManifestManager` (`src/main/manifest.js`) handles the mapping. Files can be renamed/moved without losing their collaboration identity.

**DocumentEngine** (`src/renderer/src/engine.js`): Manages the lifecycle of a single CRDT document. Each open document gets its own `Y.Doc` instance with:
- `IndexeddbPersistence` for offline support (Electron only)
- `Awareness` for presence/cursors
- `PresenceManager` for rendering remote cursors
- `SnapshotManager` for version history
- `P2PNetwork` (`p2p.js`) for WebRTC sync
- Optional E2EE via `e2eeManager` (libsodium). When encrypted, a `transportDoc` carries only AEAD ciphertext over the wire while the plaintext `Y.Doc` stays local.

**openP2PDoc chokepoint** (`engine.js`): Every P2P document — team root doc, per-note docs, and standalone shares — is opened through `openP2PDoc({ docId, swarmKey, e2eeKey, identity })`, which does `new DocumentEngine → setupE2EE → connectP2P → set presence` in that order. Routing everything through it guarantees E2EE is set up before the WebRTC provider binds, so the provider always binds to the encrypted `transportDoc` and plaintext CRDT ops never leak to peers.

**ProjectionManager** (`src/renderer/src/projection.js`): Observes Yjs text changes and writes them back to the filesystem as Markdown. Only active for local files.

**Sync Layers**: Documents sync through:
1. **WebRTC** (`y-webrtc`): Peer-to-peer sync via the signaling relay. This is the primary (and target-only) sync path.
2. **IndexedDB** (`y-indexeddb`): Local persistence for offline (Electron only).
3. **Awareness**: Real-time presence/cursors.
4. **E2EE**: libsodium AEAD over the `transportDoc` so the relay and peers see only ciphertext.

(A legacy `y-websocket` server-mediated cloud-sync path still exists in the code but is disabled — `Features.cloudSync = false` — and is being removed.)

### Teams & identity (zero-account, pure-P2P)

There is no server-side user database. Membership and identity are entirely client-side and synced over the same P2P channel.

- **Two link scopes**:
  - **Team link** — `notionless-team:<teamRootKey>` (also accepted as a `#team=` / `?team=` URL fragment). Grants the **whole workspace**: the synced note tree plus the roster.
  - **Per-note least-privilege share** — `notionless-share:v2.<noteSwarmKey>.<noteE2EEKey>`. Grants **exactly one note** (never the team index or roster). The older `notionless-share:<code>` standalone share still works, upgraded to be E2EE.
- **One secret per team**: the `teamRootKey` inside the team link is the team's entire access boundary. Every other key (team id, team swarm/E2EE key, per-note swarm/E2EE keys) is derived from it via domain-separated BLAKE2b hashes in `team-keys.js`. The relay only ever sees hashed topics and ciphertext.
- **Deterministic identity**: a member's per-team identity is a deterministic **Ed25519 keypair** derived as `Argon2id(password, salt = H(teamId ‖ username))` (`team-keys.deriveIdentity`). Same username+password re-derives the same key on any device (no salt stored); the `teamId` in the salt means the same credentials yield a different key per team (independent rosters). The private key lives in **session memory only** — never `localStorage`.
- **Signed roster CRDT**: `team-roster.js` (`RosterManager`) maintains an append-only `rosterClaims` Y.Array of signed claim ops. Membership is a derived view recomputed locally (`reconcile()`): the canonical winner for a username is the valid-signature claim with the smallest `createdAt` (first-claim-wins). Forged or signature-mismatched entries are treated as nonexistent, so a malicious `roster.set` is reverted on the next tick. **Login** re-derives the keypair and is accepted only if the public key matches the roster.
- **Honest tradeoffs** (surface these in UI/docs): anyone with the team link can read the roster and brute-force a member's password offline (mitigated by Argon2id + a strength meter + optional `joinSecret`); there is no revocation/forward secrecy (removing a member means rotating the team key, i.e. a new team); presence labels are unsigned (the signed roster, not presence, is the source of truth for membership); y-webrtc caps the mesh (small-team feature).

### Backend (`backend/`) — signaling relay only

The target backend is a tiny **stateless WebRTC signaling relay** that stores nothing — no Postgres, no Prisma, no JWT, no Stripe.

- `src/index.js` - HTTP server (`/health`) + WebSocket routing.
- `src/signaling.js` - WebRTC signaling relay: zero-auth publish/subscribe of `notionless-<hash>` topics. Brokers peer connections; never sees note content or keys.
- `src/yjs-handler.js` - Runs in **relay-only** mode by default (`RELAY_ONLY=true`): relays Yjs updates between peers but **never persists** content and never gates on accounts. Optional NAT fallback only.

WebSocket path: `/signaling` for P2P. (Account/billing/cloud routes — auth, teams, documents, filesystem, Stripe, the `/notifications` and persisting `/yjs` paths — are legacy SaaS code slated for removal in the backend teardown; do not build on them.)

### Renderer Modules (`src/renderer/src/`)

- `main.js` - App entry point; orchestrates managers, file loading and tab logic; wires the CodeMirror view + `yCollab`; routes team/share commands through the `openP2PDoc` chokepoint; handles startup `#team=` deep-links.
- `cm-editor.js` - The CodeMirror 6 editor (native Markdown, custom HighlightStyle, live-preview decorations).
- `engine.js` - `DocumentEngine` + the `openP2PDoc` chokepoint (see Core Concepts).
- `p2p.js` - `P2PNetwork` (WebRTC) plus link/code helpers: `generateTeamKey`/`buildTeamLink`/`parseTeamCode`, `buildShareV2*`/`parseShareToken`, and the standalone `parseShareCode`.
- `p2p-team.js` - `P2PTeamManager`: create/join/open teams, the synced note tree (create/rename/move/tombstoned-delete), and lazily opening per-note docs through `openP2PDoc`. Holds the root engine.
- `team-keys.js` - Single source of truth for all key/id derivations (domain-separation labels, team + per-note keys, `deriveIdentity`).
- `team-roster.js` - `RosterManager`: the signed, append-only membership roster and `reconcile()`/login logic.
- `identity.js` - Session identity store (private key in memory; non-secret profile cached per team); source for presence and git author.
- `team-dialogs.js` - Vanilla dialogs: create-team, join-team, claim-or-login (Argon2id spinner, password-strength meter), member roster view.
- `filesystem-proxy.js` - Abstracts local filesystem (Electron IPC) vs browser storage into a uniform interface.
- `sidebar-manager.js` - File tree, Teams section, shared docs in the sidebar.
- `tab-manager.js` - Multi-tab document management.
- `markdown.js` - Markdown <-> HTML conversion (Showdown/Turndown) for import/export interop.
- `share.js` - Document sharing UI and invite flow (emits `share:v2` links for team notes).
- `e2ee.js` - End-to-end encryption and identity crypto using libsodium (AEAD + Ed25519 + Argon2id).
- `indexer.js` - Full-text search indexing.
- `store.js` - Simple key-value store abstraction.

(`auth-client.js` and the account-based `team.js` are legacy SaaS modules slated for removal.)

### Electron Main Process (`src/main/`)

- `index.js` - Window creation, IPC handler registration, file watcher (chokidar), local signaling server on port 4444, auto-updater
- `manifest.js` - `ManifestManager` class that maintains `.notionless/manifest.json` per project root

## Key Technical Details

- **Positioning**: Open-source, local-first, free. No accounts, no subscriptions, no cloud lock-in.
- **Package manager**: pnpm (workspace with `backend/` as separate package)
- **No framework**: The renderer is vanilla JS with direct DOM manipulation (no React/Vue/Angular)
- **Editor**: CodeMirror 6 editing native Markdown (`cm-editor.js` + `cm-*.js` extensions). The old Quill blots under `src/renderer/src/blots/` are dead code from the pre-CM6 editor.
- **Crypto**: libsodium (`libsodium-wrappers-sumo`) — AEAD for E2EE, Ed25519 for roster signatures, Argon2id for identity derivation.
- **Sync transport**: Yjs over `y-webrtc` (P2P) + `y-indexeddb` (offline, Electron); `yCollab` binds the CRDT to CodeMirror.
- **ESLint**: Extends `airbnb-base`, `no-console` is off
- **Sentry**: Error tracking enabled in both main and renderer processes
- **Auto-update**: Uses `electron-updater` with S3 bucket (`notionless-updates` in `eu-central-1`)
- **Server**: a single stateless WebRTC signaling relay (no production user-data URL; no database). Configure via `VITE_SIGNALING_URL`; Electron also runs a local signaling server on port 4444 for dev.


<!-- AURA_START -->
# Aura Semantic Engine (v0.12.7)

You have access to the Aura Semantic Engine via MCP tools. Aura tracks the mathematical logic (AST Merkle-Graph) of the codebase, not text diffs. It also provides **real-time P2P team collaboration** via the Mothership.

## MANDATORY: Intent Logging
After making code changes and BEFORE committing, you MUST call `aura_log_intent` with a description of what you changed and why. This is NOT optional — without it, the pre-commit hook will detect "Intent Poisoning" and may block the commit. Aura **auto-pushes your changed functions to the team** when you log intent.

## MCP Tools Available
- `aura_snapshot` — ALWAYS call before modifying files. Takes a snapshot AND checks team zone ownership.
- `aura_log_intent` — REQUIRED after edits. Logs intent AND auto-pushes functions to mothership.
- `aura_status` — Check everything: semantic state, team sync status, pending pulls, active agents.
- `aura_pr_review` — Run semantic PR review to check for violations.
- `aura_prove` — Mathematically verify a behavioral goal is met.
- `aura_rewind` — Surgically revert a single function to a previous safe state.
- `aura_plan_discover` — Decompose complex objectives into atomic waves.
- `aura_plan_lock` / `aura_plan_next` — Lock and execute wave plans.
- `aura_handover` — Compress context for agent handoff (90%+ token savings).
- `aura_snapshot_list` — List all recoverable file snapshots.
- `aura_read_history` — Search semantic logic history to understand past decisions.
- `aura_sentinel_status` — See function-level claims, collisions, and zone ownership.
- `aura_sentinel_agents` — List all active agent sessions (Claude, Copilot, Gemini, Cursor, etc.).
- `aura_sentinel_send` — Send a message to another agent session.
- `aura_sentinel_inbox` — Read messages from other agent sessions.
- `aura_sentinel_release` — Release function claims for this session.
- `aura_zone_claim` — Claim exclusive ownership of a directory/file pattern.
- `aura_live_impacts` — Fetch cross-branch dependency conflict alerts.
- `aura_live_resolve` — Mark an impact alert as resolved.
- `aura_live_sync_push` — Push function bodies to mothership (auto on intent log).
- `aura_live_sync_pull` — Pull function changes from teammates and apply at AST level.
- `aura_live_sync_status` — Check pending sync changes from teammates.
- `aura_msg_send` — Send a message to team or a specific developer/agent.
- `aura_msg_list` — Read recent team messages.
- `aura_doctor` — Diagnose repository health issues.

## Team Collaboration (Automatic)
Aura auto-injects these into every MCP tool response — you MUST respond:
- **`🔄 SYNC: N function updates available`** → Call `aura_live_sync_pull` to apply teammate changes
- **`💬 TEAM: N unread messages`** → Call `aura_msg_list` to read, reply with `aura_msg_send`
- **`📨 SENTINEL: N unread messages from another AI agent`** → Call `aura_sentinel_inbox`, reply with `aura_sentinel_send`
- **`⚠️ SENTINEL COLLISION`** → Another agent is editing same functions. Coordinate.
- **`🚨 TEAM ZONE WARNING/BLOCKED`** → A teammate owns this file area. Respect it.
- **`🔄 AUTO-SYNC: Pushed N functions`** → Your changes were auto-synced. No action needed.

## Workflow
1. Call `aura_status` — check state, team sync, pending pulls, agents, messages
2. If pending pulls exist → call `aura_live_sync_pull` FIRST
3. Call `aura_snapshot` before editing files (auto-checks team zones)
4. Make your changes
5. Call `aura_log_intent` with your reasoning (auto-pushes to team)
6. Call `aura_pr_review` to verify no violations
7. Commit — Aura's pre-commit hook validates intent vs AST changes

## What You Must Never Do
- Never ignore team messages, zone warnings, or sync notifications
- Never edit a file that is BLOCKED by a team zone — coordinate first
- Never commit without calling `aura_log_intent` first
- Never edit a file without `aura_snapshot` first
<!-- AURA_END -->
