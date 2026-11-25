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

  it("reads a plan saved before this feature: both floor figures equal the old floorPct", () => {
    const unit = planFromDb(dbPlan(legacyMetrics) as never).units[0]!
    expect(unit.floorActualPct).toBe(13.8)
    expect(unit.floorEffectivePct).toBe(13.8)
    expect(unit.floorPct).toBe(13.8)
  })

  it("fills remaining capacity and tare for an old plan from the equipment limits", () => {
    const unit = planFromDb(dbPlan(legacyMetrics) as never).units[0]!
    expect(unit.remainingKg).toBe(25800)
    expect(unit.remainingM3).toBeCloseTo((1203 * 235 * 270) / 1_000_000 - 1.6, 6)
    expect(unit.tareKg).toBe(3900)
  })

  it("treats a missing or empty settings value as no allowance, for the plan and every piece", () => {
    for (const settings of [undefined, null, {}, { clearanceCm: "bad" }]) {
      const plan = planFromDb(dbPlan(legacyMetrics, { settings }) as never)
      expect(plan.clearanceCm).toBe(0)
      expect(plan.units[0]!.items.every((item) => item.clearanceCm === 0)).toBe(true)
    }
  })

  it("still reads a plan with no maxStackLoadKg or customFields on its cargo", () => {
    const unit = planFromDb(dbPlan(legacyMetrics) as never).units[0]!
    expect(unit.items).toHaveLength(2)
    expect(unit.items[0]).toMatchObject({ stackable: true, bottomOnly: false, maxStackLoadKg: null })
  })

  it("reads new metrics as saved", () => {
    const metrics = { ...legacyMetrics, floorPct: 13.8, floorActualPct: 13.8, floorEffectivePct: 16.1, remainingKg: 25800, remainingM3: 80.1 }
    const unit = planFromDb(dbPlan(metrics, { settings: { clearanceCm: 5 } }) as never).units[0]!
    expect(unit.floorActualPct).toBe(13.8)
    expect(unit.floorEffectivePct).toBe(16.1)
    expect(unit.remainingKg).toBe(25800)
    expect(unit.remainingM3).toBe(80.1)
  })

  it("prefers the new actual figure over a stale floorPct", () => {
    const unit = planFromDb(dbPlan({ ...legacyMetrics, floorPct: 99, floorActualPct: 13.8 }) as never).units[0]!
    expect(unit.floorPct).toBe(13.8)
  })

  it("uses the plan's saved project allowance, and a cargo line's own override first", () => {
    const placements = [
      row("c1", 0, 0),
      row("c2", 0, 117, {}, { customFields: { clearanceCm: 3 } }),
      row("c3", 0, 234, {}, { customFields: { clearanceCm: 0 } }),
      row("c4", 0, 351, {}, { customFields: { allowedRotations: "LWH,WLH" } }),
    ]
    const plan = planFromDb(dbPlan(legacyMetrics, { settings: { clearanceCm: 8 }, placements }) as never)
    expect(plan.clearanceCm).toBe(8)
    expect(plan.units[0]!.items.map((item) => item.clearanceCm)).toEqual([8, 3, 0, 8])
  })

  it("ignores nonsense overrides instead of failing", () => {
    const placements = [row("c1", 0, 0, {}, { customFields: { clearanceCm: -4 } }), row("c2", 0, 117, {}, { customFields: "text" })]
    const plan = planFromDb(dbPlan(legacyMetrics, { settings: { clearanceCm: 2 }, placements }) as never)
    expect(plan.units[0]!.items.map((item) => item.clearanceCm)).toEqual([2, 2])
  })
})
