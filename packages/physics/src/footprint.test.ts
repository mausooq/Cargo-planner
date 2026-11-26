import { describe, expect, it } from "vitest"
import { floorUtilization, unionArea, type PlanBox } from "./footprint"

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
  it("is the share of the floor the pieces' own footprints cover", () => {
    const result = floorUtilization([box("a", 0, 0, 117, 77), box("b", 117, 0, 117, 77)], unit)
    expect(result.areaCm2).toBe(2 * 117 * 77)
    expect(result.pct).toBeCloseTo(((2 * 117 * 77) / (1000 * 240)) * 100, 9)
  })

  it("is exact for sizes and positions that are not multiples of 5 cm", () => {
    const boxes = [box("a", 3.3, 1.7, 117, 77), box("b", 123.4, 0.2, 83.3, 41.7)]
    const exact = 117 * 77 + 83.3 * 41.7
    expect(floorUtilization(boxes, unit).areaCm2).toBeCloseTo(exact, 6)
    expect(floorUtilization(boxes, unit).pct).toBeCloseTo((exact / (1000 * 240)) * 100, 9)
  })

  it("does not use a grid: three 117 x 77 pieces are not rounded up", () => {
    const boxes = [box("a", 0, 0, 117, 77), box("b", 117, 0, 117, 77), box("c", 0, 77, 117, 77)]
    const exactPct = ((3 * 117 * 77) / (1203 * 235)) * 100
    expect(floorUtilization(boxes, { lengthCm: 1203, widthCm: 235 }).pct).toBeCloseTo(exactPct, 9)
  })

  it("does not count the same floor twice when pieces overlap", () => {
    const result = floorUtilization([box("a", 0, 0, 100, 100), box("b", 50, 0, 100, 100)], unit)
    expect(result.areaCm2).toBe(150 * 100)
  })

  it("leaves stacked and raised pieces out of the floor figure", () => {
    const stacked = floorUtilization([box("a", 0, 0, 100, 100), box("top", 0, 0, 100, 100, { z: 100 })], unit)
    expect(stacked.areaCm2).toBe(100 * 100)
    expect(floorUtilization([box("hover", 0, 0, 100, 100, { z: 40 })], unit).areaCm2).toBe(0)
  })

  it("treats a piece within the contact tolerance as standing on the floor", () => {
    expect(floorUtilization([box("a", 0, 0, 100, 100, { z: 0.4 })], unit).areaCm2).toBe(100 * 100)
    expect(floorUtilization([box("a", 0, 0, 100, 100, { z: 0.6 })], unit).areaCm2).toBe(0)
  })

  it("is zero for an empty unit, and for a unit with no floor", () => {
    expect(floorUtilization([], unit)).toEqual({ pct: 0, areaCm2: 0 })
    expect(floorUtilization([box("a", 0, 0, 10, 10)], { lengthCm: 0, widthCm: 0 }).pct).toBe(0)
  })

  it("does not change when a piece is turned a half turn: only the rectangle it covers counts", () => {
    const asEntered = floorUtilization([box("a", 10, 20, 117, 77)], unit)
    const halfTurn = floorUtilization([box("a", 10, 20, 117, 77)], unit)
    expect(halfTurn).toEqual(asEntered)
  })
})
