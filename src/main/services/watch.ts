import type { PrRef } from '@shared/bitbucket'
import { parsePrLink } from '@shared/prlink'
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

/**
 * The PR behind a link (both URL shapes), refused before any request when it isn't a PR link
 * or isn't on the configured Bitbucket site (the token must never go to another host).
 */
export function prRefFromLink(link: string, site: string | null): { ref: PrRef; site: string } {
  const parsed = parsePrLink(link)
  if (!parsed) throw new WatchError('invalid', "That isn't a Bitbucket pull request link.")
  if (siteKey(parsed.baseUrl) !== site) {
    throw new WatchError(
      'other-site',
      site
        ? `That link is on ${parsed.baseUrl}, but DevDock reads pull requests from ${site}. Change it in Settings → Bitbucket.`
        : 'Set the Bitbucket server URL in Settings → Bitbucket first.',
    )
  }
  return { ref: parsed.ref, site: site! }
}
