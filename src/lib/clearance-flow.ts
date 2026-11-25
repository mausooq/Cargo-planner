import type { ClearanceInput } from "@/app/actions/clearance"
import type { ClearanceConfig } from "@/lib/clearance"

/**
 * What happens when clearance settings are applied. Pure and injectable, so the rules can be tested
 * without a browser:
 *  - nothing runs per keystroke; the caller applies a whole set of changes once;
 *  - with a calculated plan, saving also recalculates, ONCE, using the configuration the server
 *    stored (never what the screen happened to hold);
 *  - without a plan the settings are only saved;
 *  - with a calculated plan the planner always chooses first: cancel, keep the current layout (re-check
 *    only, nothing moves) or recalculate (a hand-arranged layout is replaced only on that explicit choice);
 *  - "keep" leaves every piece where it is and only re-checks it against the new settings;
 *  - a failed recalculation leaves the previous plan in place, and can be retried;
 *  - a second request while one is running is refused.
 */

export type SaveResult = { ok: true; config: ClearanceConfig } | { ok: false; error: string }
export type RecalcResult = { ok: true } | { ok: false; message: string }
/** A piece that breaks the proposed clearances, and where it is. */
export type FlowViolation = { unitIndex: number; id: string; message: string }
export type KeepResult = { ok: true } | { ok: false; problems: string[]; violations: FlowViolation[] }

export type FlowDeps = {
  /** A load plan has been calculated. */
  hasPlan: boolean
  /** The saved layout contains cargo the planner moved by hand. */
  manualLayout: boolean
  save: (change: ClearanceInput) => Promise<SaveResult>
  /** Packs the cargo with this configuration and saves the plan. Must leave the old plan alone when it fails. */
  recalculate: (config: ClearanceConfig) => Promise<RecalcResult>
  /** Saves the change and re-checks the existing layout without moving anything. Nothing is saved when it fails. */
  keep: (change: ClearanceInput) => Promise<KeepResult>
  /** What is happening now, for display; null when idle. */
  setStatus: (text: string | null) => void
}

export type FlowOutcome =
  | { kind: "busy" }
  /** A plan exists: ask whether to keep its layout or recalculate. Nothing has been saved. */
  | { kind: "needs-confirmation"; manual: boolean }
  | { kind: "save-failed"; error: string }
  | { kind: "saved" }
  | { kind: "recalculated" }
  | { kind: "kept" }
  /** The current layout cannot keep the proposed settings. Nothing was saved and nothing moved. */
  | { kind: "rejected"; problems: string[]; violations: FlowViolation[]; change: ClearanceInput }
  | { kind: "recalc-failed"; message: string; config: ClearanceConfig }

/** One lock per screen: a second apply or retry while one is running is refused. */
export type FlowLock = { running: boolean }

export function createFlowLock(): FlowLock {
  return { running: false }
}

export async function runClearanceFlow(
  deps: FlowDeps,
  change: ClearanceInput,
  how: "recalculate" | "keep",
  lock: FlowLock,
  options: { confirmed?: boolean } = {},
): Promise<FlowOutcome> {
  if (lock.running) return { kind: "busy" }
  if (deps.hasPlan && how === "recalculate" && !options.confirmed) {
    return { kind: "needs-confirmation", manual: deps.manualLayout }
  }
  lock.running = true
  try {
    if (deps.hasPlan && how === "keep") {
      deps.setStatus("Checking your layout against the new clearances…")
      const kept = await deps.keep(change)
      return kept.ok ? { kind: "kept" } : { kind: "rejected", problems: kept.problems, violations: kept.violations, change }
    }

    deps.setStatus("Saving clearance settings…")
    const saved = await deps.save(change)
    if (!saved.ok) return { kind: "save-failed", error: saved.error }
    if (!deps.hasPlan) return { kind: "saved" }

    deps.setStatus("Recalculating the load plan…")
    const result = await deps.recalculate(saved.config)
    return result.ok ? { kind: "recalculated" } : { kind: "recalc-failed", message: result.message, config: saved.config }
  } finally {
    lock.running = false
    deps.setStatus(null)
  }
}

/** Tries the recalculation again with the configuration that was already saved. */
export async function retryRecalculation(
  deps: Pick<FlowDeps, "recalculate" | "setStatus">,
  config: ClearanceConfig,
  lock: FlowLock,
): Promise<FlowOutcome> {
  if (lock.running) return { kind: "busy" }
  lock.running = true
  try {
    deps.setStatus("Recalculating the load plan…")
    const result = await deps.recalculate(config)
    return result.ok ? { kind: "recalculated" } : { kind: "recalc-failed", message: result.message, config }
  } finally {
    lock.running = false
    deps.setStatus(null)
  }
}

/** The proposed change in words, for the confirmation dialog and the "not saved" message. */
export function describeProposedChange(
  change: ClearanceInput,
  lines: { id: string; name: string }[],
  currentDefaultCm: number,
): string[] {
  const out: string[] = []
  if (change.defaultCm !== undefined && change.defaultCm !== currentDefaultCm) {
    out.push(`Project default: ${currentDefaultCm} cm → ${change.defaultCm} cm`)
  }
  const names = new Map(lines.map((line) => [line.id, line.name || "Unnamed line"]))
  for (const entry of change.lines) {
    const name = names.get(entry.cargoId) ?? "A cargo line"
    const setting = entry.setting
    const text =
      setting === null
        ? "project default"
        : typeof setting === "number"
          ? `${setting} cm on every side`
          : `front ${setting.front}, rear ${setting.rear}, left ${setting.left}, right ${setting.right} cm`
    out.push(`${name}: ${text}`)
  }
  return out
}
