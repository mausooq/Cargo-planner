"use server"

import { equipmentFieldErrors, equipmentWriteSchemaFor, type EquipmentWriteInput } from "@compass/domain"
import { Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { adminOrError } from "@/lib/editor"
import { parseEquipmentCsv } from "@/lib/equipment-import"
import { prisma } from "@/lib/prisma"

type ActionFail = { ok: false; error: string; fieldErrors?: Record<string, string> }
type ActionOk = { ok: true; id: string }

export async function createEquipment(input: unknown): Promise<ActionOk | ActionFail> {
  const access = await adminOrError()
  if (!access.ok) return access

  const parsed = await parseEquipment(input, access.user.orgId)
  if (!parsed.ok) return parsed

  const data = parsed.data
  const created = await prisma.equipmentType.create({
    data: {
      ...dimensionData(data),
      mode: data.mode,
      code: customCode(data.name),
      floors: 1,
      axleGroups: emptyJson(),
      costPerUnit: 0,
      isCustom: true,
      extendable: false,
      orgId: access.user.orgId,
    },
  })

  revalidatePath("/equipment")
  return { ok: true, id: created.id }
}

export async function updateEquipment(input: unknown): Promise<ActionOk | ActionFail> {
  const access = await adminOrError()
  if (!access.ok) return access

  const id = readId(input)
  if (!id) return { ok: false, error: "Check the name, dimensions, and payload.", fieldErrors: { id: "Choose equipment to update." } }

  const existing = await prisma.equipmentType.findFirst({
    where: { id, OR: [{ orgId: null }, { orgId: access.user.orgId }] },
  })
  if (!existing) return { ok: false, error: "That equipment is not in this library." }

  const parsed = await parseEquipment(input, access.user.orgId, existing.orgId === access.user.orgId ? existing.id : undefined)
  if (!parsed.ok) return parsed
  const data = parsed.data

  if (existing.orgId == null) {
    const created = await prisma.equipmentType.create({
      data: {
        ...dimensionData(data),
        mode: data.mode,
        code: customCode(data.name),
        floors: existing.floors,
        axleGroups: existing.axleGroups as Prisma.InputJsonValue,
        costPerUnit: existing.costPerUnit,
        isCustom: true,
        extendable: existing.extendable,
        maxExtendedLengthCm: existing.maxExtendedLengthCm,
        orgId: access.user.orgId,
      },
    })
    revalidatePath("/equipment")
    return { ok: true, id: created.id }
  }

  const updated = await prisma.equipmentType.updateMany({
    where: { id: existing.id, orgId: access.user.orgId },
    data: dimensionData(data),
  })
  if (updated.count !== 1) return { ok: false, error: "That equipment is not in this library." }

  revalidatePath("/equipment")
  return { ok: true, id: existing.id }
}

export async function deleteEquipment(id: string): Promise<{ ok: true } | ActionFail> {
  const access = await adminOrError()
  if (!access.ok) return access

  const existing = await prisma.equipmentType.findFirst({
    where: { id, isCustom: true, orgId: access.user.orgId },
  })
  if (!existing) return { ok: false, error: "Only custom equipment can be removed." }

  const [projectUnits, planUnits, setMembers] = await Promise.all([
    prisma.projectEquipment.count({ where: { equipmentTypeId: existing.id } }),
    prisma.equipmentInstance.count({ where: { equipmentTypeId: existing.id } }),
    prisma.equipmentSetMember.count({ where: { equipmentTypeId: existing.id } }),
  ])
  const count = projectUnits + planUnits + setMembers
  if (count > 0) {
    const noun = count === 1 ? "unit" : "units"
    return { ok: false, error: `This equipment is used by ${count} project ${noun}.` }
  }

  await prisma.equipmentType.delete({ where: { id: existing.id } })
  revalidatePath("/equipment")
  return { ok: true }
}

export async function importEquipmentCsv(csv: string): Promise<{ ok: true; created: number; errors: { row: number; message: string }[] } | ActionFail> {
  const access = await adminOrError()
  if (!access.ok) return access

  const table = parseEquipmentCsv(csv)
  if (table.error) return { ok: false, error: table.error }

  const existing = await prisma.equipmentType.findMany({
    where: { orgId: access.user.orgId },
    select: { name: true },
  })
  const taken = existing.map((row) => row.name)
  const errors: { row: number; message: string }[] = []
  let createdCount = 0

  for (const entry of table.rows) {
    const parsed = equipmentWriteSchemaFor(taken).safeParse(entry.input)
    if (!parsed.success) {
      const fieldErrors = equipmentFieldErrors(parsed.error)
      errors.push({ row: entry.row, message: Object.values(fieldErrors).join(" ") || "This row could not be read." })
      continue
    }
    const data = parsed.data
    await prisma.equipmentType.create({
      data: {
        ...dimensionData(data),
        mode: data.mode,
        code: customCode(data.name),
        floors: 1,
        axleGroups: emptyJson(),
        costPerUnit: 0,
        isCustom: true,
        extendable: false,
        orgId: access.user.orgId,
      },
    })
    taken.push(data.name)
    createdCount += 1
  }

  if (createdCount > 0) revalidatePath("/equipment")
  return { ok: true, created: createdCount, errors }
}

async function parseEquipment(input: unknown, orgId: string, exceptId?: string): Promise<{ ok: true; data: EquipmentWriteInput } | ActionFail> {
  const taken = await prisma.equipmentType.findMany({
    where: { orgId, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { name: true },
  })
  const parsed = equipmentWriteSchemaFor(taken.map((row) => row.name)).safeParse(input)
  if (!parsed.success) {
    const fieldErrors = equipmentFieldErrors(parsed.error)
    const error = Object.values(fieldErrors)[0] ?? "Check the name, dimensions, and payload."
    return { ok: false, error, fieldErrors }
  }
  return { ok: true, data: parsed.data }
}

function dimensionData(data: EquipmentWriteInput) {
  return {
    name: data.name,
    sizeLabel: sizeLabel(data),
    innerLengthCm: data.innerLengthCm,
    innerWidthCm: data.innerWidthCm,
    innerHeightCm: data.innerHeightCm,
    heightOpen: data.heightOpen,
    maxPayloadKg: data.maxPayloadKg,
    tareKg: data.tareKg,
    doorWidthCm: data.doorWidthCm,
    doorHeightCm: data.doorHeightCm,
    oogClass: data.oogClass,
    notes: data.notes,
    contour: data.contour as Prisma.InputJsonValue,
  }
}

function sizeLabel(data: { innerLengthCm: number; innerWidthCm: number; innerHeightCm: number }) {
  return `${data.innerLengthCm} x ${data.innerWidthCm} x ${data.innerHeightCm} CM`
}

function customCode(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return `custom-${slug || "unit"}-${Date.now().toString(36)}`
}

function emptyJson(): Prisma.InputJsonValue {
  return []
}

function readId(input: unknown): string | null {
  if (!input || typeof input !== "object" || !("id" in input)) return null
  const id = (input as { id?: unknown }).id
  return typeof id === "string" && id.length > 0 ? id : null
}
