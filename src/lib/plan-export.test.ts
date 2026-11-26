import { describe, expect, it } from "vitest"
import { exportFileName, loadOrder, packingRows, summaryRows, unloadedRows } from "@/lib/plan-export"
import type { PlanItemView, PlanUnitView, PlanView } from "@/lib/plan-view"

function item(id: string, sequence: number, x: number, z = 0): PlanItemView {
  return {
    id,
    cargoId: id.split("-")[0] ?? id,
    name: `Box ${id}`,
    color: "#2563eb",
    x,
    y: 0,
    z,
    lengthCm: 100,
    widthCm: 80,
    heightCm: 60,
    weightKg: 12.345,
    sequence,
    rotation: "LWH",
    shape: "BOX",
  }
}

function unit(items: PlanItemView[]): PlanUnitView {
  return {
    unitIndex: 0,
    equipmentId: "eq",
    equipmentName: "20' Dry",
    equipmentMode: "SEA",
    oogClass: "NONE",
    heightOpen: false,
    contour: null,
    lengthCm: 590,
    widthCm: 235,
    heightCm: 239,
    maxPayloadKg: 28000,
    pieces: items.length,
    netKg: 24.69,
    grossKg: 24.69,
    volumeM3: 0.96,
    volumePct: 2.9,
    floorPct: 11.54,
    remainingKg: 27975.31,
    remainingM3: 0,
    tareKg: 0,
    weightPct: 0.09,
    usedLengthCm: 200,
    usedWidthCm: 80,
    usedHeightCm: 60,
    cog: { x: 0, y: 0, z: 0 },
    axleLoads: [],
    items,
  }
}

const plan: PlanView = {
  seed: 1,
  elapsedMs: 10,
  totalCost: 0,
  warnings: [],
  units: [unit([item("b-0", 2, 100), item("a-0", 1, 0)])],
  unloaded: [{ cargoId: "c", name: "Big crate", reason: "TOO_LARGE", detail: "Longer than any unit." }],
}

describe("plan export rows", () => {
  it("orders pieces by load sequence", () => {
    expect(loadOrder(plan.units[0]!).map((row) => row.id)).toEqual(["a-0", "b-0"])
  })

  it("builds one packing row per piece with rounded numbers", () => {
    const rows = packingRows(plan)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ Unit: "1. 20' Dry", "Load order": 1, Cargo: "Box a-0", "Weight (kg)": 12.3 })
  })

  it("summarises each unit", () => {
    expect(summaryRows(plan)[0]).toMatchObject({ Unit: "1", Pieces: 2, "Floor utilization (%)": 11.5 })
  })

  it("lists unloaded cargo with its reason", () => {
    expect(unloadedRows(plan)).toEqual([{ Cargo: "Big crate", Reason: "Longer than any unit." }])
  })

  it("makes a safe file name", () => {
    expect(exportFileName("Jebel Ali / March", "xlsx")).toBe("Jebel-Ali-March-load-plan.xlsx")
    expect(exportFileName("  ", "xlsx")).toBe("load-plan.xlsx")
  })
})
