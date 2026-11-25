import { axleGroupsFromLoads, centreOfGravity, computeUnitMetrics, layoutWarnings, type MetricBox, type MetricUnit } from "@compass/solver"
import { itemSides } from "@/lib/clearance"
import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"

export type LiveMetrics = {
  /** Pieces standing in the unit right now. */
  pieces: number
  /** Pieces taken out of the unit ("set aside") but still part of the plan. */
  setAside: number
  netKg: number
  weightPct: number
  /** Payload left in kg; negative when over the limit. */
  remainingKg: number
  volumeM3: number
  volumePct: number
  /** Volume left in m³. */
  remainingM3: number
  /** Same as `floorActualPct`. Kept for existing callers. */
  floorPct: number
  /** Floor covered by the pieces' own footprints. Overlaps count once. */
  floorActualPct: number
  /** Floor needed once each piece's handling clearance is added. Overlaps count once. */
  floorEffectivePct: number
  /** Centre of gravity as a share of the unit: 0 = front / left wall / floor, 1 = doors / right wall / roof. */
  cog: { alongPct: number; acrossPct: number; heightPct: number } | null
  /** How far the centre of gravity is from the middle of the width, in cm (positive = right). */
  offCentreCm: number
  /** Estimated axle loads for the cargo weight alone. A planning estimate, not a weighing. */
  axleLoads: { name: string; kg: number; maxKg: number; positionFromFrontCm: number }[]
  /** Plain-language balance and rule problems, empty when none. */
  warnings: string[]
}

export type MetricsUnit = Pick<PlanUnitView, "lengthCm" | "widthCm" | "heightCm" | "maxPayloadKg"> &
  Partial<Pick<PlanUnitView, "tareKg" | "axleLoads">>

/** The placed pieces as the shared metrics function sees them. */
export function metricBoxesOf(items: PlanItemView[]): MetricBox[] {
  return items.map((item) => ({
    id: item.id,
    x: item.x,
    y: item.y,
    z: item.z,
    l: item.lengthCm,
    w: item.widthCm,
    h: item.heightCm,
    kg: Math.max(0, item.weightKg),
    clearance: itemSides(item),
  }))
}

export function metricUnitOf(unit: MetricsUnit): MetricUnit {
  return {
    lengthCm: unit.lengthCm,
    widthCm: unit.widthCm,
    heightCm: unit.heightCm,
    maxPayloadKg: unit.maxPayloadKg,
    tareKg: unit.tareKg ?? 0,
    axleGroups: axleGroupsFromLoads(unit.axleLoads ?? []),
  }
}

/**
 * Weight, volume, floor use, balance and axle estimate for a layout, recomputed on every move.
 * It calls the same `computeUnitMetrics` the solver and the server use, so the Playground, the
 * Load plan and the saved plan agree for the same piece positions. Nothing here re-runs the packer.
 */
export function liveMetrics(items: PlanItemView[], unit: MetricsUnit, setAside = 0): LiveMetrics {
  const boxes = metricBoxesOf(items)
  const spec = metricUnitOf(unit)
  const metrics = computeUnitMetrics(spec, boxes)
  const centre = centreOfGravity(boxes.map((box) => ({ x: box.x + box.l / 2, y: box.y + box.w / 2, z: box.z + box.h / 2, kg: box.kg })))
  const hasWeight = metrics.netKg > 0
  const cog = hasWeight
    ? {
        alongPct: (centre.x / unit.lengthCm) * 100,
        acrossPct: (centre.y / unit.widthCm) * 100,
        heightPct: (centre.z / unit.heightCm) * 100,
      }
    : null
  const offCentreCm = cog ? (cog.acrossPct / 100) * unit.widthCm - unit.widthCm / 2 : 0

  return {
    pieces: items.length,
    setAside,
    netKg: metrics.netKg,
    weightPct: metrics.weightPct,
    remainingKg: metrics.remainingKg,
    volumeM3: metrics.volumeM3,
    volumePct: metrics.volumePct,
    remainingM3: metrics.remainingM3,
    floorPct: metrics.floorActualPct,
    floorActualPct: metrics.floorActualPct,
    floorEffectivePct: metrics.floorEffectivePct,
    cog,
    offCentreCm,
    axleLoads: metrics.axleLoads,
    warnings: layoutWarnings(spec, boxes, metrics),
  }
}
