import { describe, expect, it } from "vitest"
import {
  boundaryShortfallCm,
  clearanceViolations,
  envelopeRect,
  floorUtilization,
  neighbourShortfallCm,
  sidesOf,
  type Clearance4,
  type PlanBox,
} from "./footprint"
import { boxBody, DEFAULT_WORLD } from "./types"
import { validateDrop, type DropPiece } from "./validate-drop"

const unit = { lengthCm: 1000, widthCm: 240 }

function box(id: string, x: number, y: number, l: number, w: number, clearance?: Clearance4, extra: Partial<PlanBox> = {}): PlanBox {
  return { id, x, y, z: 0, l, w, h: 100, clearance, ...extra }
}

describe("asymmetric clearance", () => {
  it("grows the footprint by a different amount on each side", () => {
    const c = { x0: 20, x1: 5, y0: 10, y1: 5 }
    const rect = envelopeRect(box("a", 100, 50, 100, 60, c))
    expect(rect).toEqual({ x0: 80, x1: 205, y0: 40, y1: 115 })
  })

  it("reports effective floor use from the uneven envelope", () => {
    const result = floorUtilization([box("a", 100, 50, 100, 60, { x0: 20, x1: 5, y0: 10, y1: 5 })], unit)
    expect(result.actualAreaCm2).toBe(100 * 60)
    expect(result.effectiveAreaCm2).toBe((100 + 25) * (60 + 15))
  })

  it("equals the actual figure when every side is zero, however the zeros are written", () => {
    const zero = floorUtilization([box("a", 0, 0, 100, 100, { x0: 0, x1: 0, y0: 0, y1: 0 })], unit)
    expect(zero.effectivePct).toBe(zero.actualPct)
    const none = floorUtilization([box("a", 0, 0, 100, 100)], unit)
    expect(none).toEqual(zero)
  })

  it("counts overlapping reserved space once", () => {
    // A's rear reserve (30) and B's front reserve (30) overlap in the 40 cm gap.
    const result = floorUtilization(
      [box("a", 50, 20, 100, 50, { x0: 0, x1: 30, y0: 0, y1: 0 }), box("b", 190, 20, 100, 50, { x0: 30, x1: 0, y0: 0, y1: 0 })],
      unit,
    )
    // One merged block from x = 50 to 290 (the reserves fill the gap), 50 wide.
    expect(result.effectiveAreaCm2).toBe(240 * 50)
  })

  it("does not clip the envelope to the unit and flags the side that pokes out", () => {
    const piece = box("a", 10, 10, 100, 100, { x0: 25, x1: 0, y0: 0, y1: 0 })
    expect(floorUtilization([piece], unit).effectiveAreaCm2).toBe(125 * 100)
    expect(boundaryShortfallCm(piece, unit)).toBe(15)
    expect(clearanceViolations([piece], unit)).toEqual([{ id: "a", otherId: null, kind: "BOUNDARY", shortfallCm: 15 }])
  })

  it("lets a piece sit hard against a wall on a side where it needs nothing", () => {
    const piece = box("a", 0, 0, 100, 100, { x0: 0, x1: 20, y0: 0, y1: 20 })
    expect(boundaryShortfallCm(piece, unit)).toBe(0)
    const far = box("b", 900, 140, 100, 100, { x0: 20, x1: 0, y0: 20, y1: 0 })
    expect(boundaryShortfallCm(far, unit)).toBe(0)
    expect(boundaryShortfallCm(box("c", 900, 140, 100, 100, { x0: 0, x1: 20, y0: 0, y1: 0 }), unit)).toBe(20)
  })

  it("checks each wall against the side that faces it", () => {
    const c = { x0: 5, x1: 30, y0: 12, y1: 7 }
    expect(boundaryShortfallCm(box("a", 5, 12, 100, 100, c), unit)).toBe(0)
    expect(boundaryShortfallCm(box("a", 4, 12, 100, 100, c), unit)).toBeCloseTo(1, 6)
    expect(boundaryShortfallCm(box("a", 5, 11, 100, 100, c), unit)).toBeCloseTo(1, 6)
    expect(boundaryShortfallCm(box("a", 870, 12, 100, 100, c), unit)).toBe(0)
    expect(boundaryShortfallCm(box("a", 871, 12, 100, 100, c), unit)).toBeCloseTo(1, 6)
    expect(boundaryShortfallCm(box("a", 5, 133, 100, 100, c), unit)).toBe(0)
    expect(boundaryShortfallCm(box("a", 5, 134, 100, 100, c), unit)).toBeCloseTo(1, 6)
  })
})

describe("shared clearance between neighbours uses the facing sides", () => {
  const a = box("a", 0, 100, 100, 50, { x0: 0, x1: 20, y0: 0, y1: 0 })

  it("keeps the larger of the two facing allowances, not their sum", () => {
    // A's rear reserve is 20; B's front reserve is 5. The gap must be 20, not 25.
    expect(neighbourShortfallCm(a, box("b", 120, 100, 100, 50, { x0: 5, x1: 0, y0: 0, y1: 0 }))).toBe(0)
    expect(neighbourShortfallCm(a, box("b", 115, 100, 100, 50, { x0: 5, x1: 0, y0: 0, y1: 0 }))).toBeCloseTo(5, 6)
  })

  it("uses the neighbour's side when it is the larger one", () => {
    const b = box("b", 125, 100, 100, 50, { x0: 30, x1: 0, y0: 0, y1: 0 })
    // B reserves 30 in front of itself, reaching x = 95, inside A (which ends at 100).
    expect(neighbourShortfallCm(a, b)).toBeCloseTo(5, 6)
    expect(neighbourShortfallCm(a, box("b", 130, 100, 100, 50, { x0: 30, x1: 0, y0: 0, y1: 0 }))).toBe(0)
  })

  it("ignores sides that do not face the neighbour", () => {
    // B is behind A: only A's rear (20) and B's front (0) matter, not A's large front or B's large rear.
    const big = box("a", 0, 100, 100, 50, { x0: 80, x1: 20, y0: 0, y1: 0 })
    const other = box("b", 120, 100, 100, 50, { x0: 0, x1: 90, y0: 0, y1: 0 })
    expect(neighbourShortfallCm(big, other)).toBe(0)
  })

  it("is symmetric in which piece is asked first", () => {
    const b = box("b", 115, 100, 100, 50, { x0: 5, x1: 0, y0: 0, y1: 0 })
    expect(neighbourShortfallCm(a, b)).toBe(neighbourShortfallCm(b, a))
  })

  it("keeps a zero-clearance piece out of a neighbour's reserved space", () => {
    const zero = box("z", 110, 100, 100, 50, { x0: 0, x1: 0, y0: 0, y1: 0 })
    expect(neighbourShortfallCm(a, zero)).toBeCloseTo(10, 6)
    expect(neighbourShortfallCm(a, box("z", 120, 100, 100, 50))).toBe(0)
    expect(clearanceViolations([a, zero], unit)).toHaveLength(1)
  })

  it("applies across the width as well as the length", () => {
    const left = box("l", 100, 20, 100, 50, { x0: 0, x1: 0, y0: 0, y1: 25 })
    const rightOk = box("r", 100, 95, 100, 50, { x0: 0, x1: 0, y0: 10, y1: 0 })
    const rightBad = box("r", 100, 90, 100, 50, { x0: 0, x1: 0, y0: 10, y1: 0 })
    expect(neighbourShortfallCm(left, rightOk)).toBe(0)
    expect(neighbourShortfallCm(left, rightBad)).toBeCloseTo(5, 6)
  })

  it("flags a diagonal neighbour whose corner sits inside the reserved space", () => {
    const corner = box("c", 125, 155, 100, 50, { x0: 0, x1: 0, y0: 0, y1: 0 })
    const near = box("n", 0, 100, 100, 50, { x0: 0, x1: 30, y0: 0, y1: 30 })
    expect(neighbourShortfallCm(near, corner)).toBeGreaterThan(0)
  })

  it("needs no clearance between a piece and the one stacked on it, and still applies beside a taller neighbour", () => {
    const base = box("base", 0, 0, 100, 100, { x0: 20, x1: 20, y0: 20, y1: 20 })
    const onTop = box("top", 0, 0, 100, 100, { x0: 20, x1: 20, y0: 20, y1: 20 }, { z: 100 })
    expect(neighbourShortfallCm(base, onTop)).toBe(0)
    const tall = box("tall", 0, 100, 100, 50, { x0: 0, x1: 20, y0: 0, y1: 0 }, { h: 300 })
    const beside = box("beside", 110, 100, 100, 50, undefined, { z: 120, h: 40 })
    expect(neighbourShortfallCm(tall, beside)).toBeGreaterThan(0)
  })

  it("never reports anything when no piece has clearance", () => {
    expect(clearanceViolations([box("a", 0, 0, 100, 100), box("b", 100, 0, 100, 100), box("c", 900, 140, 100, 100)], unit)).toEqual([])
  })

  it("reads a uniform number the same as four equal sides", () => {
    const sides = sidesOf({ clearanceCm: 7 })
    expect(sides).toEqual({ x0: 7, x1: 7, y0: 7, y1: 7 })
    const viaNumber = floorUtilization([box("a", 20, 20, 100, 100, undefined, { clearanceCm: 7 })], unit)
    const viaSides = floorUtilization([box("a", 20, 20, 100, 100, sides)], unit)
    expect(viaNumber).toEqual(viaSides)
  })
})

describe("directional clearance in the Playground drop check", () => {
  const world = { ...DEFAULT_WORLD, lengthCm: 500, widthCm: 240, heightCm: 250 }
  const piece = (id: string, x: number, y: number, z: number, clearance?: Clearance4, extra: Partial<DropPiece> = {}): DropPiece => ({
    ...boxBody(id, x, y, z, 100, 100, 100, 50),
    name: id,
    clearance,
    ...extra,
  })

  it("accepts a piece hard against a wall on the side where it needs nothing", () => {
    const moving = piece("a", 0, 10, 0, { x0: 0, x1: 20, y0: 10, y1: 10 })
    expect(validateDrop(world, [moving], moving, { x: 0, y: 10, z: 0 }).valid).toBe(true)
  })

  it("refuses a piece that is too close to the wall on the side that needs room", () => {
    const moving = piece("a", 10, 10, 0, { x0: 25, x1: 0, y0: 0, y1: 0 })
    const result = validateDrop(world, [moving], moving, { x: 10, y: 10, z: 0 })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("CLEARANCE")
    expect(result.message).toMatch(/past the wall/)
  })

  it("keeps the facing reserve between neighbours and does not count it as support", () => {
    const other = piece("o", 10, 10, 0, { x0: 0, x1: 30, y0: 0, y1: 0 })
    const close = piece("m", 130, 10, 0)
    expect(validateDrop(world, [other, close], close, { x: 130, y: 10, z: 0 }).reason).toBe("CLEARANCE")
    const ok = piece("m", 140, 10, 0)
    expect(validateDrop(world, [other, ok], ok, { x: 140, y: 10, z: 0 }).valid).toBe(true)
    const base = piece("base", 10, 10, 0, { x0: 20, x1: 20, y0: 20, y1: 20 })
    const overhang = piece("over", 70, 10, 100)
    expect(validateDrop(world, [base, overhang], overhang, { x: 70, y: 10, z: 100 }).reason).toBe("NO_SUPPORT")
  })
})
