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
