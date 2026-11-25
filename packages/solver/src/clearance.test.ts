import { clearanceViolations, floorUtilization, type PlanBox } from "@compass/physics"
import { describe, expect, it } from "vitest"
import { solve } from "./solve"
import type { PlannedUnit, SolverCargo, SolverEquipment } from "./types"
import { computeUnitMetrics, layoutWarnings } from "./unit-metrics"

const trailer: SolverEquipment = {
  id: "tr",
  name: "Trailer",
  lengthCm: 600,
  widthCm: 240,
  heightCm: 250,
  maxPayloadKg: 20000,
  tareKg: 5000,
  axleGroups: [],
  costPerUnit: 100,
  maxCount: null,
}

function cargo(partial: Partial<SolverCargo> & Pick<SolverCargo, "id">): SolverCargo {
  return {
    name: partial.id,
    lengthCm: 117,
    widthCm: 77,
    heightCm: 90,
    weightKg: 100,
    quantity: 1,
    shape: "BOX",
    orientation: "ROTATE_90",
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
    maxStackLayers: null,
    priority: 0,
    destinationStop: 1,
    consignmentId: null,
    segregationClass: null,
    color: null,
    ...partial,
  }
}

function boxesOf(unit: PlannedUnit, clearanceOf: (id: string) => number): PlanBox[] {
  return unit.placements.map((p) => ({
    id: `${p.cargoId}-${p.instanceIndex}`,
    x: p.x,
    y: p.y,
    z: p.z,
    l: p.lengthCm,
    w: p.widthCm,
    h: p.heightCm,
    clearanceCm: clearanceOf(p.cargoId),
  }))
}

describe("solver with handling clearance", () => {
  it("is unchanged when the allowance is 0 or not given", () => {
    const lines = [cargo({ id: "a", quantity: 9 }), cargo({ id: "b", lengthCm: 83.3, widthCm: 41.7, quantity: 6 })]
    const base = solve({ equipment: [trailer], cargo: lines, settings: { restarts: 6 } })
    const zero = solve({ equipment: [trailer], cargo: lines, settings: { restarts: 6, clearanceCm: 0 } })
    expect(zero.units).toEqual(base.units)
    expect(zero.unloaded).toEqual(base.unloaded)
    const metrics = base.units[0]!.metrics
    expect(metrics.floorEffectivePct).toBe(metrics.floorActualPct)
    expect(metrics.floorPct).toBe(metrics.floorActualPct)
  })

  it("keeps the allowance to every wall and neighbour", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [cargo({ id: "a", quantity: 14 })],
      settings: { restarts: 6, clearanceCm: 8 },
    })
    expect(result.unloaded).toEqual([])
    for (const unit of result.units) {
      expect(clearanceViolations(boxesOf(unit, () => 8), trailer)).toEqual([])
    }
  })

  it("puts the first piece exactly one allowance from the corner", () => {
    const result = solve({ equipment: [trailer], cargo: [cargo({ id: "a" })], settings: { clearanceCm: 12 } })
    const only = result.units[0]!.placements[0]!
    expect(only.x).toBe(12)
    expect(only.y).toBe(12)
  })

  it("reports a larger effective than actual floor use, and both from the saved layout", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [cargo({ id: "a", quantity: 8 })],
      settings: { restarts: 4, clearanceCm: 5 },
    })
    const unit = result.units[0]!
    expect(unit.metrics.floorEffectivePct).toBeGreaterThan(unit.metrics.floorActualPct)
    const floor = floorUtilization(boxesOf(unit, () => 5), trailer)
    const tenth = (value: number) => Math.round(value * 10) / 10
    expect(unit.metrics.floorActualPct).toBe(tenth(floor.actualPct))
    expect(unit.metrics.floorEffectivePct).toBe(tenth(floor.effectivePct))
  })

  it("lets a cargo line override the project default, with the larger allowance deciding shared gaps", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [cargo({ id: "wide", quantity: 4, clearanceCm: 15 }), cargo({ id: "plain", quantity: 4, clearanceCm: 0 })],
      settings: { restarts: 6, clearanceCm: 4 },
    })
    expect(result.unloaded).toEqual([])
    const own = (id: string) => (id === "wide" ? 15 : 0)
    for (const unit of result.units) {
      expect(clearanceViolations(boxesOf(unit, own), trailer)).toEqual([])
    }
  })

  it("treats an explicit 0 on a line as no allowance even when the project has one", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [cargo({ id: "tight", quantity: 2, clearanceCm: 0 })],
      settings: { clearanceCm: 20 },
    })
    const [a, b] = result.units[0]!.placements
    expect(a!.x).toBe(0)
    expect(a!.y).toBe(0)
    expect(b).toBeDefined()
  })

  it("fits fewer pieces per unit when clearance is added", () => {
    const small: SolverEquipment = { ...trailer, lengthCm: 220, widthCm: 120, heightCm: 100, maxCount: 1 }
    const line = cargo({ id: "a", lengthCm: 100, widthCm: 100, heightCm: 50, quantity: 2, orientation: "FIXED", stackable: false })
    expect(solve({ equipment: [small], cargo: [line] }).unloaded).toHaveLength(0)
    const withClearance = solve({ equipment: [small], cargo: [line], settings: { clearanceCm: 10 } })
    expect(withClearance.unloaded).toHaveLength(1)
  })

  it("refuses a piece that fits the unit physically but not with its clearance, and says why", () => {
    const small: SolverEquipment = { ...trailer, lengthCm: 200, widthCm: 100, heightCm: 100 }
    const line = cargo({ id: "snug", lengthCm: 100, widthCm: 100, heightCm: 50, orientation: "FIXED" })
    expect(solve({ equipment: [small], cargo: [line] }).unloaded).toHaveLength(0)
    const result = solve({ equipment: [small], cargo: [line], settings: { clearanceCm: 10 } })
    expect(result.units).toHaveLength(0)
    expect(result.unloaded[0]?.reason).toBe("CLEARANCE")
    expect(result.unloaded[0]?.detail).toMatch(/up to 10 cm on a side/)
  })

  it("needs no clearance between a piece and the one it is stacked on", () => {
    const column: SolverEquipment = { ...trailer, lengthCm: 120, widthCm: 120, heightCm: 320 }
    const result = solve({
      equipment: [column],
      cargo: [cargo({ id: "crate", lengthCm: 100, widthCm: 100, heightCm: 100, quantity: 3, orientation: "FIXED" })],
      settings: { clearanceCm: 10 },
    })
    expect(result.unloaded).toEqual([])
    const placements = result.units[0]!.placements.slice().sort((a, b) => a.z - b.z)
    expect(placements.map((p) => [p.x, p.y, p.z])).toEqual([
      [10, 10, 0],
      [10, 10, 100],
      [10, 10, 200],
    ])
  })

  it("keeps floor-only pieces on the floor and still respects their allowance", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [cargo({ id: "heavy", quantity: 5, bottomOnly: true }), cargo({ id: "light", quantity: 5 })],
      settings: { restarts: 4, clearanceCm: 6 },
    })
    for (const unit of result.units) {
      for (const p of unit.placements) if (p.cargoId === "heavy") expect(p.z).toBe(0)
      expect(clearanceViolations(boxesOf(unit, () => 6), trailer)).toEqual([])
    }
  })

  it("applies to drums and pipes through their bounding footprint", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [
        cargo({ id: "drum", shape: "CYLINDER_DRUM", orientation: "FIXED", lengthCm: 60, widthCm: 60, heightCm: 90, quantity: 6 }),
        cargo({ id: "pipe", shape: "PIPE", orientation: "ROTATE_90", lengthCm: 200, widthCm: 30, heightCm: 30, quantity: 4 }),
      ],
      settings: { restarts: 4, clearanceCm: 7 },
    })
    expect(result.unloaded).toEqual([])
    for (const unit of result.units) {
      expect(clearanceViolations(boxesOf(unit, () => 7), trailer)).toEqual([])
    }
  })

  it("keeps rotated pieces inside the unit with their clearance", () => {
    const narrow: SolverEquipment = { ...trailer, lengthCm: 400, widthCm: 130, heightCm: 100 }
    const result = solve({
      equipment: [narrow],
      cargo: [cargo({ id: "plank", lengthCm: 120, widthCm: 60, heightCm: 40, quantity: 6, orientation: "ROTATE_90" })],
      settings: { restarts: 4, clearanceCm: 5 },
    })
    for (const unit of result.units) {
      expect(clearanceViolations(boxesOf(unit, () => 5), narrow)).toEqual([])
    }
  })

  it("reports the same numbers as the shared metrics function for the same layout", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [cargo({ id: "a", quantity: 10 })],
      settings: { restarts: 3, clearanceCm: 5 },
    })
    const unit = result.units[0]!
    const boxes = unit.placements.map((p) => ({
      id: `${p.cargoId}-${p.instanceIndex}`,
      x: p.x,
      y: p.y,
      z: p.z,
      l: p.lengthCm,
      w: p.widthCm,
      h: p.heightCm,
      kg: 100,
      clearanceCm: 5,
    }))
    expect(computeUnitMetrics(trailer, boxes)).toEqual(unit.metrics)
    expect(layoutWarnings(trailer, boxes, unit.metrics)).not.toContain("0 pieces break the handling clearance")
  })
})

describe("computeUnitMetrics", () => {
  const spec = { ...trailer, lengthCm: 400, widthCm: 200, heightCm: 200, maxPayloadKg: 1000, tareKg: 50 }
  const box = (id: string, x: number, y: number, z: number, kg = 100, size: [number, number, number] = [100, 100, 100], clearanceCm = 0) => ({
    id,
    x,
    y,
    z,
    l: size[0],
    w: size[1],
    h: size[2],
    kg,
    clearanceCm,
  })

  it("reports remaining capacity, both floor figures and counts", () => {
    const m = computeUnitMetrics(spec, [box("a", 10, 10, 0, 100, [100, 100, 100], 10), box("b", 10, 10, 100, 200)])
    expect(m.pieces).toBe(2)
    expect(m.netKg).toBe(300)
    expect(m.grossKg).toBe(350)
    expect(m.remainingKg).toBe(700)
    expect(m.volumeM3).toBe(2)
    expect(m.remainingM3).toBe(14)
    expect(m.floorActualPct).toBe(12.5)
    expect(m.floorEffectivePct).toBe(18)
  })

  it("reports a negative remaining payload when over the limit and warns", () => {
    const boxes = [box("heavy", 150, 50, 0, 1200)]
    const m = computeUnitMetrics(spec, boxes)
    expect(m.remainingKg).toBe(-200)
    expect(layoutWarnings(spec, boxes, m)[0]).toMatch(/Over the payload limit by 200 kg/)
  })

  it("warns about handling clearance that is broken", () => {
    const boxes = [box("a", 0, 0, 0, 100, [100, 100, 100], 10), box("b", 105, 0, 0, 100, [100, 100, 100], 10)]
    const warnings = layoutWarnings(spec, boxes, computeUnitMetrics(spec, boxes))
    expect(warnings).toContain("2 pieces break the handling clearance")
  })

  it("estimates axle loads from the weight alone and flags an overload", () => {
    const axle = { ...spec, axleGroups: [{ name: "Front", positionFromFrontCm: 0, maxKg: 100 }, { name: "Rear", positionFromFrontCm: 400, maxKg: 2000 }] }
    const boxes = [box("a", 0, 50, 0, 500)]
    const m = computeUnitMetrics(axle, boxes)
    expect(m.axleLoads[0]!.kg).toBeGreaterThan(100)
    expect(layoutWarnings(axle, boxes, m).some((line) => /Front is estimated over its limit/.test(line))).toBe(true)
  })

  it("is empty-safe", () => {
    const m = computeUnitMetrics(spec, [])
    expect(m).toMatchObject({ pieces: 0, netKg: 0, floorActualPct: 0, floorEffectivePct: 0, remainingKg: 1000 })
  })
})
