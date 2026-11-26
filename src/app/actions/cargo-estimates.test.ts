import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    cargoItem: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { Prisma } from "@prisma/client"
import { confirmEstimatedWeights, importReviewedCargo, updateCargoItem } from "@/app/actions/cargo"
import { cargoPreset } from "@/lib/cargo-defaults"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"

// Synthetic data only; the database is mocked.

const db = vi.mocked(prisma, true)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ id: "u", role: "PLANNER", orgId: "o", orgName: "O", name: "N", email: "e@x" } as never)
  db.project.findFirst.mockResolvedValue({ id: "p1" } as never)
  db.cargoItem.createMany.mockResolvedValue({ count: 1 } as never)
  db.$transaction.mockResolvedValue([] as never)
})

const row = (extra: Record<string, unknown> = {}) => ({ ...cargoPreset("BOX"), sku: "S-1", name: "Box", lengthCm: 100, widthCm: 80, heightCm: 60, weightKg: 150, quantity: 1, stackable: false, ...extra })
const saved = () => (db.cargoItem.createMany.mock.calls[0]![0]!.data as { customFields: unknown }[]).map((entry) => entry.customFields)
const estimate = { perPieceKg: 150, basis: "equal share of the document's total gross weight of 300 kg over 2 packages" }

describe("importing lines with unknown stacking and estimated weights", () => {
  it("records stacking the document did not state, and the estimate the weight came from", async () => {
    const result = await importReviewedCargo("p1", [row({ stackableNotStated: true, weightEstimate: estimate })] as never)
    expect(result).toMatchObject({ ok: true, count: 1 })
    expect(saved()[0]).toMatchObject({ stacking: "not-stated", weightEstimate: estimate })
    expect((db.cargoItem.createMany.mock.calls[0]![0]!.data as { stackable: boolean }[])[0]!.stackable).toBe(false)
  })

  it("stores nothing extra for a line the document fully described", async () => {
    await importReviewedCargo("p1", [row({ stackable: true })] as never)
    expect(saved()[0]).toBe(Prisma.DbNull)
  })

  it("ignores an estimate that does not match the weight sent, and a not-stated flag on a stackable line", async () => {
    await importReviewedCargo("p1", [row({ stackable: true, stackableNotStated: true, weightEstimate: { perPieceKg: 99, basis: "x" } })] as never)
    expect(saved()[0]).toBe(Prisma.DbNull)
  })
})

describe("editing a line that came in with those markers", () => {
  const stored = (customFields: unknown, extra: Record<string, unknown> = {}) => ({ id: "c1", projectId: "p1", stackable: false, weightKg: 150, customFields, ...extra })
  const written = () => db.cargoItem.update.mock.calls[0]![0]!.data.customFields

  it("keeps both while the planner changes something else", async () => {
    db.cargoItem.findFirst.mockResolvedValue(stored({ stacking: "not-stated", weightEstimate: estimate }) as never)
    await updateCargoItem("p1", "c1", row({ name: "Box of parts" }) as never)
    expect(written()).toMatchObject({ stacking: "not-stated", weightEstimate: estimate })
  })

  it("drops the stacking marker once the planner decides about stacking", async () => {
    db.cargoItem.findFirst.mockResolvedValue(stored({ stacking: "not-stated" }) as never)
    await updateCargoItem("p1", "c1", row({ stackable: true }) as never)
    expect(written()).toBe(Prisma.DbNull)
  })

  it("drops the estimate once the planner enters another weight", async () => {
    db.cargoItem.findFirst.mockResolvedValue(stored({ weightEstimate: estimate }) as never)
    await updateCargoItem("p1", "c1", row({ weightKg: 162 }) as never)
    expect(written()).toBe(Prisma.DbNull)
  })
})

describe("confirming estimated weights", () => {
  it("turns the estimates into confirmed weights and leaves the rest of the line's data alone", async () => {
    db.cargoItem.findMany.mockResolvedValue([
      { id: "c1", customFields: { weightEstimate: estimate, stacking: "not-stated" } },
      { id: "c2", customFields: { weightEstimate: estimate } },
      { id: "c3", customFields: null },
    ] as never)
    const result = await confirmEstimatedWeights("p1", ["c1", "c2", "c3"])
    expect(result).toEqual({ ok: true, confirmed: 2 })
    const updates = db.cargoItem.update.mock.calls.map((call) => call[0]!)
    expect(updates.map((update) => update.where.id)).toEqual(["c1", "c2"])
    expect(updates[0]!.data.customFields).toEqual({ stacking: "not-stated" })
    expect(updates[1]!.data.customFields).toBe(Prisma.DbNull)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })

  it("is refused for a viewer and needs at least one line", async () => {
    expect(await confirmEstimatedWeights("p1", [])).toMatchObject({ ok: false })
    vi.mocked(requireUser).mockResolvedValue({ id: "u", role: "VIEWER", orgId: "o", orgName: "O", name: "N", email: "e@x" } as never)
    expect(await confirmEstimatedWeights("p1", ["c1"])).toMatchObject({ ok: false })
    expect(db.cargoItem.update).not.toHaveBeenCalled()
  })
})
