import { describe, expect, it } from "vitest"
import {
  boundaryShortfallCm,
  clearanceViolations,
  floorUtilization,
  neighbourShortfallCm,
  unionArea,
  type PlanBox,
} from "./footprint"

const unit = { lengthCm: 1000, widthCm: 240 }

function box(id: string, x: number, y: number, l: number, w: number, extra: Partial<PlanBox> = {}): PlanBox {
  return { id, x, y, z: 0, l, w, h: 100, ...extra }
}

describe("unionArea", () => {
  it("counts overlapping rectangles once", () => {
    expect(unionArea([{ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 5, y0: 5, x1: 15, y1: 15 }])).toBe(175)
  })

  it("handles disjoint, nested and touching rectangles", () => {
    expect(unionArea([{ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 20, y0: 0, x1: 30, y1: 10 }])).toBe(200)
    expect(unionArea([{ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 2, y0: 2, x1: 4, y1: 4 }])).toBe(100)
    expect(unionArea([{ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 10, y0: 0, x1: 20, y1: 10 }])).toBe(200)
    expect(unionArea([])).toBe(0)
  })
})

describe("floorUtilization", () => {
  it("gives identical actual and effective figures when there is no allowance", () => {
    const result = floorUtilization([box("a", 0, 0, 117, 77), box("b", 117, 0, 117, 77)], unit)
    expect(result.effectivePct).toBe(result.actualPct)
    expect(result.actualAreaCm2).toBe(2 * 117 * 77)
  })

  it("is exact for sizes and positions that are not multiples of 5 cm", () => {
    const boxes = [box("a", 3.3, 1.7, 117, 77), box("b", 123.4, 0.2, 83.3, 41.7)]
    const exact = 117 * 77 + 83.3 * 41.7
    expect(floorUtilization(boxes, unit).actualAreaCm2).toBeCloseTo(exact, 6)
    expect(floorUtilization(boxes, unit).actualPct).toBeCloseTo((exact / (1000 * 240)) * 100, 9)
  })

  it("does not use a grid: three 117 x 77 pieces are not rounded up", () => {
    const boxes = [box("a", 0, 0, 117, 77), box("b", 117, 0, 117, 77), box("c", 0, 77, 117, 77)]
    const exactPct = ((3 * 117 * 77) / (1203 * 235)) * 100
    expect(floorUtilization(boxes, { lengthCm: 1203, widthCm: 235 }).actualPct).toBeCloseTo(exactPct, 9)
  })

  it("does not count the same floor twice when pieces overlap", () => {
    const result = floorUtilization([box("a", 0, 0, 100, 100), box("b", 50, 0, 100, 100)], unit)
    expect(result.actualAreaCm2).toBe(150 * 100)
  })

  it("leaves stacked and raised pieces out of the floor figure", () => {
    const stacked = floorUtilization([box("a", 0, 0, 100, 100), box("top", 0, 0, 100, 100, { z: 100 })], unit)
    expect(stacked.actualAreaCm2).toBe(100 * 100)
    expect(floorUtilization([box("hover", 0, 0, 100, 100, { z: 40 })], unit).actualAreaCm2).toBe(0)
  })

  it("treats a piece within the contact tolerance as standing on the floor", () => {
    expect(floorUtilization([box("a", 0, 0, 100, 100, { z: 0.4 })], unit).actualAreaCm2).toBe(100 * 100)
    expect(floorUtilization([box("a", 0, 0, 100, 100, { z: 0.6 })], unit).actualAreaCm2).toBe(0)
  })

  it("grows the effective footprint by the allowance on every side", () => {
    const result = floorUtilization([box("a", 50, 50, 100, 60, { clearanceCm: 10 })], unit)
    expect(result.actualAreaCm2).toBe(100 * 60)
    expect(result.effectiveAreaCm2).toBe(120 * 80)
  })

  it("counts overlapping reserved clearance once", () => {
    // Two pieces 10 cm apart, each reserving 10 cm: the gap is shared, not reserved twice.
    const result = floorUtilization(
      [box("a", 20, 20, 100, 50, { clearanceCm: 10 }), box("b", 130, 20, 100, 50, { clearanceCm: 10 })],
      unit,
    )
    // One merged block: x from 10 to 240, y from 10 to 80.
    expect(result.effectiveAreaCm2).toBe(230 * 70)
  })

  it("does not hide clearance that reaches past a wall by clipping it", () => {
    const against = floorUtilization([box("a", 0, 0, 100, 100, { clearanceCm: 10 })], unit)
    expect(against.effectiveAreaCm2).toBe(120 * 120)
    expect(clearanceViolations([box("a", 0, 0, 100, 100, { clearanceCm: 10 })], unit)).toEqual([
      { id: "a", otherId: null, kind: "BOUNDARY", shortfallCm: 10 },
    ])
  })

  it("treats a zero or missing allowance as none", () => {
    const a = floorUtilization([box("a", 0, 0, 100, 100, { clearanceCm: 0 })], unit)
    const b = floorUtilization([box("a", 0, 0, 100, 100)], unit)
    expect(a).toEqual(b)
    expect(floorUtilization([box("a", 0, 0, 100, 100, { clearanceCm: -5 })], unit).effectiveAreaCm2).toBe(100 * 100)
  })

  it("is zero for an empty unit", () => {
    expect(floorUtilization([], unit)).toEqual({ actualPct: 0, effectivePct: 0, actualAreaCm2: 0, effectiveAreaCm2: 0 })
  })
})

describe("clearance rules", () => {
  it("shares the gap between neighbours: the larger allowance, not the sum", () => {
    const a = box("a", 20, 20, 100, 50, { clearanceCm: 10 })
    const exact = box("b", 130, 20, 100, 50, { clearanceCm: 10 })
    const tight = box("c", 125, 20, 100, 50, { clearanceCm: 10 })
    expect(neighbourShortfallCm(a, exact)).toBe(0)
    expect(neighbourShortfallCm(a, tight)).toBeCloseTo(5, 6)
    const mixed = box("d", 128, 20, 100, 50, { clearanceCm: 8 })
    expect(neighbourShortfallCm(a, mixed)).toBeCloseTo(2, 6)
  })

  it("applies one piece's allowance to a neighbour that has none", () => {
    const a = box("a", 20, 20, 100, 50, { clearanceCm: 10 })
    const plain = box("b", 125, 20, 100, 50)
    expect(neighbourShortfallCm(a, plain)).toBeCloseTo(5, 6)
  })

  it("needs no clearance between a piece and the one it rests on", () => {
    const below = box("below", 20, 20, 100, 50, { clearanceCm: 10 })
    const on = box("on", 20, 20, 100, 50, { clearanceCm: 10, z: 100 })
    expect(neighbourShortfallCm(below, on)).toBe(0)
  })

  it("requires clearance between pieces at a shared height, even when they differ in height", () => {
    const tall = box("tall", 20, 20, 100, 50, { clearanceCm: 10, h: 200 })
    const stackedBeside = box("beside", 125, 20, 100, 50, { clearanceCm: 10, z: 100, h: 50 })
    expect(neighbourShortfallCm(tall, stackedBeside)).toBeGreaterThan(0)
  })

  it("flags diagonal neighbours whose corners are too close", () => {
    const a = box("a", 20, 20, 100, 50, { clearanceCm: 10 })
    const diagonal = box("b", 125, 75, 100, 50, { clearanceCm: 10 })
    expect(neighbourShortfallCm(a, diagonal)).toBeGreaterThan(0)
  })

  it("accepts a piece placed exactly one allowance from the wall and rejects less", () => {
    expect(boundaryShortfallCm(box("a", 10, 10, 100, 100, { clearanceCm: 10 }), unit)).toBe(0)
    expect(boundaryShortfallCm(box("a", 990 - 100, 140, 100, 90, { clearanceCm: 10 }), unit)).toBe(0)
    expect(boundaryShortfallCm(box("a", 10, 9, 100, 100, { clearanceCm: 10 }), unit)).toBeCloseTo(1, 6)
    expect(boundaryShortfallCm(box("a", 891, 10, 100, 100, { clearanceCm: 10 }), unit)).toBeCloseTo(1, 6)
  })

  it("never reports a violation when no piece has an allowance", () => {
    const boxes = [box("a", 0, 0, 100, 100), box("b", 100, 0, 100, 100), box("c", 900, 140, 100, 100)]
    expect(clearanceViolations(boxes, unit)).toEqual([])
  })
})
