/**
 * "Use DevDock prompt" (Settings → Terminal): a robbyrussell-style prompt for people without
 * oh-my-zsh. The user's own startup files are loaded first, exactly as a terminal would load
 * them, and are never edited: zsh starts with ZDOTDIR pointing at a folder DevDock owns whose
 * files source the real ones; bash starts with `--rcfile` pointing at DevDock's file.
 *
 * Safety: a branch name is only ever stored in a variable that the prompt references, so the
 * shell expands it once and never runs anything in it (git allows `$(`, `` ` `` in names).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ShellSpec } from './shell'

const HEADER = `# Written by DevDock for its built-in terminal ("Use DevDock prompt" in Settings → Terminal).
# Your own startup files are loaded unchanged; DevDock never edits them. Safe to delete.
`

/** Loads one of the user's zsh startup files with ZDOTDIR set to theirs, then back to ours. */
const zshSource = (file: string) => `${HEADER}
ZDOTDIR=\${DEVDOCK_USER_ZDOTDIR:-$HOME}
[[ -r $ZDOTDIR/${file} ]] && builtin source $ZDOTDIR/${file}
# The user's file may move ZDOTDIR (e.g. to ~/.config/zsh): later files are read from there.
DEVDOCK_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$DEVDOCK_ZDOTDIR
`

/** robbyrussell, from oh-my-zsh, rebuilt with plain zsh (no downloads, no plugins). */
export const ZSH_PROMPT = `
# --- DevDock prompt ---------------------------------------------------------------------------
autoload -Uz add-zsh-hook
setopt prompt_subst interactive_comments

__devdock_git_info() {
  local b
  b=$(command git symbolic-ref --short -q HEAD 2>/dev/null) ||
    b=$(command git rev-parse --short -q HEAD 2>/dev/null) || { __devdock_git=''; return 0 }
  local dirty=''
  [[ -n $(command git status --porcelain --ignore-submodules=dirty 2>/dev/null | command head -n 1) ]] &&
    dirty=' %F{yellow}%1{✗%}%f'
  # % is a prompt escape: double it. The name is never run (prompt_subst expands once).
  __devdock_git=" %B%F{blue}git:(%F{red}\${b//\\%/%%}%F{blue})%f%b\${dirty}"
}
add-zsh-hook precmd __devdock_git_info

# Arrow green after success, red after a failure; folder in cyan; git:(branch) ✗ when dirty.
PROMPT='%(?:%B%F{green}%1{➜%}%f%b :%B%F{red}%1{➜%}%f%b ) %F{cyan}%c%f\${__devdock_git} '
RPROMPT=''

# Colours without plugins: ls, completion lists, selections, and the command word.
export CLICOLOR=1
export LSCOLORS=\${LSCOLORS:-Gxfxcxdxbxegedabagacad}
zle_highlight=(region:standout special:standout suffix:bold isearch:underline paste:none)
zstyle ':completion:*' menu select
[[ -n $LS_COLORS ]] && zstyle ':completion:*:default' list-colors \${(s.:.)LS_COLORS}

# The first word of the line: green when it is a command, red when zsh can't find it.
# Skipped when zsh-syntax-highlighting is already loaded (it does this and more).
if (( ! \${+ZSH_HIGHLIGHT_VERSION} )) && autoload -Uz add-zle-hook-widget 2>/dev/null; then
  zmodload zsh/parameter 2>/dev/null
  __devdock_highlight() {
    region_highlight=()
    local lead=\${BUFFER%%[^[:space:]]*}
    local rest=\${BUFFER#$lead}
    local cmd=\${rest%%[[:space:]]*}
    [[ -z $cmd || $cmd == *=* ]] && return 0
    [[ $cmd =~ '^[[:alnum:]_./+-]+$' ]] || return 0
    local style='fg=red,bold'
    if (( \${+commands[$cmd]} || \${+functions[$cmd]} || \${+aliases[$cmd]} || \${+builtins[$cmd]} || \${reswords[(Ie)$cmd]} )) ||
      [[ $cmd == */* && -x $cmd && ! -d $cmd ]]; then
      style='fg=green'
    fi
    region_highlight=("\${#lead} $(( \${#lead} + \${#cmd} )) $style")
  }
  add-zle-hook-widget zle-line-pre-redraw __devdock_highlight
fi
`

/** The files of DevDock's ZDOTDIR. zsh reads .zlogin from the user's folder itself. */
export function zshFiles(): Record<string, string> {
  return {
    '.zshenv': zshSource('.zshenv'),
    '.zprofile': zshSource('.zprofile'),
    '.zshrc': `${HEADER}
ZDOTDIR=\${DEVDOCK_USER_ZDOTDIR:-$HOME}
[[ -r $ZDOTDIR/.zshrc ]] && builtin source $ZDOTDIR/.zshrc
# From here on zsh is the user's: .zlogin, history and nested shells use their folder.
[[ $ZDOTDIR == $HOME ]] && unset ZDOTDIR
unset DEVDOCK_USER_ZDOTDIR DEVDOCK_ZDOTDIR
${ZSH_PROMPT}`,
  }
}

/** bash: `--rcfile` replaces ~/.bashrc, so load what a login shell would, then the prompt. */
export function bashRc(): string {
  return `${HEADER}
[ -r /etc/profile ] && . /etc/profile
if [ -r "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"
elif [ -r "$HOME/.bash_login" ]; then . "$HOME/.bash_login"
elif [ -r "$HOME/.profile" ]; then . "$HOME/.profile"
elif [ -r "$HOME/.bashrc" ]; then . "$HOME/.bashrc"
fi

# --- DevDock prompt (robbyrussell-style) ------------------------------------------------------
__devdock_ps1() {
  local s=$?
  if [ "$s" -eq 0 ]; then __devdock_ac='1;32'; else __devdock_ac='1;31'; fi
  __devdock_b=$(command git symbolic-ref --short -q HEAD 2>/dev/null || command git rev-parse --short -q HEAD 2>/dev/null)
  __devdock_g1='' __devdock_g2='' __devdock_x=''
  if [ -n "$__devdock_b" ]; then
    __devdock_g1=' git:(' __devdock_g2=')'
    [ -n "$(command git status --porcelain --ignore-submodules=dirty 2>/dev/null | head -n 1)" ] && __devdock_x=' ✗'
  fi
  return $s
}
PROMPT_COMMAND="__devdock_ps1\${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
# Only variables in PS1: bash expands them once and never runs what is in a branch name.
PS1='\\[\\e[\${__devdock_ac}m\\]➜\\[\\e[0m\\] \\[\\e[36m\\]\\W\\[\\e[0m\\]\\[\\e[1;34m\\]\${__devdock_g1}\\[\\e[0;31m\\]\${__devdock_b}\\[\\e[1;34m\\]\${__devdock_g2}\\[\\e[0;33m\\]\${__devdock_x}\\[\\e[0m\\] '
export CLICOLOR=1
`
}

export interface PromptLaunch {
  args: string[]
  env: Record<string, string>
}

/**
 * Writes DevDock's prompt files under `dir` (DevDock's own data folder) and returns how to
 * start the shell with them. Shells other than zsh and bash start as usual.
 */
export async function withDevdockPrompt(
  spec: ShellSpec,
  dir: string,
  userZdotdir: string | undefined,
): Promise<PromptLaunch | null> {
  if (spec.kind === 'zsh') {
    const zdot = join(dir, 'zsh')
    await mkdir(zdot, { recursive: true })
    for (const [name, text] of Object.entries(zshFiles())) {
      await writeFile(join(zdot, name), text, { mode: 0o600 })
    }
    const env: Record<string, string> = { ZDOTDIR: zdot, DEVDOCK_ZDOTDIR: zdot }
    if (userZdotdir) env.DEVDOCK_USER_ZDOTDIR = userZdotdir
    return { args: spec.args, env }
  }
  if (spec.kind === 'bash') {
    await mkdir(dir, { recursive: true })
    const rc = join(dir, 'bashrc')
    await writeFile(rc, bashRc(), { mode: 0o600 })
    return { args: ['--rcfile', rc, '-i'], env: {} }
  }
  return null
}
