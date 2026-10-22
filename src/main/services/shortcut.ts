import type { ShortcutResult } from '@shared/ipc'

const MODIFIERS = new Set([
  'command',
  'cmd',
  'control',
  'ctrl',
  'commandorcontrol',
  'cmdorctrl',
  'alt',
  'option',
  'altgr',
  'shift',
  'super',
  'meta',
])
const KEY =
  /^([a-z0-9]|f([1-9]|1\d|2[0-4])|space|tab|backspace|delete|insert|return|enter|up|down|left|right|home|end|pageup|pagedown|escape|esc|plus|[`\-=[\];',./\\])$/i

/** Normalise to a comparable, platform-resolved form, e.g. "cmd+shift+space" on macOS. */
export function normalizeAccelerator(acc: string, platform: NodeJS.Platform): string {
  const parts = acc.split('+').map((p) => p.trim().toLowerCase())
  const mapped = parts.map((p) => {
    if (p === 'commandorcontrol' || p === 'cmdorctrl') return platform === 'darwin' ? 'cmd' : 'ctrl'
    if (p === 'command' || p === 'meta' || (p === 'super' && platform === 'darwin')) return 'cmd'
    if (p === 'control') return 'ctrl'
    if (p === 'option') return 'alt'
    if (p === 'return') return 'enter'
    if (p === 'esc') return 'escape'
    return p
  })
  const key = mapped.filter((p) => !MODIFIERS.has(p) && p !== 'cmd' && p !== 'ctrl')
  const mods = [...new Set(mapped.filter((p) => !key.includes(p)))].sort()
  return [...mods, ...key].join('+')
}

/** OS-level combos we never take, even if register() would succeed. */
const RESERVED: Record<string, string[]> = {
  darwin: [
    'cmd+space',
    'alt+cmd+space',
    'cmd+tab',
    'cmd+q',
    'cmd+w',
    'cmd+h',
    'cmd+m',
    'cmd+shift+3',
    'cmd+shift+4',
    'cmd+shift+5',
    'cmd+ctrl+q',
    'ctrl+space',
    'alt+cmd+escape',
  ],
  win32: [
    'alt+tab',
    'alt+f4',
    'ctrl+escape',
    'ctrl+shift+escape',
    'super+l',
    'super+d',
    'super+e',
    'super+r',
    'super+tab',
    'super+space',
    'alt+ctrl+delete',
  ],
  linux: ['alt+tab', 'alt+f4', 'super+l'],
}

export type AcceleratorCheck = { ok: true } | { ok: false; reason: string }

/** Pure validation before we ask the OS. */
export function checkAccelerator(acc: string, platform: NodeJS.Platform): AcceleratorCheck {
  const parts = acc.split('+').map((p) => p.trim())
  if (parts.some((p) => p === '')) return { ok: false, reason: 'That shortcut is not valid.' }
  const keys = parts.filter((p) => !MODIFIERS.has(p.toLowerCase()))
  const mods = parts.filter((p) => MODIFIERS.has(p.toLowerCase()))
  if (keys.length !== 1 || !KEY.test(keys[0]!)) {
    return {
      ok: false,
      reason: 'Use modifiers plus exactly one key, e.g. CommandOrControl+Shift+Space.',
    }
  }
  if (mods.length === 0 && !/^f\d+$/i.test(keys[0]!)) {
    return {
      ok: false,
      reason: 'A global shortcut needs at least one modifier (Ctrl, Cmd, Alt or Shift).',
    }
  }
  if (mods.every((m) => m.toLowerCase() === 'shift') && mods.length > 0) {
    return { ok: false, reason: 'Shift alone would block normal typing. Add Ctrl/Cmd or Alt.' }
  }
  const norm = normalizeAccelerator(acc, platform)
  if ((RESERVED[platform] ?? []).includes(norm)) {
    return { ok: false, reason: 'That shortcut is reserved by the operating system.' }
  }
  return { ok: true }
}

export interface GlobalShortcutLike {
  register(acc: string, cb: () => void): boolean
  unregister(acc: string): void
  isRegistered(acc: string): boolean
}

/** Owns the single palette shortcut; on conflict it keeps the previous working one. */
export class ShortcutService {
  private current: string | null = null
  private lastResult: ShortcutResult = { ok: false, accelerator: '', reason: 'Not registered yet.' }

  constructor(
    private readonly gs: GlobalShortcutLike,
    private readonly onTrigger: () => void,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  set(acc: string): ShortcutResult {
    const check = checkAccelerator(acc, this.platform)
    if (!check.ok) return (this.lastResult = { ok: false, accelerator: acc, reason: check.reason })
    if (this.current === acc && this.gs.isRegistered(acc)) {
      return (this.lastResult = { ok: true, accelerator: acc })
    }
    const previous = this.current
    if (previous) this.gs.unregister(previous)
    let registered = false
    try {
      registered = this.gs.register(acc, this.onTrigger)
    } catch {
      registered = false
    }
    if (!registered) {
      if (previous) this.gs.register(previous, this.onTrigger)
      return (this.lastResult = {
        ok: false,
        accelerator: acc,
        reason: 'Another app is already using that shortcut. Pick a different one.',
      })
    }
    this.current = acc
    return (this.lastResult = { ok: true, accelerator: acc })
  }

  status(): ShortcutResult {
    return this.lastResult
  }

  /** The accelerator currently registered with the OS, if any. */
  active(): string | null {
    return this.current
  }

  dispose(): void {
    if (this.current) this.gs.unregister(this.current)
    this.current = null
  }
}
