"use server"

import { Prisma } from "@prisma/client"
import { equipmentWriteSchema } from "@compass/domain"
import { revalidatePath } from "next/cache"
import { adminOrError } from "@/lib/editor"
import { prisma } from "@/lib/prisma"

export async function createEquipment(input: unknown) {
  const access = await adminOrError()
  if (!access.ok) return access

  const parsed = equipmentWriteSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: "Check the name, dimensions, and payload." }

  const data = parsed.data
  await prisma.equipmentType.create({
    data: {
      mode: data.mode,
      name: data.name,
      code: customCode(data.name),
      sizeLabel: sizeLabel(data),
      innerLengthCm: data.innerLengthCm,
      innerWidthCm: data.innerWidthCm,
      innerHeightCm: data.innerHeightCm,
      heightOpen: data.heightOpen,
      maxPayloadKg: data.maxPayloadKg,
      tareKg: data.tareKg,
      doorWidthCm: data.doorWidthCm,
      doorHeightCm: data.doorHeightCm,
      floors: 1,
      axleGroups: emptyJson(),
      costPerUnit: 0,
      isCustom: true,
      extendable: false,
      oogClass: data.oogClass,
      notes: data.notes,
      contour: data.contour as Prisma.InputJsonValue,
      orgId: access.user.orgId,
    },
  })

  revalidatePath("/equipment")
  return { ok: true as const }
}

export async function updateEquipment(input: unknown) {
  const access = await adminOrError()
  if (!access.ok) return access

  const parsed = equipmentWriteSchema.safeParse(input)
  if (!parsed.success || !parsed.data.id) {
    return { ok: false as const, error: "Check the name, dimensions, and payload." }
  }

  const data = parsed.data
  const existing = await prisma.equipmentType.findFirst({
    where: { id: data.id, OR: [{ orgId: null }, { orgId: access.user.orgId }] },
  })
  if (!existing) return { ok: false as const, error: "That equipment is not in this library." }

  await prisma.equipmentType.update({
    where: { id: existing.id },
    data: {
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
    },
  })

  revalidatePath("/equipment")
  return { ok: true as const }
}

export async function deleteEquipment(id: string) {
  const access = await adminOrError()
  if (!access.ok) return access

  const existing = await prisma.equipmentType.findFirst({
    where: { id, isCustom: true, orgId: access.user.orgId },
  })
  if (!existing) return { ok: false as const, error: "Only custom equipment can be removed." }

  await prisma.equipmentType.delete({ where: { id: existing.id } })
  revalidatePath("/equipment")
  return { ok: true as const }
}

function sizeLabel(data: { innerLengthCm: number; innerWidthCm: number; innerHeightCm: number }) {
  return `${trim(data.innerLengthCm)} x ${trim(data.innerWidthCm)} x ${trim(data.innerHeightCm)} CM`
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
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
