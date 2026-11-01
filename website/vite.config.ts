/// <reference types="vitest/config" />
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * A strict content security policy for the built page only (Vite's dev server injects inline
 * styles for hot reload). Everything is same-origin: no third-party scripts, fonts or analytics.
 */
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
  return {
    name: 'devdock-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="utf-8" />',
        `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      ),
  }
}

export default defineConfig({
  // Relative URLs: the same build works at a domain root or under a sub-path.
  base: './',
  plugins: [csp()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // Two pages: the home page and the Downloads page (served at /downloads, see vercel.json).
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        downloads: resolve(import.meta.dirname, 'downloads.html'),
      },
    },
  },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
})
