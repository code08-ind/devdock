import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { INVOKE_CHANNELS, type InvokeChannel } from '@shared/channels'
import { contract, type ErrorCode, type IpcEnvelope, type Req, type Res } from '@shared/ipc'
import { log } from '../services/logger'

/** Thrown by handlers to return a typed, human-readable error to the renderer. */
export class IpcError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: string,
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

/** Channels whose response is `undefined` may return nothing. */
type HandlerResult<C extends InvokeChannel> = undefined extends Res<C> ? Res<C> | void : Res<C>

export type Handler<C extends InvokeChannel> = (
  payload: z.output<(typeof contract)[C]['req']>,
  event: IpcMainInvokeEvent | null,
) => Promise<HandlerResult<C>> | HandlerResult<C>

export type HandlerMap = { [C in InvokeChannel]: Handler<C> }

export type SenderCheck = (event: IpcMainInvokeEvent) => boolean

/**
 * Validates the payload, runs the handler, validates the response and wraps the result in an
 * envelope. Exported separately so it can be unit-tested without Electron's ipcMain.
 */
export async function dispatch<C extends InvokeChannel>(
  channel: C,
  raw: unknown,
  handlers: HandlerMap,
  event: IpcMainInvokeEvent | null = null,
): Promise<IpcEnvelope<Res<C>>> {
  const spec = contract[channel]
  if (!spec) {
    return {
      ok: false,
      error: { code: 'UNKNOWN_CHANNEL', message: `Unknown channel ${String(channel)}` },
    }
  }
  const parsed = spec.req.safeParse(raw)
  if (!parsed.success) {
    log.warn(`ipc ${channel} rejected invalid payload`)
    return {
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: 'The request was not in the expected format.',
        details: z.prettifyError(parsed.error),
      },
    }
  }
  try {
    const handler = handlers[channel] as Handler<C>
    const result = await handler(parsed.data as z.output<(typeof contract)[C]['req']>, event)
    const out = spec.res.safeParse(result)
    if (!out.success) {
      log.error(`ipc ${channel} produced an invalid response`, z.prettifyError(out.error))
      return {
        ok: false,
        error: { code: 'INTERNAL', message: 'DevDock produced an unexpected response.' },
      }
    }
    return { ok: true, data: out.data as Res<C> }
  } catch (err) {
    if (err instanceof IpcError) {
      return { ok: false, error: { code: err.code, message: err.message, details: err.details } }
    }
    log.error(`ipc ${channel} failed`, err)
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong.',
        details: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

export function registerIpc(handlers: HandlerMap, isTrustedSender: SenderCheck): void {
  for (const channel of INVOKE_CHANNELS) {
    ipcMain.handle(channel, (event, raw: unknown) => {
      if (!isTrustedSender(event)) {
        log.warn(`ipc ${channel} from untrusted sender ${event.senderFrame?.url ?? '?'}`)
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender.' } }
      }
      return dispatch(channel, raw, handlers, event)
    })
  }
}

export type { Req }
