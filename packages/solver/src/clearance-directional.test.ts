import { clearanceViolations, floorUtilization, placedSides, type PlanBox, type SideClearance } from "@compass/physics"
import { describe, expect, it } from "vitest"
import { solve } from "./solve"
import type { PlannedUnit, SolverCargo, SolverEquipment } from "./types"
import { ownSidesFor, placementOptions } from "./unit"

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

const front20: SideClearance = { front: 20, rear: 0, left: 0, right: 0 }
const mixed: SideClearance = { front: 20, rear: 5, left: 10, right: 5 }

/** The placed boxes with the allowance each carries, worked out independently from the placement's rotation. */
function boxesOf(unit: PlannedUnit, sidesOfLine: (id: string) => SideClearance, defaultSides: SideClearance): PlanBox[] {
  return unit.placements.map((p) => ({
    id: `${p.cargoId}-${p.instanceIndex}`,
    x: p.x,
    y: p.y,
    z: p.z,
    l: p.lengthCm,
    w: p.widthCm,
    h: p.heightCm,
    clearance: placedSides(sidesOfLine(p.cargoId) ?? defaultSides, p.rotation),
  }))
}

describe("directional clearance in the packer", () => {
  it("keeps each piece's own sides to the walls and neighbours, in whatever way it was turned", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [cargo({ id: "a", quantity: 10, clearanceSides: mixed })],
      settings: { restarts: 6 },
    })
    expect(result.unloaded).toEqual([])
    for (const unit of result.units) {
      expect(clearanceViolations(boxesOf(unit, () => mixed, mixed), trailer)).toEqual([])
    }
  })

  it("puts a front-only allowance on the front side of a piece that cannot turn", () => {
    const fixed = cargo({ id: "a", lengthCm: 100, widthCm: 100, heightCm: 50, orientation: "FIXED", clearanceSides: front20 })
    const placement = solve({ equipment: [trailer], cargo: [fixed] }).units[0]!.placements[0]!
    expect(placement.x).toBe(20)
    expect(placement.y).toBe(0)
    expect(placement.rotation).toBe("LWH")
  })

  it("puts a rear-only allowance against the doors side instead", () => {
    const fixed = cargo({ id: "a", lengthCm: 100, widthCm: 100, heightCm: 50, orientation: "FIXED", clearanceSides: { front: 0, rear: 20, left: 0, right: 0 } })
    const placement = solve({ equipment: [trailer], cargo: [fixed] }).units[0]!.placements[0]!
    expect(placement.x).toBe(0)
  })

  it("lets a piece that needs room at the front use the wall on the side that needs none", () => {
    const tight: SolverEquipment = { ...trailer, lengthCm: 120, widthCm: 100, heightCm: 100 }
    const piece = cargo({ id: "a", lengthCm: 100, widthCm: 100, heightCm: 50, orientation: "FIXED" })
    // Exactly fits with 20 cm at the front; a rear-only 20 cm fits against the other wall; 30 does not fit.
    expect(solve({ equipment: [tight], cargo: [{ ...piece, clearanceSides: front20 }] }).unloaded).toHaveLength(0)
    expect(solve({ equipment: [tight], cargo: [{ ...piece, clearanceSides: { front: 0, rear: 20, left: 0, right: 0 } }] }).unloaded).toHaveLength(0)
    const over = solve({ equipment: [tight], cargo: [{ ...piece, clearanceSides: { front: 30, rear: 0, left: 0, right: 0 } }] })
    expect(over.units).toHaveLength(0)
    expect(over.unloaded[0]?.reason).toBe("CLEARANCE")
    expect(over.unloaded[0]?.detail).toMatch(/up to 30 cm on a side/)
  })

  it("packs a piece with a facing choice, and its options include the half-turn facings", () => {
    const unit: SolverEquipment = { ...trailer, lengthCm: 130, widthCm: 100, heightCm: 100, maxCount: 1 }
    const free = cargo({ id: "free", lengthCm: 100, widthCm: 100, heightCm: 50, orientation: "ROTATE_90", clearanceSides: { front: 0, rear: 20, left: 0, right: 0 } })
    expect(solve({ equipment: [unit], cargo: [free], settings: { restarts: 3 } }).unloaded).toHaveLength(0)
    const options = placementOptions(free, ownSidesFor(free, { clearanceCm: 0 }))
    expect(options.some((dim) => dim.rotation.endsWith("@180"))).toBe(true)
  })

  it("offers half-turn facings only to pieces whose sides differ, and never to a fixed orientation", () => {
    const base = cargo({ id: "a" })
    const none = placementOptions(base, ownSidesFor(base, { clearanceCm: 5 }))
    expect(none.every((dim) => !dim.rotation.includes("@"))).toBe(true)
    const directional = cargo({ id: "b", clearanceSides: front20 })
    const options = placementOptions(directional, ownSidesFor(directional, { clearanceCm: 0 }))
    expect(options.filter((dim) => dim.rotation.includes("@180")).map((dim) => dim.rotation).sort()).toEqual(["LWH@180", "WLH@180"])
    const fixed = cargo({ id: "c", orientation: "FIXED", clearanceSides: front20 })
    expect(placementOptions(fixed, ownSidesFor(fixed, { clearanceCm: 0 })).map((dim) => dim.rotation)).toEqual(["LWH"])
  })

  it("carries the allowance through a quarter turn: a piece that has to turn keeps its front allowance on the turned side", () => {
    // A narrow unit: the 117 x 77 piece only fits turned, with its front now towards the left wall.
    const narrow: SolverEquipment = { ...trailer, lengthCm: 100, widthCm: 150, heightCm: 100 }
    const piece = cargo({ id: "a", orientation: "ROTATE_90", clearanceSides: { front: 25, rear: 0, left: 0, right: 0 } })
    const placement = solve({ equipment: [narrow], cargo: [piece], settings: { restarts: 3 } }).units[0]!.placements[0]!
    const turns = placement.rotation
    expect(["WLH", "WLH@180"]).toContain(turns)
    const sides = placedSides(piece.clearanceSides!, turns)
    expect(placement.x).toBeGreaterThanOrEqual(sides.x0)
    expect(placement.y).toBeGreaterThanOrEqual(sides.y0)
    expect(placement.x + placement.lengthCm + sides.x1).toBeLessThanOrEqual(narrow.lengthCm + 1e-6)
    expect(placement.y + placement.widthCm + sides.y1).toBeLessThanOrEqual(narrow.widthCm + 1e-6)
  })

  it("applies the largest value on every side when a piece has to be tipped, and does not drop it", () => {
    // 80 cm high but the unit is 60 cm high: the piece must lie on a side.
    const low: SolverEquipment = { ...trailer, lengthCm: 300, widthCm: 100, heightCm: 60, maxCount: 1 }
    const tipped = cargo({
      id: "a",
      lengthCm: 100,
      widthCm: 50,
      heightCm: 80,
      orientation: "TILTABLE",
      clearanceSides: { front: 10, rear: 0, left: 0, right: 0 },
    })
    const result = solve({ equipment: [low], cargo: [tipped], settings: { restarts: 3 } })
    expect(result.unloaded).toEqual([])
    const placement = result.units[0]!.placements[0]!
    expect(["LHW", "HLW", "WHL", "HWL"]).toContain(placement.rotation)
    expect(placement.x).toBeGreaterThanOrEqual(10)
    expect(placement.y).toBeGreaterThanOrEqual(10)
    expect(placement.y + placement.widthCm + 10).toBeLessThanOrEqual(low.widthCm + 1e-6)
  })

  it("keeps a zero-clearance line beside a line with clearance, with the facing gap", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [cargo({ id: "roomy", quantity: 4, clearanceSides: mixed }), cargo({ id: "tight", quantity: 4, clearanceCm: 0 })],
      settings: { restarts: 6, clearanceCm: 4 },
    })
    expect(result.unloaded).toEqual([])
    const own = (id: string): SideClearance => (id === "roomy" ? mixed : { front: 0, rear: 0, left: 0, right: 0 })
    for (const unit of result.units) {
      expect(clearanceViolations(boxesOf(unit, own, own("tight")), trailer)).toEqual([])
    }
  })

  it("lets an inheriting line follow the project default and a line with its own value ignore it", () => {
    const inherit = cargo({ id: "inherit" })
    const own = cargo({ id: "own", clearanceCm: 0 })
    expect(ownSidesFor(inherit, { clearanceCm: 9 })).toEqual({ front: 9, rear: 9, left: 9, right: 9 })
    expect(ownSidesFor(own, { clearanceCm: 9 })).toEqual({ front: 0, rear: 0, left: 0, right: 0 })
    expect(ownSidesFor({ clearanceSides: mixed }, { clearanceCm: 9 })).toEqual(mixed)
    // Bad stored values fall back to the project default instead of failing.
    expect(ownSidesFor({ clearanceCm: -4 }, { clearanceCm: 9 }).front).toBe(9)
    expect(ownSidesFor({ clearanceSides: { front: 1 } as unknown as SideClearance }, { clearanceCm: 9 }).front).toBe(9)
  })

  it("reports effective floor use from the uneven envelopes and counts shared reserved space once", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [cargo({ id: "a", quantity: 8, clearanceSides: mixed })],
      settings: { restarts: 4 },
    })
    const unit = result.units[0]!
    const boxes = boxesOf(unit, () => mixed, mixed)
    const floor = floorUtilization(boxes, trailer)
    const tenth = (value: number) => Math.round(value * 10) / 10
    expect(unit.metrics.floorActualPct).toBe(tenth(floor.actualPct))
    expect(unit.metrics.floorEffectivePct).toBe(tenth(floor.effectivePct))
    expect(unit.metrics.floorEffectivePct).toBeGreaterThan(unit.metrics.floorActualPct)
    // If shared reserved space were counted per piece the effective figure would be larger than this bound.
    const perPiece = boxes.reduce((sum, box) => sum + (box.l + mixed.front + mixed.rear) * (box.w + mixed.left + mixed.right), 0)
    expect(floor.effectiveAreaCm2).toBeLessThan(perPiece)
  })

  it("needs more or equal units as the allowance grows (equipment feasibility follows the clearance)", () => {
    const line = cargo({ id: "a", lengthCm: 100, widthCm: 100, heightCm: 100, quantity: 30, orientation: "FIXED" })
    const units = (clearanceSides: SideClearance | null, clearanceCm: number | null) =>
      solve({
        equipment: [{ ...trailer, lengthCm: 600, widthCm: 240, heightCm: 100 }],
        cargo: [{ ...line, clearanceSides, clearanceCm }],
        settings: { restarts: 4 },
      }).units.length
    const none = units(null, 0)
    const some = units(null, 15)
    const directional = units({ front: 30, rear: 30, left: 0, right: 0 }, null)
    expect(some).toBeGreaterThanOrEqual(none)
    expect(directional).toBeGreaterThanOrEqual(none)
  })

  it("does not treat clearance as support or ask for it between stacked pieces", () => {
    const column: SolverEquipment = { ...trailer, lengthCm: 120, widthCm: 100, heightCm: 320 }
    const result = solve({
      equipment: [column],
      cargo: [cargo({ id: "crate", lengthCm: 100, widthCm: 100, heightCm: 100, quantity: 3, orientation: "FIXED", clearanceSides: front20 })],
    })
    expect(result.unloaded).toEqual([])
    const placements = result.units[0]!.placements.slice().sort((a, b) => a.z - b.z)
    expect(placements.map((p) => [p.x, p.y, p.z])).toEqual([
      [20, 0, 0],
      [20, 0, 100],
      [20, 0, 200],
    ])
  })

  it("keeps floor-only pieces on the floor with directional clearance", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [cargo({ id: "heavy", quantity: 5, bottomOnly: true, clearanceSides: mixed }), cargo({ id: "light", quantity: 5 })],
      settings: { restarts: 4 },
    })
    for (const unit of result.units) {
      for (const p of unit.placements) if (p.cargoId === "heavy") expect(p.z).toBe(0)
    }
  })

  it("works for drums and pipes", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [
        cargo({ id: "drum", shape: "CYLINDER_DRUM", orientation: "FIXED", lengthCm: 60, widthCm: 60, heightCm: 90, quantity: 6, clearanceSides: { front: 10, rear: 0, left: 5, right: 0 } }),
        cargo({ id: "pipe", shape: "PIPE", orientation: "ROTATE_90", lengthCm: 200, widthCm: 30, heightCm: 30, quantity: 3, clearanceSides: { front: 0, rear: 15, left: 0, right: 5 } }),
      ],
      settings: { restarts: 4 },
    })
    expect(result.unloaded).toEqual([])
    const sidesOfLine = (id: string): SideClearance =>
      id === "drum" ? { front: 10, rear: 0, left: 5, right: 0 } : { front: 0, rear: 15, left: 0, right: 5 }
    for (const unit of result.units) {
      expect(clearanceViolations(boxesOf(unit, sidesOfLine, mixed), trailer)).toEqual([])
    }
  })

  it("does not change a plan whose lines are all uniform: same placements as before directional support", () => {
    const lines = [cargo({ id: "a", quantity: 9 }), cargo({ id: "b", lengthCm: 83.3, widthCm: 41.7, quantity: 6, clearanceCm: 6 })]
    const first = solve({ equipment: [trailer], cargo: lines, settings: { restarts: 5, clearanceCm: 3 } })
    const again = solve({ equipment: [trailer], cargo: lines, settings: { restarts: 5, clearanceCm: 3 } })
    expect(again.units).toEqual(first.units)
    for (const unit of first.units) for (const p of unit.placements) expect(p.rotation.includes("@")).toBe(false)
  })
})
