import { describe, expect, it } from "vitest"
import { planFromDb } from "@/lib/plan-from-db"

const equipmentType = {
  id: "eq1",
  name: "40ft HC",
  mode: "SEA",
  oogClass: "NONE",
  heightOpen: false,
  contour: null,
  innerLengthCm: 1203,
  innerWidthCm: 235,
  innerHeightCm: 270,
  maxPayloadKg: 26000,
  tareKg: 3900,
}

function row(cargoItemId: string, instanceIndex: number, x: number, extra: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  return {
    cargoItemId,
    instanceIndex,
    xCm: x,
    yCm: 0,
    zCm: 0,
    lengthCm: 117,
    widthCm: 77,
    heightCm: 90,
    rotation: "LWH",
    cargoItem: { name: "Crate", sku: null, weightKg: 100, color: null, shape: "BOX", stackable: true, bottomOnly: false, ...item },
    ...extra,
  }
}

function dbPlan(metrics: Record<string, unknown>, extra: { settings?: unknown; placements?: ReturnType<typeof row>[] } = {}) {
  return {
    seed: 1,
    ...(extra.settings === undefined ? {} : { settings: extra.settings }),
    summary: { totalCost: 0, elapsedMs: 4, warnings: [] },
    unloaded: [],
    instances: [
      {
        sequence: 1,
        equipmentTypeId: "eq1",
        metrics,
        equipmentType,
        placements: extra.placements ?? [row("c1", 0, 0), row("c2", 0, 117)],
      },
    ],
  }
}

describe("planFromDb backward compatibility", () => {
  // What the solver stored before the two floor metrics existed: a single `floorPct`, no `settings`.
  const legacyMetrics = { netKg: 200, grossKg: 4100, volumeM3: 1.6, volumePct: 2, floorPct: 13.8, weightPct: 0.8, axleLoads: [] }
  // Two 117 x 77 pieces on the floor of a 1203 x 235 unit, to the tenth of a percent.
  const exactFloor = Math.round(((2 * 117 * 77) / (1203 * 235)) * 1000) / 10

  it("works the floor figure out from the saved positions, not from what was stored", () => {
    expect(exactFloor).toBe(6.4)
    // A stored figure that was rounded on a grid, wrongly high, is not trusted.
    expect(planFromDb(dbPlan(legacyMetrics) as never).units[0]!.floorPct).toBe(exactFloor)
    // Nor is one that is simply different.
    expect(planFromDb(dbPlan({ ...legacyMetrics, floorPct: 99 }) as never).units[0]!.floorPct).toBe(exactFloor)
  })

  it("has one floor figure: the effective and actual figures an earlier version stored are not carried", () => {
    const saved = { ...legacyMetrics, floorPct: 13.8, floorActualPct: 13.8, floorEffectivePct: 16.1 }
    const unit = planFromDb(dbPlan(saved) as never).units[0]!
    expect(unit.floorPct).toBe(exactFloor)
    expect(Object.keys(unit)).not.toContain("floorActualPct")
    expect(Object.keys(unit)).not.toContain("floorEffectivePct")
  })

  it("counts only pieces standing on the floor, and overlaps once", () => {
    const placements = [row("c1", 0, 0), row("c2", 0, 0, { zCm: 90 }), row("c3", 0, 58.5)]
    const unit = planFromDb(dbPlan(legacyMetrics, { placements }) as never).units[0]!
    // c1 covers 0..117, c3 covers 58.5..175.5: a union of 175.5 x 77.
    expect(unit.floorPct).toBe(Math.round(((175.5 * 77) / (1203 * 235)) * 1000) / 10)
  })

  it("shows no floor use for a plan with no pieces", () => {
    expect(planFromDb(dbPlan({ ...legacyMetrics, floorPct: 50 }, { placements: [] }) as never).units[0]!.floorPct).toBe(0)
  })

  it("fills remaining capacity and tare for an old plan from the equipment limits", () => {
    const unit = planFromDb(dbPlan(legacyMetrics) as never).units[0]!
    expect(unit.remainingKg).toBe(25800)
    expect(unit.remainingM3).toBeCloseTo((1203 * 235 * 270) / 1_000_000 - 1.6, 6)
    expect(unit.tareKg).toBe(3900)
  })

  it("still reads a plan with no maxStackLoadKg or customFields on its cargo", () => {
    const unit = planFromDb(dbPlan(legacyMetrics) as never).units[0]!
    expect(unit.items).toHaveLength(2)
    expect(unit.items[0]).toMatchObject({ stackable: true, bottomOnly: false, maxStackLoadKg: null })
  })

  it("reads saved remaining capacity as saved", () => {
    const unit = planFromDb(dbPlan({ ...legacyMetrics, remainingKg: 25700, remainingM3: 80.1 }) as never).units[0]!
    expect(unit.remainingKg).toBe(25700)
    expect(unit.remainingM3).toBe(80.1)
  })

  it("ignores clearance settings an earlier version kept on the plan and on its cargo", () => {
    const placements = [
      row("c1", 0, 0, {}, { customFields: { clearanceCm: 3 } }),
      row("c2", 0, 117, {}, { customFields: { clearanceSides: { front: 5, rear: 0, left: 0, right: 0 } } }),
      row("c3", 0, 234, {}, { customFields: { clearanceCm: -4 } }),
      row("c4", 0, 351, {}, { customFields: "text" }),
    ]
    const settings = { clearanceCm: 8, clearanceConfig: { defaultCm: 8, lines: { c1: 3 } }, layoutSource: "AUTO" }
    const plan = planFromDb(dbPlan(legacyMetrics, { settings, placements }) as never)
    expect(plan.units[0]!.items).toHaveLength(4)
    expect(JSON.stringify(plan)).not.toMatch(/clearance/i)
    // The positions are exactly what was saved.
    expect(plan.units[0]!.items.map((item) => item.x)).toEqual([0, 117, 234, 351])
  })

  it("still lists a piece an earlier version left out because of its clearance, with the explanation it saved", () => {
    const plan = {
      ...dbPlan(legacyMetrics),
      unloaded: [{ cargoItemId: "c9", reasonCode: "CLEARANCE", reasonDetail: "Crate fits a unit, but not with its handling clearance (up to 10 cm on a side).", cargoItem: { name: "Crate" } }],
    }
    const view = planFromDb(plan as never)
    expect(view.unloaded).toEqual([{ cargoId: "c9", name: "Crate", reason: "CLEARANCE", detail: "Crate fits a unit, but not with its handling clearance (up to 10 cm on a side)." }])
  })

  it("treats missing or nonsense settings as an automatic layout", () => {
    for (const settings of [undefined, null, {}, { layoutSource: "?" }, { clearanceCm: "bad" }]) {
      expect(planFromDb(dbPlan(legacyMetrics, { settings }) as never).layoutSource).toBe("AUTO")
    }
    expect(planFromDb(dbPlan(legacyMetrics, { settings: { layoutSource: "MANUAL" } }) as never).layoutSource).toBe("MANUAL")
  })
})
