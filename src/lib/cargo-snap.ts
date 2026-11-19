import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"

export type SnapAxes = { x: boolean; y: boolean }

export type SnapResult = {
  item: PlanItemView
  /** The piece the dragged one was lined up on, or null if nothing was close enough. */
  target: PlanItemView | null
}

const MIN_SNAP_CM = 8
const MAX_SNAP_CM = 40

/** How close (cm) an edge has to be before it snaps: about a third of the smaller footprint, kept between 8 and 40 cm. */
export function snapDistance(item: PlanItemView, below: PlanItemView): number {
  const smallest = Math.min(item.lengthCm, item.widthCm, below.lengthCm, below.widthCm)
  return Math.min(MAX_SNAP_CM, Math.max(MIN_SNAP_CM, smallest * 0.3))
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

/**
 * The piece the user is aiming at: the one most of the dragged footprint is over (largest shared
 * area), ties broken by the higher top. Using "largest area" rather than "highest top" matters when
 * the drag just clips the corner of a taller neighbour: we line up with the box you are over, which
 * also slides the piece off that neighbour.
 */
export function pieceBelow(item: PlanItemView, others: PlanItemView[]): PlanItemView | null {
  let best: { piece: PlanItemView; top: number; area: number } | null = null
  for (const other of others) {
    if (other.id === item.id) continue
    const area =
      overlap(item.x, item.x + item.lengthCm, other.x, other.x + other.lengthCm) *
      overlap(item.y, item.y + item.widthCm, other.y, other.y + other.widthCm)
    if (area <= 0) continue
    const top = other.z + other.heightCm
    if (!best || area > best.area + 1 || (Math.abs(area - best.area) <= 1 && top > best.top)) {
      best = { piece: other, top, area }
    }
  }
  return best?.piece ?? null
}

/** Nearest of: left edges flush, centres lined up, right edges flush. Null when none is within reach. */
function snapAxis(start: number, size: number, belowStart: number, belowSize: number, reach: number): number | null {
  const options = [belowStart, belowStart + (belowSize - size) / 2, belowStart + belowSize - size]
  let best: number | null = null
  for (const option of options) {
    const distance = Math.abs(option - start)
    if (distance <= reach && (best === null || distance < Math.abs(best - start))) best = option
  }
  return best
}

/**
 * Lines a dragged piece up with the piece it is being stacked on, so it sits exactly on top
 * (same edges for same-size boxes; flush or centred otherwise). Only the axes the current camera
 * lets the user drag are changed. Pieces resting on the floor with nothing under them are left alone.
 */
export function snapToStack(item: PlanItemView, others: PlanItemView[], axes: SnapAxes = { x: true, y: true }): SnapResult {
  const below = pieceBelow(item, others)
  if (!below) return { item, target: null }
  const reach = snapDistance(item, below)
  const x = axes.x ? snapAxis(item.x, item.lengthCm, below.x, below.lengthCm, reach) : null
  const y = axes.y ? snapAxis(item.y, item.widthCm, below.y, below.widthCm, reach) : null
  if (x === null && y === null) return { item, target: null }
  return { item: { ...item, x: x ?? item.x, y: y ?? item.y }, target: below }
}

export type NeighbourSnap = {
  item: PlanItemView
  /** What it clicked against, for the drag tooltip: a piece's name or "the wall". */
  against: string | null
}

const MIN_SIDE_SNAP_CM = 5
const MAX_SIDE_SNAP_CM = 12

function sideReach(size: number): number {
  return Math.min(MAX_SIDE_SNAP_CM, Math.max(MIN_SIDE_SNAP_CM, size * 0.25))
}

function spansOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > 0.5
}

type Candidate = { value: number; against: string }

function nearest(start: number, candidates: Candidate[], reach: number): Candidate | null {
  let best: Candidate | null = null
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.value - start)
    if (distance <= reach && (!best || distance < Math.abs(best.value - start))) best = candidate
  }
  return best
}

/**
 * Side-by-side snapping: slides a dragged piece flush against the nearest neighbour in the same
 * row and level, or against a container wall, when it is within about 12 cm. Only the axes the
 * camera lets the user drag are changed.
 */
export function snapToNeighbours(
  item: PlanItemView,
  others: PlanItemView[],
  unit: Pick<PlanUnitView, "lengthCm" | "widthCm">,
  axes: SnapAxes = { x: true, y: true },
): NeighbourSnap {
  const sameLevel = (other: PlanItemView) => other.id !== item.id && spansOverlap(item.z, item.z + item.heightCm, other.z, other.z + other.heightCm)
  let x = item.x
  let y = item.y
  const hits: string[] = []

  if (axes.x) {
    const row = others.filter((other) => sameLevel(other) && spansOverlap(item.y, item.y + item.widthCm, other.y, other.y + other.widthCm))
    const hit = nearest(
      item.x,
      [
        { value: 0, against: "the wall" },
        { value: unit.lengthCm - item.lengthCm, against: "the doors" },
        ...row.flatMap((other) => [
          { value: other.x + other.lengthCm, against: other.name },
          { value: other.x - item.lengthCm, against: other.name },
        ]),
      ],
      sideReach(item.lengthCm),
    )
    if (hit) {
      x = hit.value
      hits.push(hit.against)
    }
  }
  if (axes.y) {
    const column = others.filter((other) => sameLevel(other) && spansOverlap(x, x + item.lengthCm, other.x, other.x + other.lengthCm))
    const hit = nearest(
      item.y,
      [
        { value: 0, against: "the wall" },
        { value: unit.widthCm - item.widthCm, against: "the wall" },
        ...column.flatMap((other) => [
          { value: other.y + other.widthCm, against: other.name },
          { value: other.y - item.widthCm, against: other.name },
        ]),
      ],
      sideReach(item.widthCm),
    )
    if (hit) {
      y = hit.value
      hits.push(hit.against)
    }
  }
  if (hits.length === 0) return { item, against: null }
  // Prefer naming a piece over a wall in the tooltip.
  const against = hits.find((hit) => !hit.startsWith("the ")) ?? hits[0] ?? null
  return { item: { ...item, x, y }, against }
}
