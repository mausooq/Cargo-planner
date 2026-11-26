import type { CargoItemInput } from "@compass/domain"
import { resolveMinSupportRatio } from "@compass/physics"
import {
  analyseRemainingCapacity,
  axleGroupsFromLoads,
  checkAdditionalFit,
  type CapacityAnalysis,
  type CapacityLimits,
  type CapacityUnitInput,
  type FitCheck,
  type LimitingFactor,
  type SolverCargo,
  type StopInfo,
} from "@compass/solver"
import type { CargoLine } from "@/components/cargo-grid"
import { cargoPreset } from "@/lib/cargo-defaults"
import { checkCargoLine, isPlannable, linesNeedingWeightConfirmation } from "@/lib/cargo-validation"
import { layoutProblems } from "@/lib/layout-validation"
import type { PlanView } from "@/lib/plan-view"
import { toSolverCargo, toSolverContour } from "@/lib/solver-input"

/*
 * The Calculate step's remaining-capacity analysis, built on the plan as it is shown (packed or hand-arranged).
 * Pure functions: the page decides when to run them, and nothing here saves anything.
 */

export type CapacitySettings = {
  /** Project minimum support share, as a percentage; null keeps the shared default. */
  minSupportPct?: number | null
  limits?: Partial<CapacityLimits>
  now?: () => number
}

export type CapacityContext = {
  /** Something about the weights is not confirmed: figures that depend on weight are provisional. */
  provisional: boolean
  provisionalReasons: string[]
  /** Cargo lines in the plan whose stacking the document did not state (planned as not stackable). */
  stackingNotStated: string[]
  /** Cargo lines left out of the plan because they are incomplete (no weight, no size, no name). */
  excludedLines: string[]
  /** Pieces the plan could not load. */
  unloadedPieces: number
  /** Problems the layout check (the same one the server runs on a saved layout) finds in the plan. */
  layoutProblems: { unitIndex: number; message: string }[]
}

export type RemainingCapacityReport = CapacityAnalysis & {
  context: CapacityContext
  /** True only when neither the packer's rules nor the layout check find a problem in the existing plan. */
  validated: boolean
}

export const FACTOR_LABEL: Record<LimitingFactor, string> = {
  space: "Available space",
  payload: "Payload",
  stacking: "Stacking and support rules",
  axle: "Axle limits",
  size: "Package size",
  segregation: "Segregation",
  equipment: "Equipment",
}

/** A plain description of why adding stopped, telling a physical limit apart from the simulation's own bounds. */
export function describeStop(stop: StopInfo): { label: string; physical: boolean; detail: string } {
  switch (stop.kind) {
    case "physical":
      return { label: FACTOR_LABEL[stop.factor], physical: true, detail: stop.message }
    case "time-limit":
      return { label: "Simulation time limit", physical: false, detail: stop.message }
    case "iteration-limit":
      return { label: "Simulation piece limit", physical: false, detail: stop.message }
    case "complete":
      return { label: "All placed", physical: true, detail: stop.message }
  }
}

/** The plan's units with their pieces where they stand, as the analysis takes them. */
export function capacityUnits(plan: PlanView): CapacityUnitInput[] {
  return plan.units.map((unit) => ({
    unitIndex: unit.unitIndex,
    equipment: {
      id: unit.equipmentId,
      name: unit.equipmentName,
      lengthCm: unit.lengthCm,
      widthCm: unit.widthCm,
      heightCm: unit.heightCm,
      maxPayloadKg: unit.maxPayloadKg,
      tareKg: unit.tareKg,
      axleGroups: axleGroupsFromLoads(unit.axleLoads),
      costPerUnit: 0,
      maxCount: 1,
      contour: toSolverContour(unit.contour),
    },
    pieces: unit.items.map((item) => ({
      id: item.id,
      cargoId: item.cargoId,
      x: item.x,
      y: item.y,
      z: item.z,
      lengthCm: item.lengthCm,
      widthCm: item.widthCm,
      heightCm: item.heightCm,
      rotation: item.rotation,
      weightKg: item.weightKg,
    })),
  }))
}

function contextOf(plan: PlanView, cargo: CargoLine[], minSupportRatio: number): CapacityContext {
  const inPlan = new Set(plan.units.flatMap((unit) => unit.items.map((item) => item.cargoId)))
  const planned = cargo.filter((line) => inPlan.has(line.id))
  const label = (line: CargoLine) => `${line.sku ? `${line.sku} ` : ""}${line.name || "Unnamed line"}`.trim()
  const estimated = linesNeedingWeightConfirmation(planned)
  const excluded = cargo.filter((line) => !isPlannable(line))
  const noWeight = excluded.filter((line) => "weightKg" in checkCargoLine(line).missing)
  const reasons: string[] = []
  if (estimated.length > 0) reasons.push(`${estimated.length} cargo line${estimated.length === 1 ? " uses an estimated weight" : "s use estimated weights"}: ${estimated.map(label).slice(0, 4).join(", ")}${estimated.length > 4 ? "…" : ""}.`)
  if (noWeight.length > 0) reasons.push(`${noWeight.length} cargo line${noWeight.length === 1 ? " has" : "s have"} no weight and ${noWeight.length === 1 ? "is" : "are"} not in the plan.`)

  const byId = new Map(cargo.map((line) => [line.id, line]))
  const problems: CapacityContext["layoutProblems"] = []
  for (const unit of plan.units) {
    const pieces = unit.items.flatMap((item) => {
      const line = byId.get(item.cargoId)
      return line ? [{ item, cargo: line }] : []
    })
    for (const message of layoutProblems(unit, pieces, { minSupportRatio }).values()) problems.push({ unitIndex: unit.unitIndex, message })
  }

  return {
    provisional: reasons.length > 0,
    provisionalReasons: reasons,
    stackingNotStated: planned.filter((line) => line.stackableNotStated && !line.stackable).map(label),
    excludedLines: excluded.map(label),
    unloadedPieces: plan.unloaded.length,
    layoutProblems: problems,
  }
}

function plannedCargo(cargo: CargoLine[]): SolverCargo[] {
  return cargo.filter(isPlannable).map(toSolverCargo)
}

/** Remaining capacity of every unit of the plan, and how many more identical packages fit when the cargo is uniform. */
export function remainingCapacity(plan: PlanView, cargo: CargoLine[], options: CapacitySettings = {}): RemainingCapacityReport {
  const minSupportRatio = resolveMinSupportRatio(options.minSupportPct)
  const analysis = analyseRemainingCapacity(capacityUnits(plan), plannedCargo(cargo), { settings: { minSupportRatio }, limits: options.limits, now: options.now })
  const context = contextOf(plan, cargo, minSupportRatio)
  return { ...analysis, context, validated: analysis.validated && context.layoutProblems.length === 0 }
}

/** What the planner enters to check extra cargo. Sizes in cm, weight in kg per piece. */
export type ExtraCargo = Pick<CargoItemInput, "name" | "lengthCm" | "widthCm" | "heightCm" | "weightKg" | "quantity" | "stackable" | "bottomOnly" | "orientation">

export const MAX_EXTRA_PIECES = 500

/** The extra cargo as a full cargo line, with the planner's defaults for everything not asked. */
export function extraCargoInput(extra: ExtraCargo): CargoItemInput {
  return { ...cargoPreset("BOX"), ...extra, name: extra.name.trim() || "Additional cargo" }
}

/** Problems with what was entered, before anything is simulated. Empty when it can be checked. */
export function extraCargoProblems(extra: ExtraCargo): string[] {
  const input = extraCargoInput(extra)
  const check = checkCargoLine(input)
  const problems = [...Object.values(check.errors), ...Object.values(check.missing).filter((message) => !message.startsWith("Give the item a name"))]
  if (input.quantity > MAX_EXTRA_PIECES) problems.push(`Check at most ${MAX_EXTRA_PIECES} pieces at a time.`)
  return problems
}

/**
 * What a fit check was based on: the plan as shown (every piece's place and size, each unit's limits), the cargo
 * lines' planning values, the support share and the extra cargo entered. A result only stands while this is
 * unchanged; anything else makes it stale and it may not be used to add cargo.
 */
export function fitBasis(plan: PlanView, cargo: CargoLine[], extra: ExtraCargo, minSupportPct: number | null | undefined): string {
  return JSON.stringify([
    plan.units.map((unit) => [
      unit.unitIndex,
      unit.equipmentId,
      unit.lengthCm,
      unit.widthCm,
      unit.heightCm,
      unit.maxPayloadKg,
      unit.items.map((item) => [item.id, item.cargoId, item.x, item.y, item.z, item.lengthCm, item.widthCm, item.heightCm, item.rotation]),
    ]),
    cargo.map((line) => [
      line.id,
      line.lengthCm,
      line.widthCm,
      line.heightCm,
      line.weightKg,
      line.quantity,
      line.shape,
      line.orientation,
      line.allowedRotations,
      line.stackable,
      line.bottomOnly,
      line.maxStackLoadKg,
      line.maxStackLayers,
      line.segregationClass,
      line.stackableNotStated ?? false,
      line.weightEstimate?.perPieceKg ?? null,
    ]),
    minSupportPct ?? null,
    [extra.name.trim(), extra.lengthCm, extra.widthCm, extra.heightCm, extra.weightKg, extra.quantity, extra.stackable, extra.bottomOnly, extra.orientation],
  ])
}

export type ExtraFitResult = FitCheck & { context: CapacityContext; extra: ExtraCargo; basis: string }

/** Would the extra cargo fit in the plan as it stands? Nothing is saved and the plan is not changed. */
export function checkExtraCargo(plan: PlanView, cargo: CargoLine[], extra: ExtraCargo, options: CapacitySettings = {}): ExtraFitResult {
  const minSupportRatio = resolveMinSupportRatio(options.minSupportPct)
  const candidate = toSolverCargo({ ...extraCargoInput(extra), id: "__check__" })
  const check = checkAdditionalFit(capacityUnits(plan), plannedCargo(cargo), candidate, { settings: { minSupportRatio }, limits: options.limits, now: options.now })
  const context = contextOf(plan, cargo, minSupportRatio)
  return { ...check, context, validated: check.validated && context.layoutProblems.length === 0, extra: { ...extra }, basis: fitBasis(plan, cargo, extra, options.minSupportPct) }
}

/** True while the plan, the cargo and the support share are what the check was made against. */
export function isFitCurrent(result: Pick<ExtraFitResult, "basis" | "extra">, plan: PlanView, cargo: CargoLine[], minSupportPct: number | null | undefined): boolean {
  return result.basis === fitBasis(plan, cargo, result.extra, minSupportPct)
}

/**
 * The cargo line Add to cargo list saves: only the pieces the check found room for. Null when none fit, so
 * nothing can be added. A partial fit saves the fitted quantity, never the quantity asked for.
 */
export function cargoToAdd(result: Pick<ExtraFitResult, "placed" | "extra">): CargoItemInput | null {
  const fitted = Math.floor(result.placed)
  if (!(fitted > 0)) return null
  return extraCargoInput({ ...result.extra, quantity: Math.min(fitted, result.extra.quantity) })
}
