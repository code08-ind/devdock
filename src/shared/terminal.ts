/**
 * In-app terminal (P7-A): the IPC shapes, the Settings → Terminal section and the colour
 * palette each DevDock theme gives the terminal. Free of Node and DOM so main, renderer and
 * tests share it.
 */
import { z } from 'zod'

/** Most terminals one window may hold at once (each is a real shell process). */
export const MAX_SESSIONS = 20
/** Largest single write (a paste is split into chunks of this size by the renderer). */
export const MAX_WRITE = 64 * 1024

export const TerminalIdSchema = z.string().regex(/^t[0-9]{1,6}$/, 'Not a terminal id')

/** Rows and columns from xterm's fit addon; bounded so a bad value can't upset the PTY. */
const Cols = z.number().int().min(2).max(1000)
const Rows = z.number().int().min(1).max(500)

export const TerminalCreateSchema = z.object({
  /** A registered repo to start in; null or missing = the home folder. Never a raw path. */
  repoId: z.string().min(1).max(100).nullable().optional(),
  cols: Cols,
  rows: Rows,
})
export type TerminalCreate = z.infer<typeof TerminalCreateSchema>

export const TerminalWriteSchema = z.object({
  id: TerminalIdSchema,
  data: z.string().min(1).max(MAX_WRITE),
})
export const TerminalResizeSchema = z.object({ id: TerminalIdSchema, cols: Cols, rows: Rows })
export const TerminalRefSchema = z.object({ id: TerminalIdSchema })

export const TerminalSessionSchema = z.object({
  id: TerminalIdSchema,
  /** Tab title: the repo name, or "Home". */
  title: z.string(),
  repoId: z.string().nullable(),
  /** The shell's file name (zsh, bash, pwsh…), for the tab tooltip. */
  shell: z.string(),
  status: z.enum(['running', 'exited']),
  exitCode: z.number().int().nullable(),
})
export type TerminalSession = z.infer<typeof TerminalSessionSchema>

export interface TerminalOutputEvent {
  id: string
  data: string
}
export interface TerminalExitEvent {
  id: string
  exitCode: number
  signal: number | null
}

/** Palette window / panel → main window: open a DevDock terminal there. */
export const TerminalRequestSchema = z.object({ repoId: z.string().min(1).max(100).nullable() })

// --- Settings → Terminal ----------------------------------------------------------------------

export const CURSOR_STYLES = ['block', 'bar', 'underline'] as const
export type CursorStyle = (typeof CURSOR_STYLES)[number]

/** Shell names DevDock looks up on PATH; anything else must be an absolute path to a file. */
export const SHELL_NAMES = [
  'zsh',
  'bash',
  'fish',
  'sh',
  'pwsh',
  'pwsh.exe',
  'powershell',
  'powershell.exe',
  'cmd',
  'cmd.exe',
] as const

const isAbsolutePath = (v: string) => v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v)

/**
 * The shell override: empty (the login shell / PowerShell), a known shell name, or an absolute
 * path. Only a file — never arguments or shell syntax (it is spawned with an argument array).
 */
export const ShellOverrideSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) =>
      v === '' ||
      // No control characters (a newline would be a second command in some contexts).
      (!/[\u0000-\u001f]/.test(v) &&
        ((SHELL_NAMES as readonly string[]).includes(v.toLowerCase()) || isAbsolutePath(v))),
    'Use a shell name (zsh, bash, pwsh…) or the full path to the shell program',
  )

export const TERMINAL_FONT_SIZES = { min: 9, max: 28 } as const

export const TerminalSettingsSchema = z
  .object({
    /** '' = the login shell ($SHELL) on macOS, PowerShell on Windows. */
    shell: ShellOverrideSchema.default(''),
    fontSize: z
      .number()
      .int()
      .min(TERMINAL_FONT_SIZES.min)
      .max(TERMINAL_FONT_SIZES.max)
      .default(13),
    cursorStyle: z.enum(CURSOR_STYLES).default('block'),
    cursorBlink: z.boolean().default(true),
    /** Lines kept above the screen per terminal. */
    scrollback: z.number().int().min(500).max(100_000).default(5000),
    /**
     * zsh/bash only: a robbyrussell-style prompt from DevDock after your own rc file (which is
     * still loaded, never edited). Off by default: oh-my-zsh users keep their own prompt.
     */
    devdockPrompt: z.boolean().default(false),
  })
  .prefault({})
export type TerminalSettings = z.infer<typeof TerminalSettingsSchema>

/** The terminal font: a monospace stack, system fonts only (UI-THEMES: no web fonts). */
export const TERMINAL_FONT_STACK =
  '"JetBrains Mono", "SF Mono", Menlo, "Cascadia Mono", Consolas, "DejaVu Sans Mono", ui-monospace, monospace'

// --- Colours ------------------------------------------------------------------------------------

/** The theme tokens (UI-THEMES.md) a terminal palette is made from, as #rrggbb. */
export interface ThemeTokens {
  bg: string
  bgSubtle: string
  border: string
  text: string
  textMuted: string
  accent: string
  focus: string
  success: string
  warning: string
  danger: string
  info: string
  selection: string
}

export const ANSI_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const
export type AnsiName = (typeof ANSI_NAMES)[number]

/** xterm's ITheme subset DevDock sets (kept structural so shared code doesn't import xterm). */
export type TerminalPalette = Record<AnsiName, string> & {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionForeground: string
  selectionInactiveBackground: string
}

type Rgb = [number, number, number]

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`)
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`

/** `a` moved `t` (0–1) of the way to `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a)
  const y = parseHex(b)
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as Rgb)
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * `color`, nudged towards `toward` (the theme's text colour, so it keeps its hue as long as
 * possible) until it reaches `min` contrast on `bg`.
 */
export function ensureContrast(color: string, bg: string, toward: string, min: number): string {
  let c = color
  for (let t = 0.1; contrast(c, bg) < min && t <= 1.0001; t += 0.1) c = mix(color, toward, t)
  // The text colour itself may fall short (it never does in DevDock's themes): go all the way.
  if (contrast(c, bg) < min) c = luminance(bg) > 0.5 ? '#000000' : '#ffffff'
  return c
}

/** Text in the terminal must read like text in the app: AA everywhere, AAA in High Contrast. */
export const minContrastFor = (highContrast: boolean) => (highContrast ? 7 : 4.5)

/**
 * A 16-colour ANSI palette from DevDock's theme tokens. Red, green, yellow and blue are the
 * danger, success, warning and info tokens; cyan sits between info and success and magenta
 * between danger and info — so oh-my-zsh's robbyrussell prompt (green/red arrow, cyan folder,
 * blue `git:(`, red branch, yellow ✗) reads in the theme's own colours. Bright colours step
 * towards the text colour. Every colour except black/white (which are meant to be close to
 * the background on one side) is raised to the theme's text contrast.
 */
export function terminalPalette(t: ThemeTokens, opts: { highContrast?: boolean } = {}): TerminalPalette {
  const dark = luminance(t.bg) < 0.5
  const min = minContrastFor(opts.highContrast ?? false)
  const fit = (c: string) => ensureContrast(c, t.bg, t.text, min)
  const brighter = (c: string) => fit(mix(c, dark ? '#ffffff' : t.text, 0.25))

  const red = fit(t.danger)
  const green = fit(t.success)
  const yellow = fit(t.warning)
  const blue = fit(t.info)
  const cyan = fit(mix(t.info, t.success, 0.5))
  const magenta = fit(mix(t.danger, t.info, 0.5))
  // Dark themes: black is a step above the background, white is the text colour.
  // Light themes: black is the text colour, white a step below the background.
  const black = dark ? t.border : t.text
  const white = dark ? t.text : t.border
  return {
    background: t.bg,
    foreground: fit(t.text),
    cursor: fit(t.focus),
    cursorAccent: t.bg,
    selectionBackground: t.selection,
    selectionForeground: t.text,
    selectionInactiveBackground: mix(t.selection, t.bg, 0.4),
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    // Bright black is muted text (zsh autosuggestions, comments): it must still be readable.
    brightBlack: fit(t.textMuted),
    brightRed: brighter(t.danger),
    brightGreen: brighter(t.success),
    brightYellow: brighter(t.warning),
    brightBlue: brighter(t.info),
    brightMagenta: brighter(mix(t.danger, t.info, 0.5)),
    brightCyan: brighter(mix(t.info, t.success, 0.5)),
    brightWhite: dark ? '#ffffff' : t.bgSubtle,
  }
}
