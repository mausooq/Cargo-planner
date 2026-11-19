import { describe, expect, it } from "vitest"
import { cargoTotals, checkCargoLine, isPlannable } from "@/lib/cargo-validation"

const base = {
  name: "Crate",
  lengthCm: 120,
  widthCm: 80,
  heightCm: 100,
  weightKg: 250,
  quantity: 2,
  priority: 0,
  destinationStop: 1,
}

describe("checkCargoLine", () => {
  it("accepts a complete line", () => {
    expect(checkCargoLine(base)).toEqual({ errors: {}, missing: {} })
    expect(isPlannable(base)).toBe(true)
  })

  it("flags blank name and zero sizes as missing, not as errors", () => {
    const result = checkCargoLine({ ...base, name: " ", heightCm: 0, weightKg: 0 })
    expect(result.errors).toEqual({})
    expect(Object.keys(result.missing).sort()).toEqual(["heightCm", "name", "weightKg"])
    expect(isPlannable({ ...base, name: "" })).toBe(false)
  })

  it("rejects negative sizes, fractional quantity, and stop 0", () => {
    const result = checkCargoLine({ ...base, lengthCm: -1, quantity: 1.5, destinationStop: 0 })
    expect(Object.keys(result.errors).sort()).toEqual(["destinationStop", "lengthCm", "quantity"])
  })
})

describe("cargoTotals", () => {
  it("multiplies weight and volume by quantity", () => {
    expect(cargoTotals([base, { ...base, quantity: 1 }])).toEqual({ pieces: 3, weightKg: 750, volumeM3: 2.88 })
  })

  it("ignores invalid quantities", () => {
    expect(cargoTotals([{ ...base, quantity: 0 }]).pieces).toBe(0)
  })
})
