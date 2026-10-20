import { describe, expect, it } from "vitest"
import { fromDisplayLength, roundDisplayLength, toDisplayLength } from "./cargo-units"

describe("cargo length units", () => {
  it("converts inches and metres to centimetres and back", () => {
    expect(fromDisplayLength(1, "in")).toBeCloseTo(2.54)
    expect(fromDisplayLength(1.2, "m")).toBeCloseTo(120)
    expect(toDisplayLength(254, "in")).toBeCloseTo(100)
    expect(toDisplayLength(120, "m")).toBeCloseTo(1.2)
    expect(toDisplayLength(80, "cm")).toBe(80)
  })

  it("rounds display values by unit", () => {
    expect(roundDisplayLength(12.34, "cm")).toBe(12.3)
    expect(roundDisplayLength(12.345, "in")).toBe(12.35)
    expect(roundDisplayLength(1.2346, "m")).toBe(1.235)
  })
})
