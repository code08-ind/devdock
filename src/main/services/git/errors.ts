/** Typed git failures (BUILD-PROMPTS P1) so the UI can explain what happened and what to do. */
export const GIT_ERROR_KINDS = [
  'git-missing',
  'not-a-repo',
  'dirty-tree',
  'conflict',
  'non-fast-forward',
  'auth',
  'timeout',
  'unsafe',
  'failed',
] as const
export type GitErrorKind = (typeof GIT_ERROR_KINDS)[number]

export class GitError extends Error {
  constructor(
    readonly kind: GitErrorKind,
    /** Raw git output for the "Details" disclosure. */
    readonly details = '',
    readonly args: readonly string[] = [],
    message: string = messageFor(kind),
  ) {
    super(message)
    this.name = 'GitError'
  }
}

const MESSAGES: Record<GitErrorKind, string> = {
  'git-missing': 'Git is not installed or not on PATH. Install Git and restart DevDock.',
  'not-a-repo': 'This folder is not a git repository.',
  'dirty-tree': 'You have uncommitted changes. Commit them, or use Stash & continue.',
  conflict: 'Git stopped because of conflicts. Resolve them in your editor, or abort.',
  'non-fast-forward':
    'The branches have diverged, so a fast-forward is not possible. Nothing was changed.',
  auth: 'Git could not authenticate with the remote. Check your git credential helper or SSH key.',
  timeout: 'Git took too long and was stopped.',
  unsafe: 'DevDock refused to run a destructive git command.',
  failed: 'Git reported an error.',
}

export function messageFor(kind: GitErrorKind): string {
  return MESSAGES[kind]
}

/** Ordered: the first matching pattern wins. Matched against LC_ALL=C (English) output. */
const PATTERNS: [GitErrorKind, RegExp][] = [
  ['not-a-repo', /not a git repository/i],
  [
    'auth',
    /Authentication failed|could not read Username|Permission denied \(publickey|terminal prompts disabled|HTTP Basic: Access denied|403 Forbidden|invalid credentials/i,
  ],
  [
    'conflict',
    /CONFLICT \(|Automatic merge failed|could not apply|Resolve all conflicts|You have unmerged paths|unmerged files|Merge conflict in/i,
  ],
  [
    'dirty-tree',
    /Your local changes to the following files would be overwritten|cannot (pull|rebase) with uncommitted changes|You have unstaged changes|Please commit your changes or stash them|contains modified or untracked files/i,
  ],
  [
    'non-fast-forward',
    /non-fast-forward|\[rejected\]|Not possible to fast-forward|fetch first|diverging branches|\(non-fast-forward\)/i,
  ],
]

/** Classifies a failed git run from its output. */
export function classifyGitFailure(output: string): GitErrorKind {
  for (const [kind, re] of PATTERNS) if (re.test(output)) return kind
  return 'failed'
}
