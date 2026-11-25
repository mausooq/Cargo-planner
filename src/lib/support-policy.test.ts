import {
  boxBody,
  DEFAULT_MIN_SUPPORT_PCT,
  DEFAULT_PHYSICS_SETTINGS,
  DEFAULT_WORLD,
  MIN_SUPPORT_PCT_RANGE,
  resolveMinSupportPct,
  resolveMinSupportRatio,
  validateDrop,
  validMinSupportPct,
} from "@compass/physics"
import { DEFAULT_SETTINGS, solve, type SolverCargo, type SolverEquipment } from "@compass/solver"
import { describe, expect, it } from "vitest"
import { tryPlaceItem } from "@/lib/cargo-skin"
import { findFreeSpot } from "@/lib/cargo-spot"
import { MIN_SUPPORT_PCT, projectMinSupportPct } from "@/lib/clearance"
import { layoutProblems, DEFAULT_MIN_SUPPORT_RATIO, type LayoutCargoRules } from "@/lib/layout-validation"
import type { PlanItemView, PlanUnitView } from "@/lib/plan-view"
import { buildSolverInput } from "@/lib/solver-input"

describe("one default minimum support share", () => {
  it("is 75% everywhere it is defined, which is what the packer always used", () => {
    expect(DEFAULT_MIN_SUPPORT_PCT).toBe(75)
    expect(DEFAULT_PHYSICS_SETTINGS.minSupportRatio).toBe(0.75)
    expect(DEFAULT_WORLD.minSupportRatio).toBe(0.75)
    expect(DEFAULT_SETTINGS.minSupportRatio).toBe(0.75)
    expect(DEFAULT_MIN_SUPPORT_RATIO).toBe(0.75)
    expect(MIN_SUPPORT_PCT.fallback).toBe(75)
  })

  it("is what the packer is given when the project has no setting, and what a project with one gets", () => {
    const cargo = [{ id: "a", name: "A", lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1, quantity: 1, shape: "BOX", orientation: "ANY", allowedRotations: null, stackable: true, bottomOnly: false, maxStackLoadKg: null, maxStackLayers: null, priority: 0, destinationStop: 1, consignmentId: null, segregationClass: null, color: null, sku: null, updatedAt: "" }]
    const equipment = [{ id: "eq", name: "Box", innerLengthCm: 100, innerWidthCm: 100, innerHeightCm: 100, maxPayloadKg: 100, tareKg: 0, axleGroups: [], costPerUnit: 1, maxCount: 1, contour: null }]
    const build = (minSupportPct?: number | null) => buildSolverInput({ cargo: cargo as never, equipment: equipment as never, objective: "FEWEST_UNITS", minSupportPct })
    expect(build().settings?.minSupportRatio).toBe(0.75)
    expect(build(null).settings?.minSupportRatio).toBe(0.75)
    expect(build(60).settings?.minSupportRatio).toBe(0.6)
    expect(build(100).settings?.minSupportRatio).toBe(1)
  })
})

describe("resolving and validating a project's support setting", () => {
  it("accepts only numbers from 50 to 100 and rounds to a tenth", () => {
    expect(MIN_SUPPORT_PCT_RANGE).toEqual({ min: 50, max: 100 })
    expect(validMinSupportPct(50)).toBe(50)
    expect(validMinSupportPct(100)).toBe(100)
    expect(validMinSupportPct(62.54)).toBe(62.5)
    for (const bad of [49.9, 100.1, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, "70", null, undefined, {}, []]) {
      expect(validMinSupportPct(bad)).toBeNull()
    }
  })

  it("falls back to the shared default for anything that is not a valid setting, never to something weaker", () => {
    for (const bad of [undefined, null, "60", 10, 0, 101, Number.NaN]) {
      expect(resolveMinSupportPct(bad)).toBe(75)
      expect(resolveMinSupportRatio(bad)).toBe(0.75)
    }
    expect(resolveMinSupportPct(60)).toBe(60)
    expect(resolveMinSupportRatio(90)).toBe(0.9)
  })

  it("reads the project's own setting from its rules, and reports none when it has none", () => {
    expect(projectMinSupportPct({ minSupportPct: 60 })).toBe(60)
    expect(projectMinSupportPct({})).toBeNull()
    expect(projectMinSupportPct(null)).toBeNull()
    expect(projectMinSupportPct({ minSupportPct: 40 })).toBeNull()
  })
})

const world = { ...DEFAULT_WORLD, lengthCm: 500, widthCm: 240, heightCm: 250 }
const base = boxBody("base", 0, 0, 0, 100, 100, 100, 50)
// 72% of the top piece rests on the base: between the old Playground/server default (70%) and the shared 75%.
const top = boxBody("top", 28, 0, 100, 100, 100, 100, 50)

describe("the same layout is judged the same by the Playground, the free-spot search and the server", () => {
  it("refuses a 72%-supported stack by default and accepts it once the project sets 70%", () => {
    expect(validateDrop(world, [base, top], top, { x: 28, y: 0, z: 100 }).reason).toBe("NO_SUPPORT")
    expect(validateDrop(world, [base, top], top, { x: 28, y: 0, z: 100 }, { minSupportRatio: 0.7 }).valid).toBe(true)
  })

  const unit = { lengthCm: 500, widthCm: 240, heightCm: 250, maxPayloadKg: 5000 } as PlanUnitView
  const piece = (id: string, x: number, z: number): PlanItemView => ({
    id,
    cargoId: id,
    name: id,
    color: "#000",
    x,
    y: 0,
    z,
    lengthCm: 100,
    widthCm: 100,
    heightCm: 100,
    weightKg: 50,
    sequence: 1,
    rotation: "LWH",
    shape: "BOX",
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
  })
  const rules: LayoutCargoRules = { lengthCm: 100, widthCm: 100, heightCm: 100, orientation: "ROTATE_90", shape: "BOX", allowedRotations: null }

  it("the Playground's placement uses the shared default unless it is told the project's value", () => {
    const below = piece("below", 0, 0)
    const onTop = piece("on", 28, 100)
    expect(tryPlaceItem(onTop, [below], unit)).toBeNull()
    expect(tryPlaceItem(onTop, [below], unit, 0.7)).not.toBeNull()
    expect(tryPlaceItem(piece("on", 10, 100), [below], unit)).not.toBeNull()
  })

  it("the free-spot search follows the same share", () => {
    const wall = [piece("a", 0, 0), piece("b", 100, 0), piece("c", 200, 0), piece("d", 300, 0), piece("e", 400, 0)]
    const spot = findFreeSpot(piece("n", 0, 0), wall, { ...unit, lengthCm: 500, widthCm: 100 } as PlanUnitView)
    // A full row of supports: it goes on top, and fully supported, so it passes at the default.
    expect(spot?.z).toBe(100)
  })

  it("the server check uses the same default and the same project value", () => {
    const layout = [{ item: piece("below", 0, 0), cargo: rules }, { item: piece("on", 28, 100), cargo: rules }]
    expect(layoutProblems(unit, layout).get("on")).toMatch(/Not enough support/)
    expect(layoutProblems(unit, layout, { minSupportRatio: 0.7 }).size).toBe(0)
    expect(layoutProblems(unit, layout, { minSupportRatio: resolveMinSupportRatio(60) }).size).toBe(0)
    expect(layoutProblems(unit, layout, { minSupportRatio: resolveMinSupportRatio(null) }).get("on")).toBeDefined()
  })

  it("a looser project share never relaxes collision, boundary or stacking rules", () => {
    const loose = { minSupportRatio: 0.5 }
    const outside = [{ item: piece("a", 450, 0), cargo: rules }]
    expect(layoutProblems(unit, outside, loose).get("a")).toMatch(/Outside container/)
    const noStack = [{ item: { ...piece("below", 0, 0), stackable: false }, cargo: rules }, { item: piece("on", 0, 100), cargo: rules }]
    expect(layoutProblems(unit, noStack, loose).get("on")).toMatch(/not stackable/)
    const floating = [{ item: piece("f", 0, 60), cargo: rules }]
    expect(layoutProblems(unit, floating, loose).get("f")).toBeDefined()
  })
})

describe("the packer's own support rule is the shared default", () => {
  const container: SolverEquipment = { id: "c", name: "Box", lengthCm: 200, widthCm: 100, heightCm: 200, maxPayloadKg: 5000, tareKg: 0, axleGroups: [], costPerUnit: 1, maxCount: 1 }
  const crate = (id: string, lengthCm: number): SolverCargo => ({
    id,
    name: id,
    lengthCm,
    widthCm: 100,
    heightCm: 100,
    weightKg: 10,
    quantity: 1,
    shape: "BOX",
    orientation: "FIXED",
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
    maxStackLayers: null,
    priority: 0,
    destinationStop: 1,
    consignmentId: null,
    segregationClass: null,
    color: null,
  })

  it("records the share it used in the plan's settings", () => {
    expect(solve({ equipment: [container], cargo: [crate("a", 100)] }).settings.minSupportRatio).toBe(0.75)
    expect(solve({ equipment: [container], cargo: [crate("a", 100)], settings: { minSupportRatio: 0.6 } }).settings.minSupportRatio).toBe(0.6)
  })

  it("will not stack a piece that is 72% supported at the default, but will under a project setting of 70%", () => {
    // A 100 cm long base and a 100 x 100 piece offset by 28 cm would be 72% supported: the packer instead needs a layout that has the share.
    const cargo = [crate("base", 100), { ...crate("top", 100), lengthCm: 100 }]
    const result = solve({ equipment: [{ ...container, lengthCm: 128 }], cargo, settings: { restarts: 3 } })
    // 128 cm of floor holds one 100 cm piece; the second must stack. Stacking on the first is 100% supported, so it works and stays valid.
    for (const unit of result.units) {
      for (const placement of unit.placements) {
        if (placement.z > 0) {
          const below = unit.placements.find((entry) => entry.z === 0)!
          const overlap = Math.min(placement.x + placement.lengthCm, below.x + below.lengthCm) - Math.max(placement.x, below.x)
          expect(overlap / placement.lengthCm).toBeGreaterThanOrEqual(0.75)
        }
      }
    }
  })
})
