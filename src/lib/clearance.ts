/**
 * Handling clearance ("allowance"): free space kept around cargo, per side, in centimetres.
 * It is operational spacing (forks, hands, lashing room). It is NOT packaging: wrapping or crating
 * already inside the entered dimensions must not be entered again here.
 *
 * Storage needs no migration. The project default lives in `Project.rules` as `{ clearanceCm }`.
 * A cargo line's own setting lives in `CargoItem.customFields`: `{ clearanceCm: n }` for a uniform
 * value (0 is an explicit "none"), `{ clearanceSides: { front, rear, left, right } }` for directional
 * values, and neither key to inherit the project default. Missing means 0 / inherit, so every
 * project saved before these features keeps its previous behaviour.
 */

import { recordOf } from "@/lib/json"
import {
  DEFAULT_MIN_SUPPORT_PCT,
  MIN_SUPPORT_PCT_RANGE,
  validMinSupportPct,
  describeSetting,
  describeSides,
  MAX_CLEARANCE_CM,
  normaliseSetting,
  normaliseSides,
  placedSides,
  sameSetting,
  uniformSides,
  type Clearance4,
  type ClearanceSetting,
  type SideClearance,
} from "@compass/physics"

export { MAX_CLEARANCE_CM }

export const CLEARANCE_HELP =
  "Free space kept around each piece for forks, hands or lashing. It can be the same on every side or set separately for front, rear, left and right (as the cargo is entered; the values turn with the piece). Between two pieces the gap is shared: it only has to be the larger of the two facing allowances. Against a wall the piece keeps its full allowance. It is reserved handling space, not packaging and not stacking support. Do not add packaging that is already in the entered sizes."

export const ACTUAL_FLOOR_HELP =
  "Floor covered by the cargo's own footprints (entered external sizes). Overlaps count once. Stacked or raised pieces are not counted."

export const EFFECTIVE_FLOOR_HELP =
  "Floor needed once each piece's handling allowance is added around it, per side. Shared gaps and overlaps count once and the area is not clipped to the unit. Equals the actual figure when no allowance is set."

export const AXLE_ESTIMATE_NOTE =
  "Axle loads are a planning estimate from a simple beam model, with cargo weight only (no tare, no tractor). They are not a verified axle weighing or a safety or legal compliance check."

/** A value from the allowance input or JSON: finite, not negative, capped. Anything else is no allowance. */
export function normaliseClearance(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value
  if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) return 0
  return Math.min(MAX_CLEARANCE_CM, Math.round(number * 10) / 10)
}

/** Like `normaliseClearance`, but null (no override) stays null. */
export function normaliseOverride(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const number = typeof value === "string" ? Number(value) : value
  if (typeof number !== "number" || !Number.isFinite(number) || number < 0) return null
  return Math.min(MAX_CLEARANCE_CM, Math.round(number * 10) / 10)
}

/** Project default allowance from `Project.rules`. */
export function projectClearance(rules: unknown): number {
  return normaliseClearance(recordOf(rules).clearanceCm)
}

/** A cargo line's own allowance from `CargoItem.customFields`, or null to use the project default. */
export function cargoClearance(customFields: unknown): number | null {
  return normaliseOverride(recordOf(customFields).clearanceCm)
}

export function formatClearance(cm: number): string {
  return cm > 0 ? `${cm} cm per side` : "none"
}

// ---- per-line settings, directional values and configuration snapshots -------------------------

/** What a cargo line's clearance is, as stored: directional sides win, then a number, else inherit. */
export function cargoSetting(customFields: unknown): ClearanceSetting {
  const row = recordOf(customFields)
  return normaliseSetting({ clearanceCm: row.clearanceCm, clearanceSides: row.clearanceSides })
}

/** The part of `CargoItem.customFields` that carries a setting (empty for inherit). Merge it with the other keys. */
export function settingToJson(setting: ClearanceSetting): Record<string, unknown> {
  if (setting === null) return {}
  if (typeof setting === "number") return { clearanceCm: setting }
  return { clearanceSides: { front: setting.front, rear: setting.rear, left: setting.left, right: setting.right } }
}

/** A clean setting from the editor: uniform numbers are rounded and capped, bad input inherits. */
export function cleanSetting(setting: ClearanceSetting | undefined): ClearanceSetting {
  if (setting === null || setting === undefined) return null
  if (typeof setting === "number") return normaliseOverride(setting)
  return normaliseSides(setting)
}

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

/**
 * Everything that decides how much room cargo needs: the project default and each line's own
 * setting (lines that inherit are left out). A plan stores the configuration it was calculated or
 * last checked under, so a later change shows up as a difference rather than a guess.
 */
export type ClearanceConfig = { defaultCm: number; lines: Record<string, ClearanceSetting> }

export function clearanceConfig(defaultCm: number, lines: { id: string; setting: ClearanceSetting }[]): ClearanceConfig {
  const out: Record<string, ClearanceSetting> = {}
  for (const line of lines) {
    const setting = cleanSetting(line.setting)
    if (setting !== null) out[line.id] = setting
  }
  return { defaultCm: normaliseClearance(defaultCm), lines: out }
}

/** A stored configuration, or null when there is none or it is unreadable. */
export function parseClearanceConfig(raw: unknown): ClearanceConfig | null {
  const row = recordOf(raw)
  if (typeof row.defaultCm !== "number") return null
  const lines: { id: string; setting: ClearanceSetting }[] = []
  for (const [id, value] of Object.entries(recordOf(row.lines))) {
    const setting = typeof value === "number" ? normaliseOverride(value) : normaliseSides(value)
    if (setting !== null) lines.push({ id, setting })
  }
  return clearanceConfig(row.defaultCm, lines)
}

export function sameClearanceConfig(a: ClearanceConfig, b: ClearanceConfig): boolean {
  if (a.defaultCm !== b.defaultCm) return false
  const ids = new Set([...Object.keys(a.lines), ...Object.keys(b.lines)])
  for (const id of ids) {
    if (!sameSetting(a.lines[id] ?? null, b.lines[id] ?? null)) return false
  }
  return true
}

/** How many of the given lines inherit the project default and how many carry their own setting. */
export function countSettings(settings: ClearanceSetting[]): { inherited: number; custom: number } {
  const inherited = settings.filter((setting) => setting === null).length
  return { inherited, custom: settings.length - inherited }
}

type SidedItem = { clearance?: SideClearance | null; clearanceCm?: number | null; rotation?: string | null }

/** The local (own-side) clearance of a piece: the resolved sides, else its uniform number, else none. */
export function ownSidesOfItem(item: Pick<SidedItem, "clearance" | "clearanceCm">): SideClearance {
  if (item.clearance) return item.clearance
  return uniformSides(item.clearanceCm && item.clearanceCm > 0 ? item.clearanceCm : 0)
}

/** The clearance on each placed side of a piece in its current rotation. The one place that turns own sides into plan sides. */
export function itemSides(item: SidedItem): Clearance4 {
  return placedSides(ownSidesOfItem(item), item.rotation)
}

/** The two optional cargo-line fields for a setting: a number for uniform (0 allowed), sides for directional, both null to inherit. */
export function settingToCargoFields(setting: ClearanceSetting): { clearanceCm: number | null; clearanceSides: SideClearance | null } {
  return typeof setting === "number"
    ? { clearanceCm: setting, clearanceSides: null }
    : { clearanceCm: null, clearanceSides: setting }
}

/** A cargo line's setting from its two optional fields: directional sides win, then a number (0 allowed), else inherit. */
export function lineSetting(line: { clearanceCm?: number | null; clearanceSides?: SideClearance | null }): ClearanceSetting {
  const sides = normaliseSides(line.clearanceSides)
  if (sides) return sides
  return typeof line.clearanceCm === "number" && line.clearanceCm >= 0 ? line.clearanceCm : null
}

/** What differs between the configuration a plan was made under and the one in force now, in words a planner can act on. */
export function describeConfigChange(planUsed: ClearanceConfig | null, now: ClearanceConfig): string | null {
  if (!planUsed) return null
  const parts: string[] = []
  if (planUsed.defaultCm !== now.defaultCm) parts.push(`project default ${planUsed.defaultCm} → ${now.defaultCm} cm`)
  const ids = new Set([...Object.keys(planUsed.lines), ...Object.keys(now.lines)])
  let lines = 0
  for (const id of ids) if (!sameSetting(planUsed.lines[id] ?? null, now.lines[id] ?? null)) lines += 1
  if (lines > 0) parts.push(`${lines} cargo line${lines === 1 ? "" : "s"} with a different clearance`)
  return parts.length > 0 ? parts.join(", ") : null
}

/** A line's clearance in full for a report: "Default · 5 cm", "Uniform · 10 cm", "Custom · 0 cm" or the four directional values. */
export function clearanceText(setting: ClearanceSetting, projectDefault: number): string {
  return typeof setting === "object" && setting ? `Directional · ${describeSides(setting)}` : describeSetting(setting, projectDefault)
}
