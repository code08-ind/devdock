import { z } from 'zod'

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

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)')
const host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+$/, 'Host names only, e.g. bitbucket.org')

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
})

export type Settings = z.infer<typeof SettingsSchema>

/** Deep-partial patch accepted by settings:update. Arrays and records are replaced whole. */
export const SettingsPatchSchema = z.object({
  appearance: SettingsSchema.shape.appearance.unwrap().partial().optional(),
  notifications: z
    .object({
      types: z.partialRecord(z.enum(NOTIFICATION_TYPES), z.boolean()).optional(),
      quietHours: SettingsSchema.shape.notifications
        .unwrap()
        .shape.quietHours.unwrap()
        .partial()
        .optional(),
      sound: z.boolean().optional(),
    })
    .optional(),
  general: SettingsSchema.shape.general.unwrap().partial().optional(),
  polling: SettingsSchema.shape.polling.unwrap().partial().optional(),
  links: SettingsSchema.shape.links.unwrap().partial().optional(),
  features: SettingsSchema.shape.features.unwrap().partial().optional(),
})

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export function defaultSettings(): Settings {
  return SettingsSchema.parse({ version: SETTINGS_VERSION })
}
