# Notionless Mobile (native companion)

A native iOS/Android companion for [Notionless](../../README.md) — the
open-source, local-first, zero-account, pure-P2P Notion alternative.

The phone is a **companion to a desktop team**, not a standalone product. You
create a team on the macOS desktop app, then **pair a phone to it** with one
link (or QR). The phone joins the same end-to-end-encrypted P2P swarm and lets
you read and edit your notes on the go. There are still **no accounts and no
server** holding your data — the phone derives the team keys from the pairing
link locally and syncs peer-to-peer over WebRTC, exactly like a second desktop.

> **Why a native build (no Expo Go).** The companion uses native crypto
> (`react-native-libsodium`), native WebRTC (`react-native-webrtc`), and the
> camera (`expo-camera`). Those are native modules, so Expo Go can't run it —
> you build a **dev client** once, then iterate over Metro like any Expo app.

---

## What it does

- **Pairs to a desktop team** from a `notionless-pair:` link, a `notionless-team:`
  link, or a QR code scanned with the camera.
- **Syncs the note tree** live from the team root doc (folders, pages, locked
  notes), end-to-end encrypted — the relay and peers only ever see ciphertext.
- **Read + edit pages** in a Notion-style page editor (Markdown body bound to the
  per-note Yjs CRDT, so edits merge with desktop edits).
- **Claims its own identity** in the team (a per-team Argon2id-derived Ed25519
  keypair, self-signed into the roster) — the phone is a first-class member, not
  a mirror of the desktop's identity.
- **Works offline** — notes persist locally (Yjs over AsyncStorage) and re-sync
  when a peer is reachable again.
- **Light + dark**, system-driven.

---

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node | 22.x | `nvm install 22 && nvm use 22` recommended |
| npm | 10.x | bundled with Node 22 (this app uses **npm**, not pnpm) |
| Expo SDK | 56 | already pinned in `package.json` (`expo ~56.0.8`, RN 0.85.3) |
| **iOS** | Xcode 16+ | macOS only; includes the iOS Simulator |
| **Android** | Android Studio | SDK + an emulator or a USB device |
| CocoaPods | latest | `sudo gem install cocoapods` (installed automatically by `expo prebuild` if missing) |

> ⚠️ **Read the versioned Expo docs before changing native config:**
> <https://docs.expo.dev/versions/v56.0.0/>. This app is on Expo 56 and the
> config-plugin / prebuild surface changes between SDKs.

---

## 1. Install dependencies

```bash
cd apps/mobile-native
nvm use 22         # or: nvm install 22 && nvm use 22
npm install
```

## 2. Build & run the dev client

The native modules mean you build the app once with `expo run:*` (this runs
`expo prebuild` to generate the native project, installs pods, compiles, and
launches the dev client). After the first build, day-to-day work is just
`npm start` + a reload.

**iOS Simulator (macOS):**

```bash
npm run ios            # = expo run:ios — prebuild + pod install + build + launch
```

**Android emulator / device:**

```bash
npm run android        # = expo run:android — prebuild + gradle build + launch
```

**A physical iPhone** (needs a free Apple Developer signing team):

```bash
npx expo run:ios --device     # pick your plugged-in phone; Xcode signs it once
```

> The iOS bundle identifier is `com.naridon.notionless.mobile` and the URL
> scheme is `notionless://` (used for deep-link pairing). The native `ios/` and
> `android/` projects are **generated** by `expo prebuild` (run automatically by
> `expo run:ios` / `expo run:android`) from `app.json`, so they're **not checked
> in** — they regenerate on a fresh clone. Don't hand-edit them; change `app.json`
> and re-run prebuild.

### Day-to-day (after the first native build)

```bash
npm start              # Metro bundler; press i / a to open, r to reload
```

You only need to re-run `npm run ios` / `npm run android` when you change native
config (`app.json` plugins, native deps, the URL scheme, icons, etc.). JS/TS
changes hot-reload over Metro.

### Sanity check the bundle without a device

```bash
npx expo export        # compiles the JS bundle; a clean exit means it builds
```

---

## 3. Pair the phone to a desktop team (connect)

The phone has to join an **existing team** created on the macOS desktop app.
Pairing transfers exactly one secret — the team's `teamRootKey` — from which the
phone derives every key it needs (team id, swarm key, E2EE key, per-note keys)
locally. Nothing about your notes is uploaded; the relay only brokers the WebRTC
connection.

### On the desktop (the "parent" device)

1. Open the team you want to share to the phone.
2. Click the **phone icon → "Link a device"** (top of the team panel).
3. A dialog shows a **QR code**, a **pairing link** (`notionless-pair:v1.…`), and
   a short code. The link is valid for **72 hours**, then it's useless.

### On the phone

1. Open Notionless → **"Add a team"**.
2. Either:
   - **Scan** the desktop's QR with the camera, **or**
   - **Paste** the `notionless-pair:` link (a plain `notionless-team:<key>` link
     also works as a graceful fallback).
3. Tap **Join**. The phone derives the team material and starts syncing — your
   pages appear in the sidebar as peers connect.
4. Open the **membership footer** ("Join this team" / your avatar) and **claim
   your identity**: pick a **username + password**. This derives the phone's own
   Ed25519 keypair (Argon2id) and self-signs it into the team roster. Use a
   **phone-specific username** so a lost device is easy to tell apart.

That's it — the phone is now a member and edits sync both ways.

### The connection prerequisite: phone and desktop must share a relay

P2P peers can only find each other if they dial a **common signaling relay**.
There's no relay federation, so the lists have to overlap. Set the relay list in
the phone's **Settings → Signaling** (comma-separated). Defaults:

```
ws://localhost:4444, wss://oss.naridon.com/signaling
```

| Your setup | Use this relay |
| --- | --- |
| **iOS Simulator** + desktop running `pnpm run dev` | `ws://localhost:4444` (the sim shares the Mac's loopback) — the default already includes it |
| **Physical phone** + packaged/released desktop | `wss://oss.naridon.com/signaling` (the public relay) — also in the default |
| **Physical phone** + desktop dev on your LAN | add `ws://<your-mac-LAN-ip>:4444` (e.g. `ws://192.168.1.20:4444`); the phone can't reach the Mac's `localhost` |

Listing several is safe — y-webrtc dials all of them and peers meet on any shared
one. If pairing succeeds but **no pages ever appear**, it's almost always a relay
mismatch (or the desktop peer being offline).

> You can run your **own relay** instead of `oss.naridon.com`. It's the stateless
> WebRTC signaling server in [`/backend`](../../backend) (`pnpm run start`, path
> `/signaling`). Point both the desktop (`VITE_SIGNALING_URL`) and the phone
> (Settings → Signaling) at it.

---

## 4. Deep links

The app registers the `notionless://` scheme, so a pairing link can open it
directly:

- `notionless://pair#…` — opens straight into the join flow.
- A `notionless-pair:` / `notionless-team:` link tapped from Messages/Mail will
  hand off to the app where supported.

To test a deep link against a running simulator build:

```bash
xcrun simctl openurl booted "notionless://pair#<payload>"      # iOS
adb shell am start -a android.intent.action.VIEW -d "notionless://pair#<payload>"   # Android
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Paired but **no pages** show up | Relay mismatch — make the phone's Settings → Signaling overlap the desktop's, and keep a desktop peer online (P2P needs ≥1 peer reachable). |
| "Waiting for a desktop peer…" forever | The desktop app for that team isn't running, or it's on a different relay/network. |
| Pairing link **rejected/expired** | Links live 72h — mint a fresh one from the desktop's "Link a device" dialog. |
| Camera won't open for QR | Grant camera permission (iOS Settings → Notionless → Camera); the prompt copy is set in `app.json`. |
| Icons render as **empty boxes (tofu)** | The Ionicons TTF didn't load — do a clean native rebuild (`npm run ios`/`android`); the app preloads `Ionicons.font` on boot. |
| App stuck in **light** mode in dark OS | Ensure `app.json` has `"userInterfaceStyle": "automatic"` and rebuild natively (the value is baked into `Info.plist` at build time). |
| Pods out of date after a dep bump (iOS) | `cd ios && pod install` (or just re-run `npm run ios`). |
| Stale native state after config changes | `npx expo prebuild --clean` then `npm run ios`/`android`. |
| Metro cache weirdness | `npm start -- --clear`. |

---

## How it fits the desktop

The companion reuses the **same engine** as the desktop — the key derivation
(`team-keys`), the signed roster CRDT, and the Yjs+E2EE transport are the same
logic, just running on Hermes with native crypto/WebRTC shims. So a phone is
indistinguishable from a second desktop on the swarm: same team boundary, same
ciphertext-only relay, same first-claim-wins roster.

For the pairing protocol and the honest security tradeoffs (anyone with the link
can read the roster; no revocation/forward-secrecy; rotate the team key to
"remove" a device), see [`docs/MOBILE_COMPANION.md`](../../docs/MOBILE_COMPANION.md)
and [`docs/SECURITY.md`](../../docs/SECURITY.md).

## Project layout

```
apps/mobile-native/
  App.tsx                  boot: load icon font + settings + teams, mount AppShell
  app.json                 Expo config (scheme, bundle id, native plugins)
  src/
    app/                   UI — AppShell, Sidebar, PageEditor, WorkspaceSwitcher,
                           and the modal sheets (AddTeam, Settings, Membership)
    engine/                device-link (pairing), notes tree, session wiring
    store/                 persisted state — teams, sessions, settings, decorations
    ui/                    theme (light/dark) + shared Notion-style components
    shims/                 Node/WebRTC globals installed before anything evaluates
    spike/                 crypto + transport interop self-tests
```

---

Part of [Notionless](../../README.md). Licensed under
[AGPL-3.0](../../LICENSE) © Naridon Inc.
