import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  )

describe('terminal style shim', () => {
  // The shim turns every `<style>` element the page asks for into an inert stand-in; that is only
  // safe while xterm is the sole caller (see styleShim.ts). DevDock's own code must not make any.
  it('no renderer code but the shim creates <style> elements or sets inline styles', () => {
    const offenders = files('src/renderer')
      .filter((f) => !f.endsWith('styleShim.ts'))
      .filter((f) =>
        /createElement\(\s*['"`]style['"`]|\.style\.\w+\s*=|setAttribute\(\s*['"`]style/.test(
          readFileSync(f, 'utf8'),
        ),
      )
    expect(offenders).toEqual([])
  })
})
