import { describe, expect, it } from "vitest"
import { allowsHalfTurn, describeRotation, flatRotationCode, nextFlatRotation, nextQuarterTurn, parseRotation } from "./rotation"

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
  })

  it("writes and steps rotation codes through all four facings", () => {
    expect([0, 1, 2, 3, 4, -1].map(flatRotationCode)).toEqual(["LWH", "WLH", "LWH@180", "WLH@180", "LWH", "WLH@180"])
    expect(nextQuarterTurn("LWH")).toBe("WLH")
    expect(nextQuarterTurn("WLH")).toBe("LWH@180")
    expect(nextQuarterTurn("LWH@180")).toBe("WLH@180")
    expect(nextQuarterTurn("WLH@180")).toBe("LWH")
    expect(nextQuarterTurn("LHW")).toBeNull()
  })

  it("describes every code in words", () => {
    expect(["LWH", "WLH", "LWH@180", "WLH@180", "LHW", undefined].map(describeRotation)).toEqual([
      "As entered",
      "Turned 90°",
      "Turned 180°",
      "Turned 270°",
      "Tipped onto another face",
      "As entered",
    ])
  })

  it("keeps a fixed orientation from facing the other way", () => {
    expect(allowsHalfTurn("FIXED")).toBe(false)
    for (const orientation of ["LONGSHIP", "ROTATE_90", "TILTABLE", "ANY", "CUSTOM"]) expect(allowsHalfTurn(orientation)).toBe(true)
  })
})

describe("turning a piece on the floor", () => {
  it("flips a piece as entered between the two plain codes, as the Playground always did", () => {
    expect(nextFlatRotation("LWH")).toBe("WLH")
    expect(nextFlatRotation("WLH")).toBe("LWH")
    expect(nextFlatRotation(undefined)).toBe("WLH")
    expect(nextFlatRotation("LWH")).not.toContain("@")
  })

  it("keeps a piece an older plan saved with a half-turn facing going round, so its code always matches its sizes", () => {
    // Each step swaps length and width, so a step lands on the other parity of turns.
    expect(nextFlatRotation("LWH@180")).toBe("WLH@180")
    expect(nextFlatRotation("WLH@180")).toBe("LWH")
    const sequence: string[] = ["LWH@180"]
    for (let step = 0; step < 4; step++) sequence.push(nextFlatRotation(sequence.at(-1)))
    expect(sequence).toEqual(["LWH@180", "WLH@180", "LWH", "WLH", "LWH"])
    const parity = sequence.map((code) => (parseRotation(code).turns ?? 0) % 2)
    expect(parity).toEqual([0, 1, 0, 1, 0])
  })

  it("swaps the first two axes of a tipped piece, which is what a quarter turn about the vertical does", () => {
    expect(nextFlatRotation("LHW")).toBe("HLW")
    expect(nextFlatRotation("HLW")).toBe("LHW")
    expect(nextFlatRotation("???")).toBe("LWH")
  })
})
