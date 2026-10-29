import type { AssetId } from './config'

/** Text with `**bold**` spans; rendered safely by `renderRich` in main.ts. */
export type Rich = string

export interface InstallGuide {
  /** "Install DevDock on your Mac" */
  heading: string
  install: Rich[]
  unsignedTitle: string
  unsigned: Rich[]
  work: Rich
  after: Rich
}

const WORK_MAC: Rich =
  '**On a work Mac?** Managed Macs (MDM) often block unsigned apps outright, and the Open Anyway button never appears. Ask your IT team to approve DevDock and point them to the GitHub repository: the source is public, it needs no admin rights, and it only talks to the services you set up, at the addresses you enter.'

const WORK_WIN: Rich =
  '**On a work PC?** Managed PCs (Intune, AppLocker) often block unsigned apps outright, and Run anyway never appears. Ask your IT team to approve DevDock and point them to the GitHub repository: the source is public, it needs no admin rights, and it only talks to the services you set up, at the addresses you enter.'

const AFTER: Rich =
  'DevDock starts in **demo mode**: every screen works on sample data, with no accounts and no network calls. Turn it off in **Settings → Demo mode** when you want to connect Jira, Bitbucket, Jenkins, GitHub or GitLab.'

const GATEKEEPER: Rich[] = [
  'The first time, macOS says DevDock can’t be checked for malicious software (on macOS 15 and later: **“DevDock Not Opened”**). Choose **Done**.',
  'Open **System Settings → Privacy & Security**, scroll to the message about DevDock and choose **Open Anyway**, then confirm with your password or Touch ID. You only do this once.',
]

const SMARTSCREEN: Rich[] = [
  'If Windows says **“Windows protected your PC”**, choose **More info**, then **Run anyway**. You only do this once.',
]

export function installGuide(id: AssetId, file: string): InstallGuide {
  switch (id) {
    case 'mac-arm64':
    case 'mac-x64':
      return {
        heading: 'Install DevDock on your Mac',
        install: [
          `Open **${file}** from your Downloads folder.`,
          'Drag **DevDock** onto the **Applications** folder in the window that opens, then eject the disk image.',
          'Open DevDock from Applications, Launchpad or Spotlight. Its icon appears in the menu bar.',
        ],
        unsignedTitle: 'DevDock isn’t signed by Apple yet, so macOS asks once',
        unsigned: GATEKEEPER,
        work: WORK_MAC,
        after: AFTER,
      }
    case 'win-setup':
      return {
        heading: 'Install DevDock on Windows',
        install: [
          `Run **${file}** from your Downloads folder.`,
          'Pick the folder to install to, or keep the suggested one. It installs for you only and needs no admin rights.',
          'Start DevDock from the Start menu. Its icon appears in the system tray (click ^ by the clock if it’s hidden).',
        ],
        unsignedTitle: 'DevDock isn’t code-signed yet, so Windows asks once',
        unsigned: SMARTSCREEN,
        work: WORK_WIN,
        after: AFTER,
      }
    case 'win-portable':
      return {
        heading: 'Run DevDock on Windows (portable)',
        install: [
          `Move **${file}** to any folder (or a USB stick). Nothing is installed.`,
          'Double-click it to start DevDock. Its icon appears in the system tray (click ^ by the clock if it’s hidden).',
        ],
        unsignedTitle: 'DevDock isn’t code-signed yet, so Windows asks once',
        unsigned: SMARTSCREEN,
        work: WORK_WIN,
        after: AFTER,
      }
  }
}
