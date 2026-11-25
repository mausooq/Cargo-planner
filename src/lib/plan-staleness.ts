import { createHash } from "node:crypto"
import { recordOf } from "@/lib/json"
import {
  cargoSetting,
  clearanceConfig,
  parseClearanceConfig,
  projectClearance,
  sameClearanceConfig,
} from "@/lib/clearance"

/**
 * Whether a saved plan still matches the project. Server-side only (it hashes with node:crypto).
 * The page, the dashboard and the server actions all ask this one function, so the stepper, the
 * Calculate page, the Load plan page and the project list cannot disagree.
 *
 * A plan is out of date when EITHER
 *  - the cargo that decides how it is packed changed since it was calculated, or
 *  - the clearance configuration (project default and every line's own setting) differs from the one
 *    the plan was calculated or last checked under.
 * The two are tracked separately on purpose. Clearance is left out of the cargo signature, so
 * "keep my current layout" under new clearances can bring the plan up to date for clearance
 * without ever hiding an unrelated cargo edit.
 */

export type StalenessCargo = {
  id: string
  updatedAt?: Date
  customFields?: unknown
  lengthCm?: number
  widthCm?: number
  heightCm?: number
  weightKg?: number
  quantity?: number
  shape?: string
  orientation?: string
  stackable?: boolean
  bottomOnly?: boolean
  maxStackLoadKg?: number | null
  maxStackLayers?: number | null
  priority?: number
  destinationStop?: number
  consignmentId?: string | null
  segregationClass?: string | null
}

function allowedRotations(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) return null
  const raw = (customFields as { allowedRotations?: unknown }).allowedRotations
  return typeof raw === "string" ? raw : null
}

/**
 * A fingerprint of the cargo facts that change a packing result: which lines exist, their sizes,
 * weights, quantities and packing rules. Names, SKUs, colours and clearance are not part of it.
 */
export function cargoSignature(cargo: StalenessCargo[]): string {
  const rows = cargo
    .map((line) => [
      line.id,
      line.lengthCm ?? null,
      line.widthCm ?? null,
      line.heightCm ?? null,
      line.weightKg ?? null,
      line.quantity ?? null,
      line.shape ?? null,
      line.orientation ?? null,
      allowedRotations(line.customFields),
      line.stackable ?? null,
      line.bottomOnly ?? null,
      line.maxStackLoadKg ?? null,
      line.maxStackLayers ?? null,
      line.priority ?? null,
      line.destinationStop ?? null,
      line.consignmentId ?? null,
      line.segregationClass ?? null,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return createHash("sha1").update(JSON.stringify(rows)).digest("hex")
}

export type PlanStalenessReason = "cargo" | "clearance"

/** Why the plan is out of date, or null when it is not. */
export function planStaleness(
  plan: { createdAt: Date; settings: unknown },
  cargo: StalenessCargo[],
  projectDefaultCm: number,
): PlanStalenessReason | null {
  const settings = recordOf(plan.settings)

  if (typeof settings.cargoSignature === "string") {
    if (settings.cargoSignature !== cargoSignature(cargo)) return "cargo"
  } else {
    // A plan saved before signatures: fall back to edit times, counting a layout re-check as a sync point.
    const syncedAt = typeof settings.syncedAt === "string" ? new Date(settings.syncedAt) : null
    const since = syncedAt && syncedAt > plan.createdAt ? syncedAt : plan.createdAt
    if (cargo.some((line) => line.updatedAt && line.updatedAt > since)) return "cargo"
  }

  const recorded = parseClearanceConfig(settings.clearanceConfig)
  if (!recorded) {
    // Older plans only knew the project default.
    return projectClearance({ clearanceCm: settings.clearanceCm }) !== projectDefaultCm ? "clearance" : null
  }
  const now = clearanceConfig(
    projectDefaultCm,
    cargo.map((line) => ({ id: line.id, setting: cargoSetting(line.customFields) })),
  )
  return sameClearanceConfig(recorded, now) ? null : "clearance"
}

export function isPlanStale(
  plan: { createdAt: Date; settings: unknown },
  cargo: StalenessCargo[],
  projectDefaultCm: number,
): boolean {
  return planStaleness(plan, cargo, projectDefaultCm) !== null
}
