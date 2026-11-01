import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { expect, test } from './fixtures'

/**
 * T17 (terminal half): the owner's own login shell and dotfiles (oh-my-zsh as they set it up)
 * in DevDock's terminal, with the DevDock prompt off, in Light, Dark and Slate. Checks the
 * prompt shows the git branch and saves screenshots for review. Opt-in, and only meaningful on
 * the owner's machine: `DEVDOCK_OWN_SHELL_DIR=<folder> npx playwright test own-shell`.
 */
const out = process.env.DEVDOCK_OWN_SHELL_DIR
test.skip(!out, "set DEVDOCK_OWN_SHELL_DIR to check your own shell's prompt")
test.setTimeout(120_000)

let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

/** The active tab's buffer, from the renderer's e2e hook (the terminal may draw on the GPU). */
const rows = (win: import('@playwright/test').Page) =>
  win.evaluate(
    () =>
      (window as unknown as { __devdockTerminal: { text(): string } }).__devdockTerminal.text() ??
      '',
  )

test('own shell: oh-my-zsh prompt with the git branch, in Light, Dark and Slate', async ({
  launched,
}) => {
  const { win } = launched
  mkdirSync(out!, { recursive: true })
  repos = makeRepos()
  repos.git(repos.clone, 'checkout', '-q', '-b', 'feature/own-shell')
  const added = await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)
  if (!added.ok) throw new Error(added.error.message)
  // The user's shell as it is: no DevDock prompt, login shell from SHELL.
  await win.evaluate(() =>
    window.devdock.settings.update({ terminal: { shell: '', devdockPrompt: false } }),
  )
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Repos' }).click()
  await win
    .getByRole('article', { name: 'clone' })
    .getByRole('button', { name: 'Open in DevDock terminal' })
    .click()
  const screen = win.locator('.terminal-screen:not([hidden]) .xterm')
  await expect(screen).toBeVisible()
  // oh-my-zsh can take a moment on first start (plugins, compinit).
  await expect.poll(() => rows(win), { timeout: 30_000 }).toMatch(/\S/)
  await screen.click()
  for (const line of ['git status -sb', 'echo "const ok = true" > ok.ts', 'git status -sb', 'ls']) {
    await win.keyboard.type(line)
    await win.keyboard.press('Enter')
    await win.waitForTimeout(500)
  }
  // robbyrussell: `➜  clone git:(feature/own-shell) ✗` once the tree is dirty.
  await expect.poll(() => rows(win), { timeout: 15_000 }).toContain('git:(feature/own-shell)')
  for (const theme of ['light', 'dark', 'slate'] as const) {
    await win.evaluate((t) => window.devdock.settings.update({ appearance: { theme: t } }), theme)
    await expect(win.locator('html')).toHaveAttribute('data-theme', theme)
    await win.waitForTimeout(600)
    await win.screenshot({ path: join(out!, `own-shell-${theme}.png`), animations: 'disabled' })
  }
})
