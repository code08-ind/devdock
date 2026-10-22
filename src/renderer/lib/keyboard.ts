/** Platform-aware keyboard helpers. */
export const isMac = window.devdock.platform === 'darwin'

/** Cmd on macOS, Ctrl elsewhere. */
export function hasMod(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

/** Visible label for Mod+key: "⌘K" on macOS, "Ctrl+K" elsewhere. */
export function modLabel(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`
}

/** `aria-keyshortcuts` value for Mod+key (uses the spec's key names, e.g. "Meta+K"). */
export function modAria(key: string): string {
  return `${isMac ? 'Meta' : 'Control'}+${key}`
}

/** Shows an Electron accelerator the way the OS writes it, e.g. ⌘⇧Space or Ctrl+Shift+Space. */
export function formatAccelerator(acc: string): string {
  const parts = acc.split('+').map((p) => {
    const k = p.toLowerCase()
    if (k === 'commandorcontrol' || k === 'cmdorctrl') return isMac ? '⌘' : 'Ctrl'
    if (k === 'command' || k === 'cmd') return '⌘'
    if (k === 'control' || k === 'ctrl') return isMac ? '⌃' : 'Ctrl'
    if (k === 'alt' || k === 'option') return isMac ? '⌥' : 'Alt'
    if (k === 'shift') return isMac ? '⇧' : 'Shift'
    return p.length === 1 ? p.toUpperCase() : p
  })
  return isMac ? parts.join('') : parts.join('+')
}
