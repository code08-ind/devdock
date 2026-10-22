import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test'

const root = join(import.meta.dirname, '../..')

export interface Launched {
  app: ElectronApplication
  /** The main window (not the palette window, which may open first). */
  win: Page
  userData: string
  /** Console errors and page errors seen in the main window. */
  errors: string[]
}

export const newProfile = () => mkdtempSync(join(tmpdir(), 'devdock-e2e-'))

/** Launches the built app (`out/`) against `userData`, a throwaway profile by default. */
export async function launch(userData = newProfile()): Promise<Launched> {
  const app = await _electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, DEVDOCK_E2E: '1', DEVDOCK_USER_DATA: userData },
  })
  const win = await windowFor(app, 'index.html')
  const errors: string[] = []
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.locator('nav[aria-label="Main"]').waitFor()
  return { app, win, userData, errors }
}

/** Window order at launch isn't stable, so find windows by page. */
export async function windowFor(
  app: ElectronApplication,
  page: 'index.html' | 'palette.html',
): Promise<Page> {
  const matches = (p: Page) => p.url().endsWith(`/${page}`)
  return app.windows().find(matches) ?? app.waitForEvent('window', { predicate: matches })
}

export async function openSettings(win: Page): Promise<void> {
  await win
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Settings' })
    .click()
  await win.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
}

/** Every regular file under `dir`, recursively (skips Chromium's Singleton* symlinks). */
export function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return entry.isFile() ? [path] : []
  })
}

/** Main-process test hook installed when DEVDOCK_E2E=1 (see src/main/index.ts). */
interface TestHook {
  togglePalette(): void
  isPaletteVisible(): boolean
  shortcutStatus(): { ok: boolean; accelerator: string; reason?: string }
}

export function callHook<K extends keyof TestHook>(
  app: ElectronApplication,
  name: K,
): Promise<ReturnType<TestHook[K]>> {
  return app.evaluate(
    (_electron, method) =>
      (globalThis as unknown as { __devdockTest: TestHook }).__devdockTest[method](),
    name,
  ) as Promise<ReturnType<TestHook[K]>>
}

/** One fresh app and profile per test; both cleaned up afterwards. */
export const test = base.extend<{ launched: Launched }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure.
  launched: async ({}, use) => {
    const launched = await launch()
    try {
      await use(launched)
    } finally {
      // A test may already have closed the app (e.g. to read files Windows keeps locked).
      await launched.app.close().catch(() => undefined)
      rmSync(launched.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  },
})

export { expect } from '@playwright/test'
