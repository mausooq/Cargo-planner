import { createHash } from "node:crypto"
import { recordOf } from "@/lib/json"

/**
 * Whether a saved plan still matches the project. Server-side only (it hashes with node:crypto).
 * The page, the dashboard and the server actions all ask this one function, so the stepper, the
 * Calculate page, the Load plan page and the project list cannot disagree.
 *
 * A plan is out of date when the cargo that decides how it is packed changed since it was
 * calculated: a line added, removed or resized, a weight, quantity or packing rule changed.
 *
 * Plans saved by earlier versions also recorded a handling-clearance setting in their JSON. That
 * setting no longer exists and is never read here, so such a plan is not out of date merely because
 * of it. The cargo signature never contained clearance, so every saved signature still matches.
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
 * weights, quantities and packing rules. Names, SKUs and colours are not part of it, and neither is
 * anything a cargo line carries that the planner no longer uses (such as an old clearance setting).
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

export type PlanStalenessReason = "cargo"

/** Why the plan is out of date, or null when it is not. */
export function planStaleness(plan: { createdAt: Date; settings: unknown }, cargo: StalenessCargo[]): PlanStalenessReason | null {
  const settings = recordOf(plan.settings)

  if (typeof settings.cargoSignature === "string") {
    return settings.cargoSignature !== cargoSignature(cargo) ? "cargo" : null
  }
  // A plan saved before signatures: fall back to edit times, counting a layout re-check as a sync point.
  const syncedAt = typeof settings.syncedAt === "string" ? new Date(settings.syncedAt) : null
  const since = syncedAt && syncedAt > plan.createdAt ? syncedAt : plan.createdAt
  return cargo.some((line) => line.updatedAt && line.updatedAt > since) ? "cargo" : null
}

export function isPlanStale(plan: { createdAt: Date; settings: unknown }, cargo: StalenessCargo[]): boolean {
  return planStaleness(plan, cargo) !== null
}
