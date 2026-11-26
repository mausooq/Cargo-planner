import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    cargoItem: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}))

import { Prisma } from "@prisma/client"
import { updateCargoItem } from "@/app/actions/cargo"
import { cargoPreset } from "@/lib/cargo-defaults"
import { cargoSignature } from "@/lib/plan-staleness"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"
import { projectMinSupportPct } from "@/lib/support-policy"

const db = vi.mocked(prisma, true)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ id: "u", role: "PLANNER", orgId: "o", orgName: "O", name: "N", email: "e@x" } as never)
  db.project.findFirst.mockResolvedValue({ id: "p1" } as never)
})

const stored = (customFields: unknown) => ({ id: "c1", projectId: "p1", customFields })
const input = (extra: Record<string, unknown> = {}) => ({ ...cargoPreset("BOX"), name: "Crate", lengthCm: 100, widthCm: 80, heightCm: 60, weightKg: 10, ...extra })

describe("cargo saved by an earlier version, with a retired clearance setting in its JSON", () => {
  it("keeps the dormant keys when the line is edited, and still writes the rotations the line needs", async () => {
    db.cargoItem.findFirst.mockResolvedValue(stored({ clearanceCm: 6, clearanceSides: { front: 1, rear: 2, left: 3, right: 4 }, note: "kept" }) as never)
    const result = await updateCargoItem("p1", "c1", input({ orientation: "CUSTOM", allowedRotations: ["LWH", "WLH"] }) as never)
    expect(result).toEqual({ ok: true })
    const data = db.cargoItem.update.mock.calls[0]![0]!.data as { customFields: Record<string, unknown> }
    expect(data.customFields).toMatchObject({ clearanceCm: 6, note: "kept" })
    expect(data.customFields.clearanceSides).toEqual({ front: 1, rear: 2, left: 3, right: 4 })
    expect(typeof data.customFields.allowedRotations).toBe("string")
  })

  it("drops only the rotations when the line stops being custom", async () => {
    db.cargoItem.findFirst.mockResolvedValue(stored({ allowedRotations: "LWH,WLH", clearanceCm: 6 }) as never)
    await updateCargoItem("p1", "c1", input({ orientation: "ANY" }) as never)
    const data = db.cargoItem.update.mock.calls[0]![0]!.data as { customFields: Record<string, unknown> }
    expect(data.customFields).toEqual({ clearanceCm: 6 })
  })

  it("stores nothing when the line has nothing to keep", async () => {
    db.cargoItem.findFirst.mockResolvedValue(stored(null) as never)
    await updateCargoItem("p1", "c1", input() as never)
    expect(db.cargoItem.update.mock.calls[0]![0]!.data.customFields).toBe(Prisma.DbNull)
  })

  it("does not take a clearance from the editor: a value sent with the line is not stored", async () => {
    db.cargoItem.findFirst.mockResolvedValue(stored(null) as never)
    await updateCargoItem("p1", "c1", input({ clearanceCm: 9, clearanceSides: { front: 1, rear: 1, left: 1, right: 1 } }) as never)
    expect(db.cargoItem.update.mock.calls[0]![0]!.data.customFields).toBe(Prisma.DbNull)
  })

  it("has the same plan signature whatever clearance data the line carries", () => {
    const line = { id: "c1", lengthCm: 100, widthCm: 80, heightCm: 60, weightKg: 10, quantity: 1, shape: "BOX", orientation: "ANY" }
    expect(cargoSignature([{ ...line, customFields: null }])).toBe(cargoSignature([{ ...line, customFields: { clearanceCm: 12, clearanceSides: { front: 1, rear: 1, left: 1, right: 1 } } }]))
  })
})

describe("a project saved by an earlier version, with a clearance in its rules", () => {
  it("keeps its minimum support share and ignores the clearance", () => {
    expect(projectMinSupportPct({ clearanceCm: 9 })).toBeNull()
    expect(projectMinSupportPct({ clearanceCm: 9, minSupportPct: 60 })).toBe(60)
  })
})

describe("notes from an import stay with a draft only while it is incomplete", () => {
  it("keeps them when the line is edited and is still missing something", async () => {
    db.cargoItem.findFirst.mockResolvedValue(stored({ importNotes: ["Weight as written: 2360 kg (per piece or for the line not stated)."] }) as never)
    await updateCargoItem("p1", "c1", input({ weightKg: 0 }) as never)
    const data = db.cargoItem.update.mock.calls[0]![0]!.data as { customFields: Record<string, unknown> }
    expect(data.customFields.importNotes).toEqual(["Weight as written: 2360 kg (per piece or for the line not stated)."])
  })

  it("drops them once the line is complete", async () => {
    db.cargoItem.findFirst.mockResolvedValue(stored({ importNotes: ["old note"], clearanceCm: 4 }) as never)
    await updateCargoItem("p1", "c1", input() as never)
    const data = db.cargoItem.update.mock.calls[0]![0]!.data as { customFields: Record<string, unknown> }
    expect(data.customFields).toEqual({ clearanceCm: 4 })
  })
})
