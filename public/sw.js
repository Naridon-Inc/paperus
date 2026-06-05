/*
 * Notionless Companion — minimal PWA service worker (v1).
 *
 * Goal: just enough offline app-shell so the installed PWA opens with no network.
 * NO fancy strategies, NO runtime caching of note content (notes live in the
 * Yjs/IndexedDB layer, not here), NO precaching of hashed JS/CSS bundles.
 *
 * Per MOBILE_COMPANION.md §4.4: deliberately do NOT aggressively cache the app
 * shell in a way that strands a user on a stale build (e.g. after a team-key
 * rotation). So we use network-first for navigations and fall back to the cached
 * shell only when offline. Bump CACHE_NAME on every release to evict the old
 * shell.
 *
 * This file lives in public/ and is copied verbatim to the dist-mobile output
 * root. mobile-main.js registers it (production only) at scope './'.
 */

const CACHE_NAME = 'notionless-companion-shell-v1';

// The minimal app shell. Only the entry HTML + the manifest — the hashed bundles
// are fetched network-first and are not precached (avoids stale-build lock-in).
const SHELL_ASSETS = [
  './',
  './mobile.html',
  './manifest.webmanifest'
];

// Install: precache the shell, then take over immediately.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // addAll is atomic; a missing asset (e.g. icons not yet generated) would
      // reject install, so we add individually and ignore per-asset failures.
      .then((cache) => Promise.all(
        SHELL_ASSETS.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate: drop old shell caches, then claim open clients.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first with an offline cache fallback. Only handle same-origin
// GETs; everything else (the WebRTC relay, signaling, cross-origin) passes
// straight through untouched.
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache a copy of successful basic responses so they survive going
        // offline. Opaque/error responses are left alone.
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        // Navigations that miss the cache fall back to the app shell so the PWA
        // still boots offline.
        if (request.mode === 'navigate') {
          return caches.match('./mobile.html') || caches.match('./');
        }
        return Response.error();
      }))
  );
});
