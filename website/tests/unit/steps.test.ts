import { describe, expect, it } from 'vitest'
import { installGuide } from '../../src/steps'

const text = (lines: string[]) => lines.join('\n')

describe('"Thanks for downloading" steps per installer', () => {
  it('macOS: open the DMG, drag to Applications, then Gatekeeper → Open Anyway', () => {
    for (const id of ['mac-arm64', 'mac-x64'] as const) {
      const g = installGuide(id, 'DevDock-0.1.0-arm64.dmg')
      expect(g.heading).toMatch(/Mac/)
      expect(text(g.install)).toContain('DevDock-0.1.0-arm64.dmg')
      expect(text(g.install)).toMatch(/Drag \*\*DevDock\*\* onto the \*\*Applications\*\*/)
      expect(text(g.unsigned)).toContain('System Settings → Privacy & Security')
      expect(text(g.unsigned)).toContain('Open Anyway')
      expect(g.work).toMatch(/IT team/)
      expect(text(g.unsigned)).not.toMatch(/Run anyway/)
    }
  })

  it('Windows Setup: run the installer, SmartScreen → More info → Run anyway', () => {
    const g = installGuide('win-setup', 'DevDock-Setup-0.1.0.exe')
    expect(g.heading).toMatch(/Windows/)
    expect(text(g.install)).toContain('Run **DevDock-Setup-0.1.0.exe**')
    expect(text(g.install)).toMatch(/no admin rights/)
    expect(text(g.unsigned)).toContain('**More info**, then **Run anyway**')
    expect(g.work).toMatch(/IT team/)
    expect(text(g.unsigned)).not.toMatch(/Open Anyway/)
  })

  it('Windows portable: nothing installed, same SmartScreen step', () => {
    const g = installGuide('win-portable', 'DevDock-Portable-0.1.0.exe')
    expect(text(g.install)).toMatch(/Nothing is installed/)
    expect(text(g.unsigned)).toContain('Run anyway')
  })
})
