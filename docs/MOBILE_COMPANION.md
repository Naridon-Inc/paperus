# Mobile Companion Architecture

> Status: design (foundation slice). This document is the implementation contract for the
> Paperus mobile companion. Build agents implement directly from it. It cites real seams in
> `src/renderer/src/` — **do not invent a parallel crypto scheme**; every key/id and every
> signature reuses `team-keys.js`, `team-roster.js`, `e2ee.js`, and the `openP2PDoc` chokepoint.

---

## 0. TL;DR

- **Mobile = COMPANION = a leaf peer of an existing team, paired by a desktop parent.** It is the
  same vanilla-JS renderer (`src/renderer/src/`) booted as an installable **PWA** with a mocked
  `window.api` over IndexedDB/localStorage — exactly like the existing dev-only web build, but with
  a hard pairing gate and a mobile entrypoint. **No React Native, no Flutter, no new npm deps.**
- It is **inert until linked**. On launch it checks for stored pairing credentials; if absent it
  shows a Link screen and refuses to open notes.
- Linking moves **one secret — the `teamRootKey`** (plus a `deviceId` and metadata) from desktop to
  phone via a copyable pairing link / short code. From that secret the phone re-derives *everything*
  (`deriveTeamKeys`), same as any desktop member. **The pairing link carries no private identity key
  and no per-note keys** — those are derived locally.
- The companion **proves identity by claiming/logging in its own deterministic Ed25519 identity**
  against the signed roster (`team-roster.js`). The parent authorizes by *vouching for the team*
  (handing over the link); the companion **self-signs its own roster claim** because the roster's
  `validateOp()` verifies each op's signature against *its own* `idPublicKey` — a parent
  cryptographically **cannot** sign a claim on the companion's behalf, and we will not pretend it
  can.
- As a leaf, the companion syncs **foreground-only** over WebRTC via the relay, opportunistically,
  and is **never a relied-upon replica**. It skips background replication, disk projection, the file
  watcher, and the manifest.

---

## 1. The Companion Model: Leaf, Not Replica

### 1.1 What "leaf" means

A desktop member is an **ambient replica**: it persists notes to disk as Markdown
(`ProjectionManager`), keeps the file watcher live, and (on Electron) holds up to `MAX_REPLICAS`
**blind ciphertext replicas** of notes it hasn't even opened, so the team stays available even when
few humans are online. A companion does **none** of that. It is a **leaf**:

- It connects to the team swarm **only while the app is in the foreground**.
- It replicates a note **only while that note is open** (a tab) — opportunistic, on demand.
- It is **never counted on** to hold the latest state for anyone else.
- It persists locally to IndexedDB (`y-indexeddb`) for **its own** offline drafting, not as a team
  backup.

### 1.2 Why leaf and not replica

1. **Battery + lifecycle.** Mobile OSes suspend background tabs/apps. A persistent WebRTC mesh in
   the background drains battery and gets killed anyway. Foreground-only is the honest contract.
2. **Storage quota.** Mobile IndexedDB quotas are small (often ~50 MB) vs. effectively unbounded on
   Electron. Blind-replicating every note's ciphertext would blow the quota on a large team. (See
   `_reconcileReplicas` — it already early-returns on web; the companion keeps that behavior.)
3. **Trust/availability model is unchanged.** Paperus already assumes *≥1 human online* for pure
   P2P availability (the relay stores nothing). Adding a flaky phone as a "replica" would create a
   false sense of durability. The desktop fleet remains the durable tier; the phone is a viewer/
   editor that catches up when it reconnects. Yjs CRDTs merge its offline edits with zero conflict
   resolution on the way back in.

### 1.3 What the leaf MUST run (all already web-safe)

- `DocumentEngine` + Yjs core (`text`, `meta`, `awareness`) — `engine.js`.
- `y-indexeddb` persistence for offline-first drafting.
- E2EE setup (`setupE2EE` → `transportDoc` + encrypt/decrypt observers) — `engine.js`.
- WebRTC binding to the **transport** doc via `P2PNetwork` — `p2p.js`.
- Session identity (Ed25519 keypair in memory; non-secret profile cached) — `identity.js`.
- Signed roster reconcile/login (`team-roster.js`).
- Presence/awareness.
- ACL unwrap for restricted notes (`e2ee.unwrapKeyForIdentity`).

### 1.4 What the leaf MUST skip

- Disk projection / `window.api.writeFile` of Markdown (no `ProjectionManager`, no manifest).
- File watcher (chokidar / `fs.watch`).
- Background ciphertext replication (`_reconcileReplicas` is a no-op on web — keep it that way).
- Electron-only IPC (`win:*`, `fs:reveal`, `dialog:*` native, Touch ID) — the `window.api` mock
  stubs these, same as `web-main.js`.

---

## 2. The Linking Protocol

### 2.1 Goal and the access boundary

The companion needs exactly enough to (a) **join the team swarm**, (b) **decrypt team content**, and
(c) **present a valid identity**. (a) and (b) come from one secret; (c) is derived locally from a
password the user types on the phone.

From `team-keys.js`, the **`teamRootKey`** (an 18-byte base64url string, the thing inside a
`notionless-team:` link) deterministically yields *everything*:

```
teamId       = BLAKE2b-16("notionless:team:id"    ‖ rootKey)         → hex
teamDocId    = "team-" + teamId
swarmKey     = BLAKE2b-32("notionless:team:swarm"  ‖ rootKey)         → hex   (y-webrtc topic seed + password)
e2eeKey      = BLAKE2b-32("notionless:team:e2ee"   ‖ rootKey)         → base64(AEAD key)
noteSwarmKey = BLAKE2b-32("notionless:note:swarm"  ‖ rootKey ‖ noteId)
noteE2EEKey  = BLAKE2b-32("notionless:note:e2ee"   ‖ rootKey ‖ noteId)
```

So **the `teamRootKey` is the entire access boundary** and **the minimal safe set is just the
`teamRootKey`** — handing over per-note keys, the team E2EE key, the swarm key, or a private identity
key would all be redundant (they're derivable) and strictly worse (more secret surface in the link,
no extra capability). We deliberately do **not** put a private identity key in the link.

### 2.2 The pairing payload (concrete shape)

The desktop generates this object, JSON-stringifies it, base64url-encodes it, and wraps it as a
copyable pairing link. **All fields except `v`, `teamRootKey`, `deviceId`, and `expiresAt` are
non-secret conveniences.**

```js
// PairingPayload v1 — generated by desktop, consumed by companion.
{
  v: 1,                          // payload version
  teamRootKey: "AbC123…",        // 18B base64url — the ONLY secret. Derives all team keys.
  teamId: "abc123def456…",       // convenience: == deriveTeamId(teamRootKey). Companion re-derives + verifies.
  teamName: "Acme Docs",         // non-secret display hint (authoritative name still comes from teamMeta).
  deviceId: "dev_9f2a…",         // random id minted by desktop to tag THIS companion device.
  deviceName: "Alice's iPhone",  // non-secret label for the device-companion roster entry / UI.
  suggestedUsername: "alice-phone", // OPTIONAL hint to pre-fill the companion's claim screen.
  parentUsername: "alice",       // OPTIONAL: who paired it (display only; NOT an authorization).
  expiresAt: 1893456000000       // ms epoch. Companion REFUSES the payload after this (default now + 72h).
}
```

Encoded transport forms (v1 = text/link only; **QR deferred**, no QR lib dependency):

```
# Primary (copy/paste, air-gap friendly):
notionless-pair:v1.<base64url(JSON(PairingPayload))>

# Optional deep-link variant (only works once the PWA/Capacitor app registers a handler):
notionless://pair#v1.<base64url(JSON(PairingPayload))>
```

> Why a *new* `notionless-pair:` prefix instead of reusing `notionless-team:`? A bare team link
> carries only the rootKey and is **static/shareable forever**. The pairing payload additionally
> carries a `deviceId` + `expiresAt` so a leaked link is **time-gated** and the device can be tagged
> in the roster. The companion parser accepts both: a `notionless-pair:` payload (preferred) **or**
> a plain `notionless-team:<key>` (degrades gracefully: no deviceId, no expiry, prompt for
> everything).

### 2.3 What crosses, and why it's the minimal safe set

| Field | Secret? | Why it's here | Why nothing more |
|---|---|---|---|
| `teamRootKey` | **YES** | Sole capability: swarm join + team/per-note key derivation. | Everything else is derivable from it. |
| `deviceId` | no | Tags this phone as a distinct companion device (roster `displayName` + local creds). | — |
| `expiresAt` | no | Time-gates a leaked link. | — |
| `teamId`/`teamName`/`deviceName`/`suggestedUsername`/`parentUsername` | no | UX hints; companion re-derives `teamId` and verifies. | Pure convenience; authoritative values come from the synced root doc. |

**Explicitly NOT in the payload:** the companion's Ed25519 **private key**, the team **password**,
the **e2eeKey**/**swarmKey**, or any **per-note key**. The private key never leaves a device by
design (`identity.js` R4); the password is what the *human* types on the phone to re-derive the
identity locally (Argon2id runs on the phone).

### 2.4 How the companion presents identity / is authorized by the parent

This is the part the upstream map got cryptographically wrong, and we fix it here.

**The roster's invariant (`team-roster.js`):** `validateOp(op)` returns true only if
`e2eeManager.verifyDetached(op.sig, canonicalString(op), op.idPublicKey)` — i.e. **every op must be
signed by the private key matching its own `idPublicKey`.** Therefore:

> A parent **cannot** sign a roster `claim` "for" the companion's key. Whoever holds the private key
> for `idPublicKey` is the only entity that can produce a valid claim under that key. The companion
> **self-signs its own claim.**

So "authorization by the parent" is, precisely:

1. **The parent vouches for the team** by handing the companion the `teamRootKey`. That is the
   capability. Possession of the link *is* the authorization to be in this team (same trust model as
   any human getting the invite link). The pairing flow + `expiresAt` just make that hand-off
   device-scoped and time-boxed.
2. **The companion derives and self-claims a per-team identity** on the phone:

   ```js
   // On the companion, after pairing, when the user enters a password:
   const { teamId } = await deriveTeamKeys(teamRootKey)
   const id = await deriveIdentity(teamId, username, password /*, joinSecret? */) // Argon2id (slow, spinner)
   const roster = teamManager.getRoster(teamId)

   // Two cases:
   const res = await roster.login({ username, identity: id })
   if (res.ok) {
     identity.setIdentity(teamId, { username, ...id })          // existing user, new device (same creds)
   } else if (res.reason === 'unclaimed') {
     const c = await roster.claim({                              // brand-new identity for this device
       username,                                                // e.g. "alice-phone" (suggestedUsername)
       displayName: deviceName ? `${username} (${deviceName})` : username,
       identity: id,
     })
     if (c.ok) identity.setIdentity(teamId, { username, ...id })
   } // res.reason === 'wrong-key' → wrong password; show error, no write.
   ```

   - **Same person, second device:** the user enters the *same* `username` + `password` they use on
     desktop. `deriveIdentity` re-derives the *same* Ed25519 key (it's deterministic and salted by
     `teamId` only — no stored salt), so `roster.login` matches the canonical winner and the phone
     shares the desktop identity. No new roster entry; presence/cursors are unified.
   - **Distinct device identity (recommended for audit):** the companion claims a *device-specific*
     username (`suggestedUsername`, e.g. `alice-phone`) with its own password. It appears in the
     roster as a separate signed member, `displayName: "alice-phone (Alice's iPhone)"`. This is a
     real, valid, self-signed claim — visible to all peers after reconcile — giving an honest audit
     trail of which devices are members.

   **Device tagging rides in `displayName`, never a new signed field.** `canonicalString()` covers a
   fixed byte order `[v|op|username|displayName|color|idPublicKey|createdAt]`. We do **not** add a
   `deviceType` field, because anything outside that string isn't signed and would be trivially
   forgeable/strippable. The `(device)` suffix in `displayName` is the device marker; the `deviceId`
   lives in local creds for the companion's own bookkeeping.

3. **(Optional, honest) Parent-side awareness of the device.** If we want the parent to *show* "this
   device was paired," the parent records `{deviceId, deviceName, at}` in its own local settings at
   pairing time. This is **not** a security control (it's not signed into the roster under the
   companion's key and grants nothing); it's a UX log. Real revocation is below.

### 2.5 The hard linking gate

On every launch the companion runs a gate **before** any note UI:

```js
async function checkPairingCredentials() {
  const raw = localStorage.getItem('mobile_pairing_creds') // or window.api.getSettings
  if (!raw) return showLinkingScreen(), false
  try {
    const creds = JSON.parse(raw)                          // { teamRootKey, teamId, deviceId, expiresAt, deviceName }
    if (!creds.teamRootKey) throw new Error('no key')
    if (creds.expiresAt && Date.now() > creds.expiresAt) throw new Error('expired')
    return creds
  } catch { return showLinkingScreen(), false }
}
```

- **Absent / malformed / expired creds → Link screen, hard stop.** No team list, no notes, no swarm
  connection. `bootstrap()` returns early.
- **Valid creds → proceed:** `deriveTeamKeys` → `joinTeam(rootKey)` → unlock-identity prompt → notes.

> Note on `expiresAt`: it gates the **pairing link** (a leaked link is useless after 72h). Once the
> companion has *consumed* the link and stored `teamRootKey`, the credential is a long-lived team
> capability (same as a desktop member). The stored `expiresAt` is retained only for UI ("paired on
> …") and for re-pair flows; it does not auto-lock a working install. (Auto-expiry of stored creds
> is a later hardening pass — see roadmap.)

### 2.6 Honest security tradeoffs of a link-borne team key

These must be surfaced in the Link screen UI copy and in user docs:

- **The pairing link contains the team's whole capability.** Anyone who intercepts the link before
  `expiresAt` can join the team and read everything (same blast radius as leaking a `notionless-team:`
  invite). Mitigation: short expiry (72h), share over a trusted channel, and prefer the device-
  specific claim so a stolen *device* is at least distinguishable in the roster.
- **`teamRootKey` is a static capability — it cannot be revoked.** Removing a compromised phone's
  *access to the team* means **rotating the team** (create a new team, re-share the new link, abandon
  the old). What *can* be done short of rotation: the device's **roster identity** is just a member;
  there is no per-member revocation in the current model either (honest limit R9). Document this
  plainly: "linking a phone is as trust-significant as inviting a person."
- **`mobile_pairing_creds` is not encrypted at rest on web.** On a PWA, `localStorage`/IndexedDB are
  the only options; an exfiltrated device exposes the team key (same as desktop settings). Mitigation
  path is the Capacitor secure-storage pass (roadmap), not v1.
- **Offline password guessing against the roster (R5).** Anyone with the link can read the roster and
  brute-force a member's password offline. Argon2id-MODERATE + a strength meter raise the bar; an
  optional `joinSecret` mixed into the id-salt raises it further. The companion's password is the
  *only* thing protecting its identity, so the strength meter is enforced on the companion claim
  screen exactly as on desktop.
- **Awareness/presence is plaintext (R3).** A relay operator can see *that* a device is editing
  (cursor labels), never *what* (content rides E2EE on the transport doc). Unchanged by the
  companion.
- **Backdated-claim squatting (R3).** `createdAt` is self-asserted, so a malicious peer could
  backdate a claim to squat a username label. It still cannot impersonate the real holder at login
  (needs the password) and grants no extra access (everyone has the link). The roster governs display
  identity, not access.

---

## 3. Leaf Foreground-Only Sync (reusing `openP2PDoc`)

The companion reuses the **exact** `openP2PDoc` chokepoint — no new sync path.

```js
// engine.js — REAL signature, do not re-implement:
openP2PDoc({ docId, swarmKey, e2eeKey, identity, replicaOnly })
//   → new DocumentEngine(docId)
//   → setupE2EE(e2eeKey)        // builds transportDoc + encrypt/decrypt observers (R1: BEFORE connect)
//   → connectP2P(swarmKey)      // P2PNetwork binds WebRTC provider to transportDoc when isEncrypted
//   → set presence/awareness from `identity` ({ id, name, color, email })
```

### 3.1 Open the team root

```js
const keys = await deriveTeamKeys(teamRootKey)               // { teamId, teamDocId, swarmKey, e2eeKey }
await p2pTeamManager.joinTeam(teamRootKey)                   // internally _openRoot → openP2PDoc(root); returns { teamId, name }
// roster + note tree arrive over the swarm; identity unlock is a separate step (§2.4)
```

`P2PTeamManager.joinTeam` already routes the root doc through `openP2PDoc` and persists the team to
`p2p_teams` settings (web mock = localStorage). The companion calls it unchanged.

### 3.2 Open a note (on tab open)

```js
const engine = await p2pTeamManager.openNote(teamId, noteId) // derives noteSwarmKey/noteE2EEKey (or unwraps ACL) → openP2PDoc
```

Restricted notes resolve their content key via `e2ee.unwrapKeyForIdentity(acl[myPubKey], myPubKey,
myPrivKey)`; if the companion's pubkey isn't in the note's ACL, the note stays opaque (correct).

### 3.3 Foreground/background lifecycle (the leaf discipline)

WebRTC teardown on backgrounding is **not automatic** — the companion must drive it. Wire OS/visibility
events to the engines:

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // background: stop the mesh, keep transport docs + IndexedDB subscribed
    forEachOpenEngine(e => e.disconnectP2P())   // engine.js — tears down P2PNetwork, sets p2p:'disconnected'
  } else {
    // foreground: re-open the swarm for the team root + any open note tabs
    reconnectOpenDocs()                          // re-run openP2PDoc for active docId/swarmKey/e2eeKey
  }
})
```

- On Android/iOS PWA, `visibilitychange` + `pagehide`/`pageshow` are the hooks; under a later
  Capacitor wrap, use the native App `pause`/`resume` events to the same effect.
- Offline edits accumulate in IndexedDB and merge automatically on the next foreground reconnect
  (Yjs CRDT). No conflict UI is needed.
- The companion **never** opens `replicaOnly` docs and `_reconcileReplicas` stays a web no-op.

### 3.4 Relay/config constraint (must match the parent)

`Config.SIGNALING_URL` (`VITE_SIGNALING_URL`, default `wss://oss.naridon.com/signaling`) and the room
hashing (`BLAKE2b(swarmKey)`) are deterministic across devices, but **there is no relay federation**.
The mobile build MUST ship the **same** `VITE_SIGNALING_URL` as the desktop fleet or peers never meet.
Bake it at build time (`.env`); document it.

---

## 4. PWA Packaging Plan

Mirror the dev-only web build (`src/renderer/web/` + `vite.web.config.mjs` + `dist-web/`) into a
parallel **mobile** target. Everything additive; nothing touches the desktop or existing web build.

### 4.1 `vite.mobile.config.mjs` (new, parallel to `vite.web.config.mjs`)

Same structure as the web config, with these deltas:

- `root: 'src/renderer/mobile'`
- `base: process.env.VITE_PUBLIC_BASE || './'` (installable, relative asset paths)
- `resolve.alias`: identical — `@ → src/renderer/src`, plus the `@sentry/electron/renderer` mock.
- `optimizeDeps`: identical (isomorphic-git web interop).
- `build.outDir: '../../../dist-mobile'`, `emptyOutDir: true`.
- `build.rollupOptions.input`: `src/renderer/mobile/mobile.html` (NOT `index.html`); keep the same
  `manualChunks` (yjs / markdown / git).

### 4.2 `src/renderer/mobile/mobile.html` (new)

Copy `src/renderer/index.html`, then add mobile/PWA head tags and point the script at the mobile
entry:

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- `<meta name="theme-color" content="#ffffff">`
- `<link rel="manifest" href="./manifest.webmanifest">`
- script: `./mobile-main.js`

### 4.3 `src/renderer/mobile/mobile-main.js` (new, ~350 lines)

> **Critical:** the `window.api` mock must be present **synchronously at page load** (early module
> guards read it). Do **not** `import` it from `web-main.js` lazily — **copy** the mock into this file
> (or extract a shared, eagerly-imported `web-api-mock.js` that both `web-main.js` and `mobile-main.js`
> import at the top; either is fine as long as it's eager). Structure:

```js
// 1) Install the full window.api mock (localStorage settings + IndexedDB snapshots + git shim + stubs)
// 2) Mark the surface:
document.body.classList.add('is-mobile')   // NOT 'is-web' — see §4.5 (mobile wants full offline)
// 3) Hard gate:
async function bootstrap() {
  const creds = await checkPairingCredentials()      // §2.5
  if (!creds) return                                 // Link screen already shown; stop.
  await fileSystem.init()
  // hydrate identity profile / team list, then hand off to the shared renderer:
  await import('../src/main.js')
}
bootstrap()
```

Plus: `showLinkingScreen()` (paste-link input + "Paste from clipboard"; QR button hidden/deferred),
`consumePairingLink(text)` (parse `notionless-pair:` or `notionless-team:`, verify `expiresAt`,
re-derive + verify `teamId`, store `mobile_pairing_creds`, then `bootstrap()`), and the
visibility/foreground wiring from §3.3.

### 4.4 PWA assets

- `src/renderer/mobile/manifest.webmanifest`: `name`/`short_name` "Paperus", `start_url: "./"`,
  `display: "standalone"`, `scope: "./"`, `background_color`/`theme_color`, `orientation:
  "portrait-primary"`, and 192/512 icons.
- `src/renderer/mobile/service-worker.js`: minimal v1 — `skipWaiting`/`clients.claim` + a
  network-first fetch with an offline fallback. Keep it tiny; **do not** aggressively cache the app
  shell in a way that strands a user on a stale build after a team-key rotation. Registered from
  `mobile-main.js` only in production.
- Icons: add `icon-192.png` / `icon-512.png` under `src/renderer/mobile/` (or reference shared
  assets).

### 4.5 The one shared-renderer change (`is-mobile` ≠ `is-web`)

`engine.js:46` sets `isWebClient = body.classList.contains('is-web')` and **skips IndexedDB** for web
thin-clients. The companion is **not** a thin client — it *needs* offline IndexedDB. So:

- `mobile-main.js` adds **`is-mobile`** (never `is-web`), so `isWebClient` stays false and IndexedDB
  persistence stays on.
- Audit the other `is-web` guards and decide per call-site whether mobile should match. Most should
  **not** (mobile wants the full path); `p2p.js:220` (skip `ws://localhost:4444`) is one mobile
  *should* match — extend that check to `is-web || is-mobile` so the phone doesn't try the desktop's
  local signaling port. Where a guard genuinely means "browser, no Electron `window.api`," prefer a
  capability check (`!window.api?.send`) over a class check so both web and mobile are covered without
  forcing `is-web`.

> This is the single deliberate edit to shared renderer code. It's additive and gated; it does not
> change desktop or the existing web build behavior.

### 4.6 `package.json` scripts (additive)

```json
"dev:mobile":     "vite --config vite.mobile.config.mjs --host",
"build:mobile":   "vite build --config vite.mobile.config.mjs",
"preview:mobile": "vite preview --config vite.mobile.config.mjs"
```

`--host` exposes the dev server on the LAN so a phone can load it for testing against the relay.

### 4.7 Desktop "Link a device" entry point (parent side)

So a parent can mint a payload (full desktop spec — implement in a follow-up slice, designed here):

- **Sidebar button** `#link-device-btn` (`<div class="sidebar-item"><i class="fas fa-link"></i> Link
  a device</div>`), wired like the existing `join-team-btn` / `create-team-btn`: `addEventListener
  → dispatchEvent(new CustomEvent('cmd:link-device'))`.
- **Listener** in `main.js` (next to `cmd:join-team`): opens a new `openLinkDeviceDialog(manager,
  teamId)` in `team-dialogs.js`, modeled on `openInviteDialog` (reuse `.td-box`/`.td-linkbox`/
  `.td-btn`).
- Dialog: pick a team → `generatePairingPayload(teamId)` (new `P2PTeamManager` method:
  `getKeys(teamId).teamRootKey` + mint `deviceId` + `expiresAt = now + 72h` → JSON → base64url →
  `notionless-pair:` string) → show copyable code + "expires in 72h" + Copy button. QR deferred.

---

## 5. File Plan

| Action | Path | Responsibility |
|---|---|---|
| create | `vite.mobile.config.mjs` | Parallel Vite config: `src/renderer/mobile` root, `dist-mobile` out, `mobile.html` input, `@`→`src/renderer/src`, relative base. |
| create | `src/renderer/mobile/mobile.html` | Mobile/PWA HTML shell (viewport + apple-web-app + theme-color + manifest link), loads `mobile-main.js`. |
| create | `src/renderer/mobile/mobile-main.js` | Companion bootstrap: eager `window.api` mock, `is-mobile` class, **hard pairing gate**, Link screen, pairing-link consume, foreground/background wiring, then `import('../src/main.js')`. |
| create | `src/renderer/mobile/manifest.webmanifest` | Installable PWA manifest (name, standalone, scope, icons, theme). |
| create | `src/renderer/mobile/service-worker.js` | Minimal offline shell SW (`skipWaiting`/`claim` + network-first); registered in prod only. |
| create | `src/renderer/mobile/icon-192.png`, `icon-512.png` | PWA icons (or symlink/reference shared assets). |
| create | `src/renderer/mobile/web-api-mock.js` *(optional)* | Extracted eager `window.api` mock shared by `web-main.js` + `mobile-main.js` (alternative to copy-paste). |
| edit | `src/renderer/src/engine.js` | Treat `is-mobile` as a **full** client: ensure `isWebClient`/IndexedDB-skip does **not** trigger for `is-mobile` (keep offline persistence on). |
| edit | `src/renderer/src/p2p.js` | Extend the local-signaling skip (`is-web`) to also cover `is-mobile` so the phone doesn't dial `ws://localhost:4444`. |
| edit | `package.json` | Add `dev:mobile` / `build:mobile` / `preview:mobile` scripts. |
| edit *(parent slice)* | `src/renderer/src/p2p-team.js` | Add `generatePairingPayload(teamId)` → `notionless-pair:` string (rootKey + deviceId + expiry), and `consumePairingPayload(text)` parse helper. |
| edit *(parent slice)* | `src/renderer/src/p2p.js` | Add `buildPairingPayload`/`parsePairingPayload` (`notionless-pair:` ⇄ JSON), sibling to `buildTeamLink`/`parseTeamCode`. |
| edit *(parent slice)* | `src/renderer/src/main.js` | Add `#link-device-btn` markup + listener dispatching `cmd:link-device`, and a `cmd:link-device` handler opening the dialog. |
| edit *(parent slice)* | `src/renderer/src/team-dialogs.js` | Add `openLinkDeviceDialog(manager, teamId)` (mirror `openInviteDialog`): show pairing code, expiry, Copy. |
| edit *(parent slice)* | `src/renderer/src/style.css` *(optional)* | Mobile CSS pass (≥48px touch targets) — cosmetic, not architectural. |

> **No file under `src/renderer/src/` is rewritten.** The only mandatory shared-renderer edits are
> the two small, additive guards in `engine.js` and `p2p.js` (§4.5). The "parent slice" rows are the
> desktop "Link a device" affordance and can land in a separate PR after the companion shell.

---

## 6. Phased Roadmap

**Phase 0 — Foundation slice (this doc):**
- `vite.mobile.config.mjs`, `mobile.html`, `mobile-main.js`, manifest, SW, icons.
- Hard pairing gate + Link screen + paste-link consume.
- `is-mobile` class + the two guard edits (`engine.js`, `p2p.js`).
- Reuse `joinTeam` → `openP2PDoc` for root + notes; foreground/background lifecycle.
- Companion identity = self-derived + self-claimed/login against `team-roster.js`.
- Build scripts. (Parent "Link a device" dialog can ship alongside or immediately after.)

**Phase 1 — Pairing ergonomics:**
- Desktop "Link a device" dialog finalized (`openLinkDeviceDialog`) + `generatePairingPayload`.
- **QR codes** (display on desktop, scan on phone) — add a QR lib *then* (first dependency we accept),
  with the text link remaining the fallback.

**Phase 2 — Native wrap (Capacitor):**
- Wrap the same `dist-mobile` PWA in Capacitor (no renderer rewrite).
- Register the `notionless://pair` / `notionless-pair:` deep-link handler natively (web can't reliably
  intercept custom schemes; this makes one-tap pairing real).
- Use native App `pause`/`resume` for the foreground/background discipline (§3.3).

**Phase 3 — Encrypted-at-rest credentials:**
- Store `mobile_pairing_creds` + the optional identity cache in OS secure storage (iOS Keychain /
  Android Keystore via Capacitor), replacing plaintext `localStorage`. Optional "stay signed in"
  backed by password-encrypted IndexedDB for the private key.

**Phase 4 — Availability + push (later, optional):**
- Opportunistic background sync / push-to-wake is **out of scope** for the leaf model and only makes
  sense paired with the optional self-hosted persisting cloud mirror (`VITE_CLOUD_SYNC_URL`) so a
  phone can catch up with no peer online. Revisit only if/when that mirror is a supported deployment.

---

## 7. Invariants the build MUST preserve

1. **R1 — E2EE before transport.** Only ever open P2P docs via `openP2PDoc`; never call `connectP2P`
   without `setupE2EE` first. (The chokepoint enforces it; don't hand-wire engines.)
2. **Roster self-signing.** The companion signs its **own** claim with its **own** derived key; never
   attempt a "parent-signed claim for the companion's key" — `validateOp` would (correctly) reject it.
3. **No new signed roster fields.** Device tagging lives in `displayName`; `canonicalString` is
   untouched.
4. **Private key never to disk** (`identity.js` R4) — memory-only on the phone in v1.
5. **Same `VITE_SIGNALING_URL` as the desktop fleet** — no relay federation.
6. **Leaf, not replica** — foreground-only, no background replication, no disk projection.
7. **Additive only** — desktop app and existing dev-only web build behavior unchanged.

---

## 8. Foundation build status (Phase 0 — implemented)

The Phase-0 foundation is built and verified. **Actual file paths differ from §5's plan**:
the mobile entry/UI/CSS shipped under `src/renderer/web/` (sibling to the existing
`web-main.js`), not `src/renderer/mobile/`. The PWA shell (`mobile.html`) and assets
(`public/`) live at the repo root.

**Shipped + verified:**
- `src/renderer/src/device-link.js` — pairing protocol (pure, Node-importable). Covered by
  `tests/device-link.test.mjs` (**39 assertions, green**; wired as `npm run test:devlink` and into `npm test`).
- `src/renderer/web/mobile-main.js` — PWA entry: `window.api` mock (IndexedDB/localStorage), the
  **hard pairing gate** (inert until linked), `is-mobile` body tag (keeps IndexedDB on), a leaf
  replication no-op guard, team pre-seed, foreground/background lifecycle, SW registration, and
  `mobile.css` load (after the renderer's `style.css`).
- `src/renderer/web/mobile-link-screen.js` — the gate UI. Now **cryptographically verifies** via
  `verifyPairingPayload` (re-derives `teamId` from the secret → rejects a tampered hint; enforces expiry)
  before booting, not just structural parse.
- `src/renderer/src/device-link-dialog.js` — desktop "Link a device" dialog (link-only for v1).
- `vite.mobile.config.mjs` + `mobile.html` + `public/{manifest.webmanifest,sw.js,icon-192.png,icon-512.png}`
  — installable PWA. Icons generated from `build/icon.png` via `sips`. `start_url` = `./mobile.html`.
- `src/renderer/web/mobile.css` — responsive overrides, scoped under `body.is-mobile`.
- Wiring: `package.json` (`dev:mobile`/`build:mobile`/`preview:mobile`), a `#link-device-btn` in the
  Teams sidebar header → `cmd:link-device` → `openDeviceLinkDialog`.

**Shared-renderer guards added during the audit (additive):**
- `p2p.js` — the `localhost:4444` signaling skip now also excludes `is-mobile` (was `is-web` only); a
  phone always uses the relay. (R5/§3.4.)
- `engine.js` — `connectP2P` now records `this._lastSwarmKey` so a disconnected leaf engine can be
  reconnected on foreground. (`engine.js` already keeps IndexedDB on for `is-mobile` — no change needed.)

**Verified:** `build:mobile` ✓, `build:web` ✓ (regression-free), `test:devlink`/`test:crypto`/`test:brain` ✓.

**Deferred follow-ups (not yet built):**
- **Foreground note-tab reconnect** — `wireForegroundLifecycle` only reaches `rootEngine` + `replicas`;
  open note-tab engines are not torn down/reconnected on background→foreground. (Task #31.)
- **Pairing channel** — the desktop dialog shows a static "Waiting for companion…"; no live
  "companion connected" handshake yet.
- **QR scanning** (§6), **encrypted-at-rest creds** (creds are plaintext `localStorage` until the
  Capacitor pass), **Capacitor wrap + `notionless://pair` deep-link handler**.
