import { describe, expect, it } from "vitest"
import { cargoItemInputSchema } from "@compass/domain"
import type { CargoLine } from "@/components/cargo-grid"
import { cargoPreset } from "@/lib/cargo-defaults"
import { cargoSignature, isPlanStale } from "@/lib/plan-staleness"
import type { PlanItemView, PlanUnitView, PlanView } from "@/lib/plan-view"
import { capacityUnits, cargoToAdd, checkExtraCargo, describeStop, extraCargoInput, extraCargoProblems, isFitCurrent, remainingCapacity, type ExtraCargo } from "@/lib/remaining-capacity"

// Synthetic plans only. Sizes in cm, weights in kg.

function line(id: string, extra: Partial<CargoLine> = {}): CargoLine {
  return { ...cargoPreset("BOX"), id, updatedAt: "2026-01-01T00:00:00.000Z", name: `Crate ${id}`, lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 100, orientation: "FIXED", stackable: false, ...extra }
}

function item(cargoId: string, x: number, extra: Partial<PlanItemView> = {}): PlanItemView {
  return { id: `${cargoId}-${x}`, cargoId, name: `Crate ${cargoId}`, color: "#888888", x, y: 0, z: 0, lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 100, sequence: 1, rotation: "LWH", shape: "BOX", ...extra }
}

function planOf(items: PlanItemView[], spec: Partial<PlanUnitView> = {}): PlanView {
  const unit: PlanUnitView = {
    unitIndex: 0,
    equipmentId: "e1",
    equipmentName: "Test box",
    equipmentMode: "ROAD",
    oogClass: "NONE",
    heightOpen: false,
    contour: null,
    lengthCm: 300,
    widthCm: 100,
    heightCm: 100,
    maxPayloadKg: 10_000,
    pieces: items.length,
    netKg: 0,
    grossKg: 0,
    volumeM3: 0,
    volumePct: 0,
    floorPct: 0,
    weightPct: 0,
    remainingKg: 0,
    remainingM3: 0,
    tareKg: 0,
    usedLengthCm: 0,
    usedWidthCm: 0,
    usedHeightCm: 0,
    cog: { x: 0, y: 0, z: 0 },
    axleLoads: [],
    items,
    ...spec,
  }
  return { seed: 1, elapsedMs: 0, totalCost: 0, warnings: [], units: [unit], unloaded: [] }
}

const extra = (overrides: Partial<ExtraCargo> = {}): ExtraCargo => ({ name: "", lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 50, quantity: 1, stackable: false, bottomOnly: false, orientation: "FIXED", ...overrides })

describe("the plan as the analysis sees it", () => {
  it("takes every piece where it stands, with the unit's own size and limits", () => {
    const plan = planOf([item("a", 0), item("a", 120)])
    const [unit] = capacityUnits(plan)
    expect(unit!.equipment).toMatchObject({ lengthCm: 300, widthCm: 100, heightCm: 100, maxPayloadKg: 10_000 })
    expect(unit!.pieces.map((entry) => entry.x)).toEqual([0, 120])
  })
})

describe("remaining capacity of a plan", () => {
  it("counts more identical packages for uniform cargo", () => {
    const report = remainingCapacity(planOf([item("a", 0)]), [line("a")])
    expect(report.validated).toBe(true)
    expect(report.context.provisional).toBe(false)
    expect(report.additional).toMatchObject({ pieces: 2, potentialTotalPieces: 3 })
  })

  it("is provisional when a weight in the plan is only an estimate", () => {
    const report = remainingCapacity(planOf([item("a", 0)]), [line("a", { weightEstimate: { perPieceKg: 100, basis: "equal share" } })])
    expect(report.context.provisional).toBe(true)
    expect(report.context.provisionalReasons[0]).toContain("estimated weight")
  })

  it("is provisional when a cargo line has no weight and so is not in the plan", () => {
    const report = remainingCapacity(planOf([item("a", 0)]), [line("a"), line("b", { weightKg: 0 })])
    expect(report.context.provisional).toBe(true)
    expect(report.context.excludedLines).toEqual(["Crate b"])
  })

  it("never stacks on cargo whose stacking is not stated, and says so", () => {
    const report = remainingCapacity(planOf([item("a", 0)], { lengthCm: 100, heightCm: 200 }), [line("a", { stackable: false, stackableNotStated: true })])
    expect(report.context.stackingNotStated).toEqual(["Crate a"])
    expect(report.additional!.pieces).toBe(0)
    expect(report.units[0]!.restrictedM3).toBe(1)
  })

  it("is not validated when the layout check finds a problem the packer's rules do not", () => {
    // A fixed-orientation line placed turned: the same check the server runs on a saved layout catches it.
    const turned = item("a", 0, { lengthCm: 50, widthCm: 100, rotation: "WLH" })
    const report = remainingCapacity(planOf([turned]), [line("a", { lengthCm: 100, widthCm: 50 })])
    expect(report.context.layoutProblems.length).toBeGreaterThan(0)
    expect(report.validated).toBe(false)
  })

  it("is not validated when pieces overlap", () => {
    const report = remainingCapacity(planOf([item("a", 0), item("a", 50)]), [line("a")])
    expect(report.validated).toBe(false)
  })
})

describe("describing why adding stopped", () => {
  it("tells a physical limit from the simulation's own bounds", () => {
    expect(describeStop({ kind: "physical", factor: "payload", reason: "TOO_HEAVY", message: "No more fit." })).toMatchObject({ label: "Payload", physical: true })
    expect(describeStop({ kind: "time-limit", message: "" })).toMatchObject({ physical: false, label: "Simulation time limit" })
    expect(describeStop({ kind: "iteration-limit", message: "" })).toMatchObject({ physical: false })
  })
})

describe("checking extra cargo", () => {
  it("finds where it fits without changing the plan or the cargo", () => {
    const plan = planOf([item("a", 0)])
    const cargo = [line("a")]
    const before = JSON.stringify({ plan, cargo })
    const check = checkExtraCargo(plan, cargo, extra({ quantity: 3 }))
    expect(check).toMatchObject({ requested: 3, placed: 2, notPlaced: 1, allFit: false })
    expect(check.stop).toMatchObject({ kind: "physical", factor: "space" })
    expect(JSON.stringify({ plan, cargo })).toBe(before)
  })

  it("asks for sizes, a weight and a sensible quantity before checking", () => {
    expect(extraCargoProblems(extra())).toEqual([])
    expect(extraCargoProblems(extra({ lengthCm: 0 }))).not.toEqual([])
    expect(extraCargoProblems(extra({ weightKg: 0 }))).not.toEqual([])
    expect(extraCargoProblems(extra({ quantity: 0 }))).not.toEqual([])
    expect(extraCargoProblems(extra({ quantity: 501 }))).not.toEqual([])
  })
})

describe("adding the checked cargo to the cargo list", () => {
  it("sends a line the cargo validation accepts, not stackable unless chosen", () => {
    const input = extraCargoInput(extra({ quantity: 4 }))
    expect(cargoItemInputSchema.safeParse(input).success).toBe(true)
    expect(input).toMatchObject({ name: "Additional cargo", quantity: 4, stackable: false })
  })

  it("makes the calculated plan out of date once the line exists", () => {
    const cargo = [{ ...line("a"), updatedAt: new Date("2026-01-01"), customFields: null }]
    const plan = { createdAt: new Date("2026-01-01"), settings: { cargoSignature: cargoSignature(cargo) } }
    expect(isPlanStale(plan, cargo)).toBe(false)
    const added = { ...extraCargoInput(extra()), id: "new", updatedAt: new Date("2026-01-02"), customFields: null }
    expect(isPlanStale(plan, [...cargo, added])).toBe(true)
  })
})

describe("adding only what fits", () => {
  // A 300 cm unit with one 100 cm crate in it has room for exactly two more.
  const plan = () => planOf([item("a", 0)])
  const cargo = () => [line("a")]

  it("adds the full quantity when everything fits", () => {
    const result = checkExtraCargo(plan(), cargo(), extra({ quantity: 2 }))
    expect(result).toMatchObject({ requested: 2, placed: 2, notPlaced: 0, allFit: true })
    expect(cargoToAdd(result)).toMatchObject({ quantity: 2 })
  })

  it("adds only the fitted quantity when some do not fit, never the quantity asked for", () => {
    const result = checkExtraCargo(plan(), cargo(), extra({ quantity: 4 }))
    expect(result).toMatchObject({ requested: 4, placed: 2, notPlaced: 2, allFit: false })
    const toAdd = cargoToAdd(result)!
    expect(toAdd.quantity).toBe(2)
    expect(cargoItemInputSchema.safeParse(toAdd).success).toBe(true)
    // The rest of the line is what was checked.
    expect(toAdd).toMatchObject({ lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 50, stackable: false, orientation: "FIXED" })
  })

  it("offers nothing to add when none fit", () => {
    const full = planOf([item("a", 0), item("a", 100), item("a", 200)])
    const result = checkExtraCargo(full, cargo(), extra({ quantity: 4 }))
    expect(result).toMatchObject({ requested: 4, placed: 0, notPlaced: 4 })
    expect(cargoToAdd(result)).toBeNull()
  })

  it("keeps the provisional flag with the result, so it is shown before anything is added", () => {
    const result = checkExtraCargo(plan(), [line("a", { weightEstimate: { perPieceKg: 100, basis: "equal share" } })], extra({ quantity: 1 }))
    expect(result.context.provisional).toBe(true)
    expect(cargoToAdd(result)).toMatchObject({ quantity: 1 })
  })
})

describe("a fit check that no longer matches", () => {
  const base = () => ({ plan: planOf([item("a", 0)]), cargo: [line("a")] })

  it("stays current for the same plan and cargo, even as new objects after a re-render", () => {
    const { plan, cargo } = base()
    const result = checkExtraCargo(plan, cargo, extra(), { minSupportPct: 75 })
    const again = base()
    expect(isFitCurrent(result, again.plan, again.cargo, 75)).toBe(true)
  })

  it("is stale once a planned piece moves", () => {
    const { plan, cargo } = base()
    const result = checkExtraCargo(plan, cargo, extra())
    expect(isFitCurrent(result, planOf([item("a", 100)]), cargo, null)).toBe(false)
  })

  it("is stale once the cargo changes or a line is added", () => {
    const { plan, cargo } = base()
    const result = checkExtraCargo(plan, cargo, extra())
    expect(isFitCurrent(result, plan, [line("a", { weightKg: 120 })], null)).toBe(false)
    expect(isFitCurrent(result, plan, [...cargo, line("b")], null)).toBe(false)
    expect(isFitCurrent(result, plan, [line("a", { stackable: true })], null)).toBe(false)
  })

  it("is stale once the support share changes", () => {
    const { plan, cargo } = base()
    const result = checkExtraCargo(plan, cargo, extra(), { minSupportPct: 75 })
    expect(isFitCurrent(result, plan, cargo, 60)).toBe(false)
  })

  it("does not describe different input values", () => {
    const { plan, cargo } = base()
    const result = checkExtraCargo(plan, cargo, extra({ quantity: 2 }))
    expect(isFitCurrent({ ...result, extra: extra({ quantity: 3 }) }, plan, cargo, null)).toBe(false)
    expect(isFitCurrent({ ...result, extra: extra({ quantity: 2, weightKg: 60 }) }, plan, cargo, null)).toBe(false)
  })

  it("keeps a copy of the values it was made with, unaffected by later edits", () => {
    const { plan, cargo } = base()
    const entered = extra({ quantity: 2 })
    const result = checkExtraCargo(plan, cargo, entered)
    entered.quantity = 9
    expect(result.extra.quantity).toBe(2)
    expect(isFitCurrent(result, plan, cargo, null)).toBe(true)
  })
})
