import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn(), update: vi.fn((args: unknown) => ({ kind: "project", args })) },
    equipmentInstance: { update: vi.fn((args: unknown) => ({ kind: "instance", args })) },
    placement: { updateMany: vi.fn((args: unknown) => ({ kind: "placement", args })) },
    plan: { update: vi.fn((args: unknown) => ({ kind: "plan", args })) },
    $transaction: vi.fn(async (writes: unknown[]) => writes),
  },
}))

import { savePlanLayout } from "@/app/actions/plan"
import { planFromDb } from "@/lib/plan-from-db"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"

const requireUserMock = vi.mocked(requireUser)
const db = vi.mocked(prisma, true)

function user(role: "ADMIN" | "PLANNER" | "VIEWER" = "PLANNER") {
  return { id: "u1", role, orgId: "org-1", orgName: "Compass", name: "Demo", email: "planner@compass.local" }
}

const equipment = {
  id: "eq1",
  name: "Test trailer",
  mode: "ROAD",
  oogClass: "NONE",
  heightOpen: false,
  contour: null,
  innerLengthCm: 500,
  innerWidthCm: 240,
  innerHeightCm: 250,
  maxPayloadKg: 1000,
  tareKg: 100,
  axleGroups: [
    { name: "Front", positionFromFrontCm: 0, maxKg: 400 },
    { name: "Rear", positionFromFrontCm: 500, maxKg: 900 },
  ],
}

function cargoItem(extra: Record<string, unknown> = {}) {
  return {
    name: "Crate",
    sku: null,
    weightKg: 100,
    color: null,
    shape: "BOX",
    stackable: true,
    bottomOnly: false,
    maxStackLoadKg: null,
    customFields: null,
    lengthCm: 100,
    widthCm: 100,
    heightCm: 100,
    orientation: "ROTATE_90",
    ...extra,
  }
}

function placement(cargoItemId: string, instanceIndex: number, x: number, y: number, z: number, extra: Record<string, unknown> = {}, item = cargoItem()) {
  return { cargoItemId, instanceIndex, xCm: x, yCm: y, zCm: z, lengthCm: 100, widthCm: 100, heightCm: 100, rotation: "LWH", cargoItem: item, ...extra }
}

/** One unit with two crates side by side. `settings` and `warnings` mimic what the solver saved. */
function savedPlan(options: { settings?: Record<string, unknown>; warnings?: string[]; second?: [number, number, number] } = {}) {
  const [x2, y2, z2] = options.second ?? [200, 0, 0]
  return {
    id: "plan1",
    createdAt: new Date("2026-11-01"),
    seed: 1,
    settings: options.settings ?? {},
    summary: { totalCost: 0, elapsedMs: 5, restartsRun: 3, warnings: options.warnings ?? [] },
    unloaded: [],
    instances: [
      {
        id: "inst1",
        sequence: 1,
        equipmentTypeId: "eq1",
        // Deliberately stale numbers: the save must replace them.
        metrics: { netKg: 200, grossKg: 300, volumeM3: 2, volumePct: 1.7, floorPct: 99, weightPct: 20, axleLoads: [] },
        equipmentType: equipment,
        placements: [placement("c1", 0, 0, 0, 0), placement("c2", 0, x2, y2, z2)],
      },
    ],
  }
}

function sentRow(cargoId: string, x: number, y: number, z: number, extra: Record<string, unknown> = {}) {
  return { cargoId, instanceIndex: 0, x, y, z, lengthCm: 100, widthCm: 100, heightCm: 100, rotation: "LWH", ...extra }
}

function mockProject(plan: ReturnType<typeof savedPlan>, rules: Record<string, unknown> = {}) {
  db.project.findFirst.mockResolvedValue({ id: "p1", rules, plans: [plan] } as never)
}

type Write = { kind: string; args: { where?: Record<string, unknown>; data: Record<string, unknown> } }
function writesOf(kind: string): Write[] {
  const call = db.$transaction.mock.calls[0]?.[0] as unknown as Write[] | undefined
  return (call ?? []).filter((write) => write.kind === kind)
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUserMock.mockResolvedValue(user() as never)
})

describe("savePlanLayout", () => {
  it("recalculates and stores every metric from the saved positions", async () => {
    mockProject(savedPlan({ warnings: ["Unit 1: Front is over its limit.", "1 piece(s) do not fit in the selected container."] }))
    const result = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 300, 50, 0)])
    expect(result.ok).toBe(true)

    const [instance] = writesOf("instance")
    const metrics = instance!.args.data.metrics as Record<string, number | string[]>
    expect(metrics).toMatchObject({
      pieces: 2,
      netKg: 200,
      grossKg: 300,
      weightPct: 20,
      remainingKg: 800,
      volumeM3: 2,
      remainingM3: 28,
      // 2 pieces of 100 x 100 on a 500 x 240 floor, exact (no grid).
      floorPct: 16.7,
    })
    expect((metrics.cog as unknown as { x: number }).x).toBe(200)
    expect(Array.isArray(metrics.axleLoads)).toBe(true)
    expect(Array.isArray(metrics.warnings)).toBe(true)
  })

  it("writes the exact positions the planner chose and never re-packs", async () => {
    mockProject(savedPlan())
    await savePlanLayout("p1", [sentRow("c1", 17.3, 3.9, 0), sentRow("c2", 333.3, 120.1, 0)])
    const rows = writesOf("placement")
    expect(rows.map((row) => [row.args.where?.cargoItemId, row.args.data.xCm, row.args.data.yCm, row.args.data.zCm])).toEqual([
      ["c1", 17.3, 3.9, 0],
      ["c2", 333.3, 120.1, 0],
    ])
  })

  it("updates the metrics after a move, a turn, a stack and a move back", async () => {
    // Moving the second crate onto the first stacks it: floor use halves, volume stays.
    mockProject(savedPlan())
    await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 0, 0, 100)])
    const stacked = writesOf("instance")[0]!.args.data.metrics as Record<string, number>
    expect(stacked.floorPct).toBe(8.3)
    expect(stacked.volumeM3).toBe(2)
    expect(stacked.cog).toMatchObject({ z: 100 })

    // Turning a 120 x 80 crate changes its footprint, so floor use follows the new sides.
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue(user() as never)
    const plan = savedPlan()
    plan.instances[0]!.placements[0] = placement("c1", 0, 0, 0, 0, { lengthCm: 120, widthCm: 80, heightCm: 100 }, cargoItem({ lengthCm: 120, widthCm: 80 }))
    plan.instances[0]!.placements[1] = placement("c2", 0, 200, 0, 0)
    mockProject(plan)
    await savePlanLayout("p1", [sentRow("c1", 0, 0, 0, { lengthCm: 80, widthCm: 120, rotation: "WLH" }), sentRow("c2", 200, 0, 0)])
    const turned = writesOf("instance")[0]!.args.data.metrics as Record<string, number>
    expect(turned.floorPct).toBe(16.3) // (80 x 120 + 100 x 100) / (500 x 240)
  })

  it("stores one floor figure, the exact union of the footprints, and nothing else about floor use", async () => {
    mockProject(savedPlan())
    await savePlanLayout("p1", [sentRow("c1", 10, 10, 0), sentRow("c2", 120, 10, 0)])
    const metrics = writesOf("instance")[0]!.args.data.metrics as Record<string, number>
    expect(metrics.floorPct).toBe(16.7)
    expect(Object.keys(metrics)).not.toContain("floorActualPct")
    expect(Object.keys(metrics)).not.toContain("floorEffectivePct")
  })

  it("refuses pieces that overlap and writes nothing", async () => {
    mockProject(savedPlan())
    const result = await savePlanLayout("p1", [sentRow("c1", 10, 10, 0), sentRow("c2", 60, 10, 0)])
    expect(result.ok).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("accepts pieces that touch, and never asks for a gap", async () => {
    mockProject(savedPlan())
    expect((await savePlanLayout("p1", [sentRow("c1", 10, 10, 0), sentRow("c2", 110, 10, 0)])).ok).toBe(true)
  })

  it("refuses a piece outside the unit, a floating piece and a forbidden turn", async () => {
    mockProject(savedPlan())
    const outside = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 450, 0, 0)])
    expect(outside.ok).toBe(false)
    const floating = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 300, 0, 60)])
    expect(floating.ok).toBe(false)
    const badTurn = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 300, 0, 0, { lengthCm: 100, widthCm: 100, heightCm: 130 })])
    expect(badTurn.ok).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("refuses an incomplete layout instead of dropping pieces from the plan", async () => {
    mockProject(savedPlan())
    const result = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0)])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/missing 1 piece/)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("refuses cargo that is not on the plan, duplicates and invalid numbers", async () => {
    mockProject(savedPlan())
    expect((await savePlanLayout("p1", [sentRow("zzz", 0, 0, 0)])).ok).toBe(false)
    expect((await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c1", 100, 0, 0)])).ok).toBe(false)
    expect((await savePlanLayout("p1", [sentRow("c1", Number.NaN, 0, 0), sentRow("c2", 300, 0, 0)])).ok).toBe(false)
    expect((await savePlanLayout("p1", [sentRow("c1", 0, 0, 0, { lengthCm: 0 }), sentRow("c2", 300, 0, 0)])).ok).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("refreshes the plan's axle warnings and keeps the packer's other notes", async () => {
    mockProject(savedPlan({ warnings: ["Unit 1: Front is over its limit.", "1 piece(s) do not fit in the selected container."] }))
    const result = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 300, 50, 0)])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.planWarnings).toEqual(["1 piece(s) do not fit in the selected container."])
    const [plan] = writesOf("plan")
    expect((plan!.args.data.summary as { warnings: string[]; elapsedMs: number }).elapsedMs).toBe(5)
  })

  it("reports an overload as a warning, not a refusal, and raises the axle line", async () => {
    const plan = savedPlan()
    plan.instances[0]!.placements = [
      placement("c1", 0, 0, 0, 0, {}, cargoItem({ weightKg: 600 })),
      placement("c2", 0, 120, 0, 0, {}, cargoItem({ weightKg: 600 })),
    ]
    mockProject(plan)
    const result = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 120, 0, 0)])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const metrics = writesOf("instance")[0]!.args.data.metrics as { remainingKg: number; warnings: string[] }
    expect(metrics.remainingKg).toBe(-200)
    expect(metrics.warnings[0]).toMatch(/Over the payload limit by 200 kg/)
    expect(result.planWarnings.some((line) => /Front is over its limit/.test(line))).toBe(true)
  })

  it("returns the recalculated numbers so the screens update without a reload", async () => {
    mockProject(savedPlan())
    const result = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 300, 50, 0)])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.units).toHaveLength(1)
    expect(result.units[0]).toMatchObject({ unitIndex: 0, metrics: { floorPct: 16.7, remainingKg: 800 } })
  })

  it("lets only planners and admins save", async () => {
    requireUserMock.mockResolvedValue(user("VIEWER") as never)
    const result = await savePlanLayout("p1", [])
    expect(result.ok).toBe(false)
    expect(db.project.findFirst).not.toHaveBeenCalled()
  })

  it("refuses a project from another organization or without a plan", async () => {
    db.project.findFirst.mockResolvedValue(null as never)
    expect((await savePlanLayout("p1", [])).ok).toBe(false)
    db.project.findFirst.mockResolvedValue({ id: "p1", plans: [] } as never)
    const none = await savePlanLayout("p1", [])
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.error).toMatch(/Calculate a load plan/)
  })

  it("does not block an untouched, already-invalid piece from an older plan", async () => {
    // An older plan with a crate left floating: moving the other crate must still save.
    mockProject(savedPlan({ second: [300, 0, 40] }))
    const legacy = placement("c2", 0, 300, 0, 40)
    expect(legacy.zCm).toBe(40)
    const result = await savePlanLayout("p1", [
      { ...sentRow("c1", 0, 0, 0), x: 10 },
      { ...sentRow("c2", 300, 0, 40) },
    ])
    expect(result.ok).toBe(true)
  })

  it("reloading the saved plan shows the saved metrics, not the old ones", async () => {
    const plan = savedPlan()
    mockProject(plan)
    await savePlanLayout("p1", [sentRow("c1", 10, 10, 0), sentRow("c2", 120, 10, 0)])
    const saved = writesOf("instance")[0]!.args.data.metrics
    const placements = writesOf("placement").map((row) => row.args.data)

    // What the database now holds: the new metrics and positions.
    const reloaded = structuredClone(plan)
    reloaded.instances[0]!.metrics = saved as never
    reloaded.instances[0]!.placements = reloaded.instances[0]!.placements.map((row, index) => ({
      ...row,
      xCm: placements[index]!.xCm as number,
      yCm: placements[index]!.yCm as number,
    }))
    const view = planFromDb(reloaded as never)
    const unit = view.units[0]!
    expect(unit.floorPct).toBe(16.7)
    expect(unit.remainingKg).toBe(800)
    expect(unit.items.map((item) => [item.x, item.y])).toEqual([[10, 10], [120, 10]])
    expect(unit.floorPct).not.toBe(99) // the stale value that was stored before the save
  })

  it("keeps whatever else the plan's settings hold, including data from earlier versions, untouched", async () => {
    const settings = { clearanceCm: 12, clearanceConfig: { defaultCm: 12, lines: { c1: 4 } }, cargoSignature: "abc123", seed: 1, layoutSource: "AUTO" }
    mockProject(savedPlan({ settings }))
    const result = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 300, 50, 0)])
    expect(result.ok).toBe(true)
    const written = writesOf("plan")[0]!.args.data.settings as Record<string, unknown>
    expect(written).toEqual({ ...settings, layoutSource: "MANUAL" })
  })

  it("saving never changes what a plan's saved signature says, so it is not marked out of date by saving", async () => {
    mockProject(savedPlan({ settings: { cargoSignature: "keep-me" } }))
    await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 300, 50, 0)])
    expect((writesOf("plan")[0]!.args.data.settings as Record<string, unknown>).cargoSignature).toBe("keep-me")
  })

  it("marks the layout as hand-arranged when something moved, and keeps it that way afterwards", async () => {
    mockProject(savedPlan())
    const same = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 200, 0, 0)])
    expect(same.ok && same.layoutSource).toBe("AUTO")

    vi.clearAllMocks()
    requireUserMock.mockResolvedValue(user() as never)
    mockProject(savedPlan())
    const moved = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 300, 0, 0)])
    expect(moved.ok && moved.layoutSource).toBe("MANUAL")

    vi.clearAllMocks()
    requireUserMock.mockResolvedValue(user() as never)
    mockProject(savedPlan({ settings: { layoutSource: "MANUAL" } }))
    const stays = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 200, 0, 0)])
    expect(stays.ok && stays.layoutSource).toBe("MANUAL")
    expect((writesOf("plan")[0]!.args.data.settings as Record<string, unknown>).layoutSource).toBe("MANUAL")
  })

  it("stores a changed minimum support share in the project rules and keeps every other rule", async () => {
    mockProject(savedPlan(), { clearanceCm: 9, other: true, minSupportPct: 75 })
    const result = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 200, 0, 0)], { minSupportPct: 60 })
    expect(result.ok).toBe(true)
    const [project] = writesOf("project")
    expect(project!.args.data.rules).toEqual({ clearanceCm: 9, other: true, minSupportPct: 60 })
  })

  it("does not touch the project when the support share did not change", async () => {
    mockProject(savedPlan(), { minSupportPct: 75 })
    await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 200, 0, 0)], { minSupportPct: 75 })
    expect(writesOf("project")).toHaveLength(0)
  })

  it("judges stacking by the shared support share: the same overhang is refused at 90% and accepted at 50%", async () => {
    const overhang = [sentRow("c1", 0, 0, 0), sentRow("c2", 50, 0, 100)]
    mockProject(savedPlan())
    expect((await savePlanLayout("p1", overhang, { minSupportPct: 90 })).ok).toBe(false)
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue(user() as never)
    mockProject(savedPlan())
    expect((await savePlanLayout("p1", overhang, { minSupportPct: 50 })).ok).toBe(true)
  })

  it("accepts a saved plan whose pieces carry a half-turn code from an earlier version", async () => {
    const plan = savedPlan()
    plan.instances[0]!.placements[1] = placement("c2", 0, 200, 0, 0, { rotation: "LWH@180" })
    mockProject(plan)
    const result = await savePlanLayout("p1", [sentRow("c1", 0, 0, 0), sentRow("c2", 200, 0, 0, { rotation: "LWH@180" })])
    expect(result.ok).toBe(true)
    expect(writesOf("placement").map((row) => row.args.data.rotation)).toEqual(["LWH", "LWH@180"])
  })

  it("has no separate keep-my-layout path any more: only the Playground's save changes a layout", async () => {
    const actions = await import("@/app/actions/plan")
    expect(Object.keys(actions).sort()).toEqual(["persistPlan", "savePlanLayout"])
  })
})
