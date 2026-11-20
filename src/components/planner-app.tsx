"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react"
import { modeLabel, PLANNER_STEPS, plannerStepSchema, type EquipmentMode, type PlannerStep } from "@compass/domain"
import { toast } from "sonner"
import { CargoGrid, type CargoLine } from "@/components/cargo-grid"
import { CargoImportWizard, type SavedMapping } from "@/components/cargo-import-wizard"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { DeleteProjectButton } from "@/components/delete-project-button"
import { ProjectEditDialog } from "@/components/project-edit-form"
import { EquipmentSetup, type EquipmentChoice, type EquipmentSetupHandle } from "@/components/equipment-setup"
import { PlanWorkspace, type PlanWorkspaceHandle } from "@/components/plan-workspace"
import { PlannerSteps, STEP_LABELS, type StepState } from "@/components/planner-steps"
import { StepLoader } from "@/components/step-loader"
import { Button } from "@/components/ui/button"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { formatDate } from "@/lib/format"
import type { PlanView } from "@/lib/plan-view"

const NEED_CARGO = "Add at least one cargo line with a name, sizes, weight, and quantity."
const NEED_EQUIPMENT = "Pick at least one container, ULD, or truck."
const NEED_PLAN = "Calculate the load plan first."

export function PlannerApp({
  project,
  cargo,
  library,
  choices,
  plan,
  planStale = false,
  templates,
  canEdit,
  canDelete,
}: {
  project: {
    id: string
    name: string
    mode: EquipmentMode
    objective: "FEWEST_UNITS" | "LOWEST_COST"
    etd: string | null
    notes: string | null
  }
  cargo: CargoLine[]
  library: EquipmentListItem[]
  choices: EquipmentChoice[]
  plan: PlanView | null
  planStale?: boolean
  templates: SavedMapping[]
  canEdit: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const parsed = plannerStepSchema.safeParse(searchParams.get("step"))
  const [step, setStep] = useState<PlannerStep>(parsed.success ? parsed.data : "data")
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [pendingStep, setPendingStep] = useState<PlannerStep | "dashboard" | null>(null)
  // Local mirrors so step badges update the moment the user acts, before the server refresh lands.
  const [equipmentPicked, setEquipmentPicked] = useState(choices.length > 0)
  const [planReady, setPlanReady] = useState(Boolean(plan && plan.units.length > 0))
  const [syncedChoices, setSyncedChoices] = useState(choices)
  const [syncedPlan, setSyncedPlan] = useState(plan)
  if (syncedChoices !== choices) {
    setSyncedChoices(choices)
    setEquipmentPicked(choices.length > 0)
  }
  if (syncedPlan !== plan) {
    setSyncedPlan(plan)
    setPlanReady(Boolean(plan && plan.units.length > 0))
  }
  const setupRef = useRef<EquipmentSetupHandle>(null)
  const workspaceRef = useRef<PlanWorkspaceHandle>(null)

  const selectedIds = choices.map((choice) => choice.equipmentTypeId)
  const equipment = library
    .filter((item) => selectedIds.includes(item.id))
    .map((item) => ({
      ...item,
      maxCount: choices.find((choice) => choice.equipmentTypeId === item.id)?.maxCount ?? 1,
    }))
  const readyLines = cargo.filter(isReadyCargo)
  const hasCargo = readyLines.length > 0
  const pieces = readyLines.reduce((sum, line) => sum + line.quantity, 0)
  const unitCount = choices.reduce((sum, choice) => sum + (choice.maxCount ?? 1), 0)

  // Warn before closing the tab with unsaved equipment picks or layout edits.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (setupRef.current?.isDirty() || workspaceRef.current?.isDirty()) event.preventDefault()
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [])

  /** Render-safe check that uses state only (used for the step badges). */
  function lockedReason(target: PlannerStep): string | null {
    if (target === "data") return null
    if (!hasCargo) return NEED_CARGO
    if (target === "setup") return null
    if (!equipmentPicked) return NEED_EQUIPMENT
    if (target === "workspace") return null
    if (!planReady) return NEED_PLAN
    return null
  }

  /** Event-time check that also counts unsaved picks and a fresh, not yet refreshed plan. */
  function blockedReason(target: PlannerStep): string | null {
    if (target === "data") return null
    if (!hasCargo) return NEED_CARGO
    if (target === "setup") return null
    if (!equipmentPicked && !setupRef.current?.hasSelection()) return NEED_EQUIPMENT
    if (target === "workspace") return null
    if (!planReady && !workspaceRef.current?.hasPlan()) return NEED_PLAN
    return null
  }

  const states: Record<PlannerStep, StepState> = {
    data: {
      done: hasCargo,
      blocked: null,
      summary: cargo.length === 0 ? "No cargo yet" : `${pieces} piece${pieces === 1 ? "" : "s"}`,
    },
    setup: {
      done: equipmentPicked,
      blocked: lockedReason("setup"),
      summary: equipmentPicked ? `${unitCount} unit${unitCount === 1 ? "" : "s"}` : "Not chosen",
    },
    workspace: {
      done: planReady,
      blocked: lockedReason("workspace"),
      summary: planReady ? (planStale ? "Out of date" : "Plan ready") : "Not calculated",
    },
    plan: { done: false, blocked: lockedReason("plan"), summary: planReady ? "3D, sequence, export" : undefined },
  }

  function go(next: PlannerStep) {
    setStep(next)
    // Native history update: keeps ?step= in the URL (for reload and sharing) without refetching the page from the server.
    window.history.replaceState(null, "", `/projects/${project.id}?step=${next}`)
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "smooth" })
  }

  /** Saves pending equipment picks when leaving Setup. Returns false if the user must stay. */
  async function leaveCurrentStep(): Promise<boolean> {
    if (step === "setup" && canEdit && setupRef.current?.isDirty()) {
      setBusy("Saving equipment…")
      try {
        const saved = await setupRef.current.save()
        if (saved) setEquipmentPicked(true)
        return Boolean(saved)
      } finally {
        setBusy(null)
      }
    }
    return true
  }

  async function navigate(target: PlannerStep | "dashboard", { force = false } = {}) {
    if (busy) return
    if (!force && workspaceRef.current?.isDirty()) {
      setPendingStep(target)
      return
    }
    if (!(await leaveCurrentStep())) return
    if (target === "dashboard") {
      router.push("/dashboard")
      return
    }
    const reason = blockedReason(target)
    if (reason) {
      toast.error(reason)
      return
    }
    go(target)
  }

  async function next() {
    if (busy) return
    if (step === "data") return navigate("setup")
    if (step === "setup") {
      if (!canEdit && !equipmentPicked) {
        toast.error(NEED_EQUIPMENT)
        return
      }
      if (canEdit && !setupRef.current?.hasSelection()) {
        toast.error(NEED_EQUIPMENT)
        return
      }
      return navigate("workspace")
    }
    if (step === "workspace") {
      const ready = workspaceRef.current?.hasPlan() ?? planReady
      if (!ready) {
        if (!canEdit) {
          toast.error(NEED_PLAN)
          return
        }
        setBusy("Calculating the load plan…")
        try {
          const packed = await workspaceRef.current?.calculate()
          if (!packed) return
          setPlanReady(true)
        } finally {
          setBusy(null)
        }
      }
      go("plan")
      return
    }
    return navigate("dashboard")
  }

  function back() {
    const index = PLANNER_STEPS.indexOf(step)
    if (index <= 0) return navigate("dashboard")
    return navigate(PLANNER_STEPS[index - 1] ?? "data")
  }

  const nextLabel =
    step === "data"
      ? `Next: ${STEP_LABELS.setup}`
      : step === "setup"
        ? canEdit
          ? "Save and continue"
          : `Next: ${STEP_LABELS.workspace}`
        : step === "workspace"
          ? planReady
            ? `Next: ${STEP_LABELS.plan}`
            : canEdit
              ? "Calculate and continue"
              : `Next: ${STEP_LABELS.plan}`
          : "Done, back to projects"

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <div className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center gap-3 px-4 pt-3 pb-2.5">
          <button
            type="button"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground hover:text-foreground"
            aria-label="Back to all projects"
            title="All projects"
            onClick={() => void navigate("dashboard")}
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-semibold">{project.name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">{modeLabel(project.mode)}</span>
              <span>{project.etd ? `ETD ${formatDate(project.etd)}` : "ETD missing"}</span>
              {project.notes ? <span className="truncate">· {project.notes}</span> : null}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {canEdit ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
                Edit details
              </Button>
            ) : null}
            {canDelete ? <DeleteProjectButton projectId={project.id} name={project.name} redirectTo="/dashboard" /> : null}
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1800px] px-4 pb-3">
          <PlannerSteps step={step} states={states} onChange={(target) => void navigate(target)} />
        </div>
      </div>

      {canEdit ? (
        <ProjectEditDialog
          project={{ id: project.id, name: project.name, etd: project.etd, notes: project.notes }}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}

      <ConfirmDialog
        open={pendingStep !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStep(null)
        }}
        destructive
        title="Leave without saving the layout?"
        description="You moved cargo in the 3D view but did not save. Leaving now discards those changes."
        confirmLabel="Discard changes"
        onConfirm={() => {
          const target = pendingStep
          setPendingStep(null)
          workspaceRef.current?.discardChanges()
          if (target) void navigate(target, { force: true })
        }}
      />

      <div className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col px-4 py-4">
        <div className="relative min-h-48 flex-1">
          {/* The workspace shows its own progress panel while calculating. */}
          {busy && step !== "workspace" ? <StepLoader label={busy} /> : null}
          {/* Keyed by step so each step fades in instead of snapping. Calculate and Load plan share one
              key so the workspace (and a freshly calculated plan) stays mounted between them. */}
          <div key={step === "plan" ? "workspace" : step} className="motion-enter">
          {step === "data" ? (
            <div className="space-y-6">
              <CargoGrid projectId={project.id} lines={cargo} canEdit={canEdit} />
              {canEdit ? <CargoImportWizard projectId={project.id} templates={templates} /> : null}
            </div>
          ) : null}

          {step === "setup" ? (
            <EquipmentSetup
              ref={setupRef}
              projectId={project.id}
              items={library}
              initial={choices}
              canEdit={canEdit}
              projectMode={project.mode}
              cargo={readyLines}
              objective={project.objective}
            />
          ) : null}

          {step === "workspace" || step === "plan" ? (
            <PlanWorkspace
              ref={workspaceRef}
              projectId={project.id}
              projectName={project.name}
              cargo={cargo}
              equipment={equipment}
              objective={project.objective}
              initialPlan={plan}
              initialStale={planStale}
              canEdit={canEdit}
              variant={step}
              onPlanChange={(ready) => setPlanReady(ready)}
              onEditStep={(target) => void navigate(target)}
            />
          ) : null}
          </div>
        </div>

        <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <Button type="button" variant="outline" onClick={() => void back()} disabled={busy !== null}>
            <ArrowLeft className="size-4" />
            {step === "data" ? "All projects" : `Back: ${STEP_LABELS[PLANNER_STEPS[PLANNER_STEPS.indexOf(step) - 1] ?? "data"]}`}
          </Button>
          <Button type="button" onClick={() => void next()} disabled={busy !== null}>
            {busy ?? nextLabel}
            {busy ? null : <ArrowRight className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

function isReadyCargo(line: CargoLine): boolean {
  return (
    line.name.trim().length > 0 &&
    line.lengthCm > 0 &&
    line.widthCm > 0 &&
    line.heightCm > 0 &&
    line.weightKg > 0 &&
    line.quantity > 0
  )
}
