import type { Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { callHook, expect, test, windowFor } from './fixtures'

/** P6.01: the palette's registry — arguments, recents, disabled reasons, deferred commands. */
let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const palette = async (win: Page) => {
  await win.keyboard.press(`${mod}+K`)
  const p = win.getByTestId('command-palette')
  await expect(p).toBeVisible()
  return p
}

test('recent commands first; `open <link>`; Start work on a ticket by key, also from the palette window', async ({
  launched,
}) => {
  const { app, win } = launched
  repos = makeRepos()
  expect((await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)).ok).toBe(
    true,
  )
  await win.evaluate(() =>
    window.devdock.settings.update({
      quickLinks: [
        {
          id: 'a',
          name: 'Orders dashboard',
          url: 'https://eu-west-1.console.aws.amazon.com/x',
          group: 'AWS',
        },
      ],
    }),
  )

  // Run "Go to Builds"; next time it's the first entry, marked Recent.
  let p = await palette(win)
  await win.keyboard.type('go to builds')
  await expect(p.getByRole('option').first()).toContainText('Go to Builds')
  await win.keyboard.press('Enter')
  await expect(win.locator('main')).toHaveAttribute('data-view', 'builds')
  p = await palette(win)
  await expect(p.getByRole('option').first()).toContainText('Go to Builds')
  await expect(p.getByRole('option').first()).toContainText('Recent')

  // `open <name>` finds the quick link.
  await win.keyboard.type('open orders')
  await expect(p.getByRole('option').first()).toContainText('Open Orders dashboard')
  await win.keyboard.press('Escape')
  await expect(p).toBeHidden()

  // Tickets are commands; `branch <KEY>` opens Start work's preview (nothing runs yet).
  p = await palette(win)
  await win.keyboard.type('branch dd-104')
  await expect(p.getByRole('option').first()).toContainText('Start work on DD-104…')
  await win.keyboard.press('Enter')
  const dialog = win.getByRole('dialog', { name: 'Start work on DD-104' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // From the global-shortcut palette window: handed to the main window.
  await callHook(app, 'togglePalette')
  const pw = await windowFor(app, 'palette.html')
  await pw.getByRole('combobox', { name: 'Command' }).fill('branch DD-101')
  await expect(pw.getByRole('option').first()).toContainText('Start work on DD-101…')
  await pw.keyboard.press('Enter')
  await expect.poll(() => callHook(app, 'isPaletteVisible')).toBe(false)
  await expect(win.getByRole('dialog', { name: 'Start work on DD-101' })).toBeVisible()
})

test("a command that can't run says why and stays put", async ({ launched }) => {
  const { win } = launched
  // No repo yet: Start work has nowhere to make the branch.
  const p = await palette(win)
  await win.keyboard.type('branch DD-104')
  const option = p.getByRole('option').first()
  await expect(option).toContainText('Start work on DD-104…')
  await expect(option).toContainText('Add a repo first: Start work makes the branch there')
  await expect(option).toHaveAttribute('aria-disabled', 'true')
  await win.keyboard.press('Enter')
  await expect(p).toBeVisible()
  // It says so where a screen reader hears it.
  await expect(p.getByRole('status')).toHaveText(
    'Start work on DD-104…: Add a repo first: Start work makes the branch there',
  )
  await expect(win.getByRole('dialog', { name: /Start work/ })).toHaveCount(0)
})

test('a click outside the palette closes it; a click inside does not', async ({ launched }) => {
  const { win } = launched
  const p = await palette(win)
  // Inside: the search box keeps it open.
  await p.getByRole('combobox', { name: 'Command' }).click()
  await expect(p).toBeVisible()
  // Outside: the dimmed area near the window's corner. Electron has no viewport size, and the
  // window's size includes the title bar, so ask the page.
  const size = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  await win.mouse.click(size.width - 20, size.height - 20)
  await expect(p).toBeHidden()
  // And it opens again normally.
  await palette(win)
})
