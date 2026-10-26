import { defineConfig } from '@playwright/test'

/**
 * Runs against the built site served by `vite preview` (run `npm run build` first, or `npm run e2e`).
 * PW_CHANNEL=chrome uses an installed Google Chrome instead of Playwright's own Chromium
 * (`npx playwright install chromium`).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    channel: process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
