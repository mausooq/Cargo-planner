import { settleBodies } from "@compass/physics"
import { itemToPiece, unitToWorld } from "@/lib/cargo-physics"
import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"

export type GravityResult = {
  items: PlanItemView[]
  /** Ids of pieces that dropped because what held them up was moved away. */
  fell: string[]
}

/**
 * Gravity for the playground. Every piece drops straight down onto the floor or the highest piece
 * under its footprint, bottom-up, so moving a box out from under a stack brings the boxes above it
 * down instead of leaving them floating. Pieces never move up or sideways here, and pieces that are
 * already resting keep their exact object (so React and the undo history see no change for them).
 */
export function applyGravity(items: PlanItemView[], unit: Pick<PlanUnitView, "lengthCm" | "widthCm" | "heightCm">): GravityResult {
  const { bodies } = settleBodies(items.map(itemToPiece), unitToWorld(unit))
  const bottoms = new Map(bodies.map((body) => [body.id, body.cz - body.hz]))
  const fell: string[] = []
  const next = items.map((item) => {
    const z = bottoms.get(item.id)
    if (z === undefined || Math.abs(z - item.z) < 0.05) return item
    fell.push(item.id)
    return { ...item, z: Math.round(z * 10) / 10 }
  })
  return { items: fell.length > 0 ? next : items, fell }
}
