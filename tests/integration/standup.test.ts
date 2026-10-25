import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitRunner } from '../../src/main/services/git/exec'
import { gitCommits } from '../../src/main/services/standup'
import { makeRepos, type Repos } from '../fixtures/git-repos'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Menu: {},
  Tray: vi.fn(),
  nativeImage: {},
}))

let repos: Repos | undefined
afterEach(() => repos?.cleanup())

const at = (iso: string) => ({ GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso })

describe('standup: git log across repos by author (real repo)', () => {
  it('my non-merge commits in the window on any branch; others’ and out-of-window ones left out', async () => {
    repos = makeRepos()
    const { clone, git } = repos
    const commitAs = (email: string, iso: string, message: string, file: string) => {
      const env = { ...process.env, ...at(iso) }
      writeFileSync(join(clone, file), message)
      git(clone, 'add', file)
      execFileSync(
        'git',
        [
          '-c',
          `user.email=${email}`,
          '-c',
          'user.name=Someone',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '-m',
          message,
        ],
        { cwd: clone, env },
      )
    }
    commitAs('me.dev@example.com', '2026-10-22T12:00:00Z', 'too early', 'a.txt')
    commitAs('me.dev@example.com', '2026-10-23T09:00:00Z', 'DD-1: first', 'b.txt')
    commitAs('someone@example.com', '2026-10-23T10:00:00Z', 'not mine', 'c.txt')
    git(clone, 'checkout', '-b', 'feature/x')
    commitAs('me.dev@example.com', '2026-10-24T15:00:00Z', 'DD-1: weekend fix', 'd.txt')
    commitAs('meXdev@example.com', '2026-10-24T16:00:00Z', 'regex lookalike', 'e.txt')
    // A merge of my own in the window: not a commit to report.
    git(clone, 'checkout', 'develop')
    commitAs('me.dev@example.com', '2026-10-24T17:00:00Z', 'DD-2: on develop', 'f.txt')
    execFileSync(
      'git',
      [
        '-c',
        'user.email=me.dev@example.com',
        '-c',
        'user.name=Someone',
        '-c',
        'commit.gpgsign=false',
        'merge',
        '--no-ff',
        '-m',
        'Merge feature/x',
        'feature/x',
      ],
      { cwd: clone, env: { ...process.env, ...at('2026-10-24T18:00:00Z') } },
    )

    const commits = await gitCommits(
      new GitRunner(),
      [
        {
          id: 'r',
          path: clone,
          name: 'web-app',
          baseBranch: 'develop',
          protectedPatterns: [],
          branchTemplates: { feature: 'f/{slug}', bugfix: 'b/{slug}' },
          devCommand: 'npm run dev',
        },
      ],
      'me.dev@example.com',
      new Date('2026-10-23T00:00:00Z'),
      new Date('2026-10-26T00:00:00Z'),
    )
    expect(commits.map((c) => [c.repo, c.subject]).sort()).toEqual([
      ['web-app', 'DD-1: first'],
      ['web-app', 'DD-1: weekend fix'],
      ['web-app', 'DD-2: on develop'],
    ])
  })

  it('no author email set → not_configured (a note, not a failure)', async () => {
    await expect(gitCommits(new GitRunner(), [], '', new Date(), new Date())).rejects.toMatchObject(
      {
        kind: 'not_configured',
      },
    )
  })
})
