import type { PrRef } from '@shared/bitbucket'
import { parseAnyPrLink, withinSite } from '@shared/prlink'
import { PROVIDER_NAMES, type Provider } from '@shared/providers'
import { siteKey } from './bitbucket/service'

/** Refusals shared by the PR and build watch lists, given before any request is sent. */

/** `unresolved`: no Jenkins job builds the PR, or no deploy job is set (build watches). */
export type WatchErrorKind = 'invalid' | 'other-site' | 'limit' | 'unresolved'

/** A watch refused before Bitbucket or Jenkins was asked. */
export class WatchError extends Error {
  override readonly name = 'WatchError'
  constructor(
    readonly kind: WatchErrorKind,
    message: string,
  ) {
    super(message)
  }
}

/** Where each provider's PRs are read from (`siteKey` spelling); null when not set up. */
export type SiteFor = (provider: Provider) => string | null

/**
 * The PR behind a link (Bitbucket's two URL shapes, GitHub, GitLab), refused before any request
 * when it isn't a PR link or isn't on the site that provider reads from (the token must never
 * go to another host). `site` is checked per provider.
 */
export function prRefFromLink(link: string, site: SiteFor): { ref: PrRef; site: string } {
  const parsed = parseAnyPrLink(link)
  if (!parsed) {
    throw new WatchError(
      'invalid',
      "That isn't a pull request link (Bitbucket, GitHub, or a GitLab merge request).",
    )
  }
  const name = PROVIDER_NAMES[parsed.provider]
  const expected = site(parsed.provider)
  const onSite =
    expected === null
      ? null
      : parsed.provider === 'bitbucket'
        ? siteKey(parsed.baseUrl) === expected
          ? parsed
          : null
        : withinSite(parsed, expected)
  if (!onSite) {
    throw new WatchError(
      'other-site',
      expected
        ? `That link is on ${parsed.baseUrl}, but DevDock reads ${name} from ${expected}. Change it in Settings → ${name}.`
        : parsed.provider === 'bitbucket'
          ? 'Turn on Bitbucket and set its server URL in Settings → Bitbucket first.'
          : `Turn on ${name} in Settings → ${name} first.`,
    )
  }
  return { ref: onSite.ref, site: expected! }
}
