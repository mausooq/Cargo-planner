import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

import { clearanceViolations } from "@compass/physics"
import { updateProjectClearance } from "@/app/actions/projects"
import { snapToNeighbours } from "@/lib/cargo-snap"
import { findFreeSpot } from "@/lib/cargo-spot"
import { noteRows, summaryRows } from "@/lib/plan-export"
import { metricBoxesOf } from "@/lib/plan-metrics"
import type { PlanItemView, PlanUnitView, PlanView } from "@/lib/plan-view"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"
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
    clearanceCm: 0,
    ...extra,
  }
}

const unit = { lengthCm: 500, widthCm: 240, heightCm: 250 } as PlanUnitView

describe("snapping with a handling allowance", () => {
  it("snaps flush to a neighbour when there is no allowance (unchanged behaviour)", () => {
    const other = item("o", 0, 0)
    const snapped = snapToNeighbours(item("m", 106, 0), [other], unit, { x: true, y: false })
    expect(snapped.item.x).toBe(100)
  })

  it("snaps to exactly the shared gap, the larger allowance, when there is one", () => {
    const other = item("o", 10, 10, 0, { clearanceCm: 10 })
    const snapped = snapToNeighbours(item("m", 125, 10, 0, { clearanceCm: 6 }), [other], unit, { x: true, y: false })
    expect(snapped.item.x).toBe(120)
  })

  it("keeps the piece's own allowance from the walls", () => {
    const snapped = snapToNeighbours(item("m", 4, 5, 0, { clearanceCm: 8 }), [], unit)
    expect(snapped.item.x).toBe(8)
    expect(snapped.item.y).toBe(8)
    const far = snapToNeighbours(item("m", 395, 135, 0, { clearanceCm: 8 }), [], unit)
    expect(far.item.x).toBe(392)
    expect(far.item.y).toBe(132)
  })
})

describe("finding a free spot with a handling allowance", () => {
  it("offers a spot that keeps the allowance to walls and neighbours", () => {
    const placed = [item("a", 10, 10, 0, { clearanceCm: 10 }), item("b", 120, 10, 0, { clearanceCm: 10 })]
    const spot = findFreeSpot(item("c", 0, 0, 0, { clearanceCm: 10 }), placed, unit)
    expect(spot).not.toBeNull()
    expect(clearanceViolations(metricBoxesOf([...placed, spot!]), unit)).toEqual([])
  })

  it("returns null when the allowance leaves no room", () => {
    const tight = { lengthCm: 120, widthCm: 120, heightCm: 100 } as PlanUnitView
    const only = item("a", 10, 10, 0, { clearanceCm: 10, heightCm: 100 })
    expect(findFreeSpot(item("b", 0, 0, 0, { clearanceCm: 10 }), [only], tight)).toBeNull()
  })

  it("still places pieces tightly when there is no allowance", () => {
    const spot = findFreeSpot(item("c", 0, 0, 0), [item("a", 0, 0), item("b", 100, 0)], unit)
    expect(spot).not.toBeNull()
    expect(spot!.z).toBe(0)
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
  const cargo = [
    { id: "a", name: "A", lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1, quantity: 1, shape: "BOX", orientation: "ANY", allowedRotations: null, stackable: true, bottomOnly: false, maxStackLoadKg: null, maxStackLayers: null, priority: 0, destinationStop: 1, consignmentId: null, segregationClass: null, color: null, sku: null, updatedAt: "", clearanceCm: 3 },
    { id: "b", name: "B", lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1, quantity: 1, shape: "BOX", orientation: "ANY", allowedRotations: null, stackable: true, bottomOnly: false, maxStackLoadKg: null, maxStackLayers: null, priority: 0, destinationStop: 1, consignmentId: null, segregationClass: null, color: null, sku: null, updatedAt: "" },
  ]

  it("passes the project default and each line's override", () => {
    const input = buildSolverInput({ cargo: cargo as never, equipment: equipment as never, objective: "FEWEST_UNITS", clearanceCm: 6 })
    expect(input.settings?.clearanceCm).toBe(6)
    expect(input.cargo.map((line) => line.clearanceCm)).toEqual([3, null])
  })

  it("defaults to no allowance", () => {
    const input = buildSolverInput({ cargo: cargo as never, equipment: equipment as never, objective: "FEWEST_UNITS" })
    expect(input.settings?.clearanceCm).toBe(0)
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
    floorActualPct: 16.7,
    floorEffectivePct: 23,
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
  const plan = { clearanceCm: 10, seed: 1, elapsedMs: 1, totalCost: 0, warnings: [], units: [unitView], unloaded: [] } as PlanView

  it("exports both floor columns and the remaining capacity", () => {
    expect(summaryRows(plan)[0]).toMatchObject({
      "Actual floor utilization (%)": 16.7,
      "Effective floor utilization (%)": 23,
      "Remaining payload (kg)": 800,
      "Remaining volume (m³)": 28,
    })
  })

  it("explains the metrics, the allowance and the axle estimate on the notes sheet", () => {
    const notes = noteRows(plan)
    expect(notes.map((row) => row.Topic)).toEqual(["Actual floor utilization", "Effective floor utilization", "Handling allowance", "Axle loads", "Units"])
    expect(notes[2]!.Note).toMatch(/Project default 10 cm per side/)
    expect(notes[3]!.Note).toMatch(/not a verified axle weighing/)
    expect(noteRows({ clearanceCm: 0 })[2]!.Note).toMatch(/Project default none/)
  })

  it("an old plan without the new fields still exports, with effective equal to actual", () => {
    const old = { ...unitView, floorActualPct: undefined, floorEffectivePct: undefined, remainingKg: undefined, remainingM3: undefined } as unknown as PlanUnitView
    const row = summaryRows({ ...plan, units: [old] })[0]!
    expect(row["Actual floor utilization (%)"]).toBe(16.7)
    expect(row["Effective floor utilization (%)"]).toBe(16.7)
    expect(row["Remaining payload (kg)"]).toBe(800)
  })
})

describe("updateProjectClearance", () => {
  const requireUserMock = vi.mocked(requireUser)
  const db = vi.mocked(prisma, true)

  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({ id: "u", role: "PLANNER", orgId: "o", orgName: "O", name: "N", email: "e@x" } as never)
  })

  it("stores the allowance in the project rules and keeps the other rules", async () => {
    db.project.findFirst.mockResolvedValue({ id: "p1", rules: { other: true } } as never)
    const result = await updateProjectClearance("p1", 7.25)
    expect(result.ok).toBe(true)
    expect(db.project.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { rules: { other: true, clearanceCm: 7.3 } } })
  })

  it("accepts zero to switch the allowance off", async () => {
    db.project.findFirst.mockResolvedValue({ id: "p1", rules: { clearanceCm: 5 } } as never)
    await updateProjectClearance("p1", 0)
    expect(db.project.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { rules: { clearanceCm: 0 } } })
  })

  it("rejects values that are negative, too large or not numbers", async () => {
    for (const value of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect((await updateProjectClearance("p1", value)).ok).toBe(false)
    }
    expect(db.project.update).not.toHaveBeenCalled()
  })

  it("is refused for viewers and for projects of another organization", async () => {
    requireUserMock.mockResolvedValue({ id: "u", role: "VIEWER", orgId: "o", orgName: "O", name: "N", email: "e@x" } as never)
    expect((await updateProjectClearance("p1", 5)).ok).toBe(false)
    requireUserMock.mockResolvedValue({ id: "u", role: "PLANNER", orgId: "o", orgName: "O", name: "N", email: "e@x" } as never)
    db.project.findFirst.mockResolvedValue(null as never)
    expect((await updateProjectClearance("p1", 5)).ok).toBe(false)
    expect(db.project.update).not.toHaveBeenCalled()
  })
})
