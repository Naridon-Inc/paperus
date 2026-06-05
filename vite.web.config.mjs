import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'

export default defineConfig({
  root: 'src/renderer/web',
  // Dev-only build (no hosted web app — Notionless ships as a desktop app).
  // Relative base so `dist-web` can be opened/served from any path for local
  // collaboration/sync testing against the relay.
  base: process.env.VITE_PUBLIC_BASE || './',
  plugins: [
    nodePolyfills()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer/src'),
      '@sentry/electron/renderer': path.resolve(__dirname, 'src/renderer/web/mock-sentry.js')
    }
  },
  // isomorphic-git + @isomorphic-git/lightning-fs (CommonJS) need Buffer/process/
  // global in the browser. vite-plugin-node-polyfills (above) already injects
  // those globals by default, so no extra polyfill config is needed here.
  // We only pre-bundle the git deps so esbuild handles the CJS<->ESM interop.
  optimizeDeps: {
    include: ['isomorphic-git', 'isomorphic-git/http/web', '@isomorphic-git/lightning-fs']
  },
  build: {
    outDir: '../../../dist-web',
    emptyOutDir: true,
    rollupOptions: {
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
