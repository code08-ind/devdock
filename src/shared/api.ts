import type { EventChannel, InvokeChannel } from './channels'
import type { EventPayload, IpcEnvelope, Req, Res } from './ipc'

type Namespace<C extends string> = C extends `${infer N}:${string}` ? N : never

type Args<C extends InvokeChannel> = undefined extends Req<C> ? [] : [payload: Req<C>]

/**
 * Shape of `window.devdock`. Generated from the channel allow-list: channel `ns:method` becomes
 * `devdock.ns.method(payload)`. Methods resolve to an envelope; the renderer client unwraps it.
 */
export type DevDockBridge = {
  [N in Namespace<InvokeChannel>]: {
    [C in InvokeChannel as C extends `${N}:${infer M}` ? M : never]: (
      ...args: Args<C>
    ) => Promise<IpcEnvelope<Res<C>>>
  }
} & {
  on<E extends EventChannel>(event: E, listener: (payload: EventPayload<E>) => void): () => void
  readonly platform: 'darwin' | 'win32' | 'linux'
}
