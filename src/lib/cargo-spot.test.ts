import { describe, expect, it } from "vitest"
import { itemsOverlap } from "@/lib/cargo-skin"
import { findFreeSpot } from "@/lib/cargo-spot"
import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"

function box(partial: Partial<PlanItemView> & Pick<PlanItemView, "id">): PlanItemView {
  return {
    cargoId: partial.id,
    name: partial.id,
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

describe("findFreeSpot", () => {
  it("puts a piece back exactly where it was when that spot is still free", () => {
    const spot = findFreeSpot(box({ id: "back", x: 200, y: 100 }), [box({ id: "other" })], unit)
    expect(spot).toMatchObject({ x: 200, y: 100, z: 0 })
  })

  it("finds the nearest free floor spot when the original one was taken", () => {
    const blocker = box({ id: "blocker", x: 200, y: 100 })
    const spot = findFreeSpot(box({ id: "back", x: 200, y: 100 }), [blocker], unit)
    expect(spot).not.toBeNull()
    expect(spot?.z).toBe(0)
    expect(itemsOverlap(spot as PlanItemView, blocker)).toBe(false)
    // Nearest the front first.
    expect(spot?.x).toBe(0)
  })

  it("stacks on top when the floor is full", () => {
    // Fill the 400 × 200 floor with 100 × 100 boxes.
    const floor: PlanItemView[] = []
    for (let x = 0; x < 400; x += 100) for (let y = 0; y < 200; y += 100) floor.push(box({ id: `f${x}-${y}`, x, y, widthCm: 100 }))
    const spot = findFreeSpot(box({ id: "back", widthCm: 100 }), floor, unit)
    expect(spot?.z).toBe(60)
  })

  it("turns the piece 90° if that is the only way it fits", () => {
    // A 190 × 60 piece only fits lengthwise along a narrow 400 × 70 strip once turned... use a strip unit.
    const strip = { ...unit, lengthCm: 200, widthCm: 190 } as PlanUnitView
    const long = box({ id: "long", lengthCm: 190, widthCm: 60, heightCm: 150 })
    // Leave only a 60 cm wide lane along the length: block the rest of the floor up to the roof.
    const wall = box({ id: "wall", x: 0, y: 0, lengthCm: 140, widthCm: 190, heightCm: 200 })
    const spot = findFreeSpot(long, [wall], strip)
    expect(spot).toMatchObject({ lengthCm: 60, widthCm: 190, x: 140 })
  })

  it("returns null when there is no room anywhere", () => {
    const full = box({ id: "full", lengthCm: 400, widthCm: 200, heightCm: 200 })
    expect(findFreeSpot(box({ id: "back" }), [full], unit)).toBeNull()
  })
})
