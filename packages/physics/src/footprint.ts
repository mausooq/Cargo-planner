/**
 * Floor footprints and handling clearance. Pure plan-view geometry shared by the solver, the
 * Playground, the server and the reports so every screen reports the same numbers.
 *
 * Units are centimetres. x runs front to doors, y across the width, z up from the floor.
 *
 * Footprint convention (unchanged from the solver): every piece, whatever its shape, occupies the
 * rectangle `l × w` of its placed bounding box. A drum is therefore a square footprint, not a circle.
 *
 * Clearance (handling allowance): free space kept AROUND a piece, on top of its entered external
 * dimensions. It is operational spacing (forklift forks, hand access, lashing room), not packaging:
 * wrapping or crating that is already inside the entered dimensions must not be added again.
 *
 * A piece's clearance is described per side of its plan-view footprint (`Clearance4`): beyond its
 * minimum-x side (towards the front of the unit), its maximum-x side (towards the doors), its
 * minimum-y side (left wall) and its maximum-y side (right wall). A uniform allowance is the same
 * value on all four. How a piece's own front / rear / left / right become these four placed sides
 * for a given rotation is in `clearance-model.ts`.
 *
 * Rules:
 *  - against a wall the piece keeps its full side allowance, so its envelope must stay inside the unit;
 *  - between two pieces the reserved space is SHARED. A piece may sit inside a neighbour's reserved
 *    space only if the neighbour's physical box stays out of it and vice versa, which for two pieces
 *    facing each other means the gap is the larger of the two facing-side allowances, not their sum;
 *  - clearance only applies between pieces that overlap in height. A piece resting on another is
 *    supported by it and needs no clearance from it;
 *  - clearance is never support: stacking and support use the physical footprint only.
 */

/** A piece counts as standing on the floor when its underside is within this of z = 0. */
export const FLOOR_CONTACT_TOLERANCE_CM = 0.5
/** Slack when comparing a gap with the required clearance, so float noise is not a violation. */
export const CLEARANCE_TOLERANCE_CM = 0.01

/** Free space beyond each side of a placed footprint, in cm. */
export type Clearance4 = {
  /** Beyond the minimum-x side (towards the front of the unit). */
  x0: number
  /** Beyond the maximum-x side (towards the doors). */
  x1: number
  /** Beyond the minimum-y side (left wall). */
  y0: number
  /** Beyond the maximum-y side (right wall). */
  y1: number
}

export const NO_CLEARANCE: Clearance4 = { x0: 0, x1: 0, y0: 0, y1: 0 }

export type PlanBox = {
  id?: string
  x: number
  y: number
  z: number
  l: number
  w: number
  h: number
  /** Uniform free space kept around the piece, per side, in cm. Missing or negative means none. */
  clearanceCm?: number | null
  /** Free space per placed side. When present it takes the place of `clearanceCm`. */
  clearance?: Clearance4 | null
}

export type FloorUnit = { lengthCm: number; widthCm: number }

export type FloorUtilization = {
  /** Union of the pieces' own footprints on the floor, as a share of the floor. */
  actualPct: number
  /** Union of the footprints grown by their clearance, as a share of the floor. Never clipped. */
  effectivePct: number
  actualAreaCm2: number
  effectiveAreaCm2: number
}

type Rect = { x0: number; y0: number; x1: number; y1: number }

function side(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

/** Largest single-side allowance of a uniform value; kept for callers that only know a number. */
export function clearanceOf(box: Pick<PlanBox, "clearanceCm" | "clearance">): number {
  if (box.clearance) return Math.max(side(box.clearance.x0), side(box.clearance.x1), side(box.clearance.y0), side(box.clearance.y1))
  return side(box.clearanceCm)
}

/** The allowance on each placed side of a piece (zeros when it has none). */
export function sidesOf(box: Pick<PlanBox, "clearanceCm" | "clearance">): Clearance4 {
  if (box.clearance) {
    return { x0: side(box.clearance.x0), x1: side(box.clearance.x1), y0: side(box.clearance.y0), y1: side(box.clearance.y1) }
  }
  const all = side(box.clearanceCm)
  return all > 0 ? { x0: all, x1: all, y0: all, y1: all } : NO_CLEARANCE
}

export function hasClearance(box: Pick<PlanBox, "clearanceCm" | "clearance">): boolean {
  return clearanceOf(box) > 0
}

export function isOnFloor(box: Pick<PlanBox, "z">): boolean {
  return box.z <= FLOOR_CONTACT_TOLERANCE_CM
}

/** The footprint grown by its own clearance on each side (the reserved space, not clipped to the unit). */
export function envelopeRect(box: PlanBox): Rect {
  const s = sidesOf(box)
  return { x0: box.x - s.x0, y0: box.y - s.y0, x1: box.x + box.l + s.x1, y1: box.y + box.w + s.y1 }
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
 * Actual and effective floor use. Only pieces standing on the floor count: stacked or raised
 * pieces do not occupy floor directly. The effective envelope is deliberately not clipped to the
 * unit, so a piece whose clearance reaches past a wall shows up in the number (and in
 * `clearanceViolations`) instead of being hidden.
 */
export function floorUtilization(boxes: PlanBox[], unit: FloorUnit): FloorUtilization {
  const floor = boxes.filter(isOnFloor)
  const actual = unionArea(floor.map((box) => ({ x0: box.x, y0: box.y, x1: box.x + box.l, y1: box.y + box.w })))
  const effective = unionArea(floor.map(envelopeRect))
  const floorArea = unit.lengthCm * unit.widthCm
  const pct = (area: number) => (floorArea > 0 ? (area / floorArea) * 100 : 0)
  return { actualPct: pct(actual), effectivePct: pct(effective), actualAreaCm2: actual, effectiveAreaCm2: effective }
}

/** True when the two pieces share some height, so one is beside the other, not on top of it. */
export function sharesHeight(a: PlanBox, b: PlanBox): boolean {
  return a.z < b.z + b.h - FLOOR_CONTACT_TOLERANCE_CM && b.z < a.z + a.h - FLOOR_CONTACT_TOLERANCE_CM
}

export type ClearanceViolation = {
  id: string
  /** The neighbour in the way, or null when the clearance reaches past a wall. */
  otherId: string | null
  kind: "BOUNDARY" | "NEIGHBOUR"
  /** How much more space is needed, in cm. */
  shortfallCm: number
}

/** How far `owner`'s reserved space reaches into `other`'s physical footprint, as the smaller overlap of the two axes. */
function intrusionCm(owner: PlanBox, other: PlanBox): number {
  const env = envelopeRect(owner)
  const overlapX = Math.min(env.x1, other.x + other.l) - Math.max(env.x0, other.x)
  const overlapY = Math.min(env.y1, other.y + other.w) - Math.max(env.y0, other.y)
  if (overlapX <= CLEARANCE_TOLERANCE_CM || overlapY <= CLEARANCE_TOLERANCE_CM) return 0
  return Math.min(overlapX, overlapY)
}

/**
 * How much more space two neighbours need between them, or 0 when each stays out of the other's
 * reserved space. Facing sides share the gap: it only has to be the larger of the two allowances.
 */
export function neighbourShortfallCm(a: PlanBox, b: PlanBox): number {
  if (!hasClearance(a) && !hasClearance(b)) return 0
  if (!sharesHeight(a, b)) return 0
  return Math.max(intrusionCm(a, b), intrusionCm(b, a))
}

/** Shortfall of a piece's clearance against the unit walls: how far its envelope pokes out on the worst side. */
export function boundaryShortfallCm(box: PlanBox, unit: FloorUnit): number {
  const s = sidesOf(box)
  if (s.x0 <= 0 && s.x1 <= 0 && s.y0 <= 0 && s.y1 <= 0) return 0
  const over = Math.max(
    s.x0 - box.x,
    s.y0 - box.y,
    box.x + box.l + s.x1 - unit.lengthCm,
    box.y + box.w + s.y1 - unit.widthCm,
  )
  return over > CLEARANCE_TOLERANCE_CM ? over : 0
}

/**
 * Every clearance rule a layout breaks. With no allowance on any piece this is always empty, so
 * layouts without clearance behave exactly as before.
 */
export function clearanceViolations(boxes: PlanBox[], unit: FloorUnit): ClearanceViolation[] {
  const out: ClearanceViolation[] = []
  boxes.forEach((box, index) => {
    const id = box.id ?? String(index)
    const wall = boundaryShortfallCm(box, unit)
    if (wall > 0) out.push({ id, otherId: null, kind: "BOUNDARY", shortfallCm: wall })
    for (let other = index + 1; other < boxes.length; other += 1) {
      const neighbour = boxes[other] as PlanBox
      const shortfall = neighbourShortfallCm(box, neighbour)
      if (shortfall > 0) {
        out.push({ id, otherId: neighbour.id ?? String(other), kind: "NEIGHBOUR", shortfallCm: shortfall })
      }
    }
  })
  return out
}
