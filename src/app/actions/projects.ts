"use server"

import { Prisma } from "@prisma/client"
import { canDeleteProjects, projectCreateSchema, projectEquipmentChoiceSchema } from "@compass/domain"
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

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      mode: parsed.data.mode,
      etd: new Date(`${parsed.data.etd}T00:00:00`),
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

  await prisma.project.update({
    where: { id: project.id },
    data: {
      name: input.name?.trim() || project.name,
      notes: input.notes === undefined ? project.notes : input.notes,
      objective: input.objective ?? project.objective,
      etd: input.etd === undefined ? project.etd : new Date(`${input.etd}T00:00:00`),
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

function emptyJson(): Prisma.InputJsonObject {
  return {}
}
