import type { AssetId } from './config'

export type OS = 'mac' | 'windows' | 'linux' | 'mobile' | 'other'
export type Arch = 'arm64' | 'x64' | 'unknown'

export interface Detected {
  os: OS
  arch: Arch
}

/** The parts of `navigator` we read (typed here: `userAgentData` isn't in every DOM lib). */
export interface NavigatorLike {
  userAgent: string
  maxTouchPoints?: number
  userAgentData?: {
    mobile?: boolean
    platform?: string
    getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>
  }
}

function osFrom(nav: NavigatorLike): OS {
  const ua = nav.userAgent
  const platform = nav.userAgentData?.platform ?? ''
  if (nav.userAgentData?.mobile) return 'mobile'
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile'
  // iPadOS asks for desktop sites with a Mac user agent; a Mac has no touch points.
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return 'mobile'
  if (platform === 'macOS' || /Mac OS X|Macintosh/.test(ua)) return 'mac'
  if (platform === 'Windows' || /Windows/.test(ua)) return 'windows'
  if (platform === 'Linux' || platform === 'Chrome OS' || /Linux|CrOS|X11/.test(ua)) return 'linux'
  return 'other'
}

async function archFrom(nav: NavigatorLike): Promise<Arch> {
  // Chromium browsers say it when asked; Safari and Firefox don't (and every Mac user agent says
  // "Intel Mac OS X", even on Apple silicon), so the user agent can't tell Apple silicon from Intel.
  try {
    const values = await nav.userAgentData?.getHighEntropyValues?.(['architecture'])
    if (values?.architecture === 'arm') return 'arm64'
    if (values?.architecture === 'x86') return 'x64'
  } catch {
    // Hint refused: fall through.
  }
  if (/\b(arm64|aarch64)\b/i.test(nav.userAgent)) return 'arm64'
  if (/Windows/.test(nav.userAgent) && /\b(Win64|x64|WOW64)\b/.test(nav.userAgent)) return 'x64'
  return 'unknown'
}

export async function detect(nav: NavigatorLike): Promise<Detected> {
  const os = osFrom(nav)
  const arch = os === 'mac' || os === 'windows' ? await archFrom(nav) : 'unknown'
  return { os, arch }
}

/**
 * The installer to offer first. Macs default to Apple silicon unless the browser says Intel
 * (the page always offers an "Intel Mac?" link). Windows on Arm runs the x64 build under emulation.
 */
export function primaryAsset(d: Detected): AssetId | null {
  if (d.os === 'mac') return d.arch === 'x64' ? 'mac-x64' : 'mac-arm64'
  if (d.os === 'windows') return 'win-setup'
  return null
}

/** A sentence about what we detected, for the download section. */
export function describe(d: Detected): string {
  switch (d.os) {
    case 'mac':
      if (d.arch === 'x64') return 'Your browser says this is an Intel Mac.'
      if (d.arch === 'arm64') return 'Your browser says this is a Mac with Apple silicon.'
      return 'You’re on a Mac. Most Macs since 2020 have Apple silicon; your browser doesn’t say which.'
    case 'windows':
      return d.arch === 'arm64'
        ? 'You’re on Windows on Arm. The 64-bit build runs there under Windows’ x64 emulation.'
        : 'You’re on Windows.'
    case 'linux':
      return 'DevDock is made for macOS and Windows; there’s no Linux build yet.'
    case 'mobile':
      return 'DevDock is a desktop app. Open this page on your Mac or PC to download it.'
    case 'other':
      return 'Pick the installer for your computer.'
  }
}
