/** Agent lessons file per repo (P6-F): read it, and append the lessons the user picked. */
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  appendLessons,
  parseLessons,
  remoteRepoSlug,
  type LessonsAddResult,
  type LessonsState,
} from '@shared/lessons'
import type { RepoConfig, Settings } from '@shared/settings'
import type { GitRunner } from './git/exec'
import { parseRemotes } from './git/parse'

/**
 * `outside`: the path (or a symlink on it) leads out of the repo. `symlink`: the file itself is
 * a link, which a write would replace. `io`: the file couldn't be read or written.
 */
export class LessonsError extends Error {
  override readonly name = 'LessonsError'
  constructor(
    readonly kind: 'outside' | 'symlink' | 'io',
    message: string,
  ) {
    super(message)
  }
}

export interface LessonsDeps {
  repo: (id: string) => RepoConfig
  settings: () => Settings
  git: GitRunner
}

export class LessonsService {
  constructor(private readonly deps: LessonsDeps) {}

  async state(repoId: string): Promise<LessonsState> {
    const repo = this.deps.repo(repoId)
    const { path, file } = await this.target(repo)
    const [text, repos] = await Promise.all([this.read(file, path), this.remoteRepos(repo)])
    return {
      path,
      exists: text !== null,
      lessons: text === null ? [] : parseLessons(text),
      remoteRepos: repos,
    }
  }

  /**
   * Appends the lessons (new ones only) and returns the file's lessons afterwards. The file is
   * written whole to a temporary file and renamed over, so it is never left half-written.
   */
  async add(repoId: string, lessons: readonly string[]): Promise<LessonsAddResult> {
    const repo = this.deps.repo(repoId)
    const { path, file } = await this.target(repo)
    const before = await this.read(file, path)
    const { text, added } = appendLessons(before, lessons)
    if (added > 0) {
      const temp = `${file}.devdock-tmp`
      try {
        await mkdir(dirname(file), { recursive: true })
        // The folders now exist: check again that none of them is a link out of the repo.
        await this.target(repo)
        await writeFile(temp, text, 'utf8')
        await rename(temp, file)
      } catch (err) {
        await rm(temp, { force: true }).catch(() => undefined)
        if (err instanceof LessonsError) throw err
        throw new LessonsError('io', `Couldn't write ${path}: ${reason(err)}.`)
      }
    }
    const remoteRepos = await this.remoteRepos(repo)
    return { path, exists: true, lessons: parseLessons(text), added, remoteRepos }
  }

  /** Whether the repo has a lessons file now (Start work's "read it first" line). */
  async exists(repoId: string): Promise<boolean> {
    return this.state(repoId).then(
      (s) => s.exists,
      () => false,
    )
  }

  /**
   * The configured path inside the repo. The setting is validated; this checks again, with
   * links resolved: the nearest existing folder must be inside the repo, and the file itself
   * must not be a link.
   */
  private async target(repo: RepoConfig): Promise<{ path: string; file: string }> {
    const path = this.deps.settings().workflow.lessonsPath
    const outside = new LessonsError('outside', `The lessons file ${path} is outside the repo.`)
    const root = await realpath(repo.path).catch(() => resolve(repo.path))
    const file = resolve(join(root, path))
    if (!inside(root, file)) throw outside
    let folder = dirname(file)
    for (;;) {
      const real = await realpath(folder).catch(() => null)
      if (real !== null) {
        if (!inside(root, real) && real !== root) throw outside
        break
      }
      folder = dirname(folder)
    }
    const link = await lstat(file).then(
      (s) => s.isSymbolicLink(),
      () => false,
    )
    if (link) {
      throw new LessonsError('symlink', `${path} is a link; DevDock only writes a real file there.`)
    }
    return { path, file }
  }

  private async read(file: string, path: string): Promise<string | null> {
    try {
      return await readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new LessonsError('io', `Couldn't read ${path}: ${reason(err)}.`)
    }
  }

  /** Bitbucket repo slugs of the repo's remotes, so its own PRs' comments can be shown first. */
  private async remoteRepos(repo: RepoConfig): Promise<string[]> {
    const out = await this.deps.git
      .run(['remote', '-v'], { cwd: repo.path })
      .then(({ stdout }) => stdout)
      .catch(() => '')
    const slugs = Object.values(parseRemotes(out)).map(remoteRepoSlug)
    return [...new Set(slugs.filter((s): s is string => s !== null))]
  }
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

/** A short reason without the absolute path Node puts in its messages. */
const reason = (err: unknown) => {
  const code = (err as NodeJS.ErrnoException).code
  return code === 'EACCES' || code === 'EPERM'
    ? 'permission denied'
    : code === 'EISDIR'
      ? 'it is a folder'
      : code === 'ENOSPC'
        ? 'the disk is full'
        : (code ?? 'unknown error')
}
