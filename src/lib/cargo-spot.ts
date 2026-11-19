import { rotateItemFlat, tryPlaceItem } from "@/lib/cargo-skin"
import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"

const GRID_CM = 10

function candidateStarts(size: number, room: number, edges: number[]): number[] {
  const values = new Set<number>([0, room - size])
  // Flush against other pieces' edges (packs tidily), plus a coarse grid to catch open floor.
  for (const edge of edges) {
    values.add(edge)
    values.add(edge - size)
  }
  for (let value = 0; value <= room - size; value += GRID_CM) values.add(value)
  return [...values].filter((value) => value >= 0 && value <= room - size + 0.01).sort((a, b) => a - b)
}

function better(a: PlanItemView, b: PlanItemView): boolean {
  // Lowest first (floor before stacking), then nearest the front, then nearest the left wall.
  if (Math.abs(a.z - b.z) > 0.5) return a.z < b.z
  if (Math.abs(a.x - b.x) > 0.5) return a.x < b.x
  return a.y < b.y
}

function searchSpot(item: PlanItemView, items: PlanItemView[], unit: PlanUnitView): PlanItemView | null {
  const xs = candidateStarts(item.lengthCm, unit.lengthCm, items.flatMap((other) => [other.x, other.x + other.lengthCm]))
  const ys = candidateStarts(item.widthCm, unit.widthCm, items.flatMap((other) => [other.y, other.y + other.widthCm]))
  let best: PlanItemView | null = null
  for (const x of xs) {
    for (const y of ys) {
      const placed = tryPlaceItem({ ...item, x, y, z: 0 }, items, unit)
      if (placed && (!best || better(placed, best))) best = placed
    }
  }
  return best
}

/**
 * Where to put a piece the user takes back from "Set aside". Tries, in order:
 * its original spot, the best free spot as it is, the best free spot turned 90°.
 * Every candidate goes through the same physics checks as a drag (support, collisions,
 * stacking limits, ULD contour). Returns null when there is no room anywhere.
 */
export function findFreeSpot(item: PlanItemView, items: PlanItemView[], unit: PlanUnitView): PlanItemView | null {
  // The original spot only counts if the piece lands exactly as it was; if something has moved in
  // underneath, it would end up perched on that instead, so look for a proper free spot.
  const original = tryPlaceItem(item, items, unit)
  if (
    original &&
    Math.abs(original.x - item.x) < 0.5 &&
    Math.abs(original.y - item.y) < 0.5 &&
    Math.abs(original.z - item.z) < 0.5
  ) {
    return original
  }
  return searchSpot(item, items, unit) ?? (item.shape === "BOX" ? searchSpot(rotateItemFlat(item), items, unit) : null)
}
