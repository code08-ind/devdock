import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chmodSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CacheError, clean, planClean, sizeOf } from '../../src/main/services/caches'

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'devdock-caches-'))
  const file = (rel: string, bytes: number) => {
    const path = join(root, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, Buffer.alloc(bytes))
  }
  file('node_modules/.vite/deps/react.js', 1000)
  file('node_modules/react/index.js', 500)
  file('dist/index.html', 200)
  file('dist/assets/app.js', 3000)
  file('src/main.ts', 10)
  return { root, file }
}

describe('Clean caches (SPEC 6.6)', () => {
  it('plan: each path with its size; missing ones say so; node_modules listed apart', async () => {
    const { root } = repo()
    expect(await planClean(root)).toEqual({
      entries: [
        {
          path: 'node_modules/.vite',
          exists: true,
          symlink: false,
          bytes: 1000,
          approximate: false,
        },
        { path: 'dist', exists: true, symlink: false, bytes: 3200, approximate: false },
        { path: 'coverage', exists: false, symlink: false, bytes: 0, approximate: false },
      ],
      heavy: {
        path: 'node_modules',
        exists: true,
        symlink: false,
        bytes: 1500,
        approximate: false,
      },
    })
  })

  it('clean: removes the listed paths only; node_modules stays unless asked', async () => {
    const { root } = repo()
    expect(await clean(root, false)).toEqual({
      removed: ['node_modules/.vite', 'dist'],
      freedBytes: 4200,
    })
    expect(existsSync(join(root, 'node_modules/react/index.js'))).toBe(true)
    expect(existsSync(join(root, 'src/main.ts'))).toBe(true)
    expect(await clean(root, true)).toEqual({ removed: ['node_modules'], freedBytes: 500 })
    expect(existsSync(join(root, 'node_modules'))).toBe(false)
    expect(existsSync(join(root, 'src/main.ts'))).toBe(true)
  })

  it('with node_modules included, .vite inside it isn’t counted twice', async () => {
    const { root } = repo()
    expect(await clean(root, true)).toEqual({ removed: ['dist', 'node_modules'], freedBytes: 4700 })
  })

  it('a symlinked dist is removed as a link; its target is left alone', async () => {
    const { root } = repo()
    const outside = mkdtempSync(join(tmpdir(), 'devdock-outside-'))
    writeFileSync(join(outside, 'keep.txt'), 'precious')
    const linked = mkdtempSync(join(tmpdir(), 'devdock-caches-'))
    symlinkSync(outside, join(linked, 'dist'), 'junction')
    const plan = await planClean(linked)
    expect(plan.entries[1]).toEqual({
      path: 'dist',
      exists: true,
      symlink: true,
      bytes: 0,
      approximate: false,
    })
    await clean(linked, false)
    expect(existsSync(join(linked, 'dist'))).toBe(false)
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true)
    void root
  })

  it('node_modules/.vite through a linked node_modules is not touched', async () => {
    const shared = mkdtempSync(join(tmpdir(), 'devdock-shared-'))
    mkdirSync(join(shared, '.vite'))
    writeFileSync(join(shared, '.vite', 'x.js'), 'x')
    const root = mkdtempSync(join(tmpdir(), 'devdock-caches-'))
    symlinkSync(shared, join(root, 'node_modules'), 'junction')
    expect((await planClean(root)).entries[0]).toMatchObject({ exists: false })
    await clean(root, false)
    expect(existsSync(join(shared, '.vite', 'x.js'))).toBe(true)
  })

  it('sizes stop early on huge trees and say so', async () => {
    const { root } = repo()
    expect(await sizeOf(join(root, 'dist'), 1)).toEqual({ bytes: 0, approximate: true })
  })
})

// A read-only folder makes rm fail part-way (not on Windows, nor as root, where it can't).
describe.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'Clean caches failures',
  () => {
    it('stops at the first path it can’t remove and says what was removed already', async () => {
      const { root, file } = repo()
      file('coverage/locked/report.html', 10)
      chmodSync(join(root, 'coverage/locked'), 0o500)
      try {
        const err = await clean(root, false).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(CacheError)
        expect(err).toMatchObject({
          removed: ['node_modules/.vite', 'dist'],
          message: expect.stringMatching(
            /^Couldn't remove coverage.*Removed node_modules\/\.vite, dist first\.$/,
          ),
        })
        expect(existsSync(join(root, 'dist'))).toBe(false)
      } finally {
        chmodSync(join(root, 'coverage/locked'), 0o700)
      }
    })
  },
)
