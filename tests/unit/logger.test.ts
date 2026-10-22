import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Logger, REDACTED, redact } from '../../src/main/services/logger'

describe('redact', () => {
  it.each([
    ['Authorization: Bearer abc.def.ghi', `Authorization: Bearer ${REDACTED}`],
    ['authorization: Basic dXNlcjpwYXNz', `authorization: Basic ${REDACTED}`],
    ['{"Authorization":"Bearer abc123456789"}', `{"Authorization":"Bearer ${REDACTED}"}`],
    ['GET https://x.io/a?token=s3cr3t&page=2', `GET https://x.io/a?token=${REDACTED}&page=2`],
    ['https://x.io/?api_key=k1&apiKey=k2', `https://x.io/?api_key=${REDACTED}&apiKey=${REDACTED}`],
    ['?password=hunter2', `?password=${REDACTED}`],
    ['?client_secret=zzz#frag', `?client_secret=${REDACTED}#frag`],
    ['{"token":"abc","name":"ok"}', `{"token":"${REDACTED}","name":"ok"}`],
    ['https://user:pa55@host.io/repo.git', `https://${REDACTED}@host.io/repo.git`],
    ['sent Bearer eyJhbGciOiJIUzI1NiJ9.x.y', `sent Bearer ${REDACTED}`],
  ])('%s', (input, expected) => {
    expect(redact(input)).toBe(expected)
  })

  it('leaves ordinary text alone', () => {
    const line = 'fetched 12 PRs from https://bitbucket.org/ws/repo?page=2 in 340ms'
    expect(redact(line)).toBe(line)
  })
})

describe('Logger', () => {
  it('writes redacted lines and rotates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdock-log-'))
    const logger = new Logger({ dir, maxBytes: 200, maxFiles: 3 })
    logger.info('request', { headers: { authorization: 'Bearer supersecretvalue' } })
    expect(readFileSync(join(dir, 'devdock.log'), 'utf8')).not.toContain('supersecretvalue')
    for (let i = 0; i < 20; i++) logger.info(`line ${i} ${'x'.repeat(40)}`)
    const files = readdirSync(dir).sort()
    expect(files).toEqual(['devdock.log', 'devdock.log.1', 'devdock.log.2'])
  })

  it('never throws when the log file cannot be written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdock-log-'))
    writeFileSync(join(dir, 'blocker'), '')
    const logger = new Logger({ dir })
    // Point at a path under a regular file: append fails, logger swallows it.
    ;(logger as unknown as { file: string }).file = join(dir, 'blocker', 'x.log')
    expect(() => logger.error('boom')).not.toThrow()
  })
})
