import { homedir } from 'node:os'
import { expect, openSettings, test } from './fixtures'

/** P6.04: Settings → Diagnostics — versions, proxy, Test all connections, redacted export. */
test('diagnostics: versions and proxy, every connection tested (demo), a report without personal data', async ({
  launched,
}) => {
  const { win } = launched
  await openSettings(win)
  const section = win.getByRole('region', { name: 'Diagnostics' })
  await expect(section.getByText(/^git version /)).toBeVisible()
  await expect(section.getByText('Demo data')).toBeVisible()

  await section.getByRole('button', { name: 'Test all connections' }).click()
  const tests = section.getByRole('list', { name: 'Connection tests' })
  // Jira, Bitbucket, Jenkins and (P7-C-B, demo key) Anthropic.
  await expect(tests.getByText(/^Connected as /)).toHaveCount(4)
  await expect(tests.getByText('Connected as your API key')).toBeVisible()

  // A manual proxy (SPEC 5) is what Chromium then uses for the services.
  await win.evaluate(() =>
    window.devdock.settings.update({ jira: { baseUrl: 'https://team.atlassian.net' } }),
  )
  await section.getByText('Use this proxy', { exact: true }).click()
  await section.getByLabel('Proxy server').fill('127.0.0.1:3128')
  await section.getByRole('button', { name: 'Save', exact: true }).click()
  // Jira (set above) and the fixed AI endpoints (Anthropic, OpenAI, Google — T6) go through it.
  await expect(section.getByText('PROXY 127.0.0.1:3128')).toHaveCount(4)
  await section.getByText('Use the system proxy', { exact: true }).click()
  await expect(section.getByText('PROXY 127.0.0.1:3128')).toHaveCount(0)

  await section.getByRole('button', { name: 'Export diagnostics' }).click()
  const dialog = win.getByRole('dialog', { name: 'Diagnostics report' })
  const code = dialog.locator('pre').first()
  await expect(code).toContainText('"generatedAt"')
  const text = (await code.textContent()) ?? ''
  const report = JSON.parse(text)
  expect(report.info.app).toMatch(/^\d+\.\d+\.\d+/)
  // The tests just run are in it, by outcome only.
  expect(report.lastConnectionTests.Jira).toMatchObject({ ok: true, code: null })
  expect(text).not.toContain(homedir())
})
