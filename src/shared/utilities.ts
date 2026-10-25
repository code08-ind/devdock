import { z } from 'zod'

/** SPEC 6.6 utilities: listening ports and clean caches (env profiles, links, standup in P5-B). */

export const ListeningPortSchema = z.object({
  port: z.number().int(),
  pid: z.number().int(),
  /** Process name (`node`, `node.exe`); `unknown` when the OS doesn't say. */
  process: z.string(),
  /** Full command line (macOS); null where the OS doesn't give it cheaply (Windows). */
  command: z.string().nullable(),
  /** Local addresses it listens on: `127.0.0.1`, `*`, `::1`, `::`… */
  addresses: z.array(z.string()),
})
export type ListeningPort = z.infer<typeof ListeningPortSchema>

/** The Utilities view's tabs; the palette opens one (`kill 5173` → Ports, that port). */
export const UTILITY_TABS = ['ports', 'caches', 'env', 'links', 'standup'] as const
export const UtilityRequestSchema = z.object({
  tab: z.enum(UTILITY_TABS),
  stopPort: z.number().int().min(1).max(65535).optional(),
})
export type UtilityRequest = z.infer<typeof UtilityRequestSchema>

/** SPEC 6.6 quick filters. */
export const PORT_FILTERS = [
  { label: '3000–3010', from: 3000, to: 3010 },
  { label: '5173–5180', from: 5173, to: 5180 },
  { label: '8080', from: 8080, to: 8080 },
] as const

const pid = z
  .number()
  .int()
  .positive()
  .max(2 ** 31)

export const StopRequestSchema = z
  .object({
    pid,
    /** The port it was listed on: the handler checks it still listens there before stopping it. */
    port: z.number().int().min(1).max(65535),
    /** `taskkill /F` on Windows, SIGKILL elsewhere (SPEC 6.6: only after a second confirmation). */
    force: z.boolean(),
    confirmed: z.literal(true),
    /** Required with `force`: the second confirmation was accepted. */
    forceConfirmed: z.literal(true).optional(),
  })
  .refine((r) => !r.force || r.forceConfirmed === true, {
    message: 'Force stop needs its own confirmation',
    path: ['forceConfirmed'],
  })
export type StopRequest = z.infer<typeof StopRequestSchema>

export const StopResultSchema = z.object({
  /** Still listening a few seconds later: the UI offers to force it. */
  stillListening: z.boolean(),
})

/** SPEC 6.6: what Clean caches removes; `node_modules` only with a second confirmation. */
export const CACHE_PATHS = ['node_modules/.vite', 'dist', 'coverage'] as const
export const HEAVY_CACHE = 'node_modules'

export const CacheEntrySchema = z.object({
  /** Relative to the repo, `/`-separated. */
  path: z.string(),
  exists: z.boolean(),
  /** A symlink is removed as a link (what it points at is left alone); its size is 0. */
  symlink: z.boolean(),
  bytes: z.number().int().nonnegative(),
  /** The walk stopped early (very many files): `bytes` is at least this much. */
  approximate: z.boolean(),
})
export type CacheEntry = z.infer<typeof CacheEntrySchema>

export const CachePlanSchema = z.object({
  entries: z.array(CacheEntrySchema),
  /** `node_modules` itself, listed separately (second confirmation). */
  heavy: CacheEntrySchema,
})
export type CachePlan = z.infer<typeof CachePlanSchema>

export const CleanRequestSchema = z
  .object({
    id: z.string().min(1).max(100),
    includeNodeModules: z.boolean(),
    confirmed: z.literal(true),
    /** Required with `includeNodeModules` (SPEC 6.6: a second confirmation). */
    nodeModulesConfirmed: z.literal(true).optional(),
  })
  .refine((r) => !r.includeNodeModules || r.nodeModulesConfirmed === true, {
    message: 'Removing node_modules needs its own confirmation',
    path: ['nodeModulesConfirmed'],
  })

export const CleanResultSchema = z.object({
  removed: z.array(z.string()),
  freedBytes: z.number().int().nonnegative(),
})
export type CleanResult = z.infer<typeof CleanResultSchema>

/** "1.4 MB" (binary units, as file managers show). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
