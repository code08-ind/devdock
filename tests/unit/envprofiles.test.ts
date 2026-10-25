import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EnvProfiles, MAX_BACKUPS } from '../../src/main/services/envprofiles'
import { SecretsUnavailableError } from '../../src/main/services/secrets'
import { diffEnv, parseDotenv } from '../../src/shared/envprofiles'

const cipher = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from(s).reverse(),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString(),
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'devdock-env-'))
  const path = mkdtempSync(join(tmpdir(), 'devdock-repo-'))
  let t = 1_000
  const store = new EnvProfiles({ dir, cipher: cipher(), now: () => t++ })
  const repo = { id: 'repo-1', path }
  const env = () => join(path, '.env.local')
  return { dir, repo, store, env }
}

// CRLF, a BOM, a quoted value, a comment, no newline at the end, non-ASCII.
const ORIGINAL = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from('# dev API\r\nAPI_URL=https://dev.example.com\r\nTOKEN="s3cr3t ünïcode"\r\n'),
  // A Latin-1 "é" (not valid UTF-8): only a byte copy keeps it.
  Buffer.from([0x23, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a]),
  Buffer.from('export DEBUG=1'),
])
const MOCK = Buffer.from('API_URL=http://localhost:4010\nMOCK=true\nTOKEN=mock-token\n')

describe('env profiles (SPEC 6.6)', () => {
  it('P5.D3: switch away and back restores the original file byte-for-byte', () => {
    const { repo, store, env } = setup()
    writeFileSync(env(), ORIGINAL)
    store.save(repo, 'dev-api', false)
    writeFileSync(env(), MOCK)
    store.save(repo, 'mock-api', false)

    store.switchTo(repo, 'dev-api')
    expect(readFileSync(env()).equals(ORIGINAL)).toBe(true)
    store.switchTo(repo, 'mock-api')
    expect(readFileSync(env()).equals(MOCK)).toBe(true)
    // …and undoing the last switch puts back the exact bytes from before it.
    store.restoreBackup(repo)
    expect(readFileSync(env()).equals(ORIGINAL)).toBe(true)
    expect(store.state(repo).current.matches).toBe('dev-api')
  })

  it('switching keeps a backup; with no file before, restoring removes it again', () => {
    const { repo, store, env } = setup()
    writeFileSync(env(), MOCK)
    store.save(repo, 'mock-api', false)
    rmSync(env())
    store.switchTo(repo, 'mock-api')
    expect(store.state(repo).backups).toEqual([{ at: expect.any(Number), exists: false }])
    store.restoreBackup(repo)
    expect(existsSync(env())).toBe(false)
    // What the restore replaced is kept: restoring again swaps back.
    expect(store.state(repo).backups).toEqual([{ at: expect.any(Number), exists: true }])
    store.restoreBackup(repo)
    expect(readFileSync(env()).equals(MOCK)).toBe(true)
  })

  it('restore keeps edits made since the switch (as the newest backup)', () => {
    const { repo, store, env } = setup()
    writeFileSync(env(), MOCK)
    store.save(repo, 'mock-api', false)
    store.switchTo(repo, 'mock-api')
    writeFileSync(env(), 'EDITED=1\n')
    store.restoreBackup(repo)
    store.restoreBackup(repo)
    expect(readFileSync(env(), 'utf8')).toBe('EDITED=1\n')
  })

  it.skipIf(process.platform === 'win32')(
    'keeps the file mode; refuses a symlinked .env.local; temp name is ignorable',
    () => {
      const { repo, store, env } = setup()
      writeFileSync(env(), MOCK)
      chmodSync(env(), 0o640)
      store.save(repo, 'mock-api', false)
      store.switchTo(repo, 'mock-api')
      expect(statSync(env()).mode & 0o777).toBe(0o640)
      expect(readdirSync(repo.path)).toEqual(['.env.local'])

      const shared = join(mkdtempSync(join(tmpdir(), 'devdock-shared-')), 'env')
      writeFileSync(shared, MOCK)
      rmSync(env())
      symlinkSync(shared, env())
      expect(() => store.switchTo(repo, 'mock-api')).toThrow(/symlink/)
      expect(() => store.restoreBackup(repo)).toThrow(/symlink/)
      expect(lstatSync(env()).isSymbolicLink()).toBe(true)
    },
  )

  it(`keeps the last ${MAX_BACKUPS} backups`, () => {
    const { repo, store, env } = setup()
    writeFileSync(env(), MOCK)
    store.save(repo, 'mock-api', false)
    for (let i = 0; i < MAX_BACKUPS + 3; i++) store.switchTo(repo, 'mock-api')
    expect(store.state(repo).backups).toHaveLength(MAX_BACKUPS)
  })

  it('state lists key names only; values come one at a time', () => {
    const { repo, store, env } = setup()
    writeFileSync(env(), ORIGINAL)
    store.save(repo, 'dev-api', false)
    const state = store.state(repo)
    expect(state.current).toEqual({
      exists: true,
      keys: ['API_URL', 'TOKEN', 'DEBUG'],
      matches: 'dev-api',
    })
    expect(JSON.stringify(state)).not.toMatch(/s3cr3t|dev\.example/)
    expect(store.reveal(repo, 'dev-api', 'TOKEN')).toBe('s3cr3t ünïcode')
    expect(store.reveal(repo, null, 'API_URL')).toBe('https://dev.example.com')
    expect(() => store.reveal(repo, 'dev-api', 'NOPE')).toThrow(/No key NOPE/)
  })

  it('diff: key names and how they differ, never values', () => {
    const { repo, store, env } = setup()
    writeFileSync(env(), ORIGINAL)
    store.save(repo, 'dev-api', false)
    writeFileSync(env(), MOCK)
    store.save(repo, 'mock-api', false)
    const rows = store.diff(repo, 'dev-api', 'mock-api')
    expect(rows).toEqual([
      { key: 'API_URL', change: 'changed' },
      { key: 'DEBUG', change: 'removed' },
      { key: 'MOCK', change: 'added' },
      { key: 'TOKEN', change: 'changed' },
    ])
    expect(store.diff(repo, null, 'mock-api').every((r) => r.change === 'same')).toBe(true)
  })

  it('stored encrypted; names that exist on Object.prototype are just names', () => {
    const { dir, repo, store, env } = setup()
    writeFileSync(env(), ORIGINAL)
    expect(() => store.switchTo(repo, 'constructor')).toThrow(/No profile named/)
    store.save(repo, 'constructor', false)
    expect(() => store.save(repo, 'constructor', false)).toThrow(/exists already/)
    store.save(repo, 'constructor', true)
    const raw = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8')
    expect(raw).not.toMatch(/API_URL|s3cr3t/)
  })

  it('no OS encryption: nothing is stored', () => {
    const { repo, env } = setup()
    writeFileSync(env(), MOCK)
    const plain = new EnvProfiles({
      dir: mkdtempSync(join(tmpdir(), 'devdock-env-')),
      cipher: cipher(false),
    })
    expect(() => plain.save(repo, 'mock-api', false)).toThrow(SecretsUnavailableError)
  })

  it('dotenv parsing: export, quotes, comments, repeats', () => {
    expect([
      ...parseDotenv(
        '# c\nA=1\nexport B="two\\nlines"\nC=\'lit $x\'\nD=val # note\nE="a b" # quoted\nA=again\nnot a line\n',
      ),
    ]).toEqual([
      ['A', 'again'],
      ['B', 'two\nlines'],
      ['C', 'lit $x'],
      ['D', 'val'],
      ['E', 'a b'],
    ])
    expect(diffEnv(new Map([['A', '1']]), new Map([['A', '1']]))).toEqual([
      { key: 'A', change: 'same' },
    ])
  })
})
