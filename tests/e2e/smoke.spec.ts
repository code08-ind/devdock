import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test } from '@playwright/test'

/**
 * T16: packaged-app smoke test — the real app from a built DMG (no e2e hooks, no quiet mode:
 * its window shows). Opt-in: `DEVDOCK_SMOKE_APP=/Volumes/…/DevDock.app npx playwright test smoke`.
 * It uses the app's own data folder, so back that up first (the T16 steps in PROGRESS do).
 */
const appPath = process.env.DEVDOCK_SMOKE_APP
test.skip(!appPath, 'set DEVDOCK_SMOKE_APP to a packaged DevDock.app')

/** Process ids under `pid` (macOS/Linux `ps`). */
function descendants(pid: number): number[] {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number) as [number, number])
  const out: number[] = []
  const walk = (p: number) =>
    rows.filter(([, pp]) => pp === p).forEach(([c]) => (out.push(c), walk(c)))
  walk(pid)
  return out
}
const command = (pid: number) => {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

test('packaged app: demo mode, a real shell in the terminal, the AI preview; quit stops the shell', async () => {
  test.setTimeout(120_000)
  const app = await _electron.launch({
    executablePath: `${appPath}/Contents/MacOS/DevDock`,
    args: [],
  })
  const appPid = app.process().pid!
  // The main window may already be open (window order at launch isn't stable).
  const isMain = (p: { url(): string }) => new URL(p.url()).pathname.endsWith('/index.html')
  const win =
    app.windows().find(isMain) ?? (await app.waitForEvent('window', { predicate: isMain }))
  await win.locator('nav[aria-label="Main"]').waitFor()
  const nav = (label: string) =>
    win
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: label, exact: true })
      .click()

  // Packaged and in demo mode.
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  await expect(win.getByText('Demo mode', { exact: true })).toBeVisible()

  // The terminal runs the login shell.
  await nav('Terminal')
  const screen = win.locator('.terminal-screen:not([hidden]) .xterm')
  await expect(screen).toBeVisible()
  await screen.click()
  // The packaged app draws the terminal on the GPU (no DOM text): the shell writes a file instead.
  const marker = join(mkdtempSync(join(tmpdir(), 'devdock-smoke-')), 'ran.txt')
  await win.keyboard.type(`echo devdock-smoke-$((6*7)) > '${marker}'`)
  await win.keyboard.press('Enter')
  await expect
    .poll(() => (existsSync(marker) ? readFileSync(marker, 'utf8').trim() : ''), {
      timeout: 20_000,
    })
    .toBe('devdock-smoke-42')
  const shells = descendants(appPid).filter((p) => /(^|\/)-?(zsh|bash|fish|sh)$/.test(command(p)))
  expect(shells.length).toBeGreaterThan(0)

  // The AI preview (demo answers, nothing sent).
  await nav('Pull requests')
  await win
    .getByRole('button', { name: /^Summarise .* with Claude$/ })
    .first()
    .click()
  const ai = win.getByRole('dialog', { name: 'Summarise this pull request' })
  await expect(ai.getByText('Demo mode: a sample answer is made on this computer.')).toBeVisible()
  await ai.getByRole('button', { name: 'Send to Claude' }).click()
  await expect(ai.getByRole('status')).toContainText('Demo answer:', { timeout: 15_000 })
  await expect(ai).toContainText('(demo: not charged)')
  await ai.getByRole('button', { name: 'Close' }).click()

  // Quit: the shell goes with the app.
  await app.evaluate(({ app }) => app.quit())
  await expect.poll(() => shells.filter((p) => command(p) !== ''), { timeout: 15_000 }).toEqual([])
})
