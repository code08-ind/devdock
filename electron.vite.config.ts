import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { CSP_DEV, CSP_PROD } from './src/main/security'

/** The app loads from file:// in production, where response headers don't apply: inject a meta CSP. */
function cspMeta(): Plugin {
  let csp = CSP_PROD
  return {
    name: 'devdock-csp-meta',
    configResolved(config) {
      csp = config.command === 'serve' ? CSP_DEV : CSP_PROD
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

const shared = resolve(import.meta.dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rolldownOptions: {
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      // Sandboxed preloads must be a single CommonJS file that only requires 'electron'.
      externalizeDeps: false,
      rolldownOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(import.meta.dirname, 'src/renderer'),
      },
    },
    plugins: [cspMeta(), react()],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          palette: resolve(import.meta.dirname, 'src/renderer/palette.html'),
        },
      },
    },
  },
})
