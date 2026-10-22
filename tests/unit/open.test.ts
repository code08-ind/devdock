import { describe, expect, it } from 'vitest'
import { editorCommand, editorFallback, terminalCommand } from '../../src/main/services/open'

describe('open commands', () => {
  const dir = '/Users/me/My Repo'
  it('editor: runs the configured binary with the folder as one argument', () => {
    expect(editorCommand('code', dir, 'darwin')).toEqual({ file: 'code', args: [dir] })
    expect(editorCommand('/usr/local/bin/code', dir, 'linux').args).toEqual([dir])
  })
  it('editor on Windows: .cmd launchers go through cmd.exe with the folder as cwd, never parsed', () => {
    const folder = 'C:\\R&D\\app (old)'
    const cmd = editorCommand('code', folder, 'win32')
    expect(cmd).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '""code" ."'],
      cwd: folder,
      verbatim: true,
    })
    expect(cmd.args.join(' ')).not.toContain('R&D')
    expect(editorCommand('C:\\VSCode\\Code.exe', 'C:\\work\\app', 'win32')).toEqual({
      file: 'C:\\VSCode\\Code.exe',
      args: ['C:\\work\\app'],
    })
  })
  it('editor fallback only on macOS (bundle id, not PATH)', () => {
    expect(editorFallback(dir, 'darwin')).toEqual({
      file: 'open',
      args: ['-b', 'com.microsoft.VSCode', dir],
    })
    expect(editorFallback(dir, 'win32')).toBeNull()
  })
  it('terminal per OS', () => {
    expect(terminalCommand(dir, 'darwin')).toEqual({ file: 'open', args: ['-a', 'Terminal', dir] })
    const win = terminalCommand('C:\\R&D', 'win32')
    expect(win).toEqual({ file: 'cmd.exe', args: ['/d', '/c', 'start', 'cmd.exe'], cwd: 'C:\\R&D' })
    expect(terminalCommand(dir, 'linux')).toEqual({
      file: 'x-terminal-emulator',
      args: [],
      cwd: dir,
    })
  })
})
