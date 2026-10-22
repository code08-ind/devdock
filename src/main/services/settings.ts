import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import {
  SETTINGS_VERSION,
  SettingsSchema,
  defaultSettings,
  type Settings,
  type SettingsPatch,
} from '@shared/settings'
import { log } from './logger'

type Raw = Record<string, unknown>

/** migrations[n] upgrades a version-n object to version n+1. */
export type Migrations = Record<number, (raw: Raw) => Raw>

export const MIGRATIONS: Migrations = {
  // v0: pre-release files had no version and a flat `theme` key.
  0: (raw) => {
    const { theme, ...rest } = raw
    const appearance = { ...((rest.appearance as Raw | undefined) ?? {}) }
    if (typeof theme === 'string' && appearance.theme === undefined) appearance.theme = theme
    return { ...rest, appearance, version: 1 }
  },
}

export type MigrationResult =
  { ok: true; settings: Settings; migratedFrom: number | null } | { ok: false; reason: string }

export function migrate(
  input: unknown,
  migrations: Migrations = MIGRATIONS,
  target = SETTINGS_VERSION,
): MigrationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'Settings file is not a JSON object.' }
  }
  let raw = input as Raw
  const start = typeof raw.version === 'number' ? raw.version : 0
  if (!Number.isInteger(start) || start < 0)
    return { ok: false, reason: 'Invalid settings version.' }
  if (start > target) {
    return { ok: false, reason: `Settings were written by a newer DevDock (v${start}).` }
  }
  for (let v = start; v < target; v++) {
    const step = migrations[v]
    if (!step) return { ok: false, reason: `No migration from settings v${v}.` }
    raw = step(raw)
  }
  const parsed = SettingsSchema.safeParse({ ...raw, version: target })
  if (!parsed.success)
    return { ok: false, reason: parsed.error.issues[0]?.message ?? 'Invalid settings.' }
  return { ok: true, settings: parsed.data, migratedFrom: start === target ? null : start }
}

export function applyPatch(current: Settings, patch: SettingsPatch): Settings {
  const next: Raw = { ...current }
  for (const [section, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const base = (current as unknown as Raw)[section] as Raw
    const merged: Raw = { ...base }
    for (const [k, v] of Object.entries(value as Raw)) {
      if (v === undefined) continue
      const prev = base[k]
      merged[k] =
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        prev &&
        typeof prev === 'object' &&
        !Array.isArray(prev)
          ? { ...(prev as Raw), ...(v as Raw) }
          : v
    }
    next[section] = merged
  }
  return SettingsSchema.parse(next)
}

type Listener = (s: Settings) => void

export class SettingsStore {
  private settings: Settings
  private readonly listeners = new Set<Listener>()
  /** Set when the file could not be loaded and defaults were used instead. */
  readonly loadWarning: string | null = null

  constructor(private readonly file: string) {
    const loaded = this.load()
    this.settings = loaded.settings
    this.loadWarning = loaded.warning
  }

  private load(): { settings: Settings; warning: string | null } {
    if (!existsSync(this.file)) return { settings: defaultSettings(), warning: null }
    let json: unknown
    try {
      json = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      return this.recover('Settings file was not valid JSON.')
    }
    const result = migrate(json)
    if (!result.ok) return this.recover(result.reason)
    if (result.migratedFrom !== null) {
      log.info(`settings migrated from v${result.migratedFrom} to v${SETTINGS_VERSION}`)
      copyFileSync(this.file, `${this.file}.v${result.migratedFrom}.bak`)
      this.write(result.settings)
    }
    return { settings: result.settings, warning: null }
  }

  private recover(reason: string): { settings: Settings; warning: string } {
    const backup = `${this.file}.broken-${Date.now()}`
    try {
      copyFileSync(this.file, backup)
    } catch {
      /* best effort */
    }
    log.warn(`settings reset to defaults: ${reason} (backup: ${backup})`)
    return {
      settings: defaultSettings(),
      warning: `${reason} Defaults were loaded; the old file was kept as ${backup}.`,
    }
  }

  private write(s: Settings): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.file)
  }

  get(): Settings {
    return this.settings
  }

  update(patch: SettingsPatch): Settings {
    return this.replace(applyPatch(this.settings, patch))
  }

  replace(next: Settings): Settings {
    this.settings = SettingsSchema.parse(next)
    this.write(this.settings)
    for (const l of this.listeners) l(this.settings)
    return this.settings
  }

  reset(): Settings {
    return this.replace(defaultSettings())
  }

  /** Settings JSON for export. Secrets live in a separate store and are never included. */
  export(): string {
    return JSON.stringify(this.settings, null, 2)
  }

  import(json: string): Settings {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      throw new Error('That file is not valid JSON.')
    }
    const result = migrate(parsed)
    if (!result.ok) throw new Error(result.reason)
    return this.replace(result.settings)
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}
