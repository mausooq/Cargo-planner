"use client"

import { useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PLANNER_STEPS, plannerStepSchema, type EquipmentMode, type PlannerStep } from "@compass/domain"
import { toast } from "sonner"
import { CargoGrid, type CargoLine } from "@/components/cargo-grid"
import { CargoImportWizard, type SavedMapping } from "@/components/cargo-import-wizard"
import { DeleteProjectButton } from "@/components/delete-project-button"
import { ProjectEditForm } from "@/components/project-edit-form"
import { EquipmentSetup, type EquipmentChoice, type EquipmentSetupHandle } from "@/components/equipment-setup"
import { PlanWorkspace, type PlanWorkspaceHandle } from "@/components/plan-workspace"
import { PlannerSteps } from "@/components/planner-steps"
import { STEP_LOADING_LABEL, StepLoader } from "@/components/step-loader"
import { Button } from "@/components/ui/button"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import type { PlanView } from "@/lib/plan-view"

export function PlannerApp({
  project,
  cargo,
  library,
  choices,
  plan,
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
  templates: SavedMapping[]
  canEdit: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const parsed = plannerStepSchema.safeParse(searchParams.get("step"))
  const [step, setStep] = useState<PlannerStep>(parsed.success ? parsed.data : "data")
  const [busy, setBusy] = useState(false)
  const [overlay, setOverlay] = useState<string | null>(null)
  const loaderTimer = useRef<number | null>(null)
  const [editing, setEditing] = useState(false)
  const setupRef = useRef<EquipmentSetupHandle>(null)
  const workspaceRef = useRef<PlanWorkspaceHandle>(null)

  const selectedIds = choices.map((choice) => choice.equipmentTypeId)
  const equipment = library
    .filter((item) => selectedIds.includes(item.id))
    .map((item) => ({
      ...item,
      maxCount: choices.find((choice) => choice.equipmentTypeId === item.id)?.maxCount ?? 1,
    }))
  const hasCargo = cargo.some(isReadyCargo)
  const hasEquipment = choices.length > 0
  const hasPlan = Boolean(plan && plan.units.length > 0)

  function go(next: PlannerStep) {
    if (loaderTimer.current) window.clearTimeout(loaderTimer.current)
    setOverlay(STEP_LOADING_LABEL[next])
    setStep(next)
    router.replace(`/projects/${project.id}?step=${next}`, { scroll: false })
    loaderTimer.current = window.setTimeout(() => setOverlay(null), 700)
  }

  function holdLoader(message: string) {
    if (loaderTimer.current) window.clearTimeout(loaderTimer.current)
    loaderTimer.current = null
    setOverlay(message)
  }

  function blockedReason(target: PlannerStep): string | null {
    if (target === "data") return null
    if (!hasCargo) return "Add at least one cargo line with a name, sizes, weight, and quantity."
    if (target === "setup") return null
    if (!hasEquipment && !setupRef.current?.hasSelection()) return "Pick at least one container, ULD, or truck."
    if (target === "workspace") return null
    if (!hasPlan && !workspaceRef.current?.hasPlan()) return "Calculate the load plan first."
    return null
  }

  function requestStep(target: PlannerStep) {
    const reason = blockedReason(target)
    if (reason) {
      toast.error(reason)
      return
    }
    go(target)
  }

  async function next() {
    if (busy) return
    setBusy(true)
    let advanced = false
    try {
      if (step === "data") {
        if (!hasCargo) {
          toast.error("Add at least one cargo line with a name, sizes, weight, and quantity.")
          return
        }
        go("setup")
        advanced = true
        return
      }
      if (step === "setup") {
        if (canEdit) {
          holdLoader("Saving equipment…")
          const saved = await setupRef.current?.save()
          if (!saved) return
        } else if (!hasEquipment) {
          toast.error("Pick at least one container, ULD, or truck.")
          return
        }
        go("workspace")
        advanced = true
        return
      }
      if (step === "workspace") {
        const ready = workspaceRef.current?.hasPlan() ?? hasPlan
        if (!ready) {
          if (!canEdit) {
            toast.error("Calculate the load plan first.")
            return
          }
          holdLoader("Calculating the load plan…")
          const packed = await workspaceRef.current?.calculate()
          if (!packed) {
            toast.error("Calculate the load plan first.")
            return
          }
        }
        go("plan")
        advanced = true
        return
      }
      holdLoader("Opening projects…")
      advanced = true
      router.push("/dashboard")
    } finally {
      setBusy(false)
      if (!advanced) setOverlay(null)
    }
  }

  function back() {
    const index = PLANNER_STEPS.indexOf(step)
    if (index <= 0) {
      router.push("/dashboard")
      return
    }
    go(PLANNER_STEPS[index - 1] ?? "data")
  }

  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col">
      <div className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-[1800px] flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <h1 className="cursor-default truncate text-base font-semibold">{project.name}</h1>
            <p className="text-xs text-muted-foreground">
              {project.mode} · {project.etd ? `ETD ${project.etd}` : "ETD required"} · {equipment.length} unit types ·{" "}
              {cargo.length} cargo lines
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href="/api/cargo-template">Excel template</a>
            </Button>
            {canEdit ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit project
              </Button>
            ) : null}
            {canDelete ? <DeleteProjectButton projectId={project.id} /> : null}
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1800px] px-4">
          <PlannerSteps step={step} onChange={requestStep} />
        </div>
      </div>
      {editing ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-4">
          <div className="w-full max-w-lg rounded-md border bg-card p-4" role="dialog" aria-label="Edit project">
            <h2 className="text-base font-semibold">Edit project</h2>
            <div className="mt-3">
              <ProjectEditForm
                project={{ id: project.id, name: project.name, etd: project.etd, notes: project.notes }}
                onClose={() => setEditing(false)}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col px-4 py-4">
        <div className="relative min-h-48 flex-1">
          {overlay ? <StepLoader label={overlay} /> : null}
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
            />
          ) : null}

          {step === "workspace" || step === "plan" ? (
            <PlanWorkspace
              ref={workspaceRef}
              projectId={project.id}
              cargo={cargo}
              equipment={equipment}
              objective={project.objective}
              initialPlan={plan}
              canEdit={canEdit}
              variant={step}
            />
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-between border-t pt-4">
          <Button type="button" size="sm" variant="outline" onClick={back} disabled={busy || overlay !== null}>
            Back
          </Button>
          <Button type="button" size="sm" onClick={() => void next()} disabled={busy || overlay !== null}>
            {busy ? "Working…" : step === "plan" ? "Finish" : "Next"}
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
