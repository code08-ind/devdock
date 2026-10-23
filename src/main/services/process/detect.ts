/** Finds the dev server URL in its output (Vite "Local:" line, else any localhost URL). Pure. */

// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC (\x1b).
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const VITE_LOCAL = /Local:\s+(https?:\/\/[^\s]+)/i
const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b[^\s'"]*/i

export interface DetectedUrl {
  url: string
  port: number
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

export function detectUrl(output: string): DetectedUrl | null {
  const text = stripAnsi(output)
  const vite = VITE_LOCAL.exec(text)
  const candidate = vite?.[1] ?? LOCAL_URL.exec(text)?.[0]
  if (!candidate) return null
  try {
    const url = new URL(candidate.replace(/[),.;]+$/, ''))
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    // 0.0.0.0 is a bind address, not something a browser should open.
    if (url.hostname === '0.0.0.0') url.hostname = 'localhost'
    return { url: url.toString(), port }
  } catch {
    return null
  }
}
