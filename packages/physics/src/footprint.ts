/**
 * Floor footprints. Pure plan-view geometry shared by the solver, the Playground, the server and
 * the reports so every screen reports the same number.
 *
 * Units are centimetres. x runs front to doors, y across the width, z up from the floor.
 *
 * Footprint convention (unchanged from the solver): every piece, whatever its shape, occupies the
 * rectangle `l × w` of its placed bounding box. A drum is therefore a square footprint, not a circle.
 *
 * Floor utilization is the exact area of the union of the footprints of the pieces standing on the
 * floor, as a share of the floor. It is computed from the real rectangles, never from a grid, and
 * overlaps are counted once.
 */

/** A piece counts as standing on the floor when its underside is within this of z = 0. */
export const FLOOR_CONTACT_TOLERANCE_CM = 0.5

export type PlanBox = {
  id?: string
  x: number
  y: number
  z: number
  l: number
  w: number
  h: number
}

export type FloorUnit = { lengthCm: number; widthCm: number }

export type FloorUtilization = {
  /** Union of the pieces' footprints on the floor, as a share of the floor (0 to 100). */
  pct: number
  areaCm2: number
}

type Rect = { x0: number; y0: number; x1: number; y1: number }

export function isOnFloor(box: Pick<PlanBox, "z">): boolean {
  return box.z <= FLOOR_CONTACT_TOLERANCE_CM
}

/** Exact area of the union of axis-aligned rectangles. Overlaps are counted once. */
export function unionArea(rects: Rect[]): number {
  const live = rects.filter((rect) => rect.x1 > rect.x0 && rect.y1 > rect.y0)
  if (live.length === 0) return 0
  const xs = Array.from(new Set(live.flatMap((rect) => [rect.x0, rect.x1]))).sort((a, b) => a - b)
  let area = 0
  for (let index = 0; index < xs.length - 1; index += 1) {
    const left = xs[index] as number
    const right = xs[index + 1] as number
    const spans = live
      .filter((rect) => rect.x0 <= left && rect.x1 >= right)
      .map((rect) => [rect.y0, rect.y1] as const)
      .sort((a, b) => a[0] - b[0])
    let covered = 0
    let from = Number.NEGATIVE_INFINITY
    let to = Number.NEGATIVE_INFINITY
    for (const [start, end] of spans) {
      if (start > to) {
        if (to > from) covered += to - from
        from = start
        to = end
      } else if (end > to) {
        to = end
      }
    }
    if (to > from) covered += to - from
    area += covered * (right - left)
  }
  return area
}

/**
 * Floor use. Only pieces standing on the floor count: stacked or raised pieces do not occupy floor
 * directly.
 */
export function floorUtilization(boxes: PlanBox[], unit: FloorUnit): FloorUtilization {
  const floor = boxes.filter(isOnFloor)
  const area = unionArea(floor.map((box) => ({ x0: box.x, y0: box.y, x1: box.x + box.l, y1: box.y + box.w })))
  const floorArea = unit.lengthCm * unit.widthCm
  return { pct: floorArea > 0 ? (area / floorArea) * 100 : 0, areaCm2: area }
}
