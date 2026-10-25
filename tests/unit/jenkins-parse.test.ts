import { describe, expect, it } from 'vitest'
import {
  MAX_CHUNK_CHARS,
  cleanConsole,
  consoleChunk,
} from '../../src/main/services/jenkins/console'
import {
  buildActions,
  buildState,
  buildTimes,
  parseStages,
} from '../../src/main/services/jenkins/wfapi'
import { jenkins } from '../fixtures/jenkins'

describe('wfapi stage parsing', () => {
  it('maps every documented status', () => {
    const statuses = [
      'SUCCESS',
      'FAILED',
      'UNSTABLE',
      'ABORTED',
      'IN_PROGRESS',
      'PAUSED_PENDING_INPUT',
      'QUEUED',
      'NOT_EXECUTED',
      'SOMETHING_NEW',
    ]
    const stages = parseStages({
      stages: statuses.map((status, i) => ({
        name: `s${i}`,
        status,
        startTimeMillis: 1000 + i,
        durationMillis: 10,
      })),
    })
    expect(stages?.map((s) => s.state)).toEqual([
      'success',
      'failed',
      'unstable',
      'aborted',
      'running',
      'paused',
      'queued',
      'skipped',
      'unknown',
    ])
  })

  it('keeps times of finished stages; running and never-started stages have none', () => {
    const stages = parseStages({
      stages: [
        { name: 'Build', status: 'SUCCESS', startTimeMillis: 1_000, durationMillis: 5_000 },
        { name: 'Test', status: 'IN_PROGRESS', startTimeMillis: 6_000, durationMillis: 1_234 },
        { name: 'Deploy', status: 'NOT_EXECUTED', startTimeMillis: 0, durationMillis: 0 },
      ],
    })
    expect(stages).toEqual([
      { name: 'Build', state: 'success', startedAt: 1_000, durationMs: 5_000 },
      { name: 'Test', state: 'running', startedAt: 6_000, durationMs: null },
      { name: 'Deploy', state: 'skipped', startedAt: null, durationMs: 0 },
    ])
  })

  it('no stages list (not a Pipeline answer) → null; odd entries survive', () => {
    expect(parseStages({ id: '3', status: 'SUCCESS' })).toBeNull()
    expect(parseStages('<html>')).toBeNull()
    expect(parseStages(null)).toBeNull()
    expect(parseStages({ stages: [] })).toEqual([])
    expect(parseStages({ stages: [null, { status: 7 }] })).toEqual([
      { name: 'Unnamed stage', state: 'unknown', startedAt: null, durationMs: null },
      { name: 'Unnamed stage', state: 'unknown', startedAt: null, durationMs: null },
    ])
  })

  it('build state: building wins; result null after the run counts as running', () => {
    expect(buildState({ building: true, result: null })).toBe('running')
    expect(buildState({ building: true, result: 'SUCCESS' })).toBe('running')
    expect(buildState({ building: false, result: null })).toBe('running')
    expect(buildState({ building: false, result: 'SUCCESS' })).toBe('success')
    expect(buildState({ building: false, result: 'FAILURE' })).toBe('failed')
    expect(buildState({ building: false, result: 'UNSTABLE' })).toBe('unstable')
    expect(buildState({ building: false, result: 'ABORTED' })).toBe('aborted')
    expect(buildState({ building: false, result: 'NOT_BUILT' })).toBe('not_built')
    expect(buildState({ building: false, result: 'WEIRD' })).toBe('failed')
  })

  it('build times: no duration while running, no estimate when Jenkins has none (-1)', () => {
    expect(
      buildTimes({ building: true, timestamp: 5, duration: 0, estimatedDuration: -1 }),
    ).toEqual({
      startedAt: 5,
      durationMs: null,
      estimatedMs: null,
    })
  })

  it('build actions: parameters as text, password values never read', () => {
    expect(buildActions(jenkins.build)).toEqual({
      parameters: [
        { name: 'TARGET', value: 'dev' },
        { name: 'SKIP_E2E', value: 'true' },
      ],
      causes: ['Pull request #42 updated'],
    })
  })
})

describe('progressive console offsets', () => {
  const h = (textSize: string | null, moreData: string | null = null) => ({ textSize, moreData })
  const b = (text: string) => new TextEncoder().encode(text)

  it('next start is X-Text-Size; X-More-Data says whether to keep asking', () => {
    expect(consoleChunk(0, b('abc\n'), h('4', 'true'))).toEqual({
      text: 'abc\n',
      nextStart: 4,
      more: true,
      reset: false,
      truncated: false,
    })
    expect(consoleChunk(4, b(''), h('4'))).toMatchObject({ text: '', nextStart: 4, more: false })
  })

  it('without X-Text-Size, counts the bytes received (UTF-8, not characters)', () => {
    expect(consoleChunk(10, b('✓ built\n'), h(null)).nextStart).toBe(10 + 10)
  })

  it('a character cut at the chunk end is held back and read whole next time', () => {
    const bytes = b('ok ✓') // ✓ = e2 9c 93
    const cut = consoleChunk(0, bytes.subarray(0, 5), h('5', 'true'))
    expect(cut).toMatchObject({ text: 'ok ', nextStart: 3 })
    expect(consoleChunk(3, bytes.subarray(3), h('6', 'true'))).toMatchObject({
      text: '✓',
      nextStart: 6,
    })
    // A finished log keeps nothing back (shown as a replacement character).
    expect(consoleChunk(0, bytes.subarray(0, 5), h('5')).nextStart).toBe(5)
  })

  it('a log shorter than the offset was replaced: reset and read from 0', () => {
    expect(consoleChunk(500, b(''), h('120', 'true'))).toEqual({
      text: '',
      nextStart: 0,
      more: true,
      reset: true,
      truncated: false,
    })
  })

  it('ignores unreadable headers', () => {
    expect(consoleChunk(3, b('xy'), h('12abc', 'TRUE '))).toMatchObject({
      nextStart: 5,
      more: true,
    })
    expect(consoleChunk(3, b('xy'), h('-1'))).toMatchObject({ nextStart: 5 })
  })

  it('strips ANSI codes and hidden console notes, but offsets stay in raw bytes', () => {
    const raw = '\u001b[8mha:////4LuTVO2+abc=\u001b[0m[Pipeline] stage\n\u001b[32m✔\u001b[0m ok\n'
    expect(cleanConsole(raw)).toBe('[Pipeline] stage\n✔ ok\n')
    const size = String(Buffer.byteLength(raw))
    expect(consoleChunk(0, b(raw), h(size)).nextStart).toBe(Buffer.byteLength(raw))
  })

  it('keeps the end of an oversized chunk', () => {
    const big = 'a'.repeat(MAX_CHUNK_CHARS) + 'END'
    const chunk = consoleChunk(0, b(big), h(String(big.length)))
    expect(chunk.truncated).toBe(true)
    expect(chunk.text).toHaveLength(MAX_CHUNK_CHARS)
    expect(chunk.text.endsWith('END')).toBe(true)
  })

  it('reading a growing log chunk by chunk rebuilds it exactly once', () => {
    const log = Buffer.from('Started\n✓ step 1\nstep 2 — ok\nFinished: SUCCESS\n')
    // 9, 10 and 27 cut inside "✓" and "—" (3 bytes each in UTF-8).
    const growth = [8, 9, 10, 27, 27, log.length, log.length]
    let start = 0
    let text = ''
    for (const [i, size] of growth.entries()) {
      const more = i < growth.length - 1
      const chunk = consoleChunk(
        start,
        log.subarray(start, size),
        h(String(size), more ? 'true' : null),
      )
      text += chunk.text
      start = chunk.nextStart
      if (!chunk.more) break
    }
    expect(text).toBe(log.toString())
    expect(start).toBe(log.length)
  })
})
