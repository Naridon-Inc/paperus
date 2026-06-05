import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'

// Mobile companion (PWA) build — parallel to vite.web.config.mjs.
//
// The companion is the SAME vanilla-JS renderer (src/renderer/src) booted as an
// installable PWA with a mocked window.api over IndexedDB/localStorage, gated by
// the hard pairing flow. Per MOBILE_COMPANION.md it is a *leaf* peer, never a
// relied-upon replica. This config only wires the bundler; it touches neither the
// desktop build nor the existing dev-only web build.
//
// Conventions mirrored from vite.web.config.mjs:
//   - `@` alias points at the shared renderer (src/renderer/src) so the mobile
//     entry imports the exact same modules as Electron and web.
//   - relative `base` so dist-mobile can be served from any path (and works once
//     wrapped in Capacitor with a file:// origin).
//   - dedicated dist output (dist-mobile), emptied on build.
//
// Deltas vs the web config:
//   - root is the repo root (not src/renderer/web) because the mobile HTML entry
//     and PWA assets (public/) live at the repo root for this foundation slice.
//   - input is mobile.html (not index.html).
//   - output is dist-mobile (not dist-web).
//   - public/ (manifest.webmanifest + sw.js + icons) is copied verbatim to the
//     build output via Vite's default publicDir handling.
export default defineConfig({
  root: '.',
  // Relative base so the installable PWA resolves assets regardless of the path
  // it is served from (and under a future Capacitor file:// wrap).
  base: process.env.VITE_PUBLIC_BASE || './',
  // public/ at the repo root holds the PWA assets (manifest, service worker,
  // icons). Vite copies its contents to the build output root as-is.
  publicDir: 'public',
  plugins: [
    nodePolyfills()
  ],
  resolve: {
    alias: {
      // Identical to the web build: the mobile entry imports the shared renderer.
      '@': path.resolve(__dirname, 'src/renderer/src'),
      '@sentry/electron/renderer': path.resolve(__dirname, 'src/renderer/web/mock-sentry.js')
    }
  },
  // isomorphic-git + @isomorphic-git/lightning-fs (CommonJS) need Buffer/process/
  // global in the browser. vite-plugin-node-polyfills (above) injects those
  // globals; we only pre-bundle the git deps so esbuild handles CJS<->ESM interop.
  // Kept identical to the web build for parity.
  optimizeDeps: {
    include: ['isomorphic-git', 'isomorphic-git/http/web', '@isomorphic-git/lightning-fs']
  },
  build: {
    outDir: 'dist-mobile',
    emptyOutDir: true,
    rollupOptions: {
      // Entry is the mobile PWA shell (NOT index.html). It loads the mobile
      // bootstrap which installs the window.api mock + the hard pairing gate.
      input: path.resolve(__dirname, 'mobile.html'),
      output: {
        manualChunks: {
          yjs: ['yjs', 'y-websocket', 'y-codemirror.next', 'y-indexeddb'],
          markdown: ['showdown', 'turndown'],
          git: ['isomorphic-git', '@isomorphic-git/lightning-fs']
        }
      }
    }
  }
})
