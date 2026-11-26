import type { SolverInput, SolverResult } from "@compass/solver"
import type { CargoLine } from "@/components/cargo-grid"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { buildSolverInput } from "@/lib/solver-input"

export type Objective = "FEWEST_UNITS" | "LOWEST_COST"

export type EquipmentSuggestion = {
  equipmentTypeId: string
  name: string
  /** Units of this type the packing run actually used. */
  units: number
  /** Pieces the run could not load into this type at all (too big, too heavy, or out of units). */
  unloadedPieces: number
  totalPieces: number
  /** Average volume fill across the used units, in percent. */
  avgVolumePct: number
  /** Average payload use across the used units, in percent. */
  avgWeightPct: number
  /** units × cost per unit; 0 when the library has no cost for this type. */
  totalCost: number
  /** Flat rack, open top, roll trailer, lowboy…: meant for out-of-gauge cargo, not ordinary boxes. */
  specialist: boolean
  /** One plain sentence on why it ranks where it does. */
  reason: string
}

/** Never ask the solver for more units than this per type; beyond it the type is a poor fit anyway. */
const MAX_UNITS = 60
/** Keep each trial quick: this is a comparison across many types, not the final plan. */
const TRIAL_SETTINGS = { restarts: 6, timeLimitMs: 1500 }

function innerM3(item: EquipmentListItem): number {
  return (item.innerLengthCm * item.innerWidthCm * item.innerHeightCm) / 1_000_000
}

/** Upper bound on units to offer the solver: the rough need by volume and weight, with headroom. */
export function unitBudget(item: EquipmentListItem, cargo: CargoLine[]): number {
  let volume = 0
  let weight = 0
  for (const line of cargo) {
    volume += ((line.lengthCm * line.widthCm * line.heightCm) / 1_000_000) * line.quantity
    weight += line.weightKg * line.quantity
  }
  const byVolume = volume / Math.max(innerM3(item) * 0.6, 0.001)
  const byWeight = item.maxPayloadKg > 0 ? weight / item.maxPayloadKg : 0
  return Math.min(MAX_UNITS, Math.max(2, Math.ceil(Math.max(byVolume, byWeight)) + 2))
}

/** True when at least one cargo piece is physically small enough for this type (any flat rotation). */
export function couldHoldSomething(item: EquipmentListItem, cargo: CargoLine[]): boolean {
  return cargo.some((line) => {
    const sides = [line.lengthCm, line.widthCm, line.heightCm].sort((a, b) => a - b)
    const room = [item.innerLengthCm, item.innerWidthCm, item.innerHeightCm].sort((a, b) => a - b)
    return sides.every((side, index) => side <= (room[index] ?? 0) + 0.01) && line.weightKg <= item.maxPayloadKg
  })
}

export function toSuggestion(item: EquipmentListItem, result: SolverResult, totalPieces: number): EquipmentSuggestion {
  const units = result.units.length
  const avg = (pick: (unit: SolverResult["units"][number]) => number) =>
    units > 0 ? result.units.reduce((sum, unit) => sum + pick(unit), 0) / units : 0
  return {
    equipmentTypeId: item.id,
    name: item.name,
    units,
    unloadedPieces: result.unloaded.length,
    totalPieces,
    avgVolumePct: avg((unit) => unit.metrics.volumePct),
    avgWeightPct: avg((unit) => unit.metrics.weightPct),
    totalCost: units * item.costPerUnit,
    specialist: item.oogClass !== "NONE",
    reason: "",
  }
}

/**
 * Best first. Types that load everything always beat types that leave cargo behind. Among those,
 * standard closed equipment beats specialist out-of-gauge equipment (a roll trailer may be cheap,
 * but nobody ships cartons on one); specialist types only lead when standard ones cannot take
 * the cargo. Then:
 * - "Fewest units": fewest units, then lowest total cost, then the tightest fit.
 * - "Lowest cost": lowest total cost, then fewest units, then the tightest fit.
 * Cost matters even for "fewest units": a standard dry container should beat a reefer or flat rack
 * that happens to be a little fuller. Cost is only compared when both types have one.
 */
export function rankSuggestions(suggestions: EquipmentSuggestion[], objective: Objective): EquipmentSuggestion[] {
  const byCost = (a: EquipmentSuggestion, b: EquipmentSuggestion) =>
    a.totalCost > 0 && b.totalCost > 0 ? a.totalCost - b.totalCost : 0
  const byUnits = (a: EquipmentSuggestion, b: EquipmentSuggestion) => a.units - b.units
  const ranked = suggestions
    .filter((entry) => entry.units > 0)
    .sort((a, b) => {
      if (a.unloadedPieces !== b.unloadedPieces) return a.unloadedPieces - b.unloadedPieces
      if (a.specialist !== b.specialist) return a.specialist ? 1 : -1
      const primary = objective === "LOWEST_COST" ? byCost(a, b) || byUnits(a, b) : byUnits(a, b) || byCost(a, b)
      if (primary !== 0) return primary
      const fill = Math.max(b.avgVolumePct, b.avgWeightPct) - Math.max(a.avgVolumePct, a.avgWeightPct)
      if (Math.abs(fill) > 0.05) return fill
      return a.name.localeCompare(b.name)
    })
  return ranked.map((entry) => ({ ...entry, reason: describe(entry) }))
}

function describe(entry: EquipmentSuggestion): string {
  const unitText = `${entry.units} unit${entry.units === 1 ? "" : "s"}`
  const fill = `${Math.round(entry.avgVolumePct)}% full`
  const heavy = entry.avgWeightPct > entry.avgVolumePct + 10 ? `, ${Math.round(entry.avgWeightPct)}% of payload` : ""
  if (entry.unloadedPieces === 0) {
    return `Fits all ${entry.totalPieces} piece${entry.totalPieces === 1 ? "" : "s"} in ${unitText}, about ${fill}${heavy}.`
  }
  const loaded = entry.totalPieces - entry.unloadedPieces
  return `Fits ${loaded} of ${entry.totalPieces} pieces in ${unitText}; ${entry.unloadedPieces} do not fit this type.`
}

export type SuggestProgress = { done: number; total: number; current: string }

/**
 * Runs a quick packing trial of the whole cargo list against each candidate type, one type at a
 * time, and returns them ranked best first. `run` is injected (a Web Worker in the app, the solver
 * directly in tests) so the page stays responsive.
 */
export async function suggestEquipment(input: {
  cargo: CargoLine[]
  candidates: EquipmentListItem[]
  objective: Objective
  run: (solverInput: SolverInput) => Promise<SolverResult>
  onProgress?: (progress: SuggestProgress) => void
  isCancelled?: () => boolean
  /** Project minimum support share, as a percentage. */
  minSupportPct?: number | null
}): Promise<EquipmentSuggestion[]> {
  const totalPieces = input.cargo.reduce((sum, line) => sum + line.quantity, 0)
  const candidates = input.candidates.filter((item) => couldHoldSomething(item, input.cargo))
  const results: EquipmentSuggestion[] = []
  for (const [index, item] of candidates.entries()) {
    if (input.isCancelled?.()) break
    input.onProgress?.({ done: index, total: candidates.length, current: item.name })
    const solverInput = buildSolverInput({
      cargo: input.cargo,
      equipment: [{ ...item, maxCount: unitBudget(item, input.cargo) }],
      objective: input.objective,
      minSupportPct: input.minSupportPct,
    })
    try {
      const result = await input.run({ ...solverInput, settings: { ...solverInput.settings, ...TRIAL_SETTINGS } })
      results.push(toSuggestion(item, result, totalPieces))
    } catch {
      // A type the solver cannot handle is simply left out of the ranking.
    }
  }
  input.onProgress?.({ done: candidates.length, total: candidates.length, current: "" })
  return rankSuggestions(results, input.objective)
}
