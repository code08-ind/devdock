import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_JIRA } from '../../src/main/demo/jira'
import { demoHandlers } from '../../src/main/demo/handlers'
import { GitActions } from '../../src/main/services/git/actions'
import { GitRunner } from '../../src/main/services/git/exec'
import { DemoHttpClient, type HttpClient } from '../../src/main/services/http'
import { JiraService } from '../../src/main/services/jira/service'
import { StartWorkService } from '../../src/main/services/startwork'
import {
  DEFAULT_PROTECTED,
  DEFAULT_TEMPLATES,
  SettingsSchema,
  defaultSettings,
  type RepoConfig,
  type Settings,
} from '../../src/shared/settings'
import { removeTempDir } from '../fixtures/cleanup'
import { makeRepos, type Repos } from '../fixtures/git-repos'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

/** Demo Jira, recording every request (to prove what was and wasn't called). */
class SpyHttp implements HttpClient {
  readonly demo = true
  readonly requests: { method: string; path: string }[] = []
  private readonly inner = new DemoHttpClient(demoHandlers())
  fetch(request: Request): Promise<Response> {
    this.requests.push({ method: request.method, path: new URL(request.url).pathname })
    return this.inner.fetch(request)
  }
  transitionCalls() {
    return this.requests.filter((r) => r.path.endsWith('/transitions'))
  }
}

let repos: Repos | undefined
let dataDir: string | undefined
afterEach(() => {
  repos?.cleanup()
  if (dataDir) removeTempDir(dataDir)
  repos = dataDir = undefined
})

function setup(features: Partial<Settings['features']> = {}) {
  repos = makeRepos()
  dataDir = mkdtempSync(join(tmpdir(), 'devdock-startwork-'))
  const base = defaultSettings()
  const settings = SettingsSchema.parse({ ...base, features: { ...base.features, ...features } })
  const repo: RepoConfig = {
    id: 'r1',
    path: repos.clone,
    name: 'clone',
    baseBranch: 'develop',
    protectedPatterns: [...DEFAULT_PROTECTED],
    branchTemplates: { ...DEFAULT_TEMPLATES },
    devCommand: 'npm run dev',
    checkCommand: '',
  }
  const http = new SpyHttp()
  const git = new GitRunner()
  const clipboard: string[] = []
  const openEditor = vi.fn(async (_repo: RepoConfig) => undefined)
  const svc = new StartWorkService({
    jira: new JiraService({
      http,
      settings: () => settings,
      token: () => undefined,
      demo: DEMO_JIRA,
    }),
    actions: new GitActions(git),
    git,
    repo: () => repo,
    settings: () => settings,
    lessonsExist: async () => existsSync(join(repo.path, settings.workflow.lessonsPath)),
    briefsDir: join(dataDir, 'briefs'),
    writeClipboard: (t) => void clipboard.push(t),
    openEditor,
    now: () => new Date('2026-10-23T09:00:00Z'),
  })
  const head = () => repos!.git(repos!.clone, 'rev-parse', '--abbrev-ref', 'HEAD').trim()
  const run = async (key: string, opts: { confirmTransition?: boolean } = {}) => {
    const plan = await svc.plan({ key, repoId: 'r1' })
    return svc.run({
      key,
      repoId: 'r1',
      runId: 'x',
      openEditor: true,
      agent: plan.agent,
      confirmTransition: opts.confirmTransition ?? true,
    })
  }
  return { svc, repo, http, git, clipboard, openEditor, head, run, repos: repos!, settings }
}

describe('Start work (real repos, demo Jira)', { timeout: 30_000 }, () => {
  it('Bug: bugfix branch from origin/develop, TICKET.md, bug-fixer message, VS Code', async () => {
    const s = setup()
    const plan = await s.svc.plan({ key: 'DD-101', repoId: 'r1' })
    expect(plan).toMatchObject({
      agent: 'bug-fixer',
      branch: 'bugfix/DD-101-checkout-total-rounds-wrong-for-3-decimal',
      briefPath: 'docs/ai/specs/DD-101/TICKET.md',
      briefLocation: 'repo',
      briefWouldBeCommitted: true,
      transitionEnabled: false,
      message:
        'Use the bug-fixer agent. Ticket brief: docs/ai/specs/DD-101/TICKET.md. When you finish, add what you learned to docs/ai/LESSONS.md, one line each.',
    })
    expect(plan.commands.map((c) => c.args.join(' '))).toEqual([
      'fetch origin develop',
      `checkout -b ${plan.branch} --no-track origin/develop`,
    ])
    // plan() changed nothing.
    expect(s.head()).toBe('develop')

    const r = await s.run('DD-101')
    expect(r.branch).toBe(plan.branch)
    expect(s.head()).toBe(plan.branch)
    expect(s.repos.git(s.repos.clone, 'rev-parse', 'HEAD')).toBe(
      s.repos.git(s.repos.clone, 'rev-parse', 'origin/develop'),
    )
    const brief = readFileSync(join(s.repos.clone, 'docs/ai/specs/DD-101/TICKET.md'), 'utf8')
    for (const section of [
      '# DD-101: Checkout total rounds wrong for 3-decimal currencies',
      '## Summary',
      '## Description',
      '## Acceptance criteria',
      '## Links',
      '## Comments (last 2)',
    ]) {
      expect(brief).toContain(section)
    }
    expect(brief).toContain('- Totals use minor units for every currency')
    expect(s.clipboard).toEqual([plan.message])
    expect(r).toMatchObject({ agent: 'bug-fixer', transition: { result: 'off' }, warnings: [] })
    expect(s.openEditor).toHaveBeenCalledOnce()
  })

  it('vague Story → spec-writer on a feature branch', async () => {
    const s = setup()
    const r = await s.run('DD-103')
    expect(r.agent).toBe('spec-writer')
    expect(r.branch).toBe('feature/DD-103-make-the-dashboard-feel-faster')
    expect(s.clipboard).toEqual([
      'Use the spec-writer agent. Ticket brief: docs/ai/specs/DD-103/TICKET.md. When you finish, add what you learned to docs/ai/LESSONS.md, one line each.',
    ])
  })

  it('Story with criteria and a Figma link → feature-builder, Figma in the message', async () => {
    const s = setup()
    const r = await s.run('DD-102')
    expect(r.agent).toBe('feature-builder')
    expect(s.clipboard[0]).toBe(
      'Use the feature-builder agent. Ticket brief: docs/ai/specs/DD-102/TICKET.md. Figma: https://www.figma.com/design/DEMOfile123/Profile?node-id=12-34. When you finish, add what you learned to docs/ai/LESSONS.md, one line each.',
    )
  })

  it('lessons (Settings → Workflow): read when the file exists, add when done; both can be off', async () => {
    const s = setup()
    mkdirSync(join(s.repos.clone, 'docs', 'ai'), { recursive: true })
    writeFileSync(
      join(s.repos.clone, 'docs', 'ai', 'LESSONS.md'),
      '# Lessons\n\n- Keep PRs small\n',
    )
    expect((await s.svc.plan({ key: 'DD-104', repoId: 'r1' })).message).toBe(
      'Use the spec-writer agent. Ticket brief: docs/ai/specs/DD-104/TICKET.md. Read docs/ai/LESSONS.md first. When you finish, add what you learned to docs/ai/LESSONS.md, one line each.',
    )
    // The dialog's ticks for this run win over Settings.
    expect(
      (await s.svc.plan({ key: 'DD-104', repoId: 'r1', lessons: { read: false, add: true } }))
        .message,
    ).toBe(
      'Use the spec-writer agent. Ticket brief: docs/ai/specs/DD-104/TICKET.md. When you finish, add what you learned to docs/ai/LESSONS.md, one line each.',
    )
    // The brief carries the same lines, under "Before you start".
    await s.run('DD-104')
    const brief = readFileSync(join(s.repos.clone, 'docs/ai/specs/DD-104/TICKET.md'), 'utf8')
    expect(brief).toContain('## Before you start\n\nRead docs/ai/LESSONS.md first.')
    s.repos.git(s.repos.clone, 'checkout', '-q', 'develop')
    s.settings.workflow = {
      ...s.settings.workflow,
      pointAgentToLessons: false,
      askAgentForLessons: false,
    }
    expect((await s.svc.plan({ key: 'DD-104', repoId: 'r1' })).message).toBe(
      'Use the spec-writer agent. Ticket brief: docs/ai/specs/DD-104/TICKET.md.',
    )
  })

  it('Task without acceptance criteria → spec-writer', async () => {
    const s = setup()
    expect((await s.svc.plan({ key: 'DD-104', repoId: 'r1' })).agent).toBe('spec-writer')
  })

  it('warns when docs/ai/specs would be committed, not once it is ignored', async () => {
    const s = setup()
    expect((await s.svc.plan({ key: 'DD-102', repoId: 'r1' })).briefWouldBeCommitted).toBe(true)
    writeFileSync(join(s.repos.clone, '.gitignore'), 'node_modules\ndocs/ai/specs/\n')
    expect((await s.svc.plan({ key: 'DD-102', repoId: 'r1' })).briefWouldBeCommitted).toBe(false)
    // Also honours .git/info/exclude.
    writeFileSync(join(s.repos.clone, '.gitignore'), '')
    mkdirSync(join(s.repos.clone, '.git', 'info'), { recursive: true })
    writeFileSync(join(s.repos.clone, '.git', 'info', 'exclude'), 'docs/ai/\n')
    expect((await s.svc.plan({ key: 'DD-102', repoId: 'r1' })).briefWouldBeCommitted).toBe(false)
  })

  it('brief location "DevDock data": written outside the repo, absolute path in the message', async () => {
    const s = setup({ briefLocation: 'appData' })
    const plan = await s.svc.plan({ key: 'DD-102', repoId: 'r1' })
    expect(plan.briefWouldBeCommitted).toBeNull()
    const r = await s.run('DD-102')
    expect(r.briefFile).toBe(join(dataDir!, 'briefs', 'DD-102', 'TICKET.md'))
    expect(existsSync(r.briefFile)).toBe(true)
    expect(existsSync(join(s.repos.clone, 'docs'))).toBe(false)
    expect(r.message).toContain(`Ticket brief: ${r.briefFile}.`)
  })

  it('P2.D4: transition is never called while the setting is off', async () => {
    const s = setup({ jiraTransition: false })
    const plan = await s.svc.plan({ key: 'DD-102', repoId: 'r1' })
    expect(plan.transitionEnabled).toBe(false)
    // Even a run that "confirms" it can't switch it on: the setting is read in main only.
    const r = await s.svc.run({
      key: 'DD-102',
      repoId: 'r1',
      runId: 'x',
      openEditor: false,
      agent: plan.agent,
      confirmTransition: true,
    })
    expect(r.transition).toEqual({ result: 'off' })
    expect(s.http.transitionCalls()).toEqual([])
  })

  it('setting on but not confirmed in the dialog: declined, nothing sent', async () => {
    const s = setup({ jiraTransition: true })
    const r = await s.run('DD-102', { confirmTransition: false })
    expect(r.transition).toEqual({ result: 'declined' })
    expect(s.http.transitionCalls()).toEqual([])
  })

  it('refuses before any git command when the ticket no longer matches the preview', async () => {
    const s = setup()
    const before = s.repos.git(s.repos.clone, 'rev-parse', 'HEAD')
    await expect(
      s.svc.run({
        key: 'DD-101',
        repoId: 'r1',
        runId: 'x',
        openEditor: false,
        agent: 'feature-builder', // the preview said this; DD-101 is a Bug
        confirmTransition: false,
      }),
    ).rejects.toMatchObject({ name: 'StartWorkError', kind: 'changed' })
    expect(s.head()).toBe('develop')
    expect(s.repos.git(s.repos.clone, 'rev-parse', 'HEAD')).toBe(before)
    expect(s.clipboard).toEqual([])
  })

  it('warns about a brief that is already tracked, even if the folder is ignored now', async () => {
    const s = setup()
    const file = join(s.repos.clone, 'docs/ai/specs/DD-102/TICKET.md')
    mkdirSync(join(s.repos.clone, 'docs/ai/specs/DD-102'), { recursive: true })
    writeFileSync(file, 'old\n')
    s.repos.git(s.repos.clone, 'add', 'docs')
    s.repos.git(s.repos.clone, 'commit', '-q', '-m', 'oops, committed a brief')
    writeFileSync(join(s.repos.clone, '.gitignore'), 'docs/ai/specs/\n')
    expect((await s.svc.plan({ key: 'DD-102', repoId: 'r1' })).briefWouldBeCommitted).toBe(true)
  })

  it('a brief that cannot be written: typed error naming the branch that was created', async () => {
    const s = setup()
    // A file where the docs folder should be makes mkdir fail.
    writeFileSync(join(s.repos.clone, 'docs'), 'not a folder')
    s.repos.git(s.repos.clone, 'add', 'docs')
    s.repos.git(s.repos.clone, 'commit', '-q', '-m', 'docs file')
    s.repos.git(s.repos.clone, 'push', '-q', 'origin', 'develop')
    const err = await s.run('DD-103').catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'StartWorkError', kind: 'brief' })
    expect((err as Error).message).toMatch(
      /^Created feature\/DD-103-make-the-dashboard-feel-faster, but couldn't write/,
    )
    expect(s.head()).toBe('feature/DD-103-make-the-dashboard-feel-faster')
  })

  it('with the setting on: moves a To Do issue to In Progress', async () => {
    const s = setup({ jiraTransition: true })
    const r = await s.run('DD-102')
    expect(r.transition).toEqual({ result: 'done' })
    expect(s.http.transitionCalls().map((c) => c.method)).toEqual(['GET', 'POST'])
  })

  it('with the setting on: leaves issues alone that are already in progress or have no such transition', async () => {
    const s = setup({ jiraTransition: true })
    expect((await s.run('DD-101')).transition).toEqual({ result: 'already' })
    expect(s.http.transitionCalls()).toEqual([])

    const review = await s.run('DD-106') // In Review: only "Done" is offered
    expect(review.transition.result).toBe('unavailable')
    expect(review.warnings).toEqual([expect.stringContaining('no "In Progress" transition')])
    expect(s.http.transitionCalls().map((c) => c.method)).toEqual(['GET'])
  })

  it('an editor failure is a warning, not a failure (branch and brief exist)', async () => {
    const s = setup()
    s.openEditor.mockRejectedValueOnce(new Error('code not found'))
    const r = await s.run('DD-105')
    expect(r.warnings).toEqual(["Couldn't open VS Code: code not found"])
    expect(existsSync(r.briefFile)).toBe(true)
  })

  it('a second Start work on the same ticket gets a new branch name', async () => {
    const s = setup()
    const first = await s.run('DD-103')
    s.repos.git(s.repos.clone, 'checkout', '-q', 'develop')
    const second = await s.run('DD-103')
    expect(second.branch).toBe(`${first.branch}-2`)
  })

  it.skipIf(!process.env.DEVDOCK_WRITE_SAMPLES)(
    'P2.D5: writes docs/samples from demo data',
    async () => {
      const s = setup()
      const out = join(import.meta.dirname, '..', '..', 'docs', 'samples')
      mkdirSync(out, { recursive: true })
      for (const key of ['DD-101', 'DD-102', 'DD-103']) {
        const r = await s.run(key)
        writeFileSync(join(out, `${key}-TICKET.md`), readFileSync(r.briefFile, 'utf8'))
        s.repos.git(s.repos.clone, 'checkout', '-q', 'develop')
      }
      writeFileSync(join(out, 'clipboard-messages.txt'), `${s.clipboard.join('\n')}\n`)
    },
  )
})

describe('startwork:* IPC', () => {
  it('runs through the handlers and streams git output', async () => {
    const { dispatch } = await import('../../src/main/ipc/registry')
    const { handlerSetup } = await import('../fixtures/handler-deps')
    repos = makeRepos()
    const { handlers, deps, output } = await handlerSetup()
    const added = await dispatch('repos:add', { path: repos.clone }, handlers)
    if (!added.ok) throw new Error(added.error.message)
    const req = { key: 'DD-101', repoId: added.data.id }
    const plan = await dispatch('startwork:plan', req, handlers)
    expect(plan).toMatchObject({ ok: true, data: { agent: 'bug-fixer' } })
    const run = await dispatch(
      'startwork:run',
      { ...req, runId: 'run-1', openEditor: true, agent: 'bug-fixer', confirmTransition: false },
      handlers,
    )
    expect(run).toMatchObject({ ok: true, data: { agent: 'bug-fixer' } })
    expect(deps.writeClipboard).toHaveBeenCalledWith(
      'Use the bug-fixer agent. Ticket brief: docs/ai/specs/DD-101/TICKET.md. When you finish, add what you learned to docs/ai/LESSONS.md, one line each.',
    )
    expect(deps.openRepo).toHaveBeenCalledWith(
      expect.objectContaining({ id: added.data.id }),
      'editor',
    )
    expect(output.some((o) => o.runId === 'run-1')).toBe(true)
    // A changed ticket is a typed precondition failure.
    const stale = await dispatch(
      'startwork:run',
      { ...req, runId: 'run-2', openEditor: false, agent: 'spec-writer', confirmTransition: false },
      handlers,
    )
    expect(stale).toMatchObject({ ok: false, error: { code: 'PRECONDITION_FAILED' } })
    // Bad key never reaches Jira or git.
    expect(
      await dispatch('startwork:plan', { key: 'x/../y', repoId: 'r' }, handlers),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    })
  })
})
