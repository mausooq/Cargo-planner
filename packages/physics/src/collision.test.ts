import { describe, expect, it } from "vitest"
import { overlappingPairs } from "./broadphase"
import { bodiesOverlap, boxesOverlap, cylinderBoxOverlap, cylindersOverlap } from "./collision"
import { boxBody, cylinderBody } from "./types"

describe("box-box collision", () => {
  it("detects overlapping AABB boxes and misses a 1 cm gap", () => {
    const a = boxBody("a", 0, 0, 0, 100, 80, 60)
    const b = boxBody("b", 50, 0, 0, 100, 80, 60)
    const clear = boxBody("c", 101, 0, 0, 100, 80, 60)
    expect(boxesOverlap(a, b)).toBe(true)
    expect(boxesOverlap(a, clear)).toBe(false)
  })

  it("uses SAT for a box rotated 45 degrees about Z", () => {
    const a = boxBody("a", 0, 0, 0, 100, 20, 20, 1, Math.PI / 4)
    const far = boxBody("b", 200, 0, 0, 20, 20, 20)
    const near = boxBody("c", 45, 0, 0, 20, 20, 20)
    expect(boxesOverlap(a, far)).toBe(false)
    expect(bodiesOverlap(a, near)).toBe(true)
  })
})

describe("cylinder collisions", () => {
  it("standing cylinders overlap when their XY circles intersect", () => {
    const a = cylinderBody("a", 0, 0, 0, 100, 100, 150)
    const hit = cylinderBody("b", 90, 0, 0, 100, 100, 150)
    const miss = cylinderBody("c", 110, 0, 0, 100, 100, 150)
    expect(cylindersOverlap(a, hit)).toBe(true)
    expect(cylindersOverlap(a, miss)).toBe(false)
  })

  it("a standing cylinder hits a box when the circle reaches the rectangle", () => {
    const cyl = cylinderBody("pipe", 0, 0, 0, 100, 100, 150)
    const box = boxBody("crate", 90, 25, 0, 80, 80, 80)
    const away = boxBody("far", 160, 0, 0, 80, 80, 80)
    expect(cylinderBoxOverlap(cyl, box)).toBe(true)
    expect(cylinderBoxOverlap(cyl, away)).toBe(false)
  })

  it("a lying pipe (axis X) hits a box in the YZ circle plane", () => {
    const pipe = cylinderBody("pipe", 0, 0, 0, 200, 40, 40, 1, "x")
    const box = boxBody("crate", 50, 15, 0, 40, 40, 40)
    const above = boxBody("high", 50, 15, 50, 40, 40, 40)
    expect(cylinderBoxOverlap(pipe, box)).toBe(true)
    expect(cylinderBoxOverlap(pipe, above)).toBe(false)
  })
})

describe("broad phase", () => {
  it("returns only pairs whose X extents overlap", () => {
    const a = boxBody("a", 0, 0, 0, 10, 10, 10)
    const b = boxBody("b", 5, 0, 0, 10, 10, 10)
    const c = boxBody("c", 40, 0, 0, 10, 10, 10)
    const pairs = overlappingPairs([a, b, c])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.map((body) => body.id).sort()).toEqual(["a", "b"])
  })
})
