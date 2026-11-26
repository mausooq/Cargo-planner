"use client"

import { useEffect, useState } from "react"
import type { CargoLine } from "@/components/cargo-grid"
import type { PlanView } from "@/lib/plan-view"
import { remainingCapacity, type RemainingCapacityReport } from "@/lib/remaining-capacity"

/** Time the analysis may take in the browser, shared by all units. Kept short so the page stays responsive. */
export const CAPACITY_TIME_BUDGET_MS = 1500

type State = { plan: PlanView; cargo: CargoLine[]; minSupportPct: number | null; report: RemainingCapacityReport | null; error: string | null }

/**
 * Runs the remaining-capacity analysis for a plan once it is shown, after the page has painted, and again
 * whenever the plan or the cargo changes. `enabled` false (a plan that is out of date) runs nothing.
 */
export function useRemainingCapacity(plan: PlanView | null, cargo: CargoLine[], minSupportPct: number | null, enabled: boolean) {
  const [state, setState] = useState<State | null>(null)

  useEffect(() => {
    if (!enabled || !plan || plan.units.length === 0) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      let report: RemainingCapacityReport | null = null
      let error: string | null = null
      try {
        report = remainingCapacity(plan, cargo, { minSupportPct, limits: { timeBudgetMs: CAPACITY_TIME_BUDGET_MS } })
      } catch {
        error = "The remaining capacity could not be analysed."
      }
      if (!cancelled) setState({ plan, cargo, minSupportPct, report, error })
    }, 30)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [plan, cargo, minSupportPct, enabled])

  const current = state && state.plan === plan && state.cargo === cargo && state.minSupportPct === minSupportPct ? state : null
  return {
    report: enabled ? (current?.report ?? null) : null,
    error: enabled ? (current?.error ?? null) : null,
    running: enabled && Boolean(plan && plan.units.length > 0) && !current,
  }
}
