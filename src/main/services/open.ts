/** "Open in VS Code / terminal / file manager" (SPEC 6.2). Command building is pure and tested. */
import { spawn } from 'node:child_process'

export interface OpenCommand {
  file: string
  args: string[]
  /** Working directory; on Windows the folder is passed this way so cmd.exe never parses it. */
  cwd?: string
  /** Pass `args` to cmd.exe as written (already quoted). */
  verbatim?: boolean
}

/**
 * The editor command. On Windows the `code` launcher is a .cmd script, which Node won't spawn
 * without a shell. Going through `cmd.exe` safely: the folder becomes the working directory and
 * the editor opens `.`; the only text cmd parses is the editor path, which the settings schema
 * restricts to known launchers with no `"`, `%` or `^` (isAllowedEditorPath).
 */
export function editorCommand(
  editorPath: string,
  folder: string,
  platform: NodeJS.Platform,
): OpenCommand {
  if (platform === 'win32' && !/\.exe$/i.test(editorPath)) {
    return {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', `""${editorPath}" ."`],
      cwd: folder,
      verbatim: true,
    }
  }
  return { file: editorPath, args: [folder] }
}

/** macOS fallback when `code` isn't on the PATH a Finder-launched app gets. */
export function editorFallback(folder: string, platform: NodeJS.Platform): OpenCommand | null {
  return platform === 'darwin'
    ? { file: 'open', args: ['-b', 'com.microsoft.VSCode', folder] }
    : null
}

export function terminalCommand(folder: string, platform: NodeJS.Platform): OpenCommand {
  switch (platform) {
    case 'darwin':
      return { file: 'open', args: ['-a', 'Terminal', folder] }
    case 'win32':
      // `start cmd.exe` opens a new console that inherits the working directory.
      return { file: 'cmd.exe', args: ['/d', '/c', 'start', 'cmd.exe'], cwd: folder }
    default:
      return { file: 'x-terminal-emulator', args: [], cwd: folder }
  }
}

/** Starts a GUI program without waiting for it; rejects if it can't be started (ENOENT). */
export function launchDetached(cmd: OpenCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.file, cmd.args, {
      cwd: cmd.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: cmd.verbatim ?? false,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      // Keep a listener so a late error from the detached child can't crash the main process.
      child.on('error', () => undefined)
      child.unref()
      resolve()
    })
  })
}
