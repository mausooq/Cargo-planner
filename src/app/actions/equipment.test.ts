import { beforeEach, describe, expect, it, vi } from "vitest"
import { equipmentWriteSchema, equipmentWriteSchemaFor } from "@compass/domain"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    equipmentType: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    projectEquipment: { count: vi.fn() },
    equipmentInstance: { count: vi.fn() },
    equipmentSetMember: { count: vi.fn() },
  },
}))

import { createEquipment, deleteEquipment, updateEquipment } from "@/app/actions/equipment"
import { prisma } from "@/lib/prisma"
import { requireUser } from "@/lib/session"

const requireUserMock = vi.mocked(requireUser)
const equipmentType = prisma.equipmentType
const emptyContour = {
  bottomLeft: { lengthMm: 0, heightMm: 0 },
  bottomRight: { lengthMm: 0, heightMm: 0 },
  topLeft: { lengthMm: 0, heightMm: 0 },
  topRight: { lengthMm: 0, heightMm: 0 },
}

function user(role: "ADMIN" | "PLANNER" | "VIEWER") {
  return {
    id: "user-1",
    role,
    orgId: "org-1",
    orgName: "Compass",
    name: "Demo",
    email: `${role.toLowerCase()}@compass.local`,
  }
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: "eq-1",
    mode: "SEA",
    name: "Custom box",
    innerLengthCm: 120,
    innerWidthCm: 50,
    innerHeightCm: 40,
    heightOpen: false,
    maxPayloadKg: 1000,
    tareKg: 20,
    doorWidthCm: 48,
    doorHeightCm: 38,
    oogClass: "NONE",
    notes: null,
    contour: emptyContour,
    ...overrides,
  }
}

describe("equipment actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("refuses writes from a planner", async () => {
    requireUserMock.mockResolvedValue(user("PLANNER") as Awaited<ReturnType<typeof requireUser>>)
    const result = await updateEquipment(payload())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/admin/i)
    expect(equipmentType.updateMany).not.toHaveBeenCalled()
    expect(equipmentType.create).not.toHaveBeenCalled()
  })

  it("refuses writes from a viewer", async () => {
    requireUserMock.mockResolvedValue(user("VIEWER") as Awaited<ReturnType<typeof requireUser>>)
    const created = await createEquipment(payload())
    const removed = await deleteEquipment("eq-1")
    expect(created.ok).toBe(false)
    expect(removed.ok).toBe(false)
    expect(equipmentType.create).not.toHaveBeenCalled()
    expect(equipmentType.delete).not.toHaveBeenCalled()
  })

  it("copies a system row instead of modifying it", async () => {
    requireUserMock.mockResolvedValue(user("ADMIN") as Awaited<ReturnType<typeof requireUser>>)
    vi.mocked(equipmentType.findFirst).mockResolvedValue({
      id: "sys-1",
      orgId: null,
      floors: 1,
      axleGroups: [],
      costPerUnit: 2,
      extendable: false,
      maxExtendedLengthCm: null,
    } as never)
    vi.mocked(equipmentType.findMany).mockResolvedValue([] as never)
    vi.mocked(equipmentType.create).mockResolvedValue({ id: "copy-1" } as never)

    const result = await updateEquipment(payload({ id: "sys-1", name: "Saved box" }))

    expect(result).toEqual({ ok: true, id: "copy-1" })
    expect(equipmentType.updateMany).not.toHaveBeenCalled()
    expect(equipmentType.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orgId: "org-1", isCustom: true, name: "Saved box" }),
      }),
    )
  })
})

describe("equipment cross-field validation", () => {
  it("rejects a door larger than the interior, a contour above the roof, and a negative tare", () => {
    const wideDoor = equipmentWriteSchema.safeParse(payload({ doorWidthCm: 80 }))
    expect(wideDoor.success).toBe(false)
    if (!wideDoor.success) expect(wideDoor.error.issues.some((issue) => issue.path.join(".") === "doorWidthCm")).toBe(true)

    const tallContour = equipmentWriteSchema.safeParse(
      payload({ contour: { ...emptyContour, topLeft: { lengthMm: 100, heightMm: 500 } } }),
    )
    expect(tallContour.success).toBe(false)
    if (!tallContour.success) {
      expect(tallContour.error.issues.some((issue) => issue.path.join(".") === "contour.topLeft.heightMm")).toBe(true)
    }

    const negativeTare = equipmentWriteSchema.safeParse(payload({ tareKg: -1 }))
    expect(negativeTare.success).toBe(false)
    if (!negativeTare.success) expect(negativeTare.error.issues.some((issue) => issue.path[0] === "tareKg")).toBe(true)
  })

  it("rejects a name already used in the organisation", () => {
    const parsed = equipmentWriteSchemaFor(["Custom box"]).safeParse(payload())
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path[0] === "name")).toBe(true)
  })
})
