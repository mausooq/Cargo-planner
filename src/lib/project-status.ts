import type { PlannerStep } from "@compass/domain"

export type ProjectStatusKind = "no-cargo" | "needs-equipment" | "not-calculated" | "stale" | "unloaded" | "planned"

export type ProjectStatus = {
  kind: ProjectStatusKind
  label: string
  /** The planner step that moves this project forward. */
  step: PlannerStep
  tone: "neutral" | "action" | "warning" | "success"
}

export function projectStatus(input: {
  cargoCount: number
  equipmentCount: number
  plan: { createdAt: Date; unloadedCount: number } | null
  lastCargoChange: Date | null
}): ProjectStatus {
  if (input.cargoCount === 0) return { kind: "no-cargo", label: "Add cargo", step: "data", tone: "neutral" }
  if (input.equipmentCount === 0) {
    return { kind: "needs-equipment", label: "Choose equipment", step: "setup", tone: "action" }
  }
  if (!input.plan) return { kind: "not-calculated", label: "Ready to calculate", step: "workspace", tone: "action" }
  if (input.lastCargoChange && input.lastCargoChange > input.plan.createdAt) {
    return { kind: "stale", label: "Cargo changed, recalculate", step: "workspace", tone: "warning" }
  }
  if (input.plan.unloadedCount > 0) {
    const count = input.plan.unloadedCount
    return { kind: "unloaded", label: `${count} piece${count === 1 ? "" : "s"} not loaded`, step: "plan", tone: "warning" }
  }
  return { kind: "planned", label: "Planned", step: "plan", tone: "success" }
}

/** Whole days from today to the date (negative when it has passed), or null for a bad date. */
export function daysUntil(iso: string, today = new Date()): number | null {
  const target = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((target.getTime() - start.getTime()) / 86_400_000)
}

/** How many of the four planner steps are finished, for a progress bar. */
export function stepsDone(kind: ProjectStatusKind): number {
  if (kind === "no-cargo") return 0
  if (kind === "needs-equipment") return 1
  if (kind === "not-calculated" || kind === "stale") return 2
  if (kind === "unloaded") return 3
  return 4
}

/** "in 3 days", "today", "2 days ago" for an ETD shown next to the date. */
export function relativeDays(iso: string, today = new Date()): string {
  const days = daysUntil(iso, today)
  if (days === null) return ""
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  if (days === -1) return "yesterday"
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}
