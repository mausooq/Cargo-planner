"use client"

import type { PlannerStep } from "@compass/domain"
import { Check, Lock } from "lucide-react"
import { cn } from "@/lib/utils"

export const STEP_LABELS: Record<PlannerStep, string> = {
  data: "Cargo",
  setup: "Equipment",
  workspace: "Calculate",
  plan: "Load plan",
}

const STEPS: PlannerStep[] = ["data", "setup", "workspace", "plan"]

export type StepState = {
  /** The step has everything it needs (cargo entered, equipment saved, plan calculated). */
  done: boolean
  /** Why the step cannot be opened yet, or null when it can. */
  blocked: string | null
  /** Short status under the label, e.g. "4 lines". */
  summary?: string
}

export function PlannerSteps({
  step,
  states,
  onChange,
}: {
  step: PlannerStep
  states: Record<PlannerStep, StepState>
  onChange: (step: PlannerStep) => void
}) {
  return (
    <nav aria-label="Load plan steps">
      <ol className="grid grid-cols-4">
        {STEPS.map((id, index) => {
          const active = id === step
          const state = states[id]
          const locked = Boolean(state.blocked) && !active
          return (
            <li key={id} className="min-w-0">
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={active ? "step" : undefined}
                aria-disabled={locked || undefined}
                title={locked ? (state.blocked ?? undefined) : undefined}
                className={cn(
                  "group relative flex w-full min-w-0 items-center justify-center gap-2 px-2 py-2.5 text-sm outline-none focus-visible:bg-muted",
                  active ? "text-foreground" : locked ? "text-muted-foreground/60" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    active && "border-primary bg-primary text-primary-foreground",
                    !active && state.done && "border-primary/40 bg-primary/10 text-primary",
                    !active && !state.done && "bg-background",
                  )}
                  aria-hidden="true"
                >
                  {state.done && !active ? (
                    <Check className="size-3.5" />
                  ) : locked ? (
                    <Lock className="size-3" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="min-w-0 text-left">
                  <span className={cn("block truncate", active && "font-medium")}>{STEP_LABELS[id]}</span>
                  {state.summary ? (
                    <span className="hidden truncate text-xs text-muted-foreground sm:block">{state.summary}</span>
                  ) : null}
                </span>
                <span className="sr-only">
                  {state.done ? " (complete)" : ""}
                  {locked ? ` (locked: ${state.blocked})` : ""}
                </span>
                {active ? <span className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
