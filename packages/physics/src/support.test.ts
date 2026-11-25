import { describe, expect, it } from "vitest"
import { convexHull, pointInPolygon, polygonArea } from "./hull"
import { supportFrom } from "./support"
import { DEFAULT_WORLD, boxBody } from "./types"

const world = { ...DEFAULT_WORLD, lengthCm: 400, widthCm: 400, heightCm: 400 }

describe("convex hull and point-in-polygon", () => {
  it("computes the area of a 100 x 80 rectangle as 8000 cm²", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
      { x: 50, y: 40 },
    ])
    expect(polygonArea(hull)).toBeCloseTo(8000, 6)
  })

  it("treats a point on the polygon edge as inside", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]
    expect(pointInPolygon({ x: 50, y: 0 }, square, 0.1)).toBe(true)
    expect(pointInPolygon({ x: 50, y: 50 }, square, 0.1)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 50 }, square, 0.1)).toBe(false)
  })
})

describe("support polygon and stability", () => {
  it("a box fully on the floor is stable: 100% area and CoG inside", () => {
    const box = boxBody("a", 0, 0, 0, 100, 100, 60, 400)
    const result = supportFrom(box, [], world)
    expect(result.baseAreaCm2).toBeCloseTo(10000, 6)
    expect(result.areaRatio).toBeCloseTo(1, 5)
    expect(result.cogInside).toBe(true)
    expect(result.stable).toBe(true)
  })

  it("flags a box whose CoG sits outside a 40% side support", () => {
    const upper = boxBody("top", 0, 0, 60, 100, 100, 40, 400)
    const lower = boxBody("base", 0, 0, 0, 40, 100, 60, 400)
    const result = supportFrom(upper, [lower], { ...world, decksCm: [0] })
    expect(result.areaRatio).toBeCloseTo(0.4, 5)
    expect(result.cogInside).toBe(false)
    expect(result.stable).toBe(false)
  })

  it("is stable when the CoG lies exactly on the support edge and area is 70%", () => {
    const upper = boxBody("top", 0, 0, 50, 100, 100, 40, 400)
    const lower = boxBody("base", 0, 0, 0, 70, 100, 50, 400)
    // The threshold is stated here: this checks the geometry at exactly 70%, not what the default is.
    const result = supportFrom(upper, [lower], { ...world, minSupportRatio: 0.7 })
    expect(result.areaRatio).toBeCloseTo(0.7, 5)
    expect(pointInPolygon({ x: 50, y: 50 }, result.polygon, 0.1)).toBe(true)
    expect(result.cogInside).toBe(true)
    expect(result.stable).toBe(true)
  })

  it("tips when the CoG is past the support edge (beyond the 0.1 cm tolerance)", () => {
    const upper = boxBody("top", 0, 0, 50, 100, 100, 40, 400)
    const lower = boxBody("base", 0, 0, 0, 49, 100, 50, 400)
    const result = supportFrom(upper, [lower], world)
    expect(result.cogInside).toBe(false)
    expect(result.stable).toBe(false)
  })
})
