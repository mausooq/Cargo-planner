import { floorUtilization } from "@compass/physics"
import { solve, type SolverCargo, type SolverEquipment, type SolverResult } from "@compass/solver"
import { describe, expect, it } from "vitest"
import { applyGravity } from "@/lib/cargo-gravity"
import { liveMetrics, metricBoxesOf } from "@/lib/plan-metrics"
import { summaryRows } from "@/lib/plan-export"
import { planFromDb } from "@/lib/plan-from-db"
import { toPlanView, withMetrics, type PlanItemView, type PlanUnitView, type PlanView } from "@/lib/plan-view"

const container: SolverEquipment = {
  id: "hc40",
  name: "40ft HC",
  lengthCm: 1203,
  widthCm: 235,
  heightCm: 270,
  maxPayloadKg: 26000,
  tareKg: 3900,
  axleGroups: [],
  costPerUnit: 1350,
  maxCount: 1,
}

function line(partial: Partial<SolverCargo> & Pick<SolverCargo, "id">): SolverCargo {
  return {
    name: partial.id,
    lengthCm: 117,
    widthCm: 77,
    heightCm: 90,
    weightKg: 180,
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

/** A mixed shipment whose sides are not multiples of 5 cm, which is what exposed the old mismatch. */
const shipment = [
  line({ id: "crate", quantity: 18 }),
  line({ id: "carton", lengthCm: 83.3, widthCm: 41.7, heightCm: 61.4, weightKg: 22.5, quantity: 24 }),
  line({ id: "drum", shape: "CYLINDER_DRUM", orientation: "FIXED", lengthCm: 58, widthCm: 58, heightCm: 88, weightKg: 210, quantity: 8, bottomOnly: true }),
  line({ id: "pipe", shape: "PIPE", lengthCm: 237.5, widthCm: 21, heightCm: 21, weightKg: 60, quantity: 6 }),
]

function planOf(result: SolverResult, cargo: SolverCargo[]): PlanView {
  return toPlanView(
    result,
    [
      {
        id: container.id,
        name: container.name,
        mode: "SEA",
        oogClass: "NONE",
        heightOpen: false,
        contour: null,
        lengthCm: container.lengthCm,
        widthCm: container.widthCm,
        heightCm: container.heightCm,
        maxPayloadKg: container.maxPayloadKg,
      },
    ],
    cargo.map((item) => ({
      id: item.id,
      name: item.name,
      weightKg: item.weightKg,
      color: null,
      shape: item.shape,
      stackable: item.stackable,
      bottomOnly: item.bottomOnly,
    })),
  )
}

/** The calculation the Playground used before: a 5 cm grid, each piece rounded outward. Kept here only to prove the regression. */
function legacyGridFloorPct(items: PlanItemView[], unit: { lengthCm: number; widthCm: number }): number {
  const cell = 5
  const cols = Math.ceil(unit.lengthCm / cell)
  const rows = Math.ceil(unit.widthCm / cell)
  const covered = new Uint8Array(cols * rows)
  for (const item of items) {
    if (item.z > 0.5) continue
    const x0 = Math.max(0, Math.floor(item.x / cell))
    const x1 = Math.min(cols, Math.ceil((item.x + item.lengthCm) / cell))
    const y0 = Math.max(0, Math.floor(item.y / cell))
    const y1 = Math.min(rows, Math.ceil((item.y + item.widthCm) / cell))
    for (let x = x0; x < x1; x += 1) for (let y = y0; y < y1; y += 1) covered[x * rows + y] = 1
  }
  return (covered.reduce((sum, value) => sum + value, 0) / covered.length) * 100
}

/** What the database would hold for this plan after it was saved. */
function asSaved(plan: PlanView, cargo: SolverCargo[], extraMetrics: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  return {
    seed: 1,
    settings,
    summary: { totalCost: 0, elapsedMs: 1, warnings: plan.warnings },
    unloaded: [],
    instances: plan.units.map((unit, index) => ({
      sequence: index + 1,
      equipmentTypeId: unit.equipmentId,
      metrics: {
        netKg: unit.netKg,
        grossKg: unit.grossKg,
        volumeM3: unit.volumeM3,
        volumePct: unit.volumePct,
        floorPct: unit.floorPct,
        weightPct: unit.weightPct,
        remainingKg: unit.remainingKg,
        remainingM3: unit.remainingM3,
        usedLengthCm: unit.usedLengthCm,
        usedWidthCm: unit.usedWidthCm,
        usedHeightCm: unit.usedHeightCm,
        cog: unit.cog,
        axleLoads: unit.axleLoads,
        pieces: unit.pieces,
        ...extraMetrics,
      },
      equipmentType: {
        id: container.id,
        name: container.name,
        mode: "SEA",
        oogClass: "NONE",
        heightOpen: false,
        contour: null,
        innerLengthCm: container.lengthCm,
        innerWidthCm: container.widthCm,
        innerHeightCm: container.heightCm,
        maxPayloadKg: container.maxPayloadKg,
        tareKg: container.tareKg,
      },
      placements: unit.items.map((item) => {
        const source = cargo.find((entry) => entry.id === item.cargoId)!
        return {
          cargoItemId: item.cargoId,
          instanceIndex: Number(item.id.slice(item.cargoId.length + 1)),
          xCm: item.x,
          yCm: item.y,
          zCm: item.z,
          lengthCm: item.lengthCm,
          widthCm: item.widthCm,
          heightCm: item.heightCm,
          rotation: item.rotation,
          cargoItem: {
            name: source.name,
            sku: null,
            weightKg: source.weightKg,
            color: null,
            shape: source.shape,
            stackable: source.stackable,
            bottomOnly: source.bottomOnly,
            maxStackLoadKg: null,
          },
        }
      }),
    })),
  }
}

describe("no-grid regression (the 13.8% vs 15.8% mismatch)", () => {
  const result = solve({ equipment: [container], cargo: shipment, settings: { restarts: 4 } })
  const plan = planOf(result, shipment)
  const unit = plan.units[0]!

  it("packs the shipment onto the floor so the comparison is meaningful", () => {
    expect(result.unloaded).toEqual([])
    expect(unit.items.some((item) => item.z <= 0.5)).toBe(true)
  })

  it("the old grid misreported floor use for a typical light load; the shared figure is exact", () => {
    // A light load (about 15% of the floor) of pieces whose sides are not multiples of 5 cm.
    const light = [
      line({ id: "crate", quantity: 6 }),
      line({ id: "carton", lengthCm: 83.3, widthCm: 41.7, heightCm: 61.4, weightKg: 22.5, quantity: 9, stackable: false }),
      line({ id: "pipe", shape: "PIPE", lengthCm: 237.5, widthCm: 21, heightCm: 21, weightKg: 60, quantity: 2 }),
    ]
    const lightUnit = planOf(solve({ equipment: [container], cargo: light, settings: { restarts: 3 } }), light).units[0]!
    const exactPct = floorUtilization(metricBoxesOf(lightUnit.items), lightUnit).pct
    const oldPct = legacyGridFloorPct(lightUnit.items, lightUnit)
    expect(exactPct).toBeLessThan(40)
    expect(Math.abs(oldPct - exactPct)).toBeGreaterThan(0.3)
    expect(liveMetrics(lightUnit.items, lightUnit).floorPct).toBe(Math.round(exactPct * 10) / 10)
    expect(liveMetrics(lightUnit.items, lightUnit).floorPct).toBe(lightUnit.floorPct)
  })

  it("agrees with the solver figure for the dense shipment too", () => {
    expect(liveMetrics(unit.items, unit).floorPct).toBe(unit.floorPct)
  })

  it("is exact for the simple three-piece case that showed the effect", () => {
    const three = [0, 1, 2].map(
      (index): PlanItemView => ({
        id: `p-${index}`,
        cargoId: "p",
        name: "p",
        color: "#000",
        x: index === 1 ? 117 : 0,
        y: index === 2 ? 77 : 0,
        z: 0,
        lengthCm: 117,
        widthCm: 77,
        heightCm: 90,
        weightKg: 10,
        sequence: index + 1,
        rotation: "LWH",
        shape: "BOX",
      }),
    )
    const exact = ((3 * 117 * 77) / (1203 * 235)) * 100
    expect(legacyGridFloorPct(three, container)).toBeGreaterThan(exact)
    expect(liveMetrics(three, container).floorPct).toBe(Math.round(exact * 10) / 10)
  })

  it("does not depend on where a piece sits relative to a grid", () => {
    const base = unit.items.filter((item) => item.z <= 0.5).slice(0, 6)
    const shifted = base.map((item) => ({ ...item, x: item.x + 0.37, y: item.y + 0.11 }))
    const a = liveMetrics(base, unit).floorPct
    const b = liveMetrics(shifted, unit).floorPct
    expect(Math.abs(a - b)).toBeLessThanOrEqual(0.1)
  })
})

describe("one layout, the same numbers on every screen", () => {
  const cargo = shipment.map((item) => ({ ...item, quantity: Math.ceil(item.quantity / 2) }))
  const result = solve({ equipment: [container], cargo, settings: { restarts: 3, timeLimitMs: 2000 } })
  const plan = planOf(result, cargo)
  const unit = plan.units[0]!

  it("Calculate table, Load Plan header, Playground and Excel agree", () => {
    const live = liveMetrics(unit.items, unit)
    const row = summaryRows(plan)[0]!
    expect(live.floorPct).toBe(unit.floorPct)
    expect(row["Floor utilization (%)"]).toBe(unit.floorPct)
    expect(live.remainingKg).toBe(unit.remainingKg)
    expect(live.remainingM3).toBeCloseTo(unit.remainingM3, 3)
    expect(live.netKg).toBe(unit.netKg)
    expect(live.volumePct).toBe(unit.volumePct)
    expect(live.weightPct).toBe(unit.weightPct)
  })

  it("there is one floor figure, and no second one", () => {
    expect(Object.keys(unit)).not.toContain("floorEffectivePct")
    expect(Object.keys(unit)).not.toContain("floorActualPct")
    expect(Object.keys(summaryRows(plan)[0]!).filter((key) => /floor/i.test(key))).toEqual(["Floor utilization (%)"])
  })

  it("packs everything and leaves nothing colliding", () => {
    expect(result.unloaded).toEqual([])
  })

  it("a saved and reloaded plan shows the same figures", () => {
    const reloaded = planFromDb(asSaved(plan, cargo) as never).units[0]!
    expect(reloaded.floorPct).toBe(unit.floorPct)
    expect(reloaded.remainingKg).toBe(unit.remainingKg)
    expect(liveMetrics(reloaded.items, reloaded).floorPct).toBe(unit.floorPct)
  })
})

describe("plans saved by earlier versions", () => {
  const cargo = [line({ id: "a", quantity: 6 }), line({ id: "b", lengthCm: 83.3, widthCm: 41.7, heightCm: 61.4, quantity: 5 })]
  const plan = planOf(solve({ equipment: [container], cargo, settings: { restarts: 2 } }), cargo)
  const exact = plan.units[0]!.floorPct

  it("shows the exact floor figure from the saved positions, whatever figure was stored", () => {
    // A plan from before the exact calculation stored a grid-rounded figure.
    const gridRounded = planFromDb(asSaved(plan, cargo, { floorPct: 99.9 }) as never).units[0]!
    expect(gridRounded.floorPct).toBe(exact)
    // A plan from the clearance versions also stored an actual and an effective figure.
    const withEffective = planFromDb(asSaved(plan, cargo, { floorPct: exact, floorActualPct: exact, floorEffectivePct: exact + 12 }) as never).units[0]!
    expect(withEffective.floorPct).toBe(exact)
    expect(Object.keys(withEffective)).not.toContain("floorEffectivePct")
  })

  it("opens a plan that still carries clearance settings, and ignores them", () => {
    const saved = asSaved(plan, cargo, { floorEffectivePct: 70 }, { clearanceCm: 12, clearanceConfig: { defaultCm: 12, lines: { a: 5 } }, layoutSource: "MANUAL", cargoSignature: "abc" })
    const reloaded = planFromDb(saved as never)
    expect(reloaded.units[0]!.floorPct).toBe(exact)
    expect(reloaded.layoutSource).toBe("MANUAL")
    expect(reloaded.units[0]!.items).toHaveLength(plan.units[0]!.items.length)
    expect(JSON.stringify(reloaded)).not.toMatch(/clearance/i)
  })

  it("keeps the saved positions and turns exactly as they were", () => {
    const reloaded = planFromDb(asSaved(plan, cargo) as never).units[0]!
    expect(reloaded.items.map((item) => [item.x, item.y, item.z, item.lengthCm, item.widthCm, item.heightCm, item.rotation])).toEqual(
      plan.units[0]!.items.map((item) => [item.x, item.y, item.z, item.lengthCm, item.widthCm, item.heightCm, item.rotation]),
    )
  })

  it("a plan with no pieces shows no floor use", () => {
    const empty = asSaved({ ...plan, units: [{ ...plan.units[0]!, items: [], pieces: 0 }] }, cargo, { floorPct: 55 })
    expect(planFromDb(empty as never).units[0]!.floorPct).toBe(0)
  })
})

describe("live metrics follow manual changes", () => {
  const cargo = [line({ id: "a", quantity: 6, weightKg: 150 })]
  const result = solve({ equipment: [container], cargo, settings: { restarts: 2 } })
  const unit = planOf(result, cargo).units[0]!

  it("recomputes from the items alone, so undo and reset give back the earlier numbers", () => {
    const before = liveMetrics(unit.items, unit)
    const moved = unit.items.map((item, index) => (index === 0 ? { ...item, x: item.x + 150, y: item.y + 3.3 } : item))
    const afterMove = liveMetrics(moved, unit)
    expect(afterMove.cog).not.toEqual(before.cog)
    // Undo and Reset put the same items back: the numbers return exactly.
    expect(liveMetrics(unit.items, unit)).toEqual(before)
    expect(liveMetrics([...unit.items], { ...unit })).toEqual(before)
  })

  it("counts loaded and set-aside pieces and frees capacity when a piece is taken out", () => {
    const full = liveMetrics(unit.items, unit)
    const removed = liveMetrics(unit.items.slice(1), unit, 1)
    expect(removed.pieces).toBe(full.pieces - 1)
    expect(removed.setAside).toBe(1)
    expect(removed.netKg).toBeCloseTo(full.netKg - 150, 6)
    expect(removed.remainingKg).toBeCloseTo(full.remainingKg + 150, 6)
    expect(removed.remainingM3).toBeGreaterThan(full.remainingM3)
    expect(removed.floorPct).toBeLessThanOrEqual(full.floorPct)
    expect(liveMetrics([], unit).netKg).toBe(0)
  })

  it("adding a piece back restores the earlier figures", () => {
    const full = liveMetrics(unit.items, unit)
    const without = liveMetrics(unit.items.slice(1), unit, 1)
    const back = liveMetrics(unit.items, unit, 0)
    expect(without.floorPct).not.toBe(full.floorPct)
    expect(back).toEqual(full)
  })

  it("gravity after a move does not change the footprint figures of pieces that stay on the floor", () => {
    const settled = applyGravity(unit.items, unit).items
    expect(liveMetrics(settled, unit).floorPct).toBe(liveMetrics(unit.items, unit).floorPct)
  })

  it("applying server metrics to a unit keeps the screen in step", () => {
    const next: PlanUnitView = withMetrics(unit, { ...result.units[0]!.metrics, floorPct: 40, remainingKg: 12 })
    expect(next.floorPct).toBe(40)
    expect(next.remainingKg).toBe(12)
    expect(next.items).toBe(unit.items)
  })
})

describe("axle values are an estimate", () => {
  it("uses cargo weight only and is flagged as a warning, not a certification", () => {
    const groups = [
      { name: "Front", positionFromFrontCm: 0, maxKg: 100 },
      { name: "Rear", positionFromFrontCm: 1200, maxKg: 20000 },
    ]
    const unit = { lengthCm: 1203, widthCm: 235, heightCm: 270, maxPayloadKg: 26000, tareKg: 3900, axleLoads: groups.map((group) => ({ ...group, kg: 0 })) }
    const items: PlanItemView[] = [
      { id: "h-0", cargoId: "h", name: "Heavy", color: "#000", x: 0, y: 70, z: 0, lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 900, sequence: 1, rotation: "LWH", shape: "BOX" },
    ]
    const live = liveMetrics(items, unit)
    expect(live.axleLoads[0]!.kg).toBeGreaterThan(100)
    expect(live.warnings.some((entry) => /estimated over its limit/.test(entry))).toBe(true)
  })
})
