import { getResponse, type RequestHandler } from 'msw'

/**
 * Every adapter talks HTTP through this interface. The real client uses Electron's `net.fetch`
 * (OS proxy + OS certificate store); the demo client answers from MSW handlers in-process, so
 * demo mode needs no network and no credentials.
 */
export interface HttpClient {
  readonly demo: boolean
  fetch(request: Request): Promise<Response>
}

export type FetchLike = (request: Request) => Promise<Response>

export class RealHttpClient implements HttpClient {
  readonly demo = false
  constructor(private readonly doFetch: FetchLike) {}
  fetch(request: Request): Promise<Response> {
    return this.doFetch(request)
  }
}

export class DemoHttpClient implements HttpClient {
  readonly demo = true
  constructor(private readonly handlers: RequestHandler[]) {}
  async fetch(request: Request): Promise<Response> {
    const response = await getResponse(this.handlers, request)
    if (response) return response
    return new Response(
      JSON.stringify({ error: `No demo fixture for ${request.method} ${request.url}` }),
      {
        status: 501,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
}

/** Picks the client per call, so toggling demo mode applies immediately. */
export class SwitchingHttpClient implements HttpClient {
  constructor(
    private readonly isDemo: () => boolean,
    private readonly real: HttpClient,
    private readonly fake: HttpClient,
  ) {}
  get demo(): boolean {
    return this.isDemo()
  }
  fetch(request: Request): Promise<Response> {
    return (this.isDemo() ? this.fake : this.real).fetch(request)
  }
}
