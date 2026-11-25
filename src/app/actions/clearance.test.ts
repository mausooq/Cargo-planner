import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }))

const tx = {
  plan: { deleteMany: vi.fn(), create: vi.fn(async () => ({ id: "plan-new" })) },
  equipmentInstance: { create: vi.fn(async () => ({ id: "inst-new" })) },
  placement: { createMany: vi.fn() },
  unloadedItem: { createMany: vi.fn() },
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn(), update: vi.fn((args: unknown) => ({ kind: "project", args })) },
    cargoItem: { update: vi.fn((args: unknown) => ({ kind: "cargo", args })) },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : arg)),
  },
}))

import { saveClearanceConfig } from "@/app/actions/clearance"
import { persistPlan } from "@/app/actions/plan"
import { cargoSignature } from "@/lib/plan-staleness"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"

const requireUserMock = vi.mocked(requireUser)
const db = vi.mocked(prisma, true)
const sides = { front: 20, rear: 5, left: 10, right: 5 }

function user(role: "ADMIN" | "PLANNER" | "VIEWER" = "PLANNER") {
  return { id: "u1", role, orgId: "org-1", orgName: "Compass", name: "Demo", email: "planner@compass.local" }
}

function project(extra: Record<string, unknown> = {}) {
  return {
    id: "p1",
    rules: { clearanceCm: 5, other: true },
    cargoItems: [
      { id: "a", customFields: null },
      { id: "b", customFields: { allowedRotations: "LWH,WLH", clearanceCm: 3 } },
      { id: "c", customFields: { clearanceSides: sides } },
    ],
    candidates: [{ equipmentTypeId: "eq1" }],
    ...extra,
  }
}

type Write = { kind: string; args: { where: Record<string, unknown>; data: Record<string, unknown> } }
const writes = () => (db.$transaction.mock.calls[0]?.[0] as unknown as Write[] | undefined) ?? []

beforeEach(() => {
  vi.clearAllMocks()
  requireUserMock.mockResolvedValue(user() as never)
  db.project.findFirst.mockResolvedValue(project() as never)
})

describe("saveClearanceConfig", () => {
  it("saves the default and several lines in one transaction and returns what is stored", async () => {
    const result = await saveClearanceConfig("p1", {
      defaultCm: 8,
      lines: [
        { cargoId: "a", setting: 12 },
        { cargoId: "c", setting: null },
      ],
    })
    expect(result.ok).toBe(true)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    const [projectWrite, ...lineWrites] = writes()
    expect(projectWrite!.args.data).toEqual({ rules: { clearanceCm: 8, other: true } })
    expect(lineWrites.map((write) => [write.args.where.id, write.args.data.customFields])).toEqual([
      ["a", { clearanceCm: 12 }],
      ["c", expect.anything()],
    ])
    if (!result.ok) return
    expect(result.config).toEqual({ defaultCm: 8, lines: { a: 12, b: 3 } })
  })

  it("keeps an explicit zero as zero and returns a line to inheriting with null", async () => {
    const result = await saveClearanceConfig("p1", {
      lines: [
        { cargoId: "a", setting: 0 },
        { cargoId: "b", setting: null },
      ],
    })
    expect(result.ok).toBe(true)
    const lines = writes().filter((write) => write.kind === "cargo")
    expect(lines[0]!.args.data.customFields).toEqual({ clearanceCm: 0 })
    // Going back to inherit drops the clearance keys but keeps the allowed rotations.
    expect(lines[1]!.args.data.customFields).toEqual({ allowedRotations: "LWH,WLH" })
    if (result.ok) expect(result.config.lines).toEqual({ a: 0, c: sides })
  })

  it("stores directional sides and replaces a uniform value with them", async () => {
    await saveClearanceConfig("p1", { lines: [{ cargoId: "b", setting: sides }] })
    expect(writes()[0]!.args.data.customFields).toEqual({ allowedRotations: "LWH,WLH", clearanceSides: sides })
  })

  it("leaves the project default alone when none is given or it did not change", async () => {
    await saveClearanceConfig("p1", { lines: [{ cargoId: "a", setting: 1 }] })
    expect(writes().some((write) => write.kind === "project")).toBe(false)
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue(user() as never)
    db.project.findFirst.mockResolvedValue(project() as never)
    await saveClearanceConfig("p1", { defaultCm: 5, lines: [{ cargoId: "a", setting: 1 }] })
    expect(writes().some((write) => write.kind === "project")).toBe(false)
  })

  it("rejects negative, too large, non-numeric and incomplete values without writing anything", async () => {
    const bad: unknown[] = [
      { defaultCm: -1, lines: [] },
      { defaultCm: 101, lines: [] },
      { defaultCm: Number.NaN, lines: [] },
      { lines: [{ cargoId: "a", setting: -2 }] },
      { lines: [{ cargoId: "a", setting: 1000 }] },
      { lines: [{ cargoId: "a", setting: "5" }] },
      { lines: [{ cargoId: "a", setting: { front: 1, rear: 1, left: 1 } }] },
      { lines: [{ cargoId: "a", setting: { front: 1, rear: 1, left: 1, right: -1 } }] },
      { lines: [{ cargoId: "", setting: 1 }] },
    ]
    for (const input of bad) {
      expect((await saveClearanceConfig("p1", input as never)).ok).toBe(false)
    }
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("refuses cargo that is not on the project, viewers and other organizations", async () => {
    expect((await saveClearanceConfig("p1", { lines: [{ cargoId: "zzz", setting: 1 }] })).ok).toBe(false)
    db.project.findFirst.mockResolvedValue(null as never)
    expect((await saveClearanceConfig("p1", { lines: [] })).ok).toBe(false)
    requireUserMock.mockResolvedValue(user("VIEWER") as never)
    expect((await saveClearanceConfig("p1", { lines: [] })).ok).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("does not touch the saved plan", async () => {
    await saveClearanceConfig("p1", { defaultCm: 9, lines: [] })
    expect(tx.plan.create).not.toHaveBeenCalled()
    expect(tx.plan.deleteMany).not.toHaveBeenCalled()
  })
})

describe("persistPlan records the configuration the plan was calculated with", () => {
  const result = {
    seed: 1,
    settings: { clearanceCm: 8, restarts: 3 },
    totalCost: 0,
    warnings: [],
    elapsedMs: 1,
    restartsRun: 1,
    units: [{ unitIndex: 0, equipmentId: "eq1", metrics: {}, placements: [{ cargoId: "a", instanceIndex: 0, x: 0, y: 0, z: 0, lengthCm: 10, widthCm: 10, heightCm: 10, rotation: "LWH@180" }] }],
    unloaded: [],
  }

  it("stores the configuration the packer used and marks the layout as automatic", async () => {
    const used = { defaultCm: 8, lines: { a: 12, c: sides } }
    expect((await persistPlan("p1", result as never, used)).ok).toBe(true)
    const settings = (tx.plan.create.mock.calls[0] as unknown as [{ data: { settings: Record<string, unknown> } }])[0].data.settings
    expect(settings).toMatchObject({ clearanceCm: 8, clearanceConfig: used, layoutSource: "AUTO" })
    const placement = (tx.placement.createMany.mock.calls[0] as unknown as [{ data: { rotation: string }[] }])[0].data[0]!
    expect(placement.rotation).toBe("LWH@180")
  })

  it("records a signature of the cargo it was given, so a later cargo edit can be told from a clearance edit", async () => {
    await persistPlan("p1", result as never)
    const settings = (tx.plan.create.mock.calls[0] as unknown as [{ data: { settings: Record<string, unknown> } }])[0].data.settings
    expect(settings.cargoSignature).toBe(cargoSignature(project().cargoItems as never))
  })

  it("falls back to the project's own configuration when none is sent", async () => {
    await persistPlan("p1", result as never)
    const settings = (tx.plan.create.mock.calls[0] as unknown as [{ data: { settings: Record<string, unknown> } }])[0].data.settings
    expect(settings.clearanceConfig).toEqual({ defaultCm: 5, lines: { b: 3, c: sides } })
  })

  it("ignores a malformed configuration instead of storing it", async () => {
    await persistPlan("p1", result as never, { defaultCm: "x" })
    const settings = (tx.plan.create.mock.calls[0] as unknown as [{ data: { settings: Record<string, unknown> } }])[0].data.settings
    expect(settings.clearanceConfig).toEqual({ defaultCm: 5, lines: { b: 3, c: sides } })
  })
})
