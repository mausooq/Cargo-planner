/**
 * The status of the project's load plan, from the facts that decide it. Everything that shows it
 * (the stepper, the Calculate page, the Load plan page, the project list) uses this one function, so
 * two parts of the screen can never say different things.
 *
 *  - not-calculated: there is no plan.
 *  - calculating:    a calculation is running (or a clearance change is being saved and applied).
 *  - failed:         the last calculation failed. A previous plan, if there is one, is still shown but is
 *                    out of date; it is never reported as ready.
 *  - out-of-date:    a plan exists but the project has changed since (cargo or clearance).
 *  - ready:          a plan exists and matches the project.
 */

export type PlanStatusKind = "not-calculated" | "calculating" | "ready" | "out-of-date" | "failed"

export type PlanStatus = {
  kind: PlanStatusKind
  /** Short label for the stepper. */
  label: string
  tone: "neutral" | "action" | "warning" | "success" | "danger"
}

export function derivePlanStatus(input: {
  hasPlan: boolean
  calculating: boolean
  /** The plan no longer matches the project's cargo or clearance settings. */
  stale: boolean
  /** The last calculation or recalculation failed and has not been retried successfully. */
  failed: boolean
}): PlanStatus {
  if (input.calculating) return { kind: "calculating", label: "Calculating…", tone: "action" }
  if (input.failed) return { kind: "failed", label: "Calculation failed", tone: "danger" }
  if (!input.hasPlan) return { kind: "not-calculated", label: "Not calculated", tone: "neutral" }
  if (input.stale) return { kind: "out-of-date", label: "Out of date", tone: "warning" }
  return { kind: "ready", label: "Plan ready", tone: "success" }
}
