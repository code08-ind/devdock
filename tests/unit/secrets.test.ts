import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SecretStore, SecretsUnavailableError, type Cipher } from '../../src/main/services/secrets'

/** Stand-in for safeStorage: XOR + base64 is enough to prove bytes on disk aren't plain text. */
const fakeCipher = (available = true, backend?: string): Cipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) =>
    Buffer.from(Buffer.from(Buffer.from(s).map((b) => b ^ 0x5a)).toString('base64')),
  decryptString: (b) =>
    Buffer.from(Buffer.from(b.toString(), 'base64').map((x) => x ^ 0x5a)).toString(),
  getSelectedStorageBackend: backend ? () => backend : undefined,
})
const file = () => join(mkdtempSync(join(tmpdir(), 'devdock-secrets-')), 'secrets.bin')

describe('SecretStore', () => {
  it('stores secrets encrypted: the plain value never appears in the file bytes', () => {
    const f = file()
    const store = new SecretStore(f, fakeCipher(), 'darwin')
    const secret = 'ATATT3xFfGF0-very-secret-token'
    store.set('jira.token', secret)
    const bytes = readFileSync(f)
    expect(bytes.includes(Buffer.from(secret))).toBe(false)
    expect(bytes.toString('utf8')).not.toContain('jira.token')
    expect(store.get('jira.token')).toBe(secret)
    expect(store.keys()).toEqual(['jira.token'])
  })

  it('refuses to store when encryption is unavailable', () => {
    const f = file()
    const store = new SecretStore(f, fakeCipher(false), 'win32')
    expect(store.status()).toMatchObject({ available: false, backend: 'Windows DPAPI' })
    expect(() => store.set('jenkins.token', 'x')).toThrow(SecretsUnavailableError)
    expect(existsSync(f)).toBe(false)
  })

  it('refuses the Linux plain-text backend', () => {
    const store = new SecretStore(file(), fakeCipher(true, 'basic_text'), 'linux')
    expect(store.status().available).toBe(false)
    expect(() => store.set('jira.token', 'x')).toThrow(SecretsUnavailableError)
  })

  it('deletes one key and clears all', () => {
    const f = file()
    const store = new SecretStore(f, fakeCipher(), 'darwin')
    store.set('jira.token', 'a')
    store.set('bitbucket.token', 'b')
    store.delete('jira.token')
    expect(store.keys()).toEqual(['bitbucket.token'])
    store.clear()
    expect(existsSync(f)).toBe(false)
    expect(store.keys()).toEqual([])
  })
})
