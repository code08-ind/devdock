import {
  PROVIDER_ACTIONS,
  providerOf,
  type PrActionRequest,
  type PrList,
  type PrRef,
  type PullRequest,
  type PrChanges,
} from '@shared/bitbucket'
import { PROVIDER_NAMES, type Provider } from '@shared/providers'
import type { ActionResult } from '../bitbucket/client'
import { ServiceError } from '../service-error'

/**
 * P7.04 provider model: one place that knows which provider a PR belongs to. Bitbucket,
 * GitHub and GitLab each implement `PrSource`; the watcher, Today, lists, palette and PR
 * actions talk to the hub, which routes by the ref's provider.
 */
export interface PrSource {
  list(list: PrList): Promise<PullRequest[]>
  pr(ref: PrRef): Promise<PullRequest>
  /** T7: description and changed files (bounded), for the AI summary. */
  changes(ref: PrRef): Promise<PrChanges>
  /** Checks done: the handler confirmed the switch and the confirmation. */
  act(request: PrActionRequest): Promise<ActionResult>
  /** Where this provider's PRs are read from (`siteKey` spelling); null when not set up. */
  site(): string | null
}

export class PrHub {
  constructor(private readonly sources: Record<Provider, PrSource>) {}

  list(provider: Provider, list: PrList): Promise<PullRequest[]> {
    return this.sources[provider].list(list)
  }

  pr(ref: PrRef): Promise<PullRequest> {
    return this.sources[providerOf(ref)].pr(ref)
  }

  changes(ref: PrRef): Promise<PrChanges> {
    return this.sources[providerOf(ref)].changes(ref)
  }

  async act(request: PrActionRequest): Promise<ActionResult> {
    const provider = providerOf(request.ref)
    if (!PROVIDER_ACTIONS[provider].includes(request.action)) {
      throw new ServiceError(
        'forbidden',
        `${PROVIDER_NAMES[provider]} doesn't offer “${request.action.replace('_', ' ')}” through its API.`,
      )
    }
    return this.sources[provider].act(request)
  }

  site(provider: Provider): string | null {
    return this.sources[provider].site()
  }

  /**
   * One list from several providers, newest activity first. A provider that isn't set up is
   * left out; if every one fails, the first failure is the answer.
   */
  async listAll(providers: readonly Provider[], list: PrList): Promise<PullRequest[]> {
    const results = await Promise.allSettled(providers.map((p) => this.list(p, list)))
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    if (ok.length === 0 && results.length > 0) throw (results[0] as PromiseRejectedResult).reason
    return ok.flat().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }
}
