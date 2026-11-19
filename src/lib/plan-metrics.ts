import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"

export type LiveMetrics = {
  pieces: number
  netKg: number
  weightPct: number
  volumeM3: number
  volumePct: number
  /** Share of the floor covered by pieces standing on it. */
  floorPct: number
  /** Centre of gravity as a share of the unit: 0 = front / left wall / floor, 1 = doors / right wall / roof. */
  cog: { alongPct: number; acrossPct: number; heightPct: number } | null
  /** How far the centre of gravity is from the middle of the width, in cm (positive = right). */
  offCentreCm: number
  /** Plain-language balance problems, empty when the load is balanced. */
  warnings: string[]
}

/** Lateral offset that starts to matter: 5% of the width, at least 5 cm. */
function lateralLimit(widthCm: number) {
  return Math.max(5, widthCm * 0.05)
}

/** Floor coverage of pieces standing on the floor, counting overlaps once (coarse 5 cm grid). */
function floorCoverage(items: PlanItemView[], unit: Pick<PlanUnitView, "lengthCm" | "widthCm">): number {
  const cell = 5
  const cols = Math.ceil(unit.lengthCm / cell)
  const rows = Math.ceil(unit.widthCm / cell)
  if (cols <= 0 || rows <= 0) return 0
  const covered = new Uint8Array(cols * rows)
  for (const item of items) {
    if (item.z > 0.5) continue
    const x0 = Math.max(0, Math.floor(item.x / cell))
    const x1 = Math.min(cols, Math.ceil((item.x + item.lengthCm) / cell))
    const y0 = Math.max(0, Math.floor(item.y / cell))
    const y1 = Math.min(rows, Math.ceil((item.y + item.widthCm) / cell))
    for (let x = x0; x < x1; x += 1) for (let y = y0; y < y1; y += 1) covered[x * rows + y] = 1
  }
  let count = 0
  for (const value of covered) count += value
  return (count / covered.length) * 100
}

/**
 * Weight, volume, floor use, and balance for the current playground layout, recomputed on every
 * move (the saved plan's numbers only change after saving and recalculating).
 */
export function liveMetrics(
  items: PlanItemView[],
  unit: Pick<PlanUnitView, "lengthCm" | "widthCm" | "heightCm" | "maxPayloadKg">,
): LiveMetrics {
  let netKg = 0
  let volumeCm3 = 0
  let mx = 0
  let my = 0
  let mz = 0
  for (const item of items) {
    const kg = Math.max(0, item.weightKg)
    netKg += kg
    volumeCm3 += item.lengthCm * item.widthCm * item.heightCm
    mx += kg * (item.x + item.lengthCm / 2)
    my += kg * (item.y + item.widthCm / 2)
    mz += kg * (item.z + item.heightCm / 2)
  }
  const unitVolume = unit.lengthCm * unit.widthCm * unit.heightCm
  const cog =
    netKg > 0
      ? {
          alongPct: (mx / netKg / unit.lengthCm) * 100,
          acrossPct: (my / netKg / unit.widthCm) * 100,
          heightPct: (mz / netKg / unit.heightCm) * 100,
        }
      : null
  const offCentreCm = cog ? (cog.acrossPct / 100) * unit.widthCm - unit.widthCm / 2 : 0

  const warnings: string[] = []
  if (unit.maxPayloadKg > 0 && netKg > unit.maxPayloadKg) {
    warnings.push(`Over the payload limit by ${Math.round(netKg - unit.maxPayloadKg).toLocaleString("en-US")} kg`)
  }
  if (cog && Math.abs(offCentreCm) > lateralLimit(unit.widthCm)) {
    warnings.push(`Weight sits ${Math.round(Math.abs(offCentreCm))} cm to the ${offCentreCm > 0 ? "right" : "left"} of centre`)
  }
  if (cog && cog.heightPct > 60) warnings.push("Weight sits high: put heavier pieces lower")

  return {
    pieces: items.length,
    netKg,
    weightPct: unit.maxPayloadKg > 0 ? (netKg / unit.maxPayloadKg) * 100 : 0,
    volumeM3: volumeCm3 / 1_000_000,
    volumePct: unitVolume > 0 ? (volumeCm3 / unitVolume) * 100 : 0,
    floorPct: floorCoverage(items, unit),
    cog,
    offCentreCm,
    warnings,
  }
}
