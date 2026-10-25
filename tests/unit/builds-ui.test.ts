import { describe, expect, it } from 'vitest'
import { appendConsole, matchingLines } from '../../src/renderer/features/builds/console'
import { jobPathFrom, triggerRefusal } from '../../src/shared/jenkins'

describe('console tail text (P4.04 UI side)', () => {
  it('appends chunks and keeps the end past the limit', () => {
    expect(appendConsole('abc', 'def')).toBe('abcdef')
    expect(appendConsole('abcdef', 'gh', 5)).toBe('defgh')
  })

  it('search lists matching lines with their numbers, ignoring case', () => {
    const log = 'Started\n+ npm test\n FAIL  DatePicker.test.tsx\nFinished: FAILURE\n'
    expect(matchingLines(log, 'fail')).toEqual([
      { n: 3, line: ' FAIL  DatePicker.test.tsx' },
      { n: 4, line: 'Finished: FAILURE' },
    ])
    expect(matchingLines(log, '   ')).toEqual([])
  })
})

describe('Settings → Jenkins job entries', () => {
  const BASE = 'https://ci.example.com/jenkins'
  it('accepts job paths and job links on the configured site', () => {
    expect(jobPathFrom(' /apps/web-app/ ', BASE)).toBe('apps/web-app')
    expect(jobPathFrom(`${BASE}/job/apps/job/web-app/`, BASE)).toBe('apps/web-app')
    expect(jobPathFrom(`${BASE}/job/web-app/job/feature%252Fx/3/console`, BASE)).toBe(
      'web-app/feature%2Fx',
    )
  })
  it('refuses links elsewhere (or with no server set) and bad paths', () => {
    expect(jobPathFrom('https://other.example.com/job/a/', BASE)).toBeNull()
    expect(jobPathFrom(`${BASE}/job/a/`, '')).toBeNull()
    expect(jobPathFrom('apps/../x', BASE)).toBeNull()
  })
})

describe('trigger button rule (same as the handler)', () => {
  const s = (jobTriggers: boolean, allowedJobs: string[], protectedPatterns = ['prod']) => ({
    features: { jobTriggers, allowedJobs },
    jenkins: { protectedPatterns },
  })
  it('protected beats everything; then the switch; then the allow-list', () => {
    expect(triggerRefusal('apps/deploy-prod', s(true, ['apps/deploy-prod']))).toBe('protected')
    expect(triggerRefusal('apps/deploy-dev', s(false, ['apps/deploy-dev']))).toBe('off')
    expect(triggerRefusal('apps/deploy-dev', s(true, ['web-app/develop']))).toBe('not-allowed')
    expect(triggerRefusal('Apps/Deploy-Dev', s(true, ['apps/deploy-dev']))).toBeNull()
  })
})
