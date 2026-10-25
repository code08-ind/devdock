import type { Commit } from '../services/standup'

/**
 * Demo commits for the standup draft (demo mode has no repos of its own): three on the
 * previous working day, timed from its start.
 */
export function demoCommits(from: Date): Commit[] {
  const at = (hours: number) => new Date(from.getTime() + hours * 3_600_000).toISOString()
  return [
    {
      repo: 'web-app',
      subject: 'DD-101: keep focus on the trigger after a month change',
      at: at(10),
    },
    { repo: 'web-app', subject: 'DD-101: regression test for month navigation', at: at(11.5) },
    { repo: 'design-system', subject: 'Button: aria-busy while loading', at: at(15) },
  ]
}
