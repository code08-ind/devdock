import { makeRepos, type Repos } from '../fixtures/git-repos'
import { expect, test } from './fixtures'

/**
 * P6.05 performance check (opt-in: `DEVDOCK_PERF=1 npx playwright test perf`): demo mode with 5
 * repos and 10 watched items, then DevDock left idle; CPU and memory summed over all its
 * processes (main, renderers, GPU, utility) from Electron's app metrics.
 */
test.skip(!process.env.DEVDOCK_PERF, 'set DEVDOCK_PERF=1 to run the performance check')
test.setTimeout(180_000)

const repos: Repos[] = []
test.afterEach(() => repos.splice(0).forEach((r) => r.cleanup()))

const DEMO = 'https://demo.devdock.invalid/bitbucket/projects/DEMO/repos'
const PRS: [string, number][] = [
  ['web-app', 412],
  ['web-app', 415],
  ['design-system', 88],
  ['web-app', 419],
  ['web-app', 410],
  ['web-app', 401],
  ['web-app', 395],
]

// 10 watched items: 7 PRs, and the pipelines of 3 of them (build watches are separate items).
test('idle CPU and memory with 5 repos and 10 watched items (demo)', async ({ launched }) => {
  const { app, win } = launched
  for (let i = 0; i < 5; i++) {
    const r = makeRepos()
    repos.push(r)
    const added = await win.evaluate((p) => window.devdock.repos.add({ path: p }), r.clone)
    expect(added.ok).toBe(true)
  }
  for (const [repo, id] of PRS) {
    const link = `${DEMO}/${repo}/pull-requests/${id}/overview`
    expect((await win.evaluate((l) => window.devdock.watch.add({ link: l }), link)).ok).toBe(true)
  }
  for (const [repo, id] of PRS.slice(0, 3)) {
    const link = `${DEMO}/${repo}/pull-requests/${id}/overview`
    expect((await win.evaluate((l) => window.devdock.buildwatch.addPr({ link: l }), link)).ok).toBe(
      true,
    )
  }
  // Today has the most on screen: PRs, builds, tickets, five repos' status.
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today' }).click()
  await win.waitForTimeout(15_000) // let start-up and the first polls settle

  const samples: { cpu: number; memMB: number }[] = []
  // percentCPUUsage is since the previous call: prime it, then sample every 3 s for 60 s.
  await app.evaluate(({ app: a }) => a.getAppMetrics())
  for (let i = 0; i < 20; i++) {
    await win.waitForTimeout(3_000)
    samples.push(
      await app.evaluate(({ app: a }) => {
        const m = a.getAppMetrics()
        return {
          cpu: m.reduce((s, p) => s + p.cpu.percentCPUUsage, 0),
          memMB: m.reduce((s, p) => s + p.memory.workingSetSize, 0) / 1024,
        }
      }),
    )
  }
  const breakdown = await app.evaluate(({ app: a, BrowserWindow }) => {
    const pages = new Map(
      BrowserWindow.getAllWindows().map((w) => [
        w.webContents.getOSProcessId(),
        w.webContents.getURL().split('/').pop(),
      ]),
    )
    return a
      .getAppMetrics()
      .map(
        (p) =>
          `${p.type}${pages.has(p.pid) ? ` (${pages.get(p.pid)})` : ''} ${(p.memory.workingSetSize / 1024).toFixed(0)} MB`,
      )
      .join(', ')
  })
  process.stdout.write(`PERF processes: ${breakdown}\n`)
  const avgCpu = samples.reduce((s, x) => s + x.cpu, 0) / samples.length
  const maxCpu = Math.max(...samples.map((x) => x.cpu))
  const memMB = Math.max(...samples.map((x) => x.memMB))
  process.stdout.write(
    `PERF idle over 60 s: CPU avg ${avgCpu.toFixed(2)}% (max ${maxCpu.toFixed(1)}%), working sets summed (shared pages counted per process) max ${memMB.toFixed(0)} MB\n`,
  )
  // SPEC 7: idles under ~1% CPU. Memory has no SPEC number ("reasonable"): 700 MB is our
  // budget for the summed working sets, which count shared pages once per process.
  expect(avgCpu).toBeLessThan(1)
  expect(memMB).toBeLessThan(700)
})
