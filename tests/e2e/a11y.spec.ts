import type { Page } from '@playwright/test'
import { VIEWS, THEMES, callHook, expect, pickSegment, showView, test, windowFor } from './fixtures'

/**
 * P6.03: every view at 12px and 18px in every theme, and a keyboard-only pass through every view.
 */
const show = showView
const segment = pickSegment

test('12px and 18px in every theme: no view overflows sideways or scrolls the window', async ({
  launched,
}) => {
  test.setTimeout(120_000)
  const { win } = launched
  await callHook(launched.app, 'togglePanel')
  const panel = await windowFor(launched.app, 'panel.html')
  for (const theme of THEMES) {
    for (const fontSize of [12, 18] as const) {
      await win.evaluate((a) => window.devdock.settings.update({ appearance: a as never }), {
        theme,
        fontSize,
      })
      for (const view of VIEWS) {
        await show(win, view)
        await expect(win.locator('main h1')).toBeVisible()
        const layout = await win.evaluate(() => {
          const main = document.querySelector('main')!
          const page = document.scrollingElement!
          return {
            sideways: main.scrollWidth > main.clientWidth + 1,
            pageScrolls: page.scrollHeight > page.clientHeight + 1,
          }
        })
        expect(layout, `${theme} ${fontSize}px ${view}`).toEqual({
          sideways: false,
          pageScrolls: false,
        })
      }
      // The menu-bar panel's tabs: only its body scrolls, and never sideways.
      for (const tab of ['Today', 'Repos', 'Tickets', 'Tools']) {
        await panel.getByText(tab, { exact: true }).click()
        const layout = await panel.evaluate(() => {
          const body = document.querySelector('.panel-body')!
          const page = document.scrollingElement!
          return {
            sideways:
              body.scrollWidth > body.clientWidth + 1 || page.scrollWidth > page.clientWidth + 1,
            pageScrolls: page.scrollHeight > page.clientHeight + 1,
          }
        })
        expect(layout, `${theme} ${fontSize}px panel ${tab}`).toEqual({
          sideways: false,
          pageScrolls: false,
        })
      }
    }
  }
})

/** Where a Tab stop shows its focus: a visually hidden radio shows it on the segment around it. */
type Stop = { name: string; ring: boolean; shown: boolean; inside: boolean }

/** Presses Tab until focus comes round to the first stop again; every stop must show the theme's
 *  focus colour (outline or ring) and stay inside `scope` (a dialog traps focus). */
async function tabRound(win: Page, where: string, scope = 'body') {
  const seen: string[] = []
  let inTerminal = false
  for (let i = 0; i < 200; i++) {
    // In a terminal Tab is the shell's; F6 is the documented way on (P7-A, WCAG 2.1.2).
    await win.keyboard.press(inTerminal ? 'F6' : 'Tab')
    inTerminal = await win.evaluate(
      () => document.activeElement?.closest('.terminal-screen') != null,
    )
    const stop: Stop = await win.evaluate((scopeSel) => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body)
        return { name: 'body', ring: false, shown: false, inside: false }
      // The theme's focus colour as the browser writes it in computed styles.
      const probe = document.createElement('span')
      probe.style.color = 'var(--focus)'
      document.body.append(probe)
      const focus = getComputedStyle(probe).color
      probe.remove()
      const ringed = (n: Element) => {
        const css = getComputedStyle(n)
        return (
          (css.outlineStyle !== 'none' && css.outlineColor === focus) ||
          css.boxShadow.includes(focus)
        )
      }
      // The ring may sit on the control or on the wrapper drawing it (a segment around its
      // visually hidden radio, the palette's search row).
      const ring = [el, el.parentElement, el.parentElement?.parentElement].some(
        (n) => n !== null && n !== undefined && ringed(n),
      )
      // xterm types into a zero-size helper textarea: the terminal itself is what shows focus.
      const target = el.matches('.visually-hidden')
        ? (el.closest('label') ?? el)
        : (el.closest<HTMLElement>('.xterm') ?? el)
      const box = target.getBoundingClientRect()
      const label =
        el.getAttribute('aria-label') ??
        (el as HTMLInputElement).labels?.[0]?.textContent ??
        el.textContent ??
        ''
      // A number per element, so stops with the same text (radio groups) stay apart.
      el.dataset.tabStop ??= String(document.querySelectorAll('[data-tab-stop]').length)
      return {
        name: `${el.dataset.tabStop} ${el.tagName.toLowerCase()} "${label.trim().slice(0, 40)}"`,
        ring,
        shown: box.width > 0 && box.height > 0,
        inside: el.closest(scopeSel) !== null,
      }
    }, scope)
    expect(stop, `${where}: Tab stop ${i} ${stop.name}`).toEqual({
      name: stop.name,
      ring: true,
      shown: true,
      inside: true,
    })
    if (stop.name === seen[0]) return seen
    seen.push(stop.name)
  }
  throw new Error(`${where}: Tab never came round (more than 200 stops)`)
}

test('keyboard only: every screen and dialog — Tab goes round with a visible focus ring', async ({
  launched,
}) => {
  test.setTimeout(180_000)
  const { win } = launched
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const screens: [string, () => Promise<void>][] = [
    ...VIEWS.map((v): [string, () => Promise<void>] => [v, () => show(win, v)]),
    [
      'Pull requests › Reviewing',
      async () => (await show(win, 'Pull requests'), segment(win, 'Reviewing')),
    ],
    ...(['Clean caches', 'Env profiles', 'Quick links', 'Standup'] as const).map(
      (t): [string, () => Promise<void>] => [
        `Utilities › ${t}`,
        async () => (await show(win, 'Utilities'), segment(win, t)),
      ],
    ),
    [
      'Tickets › issue details',
      async () => {
        await show(win, 'Tickets')
        await win.getByRole('button', { name: /^DD-101\b/ }).click()
      },
    ],
  ]
  for (const [where, open] of screens) {
    await open()
    await win.locator('main h1').focus()
    const stops = await tabRound(win, where)
    // Round the whole window: the rail is part of every round.
    expect(
      stops.some((s) => s.includes('"Settings"')),
      where,
    ).toBe(true)
  }

  // The command palette: typing goes to the search, Tab stays inside, Escape closes it.
  await show(win, 'Today')
  await win.keyboard.press(`${mod}+K`)
  const palette = win.getByTestId('command-palette')
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('combobox')).toBeFocused()
  await tabRound(win, 'palette', '[data-testid="command-palette"]')
  await win.keyboard.press('Escape')
  await expect(palette).toBeHidden()

  // A dialog: focus starts inside, Tab is trapped, Escape closes it and focus returns.
  await show(win, 'Tickets')
  await win.getByRole('button', { name: /^DD-101\b/ }).click()
  const opener = win
    .getByRole('complementary', { name: 'DD-101 details' })
    .getByRole('button', { name: 'Start work…' })
  await opener.focus()
  await win.keyboard.press('Enter')
  const dialog = win.getByRole('dialog', { name: 'Start work on DD-101' })
  await expect(dialog).toBeVisible()
  await tabRound(win, 'Start work dialog', 'dialog')
  await win.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()

  // The menu-bar panel: every tab, the same round and rings.
  await callHook(launched.app, 'togglePanel')
  const panel = await windowFor(launched.app, 'panel.html')
  for (const tab of ['Today', 'Repos', 'Tickets', 'Tools']) {
    await panel.getByText(tab, { exact: true }).click()
    await panel.getByRole('button', { name: 'Search every action' }).focus()
    await tabRound(panel, `panel › ${tab}`)
  }
})

test('Settings → Accessibility: each switch changes the app', async ({ launched }) => {
  test.setTimeout(120_000)
  const { win } = launched
  await show(win, 'Settings')
  const section = win.getByRole('region', { name: 'Accessibility' })
  const html = win.locator('html')

  // Reduce motion: "Always" zeroes the motion token even when the OS doesn't ask.
  const motion = () =>
    win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--motion'))
  expect(await motion()).not.toBe('0ms')
  await section.locator('label.segment', { hasText: 'Always' }).click()
  await expect.poll(motion).toBe('0ms')

  // Larger click targets: every control on every view is at least 44 × 44px, nothing overflows.
  await section.getByRole('switch', { name: 'Larger click targets' }).click()
  await expect(html).toHaveAttribute('data-larger-targets', '')
  for (const view of VIEWS) {
    await show(win, view)
    await expect(win.locator('main h1')).toBeVisible()
    const small = await win.evaluate(() =>
      [...document.querySelectorAll('button, [role="switch"], label.segment, select, .input')]
        .filter((el) => !el.closest('.visually-hidden'))
        .map((el) => ({ el, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && (box.width < 44 || box.height < 43.5))
        .map(
          ({ el, box }) =>
            `${el.textContent?.trim().slice(0, 30) || el.getAttribute('aria-label')} ${Math.round(box.width)}×${Math.round(box.height)}`,
        ),
    )
    expect(small, view).toEqual([])
    expect(
      await win.evaluate(() => {
        const main = document.querySelector('main')!
        return main.scrollWidth > main.clientWidth + 1
      }),
      `${view} sideways`,
    ).toBe(false)
  }

  // Always show the focus ring: a click on a button rings it too.
  await show(win, 'Settings')
  await section.getByRole('switch', { name: 'Always show the focus ring' }).click()
  const underline = section.getByRole('switch', { name: 'Underline links' })
  await underline.click()
  await expect(html).toHaveAttribute('data-underline-links', '')
  expect(await underline.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
  // Underline links: the links in an issue's details (DD-102 has a Figma and a Confluence link) are underlined without a hover.
  await show(win, 'Tickets')
  await win.getByRole('button', { name: /^DD-102\b/ }).click()
  const link = win.getByRole('complementary', { name: 'DD-102 details' }).locator('.link-button')
  await expect(link.first()).toBeVisible()
  expect(await link.first().evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe(
    'underline',
  )
  await show(win, 'Settings')

  // Read out background events: a notification lands in the polite live region.
  const announcer = win.getByTestId('announcer')
  await testNotification(win)
  await expect(announcer).toHaveText('')
  const announce = section.getByRole('switch', { name: 'Read out background events' })
  await announce.click()
  await expect(announce).toBeChecked()
  await testNotification(win)
  await expect(announcer).toHaveText(/^Test notification\. This is how a "build-finished"/)
})

/** Sends a test notification (Settings → Notifications → Test), the same path as real ones. */
const testNotification = (win: Page) =>
  win.evaluate(() => window.devdock.notifications.test({ type: 'build-finished' }))
