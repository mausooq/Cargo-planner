/** A stored JSON value as a plain object, or an empty one for anything else (null, arrays, text, numbers). */
export function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
