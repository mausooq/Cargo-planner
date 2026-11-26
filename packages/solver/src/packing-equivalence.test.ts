import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { solve } from "./solve"
import type { SolverCargo, SolverEquipment, SolverInput } from "./types"

// Packing equivalence. The expected values below were recorded from the solver BEFORE handling
// clearance was removed, for jobs that used no clearance. Removing clearance must not change what is
// packed, where, or how it is turned, so every scenario is pinned by its counts, floor utilization
// and a fingerprint of every placement (position, size, rotation and loading order). If a deliberate
// packing change ever alters these, update them knowingly, with the reason, in the same commit.

const byId = (input: SolverInput, id: string) => input.equipment.find((entry) => entry.id === id)!

const trailer: SolverEquipment = { id: "tr", name: "Trailer", lengthCm: 600, widthCm: 240, heightCm: 250, maxPayloadKg: 20000, tareKg: 5000, axleGroups: [], costPerUnit: 100, maxCount: null }
const small: SolverEquipment = { id: "van", name: "Van", lengthCm: 300, widthCm: 170, heightCm: 180, maxPayloadKg: 1200, tareKg: 2000, axleGroups: [], costPerUnit: 40, maxCount: 3 }

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

const scenarios: Record<string, SolverInput> = {
  uniformBoxes: { equipment: [trailer], cargo: [cargo({ id: "a", quantity: 18 })], settings: { seed: 7, restarts: 6 } },
  mixedSizes: {
    equipment: [trailer],
    cargo: [cargo({ id: "a", quantity: 9 }), cargo({ id: "b", lengthCm: 83.3, widthCm: 41.7, heightCm: 60, quantity: 6 }), cargo({ id: "c", lengthCm: 200, widthCm: 100, heightCm: 120, quantity: 3, orientation: "FIXED" })],
    settings: { seed: 11, restarts: 6 },
  },
  stackingRules: {
    equipment: [trailer],
    cargo: [cargo({ id: "a", quantity: 12, maxStackLayers: 2 }), cargo({ id: "b", quantity: 6, stackable: false, heightCm: 70 }), cargo({ id: "c", quantity: 4, bottomOnly: true, weightKg: 400 }), cargo({ id: "d", quantity: 5, maxStackLoadKg: 150 })],
    settings: { seed: 3, restarts: 6 },
  },
  drumsAndPipes: {
    equipment: [trailer],
    cargo: [cargo({ id: "drum", shape: "CYLINDER_DRUM", lengthCm: 58, widthCm: 58, heightCm: 88, quantity: 16, orientation: "FIXED", weightKg: 210 }), cargo({ id: "pipe", shape: "PIPE", lengthCm: 300, widthCm: 20, heightCm: 20, quantity: 8, orientation: "ROTATE_90", weightKg: 40 })],
    settings: { seed: 5, restarts: 6 },
  },
  overflowLeavesSomeUnloaded: { equipment: [small], cargo: [cargo({ id: "a", quantity: 40, weightKg: 80 })], settings: { seed: 2, restarts: 6 } },
  tooBigForAnyUnit: { equipment: [small], cargo: [cargo({ id: "big", lengthCm: 900, widthCm: 100, heightCm: 100, quantity: 1 }), cargo({ id: "ok", quantity: 3 })], settings: { seed: 9, restarts: 4 } },
  twoEquipmentCost: { equipment: [trailer, small], cargo: [cargo({ id: "a", quantity: 30, weightKg: 120 }), cargo({ id: "b", lengthCm: 60, widthCm: 40, heightCm: 40, quantity: 20, weightKg: 15 })], settings: { seed: 4, restarts: 8 } },
  stopsAndPriority: { equipment: [trailer], cargo: [cargo({ id: "a", quantity: 6, destinationStop: 2, priority: 1 }), cargo({ id: "b", quantity: 6, destinationStop: 1 }), cargo({ id: "c", quantity: 6, destinationStop: 3, priority: 2 })], settings: { seed: 6, restarts: 6 } },
  heavyPayloadLimit: { equipment: [small], cargo: [cargo({ id: "a", quantity: 10, weightKg: 300, lengthCm: 80, widthCm: 60, heightCm: 50 })], settings: { seed: 8, restarts: 6 } },
}

const overlaps = (a: { x: number; y: number; z: number; l: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.l - 0.001 && b.x < a.x + a.l - 0.001 && a.y < b.y + b.w - 0.001 && b.y < a.y + a.w - 0.001 && a.z < b.z + b.h - 0.001 && b.z < a.z + a.h - 0.001

const expected: Record<string, { units: number; packed: number; unloaded: number; reasons: string[]; floorPct: number[]; layout: string }> = {
  "uniformBoxes": {
    "units": 1,
    "packed": 18,
    "unloaded": 0,
    "reasons": [],
    "floorPct": [
      87.6
    ],
    "layout": "eb122c2464ee"
  },
  "mixedSizes": {
    "units": 1,
    "packed": 18,
    "unloaded": 0,
    "reasons": [],
    "floorPct": [
      84
    ],
    "layout": "97b535770d97"
  },
  "stackingRules": {
    "units": 1,
    "packed": 27,
    "unloaded": 0,
    "reasons": [],
    "floorPct": [
      87.6
    ],
    "layout": "416ba403bfeb"
  },
  "drumsAndPipes": {
    "units": 1,
    "packed": 24,
    "unloaded": 0,
    "reasons": [],
    "floorPct": [
      70.7
    ],
    "layout": "cc8590f39118"
  },
  "overflowLeavesSomeUnloaded": {
    "units": 3,
    "packed": 18,
    "unloaded": 22,
    "reasons": [
      "NO_SPACE"
    ],
    "floorPct": [
      53,
      53,
      53
    ],
    "layout": "86356c144e57"
  },
  "tooBigForAnyUnit": {
    "units": 1,
    "packed": 3,
    "unloaded": 1,
    "reasons": [
      "OUT_OF_GAUGE"
    ],
    "floorPct": [
      53
    ],
    "layout": "f9706fba2a63"
  },
  "twoEquipmentCost": {
    "units": 2,
    "packed": 50,
    "unloaded": 0,
    "reasons": [],
    "floorPct": [
      94.3,
      35.3
    ],
    "layout": "53afd8e82b17"
  },
  "stopsAndPriority": {
    "units": 1,
    "packed": 18,
    "unloaded": 0,
    "reasons": [],
    "floorPct": [
      87.6
    ],
    "layout": "7ff416ae1f9b"
  },
  "heavyPayloadLimit": {
    "units": 3,
    "packed": 10,
    "unloaded": 0,
    "reasons": [],
    "floorPct": [
      37.6,
      37.6,
      18.8
    ],
    "layout": "8a9f5f331d46"
  }
}

describe("solver packing is unchanged for jobs without handling clearance", () => {
  for (const [name, input] of Object.entries(scenarios)) {
    it(name, () => {
      const result = solve(input)
      const units = result.units.map((unit) => {
        const boxes = unit.placements.map((p) => ({ x: p.x, y: p.y, z: p.z, l: p.lengthCm, w: p.widthCm, h: p.heightCm }))
        let overlapCount = 0
        let outside = 0
        boxes.forEach((box, index) => {
          for (let other = index + 1; other < boxes.length; other++) if (overlaps(box, boxes[other]!)) overlapCount += 1
          if (box.x < -0.001 || box.y < -0.001 || box.z < -0.001 || box.x + box.l > byId(input, unit.equipmentId).lengthCm + 0.001 || box.y + box.w > byId(input, unit.equipmentId).widthCm + 0.001 || box.z + box.h > byId(input, unit.equipmentId).heightCm + 0.001) outside += 1
        })
        return {
          equipmentId: unit.equipmentId,
          pieces: unit.placements.length,
          overlapCount,
          outside,
          floorPct: unit.metrics.floorPct,
          volumePct: unit.metrics.volumePct,
          weightPct: unit.metrics.weightPct,
          placements: unit.placements.map((p) => [p.cargoId, p.instanceIndex, p.x, p.y, p.z, p.lengthCm, p.widthCm, p.heightCm, p.rotation, p.sequence]),
        }
      })
      // Never a collision, and never outside the unit.
      expect(units.every((unit) => unit.overlapCount === 0 && unit.outside === 0)).toBe(true)
      // No pre-removal plan ever carried a half-turn facing, because only directional clearance produced one.
      expect(units.every((unit) => unit.placements.every((p) => !String(p[8]).includes("@")))).toBe(true)

      const want = expected[name]!
      expect({
        units: result.units.length,
        packed: units.reduce((sum, unit) => sum + unit.pieces, 0),
        unloaded: result.unloaded.length,
        reasons: [...new Set(result.unloaded.map((item) => item.reason))].sort(),
        floorPct: units.map((unit) => unit.floorPct),
        layout: createHash("sha1").update(JSON.stringify(units)).digest("hex").slice(0, 12),
      }).toEqual(want)
    })
  }
})
