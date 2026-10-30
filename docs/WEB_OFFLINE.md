# Offline self-hosted web app

The web build installs a service worker after its first successful HTTPS visit.
The installer downloads all static build dependencies (including lazy JavaScript
chunks and local icon fonts), validates their response types, and activates only
after installation completes. APIs, health checks, signaling and encrypted sync
are never served from the static cache. Runtime settings use network-first
fetching with an offline fallback. Cache names are isolated by application scope.

On iPhone, use Safari's **Share → Add to Home Screen**, launch from that icon,
and open the **Online/Offline** status panel to check offline readiness. A home-screen app may have separate storage from
a Safari tab; join the existing team there once if needed. Open important notes
before disconnecting. Previously downloaded document state and joined teams
survive browser restarts through IndexedDB and local settings.

Opening the app online, returning to the foreground, or regaining connectivity
starts a bounded sweep of closed team notes. Up to four encrypted note rooms per
team are processed concurrently, including older notes beyond the desktop replica
cap. Failed attempts retain local data and are retried while the app is visible.
Per-device cloud-sync opt-out and an absent cloud mirror disable this sweep.
Editor-owned notes are not falsely counted as acknowledged background transfers.

The offline panel separates application readiness from note transfer progress.
Keep the app open until its transfer completes. This is foreground web-app
synchronization: it does not implement native iOS background uploads while the
app is suspended or closed.

An update is downloaded before it becomes active. The user can accept a waiting
update using **Open updated version**, or close all clients so it can activate
normally. Older caches are retained while scoped windows may still use them and pruned
on an activation without open scoped clients.
A failed rollback/reinstall preserves an already-existing cache of that version.

## Storage and security

Readable documents may be stored as plaintext on the device, as with the existing
desktop engine. Encrypted transport state is also persisted locally. Team root
keys remain in local settings under the existing browser-at-rest trust model.
Only the encrypted transport is sent to the relay; this change does not alter
key derivation, signatures, AEAD binding, or server-side decryption capabilities.
Clearing website data removes local notes and team access. Browser eviction and
storage quota limits still apply. Synchronization is not an independent backup.

The static-host default `nlconfig.js` is replaced by the Docker entrypoint when
instance settings are available. The service worker and install metadata must
remain revalidatable; do not configure immutable caching for `sw.js`.

## Regression tests

Run `pnpm run test:web-offline` for dependency-free fault-injection tests. See
`tests/browser/README.md` for real browser restart, offline editing and closed-note
upload tests against an isolated local relay.
