/**
 * The minimum share of a stacked piece's footprint that must rest on something. One default and one
 * way of resolving it, used by the packer, the Playground's drop check, the free-spot search and the
 * server's save check, so they cannot disagree about the same layout.
 *
 * This is a planning constraint, not a guarantee of physical stability: it is an area ratio plus a
 * check that the centre of gravity lies over the support. It does not model friction, load shift,
 * vibration or securing, and a layout that passes it is not thereby safe to ship.
 */

/** The default, kept at the packer's own, stricter value. */
export const DEFAULT_MIN_SUPPORT_PCT = 75

/** The values a project may choose. Anything outside is not a support setting. */
export const MIN_SUPPORT_PCT_RANGE = { min: 50, max: 100 } as const

/** A valid project support percentage, rounded to a tenth, or null. */
export function validMinSupportPct(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  if (value < MIN_SUPPORT_PCT_RANGE.min || value > MIN_SUPPORT_PCT_RANGE.max) return null
  return Math.round(value * 10) / 10
}

/** The percentage in force: the project's own when it has a valid one, otherwise the default. */
export function resolveMinSupportPct(projectValue: unknown): number {
  return validMinSupportPct(projectValue) ?? DEFAULT_MIN_SUPPORT_PCT
}

/** Same, as the 0 to 1 ratio the geometry uses. */
export function resolveMinSupportRatio(projectValue: unknown): number {
  return resolveMinSupportPct(projectValue) / 100
}
