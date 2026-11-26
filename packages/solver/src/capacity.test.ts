import { describe, expect, it } from "vitest"
import { analyseRemainingCapacity, checkAdditionalFit, detectUniformCargo, disjointBoxes, subtractBox, type CapacityUnitInput, type ExistingPiece } from "./capacity"
import { intersects, type Box } from "./geometry"
import type { SolverCargo, SolverEquipment } from "./types"

// Small, exact units so every expected figure can be worked out by hand. Sizes in cm, weights in kg.

function equipment(partial: Partial<SolverEquipment> = {}): SolverEquipment {
  return { id: "u", name: "Test unit", lengthCm: 300, widthCm: 100, heightCm: 100, maxPayloadKg: 10_000, tareKg: 0, axleGroups: [], costPerUnit: 0, maxCount: 1, ...partial }
}

function cargo(partial: Partial<SolverCargo> & Pick<SolverCargo, "id">): SolverCargo {
  return {
    name: partial.id,
    lengthCm: 100,
    widthCm: 100,
    heightCm: 100,
    weightKg: 100,
    quantity: 1,
    shape: "BOX",
    orientation: "FIXED",
    allowedRotations: null,
    stackable: false,
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

let counter = 0
function piece(cargoId: string, x: number, y = 0, z = 0, size: [number, number, number] = [100, 100, 100]): ExistingPiece {
  counter += 1
  return { id: `p${counter}`, cargoId, x, y, z, lengthCm: size[0], widthCm: size[1], heightCm: size[2], rotation: "LWH" }
}

function unit(pieces: ExistingPiece[], spec: Partial<SolverEquipment> = {}, unitIndex = 0): CapacityUnitInput {
  return { unitIndex, equipment: equipment(spec), pieces }
}

const asBox = (entry: { x: number; y: number; z: number; lengthCm: number; widthCm: number; heightCm: number }): Box => ({ x: entry.x, y: entry.y, z: entry.z, l: entry.lengthCm, w: entry.widthCm, h: entry.heightCm })

function pairwiseDisjoint(boxes: Box[]): boolean {
  return boxes.every((box, index) => boxes.slice(index + 1).every((other) => !intersects(box, other)))
}

describe("uniform cargo", () => {
  it("finds how many more identical packages fit, where, and the potential total", () => {
    const crate = cargo({ id: "crate" })
    const result = analyseRemainingCapacity([unit([piece("crate", 0)])], [crate])
    expect(result.uniform).toMatchObject({ uniform: true, loadedPieces: 1 })
    expect(result.additional).toMatchObject({ pieces: 2, weightKg: 200, volumeM3: 2, potentialTotalPieces: 3, searchComplete: true })
    expect(result.additional!.units[0]!.placements.map((entry) => entry.x).sort((a, b) => a - b)).toEqual([100, 200])
    expect(result.additional!.units[0]!.stop).toMatchObject({ kind: "physical", factor: "space" })
    expect(result.validated).toBe(true)
  })

  it("counts pieces, not cargo lines, and treats lines of the same package as one", () => {
    const a = cargo({ id: "a" })
    const b = cargo({ id: "b", weightKg: 150 })
    const check = detectUniformCargo([unit([piece("a", 0), piece("a", 100), piece("b", 200, 0, 0)], { lengthCm: 500 })], [a, b])
    expect(check).toMatchObject({ uniform: true, loadedPieces: 3, weightsDiffer: true })
    // The heaviest weight is used for what is added, so the answer is never optimistic.
    expect(check.uniform && check.template.weightKg).toBe(150)
  })

  it("counts a turned copy of the same package as the same package when it may be turned", () => {
    const a = cargo({ id: "a", lengthCm: 120, widthCm: 80, orientation: "ROTATE_90" })
    const b = cargo({ id: "b", lengthCm: 80, widthCm: 120, orientation: "ROTATE_90" })
    expect(detectUniformCargo([unit([piece("a", 0, 0, 0, [120, 80, 100]), piece("b", 120, 0, 0, [80, 120, 100])], { lengthCm: 500, widthCm: 200 })], [a, b]).uniform).toBe(true)
    const fixed = [cargo({ id: "a", lengthCm: 120, widthCm: 80 }), cargo({ id: "b", lengthCm: 80, widthCm: 120 })]
    expect(detectUniformCargo([unit([piece("a", 0, 0, 0, [120, 80, 100]), piece("b", 120, 0, 0, [80, 120, 100])], { lengthCm: 500, widthCm: 200 })], fixed).uniform).toBe(false)
  })
})

describe("non-uniform cargo", () => {
  it("reports empty regions without double counting, and no package count", () => {
    const result = analyseRemainingCapacity([unit([piece("a", 0), piece("b", 100, 0, 0, [50, 100, 100])])], [cargo({ id: "a" }), cargo({ id: "b", lengthCm: 50 })])
    expect(result.uniform.uniform).toBe(false)
    expect(result.additional).toBeNull()
    const space = result.units[0]!
    expect(space.theoreticalRemainingM3).toBe(1.5)
    expect(space.usableM3).toBe(1.5)
    expect(space.regions).toHaveLength(1)
    expect(space.regions[0]).toMatchObject({ x: 150, y: 0, z: 0, lengthCm: 150, widthCm: 100, heightCm: 100, base: "floor" })
  })
})

describe("free space", () => {
  it("splits overlapping free spaces for reporting so nothing is counted twice", () => {
    // An L of free floor around one piece in a corner: the packer keeps two overlapping maximal spaces.
    const result = analyseRemainingCapacity([unit([piece("a", 0, 0)], { lengthCm: 200, widthCm: 200 })], [cargo({ id: "a" })])
    const space = result.units[0]!
    expect(space.theoreticalRemainingM3).toBe(3)
    expect(space.usableM3).toBe(3)
    expect(pairwiseDisjoint(space.regions.map(asBox))).toBe(true)
    expect(space.regions.reduce((sum, region) => sum + region.volumeM3, 0)).toBeCloseTo(3, 6)
    expect(space.usableFloorM2).toBe(3)
    expect(space.remainingFloorM2).toBe(3)
  })

  it("still finds the larger placement the overlapping spaces allow", () => {
    // A 200 cm long piece only fits along the free strip at the side, which the reporting split cuts in two.
    const check = checkAdditionalFit([unit([piece("a", 0, 0)], { lengthCm: 200, widthCm: 200 })], [cargo({ id: "a" })], cargo({ id: "long", lengthCm: 200 }))
    expect(check).toMatchObject({ placed: 1, allFit: true })
    expect(check.units[0]!.placements[0]).toMatchObject({ x: 0, y: 100, z: 0, lengthCm: 200 })
  })

  it("subtracts boxes into pieces that cover the rest exactly", () => {
    const a = { x: 0, y: 0, z: 0, l: 100, w: 100, h: 100 }
    const parts = subtractBox(a, { x: 25, y: 25, z: 25, l: 50, w: 50, h: 50 })
    expect(pairwiseDisjoint(parts)).toBe(true)
    expect(parts.reduce((sum, part) => sum + part.l * part.w * part.h, 0)).toBe(1_000_000 - 125_000)
    expect(disjointBoxes([a, { x: 50, y: 0, z: 0, l: 100, w: 100, h: 100 }]).boxes.reduce((sum, part) => sum + part.l * part.w * part.h, 0)).toBe(1_500_000)
  })

  it("shows fragmented empty space as separate regions", () => {
    const result = analyseRemainingCapacity([unit([piece("a", 100)])], [cargo({ id: "a" })])
    const space = result.units[0]!
    expect(space.regions.map((region) => region.x).sort((a, b) => a - b)).toEqual([0, 200])
    expect(space.usableM3).toBe(2)
    expect(result.additional!.pieces).toBe(2)
  })

  it("has remaining volume but no room for another package", () => {
    // Two 50 cm gaps: 1 m³ free in total, as much as a package, but neither gap takes one.
    const result = analyseRemainingCapacity([unit([piece("a", 50), piece("a", 200)])], [cargo({ id: "a" })])
    expect(result.units[0]!.theoreticalRemainingM3).toBe(1)
    expect(result.additional).toMatchObject({ pieces: 0, searchComplete: true })
    expect(result.additional!.units[0]!.stop).toMatchObject({ kind: "physical", factor: "space" })
  })

  it("reports a completely filled unit", () => {
    const result = analyseRemainingCapacity([unit([piece("a", 0), piece("a", 100), piece("a", 200)])], [cargo({ id: "a" })])
    const space = result.units[0]!
    expect(space).toMatchObject({ theoreticalRemainingM3: 0, usableM3: 0, remainingFloorM2: 0, headroomCm: 0, regions: [] })
    expect(result.additional).toMatchObject({ pieces: 0, potentialTotalPieces: 3 })
  })
})

describe("limits other than space", () => {
  it("stops on the payload before the space runs out", () => {
    const result = analyseRemainingCapacity([unit([piece("a", 0)], { lengthCm: 400, maxPayloadKg: 250 })], [cargo({ id: "a" })])
    expect(result.additional!.pieces).toBe(1)
    expect(result.additional!.units[0]!.stop).toMatchObject({ kind: "physical", factor: "payload" })
    expect(result.units[0]!.usableM3).toBe(3)
  })

  it("stops on an axle group", () => {
    const axles = [
      { name: "Front", positionFromFrontCm: 0, maxKg: 1000 },
      { name: "Rear", positionFromFrontCm: 1000, maxKg: 100_000 },
    ]
    const heavy = cargo({ id: "h", weightKg: 500 })
    const result = analyseRemainingCapacity([unit([piece("h", 0), piece("h", 100)], { lengthCm: 1000, axleGroups: axles })], [heavy])
    expect(result.validated).toBe(true)
    expect(result.additional!.pieces).toBe(0)
    expect(result.additional!.units[0]!.stop).toMatchObject({ kind: "physical", factor: "axle" })
  })
})

describe("stacking", () => {
  const column = { lengthCm: 100, heightCm: 200 }

  it("adds on top of stackable cargo", () => {
    const result = analyseRemainingCapacity([unit([piece("a", 0)], column)], [cargo({ id: "a", stackable: true })])
    expect(result.additional!.pieces).toBe(1)
    expect(result.additional!.units[0]!.placements[0]).toMatchObject({ z: 100 })
    expect(result.units[0]).toMatchObject({ usableM3: 1, restrictedM3: 0, headroomCm: 100 })
    expect(result.units[0]!.regions[0]).toMatchObject({ base: "stackable-cargo", baseCargoIds: ["a"] })
  })

  it("never adds on top of cargo that may not be stacked on, including stacking not stated (planned as not stackable)", () => {
    const result = analyseRemainingCapacity([unit([piece("a", 0)], column)], [cargo({ id: "a", stackable: false })])
    expect(result.additional!.pieces).toBe(0)
    expect(result.additional!.units[0]!.stop).toMatchObject({ kind: "physical", factor: "stacking" })
    expect(result.units[0]).toMatchObject({ usableM3: 0, restrictedM3: 1, theoreticalRemainingM3: 1 })
    expect(result.units[0]!.restrictedRegions[0]).toMatchObject({ base: "non-stackable-cargo", z: 100 })
  })
})

describe("rotations", () => {
  const narrow = { lengthCm: 100, widthCm: 200 }

  it("does not turn a package whose orientation is fixed", () => {
    const check = checkAdditionalFit([unit([], narrow)], [], cargo({ id: "x", lengthCm: 200, quantity: 1 }))
    expect(check).toMatchObject({ placed: 0, allFit: false })
    expect(check.stop).toMatchObject({ kind: "physical", factor: "size" })
  })

  it("turns a package that may be turned", () => {
    const check = checkAdditionalFit([unit([], narrow)], [], cargo({ id: "x", lengthCm: 200, orientation: "ROTATE_90", quantity: 1 }))
    expect(check).toMatchObject({ placed: 1, allFit: true })
    expect(check.units[0]!.placements[0]).toMatchObject({ lengthCm: 100, widthCm: 200, rotation: "WLH" })
  })
})

describe("several units", () => {
  it("analyses each unit with its own pieces and adds the results", () => {
    const a = cargo({ id: "a" })
    const result = analyseRemainingCapacity([unit([piece("a", 0)], { lengthCm: 200 }, 0), unit([piece("a", 0)], { lengthCm: 200 }, 1)], [a])
    expect(result.additional!.pieces).toBe(2)
    expect(result.additional!.units.map((entry) => entry.placements[0]!.unitIndex)).toEqual([0, 1])
    expect(result.totals.usableM3).toBe(2)
    expect(result.totals.remainingKg).toBe(19_800)
  })

  it("puts what one unit cannot take into the next when checking extra cargo", () => {
    const units = [unit([piece("a", 0)], { lengthCm: 200 }, 0), unit([], { lengthCm: 200 }, 1)]
    const check = checkAdditionalFit(units, [cargo({ id: "a" })], cargo({ id: "new", quantity: 3 }))
    expect(check).toMatchObject({ requested: 3, placed: 3, allFit: true })
    expect(check.units.map((entry) => entry.pieces)).toEqual([1, 2])
  })
})

describe("an existing plan that breaks a rule", () => {
  const rules = [cargo({ id: "a" }), cargo({ id: "s", stackable: true, weightKg: 50 })]

  it("flags overlapping pieces and does not call the result validated", () => {
    const result = analyseRemainingCapacity([unit([piece("a", 0), piece("a", 50)])], rules)
    expect(result.validated).toBe(false)
    expect(result.violations.map((entry) => entry.code)).toContain("OVERLAP")
  })

  it("flags a floating piece, a piece on cargo that may not be stacked on, and a piece outside the unit", () => {
    const tall = { heightCm: 300 }
    expect(analyseRemainingCapacity([unit([piece("a", 0, 0, 150)], tall)], rules).violations.map((entry) => entry.code)).toContain("UNSUPPORTED")
    expect(analyseRemainingCapacity([unit([piece("a", 0), piece("a", 0, 0, 100)], tall)], rules).violations.map((entry) => entry.code)).toContain("ON_NOT_STACKABLE")
    expect(analyseRemainingCapacity([unit([piece("a", 250)])], rules).violations.map((entry) => entry.code)).toContain("OUTSIDE")
  })

  it("flags a unit over its payload", () => {
    expect(analyseRemainingCapacity([unit([piece("a", 0), piece("a", 100)], { maxPayloadKg: 150 })], rules).violations.map((entry) => entry.code)).toContain("OVER_PAYLOAD")
  })

  it("only notes a heavier piece on a lighter one, which a hand-arranged layout may do", () => {
    const result = analyseRemainingCapacity([unit([piece("s", 0), piece("a", 0, 0, 100)], { heightCm: 200 })], [cargo({ id: "a", weightKg: 100 }), cargo({ id: "s", stackable: true, weightKg: 50 })])
    expect(result.validated).toBe(true)
    expect(result.notes.map((entry) => entry.code)).toEqual(["HEAVIER_ON_TOP"])
  })

  it("flags pieces whose cargo line no longer exists", () => {
    const result = analyseRemainingCapacity([unit([piece("gone", 0)])], rules)
    expect(result.validated).toBe(false)
    expect(result.uniform.uniform).toBe(false)
  })
})

describe("simulation bounds", () => {
  it("says when the time limit stopped it, not a physical limit", () => {
    let time = 0
    const result = analyseRemainingCapacity([unit([], { lengthCm: 1000 })], [], { now: () => (time += 1000), limits: { timeBudgetMs: 1500 } })
    // No loaded cargo: nothing to copy, so the clock is only read by the fit check below.
    expect(result.additional).toBeNull()
    time = 0
    const check = checkAdditionalFit([unit([], { lengthCm: 1000 })], [], cargo({ id: "x", quantity: 10 }), { now: () => (time += 1000), limits: { timeBudgetMs: 1500 } })
    expect(check.stop.kind).toBe("time-limit")
    expect(check.allFit).toBe(false)
  })

  it("says when the piece limit stopped it, and does not call the search complete", () => {
    const result = analyseRemainingCapacity([unit([piece("a", 0)], { lengthCm: 1000 })], [cargo({ id: "a" })], { limits: { maxPiecesPerUnit: 2 } })
    expect(result.additional).toMatchObject({ pieces: 2, searchComplete: false })
    expect(result.additional!.units[0]!.stop.kind).toBe("iteration-limit")
  })

  it("stops a uniform analysis on its time budget", () => {
    let time = 0
    const result = analyseRemainingCapacity([unit([piece("a", 0)], { lengthCm: 1000 })], [cargo({ id: "a" })], { now: () => (time += 1000), limits: { timeBudgetMs: 2500 } })
    expect(result.additional!.units[0]!.stop.kind).toBe("time-limit")
    expect(result.additional!.searchComplete).toBe(false)
  })
})

describe("the original plan is left alone", () => {
  it("does not change the pieces, the cargo or the equipment it is given", () => {
    const units = [unit([piece("a", 0), piece("a", 100, 0, 0)], { lengthCm: 500, heightCm: 200 }), unit([piece("a", 0)], { lengthCm: 200 }, 1)]
    const rules = [cargo({ id: "a", stackable: true })]
    const before = JSON.stringify({ units, rules })
    const result = analyseRemainingCapacity(units, rules)
    checkAdditionalFit(units, rules, cargo({ id: "x", quantity: 5 }))
    expect(JSON.stringify({ units, rules })).toBe(before)
    // The proposals go around the existing pieces, never through them.
    for (const addition of result.additional!.units) {
      const existing = units.find((entry) => entry.unitIndex === addition.unitIndex)!.pieces.map(asBox)
      expect(addition.placements.every((placement) => existing.every((box) => !intersects(box, asBox(placement))))).toBe(true)
      expect(pairwiseDisjoint(addition.placements.map(asBox))).toBe(true)
    }
  })

  it("gives the same answer when run twice", () => {
    const units = [unit([piece("a", 0)])]
    const rules = [cargo({ id: "a" })]
    expect(analyseRemainingCapacity(units, rules)).toEqual(analyseRemainingCapacity(units, rules))
  })
})
