import { describe, expect, it } from "vitest"
import { applyGravity } from "@/lib/cargo-gravity"
import type { PlanItemView } from "@/lib/plan-view"

const unit = { lengthCm: 590, widthCm: 235, heightCm: 239 }

function box(id: string, x: number, y: number, z: number, size: [number, number, number] = [50, 50, 50]): PlanItemView {
  return {
    id,
    cargoId: id,
    name: id,
    color: "#be123c",
    x,
    y,
    z,
    lengthCm: size[0],
    widthCm: size[1],
    heightCm: size[2],
    weightKg: 10,
    sequence: 1,
    rotation: "LWH",
    shape: "BOX",
  }
}

describe("applyGravity", () => {
  it("drops a box to the floor when the box under it is moved away", () => {
    // The box that held "top" up has been dragged 200 cm along.
    const result = applyGravity([box("moved", 200, 0, 0), box("top", 0, 0, 50)], unit)
    expect(result.fell).toEqual(["top"])
    expect(result.items.find((item) => item.id === "top")?.z).toBe(0)
  })

  it("brings a whole stack down one level, keeping its order", () => {
    // Bottom box removed from a stack of three: the two above drop by 50 cm each.
    const result = applyGravity([box("middle", 0, 0, 50), box("upper", 0, 0, 100)], unit)
    expect(result.items.map((item) => [item.id, item.z])).toEqual([
      ["middle", 0],
      ["upper", 50],
    ])
  })

  it("lands a falling box on the next piece below, not always the floor", () => {
    const result = applyGravity([box("low", 0, 0, 0, [50, 50, 30]), box("floating", 0, 0, 120)], unit)
    expect(result.items.find((item) => item.id === "floating")?.z).toBe(30)
  })

  it("leaves resting pieces untouched and returns the same array when nothing falls", () => {
    const items = [box("a", 0, 0, 0), box("b", 0, 0, 50)]
    const result = applyGravity(items, unit)
    expect(result.fell).toEqual([])
    expect(result.items).toBe(items)
  })
})
