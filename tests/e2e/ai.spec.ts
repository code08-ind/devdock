import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { expect, openSettings, test } from './fixtures'

/**
 * P7-C-B in demo mode (the demo Claude answers on this computer): each feature shows what will
 * be sent and sends only on Send; the answer can be copied or used. Settings → AI holds the key
 * and the model.
 */
let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const nav = (win: Page, name: string) =>
  win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()

test('PR status note: preview first, sent on Send, answer shown; the dialog passes axe', async ({
  launched,
}) => {
  const { win, errors } = launched
  await nav(win, 'Pull requests')
  await win
    .getByRole('button', { name: 'Draft a status note for web-app #415 with Claude' })
    .click()
  const dialog = win.getByRole('dialog', { name: 'Draft a status note' })
  await expect(dialog).toContainText('Demo mode: a sample answer is made on this computer.')
  // What will be sent is on screen before anything is sent.
  await expect(dialog.locator('.code').first()).toContainText('Pull request: ')
  await expect(dialog).toContainText('Claude Opus 5.5')
  const { violations } = await new AxeBuilder({ page: win })
    .include('dialog[open]')
    .withTags(TAGS)
    .setLegacyMode(true)
    .analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
  await dialog.getByRole('button', { name: 'Send to Claude' }).click()
  await expect(dialog.getByRole('status')).toContainText('Demo answer: this PR adds')
  await expect(dialog).toContainText('(demo: not charged)')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  expect(errors).toEqual([])
})

test('lesson wording: Claude’s line goes into the lesson, ticked; standup polish', async ({
  launched,
}) => {
  const { win } = launched
  repos = makeRepos()
  expect((await win.evaluate((p) => window.devdock.repos.add({ path: p }), repos.clone)).ok).toBe(
    true,
  )
  await nav(win, 'Utilities')
  await win.locator('label.segment', { hasText: 'Lessons' }).click()
  await win.getByRole('button', { name: 'Collect review comments' }).click()
  const list = win.getByRole('list', { name: 'Lessons to pick' })
  const first = list.getByRole('listitem').first()
  await first.getByRole('button', { name: /^Word the lesson from .* with Claude$/ }).click()
  const dialog = win.getByRole('dialog', { name: 'Word this comment as a lesson' })
  await expect(dialog.locator('.code').first()).toContainText('Reviewer comment:')
  await dialog.getByRole('button', { name: 'Send to Claude' }).click()
  await dialog.getByRole('button', { name: 'Use as the lesson' }).click()
  await expect(dialog).toBeHidden()
  await expect(first.getByRole('textbox')).toHaveValue(/^Demo answer: Keep loading/)
  await expect(first.getByRole('checkbox')).toBeChecked()

  await win.locator('label.segment', { hasText: 'Standup' }).click()
  await win.getByRole('button', { name: 'Polish with Claude' }).click()
  const polish = win.getByRole('dialog', { name: 'Polish the standup' })
  await expect(polish.locator('.code').first()).toContainText('Yesterday (')
  await polish.getByRole('button', { name: 'Send to Claude' }).click()
  await expect(polish.getByRole('status')).toContainText('**Yesterday**')
})

test('Settings → AI: the key field and the model, saved; no AI buttons without a key outside demo', async ({
  launched,
}) => {
  const { win } = launched
  await openSettings(win)
  const ai = win.getByRole('region', { name: 'AI' })
  await expect(
    ai.getByLabel('Anthropic API key (for the AI features)', { exact: true }),
  ).toHaveAttribute('type', 'password')
  const model = ai.getByRole('combobox', { name: 'Model' })
  await expect(model).toHaveValue('claude-opus-5-5')
  await model.selectOption('claude-haiku-5-5')
  await expect
    .poll(() => win.evaluate(async () => (await window.devdock.settings.get()).ok))
    .toBe(true)
  await expect
    .poll(async () =>
      win.evaluate(async () => {
        const r = await window.devdock.settings.get()
        return r.ok ? r.data.ai.model : null
      }),
    )
    .toBe('claude-haiku-5-5')
  // Demo mode off and no key: the features stay hidden.
  await win.evaluate(() => window.devdock.settings.update({ general: { demoMode: false } }))
  await nav(win, 'Pull requests')
  await expect(win.getByRole('button', { name: /status note/ })).toHaveCount(0)
})

test('from the palette (SPEC 7): polish the standup and a PR status note open the same preview', async ({
  launched,
}) => {
  const { win, errors } = launched
  const palette = async () => {
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    const p = win.getByTestId('command-palette')
    await expect(p).toBeVisible()
    return p
  }
  let p = await palette()
  await win.keyboard.type('polish the standup')
  await expect(p.getByRole('option').first()).toContainText('Polish the standup with Claude…')
  await win.keyboard.press('Enter')
  const polish = win.getByRole('dialog', { name: 'Polish the standup' })
  await expect(polish.locator('.code').first()).toContainText('Yesterday (')
  await polish.getByRole('button', { name: 'Cancel' }).click()
  await expect(polish).toBeHidden()

  p = await palette()
  await win.keyboard.type('status note web-app #415')
  await expect(p.getByRole('option').first()).toContainText(
    'Draft a status note for web-app #415 with Claude…',
  )
  await win.keyboard.press('Enter')
  const note = win.getByRole('dialog', { name: 'Draft a status note' })
  await expect(note.locator('.code').first()).toContainText('Pull request: ')
  await note.getByRole('button', { name: 'Send to Claude' }).click()
  await expect(note.getByRole('status')).toContainText('Demo answer: this PR adds')
  expect(errors).toEqual([])
})
