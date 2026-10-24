import type { BitbucketDetection } from '@shared/bitbucket'
import { isCloudHost } from '@shared/prlink'
import type { HttpClient } from '../http'
import { obj, text } from '../json'
import { requestJson } from '../rest'
import { ServiceError } from '../service-error'
import { dcHints } from './datacenter'

/**
 * Settings → Bitbucket "Detect": bitbucket.org is Cloud; anything else is probed with Data
 * Center's unauthenticated `application-properties` (it names the product and version). A
 * server that wants a login for it (401/403 on that DC-only path) is Data Center, version unknown.
 */
export async function detectBitbucket(
  http: HttpClient,
  baseUrl: string,
  timeoutMs = 10_000,
): Promise<BitbucketDetection> {
  if (isCloudHost(new URL(baseUrl).hostname)) return { flavor: 'cloud', version: null }
  const notBitbucket = () =>
    new ServiceError(
      'not_found',
      `${baseUrl} doesn't look like Bitbucket Data Center or Server. Use the address you open Bitbucket at (including any path such as /bitbucket), or https://bitbucket.org for Cloud.`,
    )
  let body: unknown
  try {
    ;({ body } = await requestJson(
      http,
      { service: 'Bitbucket', hints: dcHints, timeoutMs },
      `${baseUrl}/rest/api/1.0/application-properties`,
    ))
  } catch (err) {
    if (!(err instanceof ServiceError)) throw err
    // That path only exists on Data Center; some servers want a login for it.
    if (err.kind === 'auth' || err.kind === 'forbidden')
      return { flavor: 'datacenter', version: null }
    // 404 or a non-JSON page: a server, just not Bitbucket.
    if (err.kind === 'not_found' || err.kind === 'bad_response') throw notBitbucket()
    throw err
  }
  const props = obj(body)
  const version = text(props.version)
  if (!version || !/bitbucket|stash/i.test(text(props.displayName) ?? 'Bitbucket')) {
    throw notBitbucket()
  }
  return { flavor: 'datacenter', version }
}
