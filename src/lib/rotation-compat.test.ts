import { describeRotation, parseRotation } from "@compass/physics"
import { solve, type SolverCargo, type SolverEquipment } from "@compass/solver"
import { describe, expect, it } from "vitest"
import { rotateItemFlat } from "@/lib/cargo-skin"
import { layoutProblems, rotationProblem, type LayoutCargoRules } from "@/lib/layout-validation"
import { packingRows } from "@/lib/plan-export"
import { planFromDb } from "@/lib/plan-from-db"
import { pieceValues, type EnteredCargo } from "@/lib/plan-piece-values"
import { toPlanView, type PlanItemView, type PlanView } from "@/lib/plan-view"

// Plans saved by earlier versions can hold half-turn rotation codes (LWH@180, WLH@180). The codes stay
// readable and valid after the feature that produced them was removed, and nothing here rewrites a
// saved piece's geometry just to tidy a code.

function piece(extra: Partial<PlanItemView> = {}): PlanItemView {
  return {
    id: "a-0",
    cargoId: "a",
    name: "a",
    color: "#000",
    x: 50,
    y: 50,
    z: 0,
    lengthCm: 120,
    widthCm: 80,
    heightCm: 60,
    weightKg: 10,
    sequence: 1,
    rotation: "LWH",
    shape: "BOX",
    ...extra,
  }
}

const rules = (orientation: string): LayoutCargoRules => ({ lengthCm: 120, widthCm: 80, heightCm: 60, orientation: orientation as never, shape: "BOX", allowedRotations: null })

describe("turning a piece in the Playground", () => {
  it("flips a piece as entered between its two footprints, as it always did", () => {
    const start = piece()
    const once = rotateItemFlat(start)
    expect([once.lengthCm, once.widthCm, once.rotation]).toEqual([80, 120, "WLH"])
    const twice = rotateItemFlat(once)
    expect([twice.lengthCm, twice.widthCm, twice.rotation]).toEqual([120, 80, "LWH"])
  })

  it("keeps the actual dimensions, weight and volume through every turn", () => {
    const start = piece()
    let turned = start
    for (let turn = 0; turn < 6; turn += 1) {
      turned = rotateItemFlat(turned)
      expect(turned.lengthCm * turned.widthCm * turned.heightCm).toBe(start.lengthCm * start.widthCm * start.heightCm)
      expect(turned.heightCm).toBe(start.heightCm)
      expect(turned.weightKg).toBe(start.weightKg)
    }
  })

  it("keeps a piece saved with a half-turn facing consistent: its code always agrees with its sizes", () => {
    let turned = piece({ rotation: "LWH@180" })
    const seen: string[] = [turned.rotation]
    for (let turn = 0; turn < 4; turn += 1) {
      turned = rotateItemFlat(turned)
      seen.push(turned.rotation)
      // Whatever the code, the server accepts the piece for a line that may be turned.
      expect(rotationProblem(turned, rules("ROTATE_90"))).toBeNull()
    }
    // It goes round to plain codes, then flips as any other piece does.
    expect(seen).toEqual(["LWH@180", "WLH@180", "LWH", "WLH", "LWH"])
  })

  it("does not change what the old piece occupies when it is read, only when it is turned", () => {
    const old = piece({ rotation: "WLH@180", lengthCm: 80, widthCm: 120 })
    expect([old.lengthCm, old.widthCm, old.rotation]).toEqual([80, 120, "WLH@180"])
    const turned = rotateItemFlat(old)
    expect([turned.lengthCm, turned.widthCm]).toEqual([120, 80])
  })

  it("turns a tipped piece about the vertical without standing it up again", () => {
    const tipped = piece({ lengthCm: 120, widthCm: 60, heightCm: 80, rotation: "LHW" })
    const turned = rotateItemFlat(tipped)
    expect([turned.lengthCm, turned.widthCm, turned.heightCm, turned.rotation]).toEqual([60, 120, 80, "HLW"])
    expect(rotationProblem(turned, rules("ANY"))).toBeNull()
  })
})

describe("rotation rules of the cargo line", () => {
  it("lets a free line be turned", () => {
    let turned = piece()
    for (let turn = 0; turn < 4; turn += 1) {
      turned = rotateItemFlat(turned)
      expect(rotationProblem(turned, rules("ROTATE_90"))).toBeNull()
    }
  })

  it("keeps a fixed-orientation line as entered: no quarter turn and no half turn, even for a square footprint", () => {
    expect(rotationProblem(piece(), rules("FIXED"))).toBeNull()
    expect(rotationProblem(rotateItemFlat(piece()), rules("FIXED"))).toMatch(/does not allow|fixes its orientation/)
    const square = { ...rules("FIXED"), lengthCm: 100, widthCm: 100 }
    const squarePiece = piece({ lengthCm: 100, widthCm: 100 })
    expect(rotationProblem(squarePiece, square)).toBeNull()
    expect(rotationProblem({ ...squarePiece, rotation: "WLH" }, square)).toMatch(/fixes its orientation/)
    expect(rotationProblem({ ...squarePiece, rotation: "LWH@180" }, square)).toMatch(/fixes its orientation/)
  })

  it("lets a lengthways line face either way but not be turned across", () => {
    expect(rotationProblem(piece({ rotation: "LWH@180" }), rules("LONGSHIP"))).toBeNull()
    expect(rotationProblem(rotateItemFlat(piece()), rules("LONGSHIP"))).toMatch(/does not allow/)
  })

  it("refuses a code that disagrees with the piece's sizes, an unreadable code and a half turn of a tipped one", () => {
    expect(rotationProblem(piece({ rotation: "WLH" }), rules("ROTATE_90"))).toMatch(/does not match its sizes/)
    expect(rotationProblem(piece({ rotation: "QQQ" }), rules("ROTATE_90"))).toMatch(/unknown rotation/)
    const tipped = piece({ lengthCm: 120, widthCm: 60, heightCm: 80, rotation: "LHW@180" })
    expect(rotationProblem(tipped, rules("ANY"))).toBeTruthy()
  })

  it("accepts a tipped piece the line allows", () => {
    const tipped = piece({ lengthCm: 120, widthCm: 60, heightCm: 80, rotation: "LHW" })
    expect(rotationProblem(tipped, rules("ANY"))).toBeNull()
    expect(parseRotation("LHW").turns).toBeNull()
  })
})

describe("older plans keep working", () => {
  const codes = ["LWH", "WLH", "LWH@180", "WLH@180"]
  const db = {
    seed: 1,
    settings: { clearanceCm: 6, clearanceConfig: { defaultCm: 6, lines: {} } },
    summary: { warnings: [] },
    unloaded: [],
    instances: [
      {
        sequence: 1,
        equipmentTypeId: "eq",
        metrics: { netKg: 4, floorEffectivePct: 60 },
        equipmentType: { id: "eq", name: "Box", mode: "SEA", oogClass: "NONE", heightOpen: false, contour: null, innerLengthCm: 700, innerWidthCm: 240, innerHeightCm: 250, maxPayloadKg: 1000 },
        placements: codes.map((rotation, index) => ({
          cargoItemId: "a",
          instanceIndex: index,
          xCm: index * 130,
          yCm: 0,
          zCm: 0,
          lengthCm: rotation.startsWith("W") ? 80 : 120,
          widthCm: rotation.startsWith("W") ? 120 : 80,
          heightCm: 60,
          rotation,
          cargoItem: { name: "a", sku: "A-1", weightKg: 1, color: null, shape: "BOX", customFields: { clearanceSides: { front: 20, rear: 5, left: 10, right: 5 } } },
        })),
      },
    ],
  }

  it("loads a saved plan that has plain and half-turn codes together, with each piece's own code and sizes", () => {
    const items = planFromDb(db as never).units[0]!.items
    expect(items.map((item) => item.rotation)).toEqual(codes)
    expect(items.map((item) => [item.lengthCm, item.widthCm, item.heightCm])).toEqual([
      [120, 80, 60],
      [80, 120, 60],
      [120, 80, 60],
      [80, 120, 60],
    ])
  })

  it("the server's check accepts every one of them for a line that may be turned", () => {
    const unit = planFromDb(db as never).units[0]!
    const pieces = unit.items.map((item) => ({ item, cargo: rules("ROTATE_90") }))
    expect(layoutProblems(unit, pieces).size).toBe(0)
  })

  it("the Turned indicator is right for every code, including a half turn that leaves the sizes unchanged", () => {
    const entered: EnteredCargo = { id: "a", sku: "A-1", name: "a", lengthCm: 120, widthCm: 80, heightCm: 60, weightKg: 1 }
    const items = planFromDb(db as never).units[0]!.items
    const values = items.map((item) => pieceValues(item, new Map([["a", entered]])))
    expect(values.map((value) => value.turned)).toEqual([false, true, true, true])
    expect(values.map((value) => value.facing)).toEqual([null, "Turned 90°", "Turned 180°", "Turned 270°"])
    // Always shown in the order it was entered, whatever the facing.
    for (const value of values) expect([value.lengthCm, value.widthCm, value.heightCm]).toEqual([120, 80, 60])
  })

  it("a plan that carries clearance settings opens exactly like one that does not", () => {
    const without = { ...db, settings: {}, instances: [{ ...db.instances[0]!, placements: db.instances[0]!.placements.map((row) => ({ ...row, cargoItem: { ...row.cargoItem, customFields: null } })) }] }
    expect(planFromDb(db as never).units[0]!.items).toEqual(planFromDb(without as never).units[0]!.items)
  })
})

describe("the packer, the Playground, the server and the reports read the codes the same way", () => {
  const trailer: SolverEquipment = { id: "tr", name: "Trailer", lengthCm: 600, widthCm: 240, heightCm: 250, maxPayloadKg: 20000, tareKg: 5000, axleGroups: [], costPerUnit: 1, maxCount: null }
  const line = (id: string, extra: Partial<SolverCargo> = {}): SolverCargo => ({
    id,
    name: id,
    lengthCm: 117,
    widthCm: 77,
    heightCm: 90,
    weightKg: 100,
    quantity: 10,
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
    ...extra,
  })

  for (const [label, cargoLine] of [
    ["a free", line("a")],
    ["a fixed", line("a", { orientation: "FIXED" })],
    ["a lengthways", line("a", { orientation: "LONGSHIP" })],
  ] as const) {
    it(`accepts the packer's layout for ${label} line everywhere: valid on the server, and a plain-language facing in the export`, () => {
      const result = solve({ equipment: [trailer], cargo: [cargoLine], settings: { restarts: 4 } })
      expect(result.unloaded).toEqual([])
      const plan: PlanView = toPlanView(
        result,
        [{ id: "tr", name: "Trailer", mode: "ROAD", oogClass: "NONE", heightOpen: false, contour: null, lengthCm: 600, widthCm: 240, heightCm: 250, maxPayloadKg: 20000 }],
        [{ id: "a", name: "a", weightKg: 100, color: null }],
      )
      const unit = plan.units[0]!
      const pieces = unit.items.map((item) => ({ item, cargo: { lengthCm: cargoLine.lengthCm, widthCm: cargoLine.widthCm, heightCm: cargoLine.heightCm, orientation: cargoLine.orientation, shape: cargoLine.shape, allowedRotations: null } as LayoutCargoRules }))
      expect(layoutProblems(unit, pieces).size).toBe(0)
      for (const row of packingRows(plan)) {
        expect(["As entered", "Turned 90°", "Turned 180°", "Turned 270°", "Tipped onto another face"]).toContain(row.Facing)
      }
    })
  }

  it("describes every rotation code in words for the Excel packing list", () => {
    expect(describeRotation("LWH")).toBe("As entered")
    expect(describeRotation("WLH")).toBe("Turned 90°")
    expect(describeRotation("LWH@180")).toBe("Turned 180°")
    expect(describeRotation("WLH@180")).toBe("Turned 270°")
    expect(describeRotation("LHW")).toBe("Tipped onto another face")
    expect(describeRotation(undefined)).toBe("As entered")
  })

  it("the packer no longer produces half-turn codes, since only a directional setting ever asked for them", () => {
    const result = solve({ equipment: [trailer], cargo: [line("a", { quantity: 12 }), line("b", { quantity: 8, lengthCm: 83.3, widthCm: 41.7 })], settings: { restarts: 5 } })
    const codes = result.units.flatMap((unit) => unit.placements.map((placement) => placement.rotation))
    expect(codes.length).toBeGreaterThan(0)
    expect(codes.every((code) => !code.includes("@"))).toBe(true)
  })
})
