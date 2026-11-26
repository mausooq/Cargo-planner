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

describe("one minimum support share for the Playground, the solver and the server", () => {
  const partlySupported = [row("c1", 0, 0, 0), row("c2", 40, 0, 100)]
  // Stored fully supported; the planner then slides the top piece so only 60% of it rests on the one below.
  const plan = () => savedPlan({ first: [0, 0, 0], second: [0, 0, 100] })

  it("refuses a 60%-supported stack by default (75%)", async () => {
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
    mockProject(savedPlan({ items: [{ orientation: "ROTATE_90" }, {}] }))
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

describe("saved plans reload with the settings they were saved under", () => {
  it("reads the facing and the hand-arranged flag back, and nothing else the plan was saved with", () => {
    const plan = savedPlan({
      settings: { clearanceCm: 4, layoutSource: "MANUAL", clearanceConfig: { defaultCm: 4, lines: {} }, cargoSignature: "abc" },
      items: [{ customFields: { clearanceSides: { front: 20, rear: 0, left: 0, right: 0 } } }, {}],
    })
    plan.instances[0]!.placements[0]!.rotation = "WLH@180"
    const view = planFromDb(plan as never)
    expect(view.layoutSource).toBe("MANUAL")
    const [first, second] = view.units[0]!.items
    expect(first).toMatchObject({ rotation: "WLH@180" })
    expect(second).toMatchObject({ rotation: "LWH" })
    expect(JSON.stringify(view)).not.toMatch(/clearance/i)
  })
})
