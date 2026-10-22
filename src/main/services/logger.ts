import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SECRET_PARAM = /([?&](?:[\w-]*?)(?:token|key|secret|password)[\w-]*=)[^&#\s"']*/gi
const AUTH_HEADER =
  /\b(authorization|proxy-authorization)(["']?\s*[:=]\s*["']?)(?:(basic|bearer|token)\s+)?[^\s"',}]+/gi
const BARE_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g
const SECRET_FIELD =
  /(["']?(?:[\w-]*?)(?:token|secret|password|apikey|api_key)["']?\s*[:=]\s*["']?)(?!\[REDACTED\])[^\s"',}&#]+/gi
const URL_CREDENTIALS = /(\bhttps?:\/\/)[^\s/@:]+:[^\s/@]+@/gi

export const REDACTED = '[REDACTED]'

/** Removes credentials from a log line. Pure; unit-tested. */
export function redact(input: string): string {
  return input
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
    .replace(
      AUTH_HEADER,
      (_m, name: string, sep: string, scheme?: string) =>
        `${name}${sep}${scheme ? `${scheme} ` : ''}${REDACTED}`,
    )
    .replace(BARE_SCHEME, `$1 ${REDACTED}`)
    .replace(SECRET_PARAM, `$1${REDACTED}`)
    .replace(SECRET_FIELD, `$1${REDACTED}`)
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error)
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerOptions {
  dir: string
  fileName?: string
  maxBytes?: number
  maxFiles?: number
  /** Also write to stdout/stderr (dev only). */
  echo?: boolean
}

export class Logger {
  readonly dir: string
  readonly file: string
  private readonly maxBytes: number
  private readonly maxFiles: number
  private readonly echo: boolean

  constructor(opts: LoggerOptions) {
    this.dir = opts.dir
    this.file = join(opts.dir, opts.fileName ?? 'devdock.log')
    this.maxBytes = opts.maxBytes ?? 1_000_000
    this.maxFiles = opts.maxFiles ?? 5
    this.echo = opts.echo ?? false
    mkdirSync(this.dir, { recursive: true })
  }

  debug(...parts: unknown[]): void {
    this.write('debug', parts)
  }
  info(...parts: unknown[]): void {
    this.write('info', parts)
  }
  warn(...parts: unknown[]): void {
    this.write('warn', parts)
  }
  error(...parts: unknown[]): void {
    this.write('error', parts)
  }

  private write(level: LogLevel, parts: unknown[]): void {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${redact(parts.map(stringify).join(' '))}\n`
    try {
      this.rotateIfNeeded(Buffer.byteLength(line))
      appendFileSync(this.file, line, 'utf8')
    } catch {
      // Logging must never crash the app.
    }
    if (this.echo) (level === 'error' ? process.stderr : process.stdout).write(line)
  }

  /** devdock.log -> devdock.log.1 -> ... -> devdock.log.<maxFiles-1>; the oldest is dropped. */
  private rotateIfNeeded(incoming: number): void {
    if (!existsSync(this.file) || statSync(this.file).size + incoming <= this.maxBytes) return
    const oldest = `${this.file}.${this.maxFiles - 1}`
    if (existsSync(oldest)) rmSync(oldest)
    for (let i = this.maxFiles - 2; i >= 1; i--) {
      const from = `${this.file}.${i}`
      if (existsSync(from)) renameSync(from, `${this.file}.${i + 1}`)
    }
    renameSync(this.file, `${this.file}.1`)
  }
}

let current: Logger | null = null

export function initLogger(opts: LoggerOptions): Logger {
  current = new Logger(opts)
  return current
}

/** Global logger; falls back to a no-op before init (e.g. in unit tests). */
export const log = {
  debug: (...p: unknown[]) => current?.debug(...p),
  info: (...p: unknown[]) => current?.info(...p),
  warn: (...p: unknown[]) => current?.warn(...p),
  error: (...p: unknown[]) => current?.error(...p),
}
