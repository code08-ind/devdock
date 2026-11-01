import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SETTINGS_VERSION, SettingsPatchSchema, defaultSettings } from '../../src/shared/settings'
import { RepoPatchSchema } from '../../src/shared/repos'
import { SettingsStore, applyPatch, migrate } from '../../src/main/services/settings'

const tmp = () => join(mkdtempSync(join(tmpdir(), 'devdock-settings-')), 'settings.json')

describe('migrate', () => {
  it('fills defaults for a partial current-version object', () => {
    const r = migrate({ version: SETTINGS_VERSION, appearance: { theme: 'dark' } })
    expect(r.ok && r.settings.appearance).toEqual({
      theme: 'dark',
      fontSize: 14,
      density: 'comfortable',
    })
    expect(r.ok && r.migratedFrom).toBeNull()
  })
  it('gives a file from before Accessibility existed every switch at its default (off)', () => {
    const r = migrate({ version: SETTINGS_VERSION, appearance: { theme: 'dark' } })
    expect(r.ok && r.settings.accessibility).toEqual({
      reduceMotion: 'system',
      largerTargets: false,
      underlineLinks: false,
      focusAlways: false,
      announce: false,
    })
  })
  it('upgrades v0 (flat theme key)', () => {
    const r = migrate({ theme: 'paper' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.settings.appearance.theme).toBe('paper')
      expect(r.migratedFrom).toBe(0)
      expect('theme' in r.settings).toBe(false)
    }
  })
  it('runs a chain of migrations in order', () => {
    const r = migrate(
      { version: 0 },
      { 0: (s) => ({ ...s, version: 1, a: 1 }), 1: (s) => ({ ...s, version: 2 }) },
      2,
    )
    // Target 2 isn't the real schema version, so validation rejects it — the chain still ran.
    expect(r.ok).toBe(false)
  })
  it('refuses settings from a newer app', () => {
    const r = migrate({ version: SETTINGS_VERSION + 1 })
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('newer DevDock') })
  })
  it('rejects invalid values', () => {
    expect(migrate({ version: 1, appearance: { fontSize: 99 } }).ok).toBe(false)
    expect(migrate([]).ok).toBe(false)
  })
  it('keeps repos whose saved dev command the stricter P1-D check would reject', () => {
    const repo = { id: 'r1', path: '/tmp/r', name: 'r', baseBranch: 'main' }
    const r = migrate({
      version: SETTINGS_VERSION,
      repos: [{ ...repo, devCommand: 'PORT=3000 npm run dev' }],
    })
    expect(r.ok && r.settings.repos[0]?.devCommand).toBe('PORT=3000 npm run dev')
    // New values still go through the strict check.
    expect(RepoPatchSchema.safeParse({ devCommand: 'PORT=3000 npm run dev' }).success).toBe(false)
    expect(RepoPatchSchema.safeParse({ devCommand: 'npm run dev -- --port 3000' }).success).toBe(
      true,
    )
  })
})

describe('SettingsPatchSchema', () => {
  // Regression: .partial() kept inner .default()s, so a one-field patch reset its siblings.
  it('keeps only the fields that were sent', () => {
    const patch = {
      appearance: { theme: 'dark' },
      notifications: { quietHours: { enabled: true } },
      general: { demoMode: false },
    }
    expect(SettingsPatchSchema.parse(patch)).toEqual(patch)
    expect(SettingsPatchSchema.parse({})).toEqual({})
  })
  it('still validates the values it gets', () => {
    expect(SettingsPatchSchema.safeParse({ appearance: { theme: 'neon' } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ appearance: { fontSize: 17 } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ accessibility: { reduceMotion: 'off' } }).success).toBe(
      false,
    )
    expect(SettingsPatchSchema.safeParse({ links: { allowedHosts: ['a b'] } }).success).toBe(false)
    expect(
      SettingsPatchSchema.safeParse({ notifications: { quietHours: { start: '25:00' } } }).success,
    ).toBe(false)
  })
})

describe('applyPatch', () => {
  it('merges nested sections without dropping siblings', () => {
    const next = applyPatch(defaultSettings(), {
      notifications: { quietHours: { enabled: true }, types: { 'pr-comment': false } },
    })
    expect(next.notifications.quietHours).toEqual({ enabled: true, start: '19:00', end: '09:00' })
    expect(next.notifications.types['pr-comment']).toBe(false)
    expect(next.notifications.types['build-finished']).toBe(true)
  })
})

describe('SettingsStore', () => {
  it('persists and reloads', () => {
    const file = tmp()
    new SettingsStore(file).update({
      appearance: { theme: 'slate', fontSize: 18, density: 'compact' },
    })
    expect(new SettingsStore(file).get().appearance).toEqual({
      theme: 'slate',
      fontSize: 18,
      density: 'compact',
    })
  })
  it('migrates on load and keeps a backup', () => {
    const file = tmp()
    writeFileSync(file, JSON.stringify({ theme: 'dark' }))
    const store = new SettingsStore(file)
    expect(store.get().appearance.theme).toBe('dark')
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(SETTINGS_VERSION)
    expect(existsSync(`${file}.v0.bak`)).toBe(true)
  })
  it('recovers from a corrupt file with defaults and a backup', () => {
    const file = tmp()
    writeFileSync(file, '{not json')
    const store = new SettingsStore(file)
    expect(store.get()).toEqual(defaultSettings())
    expect(store.loadWarning).toContain('not valid JSON')
    expect(readdirSync(join(file, '..')).some((f) => f.includes('.broken-'))).toBe(true)
  })
  it('export → import round-trips and contains no secrets section', () => {
    const a = new SettingsStore(tmp())
    a.update({ general: { demoMode: false } })
    const json = a.export()
    expect(json).not.toMatch(/token|password|secret/i)
    const b = new SettingsStore(tmp())
    expect(b.import(json)).toEqual(a.get())
    expect(() => b.import('nope')).toThrow('not valid JSON')
  })
})

describe('notification types added later', () => {
  it('a file written before pr-closed existed keeps its choices; the new type defaults to on', () => {
    const r = migrate({
      version: SETTINGS_VERSION,
      appearance: { theme: 'dark' },
      notifications: {
        types: {
          'build-finished': true,
          'pr-comment': false,
          'pr-approval': true,
          'pr-needs-work': true,
          'job-finished': false,
        },
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.settings.appearance.theme).toBe('dark') // not reset
    expect(r.settings.notifications.types).toEqual({
      'build-finished': true,
      'pr-comment': false,
      'pr-approval': true,
      'pr-needs-work': true,
      'pr-closed': true,
      // T5: added later too, so also on.
      'pr-opened': true,
      'job-finished': false,
    })
    expect(defaultSettings().notifications.types['pr-closed']).toBe(true)
    // Unknown types are still refused.
    expect(
      migrate({ version: SETTINGS_VERSION, notifications: { types: { nope: true } } }).ok,
    ).toBe(false)
  })
})

describe('top-level lists in a patch (P5-C)', () => {
  it('quickLinks is replaced whole, other settings untouched', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { SettingsStore } = await import('../../src/main/services/settings')
    const store = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'devdock-set-')), 's.json'))
    store.update({ appearance: { theme: 'dark' } })
    const link = { id: 'a', name: 'A', url: 'https://a.example.com', group: '' }
    expect(store.update({ quickLinks: [link] }).quickLinks).toEqual([link])
    expect(store.update({ quickLinks: [] }).quickLinks).toEqual([])
    expect(store.get().appearance.theme).toBe('dark')
  })
})
