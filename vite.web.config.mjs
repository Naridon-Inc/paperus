import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: 'src/renderer/web',
  // Dev-only build (no hosted web app — Notionless ships as a desktop app).
  // Relative base so `dist-web` can be opened/served from any path for local
  // collaboration/sync testing against the relay.
  base: process.env.VITE_PUBLIC_BASE || './',
  plugins: [
    // React islands (Tasks/Calendar/Inbox/Email) use the automatic JSX runtime —
    // scope the plugin to react/** so the vanilla renderer keeps esbuild's plain
    // pipeline. Mirrors electron.vite.config.mjs so both builds behave identically.
    react({ include: [/src\/renderer\/src\/react\//] }),
    nodePolyfills()
  ],
  // Backstop so any JSX esbuild handles (a missed plugin-react include) still uses
  // the automatic runtime instead of a bare `React.createElement`.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
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
