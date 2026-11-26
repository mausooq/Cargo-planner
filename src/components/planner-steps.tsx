"use client"

import type { PlannerStep } from "@compass/domain"
import { AlertTriangle, Box, Calculator, Check, Container, Lock, Package } from "lucide-react"
import type { ComponentType } from "react"
import { cn } from "@/lib/utils"

export const STEP_LABELS: Record<PlannerStep, string> = {
  data: "Cargo",
  setup: "Equipment",
  workspace: "Calculate",
  plan: "Load plan",
}

const STEPS: PlannerStep[] = ["data", "setup", "workspace", "plan"]

const STEP_ICON: Record<PlannerStep, ComponentType<{ className?: string }>> = {
  data: Package,
  setup: Container,
  workspace: Calculator,
  plan: Box,
}

export type StepState = {
  /** The step has everything it needs (cargo entered, equipment saved, plan calculated). */
  done: boolean
  /** Why the step cannot be opened yet, or null when it can. */
  blocked: string | null
  /** Short status under the label, e.g. "4 lines". */
  summary?: string
  /** Something about the step needs attention, for example a plan that is out of date. */
  attention?: boolean
}

/**
 * The four planner steps as a minimal connected stepper: a circle per step joined by thin lines, the name and
 * status centred below. Every state comes from `states` (what the project really has), never from which step is
 * open: the open step is green, a finished step sage with a check, a step that needs attention amber, a step
 * still to do grey, and a locked one dimmed with a lock. Clicking a step calls `onChange`, as before.
 */
export function PlannerSteps({ step, states, onChange }: { step: PlannerStep; states: Record<PlannerStep, StepState>; onChange: (step: PlannerStep) => void }) {
  return (
    <nav aria-label="Load plan steps">
      <ol className="grid grid-cols-4">
        {STEPS.map((id, index) => {
          const active = id === step
          const state = states[id]
          const locked = Boolean(state.blocked) && !active
          const attention = Boolean(state.attention)
          const done = state.done && !attention
          // A line is finished when the step before it is.
          const previous = index > 0 ? states[STEPS[index - 1]!] : null
          const lineDone = Boolean(previous?.done && !previous.attention)
          const Icon = STEP_ICON[id]
          return (
            <li key={id} className="relative flex min-w-0 flex-col items-center">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-[23px] right-[calc(50%+23px)] left-[calc(-50%+23px)] h-0.5 rounded-full transition-colors duration-200"
                  style={{ backgroundColor: lineDone ? "var(--step-line-done)" : "var(--step-line)" }}
                />
              ) : null}
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={active ? "step" : undefined}
                aria-disabled={locked || undefined}
                title={locked ? (state.blocked ?? undefined) : undefined}
                className={cn(
                  "group flex max-w-full flex-col items-center gap-1.5 rounded-xl px-2 pt-0 pb-1 text-center outline-none",
                  "transition-colors duration-200 ease-out focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  locked ? "cursor-not-allowed" : "hover:bg-white/35 dark:hover:bg-white/5",
                )}
              >
                <span
                  className={cn(
                    "relative flex size-[46px] shrink-0 items-center justify-center rounded-full border-2 transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out",
                    !locked && "motion-safe:group-hover:scale-105",
                    active && "border-[var(--step-active)] bg-[var(--step-active)] text-white shadow-soft",
                    !active && attention && "pastel-amber border-[var(--pc-border)] bg-[var(--pc-bg)] text-[var(--pc-accent)] group-hover:border-[var(--pc-accent)]",
                    !active && done && "border-[var(--step-done-bg)] bg-[var(--step-done-bg)] text-[var(--step-done-fg)] group-hover:border-[var(--step-line-done)]",
                    !active && !attention && !done && "border-[var(--step-line)] bg-card text-muted-foreground",
                    !active && !attention && !done && !locked && "group-hover:border-primary/40",
                    locked && "opacity-60",
                  )}
                  aria-hidden="true"
                >
                  <Icon className="size-5" />
                  {!active && (done || attention || locked) ? (
                    <span
                      className={cn(
                        "absolute -right-0.5 -bottom-0.5 flex size-[17px] items-center justify-center rounded-full ring-2 ring-[var(--card)]",
                        done && "bg-[var(--step-active)] text-white",
                        attention && "bg-amber-500 text-white",
                        locked && !done && !attention && "bg-muted-foreground text-card",
                      )}
                    >
                      {done ? <Check className="size-2.5" strokeWidth={3.5} /> : attention ? <AlertTriangle className="size-2.5" strokeWidth={3} /> : <Lock className="size-2.5" />}
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 max-w-full">
                  <span
                    className={cn(
                      "block truncate text-[15px] leading-5 font-semibold",
                      active ? "text-[var(--step-active)] dark:text-[var(--step-done-fg)]" : locked ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {STEP_LABELS[id]}
                  </span>
                  {state.summary ? (
                    <span
                      className={cn(
                        "hidden truncate text-[13px] leading-[18px] font-medium sm:block",
                        attention ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                      )}
                    >
                      {state.summary}
                    </span>
                  ) : null}
                </span>
                <span className="sr-only">
                  {active ? " (current step)" : ""}
                  {done ? " (complete)" : ""}
                  {attention ? " (needs attention)" : ""}
                  {locked ? ` (locked: ${state.blocked})` : ""}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
