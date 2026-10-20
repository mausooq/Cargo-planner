import type { AxleLoad, SolverAxleGroup, SolverEquipment } from "./types"

export type WeightedPoint = { x: number; y: number; z: number; kg: number }

export function centreOfGravity(points: WeightedPoint[]): { x: number; y: number; z: number } {
  let total = 0
  let sx = 0
  let sy = 0
  let sz = 0
  for (const point of points) {
    total += point.kg
    sx += point.x * point.kg
    sy += point.y * point.kg
    sz += point.z * point.kg
  }
  if (total <= 0) return { x: 0, y: 0, z: 0 }
  return { x: sx / total, y: sy / total, z: sz / total }
}

/**
 * Cargo weight split across axle groups.
 * Two groups: a simple beam, reactions follow the lever arm from the cargo
 * centre of gravity. One group takes everything. With three or more, the
 * front-most group is one support and the others share the rear reaction
 * equally. Tare is not included; limits here are cargo limits.
 */
export function axleLoads(
  groups: SolverAxleGroup[],
  netKg: number,
  cogX: number,
): AxleLoad[] {
  if (groups.length === 0) return []
  const sorted = groups.slice().sort((a, b) => a.positionFromFrontCm - b.positionFromFrontCm)
  if (sorted.length === 1) {
    const only = sorted[0] as SolverAxleGroup
    return [{ name: only.name, positionFromFrontCm: only.positionFromFrontCm, kg: netKg, maxKg: only.maxKg }]
  }
  const front = sorted[0] as SolverAxleGroup
  const rearGroups = sorted.slice(1)
  const rearPosition = rearGroups.reduce((sum, group) => sum + group.positionFromFrontCm, 0) / rearGroups.length
  const span = rearPosition - front.positionFromFrontCm
  let rearReaction = span <= 0 ? netKg / 2 : (netKg * (cogX - front.positionFromFrontCm)) / span
  rearReaction = Math.max(0, Math.min(netKg, rearReaction))
  const frontReaction = netKg - rearReaction
  const perRear = rearReaction / rearGroups.length
  return [
    { name: front.name, positionFromFrontCm: front.positionFromFrontCm, kg: frontReaction, maxKg: front.maxKg },
    ...rearGroups.map((group) => ({
      name: group.name,
      positionFromFrontCm: group.positionFromFrontCm,
      kg: perRear,
      maxKg: group.maxKg,
    })),
  ]
}

export function axleViolation(loads: AxleLoad[]): AxleLoad | null {
  for (const load of loads) {
    if (load.kg > load.maxKg + 1e-6) return load
  }
  return null
}

export function equipmentVolumeM3(equipment: Pick<SolverEquipment, "lengthCm" | "widthCm" | "heightCm">): number {
  return (equipment.lengthCm * equipment.widthCm * equipment.heightCm) / 1_000_000
}
