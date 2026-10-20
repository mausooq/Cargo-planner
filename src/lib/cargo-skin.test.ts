import { describe, expect, it } from "vitest"
import { itemsOverlap, rotateItemFlat, tryDragItem, tryPlaceItem } from "./cargo-skin"
import type { PlanItemView, PlanUnitView } from "./plan-view"

function item(partial: Partial<PlanItemView> & Pick<PlanItemView, "id">): PlanItemView {
  return {
    cargoId: partial.id,
    name: "Box",
    color: "#e85d4c",
    x: 0,
    y: 0,
    z: 0,
    lengthCm: 100,
    widthCm: 80,
    heightCm: 60,
    weightKg: 10,
    sequence: 1,
    rotation: "LWH",
    shape: "BOX",
    ...partial,
  }
}

const unit = {
  lengthCm: 400,
  widthCm: 200,
  heightCm: 200,
  contour: null,
  maxPayloadKg: 1000,
  equipmentId: "u",
  equipmentName: "Box",
} as PlanUnitView

describe("playground placement", () => {
  it("moves beside a box and stacks when the footprints overlap", () => {
    const a = item({ id: "a", x: 0, y: 0 })
    const b = item({ id: "b", x: 50, y: 0 })
    expect(itemsOverlap(a, b)).toBe(true)
    expect(tryPlaceItem({ ...b, x: 120 }, [a], unit)?.x).toBe(120)
    expect(tryPlaceItem({ ...b, x: 20 }, [a], unit)?.z).toBe(60)
    expect(tryPlaceItem({ ...b, x: 50 }, [a], unit)).toBeNull()
  })

  it("stacks a box on another when the footprints overlap", () => {
    const base = item({ id: "a", x: 0, y: 0, lengthCm: 100, widthCm: 80, heightCm: 60 })
    const stacked = tryDragItem(item({ id: "b", x: 10, y: 10, lengthCm: 80, widthCm: 60, heightCm: 50 }), [base], unit)
    expect(stacked?.z).toBe(60)
    expect(itemsOverlap(base, stacked!)).toBe(false)
  })

  it("keeps a rotated piece inside the unit", () => {
    const tall = item({ id: "a", x: 350, lengthCm: 80, widthCm: 150 })
    const turned = rotateItemFlat(tall)
    expect(turned.lengthCm).toBe(150)
    expect(turned.widthCm).toBe(80)
    const placed = tryPlaceItem(turned, [], unit)
    expect(placed).toBeTruthy()
    expect(placed!.x + placed!.lengthCm).toBeLessThanOrEqual(400)
  })

  it("lets a drum sit on the side wall using its circle, not a fat box", () => {
    const drum = item({
      id: "drum",
      name: "Drum",
      shape: "CYLINDER_DRUM",
      lengthCm: 100,
      widthCm: 80,
      heightCm: 88,
    })
    const atWall = tryPlaceItem({ ...drum, x: 400 - 90, y: 0 }, [], unit)
    expect(atWall).toBeTruthy()
    expect(atWall!.x).toBeCloseTo(310, 5)
  })
})
