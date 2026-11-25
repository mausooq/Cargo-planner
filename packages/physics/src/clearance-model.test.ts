import { describe, expect, it } from "vitest"
import {
  allowsHalfTurn,
  describeSetting,
  describeSides,
  flatRotationCode,
  isDirectional,
  MAX_CLEARANCE_CM,
  maxSide,
  modeOf,
  nextQuarterTurn,
  normaliseSetting,
  normaliseSides,
  parseRotation,
  placedSides,
  resolveSides,
  sameSetting,
  uniformSides,
} from "./clearance-model"

const FRONT_REAR_LEFT_RIGHT = { front: 1, rear: 2, left: 3, right: 4 }

describe("clearance setting modes", () => {
  it("tells inherit, uniform and directional apart, and zero from inherit", () => {
    expect(modeOf(null)).toBe("INHERIT")
    expect(modeOf(0)).toBe("UNIFORM")
    expect(modeOf(12)).toBe("UNIFORM")
    expect(modeOf(FRONT_REAR_LEFT_RIGHT)).toBe("DIRECTIONAL")
  })

  it("resolves inherit to the project default and an explicit zero to zero", () => {
    expect(resolveSides(null, 8)).toEqual(uniformSides(8))
    expect(resolveSides(0, 8)).toEqual(uniformSides(0))
    expect(resolveSides(5, 8)).toEqual(uniformSides(5))
    expect(resolveSides(FRONT_REAR_LEFT_RIGHT, 8)).toEqual(FRONT_REAR_LEFT_RIGHT)
    expect(resolveSides(null, -3)).toEqual(uniformSides(0))
  })

  it("follows the project default only while inheriting", () => {
    expect(resolveSides(null, 5).front).toBe(5)
    expect(resolveSides(null, 9).front).toBe(9)
    expect(resolveSides(0, 9).front).toBe(0)
  })

  it("compares settings, keeping inherit apart from an explicit zero", () => {
    expect(sameSetting(null, null)).toBe(true)
    expect(sameSetting(null, 0)).toBe(false)
    expect(sameSetting(0, 0)).toBe(true)
    expect(sameSetting(5, 6)).toBe(false)
    expect(sameSetting(FRONT_REAR_LEFT_RIGHT, { ...FRONT_REAR_LEFT_RIGHT })).toBe(true)
    expect(sameSetting(FRONT_REAR_LEFT_RIGHT, { ...FRONT_REAR_LEFT_RIGHT, rear: 9 })).toBe(false)
    expect(sameSetting(5, uniformSides(5))).toBe(false)
  })

  it("describes a setting for the grid and the panels", () => {
    expect(describeSetting(null, 5)).toBe("Default · 5 cm")
    expect(describeSetting(10, 5)).toBe("Uniform · 10 cm")
    expect(describeSetting(0, 5)).toBe("Custom · 0 cm")
    expect(describeSetting(FRONT_REAR_LEFT_RIGHT, 5)).toBe("Directional")
    expect(describeSides(FRONT_REAR_LEFT_RIGHT)).toBe("Front 1 · Rear 2 · Left 3 · Right 4 cm")
  })
})

describe("reading clearance input", () => {
  it("accepts four good values and rounds to a tenth", () => {
    expect(normaliseSides({ front: 20, rear: 5, left: 10.04, right: "5" })).toEqual({ front: 20, rear: 5, left: 10, right: 5 })
  })

  it("rejects missing, negative, non-numeric and unsupported input", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      [],
      {},
      { front: 1, rear: 1, left: 1 },
      { front: -1, rear: 1, left: 1, right: 1 },
      { front: Number.NaN, rear: 1, left: 1, right: 1 },
      { front: Number.POSITIVE_INFINITY, rear: 1, left: 1, right: 1 },
      { front: "", rear: 1, left: 1, right: 1 },
      { front: "abc", rear: 1, left: 1, right: 1 },
    ]) {
      expect(normaliseSides(bad)).toBeNull()
    }
  })

  it("caps values at the maximum", () => {
    expect(normaliseSides({ front: 5000, rear: 1, left: 1, right: 1 })?.front).toBe(MAX_CLEARANCE_CM)
  })

  it("lets directional sides win over a uniform number, and treats bad input as inherit", () => {
    expect(normaliseSetting({ clearanceCm: 5, clearanceSides: FRONT_REAR_LEFT_RIGHT })).toEqual(FRONT_REAR_LEFT_RIGHT)
    expect(normaliseSetting({ clearanceCm: 5 })).toBe(5)
    expect(normaliseSetting({ clearanceCm: 0 })).toBe(0)
    expect(normaliseSetting({ clearanceCm: -2 })).toBeNull()
    expect(normaliseSetting({ clearanceCm: "x" })).toBeNull()
    expect(normaliseSetting({ clearanceSides: { front: 1 } })).toBeNull()
    expect(normaliseSetting(null)).toBeNull()
    expect(normaliseSetting({})).toBeNull()
  })
})

describe("rotation codes", () => {
  it("reads flat codes as quarter turns, with the half-turn variants", () => {
    expect(parseRotation("LWH").turns).toBe(0)
    expect(parseRotation("WLH").turns).toBe(1)
    expect(parseRotation("LWH@180").turns).toBe(2)
    expect(parseRotation("WLH@180").turns).toBe(3)
    expect(parseRotation(undefined).turns).toBe(0)
  })

  it("reads tipped, unknown and malformed codes as not flat", () => {
    for (const code of ["LHW", "HLW", "WHL", "HWL", "XYZ", "LWH@90", "LHW@180", ""]) {
      expect(parseRotation(code).turns).toBeNull()
    }
    expect(parseRotation("LHW").turns).toBeNull()
  })

  it("writes and steps rotation codes through all four facings", () => {
    expect([0, 1, 2, 3, 4, -1].map(flatRotationCode)).toEqual(["LWH", "WLH", "LWH@180", "WLH@180", "LWH", "WLH@180"])
    expect(nextQuarterTurn("LWH")).toBe("WLH")
    expect(nextQuarterTurn("WLH")).toBe("LWH@180")
    expect(nextQuarterTurn("LWH@180")).toBe("WLH@180")
    expect(nextQuarterTurn("WLH@180")).toBe("LWH")
    expect(nextQuarterTurn("LHW")).toBeNull()
  })

  it("keeps a fixed orientation from facing the other way", () => {
    expect(allowsHalfTurn("FIXED")).toBe(false)
    for (const orientation of ["LONGSHIP", "ROTATE_90", "TILTABLE", "ANY", "CUSTOM"]) expect(allowsHalfTurn(orientation)).toBe(true)
  })
})

describe("directional clearance follows the piece when it turns", () => {
  it("as entered: front faces the front of the unit, rear the doors, left and right the walls", () => {
    expect(placedSides(FRONT_REAR_LEFT_RIGHT, "LWH")).toEqual({ x0: 1, x1: 2, y0: 3, y1: 4 })
  })

  it("a quarter turn clockwise sends the front towards the left wall", () => {
    expect(placedSides(FRONT_REAR_LEFT_RIGHT, "WLH")).toEqual({ x0: 4, x1: 3, y0: 1, y1: 2 })
  })

  it("a half turn swaps front with rear and left with right", () => {
    expect(placedSides(FRONT_REAR_LEFT_RIGHT, "LWH@180")).toEqual({ x0: 2, x1: 1, y0: 4, y1: 3 })
  })

  it("three quarter turns send the front towards the right wall", () => {
    expect(placedSides(FRONT_REAR_LEFT_RIGHT, "WLH@180")).toEqual({ x0: 3, x1: 4, y0: 2, y1: 1 })
  })

  it("every side of the piece is carried through every flat rotation exactly once", () => {
    for (const code of ["LWH", "WLH", "LWH@180", "WLH@180"]) {
      const placed = placedSides(FRONT_REAR_LEFT_RIGHT, code)
      expect([placed.x0, placed.x1, placed.y0, placed.y1].sort()).toEqual([1, 2, 3, 4])
    }
  })

  it("four quarter turns return to the start", () => {
    let code = "LWH"
    for (let turn = 0; turn < 4; turn += 1) code = nextQuarterTurn(code)!
    expect(code).toBe("LWH")
    expect(placedSides(FRONT_REAR_LEFT_RIGHT, code)).toEqual(placedSides(FRONT_REAR_LEFT_RIGHT, "LWH"))
  })

  it("keeps a facing pair together: front and rear stay on opposite placed sides", () => {
    for (const code of ["LWH", "WLH", "LWH@180", "WLH@180"]) {
      const placed = placedSides({ front: 20, rear: 0, left: 0, right: 0 }, code)
      const nonZero = Object.entries(placed).filter(([, value]) => value > 0)
      expect(nonZero).toHaveLength(1)
      expect(nonZero[0]![1]).toBe(20)
    }
  })

  it("applies the largest value on every side when the piece is tipped, so nothing is dropped", () => {
    for (const code of ["LHW", "HLW", "WHL", "HWL"]) {
      expect(placedSides(FRONT_REAR_LEFT_RIGHT, code)).toEqual({ x0: 4, x1: 4, y0: 4, y1: 4 })
    }
    expect(maxSide(FRONT_REAR_LEFT_RIGHT)).toBe(4)
  })

  it("applies the largest value on every side for a rotation it cannot read", () => {
    expect(placedSides(FRONT_REAR_LEFT_RIGHT, "nonsense")).toEqual({ x0: 4, x1: 4, y0: 4, y1: 4 })
  })

  it("is the same on every side for a uniform value in any rotation, and none for zero", () => {
    for (const code of ["LWH", "WLH", "LWH@180", "LHW"]) {
      expect(placedSides(uniformSides(7), code)).toEqual({ x0: 7, x1: 7, y0: 7, y1: 7 })
      expect(placedSides(uniformSides(0), code)).toEqual({ x0: 0, x1: 0, y0: 0, y1: 0 })
    }
    expect(isDirectional(uniformSides(7))).toBe(false)
    expect(isDirectional(FRONT_REAR_LEFT_RIGHT)).toBe(true)
  })
})
