import { describe, expect, it } from "vitest"
import { axleLoads } from "./metrics"
import { solve } from "./solve"
import type { SolverCargo, SolverEquipment } from "./types"

const box20: SolverEquipment = {
  id: "20dv",
  name: "20ft DV",
  lengthCm: 585,
  widthCm: 235,
  heightCm: 239,
  maxPayloadKg: 21770,
  tareKg: 2300,
  axleGroups: [],
  costPerUnit: 850,
  maxCount: null,
}

const box40: SolverEquipment = {
  ...box20,
  id: "40hc",
  name: "40ft HC",
  lengthCm: 1203,
  heightCm: 270,
  maxPayloadKg: 26460,
  costPerUnit: 1350,
}

const euTrailer: SolverEquipment = {
  id: "eu",
  name: "Box Trailer (EU)",
  lengthCm: 1362,
  widthCm: 246,
  heightCm: 270,
  maxPayloadKg: 24000,
  tareKg: 7000,
  axleGroups: [
    { name: "Kingpin", positionFromFrontCm: 160, maxKg: 12000 },
    { name: "Rear tandem", positionFromFrontCm: 1180, maxKg: 18000 },
  ],
  costPerUnit: 950,
  maxCount: null,
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
    orientation: "ANY",
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

const quick = { restarts: 3, timeLimitMs: 60_000 }

describe("fit and no fit", () => {
  it("places a single box at the front-left floor corner", () => {
    const result = solve({ equipment: [box20], cargo: [cargo({ id: "a" })], settings: quick })
    expect(result.units).toHaveLength(1)
    expect(result.unloaded).toHaveLength(0)
    const placement = result.units[0]?.placements[0]
    expect(placement).toMatchObject({ x: 0, y: 0, z: 0 })
  })

  it("fills a 20ft box with 1 m cubes and opens a second unit for the rest", () => {
    // 5 along, 2 across, 2 high = 20 per box.
    const result = solve({ equipment: [box20], cargo: [cargo({ id: "cube", quantity: 25 })], settings: quick })
    expect(result.unloaded).toHaveLength(0)
    expect(result.units).toHaveLength(2)
    expect(result.units[0]?.placements).toHaveLength(20)
    expect(result.units[1]?.placements).toHaveLength(5)
  })

  it("marks cargo that cannot fit any unit as out of gauge", () => {
    const result = solve({
      equipment: [box20],
      cargo: [cargo({ id: "long", lengthCm: 700, widthCm: 50, heightCm: 50, orientation: "FIXED" })],
      settings: quick,
    })
    expect(result.units).toHaveLength(0)
    expect(result.unloaded[0]?.reason).toBe("OUT_OF_GAUGE")
  })

  it("never overlaps placements", () => {
    const result = solve({
      equipment: [box40],
      cargo: [
        cargo({ id: "a", lengthCm: 120, widthCm: 80, heightCm: 90, quantity: 30, weightKg: 50 }),
        cargo({ id: "b", lengthCm: 60, widthCm: 40, heightCm: 40, quantity: 60, weightKg: 5 }),
      ],
      settings: quick,
    })
    for (const unit of result.units) {
      const items = unit.placements
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i]!
          const b = items[j]!
          const separate =
            a.x + a.lengthCm <= b.x + 1e-6 ||
            b.x + b.lengthCm <= a.x + 1e-6 ||
            a.y + a.widthCm <= b.y + 1e-6 ||
            b.y + b.widthCm <= a.y + 1e-6 ||
            a.z + a.heightCm <= b.z + 1e-6 ||
            b.z + b.heightCm <= a.z + 1e-6
          expect(separate).toBe(true)
        }
      }
    }
  })
})

describe("weight and axles", () => {
  it("splits cargo onto a second unit when the payload is reached", () => {
    const result = solve({
      equipment: [box20],
      cargo: [cargo({ id: "heavy", weightKg: 6000, quantity: 5 })],
      settings: quick,
    })
    expect(result.unloaded).toHaveLength(0)
    expect(result.units).toHaveLength(2)
    expect(result.units[0]?.metrics.netKg).toBeLessThanOrEqual(21770)
  })

  it("reports cargo heavier than every payload", () => {
    const result = solve({ equipment: [box20], cargo: [cargo({ id: "block", weightKg: 30000 })], settings: quick })
    expect(result.unloaded[0]?.reason).toBe("TOO_HEAVY")
  })

  it("computes two-axle beam loads from the cargo centre of gravity", () => {
    const loads = axleLoads(euTrailer.axleGroups, 10000, 1180)
    expect(loads[0]?.kg).toBeCloseTo(0)
    expect(loads[1]?.kg).toBeCloseTo(10000)
    const mid = axleLoads(euTrailer.axleGroups, 10000, 670)
    expect(mid[0]?.kg).toBeCloseTo(5000)
    expect(mid[1]?.kg).toBeCloseTo(5000)
  })

  it("keeps every axle group inside its limit", () => {
    const result = solve({
      equipment: [euTrailer],
      cargo: [cargo({ id: "dense", lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 2000, quantity: 12, stackable: false })],
      settings: quick,
    })
    for (const unit of result.units) {
      for (const load of unit.metrics.axleLoads) {
        expect(load.kg).toBeLessThanOrEqual(load.maxKg + 1e-6)
      }
    }
  })
})

describe("stacking", () => {
  it("does not stack on a non-stackable item", () => {
    // Floor holds exactly four 1 m footprints in a 235 × 585 box: 5 x 2 = 10 actually, so shrink the box.
    const small: SolverEquipment = { ...box20, id: "small", lengthCm: 200, widthCm: 100, heightCm: 300 }
    const result = solve({
      equipment: [small],
      cargo: [cargo({ id: "base", quantity: 3, stackable: false })],
      settings: quick,
    })
    expect(result.units).toHaveLength(2)
    for (const unit of result.units) {
      for (const placement of unit.placements) expect(placement.z).toBe(0)
    }
  })

  it("stacks stackable items and respects max layers", () => {
    const tall: SolverEquipment = { ...box20, id: "tall", lengthCm: 100, widthCm: 100, heightCm: 400 }
    const stacked = solve({ equipment: [tall], cargo: [cargo({ id: "c", quantity: 3 })], settings: quick })
    expect(stacked.units).toHaveLength(1)
    expect(stacked.units[0]?.placements.map((p) => p.z).sort((a, b) => a - b)).toEqual([0, 100, 200])

    const limited = solve({
      equipment: [tall],
      cargo: [cargo({ id: "c", quantity: 3, maxStackLayers: 2 })],
      settings: quick,
    })
    expect(limited.units).toHaveLength(2)
  })

  it("does not place a heavier item on a lighter one by default", () => {
    const tall: SolverEquipment = { ...box20, id: "tall", lengthCm: 100, widthCm: 100, heightCm: 400 }
    const result = solve({
      equipment: [tall],
      cargo: [cargo({ id: "light", weightKg: 10 }), cargo({ id: "heavy", weightKg: 500 })],
      settings: quick,
    })
    const unit = result.units[0]!
    const heavy = unit.placements.find((p) => p.cargoId === "heavy")!
    const light = unit.placements.find((p) => p.cargoId === "light")!
    expect(heavy.z).toBe(0)
    expect(light.z).toBe(100)
  })

  it("respects the maximum load an item can carry", () => {
    const tall: SolverEquipment = { ...box20, id: "tall", lengthCm: 100, widthCm: 100, heightCm: 400 }
    const result = solve({
      equipment: [tall],
      cargo: [cargo({ id: "fragile", weightKg: 100, maxStackLoadKg: 50 }), cargo({ id: "top", weightKg: 80 })],
      settings: quick,
    })
    // Nothing may be stacked on the fragile item, and the heavier-below rule prevents the reverse. Two units.
    expect(result.units).toHaveLength(2)
  })
})

describe("rotation", () => {
  it("rotates an item in plan view when allowed and not when fixed", () => {
    const slot: SolverEquipment = { ...box20, id: "slot", lengthCm: 100, widthCm: 200, heightCm: 100 }
    const item = cargo({ id: "plank", lengthCm: 200, widthCm: 100, heightCm: 100 })
    const rotated = solve({ equipment: [slot], cargo: [{ ...item, orientation: "ROTATE_90" }], settings: quick })
    expect(rotated.units[0]?.placements[0]?.rotation).toBe("WLH")
    const fixed = solve({ equipment: [slot], cargo: [{ ...item, orientation: "FIXED" }], settings: quick })
    expect(fixed.unloaded[0]?.reason).toBe("OUT_OF_GAUGE")
  })

  it("tips a tiltable item on its side to fit under a low roof", () => {
    const low: SolverEquipment = { ...box20, id: "low", lengthCm: 300, widthCm: 300, heightCm: 100 }
    const tall = cargo({ id: "tall", lengthCm: 100, widthCm: 100, heightCm: 250 })
    const tilted = solve({ equipment: [low], cargo: [{ ...tall, orientation: "TILTABLE" }], settings: quick })
    expect(tilted.units).toHaveLength(1)
    expect(tilted.units[0]?.placements[0]?.heightCm).toBe(100)
    const upright = solve({ equipment: [low], cargo: [{ ...tall, orientation: "ROTATE_90" }], settings: quick })
    expect(upright.unloaded).toHaveLength(1)
  })

  it("uses only the axes chosen for a custom orientation", () => {
    const slot: SolverEquipment = { ...box20, id: "slot", lengthCm: 100, widthCm: 200, heightCm: 100 }
    const item = cargo({
      id: "plank",
      lengthCm: 200,
      widthCm: 100,
      heightCm: 100,
      orientation: "CUSTOM",
      allowedRotations: ["LWH"],
    })
    const blocked = solve({ equipment: [slot], cargo: [item], settings: quick })
    expect(blocked.unloaded[0]?.reason).toBe("OUT_OF_GAUGE")
    const turned = solve({
      equipment: [slot],
      cargo: [{ ...item, allowedRotations: ["LWH", "WLH"] }],
      settings: quick,
    })
    expect(turned.units[0]?.placements[0]?.rotation).toBe("WLH")
  })
})

describe("multi-stop, segregation, objectives", () => {
  it("loads the last drop at the front and the first drop by the doors", () => {
    const lane: SolverEquipment = { ...box20, id: "lane", lengthCm: 400, widthCm: 100, heightCm: 100 }
    const result = solve({
      equipment: [lane],
      cargo: [
        cargo({ id: "stop1", destinationStop: 1, stackable: false }),
        cargo({ id: "stop2", destinationStop: 2, stackable: false }),
        cargo({ id: "stop3", destinationStop: 3, stackable: false }),
      ],
      settings: quick,
    })
    const unit = result.units[0]!
    const xOf = (id: string) => unit.placements.find((p) => p.cargoId === id)!.x
    expect(xOf("stop3")).toBeLessThan(xOf("stop2"))
    expect(xOf("stop2")).toBeLessThan(xOf("stop1"))
    const seqOf = (id: string) => unit.placements.find((p) => p.cargoId === id)!.sequence
    expect(seqOf("stop3")).toBeLessThan(seqOf("stop1"))
  })

  it("keeps incompatible segregation classes in separate units", () => {
    const result = solve({
      equipment: [box40],
      cargo: [cargo({ id: "acid", segregationClass: "8" }), cargo({ id: "food", segregationClass: "FOOD" })],
      settings: { ...quick, segregation: [["8", "FOOD"]] },
    })
    expect(result.units).toHaveLength(2)
    expect(result.unloaded).toHaveLength(0)
  })

  it("chooses fewer big boxes for fewest units and cheaper mix for lowest cost", () => {
    const cheapSmall: SolverEquipment = { ...box20, costPerUnit: 100 }
    const bigPricey: SolverEquipment = { ...box40, costPerUnit: 10000 }
    // 30 cubes: one 40ft HC, or two 20ft boxes.
    const items = [cargo({ id: "cube", quantity: 30 })]
    const fewest = solve({ equipment: [cheapSmall, bigPricey], cargo: items, settings: { ...quick, objective: "FEWEST_UNITS" } })
    expect(fewest.units.every((unit) => unit.equipmentId === "40hc")).toBe(true)
    const cheapest = solve({ equipment: [cheapSmall, bigPricey], cargo: items, settings: { ...quick, objective: "LOWEST_COST" } })
    expect(cheapest.units.every((unit) => unit.equipmentId === "20dv")).toBe(true)
    expect(cheapest.totalCost).toBeLessThan(fewest.totalCost)
  })

  it("respects a maximum count per type", () => {
    const result = solve({
      equipment: [{ ...box20, maxCount: 1 }],
      cargo: [cargo({ id: "cube", quantity: 25 })],
      settings: quick,
    })
    expect(result.units).toHaveLength(1)
    expect(result.unloaded).toHaveLength(5)
  })
})

describe("ULD inner contour", () => {
  const none = { lengthCm: 0, heightCm: 0 }

  it("keeps tall cargo inside the A2N house roof instead of the end slope", () => {
    const a2n: SolverEquipment = {
      ...box20,
      id: "a2n",
      name: "A2N",
      lengthCm: 317,
      widthCm: 223,
      heightCm: 205,
      maxPayloadKg: 6033,
      maxCount: 1,
      contour: {
        bottomLeft: none,
        bottomRight: none,
        topLeft: { lengthCm: 107.5, heightCm: 91 },
        topRight: { lengthCm: 107.5, heightCm: 91 },
      },
    }
    const result = solve({
      equipment: [a2n],
      cargo: [cargo({ id: "tall", lengthCm: 80, widthCm: 80, heightCm: 180, orientation: "FIXED" })],
      settings: quick,
    })
    const placed = result.units[0]?.placements[0]
    expect(result.unloaded).toHaveLength(0)
    expect(placed).toBeTruthy()
    expect(placed!.x).toBeGreaterThan(70)
    expect(placed!.z + placed!.heightCm).toBeLessThanOrEqual(205)
  })

  it("places cargo on the remaining LD-3 deck, not in the bottom cut", () => {
    const ld3: SolverEquipment = {
      ...box20,
      id: "ld3",
      name: "LD-3",
      lengthCm: 192,
      widthCm: 145,
      heightCm: 162,
      maxPayloadKg: 1516,
      maxCount: 1,
      contour: {
        bottomLeft: none,
        bottomRight: { lengthCm: 45, heightCm: 51 },
        topLeft: none,
        topRight: none,
      },
    }
    const result = solve({
      equipment: [ld3],
      cargo: [cargo({ id: "box", lengthCm: 40, widthCm: 40, heightCm: 40 })],
      settings: quick,
    })
    const placed = result.units[0]?.placements[0]
    expect(result.unloaded).toHaveLength(0)
    expect(placed?.y).toBeGreaterThanOrEqual(45)
  })
})

describe("determinism and performance", () => {
  it("returns the same plan for the same seed", () => {
    const input = {
      equipment: [box40],
      cargo: [
        cargo({ id: "a", lengthCm: 120, widthCm: 80, heightCm: 100, quantity: 15, weightKg: 200 }),
        cargo({ id: "b", lengthCm: 60, widthCm: 60, heightCm: 60, quantity: 40, weightKg: 20 }),
      ],
      settings: { seed: 42, restarts: 8, timeLimitMs: 60_000 },
    }
    const first = solve(input)
    const second = solve(input)
    expect(JSON.stringify(first.units)).toBe(JSON.stringify(second.units))
  })

  it("packs 1,000 pieces in under ten seconds", () => {
    const started = performance.now()
    const result = solve({
      equipment: [box40],
      cargo: [
        cargo({ id: "p1", lengthCm: 120, widthCm: 80, heightCm: 110, weightKg: 150, quantity: 400 }),
        cargo({ id: "p2", lengthCm: 60, widthCm: 40, heightCm: 40, weightKg: 12, quantity: 400 }),
        cargo({ id: "p3", lengthCm: 200, widthCm: 100, heightCm: 60, weightKg: 300, quantity: 200, stackable: false }),
      ],
      settings: { restarts: 2, timeLimitMs: 9000 },
    })
    const elapsed = performance.now() - started
    const loaded = result.units.reduce((sum, unit) => sum + unit.placements.length, 0)
    expect(loaded + result.unloaded.length).toBe(1000)
    expect(result.unloaded).toHaveLength(0)
    expect(elapsed).toBeLessThan(10_000)
  })
})
