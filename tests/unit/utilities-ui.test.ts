import { describe, expect, it } from 'vitest'
import { filterPorts, fromLines, toLines } from '../../src/renderer/features/utilities/pure'
import { formatBytes, type ListeningPort } from '../../src/shared/utilities'

const row = (port: number, process = 'node'): ListeningPort => ({
  port,
  pid: port,
  process,
  command: null,
  addresses: ['*'],
})
const ROWS = [row(3000), row(3011), row(5173), row(5180), row(8080, 'java'), row(49152, 'rapportd')]

describe('Utilities view helpers', () => {
  it('SPEC 6.6 quick filters 3000–3010, 5173–5180, 8080 (inclusive) and a typed port or name', () => {
    const ports = (f: Parameters<typeof filterPorts>[1], typed = '') =>
      filterPorts(ROWS, f, typed).map((r) => r.port)
    expect(ports('all')).toEqual([3000, 3011, 5173, 5180, 8080, 49152])
    expect(ports('3000–3010')).toEqual([3000])
    expect(ports('5173–5180')).toEqual([5173, 5180])
    expect(ports('8080')).toEqual([8080])
    expect(ports('all', '51')).toEqual([5173, 5180])
    expect(ports('all', 'JAVA')).toEqual([8080])
  })

  it('draft lines: one item per line, bullets and blanks dropped', () => {
    expect(fromLines('- one\n\n  * two  \n• three\nfour')).toEqual(['one', 'two', 'three', 'four'])
    expect(toLines(['a', 'b'])).toBe('a\nb')
    expect(fromLines(toLines(['x - y']))).toEqual(['x - y'])
  })

  it('sizes in binary units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })
})
