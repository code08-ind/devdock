import { z } from 'zod'

/**
 * SPEC 6.6 env profiles: named copies of a repo's `.env.local`, encrypted in DevDock's data
 * folder. The renderer sees key names; a value only through a per-value reveal.
 */

export const ENV_FILE = '.env.local'

export const ProfileNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/, 'Use letters, digits, ".", "_" or "-" (e.g. dev-api)')

export const EnvProfileSchema = z.object({
  name: z.string(),
  savedAt: z.number(),
  keys: z.array(z.string()),
})

export const EnvStateSchema = z.object({
  current: z.object({
    exists: z.boolean(),
    keys: z.array(z.string()),
    /** The saved profile whose bytes equal the file now; null when none does. */
    matches: z.string().nullable(),
  }),
  profiles: z.array(EnvProfileSchema),
  /** Copies kept on each switch, newest first; `exists: false` = there was no file. */
  backups: z.array(z.object({ at: z.number(), exists: z.boolean() })),
})
export type EnvState = z.infer<typeof EnvStateSchema>

/** `null` = the current `.env.local`. */
export const EnvSourceSchema = ProfileNameSchema.nullable()

export const ENV_CHANGES = ['added', 'removed', 'changed', 'same'] as const
export type EnvChange = (typeof ENV_CHANGES)[number]

export const EnvDiffRowSchema = z.object({ key: z.string(), change: z.enum(ENV_CHANGES) })
export type EnvDiffRow = z.infer<typeof EnvDiffRowSchema>

/**
 * Keys and values of a dotenv file: `KEY=value`, `export KEY=value`, quotes ("…" with \n
 * escapes, '…' literal), `# comments` and blank lines skipped, inline ` #` comments dropped
 * from unquoted values. The last of repeated keys wins (as dotenv does).
 */
export function parseDotenv(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(raw)
    if (!m) continue
    const value = m[2]!.trim()
    // A quoted value may be followed by an inline comment: `KEY="a b" # note`.
    const double = /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(value)
    const single = /^'([^']*)'\s*(?:#.*)?$/.exec(value)
    out.set(
      m[1]!,
      double
        ? double[1]!.replace(/\\n/g, '\n').replace(/\\"/g, '"')
        : single
          ? single[1]!
          : value.replace(/\s+#.*$/, ''),
    )
  }
  return out
}

/** Key names only (SPEC 6.6 "diff between profiles, showing key names only by default"). */
export function diffEnv(a: Map<string, string>, b: Map<string, string>): EnvDiffRow[] {
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort()
  return keys.map((key) => ({
    key,
    change: !a.has(key)
      ? 'added'
      : !b.has(key)
        ? 'removed'
        : a.get(key) === b.get(key)
          ? 'same'
          : 'changed',
  }))
}
