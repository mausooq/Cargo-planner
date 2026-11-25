"use server"

import { Prisma } from "@prisma/client"
import { cargoShapeSchema, orientationSchema, parseAllowedRotations } from "@compass/domain"
import type { ClearanceSetting } from "@compass/physics"
import { computeUnitMetrics, layoutWarnings, type SolverResult, type UnitMetrics } from "@compass/solver"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import {
  clearanceConfig,
  cleanSetting,
  MAX_CLEARANCE_CM,
  sameClearanceConfig,
  MIN_SUPPORT_PCT,
  parseClearanceConfig,
  projectClearance,
  projectMinSupportPct,
  cargoSetting,
  normaliseClearance,
  settingToJson,
  type ClearanceConfig,
} from "@/lib/clearance"
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
import { cargoSignature, planStaleness } from "@/lib/plan-staleness"
import { prisma } from "@/lib/prisma"

export async function persistPlan(projectId: string, result: SolverResult, usedConfig?: unknown) {
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

  // The configuration the packer actually used (sent by the browser), or the project's current one.
  // Recording it lets a later change be told apart from "the plan was calculated with this".
  const used =
    parseClearanceConfig(usedConfig) ??
    clearanceConfig(
      projectClearance(project.rules),
      project.cargoItems.map((item) => ({ id: item.id, setting: cargoSetting(item.customFields) })),
    )

  await prisma.$transaction(async (tx) => {
    await tx.plan.deleteMany({ where: { projectId: project.id } })
    const plan = await tx.plan.create({
      data: {
        projectId: project.id,
        seed: result.seed,
        status: "COMPLETE",
        settings: asJson({
          ...result.settings,
          clearanceConfig: used,
          layoutSource: "AUTO",
          // What the packer was given, so a later cargo edit shows as "out of date" without clearance getting in the way.
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

const sidesSchema = z.object({
  front: z.number().min(0).max(MAX_CLEARANCE_CM),
  rear: z.number().min(0).max(MAX_CLEARANCE_CM),
  left: z.number().min(0).max(MAX_CLEARANCE_CM),
  right: z.number().min(0).max(MAX_CLEARANCE_CM),
})

const settingSchema = z.union([z.null(), z.number().min(0).max(MAX_CLEARANCE_CM), sidesSchema])

const optionsSchema = z
  .object({
    /** A new project default handling clearance (cm per side), applied together with the rest. */
    defaultCm: z.number().min(0).max(MAX_CLEARANCE_CM).optional(),
    /** The minimum support share the planner worked with in the Playground (percent). */
    minSupportPct: z.number().min(MIN_SUPPORT_PCT.min).max(MIN_SUPPORT_PCT.max).nullable().optional(),
    /** Per-line clearance changes made in the Playground, applied together with the layout. */
    clearanceChanges: z.array(z.object({ cargoId: z.string().min(1), setting: settingSchema })).max(5000).optional(),
  })
  .optional()

export type SavedUnitMetrics = { unitIndex: number; metrics: UnitMetrics; warnings: string[] }
export type LayoutViolation = { unitIndex: number; id: string; message: string }

export type LayoutOptions = {
  defaultCm?: number
  minSupportPct?: number | null
  clearanceChanges?: { cargoId: string; setting: ClearanceSetting }[]
}

type LayoutRow = z.infer<typeof layoutRowSchema>

const AXLE_WARNING = /^Unit \d+: .+ is over its limit\.$/

/**
 * Saves a hand-edited layout. The server does not trust the client's numbers: it checks the
 * layout with the Playground's physics rules (walls, collisions, handling clearance, support,
 * stacking, floor-only, allowed turns and facings), then recalculates every metric from the final
 * positions and stores them in the same transaction. The packer is never re-run, so manually
 * placed cargo stays where the planner put it.
 *
 * Pending clearance changes made in the Playground ride along: they are checked against the
 * layout first, and nothing is stored unless the whole arrangement is valid under them.
 *
 * Not checked here (see docs/ASSUMPTIONS.md): payload and axle limits are reported as warnings in
 * the saved metrics, not refusals, and the destination / loading order of the pieces.
 */
export async function savePlanLayout(projectId: string, placements: LayoutRow[], options?: LayoutOptions) {
  const parsed = z.array(layoutRowSchema).max(20000).safeParse(placements)
  if (!parsed.success) return fail("The layout has a position or size that is not a valid number.")
  const parsedOptions = optionsSchema.safeParse(options)
  if (!parsedOptions.success) return fail("The clearance or support settings are not valid.")
  return reviewLayout(projectId, parsed.data, parsedOptions.data ?? {})
}

/**
 * Checks the layout that is already saved against the clearance configuration now in force, and
 * when it still works recalculates its metrics WITHOUT moving anything. This is the "keep my
 * current layout" path after a clearance change. It never runs the packer.
 */
export async function revalidatePlanLayout(projectId: string, options?: LayoutOptions) {
  const parsedOptions = optionsSchema.safeParse(options)
  if (!parsedOptions.success) return fail("The clearance settings are not valid.")
  return reviewLayout(projectId, null, parsedOptions.data ?? {})
}

function fail(error: string, violations: LayoutViolation[] = []) {
  return { ok: false as const, error, violations }
}

async function reviewLayout(projectId: string, rows: LayoutRow[] | null, options: NonNullable<z.infer<typeof optionsSchema>>) {
  const access = await editorOrError()
  if (!access.ok) return fail(access.error)

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
    include: {
      cargoItems: true,
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
  const snapshotDefault = typeof planSettings.clearanceCm === "number" ? planSettings.clearanceCm : 0
  // The project's own default is the one in force; a plan that predates it keeps its own.
  const dbDefault = "clearanceCm" in rules ? projectClearance(rules) : snapshotDefault
  // A default changed together with this review takes effect for the layout being judged.
  const currentDefault = options.defaultCm === undefined ? dbDefault : normaliseClearance(options.defaultCm)
  const snapshot = parseClearanceConfig(planSettings.clearanceConfig)

  // Pending per-line changes (Playground) become the configuration the layout is judged under.
  const changes = new Map<string, ClearanceSetting>()
  for (const change of options.clearanceChanges ?? []) {
    const setting = cleanSetting(change.setting as ClearanceSetting)
    if (change.setting !== null && setting === null) return fail("One of the clearance values is not valid.")
    changes.set(change.cargoId, setting)
  }
  const projectCargoList = project.cargoItems ?? []
  // Plans from before cargo signatures can only tell "edited since" by time; note it BEFORE our own writes bump those times.
  const hasSignature = typeof planSettings.cargoSignature === "string"
  const hadUnrelatedEdits = !hasSignature && planStaleness(plan, projectCargoList, dbDefault) === "cargo"
  const projectCargo = new Map(projectCargoList.map((item) => [item.id, item.customFields]))
  const planCargoIds = new Set(plan.instances.flatMap((instance) => instance.placements.map((row) => row.cargoItemId)))
  for (const id of changes.keys()) {
    if (!projectCargo.has(id) && !planCargoIds.has(id)) return fail("A clearance change refers to cargo that is not on this project.")
  }

  // The minimum support share in force: what the Playground worked with, else the project's, else the default.
  const storedSupport = projectMinSupportPct(project.rules)
  const supportPct = options.minSupportPct ?? storedSupport ?? MIN_SUPPORT_PCT.fallback
  const minSupportRatio = supportPct / 100 || DEFAULT_MIN_SUPPORT_RATIO

  // "Before" is the plan as it was last validated: the configuration it recorded (a line it did not list was
  // inheriting). A plan from before configurations were recorded only has the database to go on.
  const planLineIds = [...planCargoIds]
  const beforeOverrides = snapshot ? new Map(planLineIds.map((id) => [id, snapshot.lines[id] ?? null] as const)) : new Map<string, ClearanceSetting>()
  const beforeView = planFromDb(withSettings(plan, beforeOverrides), { clearanceCm: snapshot ? snapshot.defaultCm : dbDefault })
  const afterView = planFromDb(withSettings(plan, changes), { clearanceCm: currentDefault })

  // The configuration this layout will have been checked under, and whether it differs from the one the plan was validated under.
  const lines = new Map<string, ClearanceSetting>()
  for (const item of projectCargoList) lines.set(item.id, changes.has(item.id) ? (changes.get(item.id) ?? null) : cargoSetting(item.customFields))
  for (const unit of afterView.units) {
    for (const item of unit.items) if (!lines.has(item.cargoId)) lines.set(item.cargoId, item.clearanceSetting ?? null)
  }
  const fullConfig: ClearanceConfig = clearanceConfig(
    currentDefault,
    [...lines].map(([id, setting]) => ({ id, setting })),
  )
  const configDiffers = snapshot ? !sameClearanceConfig(snapshot, fullConfig) : currentDefault !== snapshotDefault
  // Every unit is checked when the configuration changed, whichever units the browser sent: a plan is only
  // recorded as checked under a configuration that every one of its units has been checked against.
  const checkEveryUnit = rows === null || configDiffers || changes.size > 0

  const sentById = new Map<string, LayoutRow>()
  if (rows) {
    for (const row of rows) {
      const id = `${row.cargoId}-${row.instanceIndex}`
      if (sentById.has(id)) return fail("The layout lists the same piece twice.")
      sentById.set(id, row)
    }
    const known = new Set(afterView.units.flatMap((unit) => unit.items.map((item) => item.id)))
    for (const id of sentById.keys()) {
      if (!known.has(id)) return fail("That cargo is not on the current plan. Reload the project and try again.")
    }
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
    if (!touched && !checkEveryUnit) {
      finalAxle.push({ unitIndex, loads: unit.axleLoads.map((load) => ({ ...load })) })
      continue
    }
    if (rows !== null && touched) {
      const missing = unit.items.filter((item) => !sentById.has(item.id))
      if (missing.length > 0) {
        return fail(
          `The layout is missing ${missing.length} piece${missing.length === 1 ? "" : "s"} of unit ${unitIndex + 1}. Add every piece back before saving.`,
        )
      }
    }
    const after: PlanItemView[] = unit.items.map((item) => {
      const row = sentById.get(item.id)
      return row
        ? { ...item, x: row.x, y: row.y, z: row.z, lengthCm: row.lengthCm, widthCm: row.widthCm, heightCm: row.heightCm, rotation: row.rotation }
        : item
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
    // Pieces of a unit that was not sent keep their stored positions: only their numbers are refreshed.
    if (rows !== null && touched) {
      for (const item of after) {
        writes.push(
          prisma.placement.updateMany({
            where: { planId: plan.id, cargoItemId: item.cargoId, instanceIndex: instanceIndexOf(item) },
            data: { xCm: item.x, yCm: item.y, zCm: item.z, lengthCm: item.lengthCm, widthCm: item.widthCm, heightCm: item.heightCm, rotation: item.rotation },
          }),
        )
      }
    }
  }

  if (violations.length > 0) {
    const shown = violations.slice(0, 3).map((entry) => entry.message).join(" ")
    const more = violations.length > 3 ? ` And ${violations.length - 3} more.` : ""
    const lead = rows === null || changes.size > 0 ? "The layout no longer works with these clearances. Nothing was saved. " : "Not saved. "
    return fail(`${lead}${shown}${more}`, violations)
  }

  // Plan-level warnings: keep the packer's own notes (such as pieces that did not fit) and refresh the axle lines.
  const kept = afterView.warnings.filter((line) => !AXLE_WARNING.test(line))
  const axleLines = finalAxle.flatMap(({ unitIndex, loads }) =>
    loads.filter((load) => load.kg > load.maxKg).map((load) => `Unit ${unitIndex + 1}: ${load.name} is over its limit.`),
  )
  const planWarnings = [...kept, ...axleLines]
  const summary = recordOf(plan.summary)

  // Whether the planner has moved cargo by hand.
  const manual = planSettings.layoutSource === "MANUAL" || moved
  writes.push(
    prisma.plan.update({
      where: { id: plan.id },
      data: {
        settings: asJson({
          ...planSettings,
          clearanceCm: currentDefault,
          clearanceConfig: fullConfig,
          layoutSource: manual ? "MANUAL" : "AUTO",
        }),
        summary: asJson({ ...summary, warnings: planWarnings }),
      },
    }),
  )

  // Pending line settings become the project's settings, in the same transaction.
  for (const [cargoId, setting] of changes) {
    const existing = projectCargo.get(cargoId) ?? plan.instances.flatMap((i) => i.placements).find((row) => row.cargoItemId === cargoId)?.cargoItem.customFields
    writes.push(prisma.cargoItem.update({ where: { id: cargoId }, data: { customFields: mergeSetting(existing, setting) } }))
  }
  const supportChanged = options.minSupportPct != null && options.minSupportPct !== (storedSupport ?? MIN_SUPPORT_PCT.fallback)
  const defaultChanged = currentDefault !== dbDefault
  if (supportChanged || defaultChanged) {
    writes.push(
      prisma.project.update({
        where: { id: project.id },
        data: {
          rules: asJson({
            ...rules,
            ...(supportChanged ? { minSupportPct: options.minSupportPct } : {}),
            ...(defaultChanged ? { clearanceCm: currentDefault } : {}),
          }),
        },
      }),
    )
  }

  await prisma.$transaction(writes)
  // Stamped after the line and project updates above, so that "edited since the plan was checked" can
  // never see those updates as newer than the check. If this step fails the plan is only marked out of date.
  // Only plans without a cargo signature need it, and only when no other cargo edit is waiting: a clearance re-check must
  // never clear an out-of-date status that belongs to something else.
  if (!hasSignature && !hadUnrelatedEdits) {
    await prisma.plan.update({
      where: { id: plan.id },
      data: { settings: asJson({ ...planSettings, clearanceCm: currentDefault, clearanceConfig: fullConfig, layoutSource: manual ? "MANUAL" : "AUTO", syncedAt: new Date().toISOString() }) },
    })
  }

  revalidatePath(`/projects/${project.id}`)
  revalidatePath(`/projects/${project.id}/report`)
  return { ok: true as const, units: saved, planWarnings, layoutSource: manual ? ("MANUAL" as const) : ("AUTO" as const) }
}

/** The plan rows with each line's clearance setting replaced. Lines not listed keep what the database holds. */
function withSettings<T extends { instances: { placements: { cargoItemId: string; cargoItem: { customFields?: unknown } }[] }[] }>(
  plan: T,
  overrides: Map<string, ClearanceSetting> | Record<string, ClearanceSetting>,
): T {
  const map = overrides instanceof Map ? overrides : new Map(Object.entries(overrides))
  if (map.size === 0) return plan
  return {
    ...plan,
    instances: plan.instances.map((instance) => ({
      ...instance,
      placements: instance.placements.map((row) =>
        map.has(row.cargoItemId)
          ? { ...row, cargoItem: { ...row.cargoItem, customFields: mergeSetting(row.cargoItem.customFields, map.get(row.cargoItemId) ?? null) } }
          : row,
      ),
    })),
  }
}

/** A line's `customFields` with its clearance setting replaced and everything else (such as allowed rotations) kept. */
function mergeSetting(existing: unknown, setting: ClearanceSetting): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const rest = { ...recordOf(existing) }
  delete rest.clearanceCm
  delete rest.clearanceSides
  const next = { ...rest, ...settingToJson(setting) }
  return Object.keys(next).length === 0 ? Prisma.DbNull : (next as Prisma.InputJsonObject)
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

