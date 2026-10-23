import { cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { isListening } from '../fixtures/ports'
import { expect, launch, test } from './fixtures'

/** P1.D3: start a fixture dev script, detect its port, stop it, the port is free afterwards. */
let repos: Repos | undefined
test.afterEach(() => repos?.cleanup())

/** A registered git repo whose `npm run dev` is the fixture server (port held by a grandchild). */
function fixtureRepo(): Repos {
  const r = makeRepos()
  cpSync(join(import.meta.dirname, '../fixtures/devserver'), r.clone, { recursive: true })
  return r
}

const portFrom = (text: string) => Number(/port (\d+)/.exec(text)?.[1])

test('start dev server → port detected → stop → port free', async ({ launched }) => {
  const { win } = launched
  repos = fixtureRepo()
  await win.evaluate((path) => window.devdock.repos.add({ path }), repos.clone)
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Repos' }).click()

  const panel = win.getByRole('region', { name: 'Dev server for clone' })
  await expect(panel).toContainText('npm run dev')
  await panel.getByRole('button', { name: 'Start dev server' }).click()
  const running = panel.getByText(/Running on port \d+/)
  await expect(running).toBeVisible({ timeout: 20_000 })
  const port = portFrom(await running.innerText())
  expect(await isListening(port)).toBe(true)
  await expect(panel.getByRole('button', { name: `http://localhost:${port}/` })).toBeVisible()
  await expect(panel.getByRole('log', { name: 'Dev server log' })).toContainText('Local:')
  if (process.env.DEVDOCK_SCREENSHOTS) {
    const dir = join(import.meta.dirname, '../../docs/screenshots')
    mkdirSync(dir, { recursive: true })
    await win.screenshot({ path: join(dir, 'p1-devserver.png'), animations: 'disabled' })
  }

  await panel.getByRole('button', { name: 'Stop' }).click()
  await expect(panel.getByText('Stopped')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => isListening(port), { timeout: 10_000 }).toBe(false)

  // scripts/baseline.mjs exists in the fixture, so the baseline row is offered too.
  await expect(win.getByRole('region', { name: 'Baseline server for clone' })).toBeVisible()
})

test('quitting DevDock kills running dev server trees', async () => {
  repos = fixtureRepo()
  const { app, win } = await launch()
  const added = await win.evaluate((path) => window.devdock.repos.add({ path }), repos.clone)
  if (!added.ok) throw new Error(added.error.message)
  const id = added.data.id
  await win.evaluate((repoId) => window.devdock.devserver.start({ id: repoId, kind: 'dev' }), id)
  await expect
    .poll(
      async () => {
        const r = await win.evaluate(() => window.devdock.devserver.list())
        return r.ok ? (r.data[0]?.port ?? 0) : 0
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0)
  const r = await win.evaluate(() => window.devdock.devserver.list())
  const port = r.ok ? r.data[0]!.port! : 0
  expect(await isListening(port)).toBe(true)

  await app.close()
  await expect.poll(() => isListening(port), { timeout: 15_000 }).toBe(false)
})
