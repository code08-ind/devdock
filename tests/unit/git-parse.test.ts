import { describe, expect, it } from 'vitest'
import { classifyGitFailure } from '../../src/main/services/git/errors'
import { unsafeReason } from '../../src/main/services/git/exec'
import {
  parseLeftRight,
  parseRemotes,
  parseStashList,
  parseStatusV2,
} from '../../src/main/services/git/parse'

describe('parseStatusV2', () => {
  it('reads branch, upstream, ahead/behind and counts', () => {
    const out = [
      '# branch.oid 1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c',
      '# branch.head feature/NM-12-login',
      '# branch.upstream origin/feature/NM-12-login',
      '# branch.ab +3 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/app.ts',
      '1 M. N... 100644 100644 100644 aaa bbb README.md',
      '2 R. N... 100644 100644 100644 aaa bbb R100 src/new name.ts\tsrc/old.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflicted file.ts',
      '? notes.txt',
      '? tmp/',
      '',
    ].join('\n')
    expect(parseStatusV2(out)).toEqual({
      branch: {
        head: 'feature/NM-12-login',
        oid: '1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c',
        upstream: 'origin/feature/NM-12-login',
        ahead: 3,
        behind: 1,
      },
      changed: 3,
      untracked: 2,
      conflicted: ['src/conflicted file.ts'],
    })
  })

  it('handles detached HEAD, a fresh repo, and no upstream', () => {
    expect(parseStatusV2('# branch.oid abc\n# branch.head (detached)\n').branch).toMatchObject({
      head: null,
      upstream: null,
      ahead: null,
    })
    expect(parseStatusV2('# branch.oid (initial)\n# branch.head main\n').branch).toMatchObject({
      head: 'main',
      oid: null,
    })
  })

  it('accepts NUL-separated output (-z), skipping the rename source record', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head main',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts',
      'old.ts',
      '? x',
      '',
    ].join('\0')
    expect(parseStatusV2(out)).toMatchObject({ changed: 1, untracked: 1 })
  })
})

describe('parseLeftRight', () => {
  it('parses tab- or space-separated counts', () => {
    expect(parseLeftRight('3\t5\n')).toEqual({ left: 3, right: 5 })
    expect(parseLeftRight('0 0')).toEqual({ left: 0, right: 0 })
  })
  it('rejects unexpected output', () => {
    expect(() => parseLeftRight('fatal: bad revision')).toThrow(/Unexpected/)
  })
})

describe('parseStashList', () => {
  it('parses WIP, named and branchless stashes', () => {
    const out = [
      'stash@{0}: WIP on feature/x: 1a2b3c4 Add login form',
      'stash@{1}: On main: devdock: before update from develop',
      'stash@{2}: autostash',
      '',
    ].join('\n')
    expect(parseStashList(out)).toEqual([
      { index: 0, ref: 'stash@{0}', branch: 'feature/x', message: '1a2b3c4 Add login form' },
      {
        index: 1,
        ref: 'stash@{1}',
        branch: 'main',
        message: 'devdock: before update from develop',
      },
      { index: 2, ref: 'stash@{2}', branch: null, message: 'autostash' },
    ])
    expect(parseStashList('')).toEqual([])
  })
})

describe('parseRemotes', () => {
  it('keeps fetch URLs only', () => {
    const out = [
      'origin\tgit@bitbucket.org:me/app.git (fetch)',
      'origin\tgit@bitbucket.org:me/app.git (push)',
      'upstream\thttps://bitbucket.org/team/app.git (fetch)',
      'upstream\tno_push (push)',
      'local\tC:\\Users\\John Doe\\repo.git (fetch)',
    ].join('\n')
    expect(parseRemotes(out)).toEqual({
      origin: 'git@bitbucket.org:me/app.git',
      upstream: 'https://bitbucket.org/team/app.git',
      local: 'C:\\Users\\John Doe\\repo.git',
    })
  })
})

describe('classifyGitFailure', () => {
  it.each([
    ['fatal: not a git repository (or any of the parent directories): .git', 'not-a-repo'],
    ["fatal: could not read Username for 'https://x': terminal prompts disabled", 'auth'],
    ['git@bitbucket.org: Permission denied (publickey).', 'auth'],
    ['CONFLICT (content): Merge conflict in a.txt\nAutomatic merge failed', 'conflict'],
    ['error: could not apply 1a2b3c... change', 'conflict'],
    [
      'error: Your local changes to the following files would be overwritten by merge:',
      'dirty-tree',
    ],
    ['error: cannot rebase: You have unstaged changes.', 'dirty-tree'],
    [' ! [rejected]        main -> main (non-fast-forward)', 'non-fast-forward'],
    ['fatal: Not possible to fast-forward, aborting.', 'non-fast-forward'],
    ['fatal: something else went wrong', 'failed'],
  ] as const)('%s → %s', (output, kind) => {
    expect(classifyGitFailure(output)).toBe(kind)
  })
})

describe('unsafeReason (destructive-command guard)', () => {
  it.each([
    [['push', '--force'], 'force push'],
    [['push', '-f', 'origin', 'main'], 'force push'],
    [['push', '-uf', 'origin', 'x'], 'force push'],
    [['push', '--force-with-lease'], 'force push'],
    [['push', 'origin', '+main'], 'force push'],
    [['push', 'origin', ':feature'], 'remote branch delete'],
    [['push', '--delete', 'origin', 'x'], 'remote branch delete'],
    [['reset', '--hard', 'origin/main'], 'reset --hard'],
    [['clean', '-fd'], 'git clean'],
    [['checkout', '-f', 'main'], 'checkout --force'],
    [['branch', '-D', 'x'], 'branch delete'],
    // Global options before the subcommand must not hide it.
    [['-c', 'core.x=y', 'push', '--force'], 'force push'],
    [['-C', '/repo', 'reset', '--hard'], 'reset --hard'],
    [['-c', 'alias.p=push --force', 'p'], 'alias override'],
    [['-calias.p=push -f', 'p'], 'alias override'],
    // Abbreviated long options are accepted by git.
    [['push', '--forc'], 'force push'],
    [['push', '--force-with'], 'force push'],
    [['reset', '--har'], 'reset --hard'],
    [['push', '--mirror', 'origin'], 'mirror/prune push'],
    [['push', '--prune', 'origin', 'refs/heads/*'], 'mirror/prune push'],
    [['push', '-d', 'origin', 'x'], 'remote branch delete'],
    [['checkout', '--', '.'], 'checkout of paths'],
    [['checkout', 'HEAD', '--', 'src/a.ts'], 'checkout of paths'],
    [['checkout', '-B', 'main', 'origin/main'], 'checkout overwriting a branch'],
    [['switch', '-C', 'main'], 'switch overwriting a branch'],
    [['restore', 'src/a.ts'], 'git restore'],
    [['branch', '-f', 'main', 'origin/main'], 'branch --force'],
    [['stash', 'drop'], 'stash drop'],
    [['stash', 'clear'], 'stash clear'],
  ])('blocks git %j', (args, reason) => {
    expect(unsafeReason(args)).toBe(reason)
  })
  it.each([
    [['push', '-u', 'origin', 'feature/x']],
    [['push', 'origin', 'develop:develop']],
    [['push', '--follow-tags', 'origin', 'x']],
    [['reset', '--soft', 'HEAD~1']],
    [['fetch', 'origin', 'develop:develop']],
    [['checkout', '-b', 'feature/x', 'origin/develop']],
    [['merge', '--abort']],
    [['rebase', '--abort']],
    [['stash', 'push', '-m', 'devdock: x']],
    [['stash', 'pop']],
    [['-c', 'core.x=y', 'fetch', '--all', '--prune']],
    [['branch', '--list']],
  ])('allows git %j', (args) => {
    expect(unsafeReason(args)).toBeNull()
  })
})
