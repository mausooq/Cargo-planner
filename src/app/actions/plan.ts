"use server"

import { Prisma } from "@prisma/client"
import type { SolverResult } from "@compass/solver"
import { revalidatePath } from "next/cache"
import { editorOrError } from "@/lib/editor"
import { prisma } from "@/lib/prisma"

export async function persistPlan(projectId: string, result: SolverResult) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
    include: { cargoItems: true, candidates: true },
  })
  if (!project) return { ok: false as const, error: "That project is not in this organization." }

  const cargoIds = new Set(project.cargoItems.map((item) => item.id))
  const equipmentIds = new Set(
    project.candidates.map((candidate) => candidate.equipmentTypeId).filter((id): id is string => Boolean(id)),
  )
  for (const unit of result.units) {
    if (!equipmentIds.has(unit.equipmentId)) {
      return { ok: false as const, error: "The plan uses equipment that is not on this project." }
    }
    for (const placement of unit.placements) {
      if (!cargoIds.has(placement.cargoId)) {
        return { ok: false as const, error: "The plan refers to cargo that is no longer on this project." }
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.plan.deleteMany({ where: { projectId: project.id } })
    const plan = await tx.plan.create({
      data: {
        projectId: project.id,
        seed: result.seed,
        status: "COMPLETE",
        settings: asJson(result.settings),
        summary: asJson({
          totalCost: result.totalCost,
          warnings: result.warnings,
          elapsedMs: result.elapsedMs,
          restartsRun: result.restartsRun,
        }),
      },
    })

    for (const unit of result.units) {
      const instance = await tx.equipmentInstance.create({
        data: {
          planId: plan.id,
          equipmentTypeId: unit.equipmentId,
          sequence: unit.unitIndex + 1,
          label: `Unit ${unit.unitIndex + 1}`,
          metrics: asJson(unit.metrics),
        },
      })
      if (unit.placements.length === 0) continue
      await tx.placement.createMany({
        data: unit.placements.map((placement) => ({
          planId: plan.id,
          cargoItemId: placement.cargoId,
          instanceIndex: placement.instanceIndex,
          equipmentInstanceId: instance.id,
          floor: 1,
          xCm: placement.x,
          yCm: placement.y,
          zCm: placement.z,
          rotation: placement.rotation,
          lengthCm: placement.lengthCm,
          widthCm: placement.widthCm,
          heightCm: placement.heightCm,
        })),
      })
    }

    if (result.unloaded.length > 0) {
      await tx.unloadedItem.createMany({
        data: result.unloaded.map((row) => ({
          planId: plan.id,
          cargoItemId: row.cargoId,
          instanceIndex: row.instanceIndex,
          reasonCode: row.reason,
          reasonDetail: row.detail,
        })),
      })
    }
  })

  revalidatePath(`/projects/${project.id}`)
  return { ok: true as const }
}

export async function savePlanLayout(
  projectId: string,
  placements: {
    cargoId: string
    instanceIndex: number
    x: number
    y: number
    z: number
    lengthCm: number
    widthCm: number
    heightCm: number
    rotation: string
  }[],
) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
    include: {
      plans: { orderBy: { createdAt: "desc" }, take: 1, include: { placements: true } },
    },
  })
  if (!project) return { ok: false as const, error: "That project is not in this organization." }
  const plan = project.plans[0]
  if (!plan) return { ok: false as const, error: "Calculate a load plan before saving a layout." }

  const cargoIds = new Set(plan.placements.map((row) => row.cargoItemId))
  for (const row of placements) {
    if (!cargoIds.has(row.cargoId)) {
      return { ok: false as const, error: "That cargo is not on the current plan." }
    }
  }

  await prisma.$transaction(
    placements.map((row) =>
      prisma.placement.updateMany({
        where: { planId: plan.id, cargoItemId: row.cargoId, instanceIndex: row.instanceIndex },
        data: {
          xCm: row.x,
          yCm: row.y,
          zCm: row.z,
          lengthCm: row.lengthCm,
          widthCm: row.widthCm,
          heightCm: row.heightCm,
          rotation: row.rotation,
        },
      }),
    ),
  )

  revalidatePath(`/projects/${project.id}`)
  return { ok: true as const }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
