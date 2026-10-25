import { PrRefSchema, type BitbucketFlavor, type PrRef, type RepoRef } from './bitbucket'
import type { Provider } from './providers'

/**
 * Pull-request links (SPEC 6.3 "Paste a PR link anywhere"). Shared: the palette checks input
 * as it is typed, the main process parses again before watching.
 *
 * Cloud:  https://bitbucket.org/<workspace>/<repo>/pull-requests/<id>[/diff|/commits|…]
 * DC:     https://<host>[/<context>]/projects/<KEY>/repos/<repo>/pull-requests/<id>[/overview|/diff|…]
 *         https://<host>[/<context>]/users/<user>/repos/<repo>/pull-requests/<id>[…]  → owner `~user`
 * Query strings and fragments are ignored.
 */

export const CLOUD_WEB = 'https://bitbucket.org'
/** Cloud's REST API; bitbucket.org web and API hosts both mean Cloud. */
export const CLOUD_API = 'https://api.bitbucket.org/2.0'
export const isCloudHost = (hostname: string) => /^(www\.|api\.)?bitbucket\.org$/i.test(hostname)

export interface ParsedPrLink {
  flavor: BitbucketFlavor
  /** Site the link belongs to: `https://bitbucket.org`, or the DC origin + context path. */
  baseUrl: string
  ref: PrRef
}

export function parsePrLink(input: string): ParsedPrLink | null {
  let text = input.trim().replace(/^<(.*)>$/, '$1')
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const parts = url.pathname.split('/').filter(Boolean).map(safeDecode)
  if (parts.some((p) => p === null)) return null
  const segs = parts as string[]

  if (isCloudHost(url.hostname)) {
    const [owner, repo, kind, id] = segs
    if (kind !== 'pull-requests') return null
    return build('cloud', CLOUD_WEB, owner, repo, id)
  }

  // Data Center: find `projects|users / X / repos / Y / pull-requests / N` after any context path.
  for (let i = 0; i + 6 <= segs.length; i++) {
    const [scope, owner, repos, repo, kind, id] = segs.slice(i, i + 6)
    if ((scope !== 'projects' && scope !== 'users') || repos !== 'repos') continue
    if (kind !== 'pull-requests') return null
    const context = segs.slice(0, i).map(encodeURIComponent).join('/')
    const baseUrl = `${url.origin}${context ? `/${context}` : ''}`
    return build('datacenter', baseUrl, scope === 'users' ? `~${owner}` : owner, repo, id)
  }
  return null
}

function build(
  flavor: BitbucketFlavor,
  baseUrl: string,
  owner: string | undefined,
  repo: string | undefined,
  id: string | undefined,
): ParsedPrLink | null {
  if (!id || !/^\d+$/.test(id)) return null
  const ref = PrRefSchema.safeParse({ owner, repo, id: Number(id) })
  return ref.success ? { flavor, baseUrl, ref: ref.data } : null
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

/**
 * `<workspace>/<repo>` from a bitbucket.org git remote (SSH, scp-style or HTTPS), else null.
 * Cloud has no "PRs I review" endpoint, so DevDock scans the registered repos' Cloud remotes.
 */
export function cloudRepoFromRemote(remote: string): RepoRef | null {
  const m =
    /^(?:[\w.-]+@)?(?:www\.)?bitbucket\.org:\/?([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remote) ??
    /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?(?:www\.)?bitbucket\.org(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      remote,
    )
  if (!m) return null
  const ref = PrRefSchema.safeParse({ owner: m[1], repo: m[2], id: 1 })
  return ref.success && !ref.data.owner.startsWith('~')
    ? { owner: ref.data.owner, repo: ref.data.repo }
    : null
}

/**
 * Any provider's pull-request link (P7.04), for `watch <link>` and the Watch field:
 *
 * Bitbucket: as `parsePrLink`.
 * GitHub:    https://github.com/<owner>/<repo>/pull/<n>[/files|/checks|…]
 *            https://<GitHub Enterprise host>/<owner>/<repo>/pull/<n>[…]
 * GitLab:    https://gitlab.com/<group>[/<subgroup>…]/<project>/-/merge_requests/<iid>[/diffs|…]
 *            (self-managed hosts the same; a relative URL root is taken off by `withinSite`)
 *
 * The shape decides the provider (`/pull/`, `/-/merge_requests/` and Bitbucket's
 * `/pull-requests/` never overlap); main then checks the host is the configured site before
 * any request carries a token.
 */
export interface AnyPrLink {
  provider: Provider
  /** Bitbucket: the site as `parsePrLink` gives it. GitHub / GitLab: the link's origin. */
  baseUrl: string
  ref: PrRef
}

export function parseAnyPrLink(input: string): AnyPrLink | null {
  const bitbucket = parsePrLink(input)
  if (bitbucket) return { provider: 'bitbucket', baseUrl: bitbucket.baseUrl, ref: bitbucket.ref }
  const url = linkUrl(input)
  const segs = url ? pathParts(url) : null
  if (!url || !segs) return null

  const dash = segs.indexOf('-')
  if (dash >= 2 && segs[dash + 1] === 'merge_requests') {
    const path = segs.slice(0, dash)
    return refFor('gitlab', url.origin, path.slice(0, -1).join('/'), path.at(-1), segs[dash + 2])
  }
  if (segs[2] === 'pull' && segs.length >= 4) {
    return refFor('github', url.origin, segs[0], segs[1], segs[3])
  }
  return null
}

/**
 * A GitHub / GitLab link read against the configured site (`siteKey` spelling): null when the
 * link is elsewhere. A self-managed GitLab under a relative URL root (`https://host/gitlab`)
 * puts that root in front of the group, so it comes off the namespace here.
 */
export function withinSite(link: AnyPrLink, site: string): AnyPrLink | null {
  if (link.provider !== 'gitlab') return link.baseUrl.toLowerCase() === site ? link : null
  const full = `${link.baseUrl}/${link.ref.owner}`
  if (!full.toLowerCase().startsWith(`${site}/`)) return null
  const ref = PrRefSchema.safeParse({ ...link.ref, owner: full.slice(site.length + 1) })
  return ref.success ? { ...link, baseUrl: site, ref: ref.data } : null
}

function linkUrl(input: string): URL | null {
  let text = input.trim().replace(/^<(.*)>$/, '$1')
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

function pathParts(url: URL): string[] | null {
  const parts = url.pathname.split('/').filter(Boolean).map(safeDecode)
  return parts.some((p) => p === null) ? null : (parts as string[])
}

function refFor(
  provider: 'github' | 'gitlab',
  origin: string,
  owner: string | undefined,
  repo: string | undefined,
  id: string | undefined,
): AnyPrLink | null {
  if (!owner || !id || !/^\d+$/.test(id)) return null
  const ref = PrRefSchema.safeParse({ provider, owner, repo, id: Number(id) })
  return ref.success ? { provider, baseUrl: origin, ref: ref.data } : null
}
