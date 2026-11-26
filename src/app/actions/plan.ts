"use server"

import { Prisma } from "@prisma/client"
import { cargoShapeSchema, orientationSchema, parseAllowedRotations } from "@compass/domain"
import { computeUnitMetrics, layoutWarnings, type SolverResult, type UnitMetrics } from "@compass/solver"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { MIN_SUPPORT_PCT, projectMinSupportPct } from "@/lib/support-policy"
import { editorOrError } from "@/lib/editor"
import { recordOf } from "@/lib/json"
import {
  checkLayoutChange,
  DEFAULT_MIN_SUPPORT_RATIO,
  type LayoutCargoRules,
  type LayoutPiece,
} from "@/lib/layout-validation"
import { planFromDb } from "@/lib/plan-from-db"
import { metricBoxesOf } from "@/lib/plan-metrics"
import type { PlanItemView } from "@/lib/plan-view"
import { cargoSignature } from "@/lib/plan-staleness"
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
        settings: asJson({
          ...result.settings,
          layoutSource: "AUTO",
          // What the packer was given, so a later cargo edit shows the plan as "out of date".
          cargoSignature: cargoSignature(project.cargoItems),
        }),
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

const layoutRowSchema = z.object({
  cargoId: z.string().min(1),
  instanceIndex: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  lengthCm: z.number().finite().positive(),
  widthCm: z.number().finite().positive(),
  heightCm: z.number().finite().positive(),
  rotation: z.string().min(1).max(12),
})

const optionsSchema = z
  .object({
    /** The minimum support share the planner worked with in the Playground (percent). */
    minSupportPct: z.number().min(MIN_SUPPORT_PCT.min).max(MIN_SUPPORT_PCT.max).nullable().optional(),
  })
  .optional()

export type SavedUnitMetrics = { unitIndex: number; metrics: UnitMetrics; warnings: string[] }
export type LayoutViolation = { unitIndex: number; id: string; message: string }

export type LayoutOptions = {
  minSupportPct?: number | null
}

type LayoutRow = z.infer<typeof layoutRowSchema>

const AXLE_WARNING = /^Unit \d+: .+ is over its limit\.$/

/**
 * Saves a hand-edited layout. The server does not trust the client's numbers: it checks the
 * layout with the Playground's physics rules (walls, collisions, support, stacking, floor-only,
 * allowed turns), then recalculates every metric from the final positions and stores them in the
 * same transaction. The packer is never re-run, so manually placed cargo stays where the planner
 * put it, and the plan is marked as a hand-arranged layout.
 *
 * Whatever else the plan's saved settings hold (older versions kept extra keys there) is written
 * back unchanged.
 *
 * Not checked here (see docs/ASSUMPTIONS.md): payload and axle limits are reported as warnings in
 * the saved metrics, not refusals, and the destination / loading order of the pieces.
 */
export async function savePlanLayout(projectId: string, placements: LayoutRow[], options?: LayoutOptions) {
  const parsed = z.array(layoutRowSchema).max(20000).safeParse(placements)
  if (!parsed.success) return fail("The layout has a position or size that is not a valid number.")
  const parsedOptions = optionsSchema.safeParse(options)
  if (!parsedOptions.success) return fail("The support setting is not valid.")
  return reviewLayout(projectId, parsed.data, parsedOptions.data ?? {})
}

function fail(error: string, violations: LayoutViolation[] = []) {
  return { ok: false as const, error, violations }
}

async function reviewLayout(projectId: string, rows: LayoutRow[], options: NonNullable<z.infer<typeof optionsSchema>>) {
  const access = await editorOrError()
  if (!access.ok) return fail(access.error)

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
    include: {
      plans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          unloaded: { include: { cargoItem: true } },
          instances: { include: { equipmentType: true, placements: { include: { cargoItem: true } } } },
        },
      },
    },
  })
  if (!project) return fail("That project is not in this organization.")
  const plan = project.plans[0]
  if (!plan) return fail("Calculate a load plan before saving a layout.")

  const rules = recordOf(project.rules)
  const planSettings = recordOf(plan.settings)

  // The minimum support share in force: what the Playground worked with, else the project's, else the default.
  const storedSupport = projectMinSupportPct(project.rules)
  const supportPct = options.minSupportPct ?? storedSupport ?? MIN_SUPPORT_PCT.fallback
  const minSupportRatio = supportPct / 100 || DEFAULT_MIN_SUPPORT_RATIO

  // "Before" is the plan as it is saved; "after" is the same plan with the pieces the browser sent.
  const beforeView = planFromDb(plan)
  const afterView = planFromDb(plan)

  const sentById = new Map<string, LayoutRow>()
  for (const row of rows) {
    const id = `${row.cargoId}-${row.instanceIndex}`
    if (sentById.has(id)) return fail("The layout lists the same piece twice.")
    sentById.set(id, row)
  }
  const known = new Set(afterView.units.flatMap((unit) => unit.items.map((item) => item.id)))
  for (const id of sentById.keys()) {
    if (!known.has(id)) return fail("That cargo is not on the current plan. Reload the project and try again.")
  }

  const rulesByCargo = new Map<string, LayoutCargoRules>()
  for (const instance of plan.instances) {
    for (const row of instance.placements) {
      const item = row.cargoItem
      rulesByCargo.set(row.cargoItemId, {
        lengthCm: item.lengthCm,
        widthCm: item.widthCm,
        heightCm: item.heightCm,
        orientation: orientationSchema.safeParse(item.orientation).success ? orientationSchema.parse(item.orientation) : "ROTATE_90",
        shape: cargoShapeSchema.safeParse(item.shape).success ? cargoShapeSchema.parse(item.shape) : "BOX",
        allowedRotations: parseAllowedRotations(storedRotations(item.customFields)),
      })
    }
  }
  const sortedInstances = plan.instances.slice().sort((a, b) => a.sequence - b.sequence)

  const saved: SavedUnitMetrics[] = []
  const writes: Prisma.PrismaPromise<unknown>[] = []
  const finalAxle: { unitIndex: number; loads: UnitMetrics["axleLoads"] }[] = []
  const violations: LayoutViolation[] = []
  let moved = false

  for (const [unitIndex, unit] of afterView.units.entries()) {
    const before = beforeView.units[unitIndex]!
    const instance = sortedInstances[unitIndex]
    if (!instance) continue
    const touched = unit.items.some((item) => sentById.has(item.id))
    if (!touched) {
      finalAxle.push({ unitIndex, loads: unit.axleLoads.map((load) => ({ ...load })) })
      continue
    }
    const missing = unit.items.filter((item) => !sentById.has(item.id))
    if (missing.length > 0) {
      return fail(
        `The layout is missing ${missing.length} piece${missing.length === 1 ? "" : "s"} of unit ${unitIndex + 1}. Add every piece back before saving.`,
      )
    }
    const after: PlanItemView[] = unit.items.map((item) => {
      const row = sentById.get(item.id)!
      return { ...item, x: row.x, y: row.y, z: row.z, lengthCm: row.lengthCm, widthCm: row.widthCm, heightCm: row.heightCm, rotation: row.rotation }
    })
    for (const item of after) {
      const old = before.items.find((entry) => entry.id === item.id)
      if (old && (old.x !== item.x || old.y !== item.y || old.z !== item.z || old.lengthCm !== item.lengthCm || old.widthCm !== item.widthCm || old.rotation !== item.rotation)) {
        moved = true
      }
    }
    const pair = (items: PlanItemView[]): LayoutPiece[] =>
      items.map((item) => ({ item, cargo: rulesByCargo.get(item.cargoId)! }))
    const check = checkLayoutChange(unit, pair(before.items), pair(after), { minSupportRatio })
    if (!check.ok) {
      for (const piece of check.pieces) violations.push({ unitIndex, id: piece.id, message: piece.message })
      continue
    }

    const equipment = instance.equipmentType
    const spec = {
      lengthCm: equipment.innerLengthCm,
      widthCm: equipment.innerWidthCm,
      heightCm: equipment.innerHeightCm,
      maxPayloadKg: equipment.maxPayloadKg,
      tareKg: equipment.tareKg,
      axleGroups: axleGroupsOf(equipment.axleGroups),
    }
    const boxes = metricBoxesOf(after)
    const metrics = computeUnitMetrics(spec, boxes)
    const warnings = layoutWarnings(spec, boxes, metrics)
    saved.push({ unitIndex, metrics, warnings })
    finalAxle.push({ unitIndex, loads: metrics.axleLoads })
    writes.push(prisma.equipmentInstance.update({ where: { id: instance.id }, data: { metrics: asJson({ ...metrics, warnings }) } }))
    for (const item of after) {
      writes.push(
        prisma.placement.updateMany({
          where: { planId: plan.id, cargoItemId: item.cargoId, instanceIndex: instanceIndexOf(item) },
          data: { xCm: item.x, yCm: item.y, zCm: item.z, lengthCm: item.lengthCm, widthCm: item.widthCm, heightCm: item.heightCm, rotation: item.rotation },
        }),
      )
    }
  }

  if (violations.length > 0) {
    const shown = violations.slice(0, 3).map((entry) => entry.message).join(" ")
    const more = violations.length > 3 ? ` And ${violations.length - 3} more.` : ""
    return fail(`Not saved. ${shown}${more}`, violations)
  }

  // Plan-level warnings: keep the packer's own notes (such as pieces that did not fit) and refresh the axle lines.
  const kept = afterView.warnings.filter((line) => !AXLE_WARNING.test(line))
  const axleLines = finalAxle.flatMap(({ unitIndex, loads }) =>
    loads.filter((load) => load.kg > load.maxKg).map((load) => `Unit ${unitIndex + 1}: ${load.name} is over its limit.`),
  )
  const planWarnings = [...kept, ...axleLines]
  const summary = recordOf(plan.summary)

  // Whether the planner has moved cargo by hand. Once it has, the layout stays marked as hand-arranged.
  const manual = planSettings.layoutSource === "MANUAL" || moved
  writes.push(
    prisma.plan.update({
      where: { id: plan.id },
      data: {
        settings: asJson({ ...planSettings, layoutSource: manual ? "MANUAL" : "AUTO" }),
        summary: asJson({ ...summary, warnings: planWarnings }),
      },
    }),
  )

  const supportChanged = options.minSupportPct != null && options.minSupportPct !== (storedSupport ?? MIN_SUPPORT_PCT.fallback)
  if (supportChanged) {
    writes.push(prisma.project.update({ where: { id: project.id }, data: { rules: asJson({ ...rules, minSupportPct: options.minSupportPct }) } }))
  }

  await prisma.$transaction(writes)

  revalidatePath(`/projects/${project.id}`)
  revalidatePath(`/projects/${project.id}/report`)
  return { ok: true as const, units: saved, planWarnings, layoutSource: manual ? ("MANUAL" as const) : ("AUTO" as const) }
}

function instanceIndexOf(item: PlanItemView): number {
  const parsed = Number(item.id.slice(item.cargoId.length + 1))
  return Number.isFinite(parsed) ? parsed : 0
}

function axleGroupsOf(value: unknown): { name: string; positionFromFrontCm: number; maxKg: number }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const row = entry as { name?: unknown; positionFromFrontCm?: unknown; maxKg?: unknown }
    if (typeof row.name !== "string" || typeof row.positionFromFrontCm !== "number" || typeof row.maxKg !== "number") return []
    return [{ name: row.name, positionFromFrontCm: row.positionFromFrontCm, maxKg: row.maxKg }]
  })
}

function storedRotations(value: unknown): string | null {
  const raw = recordOf(value).allowedRotations
  return typeof raw === "string" ? raw : null
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

