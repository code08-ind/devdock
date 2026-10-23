/** Validation shared by the settings schema (renderer-supplied) and the main-process git code. */

/** Valid per `git check-ref-format --branch`, and never something git could read as an option. */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length > 200) return false
  if (/^[-/.]/.test(name) || name.endsWith('/') || name.endsWith('.')) return false
  if ([...name].some((c) => c.charCodeAt(0) <= 0x20 || c.charCodeAt(0) === 0x7f)) return false
  if (/\.\.|@\{|\/\/|\/\.|\.lock(\/|$)|[~^:?*[\\]/.test(name)) return false
  return name !== '@'
}

/** Editor launchers DevDock may start ("Open in VS Code"); any folder, these file names only. */
const EDITOR_NAMES = /^(code|code-insiders|codium|vscodium|cursor)(\.cmd|\.exe)?$/i

/**
 * The editor path comes from Settings (renderer), so it must not name an arbitrary program,
 * and must be safe inside a quoted cmd.exe command line on Windows (no `"`, `%`, `^`, newlines).
 */
export function isAllowedEditorPath(path: string): boolean {
  if (/["%^\r\n]/.test(path)) return false
  const name = path.split(/[\\/]/).pop() ?? ''
  return EDITOR_NAMES.test(name)
}

/** Programs a dev command may start (SPEC 6.2 "runs the repo's npm run dev (configurable)"). */
const DEV_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'node'])
/** Characters a shell or cmd.exe would interpret; the command runs without a shell. */
const SHELL_META = /[&|<>^%"'`$;(){}\\\r\n*?!]/

/**
 * Splits a dev command into argv, or returns null if it isn't allowed: it must start with a
 * package-manager runner or a script inside the repo (`./…`), with no shell syntax.
 */
export function parseDevCommand(command: string): string[] | null {
  const trimmed = command.trim()
  if (!trimmed || trimmed.length > 500 || SHELL_META.test(trimmed)) return null
  const argv = trimmed.split(/\s+/)
  const first = argv[0]!
  const inRepo = first.startsWith('./') && !first.includes('..')
  return DEV_RUNNERS.has(first) || inRepo ? argv : null
}
