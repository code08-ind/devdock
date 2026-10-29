import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { callHook, expect, launch, newProfile, openSettings, showView, test } from './fixtures'

/** P7-A: DevDock's own terminal on a real PTY running the user's shell. */
let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

/** The active tab's buffer (scrollback included), from the renderer's e2e hook. */
const screen = (win: Page) =>
  win.evaluate(
    () =>
      (window as unknown as { __devdockTerminal: { text(): string } }).__devdockTerminal.text() ??
      '',
  )
/** A line that is exactly `text` (the echoed command line also contains it, with a prompt). */
const hasLine = async (win: Page, text: string) =>
  (await screen(win)).split('\n').some((l) => l.trim() === text)

async function typeLine(win: Page, line: string): Promise<void> {
  await win.locator('.terminal-screen:not([hidden]) .xterm').click()
  await win.keyboard.type(line)
  await win.keyboard.press('Enter')
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('terminal: runs a command in the login shell; closing the tab stops the shell', async ({
  launched,
}) => {
  test.setTimeout(60_000)
  const { app, win, errors } = launched
  await showView(win, 'Terminal')
  const tabs = win.getByRole('tablist', { name: 'Terminals' })
  // The first visit opens one in the home folder.
  await expect(tabs.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => callHook(app, 'terminalPids'), { timeout: 15_000 }).toHaveLength(1)
  const [pid] = await callHook(app, 'terminalPids')

  await typeLine(win, 'echo devdock-ok')
  await expect.poll(() => hasLine(win, 'devdock-ok'), { timeout: 15_000 }).toBe(true)

  // Another view and back: the tab, its shell and its scrollback are still there.
  await showView(win, 'Today')
  await showView(win, 'Terminal')
  expect(await hasLine(win, 'devdock-ok')).toBe(true)
  expect(await callHook(app, 'terminalPids')).toEqual([pid])

  // The theme's palette reaches xterm (System → light here, then Slate).
  await win.evaluate(() => window.devdock.settings.update({ appearance: { theme: 'slate' } }))
  await expect
    .poll(() =>
      win.evaluate(
        () =>
          getComputedStyle(document.querySelector('.terminal-screen .xterm-scrollable-element')!)
            .backgroundColor,
      ),
    )
    .toBe('rgb(34, 39, 46)')

  // F6 leaves the terminal (Tab is the shell's): focus lands outside it.
  await win.locator('.terminal-screen:not([hidden]) .xterm').click()
  await win.keyboard.press('F6')
  expect(
    await win.evaluate(() => document.activeElement?.closest('.terminal-screen') == null),
  ).toBe(true)

  // Two more tabs: Delete on a tab closes it, and so does its × (mouse).
  await win.getByRole('button', { name: 'New terminal' }).click()
  await win.getByRole('button', { name: 'New terminal' }).click()
  await expect(tabs.getByRole('tab')).toHaveCount(3)
  await tabs.getByRole('tab', { selected: true }).focus()
  await win.keyboard.press('Delete')
  await expect(tabs.getByRole('tab')).toHaveCount(2)
  await tabs.locator('.terminal-tab-close').last().click()
  await expect(tabs.getByRole('tab')).toHaveCount(1)
  await expect.poll(() => callHook(app, 'terminalPids')).toEqual([pid])

  await win.getByRole('button', { name: 'Close terminal' }).click()
  await expect(tabs.getByRole('tab')).toHaveCount(0)
  await expect(win.getByRole('button', { name: 'Open a terminal' })).toBeVisible()
  await expect.poll(() => callHook(app, 'terminalPids')).toEqual([])
  await expect.poll(() => alive(pid!), { timeout: 5_000 }).toBe(false)
  // No CSP or renderer errors (xterm's styles go through the style shim).
  expect(errors).toEqual([])
})

test('terminal: "Open in DevDock terminal" starts in the repo; exit marks the tab', async ({
  launched,
}) => {
  test.setTimeout(60_000)
  const { app, win, errors } = launched
  repos = makeRepos()
  expect((await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)).ok).toBe(
    true,
  )
  await showView(win, 'Repos')
  await win
    .getByRole('article', { name: 'clone' })
    .getByRole('button', { name: 'Open in DevDock terminal' })
    .click()
  await expect(win.locator('main')).toHaveAttribute('data-view', 'terminal')
  const tabs = win.getByRole('tablist', { name: 'Terminals' })
  await expect(tabs.getByRole('tab', { name: 'clone' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => callHook(app, 'terminalPids'), { timeout: 15_000 }).toHaveLength(1)

  await typeLine(win, 'pwd')
  // The registered path, or its real path (macOS temp folders live under /private).
  const paths = [repos.clone, realpathSync(repos.clone)]
  const anyPath = new RegExp(paths.map((p) => p.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')).join('|'))
  await expect.poll(() => screen(win), { timeout: 15_000 }).toMatch(anyPath)

  await typeLine(win, 'exit')
  await expect(tabs.getByRole('tab', { name: 'clone (exited)' })).toBeVisible({ timeout: 15_000 })
  expect(errors).toEqual([])
})

test('Settings → Terminal saves the shell, font size and DevDock prompt', async ({ launched }) => {
  const { win } = launched
  await openSettings(win)
  const section = win.getByRole('region', { name: 'Terminal' })
  await section.getByLabel('Font size').selectOption('16')
  await section.getByRole('switch', { name: 'Use DevDock prompt' }).click()
  const shell = section.getByLabel('Shell')
  await shell.fill('not a shell; rm -rf')
  await expect(section.getByText(/Use a shell name/)).toBeVisible()
  await shell.fill('bash')
  await section.getByRole('button', { name: 'Save' }).click()
  await expect
    .poll(() =>
      win.evaluate(() => window.devdock.settings.get().then((r) => r.ok && r.data.terminal)),
    )
    .toMatchObject({ shell: 'bash', fontSize: 16, devdockPrompt: true })
})

test('quitting DevDock stops the terminals’ shells and what they started', async () => {
  test.skip(process.platform === 'win32', 'process groups (macOS); ConPTY ends with the app')
  test.setTimeout(60_000)
  const profile = newProfile()
  const { app, win } = await launch(profile)
  try {
    // The first visit opens one in the home folder; a second tab makes two shells.
    await showView(win, 'Terminal')
    await expect.poll(() => callHook(app, 'terminalPids'), { timeout: 15_000 }).toHaveLength(1)
    await win.getByRole('button', { name: 'New terminal' }).click()
    await expect.poll(() => callHook(app, 'terminalPids'), { timeout: 15_000 }).toHaveLength(2)
    // Something the shell started that ignores the hang-up (in the shell's process group, as
    // with job control off): the PTY closing alone would leave it running; DevDock's kill of the
    // group on quit stops it.
    await typeLine(win, "set +m; (trap '' HUP; exec sleep 300) & echo devdock-child=$!")
    await expect
      .poll(async () => /devdock-child=(\d+)/.exec(await screen(win))?.[1], { timeout: 15_000 })
      .toBeTruthy()
    const child = Number(/devdock-child=(\d+)/.exec(await screen(win))![1])
    const pids = [...(await callHook(app, 'terminalPids')), child]
    expect(pids.every(alive)).toBe(true)
    await app.close()
    await expect.poll(() => pids.filter(alive), { timeout: 5_000 }).toEqual([])
  } finally {
    await app.close().catch(() => undefined)
    rmSync(profile, { recursive: true, force: true })
  }
})

for (const shell of ['/bin/zsh', '/bin/bash']) {
  test(`DevDock prompt in ${shell}: arrow, folder and git:(branch), ✗ once the repo changes`, async () => {
    test.skip(process.platform === 'win32', 'zsh/bash prompt (macOS)')
    test.setTimeout(60_000)
    // An empty home: no rc files of the person running the tests are read.
    const home = mkdtempSync(join(tmpdir(), 'devdock-home-'))
    const profile = newProfile()
    const { app, win, errors } = await launch(profile, { HOME: home, ZDOTDIR: '' })
    try {
      repos = makeRepos()
      const added = await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)
      expect(added.ok).toBe(true)
      await win.evaluate(
        (sh) => window.devdock.settings.update({ terminal: { shell: sh, devdockPrompt: true } }),
        shell,
      )
      await showView(win, 'Repos')
      await win
        .getByRole('article', { name: 'clone' })
        .getByRole('button', { name: 'Open in DevDock terminal' })
        .click()
      await expect.poll(() => callHook(app, 'terminalPids'), { timeout: 15_000 }).toHaveLength(1)
      await expect.poll(() => screen(win), { timeout: 15_000 }).toMatch(/➜ +clone git:\(\S+\)/)
      await typeLine(win, 'touch devdock-new-file')
      await expect.poll(() => screen(win), { timeout: 15_000 }).toMatch(/clone git:\(\S+\) ✗/)
      expect(errors).toEqual([])
    } finally {
      await app.close().catch(() => undefined)
      rmSync(profile, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })
}
