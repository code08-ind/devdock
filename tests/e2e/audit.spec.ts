import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { callHook, expect, test, windowFor } from './fixtures'

/**
 * P6-A UI audit: every screen in every theme, font size and density, saved as screenshots for
 * review. Opt-in: `DEVDOCK_AUDIT_DIR=<folder> npx playwright test audit`.
 */
const out = process.env.DEVDOCK_AUDIT_DIR
test.skip(!out, 'set DEVDOCK_AUDIT_DIR to run the UI audit')
test.setTimeout(240_000)

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

/** Each screen: how to get there, then a name for the file. */
const SCREENS: [string, (win: Page) => Promise<void>][] = [
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
  ['settings', (w) => nav(w, 'Settings')],
]

test('UI audit screenshots', async ({ launched }) => {
  const { win, errors } = launched
  mkdirSync(out!, { recursive: true })
  repos = makeRepos()
  writeFileSync(join(repos.clone, '.env.local'), 'API_URL=https://dev.example.com\nTOKEN=x\n')
  mkdirSync(join(repos.clone, 'dist'), { recursive: true })
  writeFileSync(join(repos.clone, 'dist', 'app.js'), Buffer.alloc(40_000))
  expect((await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)).ok).toBe(
    true,
  )
  await win.evaluate(() =>
    window.devdock.settings.update({
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
    for (const [name, go] of SCREENS) {
      await go(win)
      await win.waitForTimeout(400) // lists load from the demo servers
      await win.screenshot({
        path: join(out!, `${look.theme}-${look.fontSize}-${look.density}-${name}.png`),
        animations: 'disabled',
      })
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
  }
  expect(errors).toEqual([])
})
