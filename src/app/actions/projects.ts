"use server"

import { Prisma } from "@prisma/client"
import {
  canDeleteProjects,
  ETD_IN_PAST_MESSAGE,
  isPastEtdOnServer,
  projectCreateSchema,
  projectEquipmentChoiceSchema,
} from "@compass/domain"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { editorOrError } from "@/lib/editor"
import { prisma } from "@/lib/prisma"

export async function createProject(input: {
  name: string
  mode: string
  etd?: string
  notes?: string
  objective: string
}) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }

  const parsed = projectCreateSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: "Give the project a name, a mode, and an ETD." }
  if (isPastEtdOnServer(parsed.data.etd)) return { ok: false as const, error: ETD_IN_PAST_MESSAGE }

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      mode: parsed.data.mode,
      etd: etdToDate(parsed.data.etd),
      notes: parsed.data.notes?.trim() || null,
      objective: parsed.data.objective,
      orgId: access.user.orgId,
      ownerId: access.user.id,
      rules: emptyJson(),
      solverSettings: emptyJson(),
    },
  })

  revalidatePath("/dashboard")
  return { ok: true as const, id: project.id }
}

export async function updateProjectMeta(
  projectId: string,
  input: { name?: string; notes?: string | null; objective?: string; etd?: string | null },
) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
  })
  if (!project) return { ok: false as const, error: "That project is not in this organization." }
  if (input.etd !== undefined && !input.etd?.trim()) {
    return { ok: false as const, error: "ETD is required." }
  }
  // Keeping an existing past ETD is fine (editing an old project's notes); changing to a past date is not.
  const currentEtd = project.etd ? project.etd.toISOString().slice(0, 10) : null
  if (input.etd && input.etd !== currentEtd && isPastEtdOnServer(input.etd)) {
    return { ok: false as const, error: ETD_IN_PAST_MESSAGE }
  }

  await prisma.project.update({
    where: { id: project.id },
    data: {
      name: input.name?.trim() || project.name,
      notes: input.notes === undefined ? project.notes : input.notes,
      objective: input.objective ?? project.objective,
      etd: input.etd === undefined || !input.etd ? project.etd : etdToDate(input.etd),
    },
  })
  revalidatePath("/dashboard")
  revalidatePath(`/projects/${project.id}`)
  return { ok: true as const }
}

export async function addEquipmentToProject(projectId: string, equipmentTypeId: string, quantity = 1) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }
  if (!projectId) return { ok: false as const, error: "Select a project first." }

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
  })
  if (!project) return { ok: false as const, error: "Select a project first." }

  const type = await prisma.equipmentType.findFirst({
    where: { id: equipmentTypeId, OR: [{ orgId: null }, { orgId: access.user.orgId }] },
  })
  if (!type) return { ok: false as const, error: "That equipment type is not in the library." }

  const existing = await prisma.projectEquipment.findFirst({
    where: { projectId: project.id, equipmentTypeId: type.id },
  })
  if (existing) {
    await prisma.projectEquipment.update({
      where: { id: existing.id },
      data: { maxCount: (existing.maxCount ?? 1) + quantity },
    })
  } else {
    await prisma.projectEquipment.create({
      data: {
        projectId: project.id,
        equipmentTypeId: type.id,
        role: "PRIMARY",
        maxCount: quantity,
      },
    })
  }

  revalidatePath("/dashboard")
  revalidatePath(`/projects/${project.id}`)
  return { ok: true as const, projectId: project.id }
}

export async function setProjectEquipment(
  projectId: string,
  choices: { equipmentTypeId: string; role: "PRIMARY" | "SECONDARY"; maxCount: number | null }[],
) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
  })
  if (!project) return { ok: false as const, error: "That project is not in this organization." }

  const parsed = z.array(projectEquipmentChoiceSchema).safeParse(choices)
  if (!parsed.success) return { ok: false as const, error: "Choose at least one valid equipment type." }

  const ids = parsed.data.map((choice) => choice.equipmentTypeId)
  const types = await prisma.equipmentType.findMany({
    where: { id: { in: ids }, OR: [{ orgId: null }, { orgId: access.user.orgId }] },
  })
  if (types.length !== ids.length) {
    return { ok: false as const, error: "One of those equipment types is not in the library." }
  }

  await prisma.$transaction([
    prisma.projectEquipment.deleteMany({ where: { projectId: project.id } }),
    ...parsed.data.map((choice) =>
      prisma.projectEquipment.create({
        data: {
          projectId: project.id,
          equipmentTypeId: choice.equipmentTypeId,
          role: choice.role,
          maxCount: choice.maxCount,
        },
      }),
    ),
  ])

  revalidatePath(`/projects/${project.id}`)
  return { ok: true as const }
}

export async function removeEquipmentFromProject(projectId: string, equipmentTypeId: string) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
  })
  if (!project) return { ok: false as const, error: "That project is not in this organization." }

  await prisma.projectEquipment.deleteMany({
    where: { projectId: project.id, equipmentTypeId },
  })
  revalidatePath("/dashboard")
  revalidatePath(`/projects/${project.id}`)
  return { ok: true as const }
}

export async function deleteProject(projectId: string) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }
  if (!canDeleteProjects(access.user.role)) {
    return { ok: false as const, error: "Only an admin can delete a project." }
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
  })
  if (!project) return { ok: false as const, error: "That project is not in this organization." }

  await prisma.project.delete({ where: { id: project.id } })
  revalidatePath("/dashboard")
  return { ok: true as const }
}

/** Copies a project's details, cargo, and equipment choices. Load plans are not copied; the copy needs a fresh calculation. */
export async function duplicateProject(projectId: string) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }

  const source = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
    include: { cargoItems: { orderBy: { createdAt: "asc" } }, candidates: true },
  })
  if (!source) return { ok: false as const, error: "That project is not in this organization." }

  const copy = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: `${source.name} (copy)`.slice(0, 120),
        mode: source.mode,
        etd: source.etd,
        notes: source.notes,
        objective: source.objective,
        orgId: access.user.orgId,
        ownerId: access.user.id,
        rules: (source.rules ?? {}) as Prisma.InputJsonValue,
        solverSettings: (source.solverSettings ?? {}) as Prisma.InputJsonValue,
      },
    })
    if (source.cargoItems.length > 0) {
      await tx.cargoItem.createMany({
        data: source.cargoItems.map((item) => ({
          projectId: project.id,
          sortOrder: item.sortOrder,
          sku: item.sku,
          name: item.name,
          lengthCm: item.lengthCm,
          widthCm: item.widthCm,
          heightCm: item.heightCm,
          weightKg: item.weightKg,
          quantity: item.quantity,
          shape: item.shape,
          orientation: item.orientation,
          stackable: item.stackable,
          bottomOnly: item.bottomOnly,
          maxStackLoadKg: item.maxStackLoadKg,
          maxStackLayers: item.maxStackLayers,
          priority: item.priority,
          destinationStop: item.destinationStop,
          consignmentId: item.consignmentId,
          segregationClass: item.segregationClass,
          color: item.color,
          customFields: item.customFields ?? Prisma.DbNull,
        })),
      })
    }
    if (source.candidates.length > 0) {
      await tx.projectEquipment.createMany({
        data: source.candidates.map((candidate) => ({
          projectId: project.id,
          equipmentTypeId: candidate.equipmentTypeId,
          equipmentSetId: candidate.equipmentSetId,
          role: candidate.role,
          minCount: candidate.minCount,
          maxCount: candidate.maxCount,
          costPerUnit: candidate.costPerUnit,
        })),
      })
    }
    return project
  })

  revalidatePath("/dashboard")
  return { ok: true as const, id: copy.id, name: copy.name }
}

/**
 * ETD is a calendar day, so store it as midnight UTC. Pages read it back with toISOString(), which
 * then gives the same day in every time zone. (Local midnight showed one day early east of UTC,
 * e.g. 12 Nov became 11 Nov in India.)
 */
function etdToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function emptyJson(): Prisma.InputJsonObject {
  return {}
}
