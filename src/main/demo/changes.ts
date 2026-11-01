/**
 * Demo PR descriptions and changed files (T7), the same for Bitbucket, GitHub and GitLab demo
 * PRs: made from the PR's title, so each reads like its change. Deterministic: the same PR
 * always shows the same files.
 */
export interface DemoFile {
  path: string
  status: 'added' | 'modified' | 'removed' | 'renamed'
  added: number
  removed: number
}

const slug = (title: string) =>
  title
    .replace(/^[A-Z][A-Z0-9_]*-\d+:\s*/, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join('')

/** A short description in the usual shape: what, why, how to test. */
export function demoDescription(title: string): string {
  const what = title.replace(/^[A-Z][A-Z0-9_]*-\d+:\s*/, '')
  return [
    `${what}.`,
    '',
    '## Why',
    'Reported by the team during the last sprint review; it slows down day-to-day work.',
    '',
    '## How to test',
    '1. Run the app in dev mode.',
    '2. Follow the steps in the ticket and check the new behaviour.',
  ].join('\n')
}

export function demoFiles(title: string): DemoFile[] {
  const name = slug(title) || 'Change'
  const n = title.length
  return [
    {
      path: `src/components/${name}.tsx`,
      status: 'modified',
      added: 20 + (n % 30),
      removed: 4 + (n % 9),
    },
    { path: `src/components/${name}.test.tsx`, status: 'added', added: 30 + (n % 20), removed: 0 },
    { path: `src/hooks/use${name}.ts`, status: 'modified', added: 8 + (n % 7), removed: 2 },
    { path: 'CHANGELOG.md', status: 'modified', added: 1, removed: 0 },
  ]
}
