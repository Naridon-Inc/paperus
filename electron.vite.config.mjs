import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // Externalize every package.json dependency (electron-vite's default). This is
    // the only reliable way to keep the NATIVE better-sqlite3 out of the bundle: its
    // prebuilt `.node` must load from node_modules at runtime, and a
    // `rollupOptions.external` matcher misses it because vite's CJS interop resolves
    // the entry before rollup's external hook runs, so it gets bundled anyway.
    // COST: an externalized CommonJS dep is emitted as a raw ESM
    // `import { x } from 'cjs-pkg'`, which Node rejects for any named export it can't
    // statically detect — electron-updater (`autoUpdater`), mailparser
    // (`simpleParser`), imapflow (`ImapFlow`). Those three are imported via
    // default-import-then-destructure at their source. (uuid, @electron-toolkit/utils
    // and ws expose ESM or cjs-lexer-detectable named exports, so they stay as-is.)
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [
      // React Fast Refresh + automatic JSX runtime, scoped to the island tree
      // ONLY. The vanilla renderer keeps its plain esbuild + full-reload path.
      // Match ANY file under react/ (no extension anchor — build-time module ids
      // can carry query suffixes that broke a `\.(jsx|js)$` match, which silently
      // dropped mount.js/IslandApp to esbuild's classic `React.createElement`).
      react({ include: [/src\/renderer\/src\/react\//] }),
      nodePolyfills()
    ],
    // Backstop: any JSX that esbuild (not plugin-react) ends up transforming must
    // also use the automatic runtime, so a missed include can never reintroduce a
    // bare `React.createElement` with no React in scope (Inbox/Email/IslandApp).
    esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
    optimizeDeps: {
      include: [
        '@lezer/highlight',
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@codemirror/commands',
        '@codemirror/lang-markdown',
        '@codemirror/language-data',
        '@codemirror/search',
        '@codemirror/autocomplete',
        'y-codemirror.next',
        'react',
        'react-dom',
        'react-dom/client',
        '@medusajs/ui',
        '@medusajs/icons'
      ]
    }
  }
})
