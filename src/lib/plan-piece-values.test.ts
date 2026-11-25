import { describe, expect, it } from "vitest"
import { formatEnteredLength, formatEnteredWeight, lengthTitle, pieceValues, turnedTitle, type EnteredCargo } from "@/lib/plan-piece-values"
import { rotateItemFlat } from "@/lib/cargo-skin"
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
    expect(pieceValues(placed(), cargo)).toMatchObject({
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

describe("values in the chosen display unit", () => {
  it("writes the same stored size in each unit without changing it", () => {
    expect(formatEnteredLength(304.8, "cm")).toBe("304.8")
    expect(formatEnteredLength(304.8, "ft")).toBe("10")
    expect(formatEnteredLength(137.16, "ft")).toBe("4.5")
    expect(formatEnteredLength(137.16, "in")).toBe("54")
    expect(formatEnteredLength(137.16, "m")).toBe("1.372")
    expect(formatEnteredLength(137.16, "mm")).toBe("1371.6")
  })

  it("keeps 5.6 ft and 5 ft 6 in apart: 170.688 cm is 5.6 ft, 167.64 cm is 5.5 ft", () => {
    expect(formatEnteredLength(170.688, "ft")).toBe("5.6")
    expect(formatEnteredLength(167.64, "ft")).toBe("5.5")
  })

  it("titles follow the unit, and weight keeps its own", () => {
    expect(lengthTitle("L", "ft")).toBe("L (ft)")
    expect(lengthTitle("W", "in")).toBe("W (in)")
    expect(formatEnteredWeight(2750)).toBe("2750")
  })

  it("the Turned tooltip names the selected unit, never a hard-coded one", () => {
    const item = { lengthCm: 167.64, widthCm: 137.16, heightCm: 304.8 }
    expect(turnedTitle(item, "Turned 90°", "ft")).toMatch(/ ft in the unit$/)
    expect(turnedTitle(item, "Turned 90°", "ft")).not.toMatch(/cm/)
    expect(turnedTitle(item, "Turned 90°", "cm")).toMatch(/cm in the unit$/)
    expect(turnedTitle(item, "Turned 90°", "ft")).toContain("5.5 × 4.5 × 10 ft")
  })
})

describe("rotation and facing codes", () => {
  it("a half turn keeps the sizes, so the facing code alone says it was turned", () => {
    const values = pieceValues(placed({ rotation: "LWH@180" }), cargo)
    expect(values).toMatchObject({ lengthCm: 137.16, widthCm: 167.64, turned: true, facing: "Turned 180°" })
  })

  it("a quarter turn and three quarters read back to the entered order", () => {
    const swapped = { lengthCm: 167.64, widthCm: 137.16 }
    expect(pieceValues(placed({ ...swapped, rotation: "WLH" }), cargo)).toMatchObject({ lengthCm: 137.16, widthCm: 167.64, turned: true, facing: "Turned 90°" })
    expect(pieceValues(placed({ ...swapped, rotation: "WLH@180" }), cargo)).toMatchObject({ lengthCm: 137.16, widthCm: 167.64, turned: true, facing: "Turned 270°" })
  })

  it("as entered is not turned and has no facing", () => {
    expect(pieceValues(placed(), cargo)).toMatchObject({ turned: false, facing: null })
  })

  it("a tipped piece is read back through its axes", () => {
    // entered L along x, H along y, W along z
    const tipped = placed({ lengthCm: 137.16, widthCm: 304.8, heightCm: 167.64, rotation: "LHW" })
    expect(pieceValues(tipped, cargo)).toMatchObject({ lengthCm: 137.16, widthCm: 167.64, heightCm: 304.8, turned: true, facing: "Tipped onto another face" })
  })

  it("an unreadable code is shown as placed and not called turned", () => {
    expect(pieceValues(placed({ rotation: "???" }), cargo)).toMatchObject({ lengthCm: 137.16, widthCm: 167.64, heightCm: 304.8, turned: false })
  })

  it("stays correct after the Playground turns a piece, including a directional one", () => {
    const plain = rotateItemFlat(placed())
    expect(pieceValues(plain, cargo)).toMatchObject({ lengthCm: 137.16, widthCm: 167.64, turned: true })
    let piece = placed({ clearance: { front: 5, rear: 0, left: 0, right: 0 } })
    const seen: string[] = []
    for (let turn = 0; turn < 4; turn++) {
      piece = rotateItemFlat(piece)
      const values = pieceValues(piece, cargo)
      expect(values).toMatchObject({ lengthCm: 137.16, widthCm: 167.64, heightCm: 304.8 })
      seen.push(`${piece.rotation}:${values.turned}`)
    }
    expect(seen).toEqual(["WLH:true", "LWH@180:true", "WLH@180:true", "LWH:false"])
  })
})

describe("plans that are out of date", () => {
  const edited: EnteredCargo = { ...press, lengthCm: 200, widthCm: 90, heightCm: 100, weightKg: 1 }
  const editedCargo = new Map([[edited.id, edited]])

  it("shows what was calculated, not the cargo list as it is now", () => {
    const values = pieceValues(placed(), editedCargo, { planCurrent: false })
    expect(values).toMatchObject({ lengthCm: 137.16, widthCm: 167.64, heightCm: 304.8, weightKg: 2750, source: "plan" })
  })

  it("a line edited after the calculation never replaces the saved sizes, even when the plan is not flagged", () => {
    expect(pieceValues(placed(), editedCargo)).toMatchObject({ lengthCm: 137.16, weightKg: 2750, source: "plan" })
  })

  it("a current plan uses the exact typed values from the cargo line", () => {
    expect(pieceValues(placed(), cargo)).toMatchObject({ source: "entered", sku: "RHPP50" })
  })

  it("an out-of-date plan keeps the name and mark it was packed with", () => {
    const renamed = new Map([[press.id, { ...press, name: "Renamed", sku: "NEW" }]])
    expect(pieceValues(placed({ sku: "OLD" }), renamed, { planCurrent: false })).toMatchObject({ name: "Hydraulic press machine 50 T", sku: "OLD" })
  })

  it("a missing cargo line falls back to the saved piece and still reports a turn", () => {
    const gone = placed({ cargoId: "gone", lengthCm: 167.64, widthCm: 137.16, rotation: "WLH" })
    expect(pieceValues(gone, cargo)).toMatchObject({ lengthCm: 137.16, widthCm: 167.64, turned: true, source: "plan" })
  })
})
