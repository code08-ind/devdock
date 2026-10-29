import type { Settings } from '@shared/settings'
import {
  CURSOR_STYLES,
  ShellOverrideSchema,
  TERMINAL_FONT_SIZES,
  type CursorStyle,
} from '@shared/terminal'
import { useUpdateSettings } from '../../lib/devdock'
import { isMac } from '../../lib/keyboard'
import { ErrorNotice, useToast } from '../../ui/Feedback'
import { Field, SegmentedControl, Select, Toggle } from '../../ui/Field'
import { Section } from './Section'
import { TextSetting } from './ServiceBits'

const CURSOR_LABELS: Record<CursorStyle, string> = {
  block: 'Block',
  bar: 'Bar',
  underline: 'Underline',
}
const cursorOptions = CURSOR_STYLES.map((c) => ({ value: c, label: CURSOR_LABELS[c] }))
const sizeOptions = Array.from(
  { length: TERMINAL_FONT_SIZES.max - TERMINAL_FONT_SIZES.min + 1 },
  (_, i) => TERMINAL_FONT_SIZES.min + i,
).map((s) => ({ value: s as number | 'app', label: `${s}px` }))
const scrollbackOptions = [1000, 5000, 10_000, 50_000, 100_000].map((n) => ({
  value: n,
  label: `${n.toLocaleString('en')} lines`,
}))

/** P7-A: DevDock's own terminal. The shell's own config (.zshrc, oh-my-zsh) is never edited. */
export function TerminalSection({ settings }: { settings: Settings }) {
  const update = useUpdateSettings()
  const toast = useToast()
  const t = settings.terminal
  // A value saved by an older build may not be in the list: keep it selectable.
  const scrollback = scrollbackOptions.some((o) => o.value === t.scrollback)
    ? scrollbackOptions
    : [...scrollbackOptions, { value: t.scrollback, label: `${t.scrollback} lines` }]
  return (
    <Section
      id="terminal"
      title="Terminal"
      description="New terminals use these. Colours follow the theme."
    >
      <TextSetting
        label="Shell"
        hint={
          isMac
            ? 'Empty: your login shell. Or a name like zsh, bash, fish, or the full path to a shell.'
            : 'Empty: PowerShell. Or pwsh, powershell, cmd, or the full path to a shell.'
        }
        value={t.shell}
        validate={(v) => {
          const r = ShellOverrideSchema.safeParse(v)
          return r.success ? null : (r.error.issues[0]?.message ?? 'Not a shell.')
        }}
        onSave={(shell) =>
          update.mutate(
            { terminal: { shell } },
            { onSuccess: () => toast(shell ? 'Shell saved' : 'Using your login shell') },
          )
        }
      />
      <Field label="Font size">
        {({ id }) => (
          <Select
            id={id}
            options={[
              { value: 'app', label: `Same as the app (${settings.appearance.fontSize}px)` },
              ...sizeOptions,
            ]}
            value={t.fontSize}
            onValue={(fontSize) => update.mutate({ terminal: { fontSize } })}
          />
        )}
      </Field>
      <SegmentedControl
        label="Cursor"
        options={cursorOptions}
        value={t.cursorStyle}
        onValue={(cursorStyle) => update.mutate({ terminal: { cursorStyle } })}
      />
      <Toggle
        label="Blinking cursor"
        checked={t.cursorBlink}
        onChecked={(cursorBlink) => update.mutate({ terminal: { cursorBlink } })}
      />
      <Field label="Scrollback" hint="Lines kept above the screen in each terminal.">
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            options={scrollback}
            value={t.scrollback}
            onValue={(n) => update.mutate({ terminal: { scrollback: n } })}
          />
        )}
      </Field>
      <Toggle
        label="Use DevDock prompt"
        description="zsh and bash only. A robbyrussell-style prompt (green arrow, folder, git branch, ✗ when there are changes) for people without oh-my-zsh; when oh-my-zsh is loaded, zsh keeps its prompt. Your own startup files, options and key bindings still load and are never changed; leave it off to keep your own prompt."
        checked={t.devdockPrompt}
        onChecked={(devdockPrompt) => update.mutate({ terminal: { devdockPrompt } })}
      />
      {update.error ? <ErrorNotice error={update.error} /> : null}
    </Section>
  )
}
