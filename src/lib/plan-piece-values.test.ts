import { describe, expect, it } from "vitest"
import { formatEnteredLength, formatEnteredWeight, pieceValues, type EnteredCargo } from "@/lib/plan-piece-values"
import type { PlanItemView } from "@/lib/plan-view"

const press: EnteredCargo = {
  id: "c1",
  sku: "RHPP50",
  name: "Hydraulic press machine 50 T",
  lengthCm: 137.16,
  widthCm: 167.64,
  heightCm: 304.8,
  weightKg: 2750,
}

function placed(overrides: Partial<PlanItemView> = {}): PlanItemView {
  return {
    id: "c1-0",
    cargoId: "c1",
    name: "Hydraulic press machine 50 T",
    color: "#2563eb",
    x: 0,
    y: 0,
    z: 0,
    lengthCm: 137.16,
    widthCm: 167.64,
    heightCm: 304.8,
    weightKg: 2750,
    sequence: 1,
    rotation: "LWH",
    shape: "BOX",
    ...overrides,
  }
}

const cargo = new Map([[press.id, press]])

describe("values shown for a loaded piece", () => {
  it("shows the cargo line's own values and mark", () => {
    expect(pieceValues(placed(), cargo)).toEqual({
      sku: "RHPP50",
      name: "Hydraulic press machine 50 T",
      lengthCm: 137.16,
      widthCm: 167.64,
      heightCm: 304.8,
      weightKg: 2750,
      turned: false,
    })
  })

  it("keeps the entered order when the piece was turned on the floor, and says so", () => {
    const values = pieceValues(placed({ lengthCm: 167.64, widthCm: 137.16, rotation: "WLH" }), cargo)
    expect(values).toMatchObject({ lengthCm: 137.16, widthCm: 167.64, heightCm: 304.8, turned: true })
  })

  it("falls back to the placed values when the cargo line no longer exists", () => {
    const values = pieceValues(placed({ cargoId: "gone", sku: "OLD-1", lengthCm: 100 }), cargo)
    expect(values).toMatchObject({ sku: "OLD-1", lengthCm: 100, turned: false })
  })
})

describe("writing the values like the cargo table", () => {
  it("shows sizes with at most one decimal and no padding", () => {
    expect(formatEnteredLength(304.8)).toBe("304.8")
    expect(formatEnteredLength(137.16)).toBe("137.2")
    expect(formatEnteredLength(96)).toBe("96")
  })

  it("shows weights exactly as typed", () => {
    expect(formatEnteredWeight(1141.6665)).toBe("1141.6665")
    expect(formatEnteredWeight(2750)).toBe("2750")
  })
})
