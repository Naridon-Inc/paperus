# Contributing to Paperus

Thanks for your interest in Paperus — an open-source, local-first, zero-account,
pure-P2P Notion alternative. This guide covers how to get set up, the project
layout, and what we expect in a pull request.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Ways to contribute

- **Report bugs** and **request features** via [GitHub Issues](../../issues).
- **Fix bugs / add features** via pull requests (see the checklist below).
- **Write plugins** — extend Paperus without forking through the sandboxed,
  capability-scoped plugin API. See [docs/PLUGIN_SYSTEM.md](docs/PLUGIN_SYSTEM.md).
- **Improve docs** — README, the `docs/` folder, code comments.
- **Report security issues privately** — do **not** open a public issue; follow
  [SECURITY.md](SECURITY.md).

---

## Development setup

### Prerequisites

- **Node 22.x** (`nvm install 22 && nvm use 22`)
- **pnpm** for the desktop app + backend (this is a pnpm workspace)
- **npm** for the mobile app (`apps/mobile-native` uses npm + Expo)
- macOS + Xcode for the desktop app and iOS mobile builds

### Desktop app + backend

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

The signaling relay lives in [`backend/`](backend/) and runs stateless,
relay-only (no database):

```bash
cd backend && pnpm run start
```

### Mobile companion (iOS / Android)

The native companion in [`apps/mobile-native`](apps/mobile-native) uses native
modules (libsodium, WebRTC, camera), so it needs a dev-client build — Expo Go
won't run it. Full instructions are in
[apps/mobile-native/README.md](apps/mobile-native/README.md).

```bash
cd apps/mobile-native
npm install
npm run ios           # or: npm run android
```

> The mobile app pins Expo SDK 56. **Read the versioned docs**
> (<https://docs.expo.dev/versions/v56.0.0/>) before touching native config.

---

## Project layout

| Path | What it is |
| --- | --- |
| `src/main/` | Electron main process (window, IPC, file watcher, manifest) |
| `src/renderer/src/` | The app: CodeMirror 6 editor, engine, P2P, teams, roster, plugins |
| `src/renderer/web/` | **Dev-only** web build (run a second peer in a browser for sync testing — not deployed) |
| `apps/mobile-native/` | Native iOS/Android companion (Expo, reuses the engine) |
| `backend/` | Stateless WebRTC signaling relay (no DB) |
| `landing/` | Marketing site (single-file `index.html`) |
| `docs/` | Architecture, security model, plugin system, self-hosting |
| `packages/plugin-sdk/` | Plugin types + SDK |

The architecture is documented in
[docs/STANDALONE_ARCHITECTURE.md](docs/STANDALONE_ARCHITECTURE.md); the security
model and honest tradeoffs are in [docs/SECURITY.md](docs/SECURITY.md). The
repo-level `CLAUDE.md` is a good high-level map of the codebase.

---

## Coding guidelines

- **Vanilla JS in the renderer** — no React/Vue/Angular; direct DOM manipulation.
- **ESLint** extends `airbnb-base` (with `no-console` off). Lint before you push.
- **Match the surrounding code** — naming, comment density, and idiom. New code
  should read like the file it lives in.
- **Crypto is load-bearing.** Anything touching identity, roster signatures, key
  derivation, or E2EE transport must preserve the invariants in
  [docs/SECURITY.md](docs/SECURITY.md). Route every P2P document through the
  `openP2PDoc` chokepoint so E2EE is always set up before the WebRTC provider
  binds. If you change a security-relevant path, say so explicitly in the PR.
- **No new server-side data stores.** The target backend is a stateless relay —
  don't reintroduce account/DB coupling.

---

## Pull request checklist

Before opening a PR, please make sure:

- [ ] **Commits are signed off** under the Developer Certificate of Origin —
      `git commit -s` (see *Developer Certificate of Origin* below). This is
      required.
- [ ] `pnpm run build` succeeds (and `pnpm run build:web` if you touched the
      renderer). For mobile changes, `npx expo export` compiles cleanly.
- [ ] You linted your changes and they match the existing style.
- [ ] The PR description explains **what** changed and **why**, and calls out any
      security-relevant or breaking changes.
- [ ] Docs/comments updated if behavior or public surface changed.
- [ ] No secrets, `.env` files, build artifacts, or large binaries are committed.

Open PRs against `master`. Keep them focused — one logical change per PR is much
easier to review.

---

## Developer Certificate of Origin (DCO)

Contributions are accepted under the
[Developer Certificate of Origin](https://developercertificate.org/). You certify
that you wrote the patch (or otherwise have the right to submit it under the
project's license) by **signing off** each commit:

```bash
git commit -s -m "Your message"
```

This appends a `Signed-off-by: Your Name <you@example.com>` line. By contributing
you agree your work is licensed under the project's **AGPL-3.0**. Naridon Inc.
retains the option to offer a commercial dual-license; signing off acknowledges
this.

---

## License

By contributing, you agree that your contributions will be licensed under
[AGPL-3.0](LICENSE). Plugins built against the documented plugin API are
independent works and may be licensed separately — see
[docs/PLUGIN_SYSTEM.md §11](docs/PLUGIN_SYSTEM.md).
