"use client"

import { forwardRef, useImperativeHandle, useMemo, useState, type ComponentType, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Boxes, Calculator, Check, Container, DoorOpen, Hash, Layers, LayoutGrid, ListChecks, Minus, Plus, RotateCcw, Ruler, Scale, Search, Sparkles, Truck, Weight, X } from "lucide-react"
import { modeLabel, type EquipmentMode } from "@compass/domain"
import { toast } from "sonner"
import { setProjectEquipment } from "@/app/actions/projects"
import type { CargoLine } from "@/components/cargo-grid"
import { FilterChip, FOCUS_RING, IconTile, SectionCard, StatusPill, TRANSPORT_ICON, TRANSPORT_TINT } from "@/components/design-system"
import { EquipmentSuggestions } from "@/components/equipment-suggestions"
import { EquipmentViewer } from "@/components/equipment-viewer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { LengthUnit } from "@/lib/cargo-units"
import { MODE_ORDER, type EquipmentListItem } from "@/lib/equipment-catalog"
import { cargoFitsEquipment } from "@/lib/equipment-fit"
import type { EquipmentSuggestion } from "@/lib/equipment-suggest"
import { useLengthUnit } from "@/lib/length-unit-pref"
import { formatCm, formatEnvelope, formatKg, formatM3, formatPct } from "@/lib/format"
import { cn } from "@/lib/utils"

export type EquipmentChoice = {
  equipmentTypeId: string
  role: "PRIMARY" | "SECONDARY"
  maxCount: number | null
}

export type EquipmentSetupHandle = {
  save: () => Promise<boolean>
  hasSelection: () => boolean
  isDirty: () => boolean
}

type SelectedUnit = { equipmentTypeId: string; quantity: number }

/** Packing is never perfect; treat this share of the inner volume as usable for the rough check. */
const USABLE_VOLUME = 0.85
const MAX_QTY = 99

function unitsFrom(initial: EquipmentChoice[]): SelectedUnit[] {
  return initial.map((choice) => ({
    equipmentTypeId: choice.equipmentTypeId,
    quantity: choice.maxCount && choice.maxCount > 0 ? choice.maxCount : 1,
  }))
}

function sameUnits(a: SelectedUnit[], b: SelectedUnit[]): boolean {
  if (a.length !== b.length) return false
  return a.every((unit) => b.some((other) => other.equipmentTypeId === unit.equipmentTypeId && other.quantity === unit.quantity))
}

function innerM3(item: EquipmentListItem): number {
  return (item.innerLengthCm * item.innerWidthCm * item.innerHeightCm) / 1_000_000
}

/** The rough number of units of one type the cargo needs on its own (volume with the usable share, and weight). */
function roughNeed(item: EquipmentListItem, cargoWeight: number, cargoVolume: number): number {
  const byVolume = cargoVolume / Math.max(innerM3(item) * USABLE_VOLUME, 0.001)
  const byWeight = item.maxPayloadKg > 0 ? cargoWeight / item.maxPayloadKg : 0
  return Math.max(1, Math.ceil(Math.max(byVolume, byWeight)))
}

export const EquipmentSetup = forwardRef<
  EquipmentSetupHandle,
  {
    projectId: string
    items: EquipmentListItem[]
    initial: EquipmentChoice[]
    canEdit: boolean
    projectMode: EquipmentMode
    cargo: CargoLine[]
    objective: "FEWEST_UNITS" | "LOWEST_COST"
    /** The project's minimum support share, when it has one. */
    minSupportPct?: number | null
    /** Point the planner at the best-fit check as the step opens (used after importing a packing list). */
    autoSuggest?: boolean
    onAutoSuggestStarted?: () => void
  }
>(function EquipmentSetup(
  { projectId, items, initial, canEdit, projectMode, cargo, objective, minSupportPct = null, autoSuggest = false, onAutoSuggestStarted },
  ref,
) {
  const router = useRouter()
  const unit = useLengthUnit()
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<EquipmentMode | "ALL">(projectMode)
  const [saved, setSaved] = useState<SelectedUnit[]>(() => unitsFrom(initial))
  const [units, setUnits] = useState<SelectedUnit[]>(saved)
  const [focusId, setFocusId] = useState<string | null>(units[0]?.equipmentTypeId ?? null)
  const [saving, setSaving] = useState(false)
  const [ranked, setRanked] = useState<EquipmentSuggestion[] | null>(null)
  const dirty = !sameUnits(units, saved)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((item) => {
      if (mode !== "ALL" && item.mode !== mode) return false
      if (!needle) return true
      return [item.name, item.code, item.externalId ?? "", item.sizeLabel ?? ""].join(" ").toLowerCase().includes(needle)
    })
  }, [items, mode, query])

  const cargoTotals = useMemo(() => {
    let volume = 0
    let weight = 0
    for (const line of cargo) {
      volume += ((line.lengthCm * line.widthCm * line.heightCm) / 1_000_000) * line.quantity
      weight += line.weightKg * line.quantity
    }
    return { volume, weight }
  }, [cargo])

  const capacity = useMemo(() => {
    let volume = 0
    let weight = 0
    for (const unit of units) {
      const item = items.find((entry) => entry.id === unit.equipmentTypeId)
      if (!item) continue
      volume += innerM3(item) * unit.quantity
      weight += item.maxPayloadKg * unit.quantity
    }
    return { volume, weight }
  }, [items, units])

  const selected = items.find((item) => item.id === focusId) ?? null

  function suggestedCount(item: EquipmentListItem): number {
    return roughNeed(item, cargoTotals.weight, cargoTotals.volume)
  }

  // How the shipment travels, for the best-fit check. Nothing is compared until the planner picks one.
  const [suggestMode, setSuggestMode] = useState<EquipmentMode | null>(null)

  /** Replace the selection with a suggested type and count. Undo puts the previous picks back. */
  function applySuggestion(equipmentTypeId: string, quantity: number) {
    const previous = units
    const item = items.find((entry) => entry.id === equipmentTypeId)
    setUnits([{ equipmentTypeId, quantity: Math.min(MAX_QTY, Math.max(1, quantity)) }])
    setFocusId(equipmentTypeId)
    toast.success(`Selected ${quantity} × ${item?.name ?? "unit"}. Continue to save it.`, {
      action: previous.length > 0 ? { label: "Undo", onClick: () => setUnits(previous) } : undefined,
    })
  }

  function toggle(item: EquipmentListItem) {
    const chosen = units.some((unit) => unit.equipmentTypeId === item.id)
    if (chosen) {
      remove(item.id)
      return
    }
    // Pre-fill the quantity with the rough estimate when this is the only type picked.
    const quantity = units.length === 0 && cargoTotals.volume > 0 ? Math.min(MAX_QTY, suggestedCount(item)) : 1
    setUnits((current) => [...current, { equipmentTypeId: item.id, quantity }])
    setFocusId(item.id)
  }

  function remove(id: string) {
    setUnits((current) => current.filter((unit) => unit.equipmentTypeId !== id))
    setFocusId((current) => (current === id ? null : current))
  }

  function setQuantity(id: string, quantity: number) {
    const next = Math.min(MAX_QTY, Math.max(1, Math.round(quantity)))
    setUnits((current) => current.map((unit) => (unit.equipmentTypeId === id ? { ...unit, quantity: next } : unit)))
  }

  async function save() {
    if (units.length === 0) {
      toast.error("Pick at least one container, ULD, or truck.")
      return false
    }
    if (!dirty) return true
    setSaving(true)
    const result = await setProjectEquipment(
      projectId,
      units.map((unit) => ({
        equipmentTypeId: unit.equipmentTypeId,
        role: "PRIMARY" as const,
        maxCount: unit.quantity,
      })),
    )
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error)
      return false
    }
    setSaved(units)
    toast.success("Equipment saved.")
    router.refresh()
    return true
  }

  useImperativeHandle(ref, () => ({
    save,
    hasSelection: () => units.length > 0,
    isDirty: () => canEdit && dirty,
  }))

  const volumePct = capacity.volume > 0 ? (cargoTotals.volume / (capacity.volume * USABLE_VOLUME)) * 100 : 0
  const weightPct = capacity.weight > 0 ? (cargoTotals.weight / capacity.weight) * 100 : 0
  const chosenItems = units.flatMap((entry) => {
    const item = items.find((candidate) => candidate.id === entry.equipmentTypeId)
    return item ? [{ item, quantity: entry.quantity }] : []
  })

  // The best-fit check's own ranking, when it has been run (the suggestions panel reports it; nothing is computed here).
  const bestId = ranked?.find((entry) => entry.unloadedPieces === 0)?.equipmentTypeId ?? null
  const compareColumns = [
    ...chosenItems.map(({ item, quantity }) => ({ item, quantity, selected: true })),
    ...(selected && !units.some((entry) => entry.equipmentTypeId === selected.id) ? [{ item: selected, quantity: 1, selected: false }] : []),
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <IconTile icon={Container} tint="mint" size="lg" />
          <div className="min-w-0">
            <h2 className="text-page-title">Equipment</h2>
            <p className="mt-1 text-page-desc text-muted-foreground">
              Choose the containers, ULDs or trucks this shipment may use, and how many of each.
            </p>
          </div>
        </div>
        {dirty ? <StatusPill tone="warning">Unsaved changes</StatusPill> : units.length > 0 ? <StatusPill tone="success">Equipment saved</StatusPill> : null}
      </div>


      <EquipmentSuggestions
        cargo={cargo}
        items={items}
        mode={suggestMode}
        onModeChange={(next) => {
          setSuggestMode(next)
          // Show the same mode in the library below, so the list matches what is being compared.
          setMode(next)
          onAutoSuggestStarted?.()
        }}
        objective={objective}
        minSupportPct={minSupportPct}
        canEdit={canEdit}
        selected={units}
        onUse={applySuggestion}
        highlight={autoSuggest}
        onResults={setRanked}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_34rem]">
        {/* On wide screens the library takes the height of the column beside it and scrolls inside it. */}
        <div className="relative min-w-0 xl:min-h-[44rem]">
          <SectionCard
            banded
            icon={LayoutGrid}
            title="Equipment library"
            description={`${filtered.length} of ${items.length} types · click a row to preview it, Add to put it in the project`}
            className="flex flex-col xl:absolute xl:inset-0"
          >
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--table-border)] px-5 py-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by mode">
                {(["ALL", ...MODE_ORDER] as const).map((entry) => (
                  <FilterChip key={entry} active={mode === entry} onClick={() => setMode(entry)}>
                    {entry === "ALL" ? "All" : modeLabel(entry)}
                  </FilterChip>
                ))}
              </div>
              <div className="relative ml-auto min-w-56 flex-1 sm:max-w-80">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name or code, e.g. 40HC"
                  aria-label="Search equipment"
                  className="h-10 rounded-xl bg-card pl-10 text-[15px] shadow-soft"
                />
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="flex-1 px-4 py-10 text-center text-detail text-muted-foreground">
                <p>No equipment matches “{query}”{mode !== "ALL" ? ` in ${modeLabel(mode)}` : ""}.</p>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setQuery("")
                    setMode("ALL")
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className="max-h-[75vh] min-h-0 flex-1 overflow-auto xl:max-h-none">
                <table className="data-table w-full min-w-[44rem] text-left text-sm" aria-label="Equipment types">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="pl-5">Equipment</th>
                      <th className="px-4">Inside (L × W × H)</th>
                      <th className="px-4 text-right">Volume</th>
                      <th className="px-4 text-right">Max payload</th>
                      <th className="w-36 pr-5 text-right">
                        <span className="sr-only">Add to the project</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const chosen = units.find((entry) => entry.equipmentTypeId === item.id)
                      const previewed = focusId === item.id
                      const recommended = item.id === bestId
                      return (
                        <tr
                          key={item.id}
                          onClick={() => setFocusId(item.id)}
                          aria-selected={previewed}
                          className={cn("cursor-pointer border-t", previewed && "bg-[var(--pastel-mint-bg)] hover:bg-[var(--pastel-mint-bg)]")}
                        >
                          <td className={cn("py-2.5 pr-3 pl-5", previewed && "shadow-[inset_3px_0_0_var(--primary)]")}>
                            {/* The name previews the row from the keyboard; a click anywhere on the row does the same. */}
                            <button type="button" className={cn("flex min-w-0 items-center gap-3 rounded-lg text-left", FOCUS_RING)} onClick={() => setFocusId(item.id)} aria-pressed={previewed} aria-label={`Preview ${item.name}`}>
                              <IconTile icon={TRANSPORT_ICON[item.mode]} tint={TRANSPORT_TINT[item.mode]} size="sm" className="size-9 rounded-lg [&_svg]:size-[18px]" />
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span className="text-[15px] leading-5 font-semibold" title={item.code ? `Code: ${item.code}` : undefined}>
                                    {item.name}
                                  </span>
                                  {recommended ? <span className="rounded-full bg-[var(--pastel-mint-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--pastel-mint-accent)] ring-1 ring-[var(--pastel-mint-border)]">Best fit</span> : null}
                                  {previewed ? <span className="text-[11px] font-semibold text-primary uppercase dark:text-[var(--step-done-fg)]">Previewing</span> : null}
                                </span>
                                {/* Sizes live in their own column; codes stay searchable and show on hover. */}
                                <span className="block text-xs text-muted-foreground">{modeLabel(item.mode)}</span>
                              </span>
                            </button>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, unit)}</td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">{formatM3(innerM3(item))}</td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">{formatKg(item.maxPayloadKg)}</td>
                          <td className="py-2.5 pr-5 pl-3 text-right" onClick={(event) => event.stopPropagation()}>
                            {canEdit ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                aria-pressed={Boolean(chosen)}
                                aria-label={chosen ? `Remove ${item.name}` : `Add ${item.name}`}
                                onClick={() => toggle(item)}
                                className={cn(
                                  "group press h-8 min-w-24 rounded-lg px-3 text-[13px] font-semibold",
                                  chosen
                                    ? "border-primary bg-primary text-primary-foreground hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                                    : "border-primary/40 bg-card text-primary hover:border-primary hover:bg-tint-mint hover:text-tint-mint-foreground",
                                )}
                              >
                                {chosen ? (
                                  <>
                                    <Check className="size-3.5 group-hover:hidden" strokeWidth={3} />
                                    <X className="hidden size-3.5 group-hover:block" />
                                    <span className="group-hover:hidden">{chosen.quantity} added</span>
                                    <span className="hidden group-hover:inline">Remove</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus className="size-3.5" />
                                    Add
                                  </>
                                )}
                              </Button>
                            ) : chosen ? (
                              <span className="text-meta text-muted-foreground">In project</span>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <aside className="min-w-0 space-y-5">
          <SectionCard
            banded
            icon={ListChecks}
            title="Project equipment"
            description="Add each type you may use and set the most you can book. The planner uses only what it needs."
          >
            <div className="space-y-4 p-5">
              {units.length === 0 ? (
                <p className="rounded-xl border border-dashed px-3 py-5 text-center text-detail text-muted-foreground">
                  Nothing selected yet. Click <span className="font-semibold">Add</span> on a container, ULD or truck.
                </p>
              ) : (
                <ul className="space-y-2">
                  {chosenItems.map(({ item, quantity }) => (
                    <li key={item.id} className={cn("flex items-center gap-3 rounded-xl border border-primary/40 bg-[var(--pastel-mint-bg)] px-3 py-2.5", focusId === item.id && "ring-2 ring-primary/30")}>
                      <IconTile icon={TRANSPORT_ICON[item.mode]} tint={TRANSPORT_TINT[item.mode]} size="sm" />
                      <button type="button" className={cn("min-w-0 flex-1 rounded-md text-left", FOCUS_RING)} onClick={() => setFocusId(item.id)} aria-label={`Preview ${item.name}`}>
                        <span className="block text-[15px] leading-5 font-bold break-words">{item.name}</span>
                        <span className="text-meta text-muted-foreground">{modeLabel(item.mode)}</span>
                      </button>
                      <QuantityStepper label={`How many ${item.name}`} value={quantity} disabled={!canEdit} onChange={(next) => setQuantity(item.id, next)} />
                      {canEdit ? (
                        <Button type="button" size="icon" variant="ghost" className="press size-9 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove ${item.name}`} onClick={() => remove(item.id)}>
                          <X className="size-4" />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {cargoTotals.volume > 0 && units.length > 0 ? (
                <div className="space-y-3 rounded-xl border border-[var(--table-border)] bg-muted/30 p-4">
                  <p className="text-label">Rough capacity check · all selected units</p>
                  <CapacityBar label="Volume (usable)" used={formatM3(cargoTotals.volume)} total={formatM3(capacity.volume * USABLE_VOLUME)} pct={volumePct} />
                  <CapacityBar label="Weight" used={formatKg(cargoTotals.weight)} total={formatKg(capacity.weight)} pct={weightPct} />
                  {volumePct > 100 || weightPct > 100 ? (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-meta text-red-800 dark:bg-red-500/10 dark:text-red-300" role="alert">
                      Your cargo probably will not fit. Add more units or a larger type.
                      {units.length === 1 && units[0]
                        ? (() => {
                            const only = items.find((entry) => entry.id === units[0]?.equipmentTypeId)
                            return only ? ` About ${suggestedCount(only)}× ${only.name} would be needed.` : ""
                          })()
                        : ""}
                    </p>
                  ) : (
                    <p className="text-meta text-muted-foreground">
                      Volume assumes about {formatPct(USABLE_VOLUME * 100)} usable space. Weight and volume alone do not prove the cargo fits; calculate the plan for the exact fit.
                    </p>
                  )}
                </div>
              ) : null}

              {canEdit ? (
                <Button type="button" className="press h-11 w-full rounded-xl text-button shadow-soft" onClick={() => void save()} disabled={saving || !dirty}>
                  {saving ? "Saving…" : dirty ? "Save equipment" : "Saved"}
                </Button>
              ) : null}
            </div>
          </SectionCard>

          {selected ? (
            <EquipmentDetails
              item={selected}
              unit={unit}
              chosen={units.find((entry) => entry.equipmentTypeId === selected.id)?.quantity ?? 0}
              recommended={selected.id === bestId}
              cargo={cargo}
              cargoWeight={cargoTotals.weight}
              cargoVolume={cargoTotals.volume}
            />
          ) : null}
        </aside>
      </div>

      <EquipmentComparison
        columns={compareColumns}
        unit={unit}
        cargo={cargo}
        cargoWeight={cargoTotals.weight}
        cargoVolume={cargoTotals.volume}
        bestId={bestId}
        rankedIds={ranked?.map((entry) => entry.equipmentTypeId) ?? null}
        focusId={focusId}
        onPreview={setFocusId}
      />
    </div>
  )
})

function QuantityStepper({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  // Local text so the field can be cleared while typing; it snaps back to a valid number on blur.
  const [text, setText] = useState(String(value))
  const [source, setSource] = useState(value)
  if (source !== value) {
    setSource(value)
    setText(String(value))
  }

  return (
    <div className="flex items-center overflow-hidden rounded-xl border bg-card shadow-soft" role="group" aria-label={label}>
      <button
        type="button"
        className="press flex size-9 items-center justify-center text-muted-foreground hover:bg-tint-mint hover:text-tint-mint-foreground disabled:opacity-40"
        aria-label="One fewer"
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={text}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value.replace(/[^0-9]/g, "")
          setText(raw)
          if (raw) onChange(Number(raw))
        }}
        onBlur={() => setText(String(value))}
        onFocus={(event) => event.target.select()}
        className="h-9 w-11 border-x bg-card text-center text-[15px] font-semibold text-foreground tabular-nums outline-none focus-visible:bg-tint-mint/40"
      />
      <button
        type="button"
        className="press flex size-9 items-center justify-center text-muted-foreground hover:bg-tint-mint hover:text-tint-mint-foreground disabled:opacity-40"
        aria-label="One more"
        disabled={disabled || value >= MAX_QTY}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

function barTone(pct: number): { bar: string; text: string; label: string } {
  if (pct > 100) return { bar: "bg-red-500", text: "text-red-700 dark:text-red-400", label: "Over capacity" }
  if (pct > 85) return { bar: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", label: "Nearly full" }
  return { bar: "bg-primary", text: "text-primary dark:text-[var(--step-done-fg)]", label: "Within capacity" }
}

function CapacityBar({ label, used, total, pct }: { label: string; used: string; total: string; pct: number }) {
  const tone = barTone(pct)
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-label">{label}</span>
        <span className="text-meta tabular-nums">
          <span className="font-semibold">{used}</span> <span className="text-muted-foreground">of {total}</span>{" "}
          <span className={cn("font-bold", tone.text)}>{formatPct(pct)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[var(--step-line)]" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full transition-[width] duration-200 ease-out", tone.bar)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className={cn("mt-1 text-xs font-medium", tone.text)}>{tone.label}</p>
    </div>
  )
}

/** A compact bar for table cells. */
function MiniBar({ pct }: { pct: number }) {
  const tone = barTone(pct)
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-[var(--step-line)]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={cn("text-meta font-semibold tabular-nums", tone.text)}>{formatPct(pct)}</span>
    </div>
  )
}

/** How many of the cargo lines fit inside this type as entered (no turning), with the existing fit check. */
function linesThatFit(cargo: CargoLine[], item: EquipmentListItem): { fit: number; total: number } {
  const fit = cargo.filter((line) => cargoFitsEquipment(line, item)).length
  return { fit, total: cargo.length }
}

/** The same rough check as the project panel, for one type and a number of units. */
function roughUse(item: EquipmentListItem, quantity: number, cargoWeight: number, cargoVolume: number) {
  return {
    weight: item.maxPayloadKg > 0 ? (cargoWeight / (item.maxPayloadKg * quantity)) * 100 : 0,
    volume: (cargoVolume / Math.max(innerM3(item) * USABLE_VOLUME * quantity, 0.001)) * 100,
  }
}

function SpecRow({ icon: Icon, label, value }: { icon: ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Icon className="size-4 shrink-0 text-[var(--table-head-fg)]" aria-hidden="true" />
      <dt className="flex-1 text-meta text-muted-foreground">{label}</dt>
      <dd className="text-detail font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Check3({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", ok ? "bg-primary text-primary-foreground" : "bg-amber-500 text-white")} aria-hidden="true">
        {ok ? <Check className="size-3" strokeWidth={3.5} /> : <AlertTriangle className="size-3" strokeWidth={3} />}
      </span>
      <span className="text-meta">{children}</span>
    </li>
  )
}

/** The previewed equipment: the existing 3D view, its specifications, the rough capacity use and the existing fit checks. */
function EquipmentDetails({
  item,
  unit,
  chosen,
  recommended,
  cargo,
  cargoWeight,
  cargoVolume,
}: {
  item: EquipmentListItem
  unit: LengthUnit
  chosen: number
  recommended: boolean
  cargo: CargoLine[]
  cargoWeight: number
  cargoVolume: number
}) {
  const quantity = Math.max(1, chosen)
  const use = roughUse(item, quantity, cargoWeight, cargoVolume)
  const lines = linesThatFit(cargo, item)
  const specs: [ComponentType<{ className?: string }>, string, string | null][] = [
    [Ruler, "Inside (L × W × H)", formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, unit)],
    [Boxes, "Volume", formatM3(innerM3(item))],
    [Scale, "Max payload", formatKg(item.maxPayloadKg)],
    [Weight, "Tare weight", item.tareKg > 0 ? formatKg(item.tareKg) : null],
    [Weight, "Max gross weight", item.grossKg > 0 ? formatKg(item.grossKg) : null],
    [DoorOpen, "Door (W × H)", item.doorWidthCm && item.doorHeightCm ? `${formatCm(item.doorWidthCm, unit)} × ${formatCm(item.doorHeightCm, unit)}` : null],
    [Layers, "Floors", item.floors > 1 ? String(item.floors) : null],
    [Container, "Open top", item.heightOpen ? "Yes, height not limited" : null],
    [Ruler, "Extendable", item.extendable && item.maxExtendedLengthCm ? `To ${formatCm(item.maxExtendedLengthCm, unit)}` : null],
    [Truck, "Axle groups", item.axleGroups.length > 0 ? String(item.axleGroups.length) : null],
    [Hash, "Code", item.code],
  ]
  return (
    <section className="surface-card overflow-hidden" aria-label={`${item.name} preview`}>
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <IconTile icon={TRANSPORT_ICON[item.mode]} tint={TRANSPORT_TINT[item.mode]} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[22px] leading-7 font-extrabold tracking-tight break-words">{item.name}</h3>
          <p className="text-meta text-muted-foreground">
            {modeLabel(item.mode)}
            {item.sizeLabel ? ` · ${item.sizeLabel}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {chosen > 0 ? (
            <StatusPill tone="success">
              <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> {chosen} selected
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">Preview</StatusPill>
          )}
          {recommended ? <StatusPill tone="info">Best fit</StatusPill> : null}
        </div>
      </div>
      <div className="relative mx-4 overflow-hidden rounded-xl border border-[var(--table-border)] bg-gradient-to-b from-[var(--pastel-blue-bg)] to-white dark:to-card">
        <EquipmentViewer item={item} className="h-80 w-full" />
        <span className="pointer-events-none absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-soft">
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Drag to rotate
        </span>
      </div>

      <div className="mx-4 mt-4 overflow-hidden rounded-xl border border-[var(--table-border)]">
        <p className="bg-table-head px-4 py-2.5 text-[15px] font-bold text-[var(--table-head-fg)]">Key specifications</p>
        <dl className="divide-y divide-[var(--table-border)]">
          {specs
            .filter((entry): entry is [ComponentType<{ className?: string }>, string, string] => entry[2] !== null)
            .map(([icon, label, value]) => (
              <SpecRow key={label} icon={icon} label={label} value={value} />
            ))}
        </dl>
      </div>

      {cargo.length > 0 ? (
        <div className="mx-4 mt-4 space-y-3 rounded-xl border border-[var(--table-border)] bg-muted/30 p-4">
          <p className="text-label">
            Capacity use <span className="font-normal text-muted-foreground">· your cargo in {quantity} unit{quantity === 1 ? "" : "s"}</span>
          </p>
          <CapacityBar label="Weight" used={formatKg(cargoWeight)} total={formatKg(item.maxPayloadKg * quantity)} pct={use.weight} />
          <CapacityBar label="Volume (usable)" used={formatM3(cargoVolume)} total={formatM3(innerM3(item) * USABLE_VOLUME * quantity)} pct={use.volume} />
        </div>
      ) : null}

      {cargo.length > 0 ? (
        <div className={cn("pastel-surface m-4 p-4", lines.fit === lines.total && use.weight <= 100 && use.volume <= 100 ? "pastel-mint" : "pastel-amber")}>
          <p className="text-[15px] font-bold text-[var(--pc-accent)]">Quick checks</p>
          <ul className="mt-2 space-y-1.5">
            <Check3 ok={lines.fit === lines.total}>
              {lines.fit === lines.total
                ? "Every cargo line fits inside and through the door as entered"
                : `${lines.total - lines.fit} of ${lines.total} cargo lines are too big or heavy as entered (turning may still help)`}
            </Check3>
            <Check3 ok={use.weight <= 100}>{use.weight <= 100 ? "Weight is within the payload" : "Weight is over the payload"}</Check3>
            <Check3 ok={use.volume <= 100}>{use.volume <= 100 ? "Volume is within the usable space" : "Volume is over the usable space"}</Check3>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Rough checks only. Calculating the load plan confirms the real fit.</p>
        </div>
      ) : (
        <div className="h-4" />
      )}
      {item.notes ? <p className="border-t border-[var(--table-border)] px-5 py-3 text-meta text-muted-foreground">{item.notes}</p> : null}
    </section>
  )
}

/** Selected types (and the previewed one) side by side, parameters as rows, using the same rough checks and fit helper. */
function EquipmentComparison({
  columns,
  unit,
  cargo,
  cargoWeight,
  cargoVolume,
  bestId,
  rankedIds,
  focusId,
  onPreview,
}: {
  columns: { item: EquipmentListItem; quantity: number; selected: boolean }[]
  unit: LengthUnit
  cargo: CargoLine[]
  cargoWeight: number
  cargoVolume: number
  bestId: string | null
  rankedIds: string[] | null
  focusId: string | null
  onPreview: (id: string) => void
}) {
  if (columns.length === 0 || cargo.length === 0) return null
  const rows: { icon: ComponentType<{ className?: string }>; label: string; cell: (column: (typeof columns)[number]) => ReactNode }[] = [
    { icon: Ruler, label: "Inside (L × W × H)", cell: ({ item }) => formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, unit) },
    { icon: Scale, label: "Max payload", cell: ({ item }) => formatKg(item.maxPayloadKg) },
    { icon: Boxes, label: "Volume", cell: ({ item }) => formatM3(innerM3(item)) },
    { icon: Hash, label: "Units", cell: ({ quantity, selected }) => (selected ? `${quantity} selected` : "1 (preview)") },
    { icon: Weight, label: "Weight use", cell: ({ item, quantity }) => <MiniBar pct={roughUse(item, quantity, cargoWeight, cargoVolume).weight} /> },
    { icon: Boxes, label: "Volume use", cell: ({ item, quantity }) => <MiniBar pct={roughUse(item, quantity, cargoWeight, cargoVolume).volume} /> },
    {
      icon: Check,
      label: "Lines that fit as entered",
      cell: ({ item }) => {
        const lines = linesThatFit(cargo, item)
        return (
          <span className={cn("inline-flex items-center gap-1.5 font-semibold", lines.fit === lines.total ? "text-primary dark:text-[var(--step-done-fg)]" : "text-amber-700 dark:text-amber-400")}>
            {lines.fit === lines.total ? <Check className="size-4" strokeWidth={3} /> : <AlertTriangle className="size-4" />}
            {lines.fit} of {lines.total}
          </span>
        )
      },
    },
    { icon: Calculator, label: "Rough need on its own", cell: ({ item }) => `${roughNeed(item, cargoWeight, cargoVolume)} unit${roughNeed(item, cargoWeight, cargoVolume) === 1 ? "" : "s"}` },
    {
      icon: Sparkles,
      label: "Best-fit check",
      cell: ({ item }) => {
        if (!rankedIds) return <span className="text-muted-foreground">Not run</span>
        if (item.id === bestId) return <StatusPill tone="success">Best fit</StatusPill>
        const rank = rankedIds.indexOf(item.id)
        return rank >= 0 ? <StatusPill tone="info">Ranked {rank + 1}</StatusPill> : <span className="text-muted-foreground">Not compared</span>
      },
    },
  ]
  return (
    <SectionCard banded icon={Scale} title="Compare equipment" description="Selected types and the one you are previewing, with the same rough weight and volume checks. They do not prove a geometric fit: calculate the plan for that.">
      <div className="overflow-x-auto">
        <table className="data-table w-full text-left text-sm" style={{ minWidth: `${16 + columns.length * 15}rem` }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] w-60 px-4">Parameter</th>
              {columns.map(({ item, selected }) => (
                <th key={item.id} className={cn("px-4", item.id === focusId && "bg-white/40 dark:bg-white/5")}>
                  <button type="button" onClick={() => onPreview(item.id)} className={cn("flex items-center gap-2.5 rounded-lg text-left", FOCUS_RING)} title="Preview">
                    <IconTile icon={TRANSPORT_ICON[item.mode]} tint={TRANSPORT_TINT[item.mode]} size="sm" className="size-9 rounded-lg [&_svg]:size-[18px]" />
                    <span>
                      <span className="block text-[15px] leading-5">{item.name}</span>
                      <span className="block text-xs font-medium opacity-75">{selected ? "Selected" : "Preview"}</span>
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const Icon = row.icon
              return (
                <tr key={row.label} className="border-t">
                  <td className="sticky left-0 z-[1] px-4 py-3">
                    <span className="flex items-center gap-2.5 font-medium">
                      <Icon className="size-4 shrink-0 text-[var(--table-head-fg)]" aria-hidden="true" />
                      {row.label}
                    </span>
                  </td>
                  {columns.map((column) => (
                    <td key={column.item.id} className={cn("px-4 py-3 tabular-nums", column.item.id === bestId && "bg-[var(--pastel-mint-bg)]/60")}>
                      {row.cell(column)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
