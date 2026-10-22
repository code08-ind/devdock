import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SecretKey } from '@shared/ipc'

/** The subset of Electron's safeStorage we use; injectable so tests can run without Electron. */
export interface Cipher {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only in Electron; 'basic_text' means effectively plain text. */
  getSelectedStorageBackend?(): string
}

export class SecretsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretsUnavailableError'
  }
}

export interface SecretsStatus {
  available: boolean
  backend: string
  reason?: string
}

/**
 * Secrets live in one file, the whole JSON map encrypted with safeStorage (Keychain on macOS,
 * DPAPI on Windows). We refuse to store anything if encryption is unavailable or would fall
 * back to plain text. Values never leave the main process.
 */
export class SecretStore {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  status(): SecretsStatus {
    const backend =
      this.platform === 'darwin'
        ? 'macOS Keychain'
        : this.platform === 'win32'
          ? 'Windows DPAPI'
          : (this.cipher.getSelectedStorageBackend?.() ?? 'unknown')
    if (!this.cipher.isEncryptionAvailable()) {
      return {
        available: false,
        backend,
        reason:
          'OS encryption is unavailable, so DevDock will not store credentials. Demo mode still works.',
      }
    }
    if (backend === 'basic_text') {
      return {
        available: false,
        backend,
        reason: 'No OS keyring was found; DevDock refuses to store credentials in plain text.',
      }
    }
    return { available: true, backend }
  }

  private assertAvailable(): void {
    const s = this.status()
    if (!s.available) throw new SecretsUnavailableError(s.reason ?? 'Encryption unavailable.')
  }

  private readAll(): Partial<Record<SecretKey, string>> {
    if (!existsSync(this.file)) return {}
    this.assertAvailable()
    const json = this.cipher.decryptString(readFileSync(this.file))
    return JSON.parse(json) as Partial<Record<SecretKey, string>>
  }

  private writeAll(map: Partial<Record<SecretKey, string>>): void {
    this.assertAvailable()
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, this.cipher.encryptString(JSON.stringify(map)), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  /** Main-process only. Never expose through IPC. */
  get(key: SecretKey): string | undefined {
    return this.readAll()[key]
  }

  keys(): SecretKey[] {
    if (!existsSync(this.file) || !this.status().available) return []
    return Object.keys(this.readAll()) as SecretKey[]
  }

  set(key: SecretKey, value: string): void {
    this.assertAvailable()
    this.writeAll({ ...this.readAll(), [key]: value })
  }

  delete(key: SecretKey): void {
    if (!existsSync(this.file)) return
    const map = this.readAll()
    delete map[key]
    this.writeAll(map)
  }

  clear(): void {
    rmSync(this.file, { force: true })
  }
}
