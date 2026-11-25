import { clearanceViolations, describeRotation, parseRotation, placedSides, type SideClearance } from "@compass/physics"
import { solve, type SolverCargo, type SolverEquipment } from "@compass/solver"
import { describe, expect, it } from "vitest"
import { rotateItemFlat } from "@/lib/cargo-skin"
import { itemSides } from "@/lib/clearance"
import { layoutProblems, rotationProblem, type LayoutCargoRules } from "@/lib/layout-validation"
import { packingRows } from "@/lib/plan-export"
import { planFromDb } from "@/lib/plan-from-db"
import { metricBoxesOf } from "@/lib/plan-metrics"
import { clearanceFields, toPlanView, type PlanItemView, type PlanView } from "@/lib/plan-view"

const mixed: SideClearance = { front: 20, rear: 5, left: 10, right: 5 }

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
    ...clearanceFields({ clearanceSides: mixed }, 0),
    ...extra,
  }
}

const rules = (orientation: string): LayoutCargoRules => ({ lengthCm: 120, widthCm: 80, heightCm: 60, orientation: orientation as never, shape: "BOX", allowedRotations: null })

describe("directional clearance turns with the piece", () => {
  it("four successive quarter turns return the piece, its footprint and its clearance envelope to the start", () => {
    const start = piece()
    let turned = start
    const seen: string[] = []
    for (let turn = 0; turn < 4; turn += 1) {
      turned = rotateItemFlat(turned)
      seen.push(turned.rotation)
    }
    expect(seen).toEqual(["WLH", "LWH@180", "WLH@180", "LWH"])
    expect([turned.lengthCm, turned.widthCm, turned.rotation]).toEqual([start.lengthCm, start.widthCm, start.rotation])
    expect(itemSides(turned)).toEqual(itemSides(start))
  })

  it("every intermediate facing carries each own side to a different placed side", () => {
    let turned = piece()
    const placed = [] as string[]
    for (let turn = 0; turn < 4; turn += 1) {
      const sides = itemSides(turned)
      placed.push(`${sides.x0}/${sides.x1}/${sides.y0}/${sides.y1}`)
      turned = rotateItemFlat(turned)
    }
    expect(new Set(placed).size).toBe(4)
  })

  it("keeps the actual dimensions, weight and volume through every turn", () => {
    const start = piece()
    let turned = start
    for (let turn = 0; turn < 4; turn += 1) {
      turned = rotateItemFlat(turned)
      expect(turned.lengthCm * turned.widthCm * turned.heightCm).toBe(start.lengthCm * start.widthCm * start.heightCm)
      expect(turned.weightKg).toBe(start.weightKg)
    }
  })
})

describe("rotation rules of the cargo line", () => {
  it("lets a free line be turned through all four facings", () => {
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

  it("accepts a tipped piece the line allows, and gives it the conservative clearance", () => {
    const tipped = piece({ lengthCm: 120, widthCm: 60, heightCm: 80, rotation: "LHW" })
    expect(rotationProblem(tipped, rules("ANY"))).toBeNull()
    expect(itemSides(tipped)).toEqual({ x0: 20, x1: 20, y0: 20, y1: 20 })
    expect(parseRotation("LHW").turns).toBeNull()
  })
})

describe("older plans keep working", () => {
  it("reads the codes older versions wrote, and the pieces get the sides they always had", () => {
    for (const code of ["LWH", "WLH"]) {
      const old = piece({ rotation: code, ...clearanceFields({ clearanceCm: 5 }, 0) })
      expect(itemSides(old)).toEqual({ x0: 5, x1: 5, y0: 5, y1: 5 })
    }
    expect(parseRotation("LWH").turns).toBe(0)
    expect(parseRotation("WLH").turns).toBe(1)
  })

  it("loads a saved plan that has old and new codes together, and keeps each piece's own", () => {
    const db = {
      seed: 1,
      settings: { clearanceCm: 0 },
      summary: { warnings: [] },
      unloaded: [],
      instances: [
        {
          sequence: 1,
          equipmentTypeId: "eq",
          metrics: { netKg: 3 },
          equipmentType: { id: "eq", name: "Box", mode: "SEA", oogClass: "NONE", heightOpen: false, contour: null, innerLengthCm: 500, innerWidthCm: 240, innerHeightCm: 250, maxPayloadKg: 1000 },
          placements: ["LWH", "WLH", "LWH@180", "WLH@180"].map((rotation, index) => ({
            cargoItemId: "a",
            instanceIndex: index,
            xCm: index * 130,
            yCm: 0,
            zCm: 0,
            lengthCm: rotation.startsWith("W") ? 80 : 120,
            widthCm: rotation.startsWith("W") ? 120 : 80,
            heightCm: 60,
            rotation,
            cargoItem: { name: "a", sku: null, weightKg: 1, color: null, shape: "BOX", customFields: { clearanceSides: mixed } },
          })),
        },
      ],
    }
    const items = planFromDb(db as never).units[0]!.items
    expect(items.map((item) => item.rotation)).toEqual(["LWH", "WLH", "LWH@180", "WLH@180"])
    expect(items.map((item) => itemSides(item))).toEqual(["LWH", "WLH", "LWH@180", "WLH@180"].map((code) => placedSides(mixed, code)))
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
    ["directional", line("a", { clearanceSides: mixed })],
    ["uniform", line("a", { clearanceCm: 6 })],
    ["fixed and directional", line("a", { orientation: "FIXED", clearanceSides: mixed })],
    ["inheriting", line("a")],
  ] as const) {
    it(`accepts the packer's ${label} layout everywhere: no violations, valid on the server, and a plain-language facing in the export`, () => {
      const result = solve({ equipment: [trailer], cargo: [cargoLine], settings: { restarts: 4, clearanceCm: 4 } })
      expect(result.unloaded).toEqual([])
      const plan: PlanView = toPlanView(
        result,
        [{ id: "tr", name: "Trailer", mode: "ROAD", oogClass: "NONE", heightOpen: false, contour: null, lengthCm: 600, widthCm: 240, heightCm: 250, maxPayloadKg: 20000 }],
        [{ id: "a", name: "a", weightKg: 100, color: null, clearanceCm: cargoLine.clearanceCm ?? null, clearanceSides: cargoLine.clearanceSides ?? null }],
      )
      const unit = plan.units[0]!
      // The Playground's interpretation (itemSides) agrees with the packer: nothing is in anyone's reserved space.
      expect(clearanceViolations(metricBoxesOf(unit.items), unit)).toEqual([])
      // The server's check accepts the same layout, rotation codes included.
      const pieces = unit.items.map((item) => ({ item, cargo: rules2(cargoLine) }))
      expect(layoutProblems(unit, pieces).size).toBe(0)
      // The export describes each facing in words and never prints a code it cannot explain.
      for (const row of packingRows(plan)) {
        expect(["As entered", "Turned 90°", "Turned 180°", "Turned 270°", "Tipped onto another face"]).toContain(row.Facing)
      }
    })
  }

  function rules2(cargoLine: SolverCargo): LayoutCargoRules {
    return { lengthCm: cargoLine.lengthCm, widthCm: cargoLine.widthCm, heightCm: cargoLine.heightCm, orientation: cargoLine.orientation, shape: cargoLine.shape, allowedRotations: null }
  }

  it("describes every rotation code in words for the Excel packing list", () => {
    expect(describeRotation("LWH")).toBe("As entered")
    expect(describeRotation("WLH")).toBe("Turned 90°")
    expect(describeRotation("LWH@180")).toBe("Turned 180°")
    expect(describeRotation("WLH@180")).toBe("Turned 270°")
    expect(describeRotation("LHW")).toBe("Tipped onto another face")
    expect(describeRotation(undefined)).toBe("As entered")
  })

  it("a zero-clearance line still keeps out of a neighbour's reserved space after turning", () => {
    const result = solve({
      equipment: [trailer],
      cargo: [line("roomy", { quantity: 4, clearanceSides: mixed }), line("tight", { quantity: 4, clearanceCm: 0 })],
      settings: { restarts: 5 },
    })
    const plan = toPlanView(
      result,
      [{ id: "tr", name: "Trailer", mode: "ROAD", oogClass: "NONE", heightOpen: false, contour: null, lengthCm: 600, widthCm: 240, heightCm: 250, maxPayloadKg: 20000 }],
      [
        { id: "roomy", name: "roomy", weightKg: 100, color: null, clearanceSides: mixed },
        { id: "tight", name: "tight", weightKg: 100, color: null, clearanceCm: 0 },
      ],
    )
    for (const unit of plan.units) expect(clearanceViolations(metricBoxesOf(unit.items), unit)).toEqual([])
  })
})
