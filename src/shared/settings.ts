import { z } from 'zod'
import { isAllowedEditorPath, isValidBranchName, parseDevCommand } from './gitref'
import { DEFAULT_JQL, JIRA_FLAVORS, SavedQuerySchema } from './jira'

export const SETTINGS_VERSION = 1

export const THEMES = ['system', 'light', 'dark', 'high-contrast', 'paper', 'slate'] as const
export const FONT_SIZES = [12, 13, 14, 15, 16, 18] as const
export const DENSITIES = ['comfortable', 'compact'] as const
export const NOTIFICATION_TYPES = [
  'build-finished',
  'pr-comment',
  'pr-approval',
  'pr-needs-work',
  'job-finished',
] as const

export type Theme = (typeof THEMES)[number]
export type FontSize = (typeof FONT_SIZES)[number]
export type Density = (typeof DENSITIES)[number]
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const UPDATE_STRATEGIES = ['merge', 'rebase'] as const
export type UpdateStrategy = (typeof UPDATE_STRATEGIES)[number]

/** SPEC 6.2 defaults. */
export const DEFAULT_PROTECTED = ['main', 'master', 'develop', 'release/*'] as const
export const DEFAULT_TEMPLATES = { feature: 'feature/{KEY}-{slug}', bugfix: 'bugfix/{KEY}-{slug}' }

const template = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((t) => t.includes('{slug}') || t.includes('{KEY}'), 'Use {KEY} and/or {slug}')

/** Editable repo fields, without defaults (shared by the stored config and repo patches). */
export const RepoFields = {
  name: z.string().trim().min(1).max(100),
  // Reaches git as an argument: must be a real branch name, never an option like --upload-pack.
  baseBranch: z.string().trim().refine(isValidBranchName, 'Not a valid branch name'),
  protectedPatterns: z.array(z.string().trim().min(1).max(200)),
  branchTemplates: z.object({ feature: template, bugfix: template }),
  devCommand: z
    .string()
    .trim()
    .refine(
      (c) => parseDevCommand(c) !== null,
      'Start with npm, pnpm, yarn, bun, npx, node or ./script — no shell syntax',
    ),
}

/** One registered local repo. Managed through the repos:* IPC channels, not settings:update. */
export const RepoConfigSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: RepoFields.name,
  baseBranch: RepoFields.baseBranch,
  protectedPatterns: RepoFields.protectedPatterns.default(() => [...DEFAULT_PROTECTED]),
  branchTemplates: RepoFields.branchTemplates.default(() => ({ ...DEFAULT_TEMPLATES })),
  // Lenient when stored: P1-C saved any command, and one rejected value must not reset every
  // setting on load. New values go through RepoFields (patch); start re-checks with parseDevCommand.
  devCommand: z.string().trim().max(500).default('npm run dev'),
})
export type RepoConfig = z.infer<typeof RepoConfigSchema>

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)')
const host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+$/, 'Host names only, e.g. bitbucket.org')

/** A service's base URL: empty (not configured) or http(s) without credentials, no trailing /. */
const serviceUrl = z
  .string()
  .trim()
  .max(500)
  .transform((u) => u.replace(/\/+$/, ''))
  .refine((u) => {
    if (u === '') return true
    try {
      const url = new URL(u)
      // A query or fragment would swallow every API path appended to the base URL.
      const plain = !url.username && !url.password && !url.search && !url.hash && !/[?#]/.test(u)
      return (url.protocol === 'https:' || url.protocol === 'http:') && plain
    } catch {
      return false
    }
  }, 'Use the site address, e.g. https://your-team.atlassian.net')

export const SettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  appearance: z
    .object({
      theme: z.enum(THEMES).default('system'),
      fontSize: z.literal(FONT_SIZES).default(14),
      density: z.enum(DENSITIES).default('comfortable'),
    })
    .prefault({}),
  notifications: z
    .object({
      types: z
        .record(z.enum(NOTIFICATION_TYPES), z.boolean())
        .default(
          Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, true])) as Record<
            NotificationType,
            boolean
          >,
        ),
      quietHours: z
        .object({
          enabled: z.boolean().default(false),
          start: hhmm.default('19:00'),
          end: hhmm.default('09:00'),
        })
        .prefault({}),
      sound: z.boolean().default(true),
    })
    .prefault({}),
  general: z
    .object({
      demoMode: z.boolean().default(true),
      closeToTray: z.boolean().default(true),
      launchAtLogin: z.boolean().default(false),
      paletteShortcut: z.string().min(1).default('CommandOrControl+Shift+Space'),
    })
    .prefault({}),
  polling: z
    .object({
      foregroundSec: z.number().int().min(15).max(3600).default(60),
      backgroundSec: z.number().int().min(30).max(7200).default(180),
    })
    .prefault({}),
  links: z
    .object({
      allowedHosts: z
        .array(host)
        .default(['bitbucket.org', 'atlassian.net', 'figma.com', 'aws.amazon.com']),
    })
    .prefault({}),
  features: z
    .object({
      prActions: z.boolean().default(false),
      jobTriggers: z.boolean().default(false),
      allowedJobs: z.array(z.string()).default([]),
      jiraTransition: z.boolean().default(false),
      briefLocation: z.enum(['repo', 'appData']).default('repo'),
    })
    .prefault({}),
  git: z
    .object({
      /** "Update my branch" strategy (SPEC 6.2: the user's saved default). */
      updateStrategy: z.enum(UPDATE_STRATEGIES).default('merge'),
      /** VS Code binary (`code`, or a full path when it's not on PATH). */
      editorPath: z
        .string()
        .trim()
        .max(1000)
        .refine(isAllowedEditorPath, 'Use the path to code, code-insiders, codium or cursor')
        .default('code'),
    })
    .prefault({}),
  /** SPEC 6.5 / 6.7. The token is a secret (`jira.token`), never stored here. */
  jira: z
    .object({
      flavor: z.enum(JIRA_FLAVORS).default('cloud'),
      baseUrl: serviceUrl.default(''),
      /** Cloud only: the account email used with the API token. */
      email: z.string().trim().max(200).default(''),
      jql: z.string().trim().min(1).max(2000).default(DEFAULT_JQL),
      /** Agile board for "Current sprint"; null hides that list. */
      boardId: z.number().int().positive().nullable().default(null),
      savedQueries: z.array(SavedQuerySchema).max(20).default([]),
    })
    .prefault({}),
  repos: z.array(RepoConfigSchema).default([]),
})

export type Settings = z.infer<typeof SettingsSchema>

/**
 * Optional, default-free copy of a settings section. `.partial()` alone is not enough: zod
 * still applies inner `.default()`s, so `{ theme: 'dark' }` would parse to a full section and
 * silently reset its other fields.
 */
function patchOf<T extends z.ZodRawShape>(section: z.ZodPrefault<z.ZodObject<T>>) {
  const object = section.unwrap()
  const shape = Object.fromEntries(
    Object.entries(object.shape).map(([key, field]) => {
      const bare = (field instanceof z.ZodDefault ? field.unwrap() : field) as z.ZodType
      return [key, bare.optional()]
    }),
  )
  // Same static type as `.partial()`; only the runtime defaults are gone.
  return (z.object(shape) as unknown as ReturnType<typeof object.partial>).optional()
}

const notificationsShape = SettingsSchema.shape.notifications.unwrap().shape

/** Deep-partial patch accepted by settings:update. Arrays and records are replaced whole. */
export const SettingsPatchSchema = z.object({
  appearance: patchOf(SettingsSchema.shape.appearance),
  notifications: z
    .object({
      types: z.partialRecord(z.enum(NOTIFICATION_TYPES), z.boolean()).optional(),
      quietHours: patchOf(notificationsShape.quietHours),
      sound: z.boolean().optional(),
    })
    .optional(),
  general: patchOf(SettingsSchema.shape.general),
  polling: patchOf(SettingsSchema.shape.polling),
  links: patchOf(SettingsSchema.shape.links),
  features: patchOf(SettingsSchema.shape.features),
  git: patchOf(SettingsSchema.shape.git),
  jira: patchOf(SettingsSchema.shape.jira),
})

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export function defaultSettings(): Settings {
  return SettingsSchema.parse({ version: SETTINGS_VERSION })
}
