/** Guards for reading untyped JSON from the service APIs. */

export type JsonObject = Record<string, unknown>

/** The value if it's a plain object, else `{}` (so property reads never throw). */
export const obj = (v: unknown): JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as JsonObject) : {}

/** A non-empty string, else null. */
export const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
