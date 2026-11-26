"use client"

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import type { PlannerStep } from "@compass/domain"
import Link from "next/link"
import { createPortal } from "react-dom"
import { FileSpreadsheet, Printer } from "lucide-react"
import { resolveMinSupportPct } from "@compass/physics"
import { useEditorSettings } from "@/lib/editor-settings"
import { toast } from "sonner"
import { persistPlan, savePlanLayout } from "@/app/actions/plan"
import type { CargoLine } from "@/components/cargo-grid"
import { rotationProblem } from "@/lib/layout-validation"
import { isPlannable, plannableLines } from "@/lib/cargo-validation"
import { derivePlanStatus, type PlanStatus } from "@/lib/plan-status"
import { recalculateGuard, type RecalcGuard } from "@/lib/recalc-guard"
import { DragSettingsPanel } from "@/components/drag-settings"
import { LoadViewer, PIECE_DRAG_TYPE, type ViewerCamera } from "@/components/load-viewer"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { PlanDiagram } from "@/components/plan-diagram"
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

  /**
   * Packs the cargo and saves the plan. Failing at any step leaves the previous plan exactly as it was.
   */
  async function calculate() {
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
    if (planned.length < cargo.length) {
      const left = cargo.length - planned.length
      toast.warning(`${left} incomplete cargo line${left === 1 ? " was" : "s were"} left out of the plan. Complete ${left === 1 ? "it" : "them"} in Data.`)
    }
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
  const planStatus = useMemo(
    () => derivePlanStatus({ hasPlan: hasPlanNow, calculating: busy, stale, failed: calcFailed }),
    [busy, calcFailed, hasPlanNow, stale],
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
              onClick={requestRecalculate}
              disabled={busy}
            >
              {busy ? progress ?? "Calculating…" : plan ? "Recalculate" : "Calculate load plan"}
            </Button>
          ) : null}
        </div>
      </div>

      {stale && plan && plan.units.length > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <span>
            The cargo changed after this plan was calculated. Recalculate so the plan includes the changes
            {plan.layoutSource === "MANUAL" ? ". Your hand-arranged layout will be replaced, and you are asked first" : ""}.
          </span>
          {canEdit ? (
            <Button type="button" size="sm" onClick={requestRecalculate} disabled={busy}>
              Recalculate now
            </Button>
          ) : null}
        </div>
      ) : null}

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
          <WorkspaceTable units={plan.units} selected={selectedIndex} onSelect={setSelected} />
          <UnloadedList unloaded={plan.unloaded} onEditStep={onEditStep} />
        </>
      ) : (
        unit && (
          <>
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
    <div className="overflow-hidden rounded-md border bg-card">
      <table className="sheet-table w-full text-left text-sm">
        <thead className="bg-muted/70 text-xs tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-4 py-2">Unit</th>
            <th className="px-4 py-2">Pieces</th>
            <th className="px-4 py-2">Weight</th>
            <th className="px-4 py-2">Volume</th>
            <th className="px-4 py-2">Used space</th>
            <th className="px-4 py-2" title={FLOOR_HELP}>
              Floor utilization (%)
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
              <td className="px-4 py-3 tabular-nums" title={FLOOR_HELP}>
                {formatPct(unit.floorPct)}
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
  canEdit,
  cargo,
  unit,
  unitNumber,
  unitCount,
  warnings,
  unloaded,
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
                  floorPct: unit.floorPct,
                  remainingKg: unit.remainingKg,
                  remainingM3: unit.remainingM3,
                }
            return (
              <>
                <Metric label={`Weight${edited}`} value={`${formatKg(m.netKg)} · ${formatPct(m.weightPct)}`} />
                <Metric label={`Volume${edited}`} value={`${formatM3(m.volumeM3)} · ${formatPct(m.volumePct)}`} />
                <Metric label={`Floor utilization${edited}`} value={formatPct(m.floorPct)} title={FLOOR_HELP} />
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
              : layoutSource === "MANUAL"
                ? "Hand-arranged layout: it is not repacked automatically. Open playground to move cargo."
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

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-28 rounded-lg border bg-card px-3 py-2 shadow-card" title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
