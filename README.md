<h1 align="center">Notionless</h1>

<p align="center">
  <b>Open-source, local-first, zero-account, pure-P2P Notion alternative.</b><br>
  End-to-end encrypted Markdown notes that sync peer-to-peer — no cloud, no lock-in, no login.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg"></a>
  <img alt="Desktop: macOS" src="https://img.shields.io/badge/desktop-macOS-lightgrey.svg">
  <a href="apps/mobile-native/README.md"><img alt="Mobile: iOS · Android" src="https://img.shields.io/badge/mobile-iOS%20%C2%B7%20Android-blueviolet.svg"></a>
  <img alt="Status: beta" src="https://img.shields.io/badge/status-beta-orange.svg">
</p>

---

## What it is

Notionless is a Notion alternative that runs as a **macOS desktop app**. Your notes
are **plain Markdown files on disk** — you own them. There are **no accounts and no
login**: install the app, create a team, and share **one link**. Teammates join
instantly and edits sync **peer-to-peer over WebRTC**, end-to-end encrypted. The
only thing hosted is a tiny **stateless signaling relay** that brokers connections
and stores nothing.

- 🔒 **End-to-end encrypted** (libsodium AEAD) — the relay and peers see only ciphertext.
- 🪪 **Zero account** — identity is a deterministic keypair derived from a per-team username + password; the private key never leaves your device.
- 🛰️ **Pure P2P** — Yjs CRDTs over WebRTC; works offline, converges on reconnect.
- 📝 **Native Markdown editor** — CodeMirror 6 with live-preview decorations, not a proprietary block model.
- 🧠 **AI you control** — local Ollama, your own API key, or Claude Code. Retrieval runs offline.
- 🆓 **Free & open source** — AGPL-3.0.

## Features

Editor (CodeMirror 6, native Markdown): live preview, callouts, toggles, columns,
tables, math (KaTeX), Mermaid diagrams, images, embeds/bookmarks, code blocks,
@mentions, synced/transcluded blocks, inline comments, table of contents.

Workspace: nested pages, bi-directional wiki links & backlinks, full-text search,
templates, favorites/recents, trash & restore, multi-tab, databases (table / list /
gallery / calendar / timeline views, formulas, charts), import/export (Markdown /
HTML / PDF).

Collaboration: real-time multiplayer, live cursors/presence, version history,
teamspaces, per-note least-privilege sharing, **Company Brain** (RAG Q&A over your
notes — offline TF-IDF plus optional LLM generation).

See **[docs/STANDALONE_ARCHITECTURE.md](docs/STANDALONE_ARCHITECTURE.md)** for the
full architecture and **[docs/PLUGIN_SYSTEM.md](docs/PLUGIN_SYSTEM.md)** for the
plugin/integration surface.

## Quick start (development)

```bash
pnpm install
pnpm run dev          # Electron app (renderer + main)
pnpm run dev:m        # app + signaling relay together
```

Build & package:

```bash
pnpm run build        # electron-vite build
pnpm run dist         # build + electron-builder (installers)
```

The signaling relay lives in [`backend/`](backend/) and runs in stateless
relay-only mode (no database):

```bash
cd backend && pnpm run start
```

> A web build (`src/renderer/web/`) exists but is **dev-only** — used to run a
> second peer in a browser for local collaboration/sync testing. It is not deployed
> and is not a product surface.

## Mobile companion (iOS / Android)

A native iOS/Android **companion** lives in
[`apps/mobile-native/`](apps/mobile-native/). It pairs to a desktop team with one
link (or a QR scan), then reads and edits your notes on the same end-to-end
encrypted P2P swarm — no accounts, no server holding your data. The phone derives
the team keys locally and syncs peer-to-peer, exactly like a second desktop.

It's a native build (libsodium, WebRTC, and camera are native modules, so Expo Go
won't run it). Build the dev client once, then iterate over Metro:

```bash
cd apps/mobile-native
npm install
npm run ios          # or: npm run android
```

Full **build, run, and pairing/connect** instructions — including the relay-matching
rule that lets phone and desktop find each other — are in
**[apps/mobile-native/README.md](apps/mobile-native/README.md)**.

## How it works (in one paragraph)

Each note is a Yjs CRDT document. Identity, team membership, and per-note access are
**all client-side** and synced over the same P2P channel — there is no server-side
user database. One secret (the team link) is the entire access boundary; every other
key is derived from it via domain-separated hashes, so the relay only ever sees
hashed topics and ciphertext. A signed, append-only roster CRDT establishes
membership (first-claim-wins, signature-verified). When a note is encrypted, a
transport document carries only AEAD ciphertext over the wire while the plaintext
stays local.

## Plugins

Notionless is designed to be extended without forking — custom blocks, slash
commands, sidebar panels, AI providers, and import/export formats — through a
**sandboxed, capability-scoped** plugin API. You can even **describe a plugin to
Claude** and have it scaffolded and hot-loaded in-app. See
[docs/PLUGIN_SYSTEM.md](docs/PLUGIN_SYSTEM.md).

## Honest tradeoffs

- Anyone with the team link can read the roster and brute-force a member's password
  offline (mitigated by Argon2id + a strength meter + optional join secret).
- No revocation / forward secrecy — removing a member means rotating the team key
  (i.e. a new team).
- Availability needs **≥1 member online** (no always-on replica node).
- Presence labels are unsigned; the signed roster is the source of truth for membership.

## Contributing

Contributions are welcome under the **Developer Certificate of Origin** — sign off
your commits with `git commit -s`. By contributing you agree your work is licensed
under the project's AGPL-3.0 (Naridon Inc. retains the option to offer a commercial
dual-license). See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the dev setup,
project layout, and PR checklist, and **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)**
for community expectations.

## Security

Found a vulnerability? Please **don't** open a public issue — follow the private
disclosure process in **[SECURITY.md](SECURITY.md)**. The full threat model and
honest tradeoffs are documented in **[docs/SECURITY.md](docs/SECURITY.md)**.

## License

[AGPL-3.0](LICENSE) © Naridon Inc. Plugins built against the documented plugin API
are independent works and may be licensed separately — see
[docs/PLUGIN_SYSTEM.md §11](docs/PLUGIN_SYSTEM.md).
