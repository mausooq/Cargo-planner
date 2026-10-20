import { describe, expect, it } from "vitest"
import { boxBody, cylinderBody, DEFAULT_WORLD } from "./types"
import { validateDrop } from "./validate-drop"

const hc45 = { ...DEFAULT_WORLD }
const settings = { clampToWalls: false, minSupportRatio: 0.7 }

function oilMachine(id: string, x: number, y: number, z = 0) {
  return { ...boxBody(id, x, y, z, 80, 80, 80, 400), name: "OIL MACHINE" }
}

describe("validateDrop", () => {
  it("accepts a piece fully inside an empty 45ft HC", () => {
    const moving = oilMachine("a", 10, 10)
    const result = validateDrop(hc45, [moving], moving, { x: 10, y: 10, z: 0 }, settings)
    expect(result.valid).toBe(true)
    expect(result.reason).toBe("OK")
    expect(result.position.z).toBeCloseTo(0, 5)
  })

  it("rejects a piece whose edge is 1 cm past the side wall", () => {
    const moving = oilMachine("a", 0, hc45.widthCm - 79)
    const result = validateDrop(hc45, [moving], moving, { x: 0, y: hc45.widthCm - 79, z: 0 }, settings)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("OUTSIDE_CONTAINER")
    expect(result.message).toBe("Outside container")
  })

  it("accepts a piece whose edge sits on the wall within 0.1 cm", () => {
    const y = hc45.widthCm - 80 + 0.1
    const moving = oilMachine("a", 0, y)
    const result = validateDrop(hc45, [moving], moving, { x: 0, y, z: 0 }, settings)
    expect(result.valid).toBe(true)
    expect(result.reason).toBe("OK")
  })

  it("rejects a stack that would poke through the roof", () => {
    const base = oilMachine("base", 0, 0)
    const moving = { ...boxBody("top", 0, 0, 0, 80, 80, 200, 100), name: "TALL" }
    const result = validateDrop(hc45, [base, moving], moving, { x: 0, y: 0, z: 0 }, settings)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("OUTSIDE_CONTAINER")
  })

  it("rejects a piece past the door end or entirely outside the unit", () => {
    const moving = oilMachine("a", 0, 0)
    const pastDoor = validateDrop(hc45, [moving], moving, { x: hc45.lengthCm - 70, y: 0, z: 0 }, settings)
    expect(pastDoor.reason).toBe("OUTSIDE_CONTAINER")
    const outside = validateDrop(hc45, [moving], moving, { x: 2000, y: 400, z: 0 }, settings)
    expect(outside.valid).toBe(false)
    expect(outside.reason).toBe("OUTSIDE_CONTAINER")
  })

  it("rejects a 5 cm overlap as a collision", () => {
    const parked = oilMachine("parked", 0, 0)
    const moving = oilMachine("moving", 0, 0)
    const result = validateDrop(hc45, [parked, moving], moving, { x: 75, y: 0, z: 0 }, settings)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("COLLISION")
    expect(result.message).toContain("OIL MACHINE")
  })

  it("rejects a box half off another box for missing support", () => {
    const below = boxBody("below", 0, 0, 0, 100, 100, 50, 200)
    const moving = { ...boxBody("top", 50, 0, 0, 100, 100, 40, 100), name: "TOP" }
    const result = validateDrop(
      { ...hc45, minSupportRatio: 0.7 },
      [below, moving],
      moving,
      { x: 50, y: 0, z: 0 },
      settings,
    )
    expect(result.valid).toBe(false)
    expect(["NO_SUPPORT", "UNSTABLE"]).toContain(result.reason)
  })

  it("rejects a 90° rotation whose footprint no longer fits", () => {
    const moving = { ...boxBody("long", 0, 50, 0, 50, 200, 40, 80), name: "BEAM" }
    const result = validateDrop(hc45, [moving], moving, { x: 0, y: 50, z: 0 }, settings)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("OUTSIDE_CONTAINER")
  })

  it("checks a cylinder by its circle, not the stored square box", () => {
    const drum = { ...cylinderBody("drum", 0, 0, 0, 100, 80, 88, 25), name: "Drum" }
    const touchWall = validateDrop(
      hc45,
      [drum],
      drum,
      { x: hc45.lengthCm - 90, y: 0, z: 0 },
      settings,
    )
    expect(touchWall.valid).toBe(true)
    expect(touchWall.reason).toBe("OK")

    const pastCircle = validateDrop(
      hc45,
      [drum],
      drum,
      { x: hc45.lengthCm - 89, y: 0, z: 0 },
      settings,
    )
    expect(pastCircle.valid).toBe(false)
    expect(pastCircle.reason).toBe("OUTSIDE_CONTAINER")
  })

  it("lets a pipe sit on the side wall using its diameter, not a fat AABB", () => {
    const pipe = { ...cylinderBody("pipe", 0, 0, 0, 300, 40, 20, 15, "x"), name: "Pipe" }
    const atWall = validateDrop(hc45, [pipe], pipe, { x: 0, y: hc45.widthCm - 30, z: 0 }, settings)
    expect(atWall.valid).toBe(true)
    expect(atWall.reason).toBe("OK")

    const pastWall = validateDrop(hc45, [pipe], pipe, { x: 0, y: hc45.widthCm - 29, z: 0 }, settings)
    expect(pastWall.valid).toBe(false)
    expect(pastWall.reason).toBe("OUTSIDE_CONTAINER")
  })
})
