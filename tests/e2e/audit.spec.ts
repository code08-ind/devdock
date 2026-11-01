import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { callHook, expect, launch, newProfile, test, windowFor } from './fixtures'

/**
 * P6-A UI audit (extended for T10 QA): every screen in every theme, font size and density,
 * saved as screenshots for review — views, GitHub/GitLab lists and runs, the terminal, the
 * menu-bar panel, both palettes, the dialogs (push, trigger, Start work with an agent, AI) and,
 * in a subset of looks, each Settings section. Opt-in:
 * `DEVDOCK_AUDIT_DIR=<folder> npx playwright test audit`.
 */
const out = process.env.DEVDOCK_AUDIT_DIR
test.skip(!out, 'set DEVDOCK_AUDIT_DIR to run the UI audit')
test.setTimeout(900_000)

let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

type Look = { theme: string; fontSize: number; density: 'comfortable' | 'compact' }

const LOOKS: Look[] = [
  { theme: 'light', fontSize: 14, density: 'comfortable' },
  { theme: 'dark', fontSize: 14, density: 'comfortable' },
  { theme: 'high-contrast', fontSize: 14, density: 'comfortable' },
  { theme: 'paper', fontSize: 14, density: 'comfortable' },
  { theme: 'slate', fontSize: 14, density: 'comfortable' },
  { theme: 'light', fontSize: 18, density: 'comfortable' },
  { theme: 'dark', fontSize: 12, density: 'compact' },
]

const nav = (win: Page, label: string) =>
  win
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: label, exact: true })
    .click()
const tab = (win: Page, label: string) =>
  win.locator('label.segment', { hasText: label }).first().click()

/** Dialogs and sections are shot in these looks only (the full set is long enough). */
const SUBSET = new Set(['light-14', 'high-contrast-14', 'light-18', 'dark-12'])
const close = (w: Page) => w.keyboard.press('Escape')
const SETTINGS_SECTIONS = [
  'general',
  'appearance',
  'accessibility',
  'terminal',
  'notifications',
  'workflow',
  'ai',
  'jira',
  'bitbucket',
  'jenkins',
  'actions',
  'git',
  'standup',
  'credentials',
  'diagnostics',
  'data',
]

/** Each screen: how to get there, then a name for the file; `after` puts things back. */
type Screen = [
  string,
  (win: Page) => Promise<void>,
  { subset?: boolean; after?: (w: Page) => Promise<void> }?,
]

const SCREENS: Screen[] = [
  ['home', (w) => nav(w, 'Home')],
  ['today', (w) => nav(w, 'Today')],
  ['repos', (w) => nav(w, 'Repos')],
  ['prs-mine', (w) => nav(w, 'Pull requests')],
  ['prs-reviewing', async (w) => (await nav(w, 'Pull requests'), tab(w, 'Reviewing'))],
  ['builds', (w) => nav(w, 'Builds')],
  ['tickets', (w) => nav(w, 'Tickets')],
  [
    'tickets-detail',
    async (w) => {
      await nav(w, 'Tickets')
      await w.getByRole('button', { name: /^DD-101\b/ }).click()
    },
  ],
  ['util-ports', async (w) => (await nav(w, 'Utilities'), tab(w, 'Ports'))],
  ['util-caches', async (w) => (await nav(w, 'Utilities'), tab(w, 'Clean caches'))],
  ['util-env', async (w) => (await nav(w, 'Utilities'), tab(w, 'Env profiles'))],
  ['util-links', async (w) => (await nav(w, 'Utilities'), tab(w, 'Quick links'))],
  ['util-standup', async (w) => (await nav(w, 'Utilities'), tab(w, 'Standup'))],
  [
    'util-lessons',
    async (w) => {
      await nav(w, 'Utilities')
      await tab(w, 'Lessons')
      const collect = w.getByRole('button', { name: 'Collect review comments' })
      if (await collect.isVisible()) await collect.click()
    },
  ],
  ['settings', (w) => nav(w, 'Settings')],
  // Phase 7 and T4/T5.
  ['builds-github', async (w) => (await nav(w, 'Builds'), tab(w, 'GitHub Actions'))],
  ['builds-gitlab', async (w) => (await nav(w, 'Builds'), tab(w, 'GitLab pipelines'))],
  ['builds-watched', async (w) => (await nav(w, 'Builds'), tab(w, 'Watched'))],
  [
    'terminal',
    async (w) => {
      await nav(w, 'Terminal')
      await w.waitForTimeout(1200) // the shell's first prompt
    },
  ],
  [
    'palette-main',
    async (w) => {
      await w.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+K`)
      await w.getByTestId('command-palette').getByRole('combobox').fill('trigger')
    },
    { after: close },
  ],
  [
    'dialog-push',
    async (w) => {
      await nav(w, 'Repos')
      await w
        .getByRole('article', { name: 'clone' })
        .getByRole('button', { name: 'Push branch' })
        .click()
      await w.getByRole('dialog').getByText('Commands that will run').waitFor()
    },
    { subset: true, after: close },
  ],
  [
    'dialog-trigger',
    async (w) => {
      await nav(w, 'Builds')
      await tab(w, 'My branches')
      await w
        .getByRole('button', { name: /^Trigger a build of/ })
        .first()
        .click()
      await w.getByRole('dialog').waitFor()
    },
    { subset: true, after: close },
  ],
  [
    'dialog-startwork',
    async (w) => {
      await nav(w, 'Tickets')
      await w.getByRole('button', { name: /^DD-104\b/ }).click()
      await w
        .getByRole('complementary', { name: 'DD-104 details' })
        .getByRole('button', { name: 'Start work…' })
        .click()
      await w.getByRole('dialog', { name: 'Start work on DD-104' }).waitFor()
      await w.waitForTimeout(600) // the preview
    },
    { subset: true, after: close },
  ],
  [
    'dialog-ai-standup',
    async (w) => {
      await nav(w, 'Utilities')
      await tab(w, 'Standup')
      await w.getByRole('button', { name: 'Polish with Claude' }).click()
      await w.getByRole('dialog').waitFor()
      await w.waitForTimeout(600)
    },
    { subset: true, after: close },
  ],
  [
    'dialog-ai-pr',
    async (w) => {
      await nav(w, 'Pull requests')
      await tab(w, 'My PRs')
      await w
        .getByRole('button', { name: /^Summarise .* with Claude$/ })
        .first()
        .click()
      await w.getByRole('dialog').waitFor()
      await w.waitForTimeout(600)
    },
    { subset: true, after: close },
  ],
  [
    'settings-workflow-follow-ups',
    async (w) => {
      await nav(w, 'Settings')
      await w.getByText('Offer to move the ticket when a PR opens').scrollIntoViewIfNeeded()
    },
    { subset: true },
  ],
  ...SETTINGS_SECTIONS.map<Screen>((id) => [
    `settings-${id}`,
    async (w) => {
      await nav(w, 'Settings')
      await w.locator(`#${id}-title`).scrollIntoViewIfNeeded()
    },
    { subset: true },
  ]),
]

test('UI audit screenshots', async () => {
  // A stand-in agent CLI on PATH, so Start work offers "Start Claude Code now".
  const bin = mkdtempSync(join(tmpdir(), 'devdock-audit-bin-'))
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho fake-claude\n')
  chmodSync(join(bin, 'claude'), 0o755)
  const launched = await launch(newProfile(), { PATH: `${bin}:${process.env.PATH}` })
  try {
    await audit(launched)
  } finally {
    await launched.app.close()
    rmSync(bin, { recursive: true, force: true })
  }
})

async function audit(launched: Awaited<ReturnType<typeof launch>>) {
  const { win, errors } = launched
  mkdirSync(out!, { recursive: true })
  repos = makeRepos()
  // A feature branch with a check command: the push dialog shows both T5 ticks.
  repos.git(repos.clone, 'checkout', '-q', '-b', 'bugfix/DD-101-date-picker-focus')
  writeFileSync(join(repos.clone, '.env.local'), 'API_URL=https://dev.example.com\nTOKEN=x\n')
  mkdirSync(join(repos.clone, 'dist'), { recursive: true })
  writeFileSync(join(repos.clone, 'dist', 'app.js'), Buffer.alloc(40_000))
  expect((await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)).ok).toBe(
    true,
  )
  const repoId = (await win.evaluate(() => window.devdock.repos.list())) as {
    ok: true
    data: { id: string }[]
  }
  await win.evaluate(
    (id) => window.devdock.repos.update({ id, patch: { checkCommand: 'npm test' } }),
    repoId.data[0]!.id,
  )
  await win.evaluate(() =>
    window.devdock.settings.update({
      github: { enabled: true },
      gitlab: { enabled: true },
      features: {
        jobTriggers: true,
        prActions: true,
        ciActions: true,
        allowedJobs: ['web-app/bugfix%2FDD-101-date-picker-focus'],
      },
      workflow: {
        checkBeforePush: true,
        watchBuildAfterPush: true,
        devServerAfterSwitch: true,
        moveTicketOnPr: true,
      },
      quickLinks: [
        {
          id: 'a',
          name: 'Orders dashboard',
          url: 'https://eu-west-1.console.aws.amazon.com/cloudwatch',
          group: 'AWS',
        },
        {
          id: 'b',
          name: 'Checkout designs',
          url: 'https://www.figma.com/file/abc',
          group: 'Design',
        },
      ],
    }),
  )

  // T5d: offers to move tickets show on Today.
  await callHook(launched.app, 'pollTicketMoves')
  await callHook(launched.app, 'forgetSeenPrs')
  await callHook(launched.app, 'pollTicketMoves')

  await callHook(launched.app, 'togglePanel')
  const panel = await windowFor(launched.app, 'panel.html')
  for (const look of LOOKS) {
    await win.evaluate(
      (l) =>
        window.devdock.settings.update({
          appearance: {
            theme: l.theme as never,
            fontSize: l.fontSize as never,
            density: l.density,
          },
        }),
      look,
    )
    const lookName = `${look.theme}-${look.fontSize}`
    for (const [name, go, opts] of SCREENS) {
      if (opts?.subset && !SUBSET.has(lookName)) continue
      await go(win)
      await win.waitForTimeout(400) // lists load from the demo servers
      await win.screenshot({
        path: join(out!, `${look.theme}-${look.fontSize}-${look.density}-${name}.png`),
        animations: 'disabled',
      })
      await opts?.after?.(win)
    }
    // The menu-bar panel (P6-E), each tab.
    for (const tab of ['Today', 'Repos', 'Tickets', 'Tools']) {
      await panel.getByText(tab, { exact: true }).click()
      await panel.waitForTimeout(400)
      await panel.screenshot({
        path: join(out!, `${look.theme}-${look.fontSize}-${look.density}-panel-${tab}.png`),
        animations: 'disabled',
      })
    }
    // The global-shortcut palette window.
    await callHook(launched.app, 'togglePalette')
    const pw = await windowFor(launched.app, 'palette.html')
    await pw.getByRole('combobox', { name: 'Command' }).fill('move')
    await pw.waitForTimeout(300)
    await pw.screenshot({
      path: join(out!, `${look.theme}-${look.fontSize}-${look.density}-palette-window.png`),
      animations: 'disabled',
    })
    await callHook(launched.app, 'togglePalette')
  }
  expect(errors).toEqual([])
}
