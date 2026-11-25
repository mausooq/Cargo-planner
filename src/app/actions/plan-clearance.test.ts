import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn(), update: vi.fn((args: unknown) => ({ kind: "project", args })) },
    cargoItem: { update: vi.fn((args: unknown) => ({ kind: "cargo", args })) },
    equipmentInstance: { update: vi.fn((args: unknown) => ({ kind: "instance", args })) },
    placement: { updateMany: vi.fn((args: unknown) => ({ kind: "placement", args })) },
    plan: { update: vi.fn((args: unknown) => ({ kind: "plan", args })) },
    $transaction: vi.fn(async (writes: unknown[]) => writes),
  },
}))

import { revalidatePlanLayout, savePlanLayout } from "@/app/actions/plan"
import { planFromDb } from "@/lib/plan-from-db"
import { cargoSignature, planStaleness, type StalenessCargo } from "@/lib/plan-staleness"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"

const requireUserMock = vi.mocked(requireUser)
const db = vi.mocked(prisma, true)
const sides = { front: 20, rear: 0, left: 0, right: 0 }

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
  axleGroups: [],
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

function placement(cargoItemId: string, instanceIndex: number, x: number, y: number, z: number, item = cargoItem(), extra: Record<string, unknown> = {}) {
  return { cargoItemId, instanceIndex, xCm: x, yCm: y, zCm: z, lengthCm: 100, widthCm: 100, heightCm: 100, rotation: "LWH", cargoItem: item, ...extra }
}

type PlanOptions = { settings?: Record<string, unknown>; first?: [number, number, number]; second?: [number, number, number]; items?: [Record<string, unknown>, Record<string, unknown>] }

function savedPlan(options: PlanOptions = {}) {
  const [x1, y1, z1] = options.first ?? [10, 10, 0]
  const [x2, y2, z2] = options.second ?? [200, 10, 0]
  const [item1, item2] = options.items ?? [{}, {}]
  return {
    id: "plan1",
    createdAt: new Date("2026-11-01"),
    seed: 1,
    settings: options.settings ?? {},
    summary: { totalCost: 0, elapsedMs: 5, warnings: [] },
    unloaded: [],
    instances: [
      {
        id: "inst1",
        sequence: 1,
        equipmentTypeId: "eq1",
        metrics: { netKg: 200, floorPct: 99 } as Record<string, unknown>,
        equipmentType: equipment,
        placements: [placement("c1", 0, x1, y1, z1, cargoItem(item1)), placement("c2", 0, x2, y2, z2, cargoItem(item2))],
      },
    ],
  }
}

function mockProject(plan: ReturnType<typeof savedPlan>, extra: Record<string, unknown> = {}) {
  db.project.findFirst.mockResolvedValue({
    id: "p1",
    rules: {},
    cargoItems: [
      { id: "c1", customFields: plan.instances[0]!.placements[0]!.cargoItem.customFields },
      { id: "c2", customFields: plan.instances[0]!.placements[1]!.cargoItem.customFields },
    ],
    plans: [plan],
    ...extra,
  } as never)
}

const row = (cargoId: string, x: number, y: number, z: number, extra: Record<string, unknown> = {}) => ({
  cargoId,
  instanceIndex: 0,
  x,
  y,
  z,
  lengthCm: 100,
  widthCm: 100,
  heightCm: 100,
  rotation: "LWH",
  ...extra,
})

type Write = { kind: string; args: { where?: Record<string, unknown>; data: Record<string, unknown> } }
const writes = (kind?: string): Write[] => {
  const all = (db.$transaction.mock.calls[0]?.[0] as unknown as Write[] | undefined) ?? []
  return kind ? all.filter((write) => write.kind === kind) : all
}

beforeEach(() => {
  vi.clearAllMocks()
  requireUserMock.mockResolvedValue({ id: "u1", role: "PLANNER", orgId: "org-1", orgName: "Compass", name: "Demo", email: "p@x" } as never)
})

describe("savePlanLayout with clearance changes made in the Playground", () => {
  it("saves a valid change together with the layout and records the configuration the layout was checked under", async () => {
    mockProject(savedPlan())
    const result = await savePlanLayout("p1", [row("c1", 10, 10, 0), row("c2", 200, 10, 0)], { clearanceChanges: [{ cargoId: "c1", setting: 10 }] })
    expect(result.ok).toBe(true)
    const [cargoWrite] = writes("cargo")
    expect(cargoWrite!.args.where).toEqual({ id: "c1" })
    expect(cargoWrite!.args.data.customFields).toEqual({ clearanceCm: 10 })
    const metrics = writes("instance")[0]!.args.data.metrics as Record<string, number>
    // c1 (100 x 100) reserves 10 cm on every side: (120 x 120 = 14,400) plus c2 (10,000), on a 120,000 cm² floor.
    expect(metrics.floorActualPct).toBe(16.7)
    expect(metrics.floorEffectivePct).toBe(20.3)
    const settings = writes("plan")[0]!.args.data.settings as Record<string, unknown>
    expect(settings.clearanceConfig).toEqual({ defaultCm: 0, lines: { c1: 10 } })
    expect(db.plan.update).toHaveBeenCalledTimes(2)
  })

  it("leaves the layout marked automatic when only clearance changed and nothing moved", async () => {
    mockProject(savedPlan({ settings: { layoutSource: "AUTO" } }))
    await savePlanLayout("p1", [row("c1", 10, 10, 0), row("c2", 200, 10, 0)], { clearanceChanges: [{ cargoId: "c2", setting: 5 }] })
    expect((writes("plan")[0]!.args.data.settings as Record<string, unknown>).layoutSource).toBe("AUTO")
  })

  it("marks the layout as hand-arranged once cargo has been moved, and keeps it so", async () => {
    mockProject(savedPlan())
    await savePlanLayout("p1", [row("c1", 10, 10, 0), row("c2", 300, 60.5, 0)])
    expect((writes("plan")[0]!.args.data.settings as Record<string, unknown>).layoutSource).toBe("MANUAL")
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({ id: "u1", role: "PLANNER", orgId: "org-1", orgName: "Compass", name: "Demo", email: "p@x" } as never)
    mockProject(savedPlan({ settings: { layoutSource: "MANUAL" } }))
    await savePlanLayout("p1", [row("c1", 10, 10, 0), row("c2", 200, 10, 0)])
    expect((writes("plan")[0]!.args.data.settings as Record<string, unknown>).layoutSource).toBe("MANUAL")
  })

  it("refuses a change the current arrangement cannot keep, saves nothing, and names the pieces", async () => {
    mockProject(savedPlan({ first: [10, 10, 0], second: [120, 10, 0] }))
    const result = await savePlanLayout("p1", [row("c1", 10, 10, 0), row("c2", 120, 10, 0)], { clearanceChanges: [{ cargoId: "c1", setting: 30 }] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/no longer works with these clearances/)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.every((entry) => entry.unitIndex === 0)).toBe(true)
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.cargoItem.update).not.toHaveBeenCalled()
  })

  it("applies a change to every unit that holds the line, even when only one unit's layout is sent", async () => {
    const plan = savedPlan()
    plan.instances.push({
      id: "inst2",
      sequence: 2,
      equipmentTypeId: "eq1",
      metrics: { netKg: 100 },
      equipmentType: equipment,
      placements: [placement("c1", 1, 50, 50, 0)],
    })
    mockProject(plan)
    const result = await savePlanLayout("p1", [row("c1", 10, 10, 0), row("c2", 200, 10, 0)], { clearanceChanges: [{ cargoId: "c1", setting: { front: 5, rear: 5, left: 5, right: 5 } }] })
    expect(result.ok).toBe(true)
    expect(writes("instance")).toHaveLength(2)
    // Unit 2 was only re-checked and its numbers refreshed: nothing in it moved.
    expect(writes("placement").every((write) => write.args.where?.instanceIndex === 0)).toBe(true)
  })

  it("refuses when the changed line no longer fits in a unit that was not sent", async () => {
    const plan = savedPlan()
    plan.instances.push({
      id: "inst2",
      sequence: 2,
      equipmentTypeId: "eq1",
      metrics: {},
      equipmentType: equipment,
      placements: [placement("c1", 1, 0, 0, 0)],
    })
    mockProject(plan)
    const result = await savePlanLayout("p1", [row("c1", 10, 10, 0), row("c2", 200, 10, 0)], { clearanceChanges: [{ cargoId: "c1", setting: 5 }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.violations.some((entry) => entry.unitIndex === 1)).toBe(true)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("keeps other keys on the line (allowed rotations) when its clearance is replaced", async () => {
    mockProject(savedPlan({ first: [30, 10, 0], items: [{ customFields: { allowedRotations: "LWH,WLH", clearanceCm: 2 } }, {}] }))
    await savePlanLayout("p1", [row("c1", 30, 10, 0), row("c2", 200, 10, 0)], { clearanceChanges: [{ cargoId: "c1", setting: sides }] })
    expect(writes("cargo")[0]!.args.data.customFields).toEqual({ allowedRotations: "LWH,WLH", clearanceSides: sides })
  })

  it("rejects invalid, negative and unknown clearance changes", async () => {
    mockProject(savedPlan())
    const attempts = [
      { clearanceChanges: [{ cargoId: "c1", setting: -3 }] },
      { clearanceChanges: [{ cargoId: "c1", setting: 500 }] },
      { clearanceChanges: [{ cargoId: "c1", setting: { front: 1 } }] },
      { clearanceChanges: [{ cargoId: "ghost", setting: 5 }] },
      { minSupportPct: 10 },
      { minSupportPct: 150 },
    ]
    for (const options of attempts) {
      expect((await savePlanLayout("p1", [row("c1", 10, 10, 0), row("c2", 200, 10, 0)], options as never)).ok).toBe(false)
    }
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe("one minimum support share for the Playground, the solver and the server", () => {
  const partlySupported = [row("c1", 0, 0, 0), row("c2", 40, 0, 100)]
  // Stored fully supported; the planner then slides the top piece so only 60% of it rests on the one below.
  const plan = () => savedPlan({ first: [0, 0, 0], second: [0, 0, 100] })

  it("refuses a 60%-supported stack by default (70%)", async () => {
    mockProject(plan())
    const result = await savePlanLayout("p1", partlySupported)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not enough support/)
  })

  it("accepts it when the planner worked with 60% and stores that as the project's setting", async () => {
    mockProject(plan())
    expect((await savePlanLayout("p1", partlySupported, { minSupportPct: 60 })).ok).toBe(true)
    expect(writes("project")[0]!.args.data.rules).toEqual({ minSupportPct: 60 })
  })

  it("uses the project's stored share when none is sent", async () => {
    mockProject(plan(), { rules: { minSupportPct: 60, other: 1 } })
    expect((await savePlanLayout("p1", partlySupported)).ok).toBe(true)
    expect(writes("project")).toHaveLength(0)
  })

  it("does not write the shared default (75%) into the project, so saving a layout never changes how the packer behaves", async () => {
    mockProject(savedPlan())
    await savePlanLayout("p1", [row("c1", 10, 10, 0), row("c2", 200, 10, 0)], { minSupportPct: 75 })
    expect(writes("project")).toHaveLength(0)
  })

  it("treats any other value, even the old 70%, as an explicit project setting and stores it", async () => {
    mockProject(savedPlan())
    await savePlanLayout("p1", [row("c1", 10, 10, 0), row("c2", 200, 10, 0)], { minSupportPct: 70 })
    expect(writes("project")[0]!.args.data.rules).toEqual({ minSupportPct: 70 })
  })

  it("refuses a 72%-supported stack by default, because the shared default is 75%, not the old 70%", async () => {
    mockProject(plan())
    const result = await savePlanLayout("p1", [row("c1", 0, 0, 0), row("c2", 28, 0, 100)])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Not enough support: 72% < 75%/)
  })

  it("accepts the same layout for a project that explicitly set 70%, with or without the client repeating it", async () => {
    mockProject(plan(), { rules: { minSupportPct: 70 } })
    expect((await savePlanLayout("p1", [row("c1", 0, 0, 0), row("c2", 28, 0, 100)])).ok).toBe(true)
    mockProject(plan(), { rules: { minSupportPct: 70 } })
    expect((await savePlanLayout("p1", [row("c1", 0, 0, 0), row("c2", 28, 0, 100)], { minSupportPct: 70 })).ok).toBe(true)
    expect(writes("project")).toHaveLength(0)
  })

  it("ignores a stored value that is not a valid setting instead of trusting it", async () => {
    for (const rules of [{ minSupportPct: 10 }, { minSupportPct: "60" }, { minSupportPct: 140 }, { minSupportPct: null }]) {
      vi.clearAllMocks()
      requireUserMock.mockResolvedValue({ id: "u1", role: "PLANNER", orgId: "org-1", orgName: "Compass", name: "Demo", email: "p@x" } as never)
      mockProject(plan(), { rules })
      expect((await savePlanLayout("p1", [row("c1", 0, 0, 0), row("c2", 28, 0, 100)])).ok).toBe(false)
    }
  })

  it("refuses a client value that is not a number in range, so a request cannot weaken the check", async () => {
    mockProject(plan())
    for (const minSupportPct of [Number.NaN, "60", 49, 101, -1, 0]) {
      const result = await savePlanLayout("p1", [row("c1", 0, 0, 0), row("c2", 28, 0, 100)], { minSupportPct } as never)
      expect(result.ok).toBe(false)
    }
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("applies the stricter share too: 90% refuses what 70% accepts", async () => {
    mockProject(savedPlan({ first: [0, 0, 0], second: [0, 0, 100] }))
    expect((await savePlanLayout("p1", [row("c1", 0, 0, 0), row("c2", 20, 0, 100)], { minSupportPct: 70 })).ok).toBe(true)
    mockProject(savedPlan({ first: [0, 0, 0], second: [0, 0, 100] }))
    expect((await savePlanLayout("p1", [row("c1", 0, 0, 0), row("c2", 20, 0, 100)], { minSupportPct: 90 })).ok).toBe(false)
  })
})

describe("rotation and facing are checked by the server", () => {
  it("accepts a half-turn facing for a piece that may turn, and rejects it for a fixed one", async () => {
    mockProject(savedPlan({ items: [{ orientation: "ROTATE_90", clearanceSides: undefined }, {}] }))
    expect((await savePlanLayout("p1", [row("c1", 10, 10, 0, { rotation: "LWH@180" }), row("c2", 200, 10, 0)])).ok).toBe(true)
    mockProject(savedPlan({ items: [{ orientation: "FIXED" }, {}] }))
    const fixed = await savePlanLayout("p1", [row("c1", 10, 10, 0, { rotation: "LWH@180" }), row("c2", 200, 10, 0)])
    expect(fixed.ok).toBe(false)
    if (!fixed.ok) expect(fixed.error).toMatch(/fixes its orientation/)
  })

  it("rejects a rotation code that does not match the sizes, so a facing cannot be claimed falsely", async () => {
    mockProject(savedPlan({ items: [{ lengthCm: 120, widthCm: 80 }, {}] }))
    const result = await savePlanLayout("p1", [row("c1", 10, 10, 0, { lengthCm: 120, widthCm: 80, rotation: "WLH" }), row("c2", 200, 10, 0)])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/does not match its sizes/)
  })

  it("rejects an unknown code and a half turn on a tipped piece", async () => {
    mockProject(savedPlan())
    expect((await savePlanLayout("p1", [row("c1", 10, 10, 0, { rotation: "XYZ" }), row("c2", 200, 10, 0)])).ok).toBe(false)
    expect((await savePlanLayout("p1", [row("c1", 10, 10, 0, { rotation: "LHW@180" }), row("c2", 200, 10, 0)])).ok).toBe(false)
  })

  it("stores the facing the planner chose", async () => {
    mockProject(savedPlan())
    await savePlanLayout("p1", [row("c1", 10, 10, 0, { rotation: "WLH@180" }), row("c2", 200, 10, 0)])
    expect(writes("placement")[0]!.args.data.rotation).toBe("WLH@180")
  })
})

describe("revalidatePlanLayout keeps a layout and refreshes its numbers without moving anything", () => {
  const snapshot = { clearanceCm: 0, clearanceConfig: { defaultCm: 0, lines: {} }, layoutSource: "MANUAL" }

  it("accepts a new project default the layout still satisfies, and saves it", async () => {
    mockProject(savedPlan({ settings: snapshot }))
    const result = await revalidatePlanLayout("p1", { defaultCm: 5 })
    expect(result.ok).toBe(true)
    expect(writes("placement")).toHaveLength(0)
    expect(writes("project")[0]!.args.data.rules).toEqual({ clearanceCm: 5 })
    const metrics = writes("instance")[0]!.args.data.metrics as Record<string, number>
    expect(metrics.floorEffectivePct).toBeGreaterThan(metrics.floorActualPct)
    const settings = writes("plan")[0]!.args.data.settings as Record<string, unknown>
    expect(settings.clearanceCm).toBe(5)
    expect(settings.layoutSource).toBe("MANUAL")
  })

  it("refuses a default the layout cannot satisfy and changes nothing", async () => {
    mockProject(savedPlan({ settings: snapshot }))
    const result = await revalidatePlanLayout("p1", { defaultCm: 20 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.error).toMatch(/Nothing was saved/)
    }
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("accepts line changes that fit and refuses ones that would break a neighbour or a wall", async () => {
    mockProject(savedPlan({ settings: snapshot }))
    expect((await revalidatePlanLayout("p1", { clearanceChanges: [{ cargoId: "c1", setting: 5 }] })).ok).toBe(true)
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({ id: "u1", role: "PLANNER", orgId: "org-1", orgName: "Compass", name: "Demo", email: "p@x" } as never)
    mockProject(savedPlan({ settings: snapshot }))
    expect((await revalidatePlanLayout("p1", { clearanceChanges: [{ cargoId: "c1", setting: 60 }] })).ok).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("checks directional values against the side that faces the wall", async () => {
    // c1 sits 10 cm from the front wall: 10 cm of front clearance fits, 20 does not; 20 at the rear is fine.
    mockProject(savedPlan({ settings: snapshot }))
    expect((await revalidatePlanLayout("p1", { clearanceChanges: [{ cargoId: "c1", setting: { front: 10, rear: 20, left: 10, right: 20 } }] })).ok).toBe(true)
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({ id: "u1", role: "PLANNER", orgId: "org-1", orgName: "Compass", name: "Demo", email: "p@x" } as never)
    mockProject(savedPlan({ settings: snapshot }))
    expect((await revalidatePlanLayout("p1", { clearanceChanges: [{ cargoId: "c1", setting: sides }] })).ok).toBe(false)
  })

  it("leaves the plan's configuration, and so its out-of-date state, to the planner when nothing is saved", async () => {
    mockProject(savedPlan({ settings: snapshot }))
    await revalidatePlanLayout("p1", { clearanceChanges: [{ cargoId: "c1", setting: 60 }] })
    expect(db.plan.update).not.toHaveBeenCalled()
  })

  it("is for planners and admins only, and needs a plan", async () => {
    requireUserMock.mockResolvedValue({ id: "u1", role: "VIEWER", orgId: "org-1", orgName: "Compass", name: "Demo", email: "p@x" } as never)
    expect((await revalidatePlanLayout("p1")).ok).toBe(false)
    requireUserMock.mockResolvedValue({ id: "u1", role: "PLANNER", orgId: "org-1", orgName: "Compass", name: "Demo", email: "p@x" } as never)
    db.project.findFirst.mockResolvedValue({ id: "p1", rules: {}, cargoItems: [], plans: [] } as never)
    expect((await revalidatePlanLayout("p1")).ok).toBe(false)
  })
})

describe("saved plans reload with the settings they were saved under", () => {
  it("reads directional clearance, the facing and the manual flag back", async () => {
    const plan = savedPlan({
      settings: { clearanceCm: 4, layoutSource: "MANUAL", clearanceConfig: { defaultCm: 4, lines: { c1: sides } } },
      items: [{ customFields: { clearanceSides: sides } }, {}],
    })
    plan.instances[0]!.placements[0]!.rotation = "WLH@180"
    const view = planFromDb(plan as never)
    expect(view.layoutSource).toBe("MANUAL")
    expect(view.clearanceConfig).toEqual({ defaultCm: 4, lines: { c1: sides } })
    const [first, second] = view.units[0]!.items
    expect(first).toMatchObject({ rotation: "WLH@180", clearanceSetting: sides, clearance: sides })
    expect(second).toMatchObject({ clearanceSetting: null, clearance: { front: 4, rear: 4, left: 4, right: 4 } })
  })

  it("judges pieces by the configuration in force now when it is given, and by the plan's own otherwise", () => {
    const plan = savedPlan({ settings: { clearanceCm: 4 } })
    expect(planFromDb(plan as never).units[0]!.items[0]!.clearanceCm).toBe(4)
    expect(planFromDb(plan as never, { clearanceCm: 9 }).units[0]!.items[0]!.clearanceCm).toBe(9)
    expect(planFromDb(plan as never, { clearanceCm: 9 }).clearanceCm).toBe(4)
  })
})

describe("Keep current layout works for every calculated plan", () => {
  const cargoRows = (extra: Partial<StalenessCargo> = {}): StalenessCargo[] => [
    { id: "c1", customFields: null, lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 100, quantity: 1, shape: "BOX", orientation: "ROTATE_90", ...extra },
    { id: "c2", customFields: null, lengthCm: 100, widthCm: 100, heightCm: 100, weightKg: 100, quantity: 1, shape: "BOX", orientation: "ROTATE_90" },
  ]
  const autoPlan = (settings: Record<string, unknown> = {}) =>
    savedPlan({ settings: { clearanceCm: 0, clearanceConfig: { defaultCm: 0, lines: {} }, layoutSource: "AUTO", cargoSignature: cargoSignature(cargoRows()), ...settings } })

  it("keeps an automatically generated layout that still satisfies the new clearance, moving nothing", async () => {
    mockProject(autoPlan())
    const result = await revalidatePlanLayout("p1", { defaultCm: 5, clearanceChanges: [{ cargoId: "c2", setting: 0 }] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.layoutSource).toBe("AUTO")
    expect(writes("placement")).toHaveLength(0)
    const settings = writes("plan")[0]!.args.data.settings as Record<string, unknown>
    expect(settings.layoutSource).toBe("AUTO")
    expect(settings.clearanceConfig).toEqual({ defaultCm: 5, lines: { c2: 0 } })
    expect(writes("project")[0]!.args.data.rules).toEqual({ clearanceCm: 5 })
    expect(writes("cargo")[0]!.args.where).toEqual({ id: "c2" })
  })

  it("stores the refreshed numbers and leaves the cargo signature exactly as it was", async () => {
    const plan = autoPlan()
    mockProject(plan)
    await revalidatePlanLayout("p1", { defaultCm: 5 })
    const settings = writes("plan")[0]!.args.data.settings as Record<string, unknown>
    expect(settings.cargoSignature).toBe(cargoSignature(cargoRows()))
    const metrics = writes("instance")[0]!.args.data.metrics as Record<string, number>
    expect(metrics.floorEffectivePct).toBeGreaterThan(metrics.floorActualPct)
  })

  it("rejects an automatically generated layout that cannot keep the proposal, and saves nothing", async () => {
    mockProject(autoPlan())
    const result = await revalidatePlanLayout("p1", { defaultCm: 20 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Nothing was saved/)
      expect(result.violations.map((entry) => entry.unitIndex)).toContain(0)
    }
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.plan.update).not.toHaveBeenCalled()
    expect(db.project.update).not.toHaveBeenCalled()
    expect(db.cargoItem.update).not.toHaveBeenCalled()
  })

  it("brings the plan up to date for clearance, so the verdict becomes ready", async () => {
    mockProject(autoPlan())
    await revalidatePlanLayout("p1", { defaultCm: 5 })
    const stored = writes("plan")[0]!.args.data.settings as Record<string, unknown>
    const now = cargoRows()
    expect(planStaleness({ createdAt: new Date("2026-11-01"), settings: autoPlan().settings }, now, 5)).toBe("clearance")
    expect(planStaleness({ createdAt: new Date("2026-11-01"), settings: stored }, now, 5)).toBeNull()
  })

  it("does not clear an out-of-date status that comes from a cargo edit", async () => {
    mockProject(autoPlan())
    await revalidatePlanLayout("p1", { defaultCm: 5 })
    const stored = writes("plan")[0]!.args.data.settings as Record<string, unknown>
    const edited = cargoRows({ quantity: 9 })
    expect(planStaleness({ createdAt: new Date("2026-11-01"), settings: stored }, edited, 5)).toBe("cargo")
    // And a plan with a signature is never stamped as synced, which could have hidden that edit.
    expect(db.plan.update).toHaveBeenCalledTimes(1)
  })

  it("for a plan from before signatures: stamps it checked when nothing else changed, and does not when other cargo was edited", async () => {
    mockProject(savedPlan({ settings: { clearanceCm: 0, layoutSource: "AUTO" } }))
    await revalidatePlanLayout("p1", { defaultCm: 5 })
    expect(db.plan.update).toHaveBeenCalledTimes(2)
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({ id: "u1", role: "PLANNER", orgId: "org-1", orgName: "Compass", name: "Demo", email: "p@x" } as never)
    const legacy = savedPlan({ settings: { clearanceCm: 0, layoutSource: "AUTO" } })
    db.project.findFirst.mockResolvedValue({
      id: "p1",
      rules: {},
      cargoItems: [{ id: "c1", customFields: null, updatedAt: new Date("2026-12-01") }, { id: "c2", customFields: null, updatedAt: new Date("2026-10-01") }],
      plans: [legacy],
    } as never)
    await revalidatePlanLayout("p1", { defaultCm: 5 })
    expect(db.plan.update).toHaveBeenCalledTimes(1)
  })

  it("keeps a hand-arranged layout the same way, and says it is still hand-arranged", async () => {
    mockProject(autoPlan({ layoutSource: "MANUAL" }))
    const result = await revalidatePlanLayout("p1", { defaultCm: 5 })
    expect(result.ok && result.layoutSource).toBe("MANUAL")
  })

  it("preserves every position, turn and facing: the placement rows are never rewritten", async () => {
    const plan = autoPlan()
    plan.instances[0]!.placements[0]!.rotation = "WLH@180"
    mockProject(plan)
    await revalidatePlanLayout("p1", { defaultCm: 3 })
    expect(writes("placement")).toHaveLength(0)
  })
})

describe("a layout save checks every unit when the configuration has changed", () => {
  /** Unit 1 holds c2; unit 2 holds c1 right against the front wall. */
  function twoUnits(c1Fields: unknown, settings: Record<string, unknown>) {
    const plan = savedPlan({ settings, items: [{}, {}] })
    plan.instances[0]!.placements = [placement("c2", 0, 200, 10, 0)]
    plan.instances.push({
      id: "inst2",
      sequence: 2,
      equipmentTypeId: "eq1",
      metrics: {} as Record<string, unknown>,
      equipmentType: equipment,
      placements: [placement("c1", 0, 0, 0, 0, cargoItem({ customFields: c1Fields }))],
    })
    db.project.findFirst.mockResolvedValue({
      id: "p1",
      rules: {},
      cargoItems: [{ id: "c1", customFields: c1Fields }, { id: "c2", customFields: null }],
      plans: [plan],
    } as never)
  }
  const recorded = { clearanceCm: 0, clearanceConfig: { defaultCm: 0, lines: {} } }

  it("refuses to record the plan as checked when another unit breaks the clearance that was changed elsewhere", async () => {
    // c1 was given 60 cm on the Cargo page after the plan was made; only unit 1's layout is saved here.
    twoUnits({ clearanceCm: 60 }, recorded)
    const result = await savePlanLayout("p1", [row("c2", 200, 10, 0)])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.violations.map((entry) => entry.unitIndex)).toEqual([1])
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("accepts the save and refreshes both units when every unit satisfies the changed configuration", async () => {
    twoUnits({ clearanceCm: 0 }, { clearanceCm: 0, clearanceConfig: { defaultCm: 0, lines: { c1: 5 } } })
    const result = await savePlanLayout("p1", [row("c2", 200, 10, 0)])
    expect(result.ok).toBe(true)
    expect(writes("instance")).toHaveLength(2)
    // Only the unit that was sent has its positions written.
    expect(writes("placement").every((write) => write.args.where?.cargoItemId === "c2")).toBe(true)
    expect((writes("plan")[0]!.args.data.settings as Record<string, unknown>).clearanceConfig).toEqual({ defaultCm: 0, lines: { c1: 0 } })
  })

  it("leaves other units alone when nothing about the configuration changed", async () => {
    twoUnits(null, recorded)
    const result = await savePlanLayout("p1", [row("c2", 220, 10, 0)])
    expect(result.ok).toBe(true)
    expect(writes("instance")).toHaveLength(1)
  })

  it("judges the 'before' layout by what the plan recorded: a line that was inheriting then is not treated as custom now", async () => {
    // c1 had no setting when the plan was made (inheriting 0) and has 60 cm now. Revalidating must see the new violation.
    twoUnits({ clearanceCm: 60 }, recorded)
    const result = await revalidatePlanLayout("p1")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.violations.some((entry) => entry.unitIndex === 1)).toBe(true)
  })
})
