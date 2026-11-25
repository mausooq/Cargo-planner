"use client"

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import type { PlannerStep } from "@compass/domain"
import Link from "next/link"
import { createPortal } from "react-dom"
import { FileSpreadsheet, Pencil, Printer } from "lucide-react"
import { clearanceViolations, describeSetting, describeSides, resolveMinSupportPct, type ClearanceSetting } from "@compass/physics"
import { ClearanceEditorDialog } from "@/components/clearance-editor"
import { useEditorSettings } from "@/lib/editor-settings"
import { toast } from "sonner"
import { persistPlan, revalidatePlanLayout, savePlanLayout } from "@/app/actions/plan"
import type { CargoLine } from "@/components/cargo-grid"
import { useRouter } from "next/navigation"
import { saveClearanceConfig, type ClearanceInput } from "@/app/actions/clearance"
import { createFlowLock, describeProposedChange, retryRecalculation, runClearanceFlow, type FlowDeps, type FlowOutcome } from "@/lib/clearance-flow"
import { rotationProblem } from "@/lib/layout-validation"
import { derivePlanStatus, type PlanStatus } from "@/lib/plan-status"
import type { LayoutViolation } from "@/app/actions/plan"
import { ClearanceSettings } from "@/components/clearance-settings"
import { ManageClearancesDialog } from "@/components/manage-clearances"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DragSettingsPanel } from "@/components/drag-settings"
import { LoadViewer, PIECE_DRAG_TYPE, type ViewerCamera } from "@/components/load-viewer"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { PlanDiagram } from "@/components/plan-diagram"
import { Button } from "@/components/ui/button"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { applyGravity } from "@/lib/cargo-gravity"
import { snapToNeighbours, snapToStack } from "@/lib/cargo-snap"
import { findFreeSpot } from "@/lib/cargo-spot"
import { liveMetrics, metricBoxesOf, type LiveMetrics } from "@/lib/plan-metrics"
import { formatEnteredLength, formatEnteredWeight, lengthTitle, pieceValues, turnedTitle } from "@/lib/plan-piece-values"
import { rotateItemFlat, tryPlaceItem } from "@/lib/cargo-skin"
import { formatEnvelope, formatKg, formatM3, formatPct } from "@/lib/format"
import { lengthCellText, LENGTH_UNIT_SYMBOL } from "@/lib/cargo-units"
import { useLengthUnit } from "@/lib/length-unit-pref"
import { downloadPlanWorkbook, loadOrder } from "@/lib/plan-export"
import {
  ACTUAL_FLOOR_HELP,
  AXLE_ESTIMATE_NOTE,
  clearanceConfig,
  countSettings,
  describeConfigChange,
  EFFECTIVE_FLOOR_HELP,
  lineSetting,
  settingToCargoFields,
  type ClearanceConfig,
} from "@/lib/clearance"
import {
  pendingClearanceChanges,
  toPlanView,
  withClearanceDraft,
  withLineClearance,
  withMetrics,
  type PlanItemView,
  type PlanUnitView,
  type PlanView,
} from "@/lib/plan-view"
import { runSolver } from "@/lib/run-solver"
import { buildSolverInput } from "@/lib/solver-input"
import { cn } from "@/lib/utils"

export type PlanWorkspaceHandle = {
  calculate: () => Promise<boolean>
  hasPlan: () => boolean
  /** True while the user has moved cargo in 3D without saving. */
  isDirty: () => boolean
  discardChanges: () => void
}

/** The share of support the Playground is working with right now (the project's, via the editor settings). */
function supportRatio(): number {
  return useEditorSettings.getState().minSupportPct / 100
}

export const PlanWorkspace = forwardRef<
  PlanWorkspaceHandle,
  {
    projectId: string
    projectName: string
    cargo: CargoLine[]
    equipment: EquipmentListItem[]
    objective: "FEWEST_UNITS" | "LOWEST_COST"
    /** Project default handling clearance per side, in cm. */
    clearanceCm: number
    /** The project's own minimum support share (percent), when it has one. */
    minSupportPct?: number | null
    initialPlan: PlanView | null
    initialStale?: boolean
    canEdit: boolean
    variant: Extract<PlannerStep, "workspace" | "plan">
    onPlanChange?: (ready: boolean) => void
    /** The plan's status (not calculated, calculating, ready, out of date, failed), one value for every screen. */
    onStatusChange?: (status: PlanStatus) => void
    /** Go to the Load plan step (where the Playground is). */
    onOpenPlan?: () => void
    onEditStep?: (step: Extract<PlannerStep, "data" | "setup">) => void
  }
>(function PlanWorkspace(
  {
    projectId,
    projectName,
    cargo,
    equipment,
    objective,
    clearanceCm,
    minSupportPct = null,
    initialPlan,
    initialStale = false,
    canEdit,
    variant,
    onPlanChange,
    onStatusChange,
    onOpenPlan,
    onEditStep,
  },
  ref,
) {
  const [plan, setPlan] = useState<PlanView | null>(initialPlan)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [progressPct, setProgressPct] = useState(0)
  const [selected, setSelected] = useState(0)
  const [layoutDirty, setLayoutDirty] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [pendingUnit, setPendingUnit] = useState<number | null>(null)
  const [confirmRecalc, setConfirmRecalc] = useState(false)
  const [exporting, setExporting] = useState(false)
  const router = useRouter()
  const lengthUnit = useLengthUnit()
  const [stale, setStale] = useState(initialStale)
  const [syncedStale, setSyncedStale] = useState(initialStale)
  if (syncedStale !== initialStale) {
    setSyncedStale(initialStale)
    setStale(initialStale)
  }
  // Clearance changes: what is happening, whether the manage panel is open, a change waiting for the
  // planner to decide about a hand-arranged layout, and the last failure (with what to retry).
  const [status, setStatus] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [heldChange, setHeldChange] = useState<ClearanceInput | null>(null)
  const [recalcFailure, setRecalcFailure] = useState<{ message: string; config: ClearanceConfig } | null>(null)
  // A clearance change the saved layout could not keep. It is NOT saved: it stays here as a draft until it is
  // fixed in the Playground, applied another way, or discarded. The saved plan and its status are untouched.
  const [draft, setDraft] = useState<{ change: ClearanceInput; problems: string[]; violations: LayoutViolation[] } | null>(null)
  // Asks the Load plan to open the Playground on a unit with the draft applied.
  const [fixRequest, setFixRequest] = useState<{ unitIndex: number; change: ClearanceInput; ids: string[] } | null>(null)
  const [fixKey, setFixKey] = useState(0)
  const [calcFailed, setCalcFailed] = useState(false)
  const applying = status !== null
  const configChange = plan ? describeConfigChange(plan.clearanceConfig ?? null, clearanceConfig(clearanceCm, cargo.map((line) => ({ id: line.id, setting: lineSetting(line) })))) : null
  const lastError = useRef<string | null>(null)
  const flowLock = useRef(createFlowLock())
  // After a clearance change the server's version of the plan (with the new settings) replaces ours once it arrives.
  const [syncedPlan, setSyncedPlan] = useState(initialPlan)
  const [adoptNext, setAdoptNext] = useState(false)
  if (syncedPlan !== initialPlan) {
    setSyncedPlan(initialPlan)
    if (adoptNext) {
      setAdoptNext(false)
      setPlan(initialPlan)
      setLayoutDirty(false)
    }
  }
  const selectedIndex = plan && plan.units.length > 0 ? Math.min(selected, plan.units.length - 1) : 0
  const unit = plan?.units[selectedIndex] ?? null

  function discardChanges() {
    setLayoutDirty(false)
    setResetKey((key) => key + 1)
  }

  function openUnit(index: number, { force = false } = {}) {
    if (index === selectedIndex) return
    if (layoutDirty && !force) {
      setPendingUnit(index)
      return
    }
    if (force) discardChanges()
    setSelected(index)
  }

  async function exportExcel() {
    if (!plan) return
    setExporting(true)
    try {
      await downloadPlanWorkbook(plan, projectName, lengthUnit)
    } catch {
      toast.error("Could not build the Excel file.")
    } finally {
      setExporting(false)
    }
  }

  const totals = useMemo(() => {
    if (!plan) return null
    return {
      pieces: plan.units.reduce((sum, entry) => sum + entry.pieces, 0),
      units: plan.units.length,
      kg: plan.units.reduce((sum, entry) => sum + entry.netKg, 0),
      volume: plan.units.reduce((sum, entry) => sum + entry.volumeM3, 0),
    }
  }, [plan])

  /** The clearance configuration on screen: the project default and each line's own setting. */
  function currentConfig(): ClearanceConfig {
    return clearanceConfig(
      clearanceCm,
      cargo.map((line) => ({ id: line.id, setting: lineSetting(line) })),
    )
  }

  /**
   * Packs the cargo and saves the plan. `usedConfig` is the clearance configuration to use; the
   * Save & Recalculate flow passes what the server just stored, so the run never uses stale screen state.
   * Failing at any step leaves the previous plan exactly as it was.
   */
  async function calculate(usedConfig?: ClearanceConfig) {
    lastError.current = null
    setCalcFailed(false)
    if (equipment.length === 0) {
      toast.error("Pick equipment in Setup first.")
      return false
    }
    if (cargo.length === 0) {
      toast.error("Add cargo in Data first.")
      return false
    }
    const config = usedConfig ?? currentConfig()
    const cargoUsed = cargo.map((line) => ({ ...line, ...settingToCargoFields(config.lines[line.id] ?? null) }))
    setBusy(true)
    setProgress("Packing…")
    setProgressPct(0)
    // Let the browser paint the progress panel (and drop the old 3D scene) before the work starts.
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    try {
      const result = await runSolver(
        buildSolverInput({ cargo: cargoUsed, equipment, objective, clearanceCm: config.defaultCm, minSupportPct }),
        (event) => {
          setProgress(`Trying layout ${event.restart} of ${event.restarts}`)
          setProgressPct(Math.round((event.restart / Math.max(1, event.restarts)) * 100))
        },
      )
      const view = toPlanView(
        result,
        equipment.map((item) => ({
          id: item.id,
          name: item.name,
          mode: item.mode,
          oogClass: item.oogClass,
          heightOpen: item.heightOpen,
          contour: item.contour,
          lengthCm: item.innerLengthCm,
          widthCm: item.innerWidthCm,
          heightCm: item.innerHeightCm,
          maxPayloadKg: item.maxPayloadKg,
        })),
        cargoUsed.map((item) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          weightKg: item.weightKg,
          color: item.color,
          shape: item.shape,
          stackable: item.stackable,
          bottomOnly: item.bottomOnly,
          maxStackLoadKg: item.maxStackLoadKg,
          clearanceCm: item.clearanceCm ?? null,
          clearanceSides: item.clearanceSides ?? null,
        })),
      )
      const saved = await persistPlan(projectId, result, config)
      // A plan that could not be saved is not shown as the current one: the previous plan stays.
      if (!saved.ok) throw new Error(saved.error)
      if (view.unloaded.length > 0) {
        toast.warning(
          `${view.unloaded.length} piece${view.unloaded.length === 1 ? "" : "s"} did not fit. See the list below for what to change.`,
        )
      } else {
        toast.success("Load plan ready.")
      }
      setPlan(view)
      setSelected(0)
      setLayoutDirty(false)
      setStale(false)
      onPlanChange?.(view.units.length > 0)
      return view.units.length > 0
    } catch (error) {
      lastError.current = error instanceof Error ? error.message : "The solver failed."
      setCalcFailed(true)
      toast.error(lastError.current)
      return false
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  /** The dependencies the clearance flow runs against: this screen's server actions and its own calculate. */
  function flowDeps(): FlowDeps {
    return {
      hasPlan: Boolean(plan && plan.units.length > 0),
      manualLayout: plan?.layoutSource === "MANUAL",
      save: (change) => saveClearanceConfig(projectId, change),
      recalculate: async (config) => {
        const ok = await calculate(config)
        return ok ? { ok: true } : { ok: false, message: lastError.current ?? "The load plan could not be recalculated." }
      },
      keep: async (change) => {
        const result = await revalidatePlanLayout(projectId, {
          defaultCm: change.defaultCm,
          clearanceChanges: change.lines.map((line) => ({ cargoId: line.cargoId, setting: line.setting })),
        })
        return result.ok
          ? { ok: true }
          : {
              ok: false,
              problems: result.violations.length > 0 ? result.violations.map((entry) => entry.message) : [result.error],
              violations: result.violations,
            }
      },
      setStatus,
    }
  }

  /** Shows what the flow did: saved, recalculated, kept, refused or failed (with the old plan still in place). */
  function showOutcome(outcome: FlowOutcome) {
    switch (outcome.kind) {
      case "busy":
        break
      case "needs-confirmation":
        break
      case "save-failed":
        toast.error(outcome.error)
        break
      case "saved":
        toast.success("Clearance settings saved.")
        router.refresh()
        break
      case "kept":
        toast.success("Clearances saved. Your layout still works and was kept as it is.")
        setAdoptNext(true)
        router.refresh()
        break
      case "rejected":
        // Nothing was saved or moved, so the plan keeps whatever status it had. The proposal stays as a draft.
        setDraft({ change: outcome.change, problems: outcome.problems, violations: outcome.violations })
        break
      case "recalculated":
        setAdoptNext(true)
        router.refresh()
        break
      case "recalc-failed":
        // The previous plan is still shown, and is still out of date.
        setStale(true)
        setRecalcFailure({ message: outcome.message, config: outcome.config })
        setAdoptNext(true)
        router.refresh()
        break
    }
  }

  /**
   * Saves clearance settings and, when a plan exists, brings it up to date in one step, once for the
   * whole set of changes. A hand-arranged layout is only replaced after the planner confirms.
   */
  async function applyClearance(change: ClearanceInput, how: "recalculate" | "keep" = "recalculate", confirmed = false) {
    if (!canEdit) return
    setRecalcFailure(null)
    setDraft(null)
    const outcome = await runClearanceFlow(flowDeps(), change, how, flowLock.current, { confirmed })
    if (outcome.kind === "needs-confirmation") {
      setHeldChange(change)
      return
    }
    showOutcome(outcome)
  }

  /**
   * Every clearance change goes through here. With a calculated plan the planner chooses first (the common
   * "Apply clearance changes" dialog); with none the settings are simply saved.
   */
  function requestApply(change: ClearanceInput) {
    if (!canEdit || applying || busy) return
    if (plan && plan.units.length > 0) {
      setHeldChange(change)
      return
    }
    setManageOpen(false)
    void applyClearance(change)
  }

  /** Opens the Playground on the unit with the problem, with the rejected proposal applied as an unsaved draft. */
  function fixInPlayground() {
    if (!draft) return
    if (layoutDirty) {
      toast.error("Save or reset your current layout edits first, then open the Playground on the proposed clearances.")
      return
    }
    const first = draft.violations[0]
    const unitIndex = first ? Math.min(first.unitIndex, Math.max(0, (plan?.units.length ?? 1) - 1)) : selectedIndex
    setSelected(unitIndex)
    setFixKey((key) => key + 1)
    setFixRequest({
      unitIndex,
      change: draft.change,
      ids: draft.violations.filter((entry) => entry.unitIndex === unitIndex).map((entry) => entry.id),
    })
    if (variant !== "plan") onOpenPlan?.()
  }

  async function retryRecalculationNow() {
    if (!recalcFailure) return
    const config = recalcFailure.config
    setRecalcFailure(null)
    showOutcome(await retryRecalculation(flowDeps(), config, flowLock.current))
  }

  const hasPlanNow = Boolean(plan && plan.units.length > 0)
  const planStatus = useMemo(
    () => derivePlanStatus({ hasPlan: hasPlanNow, calculating: busy || applying, stale, failed: calcFailed || recalcFailure !== null }),
    [applying, busy, calcFailed, hasPlanNow, recalcFailure, stale],
  )
  useEffect(() => {
    onStatusChange?.(planStatus)
  }, [onStatusChange, planStatus])

  useImperativeHandle(ref, () => ({
    calculate,
    hasPlan: () => Boolean(plan && plan.units.length > 0),
    isDirty: () => canEdit && layoutDirty,
    discardChanges,
  }))

  return (
    <div className="relative min-h-48 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2.5">
        <div className="text-sm text-muted-foreground">
          {totals ? (
            <span>
              {totals.pieces} pieces loaded · {totals.units} unit{totals.units === 1 ? "" : "s"} · {formatKg(totals.kg)} ·{" "}
              {formatM3(totals.volume)}
              {plan && plan.unloaded.length > 0 ? ` · ${plan.unloaded.length} not loaded` : ""}
            </span>
          ) : (
            <span>No plan yet. Calculate to pack the cargo into the selected equipment.</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {variant === "plan" && plan && plan.units.length > 0 ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => void exportExcel()} disabled={exporting}>
                <FileSpreadsheet className="size-3.5" />
                {exporting ? "Preparing…" : "Excel"}
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/projects/${projectId}/report`}>
                  <Printer className="size-3.5" />
                  Print / PDF
                </Link>
              </Button>
            </>
          ) : null}
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant={plan && variant === "plan" ? "outline" : "default"}
              onClick={() => (layoutDirty ? setConfirmRecalc(true) : void calculate())}
              disabled={busy || applying}
            >
              {busy ? progress ?? "Calculating…" : plan ? "Recalculate" : "Calculate load plan"}
            </Button>
          ) : null}
        </div>
      </div>

      <ClearanceSettings
        value={clearanceCm}
        canEdit={canEdit}
        hasPlan={Boolean(plan && plan.units.length > 0)}
        busy={busy || applying}
        status={status}
        planUsedCm={plan && plan.units.length > 0 && plan.clearanceCm !== clearanceCm ? plan.clearanceCm : null}
        counts={countSettings(cargo.map((line) => lineSetting(line)))}
        onSave={(defaultCm) => requestApply({ defaultCm, lines: [] })}
        onManage={() => setManageOpen(true)}
      />
      <ManageClearancesDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        lines={cargo}
        projectDefault={clearanceCm}
        hasPlan={Boolean(plan && plan.units.length > 0)}
        busy={busy || applying}
        canEdit={canEdit}
        onApply={(change) => requestApply(change)}
      />
      {recalcFailure ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>
            The clearance settings were saved, but the load plan could not be recalculated: {recalcFailure.message} The previous plan is still shown and is out of date.
          </span>
          <Button type="button" size="sm" onClick={() => void retryRecalculationNow()} disabled={busy || applying}>
            Retry recalculation
          </Button>
        </div>
      ) : null}
      {draft ? (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">Not saved: your current layout cannot keep the proposed clearances.</p>
          <p className="text-xs">
            The proposal was rejected and nothing was changed. Your saved settings, layout and plan are exactly as they were. The proposal stays here as a draft until you
            apply or discard it.
          </p>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <p className="font-medium">Proposed</p>
              <ul className="list-disc pl-5">
                {describeProposedChange(draft.change, cargo, clearanceCm)
                  .slice(0, 6)
                  .map((line) => (
                    <li key={line}>{line}</li>
                  ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">Pieces that break them</p>
              <ul className="list-disc pl-5">
                {(draft.violations.length > 0 ? draft.violations.map((entry) => `Unit ${entry.unitIndex + 1}: ${entry.message}`) : draft.problems)
                  .slice(0, 6)
                  .map((line) => (
                    <li key={line}>{line}</li>
                  ))}
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={fixInPlayground} disabled={busy || applying}>
              Fix in Playground
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setHeldChange(draft.change)} disabled={busy || applying}>
              Save &amp; Recalculate instead
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null)
                setFixRequest(null)
              }}
            >
              Discard proposed changes
            </Button>
          </div>
        </div>
      ) : null}
      <Dialog open={heldChange !== null} onOpenChange={(open) => (!open ? setHeldChange(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply clearance changes</DialogTitle>
            <DialogDescription>
              Keep your current cargo arrangement if it satisfies the new clearance requirements, or recalculate to generate a new loading plan.
            </DialogDescription>
          </DialogHeader>
          {heldChange ? (
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {describeProposedChange(heldChange, cargo, clearanceCm)
                .slice(0, 6)
                .map((line) => (
                  <li key={line}>{line}</li>
                ))}
            </ul>
          ) : null}
          {plan?.layoutSource === "MANUAL" ? (
            <p className="rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              You arranged cargo by hand. Recalculating replaces that arrangement with a new one.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Cancel changes nothing. Keep current layout saves the new settings only if every piece still has its room, and moves nothing. Save &amp; Recalculate saves
            them and packs the cargo again, once.
          </p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setHeldChange(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const change = heldChange
                setHeldChange(null)
                setManageOpen(false)
                if (change) void applyClearance(change, "keep")
              }}
            >
              Keep current layout
            </Button>
            <Button
              type="button"
              onClick={() => {
                const change = heldChange
                setHeldChange(null)
                setManageOpen(false)
                // The planner has just answered the question.
                if (change) void applyClearance(change, "recalculate", true)
              }}
            >
              Save &amp; Recalculate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {stale && plan && plan.units.length > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <span>
            Cargo or clearance settings changed after this plan was calculated
            {configChange ? ` (${configChange})` : ""}. Recalculate so the plan includes the changes
            {plan.layoutSource === "MANUAL" ? ", or use Manage clearances to keep your hand-arranged layout if it still works" : ""}.
          </span>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              onClick={() => (layoutDirty ? setConfirmRecalc(true) : void calculate())}
              disabled={busy}
            >
              Recalculate now
            </Button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmRecalc}
        onOpenChange={setConfirmRecalc}
        destructive
        title="Recalculate and discard your layout edits?"
        description="You moved cargo by hand and have not saved. A new calculation replaces those moves."
        confirmLabel="Recalculate"
        onConfirm={() => {
          discardChanges()
          void calculate()
        }}
      />
      <ConfirmDialog
        open={pendingUnit !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUnit(null)
        }}
        destructive
        title="Switch unit without saving?"
        description="You moved cargo in this unit but did not save. Switching discards those moves."
        confirmLabel="Discard and switch"
        onConfirm={() => {
          if (pendingUnit !== null) openUnit(pendingUnit, { force: true })
          setPendingUnit(null)
        }}
      />

      <div key={variant} className="motion-enter space-y-4">
      {busy ? (
        // The 3D scene is unmounted while calculating so the old and new plans never sit in memory together.
        <CalculatingPanel label={progress} pct={progressPct} pieces={cargo.reduce((sum, line) => sum + line.quantity, 0)} />
      ) : !plan || plan.units.length === 0 ? (
        <EmptyPlan unloaded={plan?.unloaded ?? []} canEdit={canEdit} onEditStep={onEditStep} />
      ) : variant === "workspace" ? (
        <>
          <WorkspaceTable units={plan.units} selected={selectedIndex} onSelect={setSelected} />
          <UnloadedList unloaded={plan.unloaded} onEditStep={onEditStep} />
        </>
      ) : (
        unit && (
          <>
            <UnitPicker units={plan.units} selected={selectedIndex} onSelect={openUnit} />
            <div className="relative">
            <LoadPlanDetail
              key={`${selectedIndex}-${resetKey}-${fixKey}`}
              projectId={projectId}
              fix={fixRequest && fixRequest.unitIndex === selectedIndex ? fixRequest : null}
              onFixApplied={() => setFixRequest(null)}
              onDraftDiscarded={() => {
                setDraft(null)
                setFixRequest(null)
              }}
              canEdit={canEdit}
              cargo={cargo}
              unit={unit}
              unitNumber={selectedIndex + 1}
              unitCount={plan.units.length}
              warnings={plan.warnings}
              unloaded={plan.unloaded}
              planCurrent={!stale}
              projectDefault={clearanceCm}
              projectMinSupportPct={minSupportPct}
              layoutSource={plan.layoutSource ?? "AUTO"}
              onEditStep={onEditStep}
              onDirtyChange={setLayoutDirty}
              onSaved={(nextItems, result, clearanceChanged) => {
                if (clearanceChanged) setDraft(null)
                // Line settings changed in the Playground reach pieces in other units too: take the server's version of the plan.
                if (clearanceChanged) {
                  setAdoptNext(true)
                  router.refresh()
                }
                // The server recalculated every number from the saved positions; show those, so the
                // Load plan, the table and the reports agree without a reload.
                setPlan((current) =>
                  current
                    ? {
                        ...current,
                        warnings: result.planWarnings,
                        layoutSource: result.layoutSource,
                        units: current.units.map((entry) => {
                          const fresh = result.units.find((row) => row.unitIndex === entry.unitIndex)
                          const next = entry.unitIndex === unit.unitIndex ? { ...entry, items: nextItems } : entry
                          return fresh ? withMetrics(next, fresh.metrics) : next
                        }),
                      }
                    : current,
                )
              }}
            />
            </div>
          </>
        )
      )}
      </div>
    </div>
  )
})

function CalculatingPanel({ label, pct, pieces }: { label: string | null; pct: number; pieces: number }) {
  return (
    <div className="rounded-md border bg-card px-4 py-12 text-center" role="status" aria-live="polite">
      <span className="mx-auto block size-8 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium">Calculating the load plan…</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Packing {pieces} piece{pieces === 1 ? "" : "s"}. {label && label !== "Packing…" ? label : "This can take a few seconds."}
      </p>
      <div className="mx-auto mt-4 h-1.5 w-64 max-w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${Math.max(6, pct)}%` }}
        />
      </div>
    </div>
  )
}

function EmptyPlan({
  unloaded,
  canEdit,
  onEditStep,
}: {
  unloaded: PlanView["unloaded"]
  canEdit: boolean
  onEditStep?: (step: "data" | "setup") => void
}) {
  if (unloaded.length > 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center">
          <p className="text-sm font-medium">Nothing could be loaded</p>
          <p className="mt-1 text-sm text-muted-foreground">None of the cargo fits the chosen equipment. See why below.</p>
        </div>
        <UnloadedList unloaded={unloaded} onEditStep={onEditStep} />
      </div>
    )
  }
  return (
    <div className="rounded-md border border-dashed bg-card px-4 py-10 text-center">
      <p className="text-sm font-medium">No load plan yet</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {canEdit
          ? "Click Calculate load plan to pack your cargo into the chosen equipment. It usually takes a few seconds."
          : "A planner has not calculated this project yet."}
      </p>
    </div>
  )
}

function WorkspaceTable({
  units,
  selected,
  onSelect,
}: {
  units: PlanUnitView[]
  selected: number
  onSelect: (index: number) => void
}) {
  const lengthUnit = useLengthUnit()
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <table className="sheet-table w-full text-left text-sm">
        <thead className="bg-muted/70 text-xs tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-4 py-2">Unit</th>
            <th className="px-4 py-2">Pieces</th>
            <th className="px-4 py-2">Weight</th>
            <th className="px-4 py-2">Volume</th>
            <th className="px-4 py-2">Used space</th>
            <th className="px-4 py-2" title={ACTUAL_FLOOR_HELP}>
              Actual floor utilization (%)
            </th>
            <th className="px-4 py-2" title={EFFECTIVE_FLOOR_HELP}>
              Effective floor utilization (%)
            </th>
            <th className="px-4 py-2">View</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit, index) => (
            <tr
              key={unit.unitIndex}
              className={cn("cursor-pointer", selected === index && "bg-secondary/70")}
              onClick={() => onSelect(index)}
            >
              <td className="px-4 py-3 font-medium">
                {index + 1}. {unit.equipmentName}
              </td>
              <td className="px-4 py-3">{unit.pieces}</td>
              <td className="px-4 py-3">
                {formatKg(unit.netKg)} ({formatPct(unit.weightPct)})
              </td>
              <td className="px-4 py-3">
                {formatM3(unit.volumeM3)} ({formatPct(unit.volumePct)})
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                L {lengthCellText(unit.usedLengthCm, lengthUnit)} · W {lengthCellText(unit.usedWidthCm, lengthUnit)} · H{" "}
                {lengthCellText(unit.usedHeightCm, lengthUnit)} {LENGTH_UNIT_SYMBOL[lengthUnit]}
              </td>
              <td className="px-4 py-3 tabular-nums" title={ACTUAL_FLOOR_HELP}>
                {formatPct(unit.floorActualPct)}
              </td>
              <td className="px-4 py-3 tabular-nums" title={EFFECTIVE_FLOOR_HELP}>
                {formatPct(unit.floorEffectivePct)}
              </td>
              <td className="px-4 py-3">
                <div className="h-20 w-48 overflow-hidden rounded-lg border bg-white">
                  <PlanDiagram unit={unit} view="side" bare className="h-full w-full" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UnitPicker({
  units,
  selected,
  onSelect,
}: {
  units: PlanUnitView[]
  selected: number
  onSelect: (index: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Containers in this load plan">
      <span className="text-sm text-muted-foreground">Looking at</span>
      {units.map((unit, index) => {
        const active = selected === index
        return (
          <button
            key={`${unit.equipmentId}-${unit.unitIndex}-${index}`}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(index)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {index + 1}. {unit.equipmentName}
          </button>
        )
      })}
    </div>
  )
}

function LoadPlanDetail({
  projectId,
  fix,
  onFixApplied,
  onDraftDiscarded,
  canEdit,
  cargo,
  unit,
  unitNumber,
  unitCount,
  warnings,
  unloaded,
  planCurrent,
  projectDefault,
  projectMinSupportPct,
  layoutSource,
  onSaved,
  onEditStep,
  onDirtyChange,
}: {
  projectId: string
  /** A rejected clearance proposal to open the Playground on, as an unsaved draft. Read once, when this mounts. */
  fix: { change: ClearanceInput; ids: string[] } | null
  onFixApplied: () => void
  onDraftDiscarded: () => void
  canEdit: boolean
  /** The cargo lines as entered in step 1, so the piece list can show the same values. */
  cargo: CargoLine[]
  unit: PlanUnitView
  unitNumber: number
  unitCount: number
  warnings: string[]
  unloaded: PlanView["unloaded"]
  /** False when the saved plan is out of date: the piece list then shows what was calculated, not today's cargo list. */
  planCurrent: boolean
  /** The project's default handling clearance now, per side in cm. */
  projectDefault: number
  projectMinSupportPct: number | null
  layoutSource: "AUTO" | "MANUAL"
  onSaved: (
    items: PlanItemView[],
    result: Extract<Awaited<ReturnType<typeof savePlanLayout>>, { ok: true }>,
    clearanceChanged: boolean,
  ) => void
  onEditStep?: (step: "data" | "setup") => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const enteredCargo = useMemo(() => new Map(cargo.map((line) => [line.id, line])), [cargo])
  const [synced, setSynced] = useState(unit)
  const [items, setItems] = useState(() => (fix ? withClearanceDraft(unit.items, fix.change, projectDefault) : unit.items))
  // A project default proposed but not saved yet (only ever comes from a draft); null when there is none.
  const [pendingDefault, setPendingDefault] = useState<number | null>(fix?.change.defaultCm ?? null)
  const [playground, setPlayground] = useState(Boolean(fix))
  const [view, setView] = useState<ViewerCamera>("iso")
  const [selectedId, setSelectedId] = useState<string | null>(fix?.ids[0] ?? null)
  const effectiveDefault = pendingDefault ?? projectDefault
  const defaultPending = pendingDefault !== null && pendingDefault !== projectDefault
  const [saving, setSaving] = useState(false)
  // Pieces taken out of the container for now ("Set aside"). They are still part of the plan and
  // can be added back from the playground's left panel; nothing is deleted.
  const [aside, setAside] = useState<PlanItemView[]>([])
  const [history, setHistory] = useState<LayoutSnapshot[]>([])
  const [flashItem, setFlashItem] = useState<PlanItemView | null>(null)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  // Pieces the server named as breaking a rule on the last save attempt (highlighted until something changes).
  const [serverViolations, setServerViolations] = useState<string[]>([])
  const editorSettings = useEditorSettings()
  const lengthUnit = useLengthUnit()
  const dragging = useRef(false)
  useEffect(() => {
    if (fix) onFixApplied()
    // Read once, when the Playground opens on a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The project's minimum support share is the one source: the Playground starts from it.
  useEffect(() => {
    // Always: a number left in this browser from earlier is not the project's setting and must not decide what is valid.
    useEditorSettings.getState().patch({ minSupportPct: resolveMinSupportPct(projectMinSupportPct) })
  }, [projectMinSupportPct])
  if (synced !== unit) {
    setSynced(unit)
    setItems(unit.items)
    setAside([])
    setSelectedId(null)
    setHistory([])
  }

  const liveUnit = { ...unit, items }
  // Recomputed on every move so the numbers follow the layout while editing.
  // Undo, Reset, set aside and add back all go through `items` / `aside`, so they update this too.
  const live = useMemo(() => liveMetrics(items, unit, aside.length), [items, unit, aside.length])
  const hasClearance = items.some((item) => (item.clearanceCm ?? 0) > 0) || aside.some((item) => (item.clearanceCm ?? 0) > 0)
  const [showClearance, setShowClearance] = useState(false)
  const selected = items.find((item) => item.id === selectedId) ?? null
  // Line clearance edited in the Playground but not saved yet: kept with the pieces, so Undo and Reset cover it.
  const clearanceChanges = useMemo(() => pendingClearanceChanges([...items, ...aside], unit.items), [aside, items, unit])
  // Pieces whose reserved space is broken right now: live, from the same rule the server applies.
  const violations = useMemo(() => clearanceViolations(metricBoxesOf(items), unit), [items, unit])
  const violatingIds = useMemo(() => {
    const ids = new Set<string>(serverViolations)
    for (const entry of violations) {
      ids.add(entry.id)
      if (entry.otherId) ids.add(entry.otherId)
    }
    return ids
  }, [serverViolations, violations])
  const dirty = aside.length > 0 || clearanceChanges.length > 0 || defaultPending || items.some((item) => {
    const original = unit.items.find((entry) => entry.id === item.id)
    if (!original) return true
    return (
      original.x !== item.x ||
      original.y !== item.y ||
      original.z !== item.z ||
      original.lengthCm !== item.lengthCm ||
      original.widthCm !== item.widthCm ||
      original.rotation !== item.rotation
    )
  })

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // Every move (drag, arrow keys, rotate) goes through here. Gravity runs afterwards so anything
  // that was resting on a moved piece drops onto whatever is now below it instead of floating.
  // Undo restores the whole previous layout, falls included, in one step.
  const commitItems = useCallback(
    (next: PlanItemView[]) => {
      setHistory((past) => [...past.slice(-40), { items, aside }])
      setItems(applyGravity(next, unit).items)
    },
    [aside, items, unit],
  )

  const undoLayout = useCallback(() => {
    setHistory((past) => {
      const previous = past[past.length - 1]
      if (previous) {
        setItems(previous.items)
        setAside(previous.aside)
      }
      return past.slice(0, -1)
    })
  }, [])

  /**
   * Changes a cargo line's clearance for every piece of that line, here and (when saved) in other
   * units. Nothing moves: the layout is only re-checked, violations are highlighted, and the change
   * stays pending until the layout is saved. Undo and Reset layout take it back.
   */
  const applyLineClearance = useCallback(
    (cargoId: string, setting: ClearanceSetting) => {
      setHistory((past) => [...past.slice(-40), { items, aside }])
      setItems(withLineClearance(items, cargoId, setting, effectiveDefault))
      setAside(withLineClearance(aside, cargoId, setting, effectiveDefault))
      setServerViolations([])
    },
    [aside, effectiveDefault, items],
  )

  /** Take the selected piece out of the container for now. Anything stacked on it drops down. */
  const removeSelected = useCallback(() => {
    if (!selected) {
      toast.error("Click a cargo piece first.")
      return
    }
    setHistory((past) => [...past.slice(-40), { items, aside }])
    setAside((current) => [...current, selected])
    setItems(applyGravity(items.filter((item) => item.id !== selected.id), unit).items)
    setSelectedId(null)
  }, [aside, items, selected, unit])

  /**
   * Drop a set-aside piece where the user let go over the container: centred on the drop point,
   * snapped like a drag (on top of a box, or flush against neighbours and walls), turned 90° if
   * that is the only way it fits there.
   */
  const placeAsideAt = useCallback(
    (id: string, at: { x: number; y: number }) => {
      const piece = aside.find((entry) => entry.id === id)
      if (!piece) return
      const clamp = (value: number, size: number, room: number) => Math.min(Math.max(0, value), Math.max(0, room - size))
      const tryAt = (candidate: PlanItemView) => {
        const centred = {
          ...candidate,
          x: clamp(at.x - candidate.lengthCm / 2, candidate.lengthCm, unit.lengthCm),
          y: clamp(at.y - candidate.widthCm / 2, candidate.widthCm, unit.widthCm),
          z: 0,
        }
        const stack = snapToStack(centred, items)
        const snapped = stack.target ? stack.item : snapToNeighbours(centred, items, unit).item
        return tryPlaceItem(snapped, items, unit, supportRatio()) ?? tryPlaceItem(centred, items, unit, supportRatio())
      }
      const placed = tryAt(piece) ?? (piece.shape === "BOX" ? tryAt(rotateItemFlat(piece)) : null)
      if (!placed) {
        toast.error(`${piece.name} doesn't fit there. Try another spot, or use Add back to find one.`)
        return
      }
      setHistory((past) => [...past.slice(-40), { items, aside }])
      setItems(applyGravity([...items, placed], unit).items)
      setAside((current) => current.filter((entry) => entry.id !== id))
      setSelectedId(placed.id)
    },
    [aside, items, unit],
  )

  /** Put set-aside pieces back: their old spot if still free, otherwise the best free spot. */
  const addBack = useCallback(
    (ids: string[]) => {
      let nextItems = items
      const placedIds: string[] = []
      const failed: string[] = []
      for (const id of ids) {
        const piece = aside.find((entry) => entry.id === id)
        if (!piece) continue
        const spot = findFreeSpot(piece, nextItems, unit, supportRatio())
        if (!spot) {
          failed.push(piece.name)
          continue
        }
        nextItems = applyGravity([...nextItems, spot], unit).items
        placedIds.push(id)
      }
      if (placedIds.length > 0) {
        setHistory((past) => [...past.slice(-40), { items, aside }])
        setItems(nextItems)
        setAside((current) => current.filter((entry) => !placedIds.includes(entry.id)))
        if (placedIds.length === 1) setSelectedId(placedIds[0] ?? null)
      }
      if (failed.length > 0) {
        toast.error(
          failed.length === 1
            ? `No free spot for ${failed[0]}. Move something to make room, then add it back.`
            : `No free spot for ${failed.length} pieces. Move something to make room, then add them back.`,
        )
      }
    },
    [aside, items, unit],
  )

  const rotateSelected = useCallback(() => {
    if (!selected) {
      toast.error("Click a cargo piece first.")
      return
    }
    const turned = rotateItemFlat(selected)
    const line = cargo.find((entry) => entry.id === selected.cargoId)
    const refusal = line
      ? rotationProblem(turned, {
          lengthCm: line.lengthCm,
          widthCm: line.widthCm,
          heightCm: line.heightCm,
          orientation: line.orientation,
          shape: line.shape,
          allowedRotations: line.allowedRotations,
        })
      : null
    if (refusal) {
      toast.error(refusal)
      return
    }
    const placed = tryPlaceItem(turned, items, unit, supportRatio())
    if (!placed) {
      toast.error("That turn does not fit here.")
      setFlashItem(selected)
      window.setTimeout(() => setFlashItem(null), 300)
      return
    }
    commitItems(items.map((item) => (item.id === selected.id ? placed : item)))
  }, [cargo, commitItems, items, selected, unit])

  useEffect(() => {
    if (!playground) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (dragging.current) return
        setPlayground(false)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        undoLayout()
        return
      }
      if (!selectedId) return
      const current = items.find((item) => item.id === selectedId)
      if (!current) return
      // Delete / Backspace sets the selected piece aside (not while typing in a field).
      const typing = event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      if ((event.key === "Delete" || event.key === "Backspace") && !typing) {
        event.preventDefault()
        removeSelected()
        return
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault()
        rotateSelected()
        return
      }
      const step = event.shiftKey ? 10 : 1
      const delta =
        event.key === "ArrowLeft"
          ? { x: -step, y: 0, z: 0 }
          : event.key === "ArrowRight"
            ? { x: step, y: 0, z: 0 }
            : event.key === "ArrowUp"
              ? { x: 0, y: -step, z: 0 }
              : event.key === "ArrowDown"
                ? { x: 0, y: step, z: 0 }
                : null
      if (!delta) return
      event.preventDefault()
      const placed = tryPlaceItem({ ...current, x: current.x + delta.x, y: current.y + delta.y, z: current.z + delta.z }, items, unit, supportRatio())
      if (!placed) {
        toast.error("That move is not valid here.")
        setFlashItem(current)
        window.setTimeout(() => setFlashItem(null), 300)
        return
      }
      commitItems(items.map((item) => (item.id === current.id ? placed : item)))
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener("keydown", onKey)
    }
  }, [commitItems, items, playground, removeSelected, rotateSelected, selectedId, undoLayout, unit])

  async function saveLayout() {
    if (!canEdit) return
    if (aside.length > 0) {
      toast.error("Add the set-aside pieces back before saving, so none go missing from the plan.")
      return
    }
    if (violations.length > 0) {
      toast.error("Some pieces break their handling clearance (shown in red). Move them, or change the clearance, before saving.")
      return
    }
    setSaving(true)
    const result = await savePlanLayout(
      projectId,
      items.map((item) => ({
        cargoId: item.cargoId,
        instanceIndex: instanceIndexOf(item),
        x: item.x,
        y: item.y,
        z: item.z,
        lengthCm: item.lengthCm,
        widthCm: item.widthCm,
        heightCm: item.heightCm,
        rotation: item.rotation,
      })),
      { minSupportPct: editorSettings.minSupportPct, clearanceChanges, ...(defaultPending ? { defaultCm: pendingDefault ?? undefined } : {}) },
    )
    setSaving(false)
    if (!result.ok) {
      setServerViolations(result.violations.filter((entry) => entry.unitIndex === unit.unitIndex).map((entry) => entry.id))
      toast.error(result.error)
      return
    }
    setServerViolations([])
    const settingsChanged = clearanceChanges.length > 0 || defaultPending
    toast.success(settingsChanged ? "Layout and clearance settings saved." : "Layout saved.")
    setPendingDefault(null)
    onSaved(items, result, settingsChanged)
  }

  const tools = (
    <>
      {(["iso", "top", "side", "front"] as const).map((entry) => (
        <Button
          key={entry}
          type="button"
          size="sm"
          variant={view === entry ? "default" : "outline"}
          onClick={() => setView(entry)}
        >
          {entry === "iso" ? "Iso" : entry === "top" ? "Top" : entry === "side" ? "Right" : "Front"}
        </Button>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={rotateSelected} disabled={!selected}>
        Rotate 90°
      </Button>
      {hasClearance ? (
        <Button
          type="button"
          size="sm"
          variant={showClearance ? "default" : "outline"}
          aria-pressed={showClearance}
          onClick={() => setShowClearance((on) => !on)}
          title="Show the handling space reserved around each piece (amber), as wide as that piece's own clearance on each side. Neighbouring spaces may overlap on purpose: neighbours share the gap between them."
        >
          Clearance
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={removeSelected}
        disabled={!selected}
        title="Take the selected piece out of the container for now. Add it back from the left panel. (Delete key)"
      >
        Remove
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={undoLayout} disabled={history.length === 0}>
        Undo
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setItems(unit.items)
          setAside([])
          setHistory([])
          setServerViolations([])
          setPendingDefault(null)
          onDraftDiscarded()
        }}
      >
        Reset layout
      </Button>
      {canEdit ? (
        <Button
          type="button"
          size="sm"
          onClick={() => void saveLayout()}
          disabled={!dirty || saving || aside.length > 0}
          title={aside.length > 0 ? "Add the set-aside pieces back first" : undefined}
        >
          {saving ? "Saving…" : "Save layout"}
        </Button>
      ) : null}
    </>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            Unit {unitNumber} of {unitCount}
          </p>
          <h2 className="text-base font-semibold">{unit.equipmentName}</h2>
        </div>
        <dl className="flex flex-wrap gap-2 text-sm">
          {(() => {
            // Saved numbers when nothing was changed, the live recalculation while editing. Both come
            // from the same function, so they agree for the same layout.
            const edited = dirty ? " (edited)" : ""
            const m = dirty
              ? live
              : {
                  netKg: unit.netKg,
                  weightPct: unit.weightPct,
                  volumeM3: unit.volumeM3,
                  volumePct: unit.volumePct,
                  floorActualPct: unit.floorActualPct,
                  floorEffectivePct: unit.floorEffectivePct,
                  remainingKg: unit.remainingKg,
                  remainingM3: unit.remainingM3,
                }
            return (
              <>
                <Metric label={`Weight${edited}`} value={`${formatKg(m.netKg)} · ${formatPct(m.weightPct)}`} />
                <Metric label={`Volume${edited}`} value={`${formatM3(m.volumeM3)} · ${formatPct(m.volumePct)}`} />
                <Metric label={`Actual floor${edited}`} value={formatPct(m.floorActualPct)} title={ACTUAL_FLOOR_HELP} />
                <Metric
                  label={`Effective floor${edited}`}
                  value={formatPct(m.floorEffectivePct)}
                  title={EFFECTIVE_FLOOR_HELP}
                />
                <Metric
                  label={`Remaining${edited}`}
                  value={`${formatKg(m.remainingKg)} · ${formatM3(m.remainingM3)}`}
                  title="Payload and volume still free in this unit. A negative weight means the payload limit is exceeded."
                />
              </>
            )
          })()}
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2">
        <Button type="button" size="sm" onClick={() => setPlayground(true)}>
          Playground
        </Button>
        {dirty && canEdit && aside.length === 0 ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void saveLayout()} disabled={saving}>
            {saving ? "Saving…" : "Save layout"}
          </Button>
        ) : null}
        <p className={cn("text-xs", aside.length > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {aside.length > 0
            ? `${aside.length} piece${aside.length === 1 ? " is" : "s are"} set aside. Open the playground to add ${aside.length === 1 ? "it" : "them"} back before saving.`
            : dirty
              ? "Layout changed. Save to keep it."
              : "Open playground to move cargo."}
        </p>
      </div>

      {/* Portalled to <body> so no parent style (animations, transforms, overflow) can trap the full-screen view. */}
      {playground && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
            <p className="mr-2 text-sm font-semibold">
              {unitNumber}. {unit.equipmentName}
            </p>
            {tools}
            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setPlayground(false)}>
              Exit
            </Button>
          </div>
          <div className="border-b bg-card px-4 py-2">
            <DragSettingsPanel />
          </div>
          {clearanceChanges.length > 0 || defaultPending ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="status">
              <span className="font-medium">Unsaved clearance changes (a draft).</span>
              <span>
                {describeProposedChange({ defaultCm: defaultPending ? pendingDefault ?? undefined : undefined, lines: clearanceChanges }, cargo, projectDefault)
                  .slice(0, 3)
                  .join(" · ")}
              </span>
              <span>They apply to the whole project once you save the layout. Reset layout discards them.</span>
            </div>
          ) : null}
          <PlaygroundStats metrics={live} projectDefault={effectiveDefault} defaultPending={defaultPending} />
          <div className="flex min-h-0 flex-1">
            <PlaygroundItemList
              items={items}
              aside={aside}
              cargo={cargo}
              projectDefault={projectDefault}
              violatingIds={violatingIds}
              canEdit={canEdit}
              onEditClearance={setEditingLineId}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAddBack={(id) => addBack([id])}
              onAddAllBack={() => addBack(aside.map((entry) => entry.id))}
            />
            <div className="relative flex min-h-0 min-w-0 flex-1">
              <LoadViewer
                unit={liveUnit}
                camera={view}
                playground
                showClearance={showClearance}
                violationIds={[...violatingIds]}
                selectedId={selectedId}
                flashItem={flashItem}
                onSelect={setSelectedId}
                onItemsChange={commitItems}
                onDropPiece={placeAsideAt}
                onDragActive={(active) => {
                  dragging.current = active
                }}
                className="min-h-0 min-w-0 flex-1 bg-white"
              />
              <ClearanceLegend
                visible={showClearance || violatingIds.size > 0 || Boolean(selected && (selected.clearanceCm ?? 0) > 0)}
                violations={violations.length}
                manual={layoutSource === "MANUAL"}
              />
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {editingLineId ? (
        <ClearanceEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingLineId(null)
          }}
          line={lineForEditor(cargo, [...items, ...aside], editingLineId)}
          setting={[...items, ...aside].find((item) => item.cargoId === editingLineId)?.clearanceSetting ?? null}
          projectDefault={effectiveDefault}
          applyLabel="Apply to layout"
          scopeNote={`A change here applies to every piece of this cargo line (${lineForEditor(cargo, [...items, ...aside], editingLineId).quantity}), in every unit. Nothing moves: your layout is re-checked, and the change is saved together with the layout.`}
          onApply={(setting) => applyLineClearance(editingLineId, setting)}
        />
      ) : null}

      {/* While the playground is open, its own 3D view replaces this one: only one live 3D scene at a time. */}
      {playground ? (
        <div className="flex h-[32rem] items-center justify-center rounded-md border border-dashed bg-card text-sm text-muted-foreground">
          Editing in the playground…
        </div>
      ) : (
        <LoadViewer
          unit={liveUnit}
          camera={view}
          selectedId={selectedId}
          onSelect={setSelectedId}
          className="h-[32rem] overflow-hidden rounded-md border bg-white"
        />
      )}

      {/* Flat 2D drawings (no WebGL): instant even for hundreds of pieces. Click one to turn the 3D camera to match. */}
      <div className="grid gap-3 md:grid-cols-3">
        {(
          [
            ["top", "top", "Top"],
            ["side", "side", "Right side"],
            ["front", "front", "From the doors"],
          ] as const
        ).map(([camera, diagram, label]) => (
          <button
            key={camera}
            type="button"
            aria-pressed={view === camera}
            className={cn(
              "flex h-36 flex-col overflow-hidden rounded-xl border bg-white text-left hover:border-primary/60",
              view === camera && "ring-2 ring-primary",
            )}
            onClick={() => setView(camera)}
          >
            <p className="px-2 pt-1 text-xs text-neutral-500">{label}</p>
            <PlanDiagram unit={liveUnit} view={diagram} bare className="min-h-0 w-full flex-1" />
          </button>
        ))}
      </div>

      {unit.axleLoads.length > 0 ? (
        <ul className="grid gap-2 rounded-md border bg-card p-3 text-sm sm:grid-cols-2" title={AXLE_ESTIMATE_NOTE}>
          {unit.axleLoads.map((axle) => (
            <li key={axle.name} className={cn("flex justify-between", axle.kg > axle.maxKg && "text-destructive")}>
              <span>{axle.name}</span>
              <span>
                {formatKg(axle.kg)} / {formatKg(axle.maxKg)}
              </span>
            </li>
          ))}
          <li className="text-xs text-muted-foreground sm:col-span-2">{AXLE_ESTIMATE_NOTE}</li>
        </ul>
      ) : null}

      {(warnings.length > 0 || unloaded.length > 0) && (
        <div className="rounded-md border bg-card p-3 text-sm">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <UnloadedList unloaded={unloaded} onEditStep={onEditStep} />
        </div>
      )}

      <div className="overflow-hidden rounded-md border bg-card">
        <table className="sheet-table w-full text-left text-sm">
          <thead className="bg-muted/70 text-xs tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 normal-case">{lengthTitle("L", lengthUnit)}</th>
              <th className="px-3 py-2 normal-case">{lengthTitle("W", lengthUnit)}</th>
              <th className="px-3 py-2 normal-case">{lengthTitle("H", lengthUnit)}</th>
              <th className="px-3 py-2 normal-case">kg / piece</th>
            </tr>
          </thead>
          <tbody>
            {loadOrder({ ...unit, items }).map((item, order) => {
              // The same values, in the same form, as the cargo table in step 1.
              const values = pieceValues(item, enteredCargo, { planCurrent })
              return (
                <tr
                  key={item.id}
                  className={cn("cursor-pointer", selectedId === item.id && "bg-secondary/70")}
                  onClick={() => setSelectedId(item.id)}
                >
                  <td className="px-3 py-2">{order + 1}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{values.sku ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: item.color }} />
                    {values.name}
                    {values.turned ? (
                      <span
                        className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                        title={turnedTitle(item, values.facing, lengthUnit)}
                      >
                        Turned
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatEnteredLength(values.lengthCm, lengthUnit)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatEnteredLength(values.widthCm, lengthUnit)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatEnteredLength(values.heightCm, lengthUnit)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatEnteredWeight(values.weightKg)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** What the clearance editor needs for a line: from the cargo list when it is there, else from a piece of it. */
function lineForEditor(cargo: CargoLine[], pieces: PlanItemView[], cargoId: string) {
  const line = cargo.find((entry) => entry.id === cargoId)
  const piece = pieces.find((entry) => entry.cargoId === cargoId)
  return {
    id: cargoId,
    sku: line?.sku ?? piece?.sku ?? null,
    name: line?.name ?? piece?.name ?? "Cargo line",
    lengthCm: line?.lengthCm ?? piece?.lengthCm ?? 0,
    widthCm: line?.widthCm ?? piece?.widthCm ?? 0,
    heightCm: line?.heightCm ?? piece?.heightCm ?? 0,
    weightKg: line?.weightKg ?? piece?.weightKg ?? 0,
    quantity: line?.quantity ?? pieces.filter((entry) => entry.cargoId === cargoId).length,
  }
}

/** What the amber and blue mean in the 3D view, so the reserved space is not mistaken for cargo. */
function ClearanceLegend({ visible, violations, manual }: { visible: boolean; violations: number; manual: boolean }) {
  if (!visible && !manual) return null
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 max-w-xs space-y-1 rounded-md border bg-card/95 px-2.5 py-2 text-xs shadow-card">
      {visible ? (
        <>
          <p className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm border border-primary bg-primary/30" /> Physical cargo
          </p>
          <p className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm border border-dashed border-amber-500 bg-amber-500/20" /> Reserved handling space
          </p>
          {violations > 0 ? (
            <p className="flex items-center gap-1.5 text-destructive">
              <span className="inline-block size-3 rounded-sm border border-destructive bg-destructive/30" /> Clearance broken ({violations})
            </p>
          ) : null}
          <p className="text-muted-foreground">
            Reserved spaces may overlap: neighbours share the gap between them. They are not packaging and do not hold cargo up.
          </p>
        </>
      ) : null}
      {manual ? <p className="text-muted-foreground">Hand-arranged layout: it is never repacked automatically.</p> : null}
    </div>
  )
}

function PlaygroundItemList({
  items,
  aside,
  cargo,
  projectDefault,
  violatingIds,
  canEdit,
  onEditClearance,
  selectedId,
  onSelect,
  onAddBack,
  onAddAllBack,
}: {
  items: PlanItemView[]
  aside: PlanItemView[]
  cargo: CargoLine[]
  projectDefault: number
  violatingIds: Set<string>
  canEdit: boolean
  onEditClearance: (cargoId: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  onAddBack: (id: string) => void
  onAddAllBack: () => void
}) {
  const lengthUnit = useLengthUnit()
  const rows = items.slice().sort((a, b) => {
    if (a.id === selectedId) return -1
    if (b.id === selectedId) return 1
    return a.sequence - b.sequence
  })

  useEffect(() => {
    if (!selectedId) return
    const node = document.getElementById(`playground-item-${selectedId}`)
    node?.scrollIntoView({ block: "start" })
  }, [selectedId])

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r bg-card">
      {aside.length > 0 ? (
        <div className="border-b bg-amber-50/70 dark:bg-amber-500/10">
          <div className="flex items-center justify-between gap-2 px-3 pt-2">
            <div>
              <p className="text-sm font-medium">Set aside</p>
              <p className="text-xs text-muted-foreground">Drag one into the container, or click Add back</p>
            </div>
            {aside.length > 1 ? (
              <Button type="button" size="sm" variant="outline" className="h-7" onClick={onAddAllBack}>
                Add all back
              </Button>
            ) : null}
          </div>
          <ul className="max-h-48 overflow-auto py-1">
            {aside.map((item) => (
              <li
                key={item.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(PIECE_DRAG_TYPE, item.id)
                  event.dataTransfer.effectAllowed = "move"
                }}
                title="Drag into the container, or click Add back"
                className="flex cursor-grab items-center gap-2.5 px-3 py-1.5 text-sm active:cursor-grabbing"
              >
                <span className="size-3 shrink-0 rounded-sm border opacity-60" style={{ background: item.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatEnvelope(item.lengthCm, item.widthCm, item.heightCm, lengthUnit)}
                  </span>
                </span>
                <Button type="button" size="sm" className="h-7" onClick={() => onAddBack(item.id)}>
                  Add back
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="border-b px-3 py-2">
        <p className="text-sm font-medium">In the container</p>
        <p className="text-xs text-muted-foreground">
          {rows.length} piece{rows.length === 1 ? "" : "s"}. Select one, then Remove (or press Delete) to set it aside.
        </p>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {rows.map((item) => {
          const active = selectedId === item.id
          return (
            <li key={item.id}>
              <button
                id={`playground-item-${item.id}`}
                type="button"
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm",
                  active
                    ? "bg-amber-200 text-neutral-900 hover:bg-amber-200"
                    : "text-foreground hover:bg-muted/70",
                )}
              >
                <span className="mt-0.5 size-3 shrink-0 rounded-sm border" style={{ background: item.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.name}</span>
                  <span className={cn("mt-0.5 block text-xs", active ? "text-neutral-700" : "text-muted-foreground")}>
                    {formatEnvelope(item.lengthCm, item.widthCm, item.heightCm, lengthUnit)}
                  </span>
                  <span className={cn("block text-xs", active ? "text-neutral-700" : "text-muted-foreground")}>
                    {cargo.find((line) => line.id === item.cargoId)?.sku ? `${cargo.find((line) => line.id === item.cargoId)?.sku} · ` : ""}
                    {formatKg(item.weightKg)} · Clearance {describeSetting(item.clearanceSetting ?? null, projectDefault)}
                  </span>
                  {violatingIds.has(item.id) ? (
                    <span className="block text-xs font-medium text-destructive">Breaks its handling clearance</span>
                  ) : null}
                  {active ? (
                    <span className="mt-1 block space-y-1 text-xs text-neutral-800">
                      {item.clearance ? (
                        <span className="block">
                          {typeof item.clearanceSetting === "object" && item.clearanceSetting
                            ? describeSides(item.clearanceSetting)
                            : `${item.clearance.front} cm on every side`}
                        </span>
                      ) : null}
                      <span className="block">
                        Applies to all {cargo.find((line) => line.id === item.cargoId)?.quantity ?? "the"} pieces of this line.
                      </span>
                      {canEdit ? (
                        <span
                          role="button"
                          tabIndex={0}
                          className="inline-flex items-center gap-1 rounded border border-neutral-500 bg-white/70 px-1.5 py-0.5 font-medium hover:bg-white"
                          onClick={(event) => {
                            event.stopPropagation()
                            onEditClearance(item.cargoId)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              event.stopPropagation()
                              onEditClearance(item.cargoId)
                            }
                          }}
                        >
                          <Pencil className="size-3" aria-hidden /> Edit clearance
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function UnloadedList({
  unloaded,
  onEditStep,
}: {
  unloaded: PlanView["unloaded"]
  onEditStep?: (step: "data" | "setup") => void
}) {
  if (unloaded.length === 0) return null
  // Group identical reasons per cargo line so 40 copies of one box read as one row.
  const groups = new Map<string, { name: string; detail: string; count: number }>()
  for (const row of unloaded) {
    const key = `${row.cargoId}|${row.detail}`
    const entry = groups.get(key)
    if (entry) entry.count += 1
    else groups.set(key, { name: row.name, detail: row.detail, count: 1 })
  }
  return (
    <div className="rounded-md border border-destructive/40 bg-card p-3 text-sm" role="alert">
      <p className="font-medium text-destructive">
        {unloaded.length} piece{unloaded.length === 1 ? "" : "s"} did not fit
      </p>
      <ul className="mt-2 space-y-1">
        {[...groups.values()].map((row) => (
          <li key={`${row.name}-${row.detail}`}>
            <span className="font-medium">{row.name}</span>
            {row.count > 1 ? <span className="text-muted-foreground"> ×{row.count}</span> : null}
            <span className="text-muted-foreground">: {row.detail}</span>
          </li>
        ))}
      </ul>
      {onEditStep ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-muted-foreground">To fix it:</span>
          <Button type="button" size="sm" variant="outline" onClick={() => onEditStep("setup")}>
            Add more or larger equipment
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onEditStep("data")}>
            Check cargo sizes and rotation
          </Button>
        </div>
      ) : null}
    </div>
  )
}


function instanceIndexOf(item: PlanItemView): number {
  const prefix = `${item.cargoId}-`
  if (item.id.startsWith(prefix)) {
    const parsed = Number(item.id.slice(prefix.length))
    if (Number.isFinite(parsed)) return parsed
  }
  return Math.max(0, item.sequence - 1)
}

type LayoutSnapshot = { items: PlanItemView[]; aside: PlanItemView[] }

/** Live numbers for the playground: they follow every move, drop, fall, and set-aside. */
function PlaygroundStats({ metrics, projectDefault, defaultPending = false }: { metrics: LiveMetrics; projectDefault: number; defaultPending?: boolean }) {
  const balance = !metrics.cog
    ? "—"
    : Math.abs(metrics.offCentreCm) < 1
      ? "Centred"
      : `${Math.round(Math.abs(metrics.offCentreCm))} cm ${metrics.offCentreCm > 0 ? "right" : "left"}`
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b bg-card px-4 py-2 text-xs" aria-live="polite">
      <Stat
        label="Pieces"
        value={metrics.setAside > 0 ? `${metrics.pieces} loaded · ${metrics.setAside} set aside` : `${metrics.pieces} loaded`}
      />
      <Stat label="Weight" value={`${formatKg(metrics.netKg)} · ${formatPct(metrics.weightPct)}`} />
      <Stat
        label="Remaining"
        value={`${formatKg(metrics.remainingKg)} · ${formatM3(metrics.remainingM3)}`}
        title="Payload and volume still free. A negative weight means the payload limit is exceeded."
      />
      <Stat label="Volume" value={`${formatM3(metrics.volumeM3)} · ${formatPct(metrics.volumePct)}`} />
      <Stat label="Actual floor" value={formatPct(metrics.floorActualPct)} title={ACTUAL_FLOOR_HELP} />
      <Stat label="Effective floor" value={formatPct(metrics.floorEffectivePct)} title={EFFECTIVE_FLOOR_HELP} />
      <Stat
        label="Project allowance"
        value={`${projectDefault > 0 ? `${projectDefault} cm per side` : "none"}${defaultPending ? " (not saved)" : ""}`}
        title="The project's default handling clearance. Individual cargo lines can differ."
      />
      <Stat
        label="Centre of gravity"
        value={metrics.cog ? `${formatPct(metrics.cog.alongPct)} from front · ${balance}` : "—"}
        title="Where the weight balances: distance from the front wall, and how far from the middle of the width"
      />
      {metrics.axleLoads.length > 0 ? (
        <Stat
          label="Axles (estimate)"
          value={metrics.axleLoads.map((axle) => `${axle.name} ${formatKg(axle.kg)} / ${formatKg(axle.maxKg)}`).join(" · ")}
          title={AXLE_ESTIMATE_NOTE}
        />
      ) : null}
      {metrics.warnings.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {metrics.warnings.map((warning) => (
            <li
              key={warning}
              className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
            >
              {warning}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-emerald-700 dark:text-emerald-400">Balanced</span>
      )}
    </div>
  )
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span title={title}>
      <span className="text-muted-foreground">{label} </span>
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  )
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-28 rounded-lg border bg-card px-3 py-2 shadow-card" title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
