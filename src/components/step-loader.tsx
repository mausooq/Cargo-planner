import type { PlannerStep } from "@compass/domain"

export const STEP_LOADING_LABEL: Record<PlannerStep, string> = {
  data: "Loading cargo data…",
  setup: "Loading equipment setup…",
  workspace: "Loading workspace…",
  plan: "Loading the load plan…",
}

export function StepLoader({ label }: { label: string }) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/75"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 rounded-md border bg-card px-6 py-5 shadow-sm">
        <span className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm font-medium">{label}</p>
      </div>
    </div>
  )
}
