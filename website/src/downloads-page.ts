import './style.css'
import { detect, type NavigatorLike } from './detect'
import { loadDownloads } from './downloads'
import { initDownloadDialog, renderLatest, renderSoon, renderVersions } from './download-ui'
import { initTheme, type Platform } from './ui'

/** `downloads#mac` / `downloads#windows` (from the home page's buttons) picks the platform. */
function picked(): Platform | null {
  const hash = location.hash.slice(1)
  return hash === 'mac' || hash === 'windows' ? hash : null
}

async function init(): Promise<void> {
  initTheme()
  const [d, { release, versions }] = await Promise.all([
    detect(navigator as unknown as NavigatorLike),
    loadDownloads(),
  ])
  document.documentElement.dataset.os = d.os
  const choice = picked()
  document
    .getElementById('download-root')
    ?.replaceChildren(
      ...(release.available ? renderLatest(release, d, choice) : renderSoon(release)),
    )
  document.getElementById('versions-root')?.replaceChildren(...renderVersions(versions))
  initDownloadDialog([...release.installers, ...versions.flatMap((v) => v.installers)])
  // The cards are drawn after load, so the browser's own jump to #mac / #windows missed them.
  if (choice) document.getElementById(choice)?.scrollIntoView({ block: 'center' })
}

void init()
