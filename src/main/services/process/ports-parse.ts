import type { ListeningPort } from '@shared/utilities'

/**
 * Parsers for the port scanner (SPEC 6.6). Pure, tested on captured outputs.
 * macOS: `lsof +c 0 -nP -iTCP -sTCP:LISTEN` (+ `ps -o pid=,args=` for full command lines).
 * Windows: `netstat -ano -p tcp` / `-p tcpv6` + `tasklist /FO CSV /NH`.
 */

export interface Listener {
  port: number
  pid: number
  address: string
  /** lsof's COMMAND column (`\x20` for spaces); null on Windows. */
  name: string | null
}

/** `127.0.0.1:5173`, `*:3000`, `[::1]:8080`, `[fe80::1%lo0]:631` → address + port. */
export function splitHostPort(text: string): { address: string; port: number } | null {
  const m = /^(?:\[([^\]]+)\]|([^\s:]+|\*)):(\d{1,5})$/.exec(text.trim())
  if (!m) return null
  const port = Number(m[3])
  if (port < 1 || port > 65535) return null
  return { address: m[1] ?? m[2]!, port }
}

/** lsof rows: `node 4242 me 23u IPv6 0x… 0t0 TCP *:5173 (LISTEN)`. Header and others skipped. */
export function parseLsof(stdout: string): Listener[] {
  const out: Listener[] = []
  for (const line of stdout.split(/\r?\n/)) {
    // COMMAND can contain spaces (escaped as \x20 by lsof, but be lenient): anchor on PID.
    const m = /^(.+?)\s+(\d+)\s+\S+\s+.*\bTCP\s+(\S+)\s+\(LISTEN\)\s*$/.exec(line)
    if (!m) continue
    const hp = splitHostPort(m[3]!)
    if (!hp) continue
    out.push({ ...hp, pid: Number(m[2]), name: m[1]!.replace(/\\x20/g, ' ').trim() })
  }
  return out
}

/** `ps -o pid=,args=` rows: `  4242 node /…/vite --port 5173`. */
export function parsePs(stdout: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line)
    if (m) out.set(Number(m[1]), m[2]!)
  }
  return out
}

/**
 * netstat rows: `TCP  127.0.0.1:5173  0.0.0.0:0  LISTENING  4242`. A listening socket is the
 * one whose foreign address is the any-port (`0.0.0.0:0`, `[::]:0`): the State word is
 * translated on non-English Windows ("ABHÖREN", "ÉCOUTE"), so it isn't relied on.
 */
export function parseNetstat(stdout: string): Listener[] {
  const out: Listener[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5 || !/^TCP/i.test(cols[0]!)) continue
    const [, local, foreign, , pidText] = cols
    if (!/^(0\.0\.0\.0|\[::\]|\*):0$/.test(foreign!)) continue
    const hp = splitHostPort(local!)
    if (!hp || !/^\d+$/.test(pidText!)) continue
    out.push({ ...hp, pid: Number(pidText), name: null })
  }
  return out
}

/** One CSV line with quoted fields (`"a","b,c",""`); `""` inside quotes is a quote. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      fields.push(field)
      field = ''
    } else field += ch
  }
  fields.push(field)
  return fields
}

/** `tasklist /FO CSV /NH`: `"node.exe","4242","Console","1","45,120 K"` → pid → image name. */
export function parseTasklist(stdout: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [name, pidText] = parseCsvLine(line.trim())
    if (name && pidText && /^\d+$/.test(pidText)) out.set(Number(pidText), name)
  }
  return out
}

/**
 * One row per (port, pid): a server listening on IPv4 and IPv6 (or several addresses) is one
 * process to stop. Sorted by port, then pid.
 */
export function groupListeners(
  listeners: Listener[],
  names: Map<number, string>,
  commands: Map<number, string>,
): ListeningPort[] {
  const rows = new Map<string, ListeningPort>()
  for (const l of listeners) {
    const key = `${l.port}:${l.pid}`
    const row = rows.get(key) ?? {
      port: l.port,
      pid: l.pid,
      process: names.get(l.pid) ?? l.name ?? 'unknown',
      command: commands.get(l.pid) ?? null,
      addresses: [],
    }
    if (!row.addresses.includes(l.address)) row.addresses.push(l.address)
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => a.port - b.port || a.pid - b.pid)
}
