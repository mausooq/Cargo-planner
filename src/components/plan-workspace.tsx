"use client"

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react"
import type { PlannerStep } from "@compass/domain"
import Link from "next/link"
import { createPortal } from "react-dom"
import { useTheme } from "next-themes"
import { AlertTriangle, Box, Boxes, Calculator, CheckCircle2, Container, FileSpreadsheet, Gauge as GaugeIcon, Hand, Info, Loader2, Maximize2, Minimize2, Package, Printer, RotateCcw, Save, Scale, ShieldCheck, XCircle } from "lucide-react"
import { resolveMinSupportPct } from "@compass/physics"
import { useEditorSettings } from "@/lib/editor-settings"
import { toast } from "sonner"
import { persistPlan, savePlanLayout } from "@/app/actions/plan"
import { confirmEstimatedWeights } from "@/app/actions/cargo"
import type { CargoLine } from "@/components/cargo-grid"
import { rotationProblem } from "@/lib/layout-validation"
import { isPlannable, linesNeedingWeightConfirmation, plannableLines } from "@/lib/cargo-validation"
import { derivePlanStatus, type PlanStatus } from "@/lib/plan-status"
import { recalculateGuard, type RecalcGuard } from "@/lib/recalc-guard"
import { DragSettingsPanel } from "@/components/drag-settings"
import { LoadViewer, PIECE_DRAG_TYPE, type ViewerCamera } from "@/components/load-viewer"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Gauge, IconTile, SectionCard, StatusPill, SummaryCard, type PillTone } from "@/components/design-system"
import { PlanDiagram } from "@/components/plan-diagram"
import { RemainingCapacityPanel } from "@/components/remaining-capacity"
import { Button } from "@/components/ui/button"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { applyGravity } from "@/lib/cargo-gravity"
import { snapToNeighbours, snapToStack } from "@/lib/cargo-snap"
import { findFreeSpot } from "@/lib/cargo-spot"
import { liveMetrics, type LiveMetrics } from "@/lib/plan-metrics"
import { formatEnteredLength, formatEnteredWeight, lengthTitle, pieceValues, turnedTitle } from "@/lib/plan-piece-values"
import { rotateItemFlat, tryPlaceItem } from "@/lib/cargo-skin"
import { formatEnvelope, formatKg, formatM3, formatPct } from "@/lib/format"
import { lengthCellText, LENGTH_UNIT_SYMBOL } from "@/lib/cargo-units"
import { useLengthUnit } from "@/lib/length-unit-pref"
import { downloadPlanWorkbook, loadOrder } from "@/lib/plan-export"
import { AXLE_ESTIMATE_NOTE, FLOOR_HELP } from "@/lib/plan-notes"
import { toPlanView, withMetrics, type PlanItemView, type PlanUnitView, type PlanView } from "@/lib/plan-view"
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
    /** The project's own minimum support share (percent), when it has one. */
    minSupportPct?: number | null
    initialPlan: PlanView | null
    initialStale?: boolean
    canEdit: boolean
    variant: Extract<PlannerStep, "workspace" | "plan">
    onPlanChange?: (ready: boolean) => void
    /** The plan's status (not calculated, calculating, ready, out of date, failed), one value for every screen. */
    onStatusChange?: (status: PlanStatus) => void
    onEditStep?: (step: Extract<PlannerStep, "data" | "setup">) => void
  }
>(function PlanWorkspace(
  {
    projectId,
    projectName,
    cargo,
    equipment,
    objective,
    minSupportPct = null,
    initialPlan,
    initialStale = false,
    canEdit,
    variant,
    onPlanChange,
    onStatusChange,
    onEditStep,
  },
  ref,
) {
  const [plan, setPlan] = useState<PlanView | null>(initialPlan)
  const [busy, setBusy] = useState(false)
  // True from the moment a calculation starts until it ends, so a second request is ignored.
  const calculating = useRef(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [progressPct, setProgressPct] = useState(0)
  const [selected, setSelected] = useState(0)
  const [layoutDirty, setLayoutDirty] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [pendingUnit, setPendingUnit] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const lengthUnit = useLengthUnit()
  const [stale, setStale] = useState(initialStale)
  const [syncedStale, setSyncedStale] = useState(initialStale)
  if (syncedStale !== initialStale) {
    setSyncedStale(initialStale)
    setStale(initialStale)
  }
  const [calcFailed, setCalcFailed] = useState(false)
  // Asks before a recalculation replaces something the planner arranged: unsaved moves, or a saved hand-arranged layout.
  const [confirmRecalc, setConfirmRecalc] = useState<RecalcGuard>(null)
  const lastError = useRef<string | null>(null)
  // Lines whose weight is still an estimate, waiting for the planner to confirm them before a calculation.
  const [estimateCheck, setEstimateCheck] = useState<CargoLine[] | null>(null)
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

  /**
   * Packs the cargo and saves the plan. Failing at any step leaves the previous plan exactly as it was.
   */
  async function calculate(options: { estimatesConfirmed?: boolean } = {}) {
    if (calculating.current) return false
    lastError.current = null
    setCalcFailed(false)
    if (equipment.length === 0) {
      toast.error("Pick equipment in Setup first.")
      return false
    }
    // A line that is missing its name, a size or its weight (for example a draft from an import) cannot be packed. It is left out, and the planner is told.
    const planned = plannableLines(cargo)
    if (planned.length === 0) {
      toast.error(cargo.length === 0 ? "Add cargo in Data first." : "None of the cargo lines is complete yet. Give each a name, a size and a weight in Data first.")
      return false
    }
    // Estimated weights are fine for a provisional equipment suggestion, but a load plan is only calculated on weights
    // the planner has confirmed: axle loads, payload and stacking all depend on them.
    const estimated = linesNeedingWeightConfirmation(planned)
    if (estimated.length > 0 && !options.estimatesConfirmed) {
      setEstimateCheck(estimated)
      return false
    }
    if (planned.length < cargo.length) {
      const left = cargo.length - planned.length
      toast.warning(`${left} incomplete cargo line${left === 1 ? " was" : "s were"} left out of the plan. Complete ${left === 1 ? "it" : "them"} in Data.`)
    }
    calculating.current = true
    setBusy(true)
    setProgress("Packing…")
    setProgressPct(0)
    // Let the browser paint the progress panel (and drop the old 3D scene) before the work starts.
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    try {
      const result = await runSolver(
        buildSolverInput({ cargo: planned, equipment, objective, minSupportPct }),
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
        planned.map((item) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          weightKg: item.weightKg,
          color: item.color,
          shape: item.shape,
          stackable: item.stackable,
          bottomOnly: item.bottomOnly,
          maxStackLoadKg: item.maxStackLoadKg,
        })),
      )
      const saved = await persistPlan(projectId, result)
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
      calculating.current = false
      setBusy(false)
      setProgress(null)
    }
  }

  /**
   * Recalculating replaces the layout, so it asks first when that would throw away something the planner
   * arranged: moves not saved yet, or a layout saved as hand-arranged.
   */
  function requestRecalculate() {
    const guard = recalculateGuard({ dirty: layoutDirty, layoutSource: plan?.layoutSource, hasPlan: Boolean(plan && plan.units.length > 0) })
    if (guard) setConfirmRecalc(guard)
    else void calculate()
  }

  const hasPlanNow = Boolean(plan && plan.units.length > 0)
  // The plan no longer matches the cargo: its figures are the previous calculation, and the banner offers the recalculation.
  const outOfDate = stale && hasPlanNow
  const planStatus = useMemo(
    () => derivePlanStatus({ hasPlan: hasPlanNow, calculating: busy, stale, failed: calcFailed }),
    [busy, calcFailed, hasPlanNow, stale],
  )
  useEffect(() => {
    onStatusChange?.(planStatus)
  }, [onStatusChange, planStatus])

  useImperativeHandle(ref, () => ({
    calculate: () => calculate(),
    hasPlan: () => Boolean(plan && plan.units.length > 0),
    isDirty: () => canEdit && layoutDirty,
    discardChanges,
  }))

  return (
    <div className="relative min-h-48 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <IconTile icon={variant === "workspace" ? Calculator : Box} tint="mint" size="lg" />
          <div className="min-w-0">
            <h2 className="text-page-title">{variant === "workspace" ? <>Calculate &amp; Optimisation</> : "Final Load Plan"}</h2>
            <p className="mt-1 text-page-desc text-muted-foreground">
              {variant === "workspace"
                ? "Pack the cargo into the selected equipment, check the result and see the space that is left."
                : "The cargo arrangement in 3D, unit by unit, with its utilisation and the details of every piece."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusPill tone={PLAN_TONE[planStatus.tone]}>{planStatus.label}</StatusPill>
          {variant === "plan" && plan && plan.units.length > 0 ? (
            <>
              <Button type="button" variant="outline" className="press h-11 rounded-xl bg-card px-4 text-button shadow-soft" onClick={() => void exportExcel()} disabled={exporting}>
                <FileSpreadsheet className="size-4" />
                {exporting ? "Preparing…" : "Excel"}
              </Button>
              <Button asChild variant="outline" className="press h-11 rounded-xl bg-card px-4 text-button shadow-soft">
                <Link href={`/projects/${projectId}/report`}>
                  <Printer className="size-4" />
                  Print / PDF
                </Link>
              </Button>
            </>
          ) : null}
          {/* One Recalculate button at a time: while the plan is out of date, it lives in the warning banner. */}
          {canEdit && !outOfDate ? (
            <Button
              type="button"
              variant={plan && variant === "plan" ? "outline" : "default"}
              className={cn("press h-11 rounded-xl px-5 text-button shadow-soft", variant === "plan" && "bg-card")}
              onClick={requestRecalculate}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Calculator className="size-4" aria-hidden="true" />}
              {busy ? progress ?? "Calculating…" : plan ? "Recalculate" : "Calculate load plan"}
            </Button>
          ) : null}
        </div>
      </div>

      {outOfDate && plan ? (
        <div
          role="status"
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 border border-amber-500/50 text-amber-900 dark:text-amber-200",
            "pastel-amber rounded-[var(--radius-card)] border-[var(--pc-border)] bg-[var(--pc-bg)] px-4 py-3 text-detail shadow-soft",
          )}
        >
          <span>
            <span className="font-medium">Cargo updated — recalculation required.</span> Recalculate to update your load plan and remaining capacity.
            {plan.layoutSource === "MANUAL" ? " Your hand-arranged layout will be replaced, and you are asked first." : ""}
          </span>
          {canEdit ? (
            <Button type="button" size="sm" className="press h-10 rounded-xl px-4 text-button" onClick={requestRecalculate} disabled={busy} aria-busy={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  {progress ?? "Calculating…"}
                </>
              ) : (
                "Recalculate now"
              )}
            </Button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={estimateCheck !== null}
        onOpenChange={(open) => {
          if (!open) setEstimateCheck(null)
        }}
        title="Confirm the estimated weights?"
        description={
          estimateCheck ? (
            <>
              {estimateCheck.length} cargo line{estimateCheck.length === 1 ? " has" : "s have"} an estimated weight from the import (
              {estimateCheck[0]!.weightEstimate!.basis}). Weight decides payload, axle loads and what may stand on what, so a load plan
              is only calculated on weights you confirm. Cancel to check or correct them in the Cargo step first.
              <span className="mt-2 block text-xs">
                {estimateCheck
                  .slice(0, 6)
                  .map((line) => `${line.sku ? `${line.sku} ` : ""}${line.name}: ${formatKg(line.weightKg)}`)
                  .join(" · ")}
                {estimateCheck.length > 6 ? ` and ${estimateCheck.length - 6} more` : ""}
              </span>
            </>
          ) : null
        }
        confirmLabel="Confirm weights and calculate"
        onConfirm={async () => {
          const lines = estimateCheck ?? []
          const result = await confirmEstimatedWeights(projectId, lines.map((line) => line.id))
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          setEstimateCheck(null)
          void calculate({ estimatesConfirmed: true })
        }}
      />
      <ConfirmDialog
        open={confirmRecalc !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRecalc(null)
        }}
        destructive
        title={confirmRecalc === "manual" ? "Recalculate and replace your hand-arranged layout?" : "Recalculate and discard your layout edits?"}
        description={
          confirmRecalc === "manual"
            ? "You arranged this layout by hand and saved it. A new calculation packs the cargo again and replaces it. Cancel keeps your layout as it is."
            : "You moved cargo by hand and have not saved. A new calculation replaces those moves."
        }
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
        <CalculatingPanel label={progress} pct={progressPct} pieces={cargo.filter(isPlannable).reduce((sum, line) => sum + line.quantity, 0)} />
      ) : !plan || plan.units.length === 0 ? (
        <EmptyPlan unloaded={plan?.unloaded ?? []} canEdit={canEdit} onEditStep={onEditStep} />
      ) : variant === "workspace" ? (
        <>
          {outOfDate ? (
            <p className="flex items-center gap-2 text-meta font-semibold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Previous calculation results, from before the cargo was updated
            </p>
          ) : null}
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <CalcStatusPanel plan={plan} cargo={cargo} status={planStatus} />
            <UtilisationPanel units={plan.units} stale={outOfDate} />
          </div>
          <WorkspaceTable units={plan.units} selected={selectedIndex} onSelect={setSelected} />
          <UnloadedList unloaded={plan.unloaded} onEditStep={onEditStep} />
          <RemainingCapacityPanel plan={plan} cargo={cargo} minSupportPct={minSupportPct} canEdit={canEdit} stale={stale} onAddCargo={onEditStep ? () => onEditStep("data") : undefined} />
        </>
      ) : (
        unit && (
          <>
            {outOfDate ? (
              <p className="flex items-center gap-2 text-meta font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="size-4" aria-hidden="true" />
                Previous calculation results, from before the cargo was updated
              </p>
            ) : null}
            <CalcSummaryCards plan={plan} stale={outOfDate} />
            <UnitPicker units={plan.units} selected={selectedIndex} onSelect={openUnit} />
            <div className="relative">
            <LoadPlanDetail
              key={`${selectedIndex}-${resetKey}`}
              projectId={projectId}
              canEdit={canEdit}
              cargo={cargo}
              unit={unit}
              unitNumber={selectedIndex + 1}
              unitCount={plan.units.length}
              warnings={plan.warnings}
              unloaded={plan.unloaded}
              planUnits={plan.units}
              planCurrent={!stale}
              projectMinSupportPct={minSupportPct}
              layoutSource={plan.layoutSource ?? "AUTO"}
              onEditStep={onEditStep}
              onDirtyChange={setLayoutDirty}
              onSaved={(nextItems, result) => {
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
    <SectionCard banded icon={Container} title="Load calculation results" description="One row per equipment unit. Select a row to look at that unit.">
      <div className="overflow-x-auto">
      <table className="data-table w-full min-w-[56rem] text-left text-sm">
        <thead>
          <tr>
            <th className="px-5">Unit</th>
            <th className="px-4 text-right">Pieces</th>
            <th className="px-4 text-right">Weight</th>
            <th className="px-4 text-right">Volume</th>
            <th className="px-4">Used space</th>
            <th className="px-4 text-right" title={FLOOR_HELP}>
              Floor utilization (%)
            </th>
            <th className="px-5">View</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit, index) => (
            <tr
              key={unit.unitIndex}
              className={cn("cursor-pointer border-t", selected === index && "bg-[var(--pastel-mint-bg)] hover:bg-[var(--pastel-mint-bg)]")}
              onClick={() => onSelect(index)}
            >
              <td className={cn("px-5 py-3 text-[15px] font-semibold", selected === index && "shadow-[inset_3px_0_0_var(--primary)]")}>
                {index + 1}. {unit.equipmentName}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{unit.pieces}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                {formatKg(unit.netKg)} <span className="text-muted-foreground">({formatPct(unit.weightPct)})</span>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                {formatM3(unit.volumeM3)} <span className="text-muted-foreground">({formatPct(unit.volumePct)})</span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                L {lengthCellText(unit.usedLengthCm, lengthUnit)} · W {lengthCellText(unit.usedWidthCm, lengthUnit)} · H{" "}
                {lengthCellText(unit.usedHeightCm, lengthUnit)} {LENGTH_UNIT_SYMBOL[lengthUnit]}
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums" title={FLOOR_HELP}>
                {formatPct(unit.floorPct)}
              </td>
              <td className="px-5 py-3">
                <div className="h-20 w-48 overflow-hidden rounded-lg border border-[var(--table-border)] bg-white">
                  <PlanDiagram unit={unit} view="side" bare className="h-full w-full" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </SectionCard>
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
      <span className="text-label text-muted-foreground">Viewing unit</span>
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
              "press inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-button outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active ? "border-primary bg-primary text-primary-foreground shadow-soft" : "border-white/70 bg-white/70 text-foreground hover:border-primary/50 dark:border-white/10 dark:bg-white/5",
            )}
          >
            <Container className="size-4" aria-hidden="true" />
            {index + 1}. {unit.equipmentName}
            <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20" : "bg-muted text-muted-foreground")}>{unit.pieces}</span>
          </button>
        )
      })}
    </div>
  )
}

function LoadPlanDetail({
  projectId,
  canEdit,
  cargo,
  unit,
  unitNumber,
  unitCount,
  warnings,
  unloaded,
  planUnits,
  planCurrent,
  projectMinSupportPct,
  layoutSource,
  onSaved,
  onEditStep,
  onDirtyChange,
}: {
  projectId: string
  canEdit: boolean
  /** The cargo lines as entered in step 1, so the piece list can show the same values. */
  cargo: CargoLine[]
  unit: PlanUnitView
  unitNumber: number
  unitCount: number
  warnings: string[]
  unloaded: PlanView["unloaded"]
  /** Every unit of the plan, for the overall figures next to this unit's own. */
  planUnits: PlanUnitView[]
  /** False when the saved plan is out of date: the piece list then shows what was calculated, not today's cargo list. */
  planCurrent: boolean
  projectMinSupportPct: number | null
  layoutSource: "AUTO" | "MANUAL"
  onSaved: (items: PlanItemView[], result: Extract<Awaited<ReturnType<typeof savePlanLayout>>, { ok: true }>) => void
  onEditStep?: (step: "data" | "setup") => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const enteredCargo = useMemo(() => new Map(cargo.map((line) => [line.id, line])), [cargo])
  const [synced, setSynced] = useState(unit)
  const [items, setItems] = useState(unit.items)
  const [playground, setPlayground] = useState(false)
  const [view, setView] = useState<ViewerCamera>("iso")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Pieces taken out of the container for now ("Set aside"). They are still part of the plan and
  // can be added back from the playground's left panel; nothing is deleted.
  const [aside, setAside] = useState<PlanItemView[]>([])
  const [history, setHistory] = useState<LayoutSnapshot[]>([])
  const [flashItem, setFlashItem] = useState<PlanItemView | null>(null)
  // Pieces the server named as breaking a rule on the last save attempt (marked in the list until something changes).
  const [serverViolations, setServerViolations] = useState<string[]>([])
  const editorSettings = useEditorSettings()
  const lengthUnit = useLengthUnit()
  const dragging = useRef(false)
  // The 3D scene cannot read CSS variables, so it gets the same neutral as --viewer-bg from the theme. Only the
  // canvas uses this (it is drawn in the browser only); page elements use the CSS variable, so server and browser agree.
  const { resolvedTheme } = useTheme()
  const viewerBg = resolvedTheme === "dark" ? "#1b2128" : "#edf2f4"
  const viewport = useRef<HTMLDivElement>(null)
  // Bumping the key remounts the viewer, which puts the camera back where it starts.
  const [cameraKey, setCameraKey] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === viewport.current && viewport.current !== null)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
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
  const selected = items.find((item) => item.id === selectedId) ?? null
  const violatingIds = useMemo(() => new Set<string>(serverViolations), [serverViolations])
  const dirty = aside.length > 0 || items.some((item) => {
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
      { minSupportPct: editorSettings.minSupportPct },
    )
    setSaving(false)
    if (!result.ok) {
      setServerViolations(result.violations.filter((entry) => entry.unitIndex === unit.unitIndex).map((entry) => entry.id))
      toast.error(result.error)
      return
    }
    setServerViolations([])
    toast.success("Layout saved.")
    onSaved(items, result)
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

  // Saved numbers when nothing was changed, the live recalculation while editing. Both come from the same
  // function, so they agree for the same layout.
  const edited = dirty ? " (edited)" : ""
  const m = dirty
    ? live
    : { netKg: unit.netKg, weightPct: unit.weightPct, volumeM3: unit.volumeM3, volumePct: unit.volumePct, floorPct: unit.floorPct, remainingKg: unit.remainingKg, remainingM3: unit.remainingM3 }
  const unitM3 = (unit.lengthCm * unit.widthCm * unit.heightCm) / 1_000_000
  const unitM2 = (unit.lengthCm * unit.widthCm) / 10_000
  const loadedAll = planUnits.reduce((sum, entry) => sum + entry.pieces, 0)
  const requestedAll = loadedAll + unloaded.length
  const findings: { tone: "warning" | "danger"; text: string }[] = []
  if (!planCurrent) findings.push({ tone: "warning", text: "Out of date: the cargo changed after this calculation. Recalculate on the Calculate step." })
  if (unloaded.length > 0) findings.push({ tone: "danger", text: `${unloaded.length} of ${requestedAll} pieces could not be loaded.` })
  for (const warning of warnings) findings.push({ tone: "warning", text: warning })
  if (dirty) findings.push({ tone: "warning", text: aside.length > 0 ? `${aside.length} piece${aside.length === 1 ? " is" : "s are"} set aside in the playground.` : "The layout was changed and is not saved yet." })
  const complete = findings.length === 0
  const cameras = [
    ["iso", "3D view"],
    ["top", "Top"],
    ["side", "Right side"],
    ["front", "Front"],
  ] as const

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void viewport.current?.requestFullscreen?.()
  }

  return (
    <div className="space-y-5">
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
          <PlaygroundStats metrics={live} />
          <div className="flex min-h-0 flex-1">
            <PlaygroundItemList
              items={items}
              aside={aside}
              cargo={cargo}
              violatingIds={violatingIds}
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
              {layoutSource === "MANUAL" ? <ManualLayoutNote /> : null}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        {/* The 3D view: the main focus of the step. */}
        <section aria-label={`3D view of ${unit.equipmentName}`} className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--suggest-border)] shadow-soft" style={{ background: "var(--util-bg)" }}>
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-3">
            <div className="flex rounded-xl border border-white/70 bg-white/60 p-1 dark:border-white/10 dark:bg-white/5" role="group" aria-label="Camera">
              {cameras.map(([camera, label]) => (
                <button
                  key={camera}
                  type="button"
                  aria-pressed={view === camera}
                  onClick={() => setView(camera)}
                  className={cn(
                    "press h-8 rounded-lg px-3 text-[13px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    view === camera ? "bg-primary text-primary-foreground shadow-soft" : "text-[var(--table-head-fg)] hover:bg-white/80 dark:hover:bg-white/10",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="press size-9 rounded-xl bg-white/70 dark:bg-white/5" onClick={() => {
                setView("iso")
                setCameraKey((key) => key + 1)
              }} aria-label="Reset the camera" title="Reset the camera">
                <RotateCcw className="size-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" className="press size-9 rounded-xl bg-white/70 dark:bg-white/5" onClick={toggleFullscreen} disabled={playground} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
                {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </Button>
              <Button type="button" className="press h-9 rounded-xl px-4 text-button shadow-soft" onClick={() => setPlayground(true)}>
                <Hand className="size-4" />
                Playground
              </Button>
              {dirty && canEdit && aside.length === 0 ? (
                <Button type="button" variant="outline" className="press h-9 rounded-xl bg-card px-4 text-button" onClick={() => void saveLayout()} disabled={saving}>
                  <Save className="size-4" />
                  {saving ? "Saving…" : "Save layout"}
                </Button>
              ) : null}
            </div>
          </div>

          {/* While the playground is open, its own 3D view replaces this one: only one live 3D scene at a time. */}
          <div ref={viewport} className={cn("relative mx-3 overflow-hidden rounded-xl border border-white/70 dark:border-white/10", fullscreen ? "h-screen" : "h-[36rem]")} style={{ background: "var(--viewer-bg)" }}>
            {playground ? (
              <div className="flex h-full items-center justify-center text-detail text-muted-foreground">Editing in the playground…</div>
            ) : (
              <LoadViewer key={cameraKey} unit={liveUnit} camera={view} selectedId={selectedId} onSelect={setSelectedId} background={viewerBg} className="h-full w-full" />
            )}
            {fullscreen ? (
              <Button type="button" variant="outline" className="absolute top-3 right-3 h-9 rounded-xl bg-card/90 px-3 text-button" onClick={toggleFullscreen}>
                <Minimize2 className="size-4" />
                Exit fullscreen
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-3 text-meta">
            <span className="flex items-center gap-2">
              <span className="size-3.5 rounded-sm bg-primary/80" aria-hidden="true" />
              In this unit ({items.length})
            </span>
            {aside.length > 0 ? (
              <span className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <span className="size-3.5 rounded-sm border-2 border-dashed border-amber-500" aria-hidden="true" />
                Set aside ({aside.length})
              </span>
            ) : null}
            <span className={cn("flex items-center gap-2", unloaded.length > 0 && "font-semibold text-red-700 dark:text-red-400")}>
              <span className="size-3.5 rounded-sm bg-[var(--step-line)]" aria-hidden="true" />
              Not loaded ({unloaded.length})
            </span>
            <span className="ml-auto text-muted-foreground">Drag to rotate · scroll to zoom · click a piece to select it</span>
          </div>
          <p className={cn("border-t border-white/60 px-4 py-2.5 text-meta dark:border-white/10", aside.length > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
            {aside.length > 0
              ? `${aside.length} piece${aside.length === 1 ? " is" : "s are"} set aside. Open the playground to add ${aside.length === 1 ? "it" : "them"} back before saving.`
              : dirty
                ? "Layout changed. Save to keep it."
                : layoutSource === "MANUAL"
                  ? "Hand-arranged layout: it is not repacked automatically. Open playground to move cargo."
                  : "Open playground to move cargo."}
          </p>
        </section>

        {/* Load summary: this unit's figures, with the plan's state. */}
        <aside aria-label="Load summary" className="space-y-4 rounded-[var(--radius-card)] border border-[var(--suggest-border)] p-4 shadow-soft" style={{ background: "var(--util-bg)" }}>
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/75 text-[var(--table-head-fg)] shadow-soft dark:bg-white/10">
              <Container className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[17px] leading-6 font-bold text-[var(--table-head-fg)]">Load summary</h3>
              <p className="text-meta text-[var(--table-head-fg)]/80">
                Unit {unitNumber} of {unitCount}: {unit.equipmentName}
              </p>
            </div>
          </div>

          {complete ? (
            <div className="pastel-mint flex items-start gap-2.5 rounded-xl border border-[var(--pc-border)] bg-[var(--pc-bg)] px-3.5 py-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--pc-accent)]" aria-hidden="true" />
              <div>
                <p className="text-[15px] font-bold text-[var(--pc-accent)]">Load plan is complete</p>
                <p className="text-meta text-muted-foreground">All {requestedAll} requested pieces are loaded, with no warnings.</p>
              </div>
            </div>
          ) : (
            <ul className={cn("space-y-1.5 rounded-xl border px-3.5 py-3", findings.some((entry) => entry.tone === "danger") ? "border-[var(--status-bad-border)]" : "border-[var(--status-warn-border)]")} style={{ background: findings.some((entry) => entry.tone === "danger") ? "var(--status-bad-bg)" : "var(--status-warn-bg)" }}>
              {findings.map((finding, index) => (
                <li key={`${finding.text}-${index}`} className="flex items-start gap-2 text-meta">
                  {finding.tone === "danger" ? <XCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
                  <span>{finding.text}</span>
                </li>
              ))}
            </ul>
          )}

          <dl className="divide-y divide-white/70 rounded-xl bg-white/45 text-detail dark:divide-white/10 dark:bg-white/5">
            {(
              [
                ["Equipment", `${unit.equipmentName}`],
                ["Pieces in this unit", `${items.length}`],
                ["Loaded, whole plan", `${loadedAll} / ${requestedAll}`],
                [`Gross weight${edited}`, formatKg(m.netKg)],
                [`Cargo volume${edited}`, formatM3(m.volumeM3)],
                [`Remaining${edited}`, `${formatKg(m.remainingKg)} · ${formatM3(m.remainingM3)}`],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 px-3.5 py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className={cn("text-right font-semibold tabular-nums", label === "Loaded, whole plan" && unloaded.length > 0 && "text-red-700 dark:text-red-400")}>{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <p className="mb-2 text-label text-[var(--table-head-fg)]">This unit&apos;s utilisation{edited}</p>
            <div className="grid grid-cols-3 gap-2">
              <GaugeSurface tone="lavender" compact>
                <Gauge accent="var(--pastel-lavender-accent)" track="var(--gauge-weight-track)" compact label="Weight" pct={m.weightPct} used={formatKg(m.netKg)} total={formatKg(unit.maxPayloadKg)} />
              </GaugeSurface>
              <GaugeSurface tone="blue" compact>
                <Gauge accent="var(--pastel-blue-accent)" track="var(--gauge-volume-track)" compact label="Volume" pct={m.volumePct} used={formatM3(m.volumeM3)} total={formatM3(unitM3)} />
              </GaugeSurface>
              <GaugeSurface tone="mint" compact>
                <Gauge accent="var(--pastel-mint-accent)" track="var(--gauge-floor-track)" compact label="Floor" pct={m.floorPct} used={`${((m.floorPct / 100) * unitM2).toLocaleString("en-US", { maximumFractionDigits: 1 })} m²`} total={`${unitM2.toLocaleString("en-US", { maximumFractionDigits: 1 })} m²`} />
              </GaugeSurface>
            </div>
            {planUnits.length > 1 ? <p className="mt-2 text-xs text-muted-foreground">For this unit only. The Calculate step shows all units combined.</p> : null}
          </div>

          {unit.axleLoads.length > 0 ? (
            <div title={AXLE_ESTIMATE_NOTE}>
              <p className="mb-1.5 text-label text-[var(--table-head-fg)]">Estimated axle loads</p>
              <ul className="divide-y divide-white/70 rounded-xl bg-white/45 text-meta dark:divide-white/10 dark:bg-white/5">
                {unit.axleLoads.map((axle) => (
                  <li key={axle.name} className={cn("flex justify-between px-3.5 py-2", axle.kg > axle.maxKg && "font-semibold text-destructive")}>
                    <span>{axle.name}</span>
                    <span className="tabular-nums">
                      {formatKg(axle.kg)} / {formatKg(axle.maxKg)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">{AXLE_ESTIMATE_NOTE}</p>
            </div>
          ) : null}
        </aside>
      </div>

      {/* Flat 2D drawings (no WebGL): instant even for hundreds of pieces. Click one to turn the 3D camera to match. */}
      <div className="grid gap-4 md:grid-cols-3">
        {(
          [
            ["top", "top", "Top view"],
            ["side", "side", "Right side view"],
            ["front", "front", "View from the doors"],
          ] as const
        ).map(([camera, diagram, label]) => (
          <button
            key={camera}
            type="button"
            aria-pressed={view === camera}
            title="Show this view in 3D"
            className={cn(
              "flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--table-border)] bg-card text-left shadow-soft outline-none transition-[box-shadow,border-color] duration-200 ease-out hover:border-primary/50 hover:shadow-lift focus-visible:ring-[3px] focus-visible:ring-ring/40",
              view === camera && "border-primary ring-2 ring-primary/30",
            )}
            onClick={() => setView(camera)}
          >
            <span className="bg-table-head flex items-center justify-between border-b border-[var(--table-border)] px-4 py-2.5 text-[14px] font-bold text-[var(--table-head-fg)]">
              {label}
              {view === camera ? <span className="text-xs font-semibold text-primary dark:text-[var(--step-done-fg)]">In 3D view</span> : null}
            </span>
            <span className="flex h-44 items-center p-2" style={{ background: "var(--viewer-bg)" }}>
              <PlanDiagram unit={liveUnit} view={diagram} bare className="max-h-full min-h-0 w-full" />
            </span>
          </button>
        ))}
      </div>

      {unloaded.length > 0 ? <UnloadedList unloaded={unloaded} onEditStep={onEditStep} /> : null}

      <SectionCard banded icon={Package} title={`Cargo in ${unit.equipmentName} · loading order`} description="Click a row to select the piece in the 3D view; click a piece to find its row.">
        <div className="max-h-[32rem] overflow-auto">
          <table className="data-table w-full min-w-[48rem] text-left text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="px-4 text-right">#</th>
                <th className="px-4">SKU</th>
                <th className="px-4">Name</th>
                <th className="px-4 text-right normal-case">{lengthTitle("L", lengthUnit)}</th>
                <th className="px-4 text-right normal-case">{lengthTitle("W", lengthUnit)}</th>
                <th className="px-4 text-right normal-case">{lengthTitle("H", lengthUnit)}</th>
                <th className="px-4 text-right normal-case">kg / piece</th>
              </tr>
            </thead>
            <tbody>
              {loadOrder({ ...unit, items }).map((item, order) => {
                // The same values, in the same form, as the cargo table in step 1.
                const values = pieceValues(item, enteredCargo, { planCurrent })
                const chosen = selectedId === item.id
                return (
                  <tr
                    key={item.id}
                    className={cn("cursor-pointer border-t", chosen && "bg-[var(--pastel-mint-bg)] hover:bg-[var(--pastel-mint-bg)]")}
                    onClick={() => setSelectedId(item.id)}
                    aria-selected={chosen}
                  >
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", chosen && "shadow-[inset_3px_0_0_var(--primary)]")}>{order + 1}</td>
                    <td className="px-4 py-2.5 font-semibold whitespace-nowrap">{values.sku ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: item.color }} />
                      {values.name}
                      {values.turned ? (
                        <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" title={turnedTitle(item, values.facing, lengthUnit)}>
                          Turned
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatEnteredLength(values.lengthCm, lengthUnit)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatEnteredLength(values.widthCm, lengthUnit)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatEnteredLength(values.heightCm, lengthUnit)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatEnteredWeight(values.weightKg)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}

/** Says the layout was arranged by hand, so nobody expects a recalculation to keep it. */
function ManualLayoutNote() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 max-w-xs rounded-md border bg-card/95 px-2.5 py-2 text-xs text-muted-foreground shadow-card">
      Hand-arranged layout: it is never repacked automatically.
    </div>
  )
}

function PlaygroundItemList({
  items,
  aside,
  cargo,
  violatingIds,
  selectedId,
  onSelect,
  onAddBack,
  onAddAllBack,
}: {
  items: PlanItemView[]
  aside: PlanItemView[]
  cargo: CargoLine[]
  /** Pieces the server named when it refused to save the layout. */
  violatingIds: Set<string>
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
                    {formatKg(item.weightKg)}
                  </span>
                  {violatingIds.has(item.id) ? (
                    <span className="block text-xs font-medium text-destructive">Not accepted when saving: see the message</span>
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
    <div className="rounded-[var(--radius-card)] border border-destructive/40 bg-card p-4 text-detail shadow-soft" role="alert">
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
function PlaygroundStats({ metrics }: { metrics: LiveMetrics }) {
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
      <Stat label="Floor utilization" value={formatPct(metrics.floorPct)} title={FLOOR_HELP} />
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

const PLAN_TONE: Record<PlanStatus["tone"], PillTone> = { neutral: "neutral", action: "info", warning: "warning", success: "success", danger: "warning" }

/** The calculation in four figures, from the plan as it is (requested pieces are the loaded ones plus those that did not fit). */
function CalcSummaryCards({ plan, stale }: { plan: PlanView; stale: boolean }) {
  const loaded = plan.units.reduce((sum, unit) => sum + unit.pieces, 0)
  const requested = loaded + plan.unloaded.length
  const kg = plan.units.reduce((sum, unit) => sum + unit.netKg, 0)
  const payload = plan.units.reduce((sum, unit) => sum + unit.maxPayloadKg, 0)
  const volume = plan.units.reduce((sum, unit) => sum + unit.volumeM3, 0)
  const capacity = plan.units.reduce((sum, unit) => sum + (unit.lengthCm * unit.widthCm * unit.heightCm) / 1_000_000, 0)
  const types = new Map<string, number>()
  for (const unit of plan.units) types.set(unit.equipmentName, (types.get(unit.equipmentName) ?? 0) + 1)
  const previous = stale ? " · previous calculation" : ""
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        icon={Package}
        tint="mint"
        label="Loaded packages"
        value={`${loaded.toLocaleString("en-US")} / ${requested.toLocaleString("en-US")}`}
        hint={plan.unloaded.length > 0 ? `${plan.unloaded.length} not loaded${previous}` : `All requested pieces loaded${previous}`}
        tone={plan.unloaded.length > 0 ? "danger" : stale ? "warning" : "neutral"}
      />
      <SummaryCard icon={Scale} tint="lavender" label="Loaded gross weight" value={formatKg(kg)} hint={`of ${formatKg(payload)} payload${previous}`} tone={stale ? "warning" : "neutral"} />
      <SummaryCard icon={Boxes} tint="blue" label="Loaded cargo volume" value={formatM3(volume)} hint={`of ${formatM3(capacity)} inside volume${previous}`} tone={stale ? "warning" : "neutral"} />
      <SummaryCard
        icon={Container}
        tint="amber"
        label="Equipment units used"
        value={plan.units.length}
        hint={`${[...types.entries()].map(([name, count]) => `${count} × ${name}`).join(", ")}${previous}`}
        tone={stale ? "warning" : "neutral"}
      />
    </div>
  )
}

type StatusRow = { tone: "success" | "warning" | "danger" | "info"; text: string }

const ROW_ICON = { success: CheckCircle2, warning: AlertTriangle, danger: XCircle, info: Info } as const
const ROW_COLOUR = {
  success: "text-primary dark:text-[var(--step-done-fg)]",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
  info: "text-[var(--pastel-blue-accent)]",
} as const

/** What the app actually knows about this calculation: its status, unloaded pieces, solver warnings and provisional inputs. */
function CalcStatusPanel({ plan, cargo, status }: { plan: PlanView; cargo: CargoLine[]; status: PlanStatus }) {
  const loaded = plan.units.reduce((sum, unit) => sum + unit.pieces, 0)
  const estimated = linesNeedingWeightConfirmation(cargo).length
  const stacking = cargo.filter((line) => line.stackableNotStated && !line.stackable).length
  const incomplete = cargo.filter((line) => !isPlannable(line)).length
  const rows: StatusRow[] = []
  if (status.kind === "ready") rows.push({ tone: "success", text: "The plan matches the current cargo and equipment." })
  else if (status.kind === "out-of-date") rows.push({ tone: "warning", text: "The cargo changed after this calculation. These are the previous results." })
  else if (status.kind === "failed") rows.push({ tone: "danger", text: "The last calculation failed. The results shown are from an earlier run." })
  else if (status.kind === "calculating") rows.push({ tone: "info", text: "Calculating…" })
  rows.push(
    plan.unloaded.length > 0
      ? { tone: "danger", text: `${plan.unloaded.length} of ${loaded + plan.unloaded.length} pieces could not be loaded (see below).` }
      : { tone: "success", text: `All ${loaded} pieces are loaded.` },
  )
  for (const warning of plan.warnings) rows.push({ tone: "warning", text: warning })
  if (estimated > 0) rows.push({ tone: "warning", text: `${estimated} cargo line${estimated === 1 ? " uses an estimated weight" : "s use estimated weights"}: the result is provisional.` })
  if (incomplete > 0) rows.push({ tone: "warning", text: `${incomplete} incomplete cargo line${incomplete === 1 ? " was" : "s were"} left out of the plan.` })
  if (stacking > 0) rows.push({ tone: "info", text: `Stacking is not stated for ${stacking} line${stacking === 1 ? "" : "s"}; nothing is stacked on ${stacking === 1 ? "it" : "them"}.` })
  if (plan.layoutSource === "MANUAL") rows.push({ tone: "info", text: "The layout was arranged by hand on the Load plan step." })
  const worst = rows.some((row) => row.tone === "danger") ? "danger" : rows.some((row) => row.tone === "warning") ? "warning" : "success"
  const issues = rows.filter((row) => row.tone === "danger" || row.tone === "warning").length
  const surface = worst === "danger" ? "bad" : worst === "warning" ? "warn" : "ok"
  return (
    <section
      aria-label="Calculation status"
      className="overflow-hidden rounded-[var(--radius-card)] border shadow-soft"
      style={{ background: `var(--status-${surface}-bg)`, borderColor: `var(--status-${surface}-border)` }}
    >
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/75 text-[var(--table-head-fg)] shadow-soft dark:bg-white/10">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] leading-6 font-bold text-[var(--table-head-fg)]">Calculation status</h3>
          <p className="text-meta text-[var(--table-head-fg)]/80">What this calculation found, from the packer and your cargo.</p>
        </div>
        <StatusPill tone={worst === "success" ? "success" : "warning"}>{worst === "success" ? "No issues found" : `${issues} to review`}</StatusPill>
      </div>
      <ul className="mx-3 mb-3 divide-y divide-white/70 rounded-xl bg-white/45 dark:divide-white/10 dark:bg-white/5">
        {rows.map((row, index) => {
          const Icon = ROW_ICON[row.tone]
          return (
            <li key={`${row.text}-${index}`} className="flex items-start gap-3 px-4 py-2.5">
              <Icon className={cn("mt-0.5 size-5 shrink-0", ROW_COLOUR[row.tone])} aria-hidden="true" />
              <span className="text-detail">{row.text}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Weight, volume and floor use as gauges: for each unit, and for all units together (totals, never an average). */
function UtilisationPanel({ units, stale }: { units: PlanUnitView[]; stale: boolean }) {
  const [scope, setScope] = useState<"all" | number>(units.length > 1 ? "all" : 0)
  const chosen = scope === "all" ? units : units[scope] ? [units[scope]!] : units
  const payload = chosen.reduce((sum, unit) => sum + unit.maxPayloadKg, 0)
  const kg = chosen.reduce((sum, unit) => sum + unit.netKg, 0)
  const capacity = chosen.reduce((sum, unit) => sum + (unit.lengthCm * unit.widthCm * unit.heightCm) / 1_000_000, 0)
  const volume = chosen.reduce((sum, unit) => sum + unit.volumeM3, 0)
  const floor = chosen.reduce((sum, unit) => sum + (unit.lengthCm * unit.widthCm) / 10_000, 0)
  const floorUsed = chosen.reduce((sum, unit) => sum + ((unit.floorPct / 100) * unit.lengthCm * unit.widthCm) / 10_000, 0)
  // One unit: its own figures exactly as calculated. Several: totals of used over totals of capacity.
  const single = chosen.length === 1 ? chosen[0]! : null
  const pct = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0)
  const m2 = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} m²`
  return (
    <section aria-label="Equipment utilisation" className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--suggest-border)] shadow-soft" style={{ background: "var(--util-bg)" }}>
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/75 text-[var(--table-head-fg)] shadow-soft dark:bg-white/10">
          <GaugeIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] leading-6 font-bold text-[var(--table-head-fg)]">Equipment utilisation</h3>
          <p className="text-meta text-[var(--table-head-fg)]/80">
            {single ? `Unit ${units.indexOf(single) + 1}: ${single.equipmentName}${stale ? " · previous calculation" : ""}` : `All ${units.length} units combined: totals used over totals available${stale ? " · previous calculation" : ""}`}
          </p>
        </div>
        {units.length > 1 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Units">
            {(["all", ...units.map((_, index) => index)] as const).map((entry) => (
              <button
                key={String(entry)}
                type="button"
                aria-pressed={scope === entry}
                onClick={() => setScope(entry)}
                className={cn(
                  "press h-8 rounded-full border px-3 text-[13px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  scope === entry ? "border-primary bg-primary text-primary-foreground" : "border-white/70 bg-white/60 text-[var(--table-head-fg)] hover:border-primary dark:border-white/10 dark:bg-white/5",
                )}
              >
                {entry === "all" ? "All units" : `Unit ${entry + 1}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 px-3 pb-3 sm:grid-cols-3">
        <GaugeSurface tone="lavender">
          <Gauge accent="var(--pastel-lavender-accent)" track="var(--gauge-weight-track)" label="Weight" pct={single ? single.weightPct : pct(kg, payload)} used={formatKg(kg)} total={formatKg(payload)} />
        </GaugeSurface>
        <GaugeSurface tone="blue">
          <Gauge accent="var(--pastel-blue-accent)" track="var(--gauge-volume-track)" label="Volume" pct={single ? single.volumePct : pct(volume, capacity)} used={formatM3(volume)} total={formatM3(capacity)} />
        </GaugeSurface>
        <GaugeSurface tone="mint">
          <Gauge accent="var(--pastel-mint-accent)" track="var(--gauge-floor-track)" label="Floor" pct={single ? single.floorPct : pct(floorUsed, floor)} used={m2(floorUsed)} total={m2(floor)} />
        </GaugeSurface>
      </div>
    </section>
  )
}

/** A rounded pastel tile behind one gauge, in the tone of its accent. */
function GaugeSurface({ tone, children, compact = false }: { tone: "lavender" | "blue" | "mint"; children: ReactNode; compact?: boolean }) {
  return (
    <div
      className={cn(
        tone === "lavender" ? "pastel-lavender" : tone === "blue" ? "pastel-blue" : "pastel-mint",
        compact ? "px-1.5 pt-3 pb-2" : "px-3 pt-4 pb-3",
        "rounded-xl border border-[var(--pc-border)] bg-[var(--pc-bg)] transition-[transform,box-shadow,border-color] duration-200 ease-out motion-safe:hover:-translate-y-0.5 hover:border-[var(--pc-accent)]/50 hover:shadow-lift",
      )}
    >
      {children}
    </div>
  )
}
