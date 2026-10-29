import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { expect, launch, newProfile, openSettings, test } from './fixtures'

/** P7-C: Start work → "Start <agent> now" runs the agent CLI in DevDock's terminal, in the repo. */
let repos: Repos | undefined
let dirs: string[] = []
test.afterEach(() => {
  repos?.cleanup()
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

const screen = (win: Page) =>
  win.evaluate(
    () =>
      (window as unknown as { __devdockTerminal: { text(): string } }).__devdockTerminal.text() ??
      '',
  )

test('Start work offers the installed agent CLI and starts it in the repo with the message', async () => {
  test.skip(process.platform === 'win32', 'fake agent is a POSIX script')
  test.setTimeout(60_000)
  // A stand-in for Claude Code: writes where it ran and each argument it got, one per line.
  const bin = mkdtempSync(join(tmpdir(), 'devdock-agents-'))
  const out = join(mkdtempSync(join(tmpdir(), 'devdock-agent-out-')), 'ran.txt')
  dirs.push(bin, join(out, '..'))
  writeFileSync(
    join(bin, 'claude'),
    `#!/bin/sh\npwd > "${out}"\nfor a in "$@"; do printf '%s\\n' "$a" >> "${out}"; done\necho fake-claude-ran\n`,
  )
  chmodSync(join(bin, 'claude'), 0o755)
  const profile = newProfile()
  dirs.push(profile)
  const { app, win, errors } = await launch(profile, { PATH: `${bin}:${process.env.PATH}` })
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    repos = makeRepos()
    expect((await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)).ok).toBe(
      true,
    )

    // Settings → Workflow names the agents and which are missing.
    await openSettings(win)
    const workflow = win.getByRole('region', { name: 'Workflow' })
    const select = workflow.getByRole('combobox', { name: 'Agent' })
    await expect(select).toHaveValue('auto')
    await expect(select.locator('option', { hasText: 'Codex (not found)' })).toHaveCount(1)
    await expect(select.locator('option', { hasText: /^Claude Code$/ })).toHaveCount(1)

    await win
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Tickets' })
      .click()
    await win.getByRole('button', { name: /^DD-101\b/ }).click()
    await win
      .getByRole('complementary', { name: 'DD-101 details' })
      .getByRole('button', { name: 'Start work…' })
      .click()
    const dialog = win.getByRole('dialog', { name: 'Start work on DD-101' })
    await dialog.getByRole('checkbox', { name: 'Open the repo in VS Code afterwards' }).uncheck()
    await dialog.getByRole('button', { name: 'Start work', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('Started work on')
    // Start work put the message on the clipboard; the agent gets exactly that.
    const message = await app.evaluate(({ clipboard }) => clipboard.readText())
    await dialog.getByRole('button', { name: 'Start Claude Code now' }).click()

    await expect(win.locator('main[data-view="terminal"]')).toBeVisible()
    const tabs = win.getByRole('tablist', { name: 'Terminals' })
    await expect(tabs.getByRole('tab', { name: 'Claude Code · clone' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Only the agent's tab: the view's first visit didn't open a Home shell as well.
    await expect(tabs.getByRole('tab')).toHaveCount(1)
    await expect.poll(() => screen(win), { timeout: 15_000 }).toContain('fake-claude-ran')
    await expect.poll(() => screen(win)).toContain('Claude Code exited with code 0')
    const [cwd, ...args] = readFileSync(out, 'utf8').trimEnd().split('\n')
    expect(cwd).toBe(realpathSync(repos.clone))
    expect(args).toEqual([message])
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), saved).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})
