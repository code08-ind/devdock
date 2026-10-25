import { accessSync, constants, statSync } from 'node:fs'
import { basename, delimiter, join } from 'node:path'

export type ShellKind = 'zsh' | 'bash' | 'fish' | 'sh' | 'pwsh' | 'powershell' | 'cmd' | 'other'

export interface ShellSpec {
  /** Absolute path of the program to start (resolved here, never through a shell). */
  file: string
  args: string[]
  kind: ShellKind
}

export class ShellNotFoundError extends Error {
  constructor(readonly shell: string) {
    super(`DevDock couldn't find the shell "${shell}". Change it in Settings → Terminal.`)
    this.name = 'ShellNotFoundError'
  }
}

export interface ShellEnv {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  /** Whether `path` is a file DevDock may run (injected for tests). */
  isExecutable?: (path: string) => boolean
}

function defaultIsExecutable(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false
    if (platform !== 'win32') accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function shellKind(file: string): ShellKind {
  const name = basename(file.replace(/\\/g, '/'))
    .toLowerCase()
    .replace(/\.exe$/, '')
  if (name === 'zsh' || name === 'bash' || name === 'fish' || name === 'sh') return name
  if (name === 'pwsh' || name === 'powershell' || name === 'cmd') return name
  return 'other'
}

/** `name` on PATH (Windows: also with .exe), like `which`. */
export function findOnPath(name: string, e: ShellEnv): string | null {
  const isExec = e.isExecutable ?? ((p: string) => defaultIsExecutable(p, e.platform))
  const pathVar = e.env.PATH ?? e.env.Path ?? ''
  const sep = e.platform === 'win32' ? ';' : delimiter
  const names = e.platform === 'win32' && !/\.exe$/i.test(name) ? [`${name}.exe`, name] : [name]
  const joinPath = (dir: string, n: string) =>
    e.platform === 'win32' ? `${dir.replace(/[\\/]+$/, '')}\\${n}` : join(dir, n)
  for (const dir of pathVar.split(sep).filter(Boolean)) {
    for (const n of names) {
      const candidate = joinPath(dir, n)
      if (isExec(candidate)) return candidate
    }
  }
  return null
}

/** Arguments that make each shell a login / interactive shell, as a terminal app would. */
export function loginArgs(kind: ShellKind, platform: NodeJS.Platform): string[] {
  if (kind === 'pwsh' || kind === 'powershell') return ['-NoLogo']
  if (kind === 'cmd') return []
  // macOS terminals start login shells (so ~/.zprofile / ~/.bash_profile run); Linux too here.
  return platform === 'win32' ? [] : ['-l']
}

/**
 * The shell for a new terminal: the Settings override (a known name looked up on PATH, or an
 * absolute path), else $SHELL on macOS/Linux (falling back to zsh / bash / sh), else on
 * Windows PowerShell 7 (`pwsh`) when installed, Windows PowerShell otherwise.
 */
export function resolveShell(override: string, e: ShellEnv): ShellSpec {
  const isExec = e.isExecutable ?? ((p: string) => defaultIsExecutable(p, e.platform))
  const spec = (file: string): ShellSpec => {
    const kind = shellKind(file)
    return { file, kind, args: loginArgs(kind, e.platform) }
  }
  const wanted = override.trim()
  if (wanted) {
    const absolute = wanted.startsWith('/') || /^[A-Za-z]:[\\/]/.test(wanted)
    const file = absolute ? (isExec(wanted) ? wanted : null) : findOnPath(wanted, e)
    if (!file) throw new ShellNotFoundError(wanted)
    return spec(file)
  }
  if (e.platform === 'win32') {
    const pwsh = findOnPath('pwsh', e)
    if (pwsh) return spec(pwsh)
    const root = e.env.SystemRoot ?? e.env.windir ?? 'C:\\Windows'
    const builtIn = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    return spec(isExec(builtIn) ? builtIn : (findOnPath('powershell', e) ?? builtIn))
  }
  const login = e.env.SHELL
  if (login && login.startsWith('/') && isExec(login)) return spec(login)
  for (const fallback of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
    if (isExec(fallback)) return spec(fallback)
  }
  throw new ShellNotFoundError(login || 'zsh')
}
