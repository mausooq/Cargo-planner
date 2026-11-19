import { describe, expect, it } from "vitest"
import { pieceBelow, snapToNeighbours, snapToStack } from "@/lib/cargo-snap"
import type { PlanItemView } from "@/lib/plan-view"

function box(id: string, x: number, y: number, z: number, size: [number, number, number] = [50, 50, 50]): PlanItemView {
  return {
    id,
    cargoId: id,
    name: id,
    color: "#2563eb",
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

describe("snapToStack", () => {
  it("puts a same-size box exactly on top when dropped a little off", () => {
    const below = box("below", 100, 40, 0)
    const result = snapToStack(box("moving", 108, 33, 0), [below])
    expect(result.target?.id).toBe("below")
    expect(result.item).toMatchObject({ x: 100, y: 40 })
  })

  it("leaves the box alone when it is far from lining up", () => {
    const below = box("below", 100, 40, 0)
    const result = snapToStack(box("moving", 125, 40, 0), [below])
    expect(result.item.x).toBe(125)
    expect(result.item.y).toBe(40)
  })

  it("centres or makes flush a smaller box on a bigger one, whichever is closer", () => {
    const pallet = box("pallet", 0, 0, 0, [120, 80, 15])
    // 40 cm box near the centre of a 120 cm pallet: centre is x = 40.
    expect(snapToStack(box("m", 44, 18, 0, [40, 40, 40]), [pallet]).item).toMatchObject({ x: 40, y: 20 })
    // Near the right edge: flush right is x = 80.
    expect(snapToStack(box("m", 77, 3, 0, [40, 40, 40]), [pallet]).item).toMatchObject({ x: 80, y: 0 })
  })

  it("only moves the axes the camera lets you drag", () => {
    const below = box("below", 100, 40, 0)
    const result = snapToStack(box("moving", 108, 33, 0), [below], { x: true, y: false })
    expect(result.item).toMatchObject({ x: 100, y: 33 })
  })

  it("does nothing on an empty floor", () => {
    expect(snapToStack(box("moving", 10, 10, 0), []).target).toBeNull()
  })
})

describe("pieceBelow", () => {
  it("aims at the box mostly underneath, not a taller neighbour it barely clips", () => {
    const target = box("target", 100, 0, 0, [80, 100, 60])
    const tallDrum = box("drum", 20, 0, 0, [80, 100, 80])
    // Dragged 8 cm too far toward the drum: 8 cm of overlap with it, 72 cm with the target.
    const moving = box("m", 92, 0, 0, [80, 100, 60])
    expect(pieceBelow(moving, [target, tallDrum])?.id).toBe("target")
    expect(snapToStack(moving, [target, tallDrum]).item.x).toBe(100)
  })

  it("picks the highest piece under the footprint (where it will settle)", () => {
    const floor = box("floor", 0, 0, 0)
    const stacked = box("stacked", 0, 0, 50)
    expect(pieceBelow(box("m", 10, 10, 0), [floor, stacked])?.id).toBe("stacked")
  })
})

describe("snapToNeighbours", () => {
  const room = { lengthCm: 590, widthCm: 235 }

  it("slides a box flush against the neighbour in the same row", () => {
    const neighbour = box("neighbour", 100, 0, 0)
    // Dropped 6 cm short of touching (neighbour ends at 150).
    const result = snapToNeighbours(box("m", 156, 0, 0), [neighbour], room)
    expect(result.item.x).toBe(150)
    expect(result.against).toBe("neighbour")
  })

  it("closes a small overlap by pushing it flush, too", () => {
    const result = snapToNeighbours(box("m", 146, 0, 0), [box("neighbour", 100, 0, 0)], room)
    expect(result.item.x).toBe(150)
  })

  it("snaps against the walls", () => {
    expect(snapToNeighbours(box("m", 7, 60, 0), [], room)).toMatchObject({ item: { x: 0 }, against: "the wall" })
    expect(snapToNeighbours(box("m", 300, 180, 0), [], room).item.y).toBe(185) // 235 - 50
  })

  it("ignores boxes in another row or on another level", () => {
    const otherRow = box("other-row", 100, 120, 0) // y 120–170, dragged box is y 0–50
    const upstairs = box("upstairs", 100, 0, 100)
    expect(snapToNeighbours(box("m", 156, 0, 0), [otherRow, upstairs], room).item.x).toBe(156)
  })

  it("leaves the box alone when nothing is close", () => {
    const result = snapToNeighbours(box("m", 300, 100, 0), [box("far", 0, 0, 0)], room)
    expect(result).toMatchObject({ against: null })
    expect(result.item).toMatchObject({ x: 300, y: 100 })
  })
})
