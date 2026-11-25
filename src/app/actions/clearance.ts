"use server"

import { Prisma } from "@prisma/client"
import type { ClearanceSetting } from "@compass/physics"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import {
  cargoSetting,
  clearanceConfig,
  cleanSetting,
  MAX_CLEARANCE_CM,
  normaliseClearance,
  projectClearance,
  settingToJson,
  type ClearanceConfig,
} from "@/lib/clearance"
import { editorOrError } from "@/lib/editor"
import { recordOf } from "@/lib/json"
import { prisma } from "@/lib/prisma"

const sidesSchema = z.object({
  front: z.number().min(0).max(MAX_CLEARANCE_CM),
  rear: z.number().min(0).max(MAX_CLEARANCE_CM),
  left: z.number().min(0).max(MAX_CLEARANCE_CM),
  right: z.number().min(0).max(MAX_CLEARANCE_CM),
})

const inputSchema = z.object({
  /** New project default, per side in cm. Omit to leave it as it is. */
  defaultCm: z.number().min(0).max(MAX_CLEARANCE_CM).optional(),
  /** Lines to change. `null` returns a line to inheriting the project default; 0 is an explicit "none". */
  lines: z
    .array(z.object({ cargoId: z.string().min(1), setting: z.union([z.null(), z.number().min(0).max(MAX_CLEARANCE_CM), sidesSchema]) }))
    .max(5000),
})

export type ClearanceInput = {
  defaultCm?: number
  lines: { cargoId: string; setting: ClearanceSetting }[]
}

/**
 * Saves the project's default handling clearance and any number of cargo lines' own settings in one
 * transaction, and returns the configuration as stored, so the caller can recalculate with exactly
 * what was saved rather than with what the screen held. It never touches a saved plan: the plan is
 * simply out of date until it is recalculated or its layout is re-checked.
 */
export async function saveClearanceConfig(projectId: string, input: ClearanceInput) {
  const access = await editorOrError()
  if (!access.ok) return { ok: false as const, error: access.error }
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: `Enter clearances from 0 to ${MAX_CLEARANCE_CM} cm.` }

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: access.user.orgId },
    include: { cargoItems: { select: { id: true, customFields: true } } },
  })
  if (!project) return { ok: false as const, error: "That project is not in this organization." }

  const byId = new Map(project.cargoItems.map((item) => [item.id, item]))
  const changes = new Map<string, ClearanceSetting>()
  for (const line of parsed.data.lines) {
    if (!byId.has(line.cargoId)) return { ok: false as const, error: "A clearance change refers to cargo that is no longer on this project." }
    changes.set(line.cargoId, cleanSetting(line.setting))
  }

  const rules = recordOf(project.rules)
  const defaultCm = parsed.data.defaultCm === undefined ? projectClearance(rules) : normaliseClearance(parsed.data.defaultCm)

  const writes: Prisma.PrismaPromise<unknown>[] = []
  if (parsed.data.defaultCm !== undefined && defaultCm !== projectClearance(rules)) {
    writes.push(prisma.project.update({ where: { id: project.id }, data: { rules: { ...rules, clearanceCm: defaultCm } as Prisma.InputJsonObject } }))
  }
  for (const [cargoId, setting] of changes) {
    const current = byId.get(cargoId)!
    const rest = { ...recordOf(current.customFields) }
    delete rest.clearanceCm
    delete rest.clearanceSides
    const next = { ...rest, ...settingToJson(setting) }
    writes.push(
      prisma.cargoItem.update({
        where: { id: cargoId },
        data: { customFields: Object.keys(next).length === 0 ? Prisma.DbNull : (next as Prisma.InputJsonObject) },
      }),
    )
  }
  if (writes.length > 0) await prisma.$transaction(writes)

  const config: ClearanceConfig = clearanceConfig(
    defaultCm,
    project.cargoItems.map((item) => ({ id: item.id, setting: changes.has(item.id) ? (changes.get(item.id) ?? null) : cargoSetting(item.customFields) })),
  )
  revalidatePath(`/projects/${project.id}`)
  return { ok: true as const, config }
}
