import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { ENV_FILE, diffEnv, parseDotenv, type EnvDiffRow, type EnvState } from '@shared/envprofiles'
import type { Cipher } from './secrets'
import { SecretsUnavailableError } from './secrets'

/**
 * SPEC 6.6 env profiles. Per repo, one file in DevDock's data folder, encrypted whole with
 * safeStorage: the saved profiles and the backups taken on each switch. Contents are kept as
 * base64 of the file's bytes, so a switch writes back exactly what was saved (line endings,
 * BOM and all). Values reach the renderer only one at a time (`reveal`).
 */

/** Backups kept per repo (each switch adds one). */
export const MAX_BACKUPS = 5

const StoreSchema = z.object({
  version: z.literal(1),
  profiles: z.record(z.string(), z.object({ savedAt: z.number(), data: z.string() })),
  /** Newest first; `data: null` = there was no `.env.local`. */
  backups: z.array(z.object({ at: z.number(), data: z.string().nullable() })),
})
type Store = z.infer<typeof StoreSchema>

export class EnvProfileError extends Error {
  override readonly name = 'EnvProfileError'
  constructor(
    readonly kind: 'not-found' | 'exists' | 'no-file' | 'no-backup' | 'symlink',
    message: string,
  ) {
    super(message)
  }
}

export interface EnvProfilesDeps {
  /** `<userData>/env-profiles`; one `<repoId>.bin` each. */
  dir: string
  cipher: Cipher
  now?: () => number
}

/** A stored profile's text (its bytes are kept as base64). */
const decode64 = (base64: string) => Buffer.from(base64, 'base64').toString('utf8')

type Repo = { id: string; path: string }

function savedProfile(store: Store, name: string): Store['profiles'][string] | undefined {
  // An own property only: a name like "constructor" must not find Object.prototype.
  return Object.hasOwn(store.profiles, name) ? store.profiles[name] : undefined
}

export class EnvProfiles {
  constructor(private readonly deps: EnvProfilesDeps) {}

  state(repo: Repo): EnvState {
    const store = this.read(repo.id)
    const current = this.currentBytes(repo.path)
    const currentB64 = current?.toString('base64') ?? null
    return {
      current: {
        exists: current !== null,
        keys: current ? [...parseDotenv(current.toString('utf8')).keys()] : [],
        matches: Object.entries(store.profiles).find(([, p]) => p.data === currentB64)?.[0] ?? null,
      },
      profiles: Object.entries(store.profiles)
        .map(([name, p]) => ({
          name,
          savedAt: p.savedAt,
          keys: [...parseDotenv(decode64(p.data)).keys()],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      backups: store.backups.map((b) => ({ at: b.at, exists: b.data !== null })),
    }
  }

  /** Saves the current `.env.local` as `name` (`replace` to overwrite one of that name). */
  save(repo: Repo, name: string, replace: boolean): void {
    const current = this.currentBytes(repo.path)
    if (!current) throw new EnvProfileError('no-file', `This repo has no ${ENV_FILE} to save.`)
    const store = this.read(repo.id)
    if (Object.hasOwn(store.profiles, name) && !replace) {
      throw new EnvProfileError('exists', `A profile named "${name}" exists already.`)
    }
    store.profiles[name] = { savedAt: this.now(), data: current.toString('base64') }
    this.write(repo.id, store)
  }

  /** Writes a profile to `.env.local`, keeping a backup of what was there (or that nothing was). */
  switchTo(repo: Repo, name: string): void {
    const store = this.read(repo.id)
    const profile = savedProfile(store, name)
    if (!profile) throw new EnvProfileError('not-found', `No profile named "${name}".`)
    this.assertPlainFile(repo.path)
    const current = this.currentBytes(repo.path)
    store.backups = [
      { at: this.now(), data: current?.toString('base64') ?? null },
      ...store.backups,
    ].slice(0, MAX_BACKUPS)
    // The backup is safe on disk before the file changes.
    this.write(repo.id, store)
    this.writeEnv(repo.path, Buffer.from(profile.data, 'base64'))
  }

  /**
   * Puts back the newest backup: undoes the last switch. What it replaces becomes the newest
   * backup in turn, so edits made since the switch aren't lost (restoring again swaps back).
   */
  restoreBackup(repo: Repo): void {
    const store = this.read(repo.id)
    const [latest, ...rest] = store.backups
    if (!latest) throw new EnvProfileError('no-backup', 'There is no backup to restore.')
    this.assertPlainFile(repo.path)
    const current = this.currentBytes(repo.path)
    store.backups = [{ at: this.now(), data: current?.toString('base64') ?? null }, ...rest]
    this.write(repo.id, store)
    if (latest.data === null) rmSync(join(repo.path, ENV_FILE), { force: true })
    else this.writeEnv(repo.path, Buffer.from(latest.data, 'base64'))
  }

  remove(repo: { id: string }, name: string): void {
    const store = this.read(repo.id)
    if (!Object.hasOwn(store.profiles, name)) return
    delete store.profiles[name]
    this.write(repo.id, store)
  }

  /** One value (SPEC 6.6 "reveal-per-value"): of a profile, or of the current file (`null`). */
  reveal(repo: Repo, profile: string | null, key: string): string {
    const value = this.entries(repo, profile).get(key)
    if (value === undefined) throw new EnvProfileError('not-found', `No key ${key} there.`)
    return value
  }

  /** Key names and whether each was added, removed or changed from `a` to `b`. */
  diff(repo: Repo, a: string | null, b: string | null): EnvDiffRow[] {
    return diffEnv(this.entries(repo, a), this.entries(repo, b))
  }

  /** Forgets every profile and backup (Settings → Clear all data). */
  clearAll(): void {
    rmSync(this.deps.dir, { recursive: true, force: true })
  }

  private entries(repo: Repo, profile: string | null): Map<string, string> {
    if (profile === null) {
      const current = this.currentBytes(repo.path)
      if (!current) throw new EnvProfileError('no-file', `This repo has no ${ENV_FILE}.`)
      return parseDotenv(current.toString('utf8'))
    }
    const saved = savedProfile(this.read(repo.id), profile)
    if (!saved) throw new EnvProfileError('not-found', `No profile named "${profile}".`)
    return parseDotenv(decode64(saved.data))
  }

  private currentBytes(root: string): Buffer | null {
    const file = join(root, ENV_FILE)
    return existsSync(file) ? readFileSync(file) : null
  }

  /**
   * Temp file + rename in the repo, so an editor never sees half a file. The temp name matches
   * the usual `.env*.local` ignore rule (a crash mustn't leave secrets to commit), and the file
   * keeps its mode (new files: owner-only).
   */
  private writeEnv(root: string, bytes: Buffer): void {
    const file = join(root, ENV_FILE)
    const tmp = join(root, '.env.devdock-tmp.local')
    const mode = existsSync(file) ? lstatSync(file).mode & 0o777 : 0o600
    writeFileSync(tmp, bytes, { mode })
    chmodSync(tmp, mode) // the umask may have narrowed it
    renameSync(tmp, file)
  }

  /** A symlinked `.env.local` would be replaced by a plain file (the link's target untouched). */
  private assertPlainFile(root: string): void {
    const file = join(root, ENV_FILE)
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) {
      throw new EnvProfileError(
        'symlink',
        `${ENV_FILE} here is a symlink; DevDock only switches a plain file. Replace the link with a copy first.`,
      )
    }
  }

  private file(repoId: string): string {
    // Repo ids are DevDock's own (checked by the IPC schema), never a path.
    return join(this.deps.dir, `${repoId.replace(/[^A-Za-z0-9_-]/g, '_')}.bin`)
  }

  private assertCipher(): void {
    if (!this.deps.cipher.isEncryptionAvailable()) {
      throw new SecretsUnavailableError(
        'OS encryption is unavailable, so DevDock will not store env profiles.',
      )
    }
  }

  private read(repoId: string): Store {
    const file = this.file(repoId)
    if (!existsSync(file)) return { version: 1, profiles: {}, backups: [] }
    this.assertCipher()
    return StoreSchema.parse(JSON.parse(this.deps.cipher.decryptString(readFileSync(file))))
  }

  private write(repoId: string, store: Store): void {
    this.assertCipher()
    const file = this.file(repoId)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, this.deps.cipher.encryptString(JSON.stringify(store)), { mode: 0o600 })
    renameSync(tmp, file)
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}
