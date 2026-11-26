import { DEFAULT_MIN_SUPPORT_PCT, MIN_SUPPORT_PCT_RANGE, validMinSupportPct } from "@compass/physics"
import { recordOf } from "@/lib/json"

/** Allowed range for the minimum support share, as a percentage. The project value is the single source of truth. */
export const MIN_SUPPORT_PCT = {
  min: MIN_SUPPORT_PCT_RANGE.min,
  max: MIN_SUPPORT_PCT_RANGE.max,
  /** What every part uses when the project has not set one. The same value the packer always used. */
  fallback: DEFAULT_MIN_SUPPORT_PCT,
} as const

/** The project's own minimum support percentage, or null when it has none (each part then uses its own default). */
export function projectMinSupportPct(rules: unknown): number | null {
  return validMinSupportPct(recordOf(rules).minSupportPct)
}
