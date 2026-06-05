import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  base: './',
  resolve: {
    alias: {
      '@': resolve(here, '../../src/renderer/src'),
    },
  },
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
})
