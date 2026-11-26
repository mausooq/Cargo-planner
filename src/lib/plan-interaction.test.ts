import { describe, expect, it } from "vitest"
import { snapToNeighbours } from "@/lib/cargo-snap"
import { findFreeSpot } from "@/lib/cargo-spot"
import { noteRows, summaryRows } from "@/lib/plan-export"
import type { PlanItemView, PlanUnitView, PlanView } from "@/lib/plan-view"
import { buildSolverInput } from "@/lib/solver-input"

function item(id: string, x: number, y: number, z = 0, extra: Partial<PlanItemView> = {}): PlanItemView {
  return {
    id,
    cargoId: id,
    name: id,
    color: "#000",
    x,
    y,
    z,
    lengthCm: 100,
    widthCm: 100,
    heightCm: 100,
    weightKg: 20,
    sequence: 1,
    rotation: "LWH",
    shape: "BOX",
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
    ...extra,
  }
}

const unit = { lengthCm: 500, widthCm: 240, heightCm: 250 } as PlanUnitView

describe("snapping to neighbours and walls", () => {
  it("snaps flush to a neighbour", () => {
    const other = item("o", 0, 0)
    const snapped = snapToNeighbours(item("m", 106, 0), [other], unit, { x: true, y: false })
    expect(snapped.item.x).toBe(100)
  })
})

describe("finding a free spot", () => {
  it("places pieces tightly", () => {
    const spot = findFreeSpot(item("c", 0, 0, 0), [item("a", 0, 0), item("b", 100, 0)], unit)
    expect(spot).not.toBeNull()
    expect(spot!.z).toBe(0)
  })

  it("returns null when there is no room anywhere", () => {
    const tight = { lengthCm: 100, widthCm: 100, heightCm: 100 } as PlanUnitView
    expect(findFreeSpot(item("b", 0, 0, 0), [item("a", 0, 0)], tight)).toBeNull()
  })

  it("keeps a piece in place when its own spot is still free", () => {
    const spot = findFreeSpot(item("c", 200, 0, 0), [item("a", 0, 0)], unit)
    expect([spot?.x, spot?.y]).toEqual([200, 0])
  })
})

describe("solver input", () => {
  const equipment = [
    {
      id: "eq",
      name: "Box",
      innerLengthCm: 500,
      innerWidthCm: 240,
      innerHeightCm: 250,
      maxPayloadKg: 1000,
      tareKg: 0,
      axleGroups: [],
      costPerUnit: 1,
      maxCount: 1,
      contour: null,
    },
  ]
  // A line carrying the retired clearance fields, as a project saved by an earlier version can still hold in memory.
  const cargo = [
    { id: "a", name: "A", lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1, quantity: 1, shape: "BOX", orientation: "ANY", allowedRotations: null, stackable: true, bottomOnly: false, maxStackLoadKg: null, maxStackLayers: null, priority: 0, destinationStop: 1, consignmentId: null, segregationClass: null, color: null, sku: null, updatedAt: "", clearanceCm: 3, clearanceSides: { front: 1, rear: 1, left: 1, right: 1 } },
    { id: "b", name: "B", lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1, quantity: 1, shape: "BOX", orientation: "ANY", allowedRotations: null, stackable: true, bottomOnly: false, maxStackLoadKg: null, maxStackLayers: null, priority: 0, destinationStop: 1, consignmentId: null, segregationClass: null, color: null, sku: null, updatedAt: "" },
  ]

  it("passes the cargo and the support share to the packer, and nothing about clearance", () => {
    const input = buildSolverInput({ cargo: cargo as never, equipment: equipment as never, objective: "FEWEST_UNITS", minSupportPct: 80 })
    expect(input.cargo.map((line) => line.id)).toEqual(["a", "b"])
    expect(input.settings?.minSupportRatio).toBe(0.8)
    expect(JSON.stringify(input)).not.toMatch(/clearance/i)
  })

  it("uses the shared support default when the project has none", () => {
    const input = buildSolverInput({ cargo: cargo as never, equipment: equipment as never, objective: "FEWEST_UNITS" })
    expect(input.settings?.minSupportRatio).toBe(0.75)
  })
})

describe("reports", () => {
  const unitView = {
    unitIndex: 0,
    equipmentId: "eq",
    equipmentName: "Box",
    equipmentMode: "SEA",
    oogClass: "NONE",
    heightOpen: false,
    contour: null,
    lengthCm: 500,
    widthCm: 240,
    heightCm: 250,
    maxPayloadKg: 1000,
    pieces: 2,
    netKg: 200,
    grossKg: 300,
    volumeM3: 2,
    volumePct: 6.7,
    floorPct: 16.7,
    weightPct: 20,
    remainingKg: 800,
    remainingM3: 28,
    tareKg: 100,
    usedLengthCm: 220,
    usedWidthCm: 100,
    usedHeightCm: 100,
    cog: { x: 0, y: 0, z: 0 },
    axleLoads: [],
    items: [],
  } as PlanUnitView
  const plan = { seed: 1, elapsedMs: 1, totalCost: 0, warnings: [], units: [unitView], unloaded: [] } as PlanView

  it("exports one floor column and the remaining capacity", () => {
    const row = summaryRows(plan)[0]!
    expect(row).toMatchObject({ "Floor utilization (%)": 16.7, "Remaining payload (kg)": 800, "Remaining volume (m³)": 28 })
    expect(Object.keys(row).filter((key) => /floor/i.test(key))).toEqual(["Floor utilization (%)"])
  })

  it("an old plan without the remaining-capacity figures still exports", () => {
    const old = { ...unitView, remainingKg: undefined, remainingM3: undefined } as unknown as PlanUnitView
    const row = summaryRows({ ...plan, units: [old] })[0]!
    expect(row["Floor utilization (%)"]).toBe(16.7)
    expect(row["Remaining payload (kg)"]).toBe(800)
  })

  it("explains the floor figure, the axle estimate and the units on the notes sheet, with nothing about allowances", () => {
    const notes = noteRows()
    expect(notes.map((row) => row.Topic)).toEqual(["Floor utilization", "Axle loads", "Units"])
    expect(notes[1]!.Note).toMatch(/not a verified axle weighing/)
    expect(JSON.stringify(notes)).not.toMatch(/clearance|allowance/i)
  })
})
