"use client"

import type { PlannerStep } from "@compass/domain"
import { cn } from "@/lib/utils"

const STEPS: { id: PlannerStep; label: string; number: string }[] = [
  { id: "data", label: "Data", number: "1" },
  { id: "setup", label: "Setup", number: "2" },
  { id: "workspace", label: "Workspace", number: "3" },
  { id: "plan", label: "Load plan", number: "4" },
]

export function PlannerSteps({
  step,
  onChange,
}: {
  step: PlannerStep
  onChange: (step: PlannerStep) => void
}) {
  return (
    <nav className="grid grid-cols-4 border-b" aria-label="Load plan steps">
      {STEPS.map((entry) => {
        const active = entry.id === step
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onChange(entry.id)}
            className={cn(
              "relative px-2 py-2 text-center text-sm",
              active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.number}. {entry.label}
            {active ? <span className="absolute inset-x-6 -bottom-px h-0.5 bg-primary" /> : null}
          </button>
        )
      })}
    </nav>
  )
}
