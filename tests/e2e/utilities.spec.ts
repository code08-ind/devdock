import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { makeRepos, type Repos } from '../fixtures/git-repos'
import { isListening } from '../fixtures/ports'
import { callHook, expect, test, windowFor } from './fixtures'

/** P5 Utilities in demo mode, through the UI. */

const shots = process.env.DEVDOCK_SCREENSHOTS
  ? join(import.meta.dirname, '../../docs/screenshots')
  : null
const snap = async (win: Page, name: string) => {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  await win.screenshot({ path: join(shots, `${name}.png`), animations: 'disabled' })
}

let repos: Repos | undefined
let server: ChildProcess | undefined
test.afterEach(() => {
  repos?.cleanup()
  repos = undefined
  server?.kill('SIGKILL')
  server = undefined
})

async function openUtilities(win: Page, tab: string) {
  await win
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Utilities' })
    .click()
  await expect(win.getByRole('heading', { level: 1, name: 'Utilities' })).toBeVisible()
  await win.locator('label.segment', { hasText: tab }).click()
}

/** A fixture TCP server on a free port; resolves to that port. */
function startServer(): Promise<number> {
  server = spawn(
    process.execPath,
    [
      '-e',
      "require('net').createServer().listen(0,'127.0.0.1',function(){process.stdout.write(this.address().port+'\\n')})",
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  // A plain write (console.log colours numbers under the runner's FORCE_COLOR); the first
  // line that is a port number.
  return new Promise((resolve) => {
    let out = ''
    server!.stdout!.on('data', (d: Buffer) => {
      out += String(d)
      const m = /^(\d+)$/m.exec(out)
      if (m) resolve(Number(m[1]))
    })
  })
}

async function addRepo(win: Page): Promise<Repos> {
  repos = makeRepos()
  const added = await win.evaluate((path) => window.devdock.repos.add({ path }), repos.clone)
  expect(added.ok).toBe(true)
  return repos
}

const readClipboard = (app: ElectronApplication) =>
  app.evaluate(({ clipboard }) => clipboard.readText())
const writeClipboard = (app: ElectronApplication, text: string) =>
  app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text)

test.skip(process.platform === 'win32', 'P5.D2 on Windows is covered by mocked-execFile unit tests')

test('P5.D2: kill a process by port (palette `kill <port>` and the Ports list)', async ({
  launched,
}) => {
  const { win } = launched
  const port = await startServer()
  expect(await isListening(port)).toBe(true)

  // From the palette: it opens the stop dialog for that port's process, and stops nothing yet.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await win.keyboard.press(`${mod}+K`)
  await win.keyboard.type(`kill ${port}`)
  await expect(win.getByRole('option').first()).toContainText(`Stop the process on port ${port}…`)
  await win.keyboard.press('Enter')
  const dialog = win.getByRole('dialog', {
    name: new RegExp(`^Stop node \\(PID ${server!.pid}\\)\\?$`),
  })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(`listening on port ${port}`)
  await snap(win, 'p5-stop-port')
  expect(await isListening(port)).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // From the list: filter to the port, Stop, confirm.
  const rows = win.getByRole('list', { name: 'Listening ports' })
  await expect(rows.getByRole('listitem')).toHaveCount(1)
  await expect(rows).toContainText(`:${port}`)
  await expect(rows).toContainText('createServer') // the command line
  await rows.getByRole('button', { name: `Stop node on port ${port}` }).click()
  await dialog.getByRole('button', { name: 'Stop process' }).click()
  await expect(
    win.getByText(`Stopped node (PID ${server!.pid}); port ${port} is free`),
  ).toBeVisible()
  expect(await isListening(port)).toBe(false)
})

test('global palette window: `kill <port>` opens the stop dialog in the main window', async ({
  launched,
}) => {
  const { app, win } = launched
  const port = await startServer()
  await callHook(app, 'togglePalette')
  const pw = await windowFor(app, 'palette.html')
  const box = pw.getByRole('combobox', { name: 'Command' })
  await expect(box).toBeFocused()
  await box.fill(`kill ${port}`)
  await expect(pw.getByRole('option').first()).toHaveText(
    new RegExp(`Stop the process on port ${port}`),
  )
  await pw.keyboard.press('Enter')
  await expect.poll(() => callHook(app, 'isPaletteVisible')).toBe(false)
  await expect(win.getByRole('heading', { level: 1, name: 'Utilities' })).toBeVisible()
  const dialog = win.getByRole('dialog', {
    name: new RegExp(`^Stop node \\(PID ${server!.pid}\\)\\?$`),
  })
  await expect(dialog).toBeVisible()
  // Nothing is stopped until confirmed in the main window.
  expect(await isListening(port)).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
})

test('`kill <port>` with nothing listening says so', async ({ launched }) => {
  const { win } = launched
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await win.keyboard.press(`${mod}+K`)
  await win.keyboard.type('kill 1')
  await expect(win.getByRole('option').first()).toContainText('Stop the process on port 1…')
  await win.keyboard.press('Enter')
  await expect(win.getByText('Nothing is listening on port 1.')).toBeVisible()
  await expect(win.getByRole('dialog')).toHaveCount(0)
})

test('Clean caches: sizes listed, confirmed, removed; node_modules stays', async ({ launched }) => {
  const { win } = launched
  const { clone } = await addRepo(win)
  mkdirSync(join(clone, 'dist'), { recursive: true })
  writeFileSync(join(clone, 'dist', 'app.js'), Buffer.alloc(2048))
  mkdirSync(join(clone, 'node_modules', 'react'), { recursive: true })
  writeFileSync(join(clone, 'node_modules', 'react', 'index.js'), 'x')
  await openUtilities(win, 'Clean caches')
  const folders = win.getByRole('list', { name: 'Cache folders' })
  await expect(folders).toContainText('dist2.0 KB')
  await expect(folders).toContainText('coveragenot there')
  await win.getByRole('button', { name: 'Clean caches' }).click()
  const confirm = win.getByRole('dialog', { name: 'Remove this folder?' })
  await expect(confirm).toContainText('dist — 2.0 KB')
  await confirm.getByRole('button', { name: 'Remove' }).click()
  await expect(win.getByText('Removed dist (2.0 KB freed)')).toBeVisible()
  expect(existsSync(join(clone, 'dist'))).toBe(false)
  expect(existsSync(join(clone, 'node_modules', 'react', 'index.js'))).toBe(true)
})

test('Env profiles: values masked until revealed; save, switch and undo', async ({ launched }) => {
  const { win } = launched
  const { clone } = await addRepo(win)
  writeFileSync(join(clone, '.env.local'), 'API_URL=https://dev.example.com\nTOKEN=s3cr3t\n')
  await openUtilities(win, 'Env profiles')
  const current = win.getByRole('definition').filter({ hasText: '••••' }).first()
  await expect(current).toBeVisible()
  await expect(win.getByText('s3cr3t')).toHaveCount(0)
  await win.getByRole('button', { name: 'Reveal TOKEN in .env.local' }).click()
  await expect(win.getByText('s3cr3t')).toBeVisible()

  await win.getByLabel('Save .env.local as a profile').fill('dev-api')
  await win.getByRole('button', { name: 'Save profile' }).click()
  await expect(win.getByText('Saved .env.local as dev-api')).toBeVisible()
  writeFileSync(join(clone, '.env.local'), 'API_URL=http://localhost:4010\n')
  await win.getByLabel('Save .env.local as a profile').fill('mock-api')
  await win.getByRole('button', { name: 'Save profile' }).click()
  await expect(win.getByText('Same as mock-api')).toBeVisible()

  await win.getByRole('button', { name: 'Switch .env.local to dev-api' }).click()
  await win
    .getByRole('dialog', { name: 'Switch .env.local to dev-api?' })
    .getByRole('button', { name: 'Switch' })
    .click()
  await expect(win.getByText('Same as dev-api')).toBeVisible()
  await snap(win, 'p5-env-profiles')
  await win.getByRole('button', { name: 'Undo last switch' }).click()
  await win
    .getByRole('dialog', { name: 'Undo the last switch?' })
    .getByRole('button', { name: 'Undo last switch' })
    .click()
  await expect(win.getByText('Same as mock-api')).toBeVisible()
})

test('Quick links: add one, find it in the palette; standup draft copied as Markdown', async ({
  launched,
}) => {
  const { app, win } = launched
  await openUtilities(win, 'Quick links')
  await win.getByRole('button', { name: 'Add link' }).click()
  const form = win.getByRole('form', { name: 'New link' })
  await form.getByLabel('Name').fill('Orders dashboard')
  await form.getByLabel('Address').fill('https://eu-west-1.console.aws.amazon.com/cloudwatch/home')
  await form.getByLabel('Group (optional)').fill('AWS')
  await form.getByRole('button', { name: 'Save link' }).click()
  await expect(win.getByRole('list', { name: 'AWS' })).toContainText('Orders dashboard')
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await win.keyboard.press(`${mod}+K`)
  await win.keyboard.type('orders')
  await expect(win.getByRole('option').first()).toContainText('Open Orders dashboard')
  await win.keyboard.press('Escape')

  await openUtilities(win, 'Standup')
  const yesterday = win.getByLabel(/^Yesterday \(/)
  await expect(yesterday).toHaveValue(/web-app: DD-101: keep focus on the trigger/)
  await expect(win.getByLabel('Today')).toHaveValue(/DD-101: /)
  await win.getByLabel('Blockers').fill('Waiting for API keys')
  await snap(win, 'p5-standup')
  const saved = await readClipboard(app)
  try {
    await win.getByRole('button', { name: 'Copy as Markdown' }).click()
    await expect(win.getByText('Standup copied as Markdown')).toBeVisible()
    const md = await readClipboard(app)
    expect(md).toMatch(/^\*\*Yesterday \(/)
    expect(md).toMatch(/\*\*Blockers\*\*\n\n- Waiting for API keys$/)
  } finally {
    await writeClipboard(app, saved)
  }
})
