import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Config touch to force restart
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron-settings', 'write-file-atomic', 'mkdirp', 'fs-extra']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [
      nodePolyfills()
    ],
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
        'y-codemirror.next'
      ]
    }
  }
})
