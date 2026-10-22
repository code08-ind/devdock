/** Pure parsers for git's machine-readable output. Tested on fixtures in tests/unit/git-parse. */

export interface BranchInfo {
  /** Branch name, or null when HEAD is detached. */
  head: string | null
  oid: string | null
  upstream: string | null
  /** Commits ahead of / behind the upstream; null when there is no upstream. */
  ahead: number | null
  behind: number | null
}

export interface WorkingTree {
  branch: BranchInfo
  /** Tracked files with staged or unstaged changes. */
  changed: number
  untracked: number
  /** Paths with unresolved conflicts. */
  conflicted: string[]
}

/** Parses `git status --porcelain=v2 --branch` (optionally with -z; both are accepted). */
export function parseStatusV2(out: string): WorkingTree {
  const branch: BranchInfo = { head: null, oid: null, upstream: null, ahead: null, behind: null }
  let changed = 0
  let untracked = 0
  const conflicted: string[] = []
  const z = out.includes('\0')
  const records = z ? out.split('\0') : out.split('\n')
  for (let i = 0; i < records.length; i++) {
    const line = records[i]!
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice(13)
      branch.oid = oid === '(initial)' ? null : oid
    } else if (line.startsWith('# branch.head ')) {
      const head = line.slice(14)
      branch.head = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      branch.upstream = line.slice(18)
    } else if (line.startsWith('# branch.ab ')) {
      const m = /^\+(\d+) -(\d+)$/.exec(line.slice(12))
      if (m) {
        branch.ahead = Number(m[1])
        branch.behind = Number(m[2])
      }
    } else if (line.startsWith('1 ')) {
      changed++
    } else if (line.startsWith('2 ')) {
      changed++
      // With -z the original path of a rename is the next record.
      if (z) i++
    } else if (line.startsWith('u ')) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      conflicted.push(line.split(' ').slice(10).join(' '))
    } else if (line.startsWith('? ')) {
      untracked++
    }
  }
  return { branch, changed, untracked, conflicted }
}

/** Parses `git rev-list --left-right --count A...B` → commits only in A (left), only in B (right). */
export function parseLeftRight(out: string): { left: number; right: number } {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(out)
  if (!m) throw new Error(`Unexpected rev-list output: ${JSON.stringify(out)}`)
  return { left: Number(m[1]), right: Number(m[2]) }
}

export interface StashEntry {
  index: number
  ref: string
  /** The branch the stash was made on, when git recorded it. */
  branch: string | null
  message: string
}

/** Parses the default `git stash list` output, e.g. `stash@{0}: WIP on main: abc123 msg`. */
export function parseStashList(out: string): StashEntry[] {
  const entries: StashEntry[] = []
  for (const line of out.split('\n')) {
    const m = /^(stash@\{(\d+)\}): (.*)$/.exec(line.trim())
    if (!m) continue
    const rest = m[3]!
    const on = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(rest)
    entries.push({
      index: Number(m[2]),
      ref: m[1]!,
      branch: on ? on[1]! : null,
      message: on ? on[2]! : rest,
    })
  }
  return entries
}

/** Parses `git remote -v` into name → fetch URL. */
export function parseRemotes(out: string): Record<string, string> {
  const remotes: Record<string, string> = {}
  for (const line of out.split('\n')) {
    // The URL may contain spaces (local paths such as C:\Users\John Doe\repo).
    const m = /^(\S+)\s+(.+?)\s+\(fetch\)$/.exec(line.trim())
    if (m) remotes[m[1]!] = m[2]!
  }
  return remotes
}
