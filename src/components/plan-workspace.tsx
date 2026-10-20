"use client"

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import type { PlannerStep } from "@compass/domain"
import { toast } from "sonner"
import { persistPlan, savePlanLayout } from "@/app/actions/plan"
import type { CargoLine } from "@/components/cargo-grid"
import { DragSettingsPanel } from "@/components/drag-settings"
import { LoadViewer, type ViewerCamera } from "@/components/load-viewer"
import { StepLoader } from "@/components/step-loader"
import { Button } from "@/components/ui/button"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { rotateItemFlat, tryPlaceItem } from "@/lib/cargo-skin"
import { formatKg, formatM3, formatPct } from "@/lib/format"
import { toPlanView, type PlanItemView, type PlanUnitView, type PlanView } from "@/lib/plan-view"
import { runSolver } from "@/lib/run-solver"
import { buildSolverInput } from "@/lib/solver-input"
import { cn } from "@/lib/utils"

export type PlanWorkspaceHandle = {
  calculate: () => Promise<boolean>
  hasPlan: () => boolean
}

export const PlanWorkspace = forwardRef<
  PlanWorkspaceHandle,
  {
    projectId: string
    cargo: CargoLine[]
    equipment: EquipmentListItem[]
    objective: "FEWEST_UNITS" | "LOWEST_COST"
    initialPlan: PlanView | null
    canEdit: boolean
    variant: Extract<PlannerStep, "workspace" | "plan">
  }
>(function PlanWorkspace(
  { projectId, cargo, equipment, objective, initialPlan, canEdit, variant },
  ref,
) {
  const [plan, setPlan] = useState<PlanView | null>(initialPlan)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [opening, setOpening] = useState<string | null>(null)
  const switchTimer = useRef<number | null>(null)
  const selectedIndex = plan && plan.units.length > 0 ? Math.min(selected, plan.units.length - 1) : 0
  const unit = plan?.units[selectedIndex] ?? null

  function openUnit(index: number) {
    if (index === selectedIndex) return
    const next = plan?.units[index]
    setSelected(index)
    if (!next) return
    if (switchTimer.current) window.clearTimeout(switchTimer.current)
    setOpening(`Opening ${index + 1}. ${next.equipmentName}…`)
    switchTimer.current = window.setTimeout(() => setOpening(null), 700)
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

  async function calculate() {
    if (equipment.length === 0) {
      toast.error("Pick equipment in Setup first.")
      return false
    }
    if (cargo.length === 0) {
      toast.error("Add cargo in Data first.")
      return false
    }
    setBusy(true)
    setProgress("Packing…")
    try {
      const result = await runSolver(
        buildSolverInput({ cargo, equipment, objective }),
        (event) => setProgress(`Restart ${event.restart} of ${event.restarts}`),
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
        cargo.map((item) => ({
          id: item.id,
          name: item.name,
          weightKg: item.weightKg,
          color: item.color,
          shape: item.shape,
          stackable: item.stackable,
          bottomOnly: item.bottomOnly,
          maxStackLoadKg: item.maxStackLoadKg,
        })),
      )
      const saved = await persistPlan(projectId, result)
      if (!saved.ok) toast.error(saved.error)
      else if (view.unloaded.length > 0) {
        toast.warning(`${view.unloaded.length} piece(s) do not fit in the selected container.`)
      } else {
        toast.success("Load plan ready.")
      }
      setPlan(view)
      setSelected(0)
      return view.units.length > 0
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The solver failed.")
      return false
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  useImperativeHandle(ref, () => ({
    calculate,
    hasPlan: () => Boolean(plan && plan.units.length > 0),
  }))

  return (
    <div className="relative min-h-48 space-y-4">
      {busy ? <StepLoader label={progress ?? "Calculating the load plan…"} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-2.5">
        <div className="text-sm text-muted-foreground">
          {totals ? (
            <span>
              {totals.pieces} pieces · {totals.units} unit{totals.units === 1 ? "" : "s"} · {formatKg(totals.kg)} ·{" "}
              {formatM3(totals.volume)}
            </span>
          ) : (
            <span>No plan yet. Calculate to pack the cargo into the selected equipment.</span>
          )}
        </div>
        {canEdit ? (
          <Button type="button" size="sm" onClick={calculate} disabled={busy}>
            {busy ? progress ?? "Calculating…" : plan ? "Recalculate" : "Calculate load plan"}
          </Button>
        ) : null}
      </div>

      {!plan || plan.units.length === 0 ? (
        <EmptyPlan unloaded={plan?.unloaded ?? []} />
      ) : variant === "workspace" ? (
        <>
          <WorkspaceTable units={plan.units} selected={selectedIndex} onSelect={setSelected} />
          <UnloadedList unloaded={plan.unloaded} />
        </>
      ) : (
        unit && (
          <>
            <UnitPicker units={plan.units} selected={selectedIndex} onSelect={openUnit} />
            <div className="relative">
            {opening ? <StepLoader label={opening} /> : null}
            <LoadPlanDetail
              key={selectedIndex}
              projectId={projectId}
              canEdit={canEdit}
              unit={unit}
              unitNumber={selectedIndex + 1}
              unitCount={plan.units.length}
              warnings={plan.warnings}
              unloaded={plan.unloaded}
              onSaved={(nextItems) => {
                setPlan((current) =>
                  current
                    ? {
                        ...current,
                        units: current.units.map((entry, index) =>
                          index === selectedIndex ? { ...entry, items: nextItems } : entry,
                        ),
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
  )
})

function EmptyPlan({ unloaded }: { unloaded: PlanView["unloaded"] }) {
  return (
    <div className="rounded-md border border-dashed bg-card px-4 py-10 text-center">
      <p className="text-sm font-medium">No 3D plan yet</p>
      <p className="mt-2 text-sm text-muted-foreground">Choose cargo and equipment, then calculate.</p>
      {unloaded.length > 0 ? (
        <ul className="mx-auto mt-4 max-w-lg text-left text-sm text-destructive">
          {unloaded.slice(0, 6).map((row) => (
            <li key={`${row.cargoId}-${row.reason}`}>
              {row.name}: {row.detail}
            </li>
          ))}
        </ul>
      ) : null}
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
                L {Math.round(unit.usedLengthCm)} · W {Math.round(unit.usedWidthCm)} · H {Math.round(unit.usedHeightCm)}
              </td>
              <td className="px-4 py-3">
                <LoadViewer unit={unit} compact className="h-28 w-48 overflow-hidden rounded-lg border bg-white" />
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
  unit,
  unitNumber,
  unitCount,
  warnings,
  unloaded,
  onSaved,
}: {
  projectId: string
  canEdit: boolean
  unit: PlanUnitView
  unitNumber: number
  unitCount: number
  warnings: string[]
  unloaded: PlanView["unloaded"]
  onSaved: (items: PlanItemView[]) => void
}) {
  const [synced, setSynced] = useState(unit)
  const [items, setItems] = useState(unit.items)
  const [playground, setPlayground] = useState(false)
  const [view, setView] = useState<ViewerCamera>("iso")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<PlanItemView[][]>([])
  const [flashItem, setFlashItem] = useState<PlanItemView | null>(null)
  const dragging = useRef(false)
  if (synced !== unit) {
    setSynced(unit)
    setItems(unit.items)
    setSelectedId(null)
    setHistory([])
  }

  const liveUnit = { ...unit, items }
  const selected = items.find((item) => item.id === selectedId) ?? null
  const dirty = items.some((item) => {
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

  const commitItems = useCallback((next: PlanItemView[]) => {
    setHistory((past) => [...past.slice(-40), items])
    setItems(next)
  }, [items])

  const undoLayout = useCallback(() => {
    setHistory((past) => {
      const previous = past[past.length - 1]
      if (previous) setItems(previous)
      return past.slice(0, -1)
    })
  }, [])

  const rotateSelected = useCallback(() => {
    if (!selected) {
      toast.error("Click a cargo piece first.")
      return
    }
    const placed = tryPlaceItem(rotateItemFlat(selected), items, unit)
    if (!placed) {
      toast.error("That turn does not fit here.")
      setFlashItem(selected)
      window.setTimeout(() => setFlashItem(null), 300)
      return
    }
    commitItems(items.map((item) => (item.id === selected.id ? placed : item)))
  }, [commitItems, items, selected, unit])

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
        setHistory((past) => {
          const previous = past[past.length - 1]
          if (previous) setItems(previous)
          return past.slice(0, -1)
        })
        return
      }
      if (!selectedId) return
      const current = items.find((item) => item.id === selectedId)
      if (!current) return
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
      const placed = tryPlaceItem({ ...current, x: current.x + delta.x, y: current.y + delta.y, z: current.z + delta.z }, items, unit)
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
  }, [commitItems, items, playground, rotateSelected, selectedId, unit])

  async function saveLayout() {
    if (!canEdit) return
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
    )
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success("Layout saved.")
    onSaved(items)
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
      <Button type="button" size="sm" variant="outline" onClick={undoLayout} disabled={history.length === 0}>
        Undo
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => { setItems(unit.items); setHistory([]) }}>
        Reset layout
      </Button>
      {canEdit ? (
        <Button type="button" size="sm" onClick={() => void saveLayout()} disabled={!dirty || saving}>
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
        <dl className="flex flex-wrap gap-6 text-sm">
          <Metric label="Weight" value={`${formatKg(unit.netKg)} · ${formatPct(unit.weightPct)}`} />
          <Metric label="Volume" value={`${formatM3(unit.volumeM3)} · ${formatPct(unit.volumePct)}`} />
          <Metric label="Floor" value={formatPct(unit.floorPct)} />
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2">
        <Button type="button" size="sm" onClick={() => setPlayground(true)}>
          Playground
        </Button>
        {dirty && canEdit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void saveLayout()} disabled={saving}>
            {saving ? "Saving…" : "Save layout"}
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {dirty ? "Layout changed. Save to keep it." : "Open playground to move cargo."}
        </p>
      </div>

      {playground ? (
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
          <div className="flex min-h-0 flex-1">
            <PlaygroundItemList items={items} selectedId={selectedId} onSelect={setSelectedId} />
            <LoadViewer
              unit={liveUnit}
              camera={view}
              playground
              selectedId={selectedId}
              flashItem={flashItem}
              onSelect={setSelectedId}
              onItemsChange={commitItems}
              onDragActive={(active) => {
                dragging.current = active
              }}
              className="min-h-0 min-w-0 flex-1 bg-white"
            />
          </div>
        </div>
      ) : null}

      <LoadViewer
        unit={liveUnit}
        camera={view}
        selectedId={selectedId}
        onSelect={setSelectedId}
        className="h-[32rem] overflow-hidden rounded-md border bg-white"
      />

      <div className="grid gap-3 md:grid-cols-3">
        {(
          [
            ["top", "Top"],
            ["side", "Right"],
            ["front", "Front"],
          ] as const
        ).map(([camera, label]) => (
          <button
            key={camera}
            type="button"
            className={cn(
              "overflow-hidden rounded-xl border bg-white text-left",
              view === camera && "ring-2 ring-primary",
            )}
            onClick={() => setView(camera)}
          >
            <p className="px-2 pt-1 text-xs text-muted-foreground">{label}</p>
            <LoadViewer unit={liveUnit} camera={camera} compact className="h-36 w-full" />
          </button>
        ))}
      </div>

      {unit.axleLoads.length > 0 ? (
        <ul className="grid gap-2 rounded-md border bg-card p-3 text-sm sm:grid-cols-2">
          {unit.axleLoads.map((axle) => (
            <li key={axle.name} className={cn("flex justify-between", axle.kg > axle.maxKg && "text-destructive")}>
              <span>{axle.name}</span>
              <span>
                {formatKg(axle.kg)} / {formatKg(axle.maxKg)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {(warnings.length > 0 || unloaded.length > 0) && (
        <div className="rounded-md border bg-card p-3 text-sm">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <UnloadedList unloaded={unloaded} />
        </div>
      )}

      <div className="overflow-hidden rounded-md border bg-card">
        <table className="sheet-table w-full text-left text-sm">
          <thead className="bg-muted/70 text-xs tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2">Seq</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">L</th>
              <th className="px-3 py-2">W</th>
              <th className="px-3 py-2">H</th>
              <th className="px-3 py-2">kg</th>
            </tr>
          </thead>
          <tbody>
            {items
              .slice()
              .sort((a, b) => a.sequence - b.sequence)
              .map((item) => (
                <tr
                  key={item.id}
                  className={cn("cursor-pointer", selectedId === item.id && "bg-secondary/70")}
                  onClick={() => setSelectedId(item.id)}
                >
                  <td className="px-3 py-2">{item.sequence}</td>
                  <td className="px-3 py-2">
                    <span className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: item.color }} />
                    {item.name}
                  </td>
                  <td className="px-3 py-2">{Math.round(item.lengthCm)}</td>
                  <td className="px-3 py-2">{Math.round(item.widthCm)}</td>
                  <td className="px-3 py-2">{Math.round(item.heightCm)}</td>
                  <td className="px-3 py-2">{Math.round(item.weightKg)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlaygroundItemList({
  items,
  selectedId,
  onSelect,
}: {
  items: PlanItemView[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
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
      <div className="border-b px-3 py-2">
        <p className="text-sm font-medium">Cargo</p>
        <p className="text-xs text-muted-foreground">{rows.length} pieces</p>
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
                    {Math.round(item.lengthCm)} × {Math.round(item.widthCm)} × {Math.round(item.heightCm)} cm
                  </span>
                  <span className={cn("block text-xs", active ? "text-neutral-700" : "text-muted-foreground")}>
                    {formatKg(item.weightKg)}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function UnloadedList({ unloaded }: { unloaded: PlanView["unloaded"] }) {
  if (unloaded.length === 0) return null
  return (
    <div className="rounded-md border border-destructive/30 bg-card p-3 text-sm">
      <p className="font-medium text-destructive">
        {unloaded.length} piece{unloaded.length === 1 ? "" : "s"} do not fit in the selected container
      </p>
      <ul className="mt-2 space-y-1 text-destructive">
        {unloaded.map((row, index) => (
          <li key={`${row.cargoId}-${row.reason}-${index}`}>
            {row.name}: {row.detail}
          </li>
        ))}
      </ul>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
