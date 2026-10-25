import type { ConsoleChunk } from '@shared/jenkins'

/**
 * Console tail (SPEC 6.4) over `GET …/{n}/logText/progressiveText?start={offset}`. Jenkins
 * answers with the log from `start` and two headers: `X-Text-Size` (the offset to ask for
 * next, in bytes) and `X-More-Data: true` while the build may still write. Pure.
 */

/** Longest chunk passed to the renderer; a longer one keeps its end. */
export const MAX_CHUNK_CHARS = 512 * 1024

/** ANSI colour/cursor codes and Jenkins' hidden console notes (`ESC[8mha:…ESC[0m`). */
// eslint-disable-next-line no-control-regex -- console notes and ANSI codes start with ESC (\x1b).
const CONSOLE_NOTE = /\u001b\[8mha:[^\u001b]*\u001b\[0m/g
// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC (\x1b).
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

export function cleanConsole(text: string): string {
  return text.replace(CONSOLE_NOTE, '').replace(ANSI, '')
}

/**
 * Bytes at the end that start a UTF-8 character without finishing it (0–3). Jenkins cuts the
 * log at a byte offset, which can fall inside a character.
 */
export function incompleteTail(bytes: Uint8Array): number {
  for (let back = 1; back <= Math.min(4, bytes.length); back++) {
    const b = bytes[bytes.length - back]!
    if ((b & 0xc0) === 0x80) continue // continuation byte: keep looking for the lead
    const needed = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1
    return back < needed ? back : 0
  }
  return 0
}

export function consoleChunk(
  start: number,
  body: Uint8Array,
  headers: { textSize: string | null; moreData: string | null },
): ConsoleChunk {
  const more = headers.moreData?.trim().toLowerCase() === 'true'
  const size = /^\d+$/.test(headers.textSize?.trim() ?? '') ? Number(headers.textSize) : null
  // A log shorter than what was read already was replaced (build restarted, log rotated).
  // `more` is set so the caller reads once more from 0, even if that build has finished.
  if (size !== null && size < start) {
    return { text: '', nextStart: 0, more: true, reset: true, truncated: false }
  }
  // Without the header, the next read starts after what arrived.
  const end = size ?? start + body.length
  // A character cut in half is read again, whole, next time (unless nothing more will come).
  const held = more ? incompleteTail(body) : 0
  const cleaned = cleanConsole(new TextDecoder().decode(body.subarray(0, body.length - held)))
  const truncated = cleaned.length > MAX_CHUNK_CHARS
  return {
    text: truncated ? cleaned.slice(-MAX_CHUNK_CHARS) : cleaned,
    nextStart: end - held,
    more,
    reset: false,
    truncated,
  }
}
