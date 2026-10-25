import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LESSONS_HEADER } from '../../src/shared/lessons'
import type { RepoConfig, Settings } from '../../src/shared/settings'
import type { GitRunner } from '../../src/main/services/git/exec'
import { LessonsError, LessonsService } from '../../src/main/services/lessons'

let dir: string
let outside: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devdock-lessons-'))
  outside = mkdtempSync(join(tmpdir(), 'devdock-outside-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

const REMOTES = [
  'origin\tgit@bitbucket.org:team/Web-App.git (fetch)',
  'origin\tgit@bitbucket.org:team/Web-App.git (push)',
  'upstream\thttps://bitbucket.example.com/scm/PROJ/web-app.git (fetch)',
].join('\n')

const service = (lessonsPath = 'docs/ai/LESSONS.md') =>
  new LessonsService({
    repo: () => ({ id: 'r', name: 'r', path: dir }) as RepoConfig,
    // Only the workflow part is read.
    settings: () => ({ workflow: { lessonsPath } }) as Settings,
    git: { run: async () => ({ stdout: REMOTES, stderr: '' }) } as unknown as GitRunner,
  })

const kindOf = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (err: unknown) => (err instanceof LessonsError ? err.kind : String(err)),
  )

describe('LessonsService (P6-F)', () => {
  it("no file yet: empty state with the remotes' repo slugs; adding creates it (with folders)", async () => {
    const s = service()
    expect(await s.state('r')).toEqual({
      path: 'docs/ai/LESSONS.md',
      exists: false,
      lessons: [],
      remoteRepos: ['web-app'],
    })
    expect(await s.exists('r')).toBe(false)
    const result = await s.add('r', ['Use formatMoney for totals (web-app #415)'])
    expect(result).toEqual({
      path: 'docs/ai/LESSONS.md',
      exists: true,
      lessons: ['Use formatMoney for totals (web-app #415)'],
      added: 1,
      remoteRepos: ['web-app'],
    })
    const text = readFileSync(join(dir, 'docs/ai/LESSONS.md'), 'utf8')
    expect(text.startsWith(LESSONS_HEADER.trimEnd())).toBe(true)
    // No temporary file left behind.
    expect(readdirSync(join(dir, 'docs/ai'))).toEqual(['LESSONS.md'])
    expect(await s.exists('r')).toBe(true)
  })

  it('appends to the existing file and leaves it untouched when nothing is new', async () => {
    mkdirSync(join(dir, 'notes'))
    const file = join(dir, 'notes/agents.md')
    writeFileSync(file, '# Ours\n\n- Keep PRs small\n')
    const s = service('notes/agents.md')
    expect((await s.add('r', ['keep PRs  small', 'Name tests after behaviour'])).added).toBe(1)
    expect(readFileSync(file, 'utf8')).toBe(
      '# Ours\n\n- Keep PRs small\n- Name tests after behaviour\n',
    )
    const again = await s.add('r', ['Keep PRs small'])
    expect(again.added).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(
      '# Ours\n\n- Keep PRs small\n- Name tests after behaviour\n',
    )
  })

  it("refuses a path out of the repo, even past the setting's validation", async () => {
    expect(await kindOf(service('../outside.md').add('r', ['x y z']))).toBe('outside')
  })

  it('refuses a folder that links out of the repo, and a lessons file that is itself a link', async () => {
    mkdirSync(join(dir, 'docs'))
    symlinkSync(outside, join(dir, 'docs', 'ai'))
    expect(await kindOf(service().add('r', ['x y z']))).toBe('outside')
    expect(readdirSync(outside)).toEqual([])

    rmSync(join(dir, 'docs', 'ai'))
    mkdirSync(join(dir, 'docs', 'ai'))
    writeFileSync(join(outside, 'real.md'), '- kept\n')
    symlinkSync(join(outside, 'real.md'), join(dir, 'docs', 'ai', 'LESSONS.md'))
    expect(await kindOf(service().add('r', ['x y z']))).toBe('symlink')
    expect(readFileSync(join(outside, 'real.md'), 'utf8')).toBe('- kept\n')
  })

  it('a file that cannot be read says so without the absolute path, and nothing is left behind', async () => {
    // The lessons "file" is a folder.
    mkdirSync(join(dir, 'docs', 'ai', 'LESSONS.md'), { recursive: true })
    const err = await service()
      .add('r', ['x y z'])
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LessonsError)
    expect((err as LessonsError).kind).toBe('io')
    expect((err as LessonsError).message).toBe("Couldn't read docs/ai/LESSONS.md: it is a folder.")
    expect(readdirSync(join(dir, 'docs', 'ai'))).toEqual(['LESSONS.md'])
  })
})
