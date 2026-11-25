import { clearanceViolations, floorUtilization, type PlanBox } from "@compass/physics"
import { EPS } from "./geometry"
import { axleLoads, centreOfGravity } from "./metrics"
import type { AxleLoad, SolverAxleGroup, SolverEquipment, UnitMetrics } from "./types"

/**
 * One placed piece, as the metrics see it. Position is the minimum corner in cm and `kg` is the
 * weight of one piece. Both the solver and the server (after a manual layout edit) build these.
 */
export type MetricBox = PlanBox & { kg: number }

export type MetricUnit = Pick<
  SolverEquipment,
  "lengthCm" | "widthCm" | "heightCm" | "maxPayloadKg" | "tareKg" | "axleGroups"
>

const round = (value: number, digits = 1): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Every number shown for one unit, from the placed pieces alone. The solver, the Playground and the
 * server's save all call this one function, so the Load plan, the Playground, the reports and the
 * database cannot disagree about the same layout.
 *
 * Axle loads are a planning estimate (see `axleLoads`); they are not a verified axle weighing.
 */
export function computeUnitMetrics(unit: MetricUnit, boxes: MetricBox[]): UnitMetrics {
  const capacity = unit.lengthCm * unit.widthCm * unit.heightCm
  let netKg = 0
  let usedVolume = 0
  let usedLength = 0
  let usedWidth = 0
  let usedHeight = 0
  const points = boxes.map((box) => {
    netKg += box.kg
    usedVolume += box.l * box.w * box.h
    usedLength = Math.max(usedLength, box.x + box.l)
    usedWidth = Math.max(usedWidth, box.y + box.w)
    usedHeight = Math.max(usedHeight, box.z + box.h)
    return { x: box.x + box.l / 2, y: box.y + box.w / 2, z: box.z + box.h / 2, kg: box.kg }
  })
  const cog = centreOfGravity(points)
  const floor = floorUtilization(boxes, unit)
  const actual = round(floor.actualPct)
  return {
    netKg: round(netKg),
    grossKg: round(netKg + unit.tareKg),
    volumeM3: round(usedVolume / 1_000_000, 3),
    volumePct: capacity > 0 ? round((usedVolume / capacity) * 100) : 0,
    floorPct: actual,
    floorActualPct: actual,
    floorEffectivePct: round(floor.effectivePct),
    weightPct: unit.maxPayloadKg > 0 ? round((netKg / unit.maxPayloadKg) * 100) : 0,
    remainingKg: round(unit.maxPayloadKg - netKg),
    remainingM3: round((capacity - usedVolume) / 1_000_000, 3),
    usedLengthCm: round(usedLength),
    usedWidthCm: round(usedWidth),
    usedHeightCm: round(usedHeight),
    cog: { x: round(cog.x), y: round(cog.y), z: round(cog.z) },
    axleLoads: axleLoads(unit.axleGroups, netKg, cog.x).map((load) => ({ ...load, kg: round(load.kg) })),
    pieces: boxes.length,
  }
}

/** Lateral offset that starts to matter: 5% of the width, at least 5 cm. */
export function lateralLimitCm(widthCm: number): number {
  return Math.max(5, widthCm * 0.05)
}

/** Share of the unit height above which the centre of gravity is called high. */
export const HIGH_COG_PCT = 60

/**
 * Plain-language problems with a layout. Shared by the Playground and the server so a saved layout
 * carries the same warnings the planner saw. Nothing here is a safety certification.
 */
export function layoutWarnings(unit: MetricUnit, boxes: MetricBox[], metrics: UnitMetrics): string[] {
  const warnings: string[] = []
  if (unit.maxPayloadKg > 0 && metrics.netKg > unit.maxPayloadKg + EPS) {
    warnings.push(`Over the payload limit by ${Math.round(metrics.netKg - unit.maxPayloadKg).toLocaleString("en-US")} kg`)
  }
  if (boxes.length > 0 && metrics.netKg > 0) {
    const offCentre = metrics.cog.y - unit.widthCm / 2
    if (Math.abs(offCentre) > lateralLimitCm(unit.widthCm)) {
      warnings.push(`Weight sits ${Math.round(Math.abs(offCentre))} cm to the ${offCentre > 0 ? "right" : "left"} of centre`)
    }
    if (unit.heightCm > 0 && (metrics.cog.z / unit.heightCm) * 100 > HIGH_COG_PCT) {
      warnings.push("Weight sits high: put heavier pieces lower")
    }
  }
  for (const load of metrics.axleLoads) {
    if (load.kg > load.maxKg + EPS) warnings.push(`${load.name} is estimated over its limit by ${Math.round(load.kg - load.maxKg)} kg`)
  }
  const clashes = clearanceViolations(boxes, unit)
  if (clashes.length > 0) {
    const pieces = new Set(clashes.map((clash) => clash.id)).size
    warnings.push(`${pieces} piece${pieces === 1 ? "" : "s"} break the handling clearance`)
  }
  return warnings
}

export function axleGroupsFromLoads(loads: Pick<AxleLoad, "name" | "positionFromFrontCm" | "maxKg">[]): SolverAxleGroup[] {
  return loads.map((load) => ({ name: load.name, positionFromFrontCm: load.positionFromFrontCm, maxKg: load.maxKg }))
}

