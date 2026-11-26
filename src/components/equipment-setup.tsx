"use client"

import { forwardRef, useImperativeHandle, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Minus, Plus, Search, X } from "lucide-react"
import { modeLabel, type EquipmentMode } from "@compass/domain"
import { toast } from "sonner"
import { setProjectEquipment } from "@/app/actions/projects"
import type { CargoLine } from "@/components/cargo-grid"
import { EquipmentSuggestions } from "@/components/equipment-suggestions"
import { EquipmentViewer } from "@/components/equipment-viewer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MODE_ORDER, type EquipmentListItem } from "@/lib/equipment-catalog"
import { useLengthUnit } from "@/lib/length-unit-pref"
import { formatEnvelope, formatKg, formatM3, formatPct } from "@/lib/format"
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
    const byVolume = cargoTotals.volume / Math.max(innerM3(item) * USABLE_VOLUME, 0.001)
    const byWeight = item.maxPayloadKg > 0 ? cargoTotals.weight / item.maxPayloadKg : 0
    return Math.max(1, Math.ceil(Math.max(byVolume, byWeight)))
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

  return (
    <div className="space-y-4">
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
      />
    <div className="relative grid gap-6 lg:grid-cols-[1fr_28rem]">
      <section className="rounded-md border bg-card" aria-label="Equipment library">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by mode">
            {(["ALL", ...MODE_ORDER] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                aria-pressed={mode === entry}
                onClick={() => setMode(entry)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  mode === entry ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {entry === "ALL" ? "All" : modeLabel(entry)}
              </button>
            ))}
          </div>
          <div className="relative ml-auto min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or code, e.g. 40HC"
              aria-label="Search equipment"
              className="pl-9"
            />
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
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
          <ul className="max-h-[calc(100vh-16rem)] divide-y overflow-y-auto">
            {filtered.map((item) => {
              const chosen = units.some((unit) => unit.equipmentTypeId === item.id)
              return (
                <li
                  key={item.id}
                  className={cn("flex items-center gap-3 px-4 py-2.5", focusId === item.id && "bg-muted/50")}
                >
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setFocusId(item.id)}>
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, unit)} · {formatM3(innerM3(item))} ·{" "}
                      {formatKg(item.maxPayloadKg)} payload
                    </span>
                  </button>
                  {canEdit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={chosen ? "secondary" : "outline"}
                      aria-pressed={chosen}
                      aria-label={chosen ? `Remove ${item.name}` : `Add ${item.name}`}
                      onClick={() => toggle(item)}
                      className="group w-24"
                    >
                      {chosen ? (
                        <>
                          <Check className="size-3.5 group-hover:hidden" />
                          <X className="hidden size-3.5 group-hover:block" />
                          <span className="group-hover:hidden">Added</span>
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
                    <span className="text-xs text-muted-foreground">In project</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <aside className="space-y-4">
        <section className="rounded-md border bg-card p-4" aria-label="Project equipment">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Project equipment</h2>
            {dirty ? <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Unsaved changes</span> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Add each type you may use and set the most you can book. The planner uses only what it needs.
          </p>
          {units.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              Nothing selected yet. Click <span className="font-medium">Add</span> next to a container, ULD, or truck.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {units.map((unit) => {
                const item = items.find((entry) => entry.id === unit.equipmentTypeId)
                if (!item) return null
                return (
                  <li key={unit.equipmentTypeId} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setFocusId(item.id)}>
                      <span className="block truncate font-medium">{item.name}</span>
                      <span className="text-xs text-muted-foreground">{modeLabel(item.mode)}</span>
                    </button>
                    <QuantityStepper
                      label={`How many ${item.name}`}
                      value={unit.quantity}
                      disabled={!canEdit}
                      onChange={(quantity) => setQuantity(unit.equipmentTypeId, quantity)}
                    />
                    {canEdit ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Remove ${item.name}`}
                        onClick={() => remove(unit.equipmentTypeId)}
                      >
                        <X className="size-4" />
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}

          {cargoTotals.volume > 0 && units.length > 0 ? (
            <div className="mt-4 space-y-2 rounded-md bg-muted/50 p-3 text-xs">
              <p className="font-medium text-foreground">Rough capacity check</p>
              <CapacityBar
                label="Volume (usable)"
                used={formatM3(cargoTotals.volume)}
                total={formatM3(capacity.volume * USABLE_VOLUME)}
                pct={volumePct}
              />
              <CapacityBar label="Weight" used={formatKg(cargoTotals.weight)} total={formatKg(capacity.weight)} pct={weightPct} />
              {volumePct > 100 || weightPct > 100 ? (
                <p className="text-destructive">
                  Your cargo probably will not fit. Add more units or a larger type.
                  {units.length === 1 && units[0]
                    ? (() => {
                        const only = items.find((entry) => entry.id === units[0]?.equipmentTypeId)
                        return only ? ` About ${suggestedCount(only)}× ${only.name} would be needed.` : ""
                      })()
                    : ""}
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Volume assumes about {formatPct(USABLE_VOLUME * 100)} usable space. Calculate the plan for the exact fit.
                </p>
              )}
            </div>
          ) : null}

          {canEdit ? (
            <Button type="button" className="mt-4 w-full" size="sm" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Saving…" : dirty ? "Save equipment" : "Saved"}
            </Button>
          ) : null}
        </section>
        {selected ? (
          <section className="overflow-hidden rounded-md border bg-card" aria-label={`${selected.name} preview`}>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <p className="truncate text-sm font-medium">{selected.name}</p>
              <p className="shrink-0 text-xs text-muted-foreground">Drag to rotate</p>
            </div>
            <EquipmentViewer item={selected} className="h-72 bg-white" />
          </section>
        ) : null}
      </aside>
    </div>
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
    <div className="flex items-center rounded-md border" role="group" aria-label={label}>
      <button
        type="button"
        className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
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
        className="h-8 w-10 border-x bg-background text-center text-sm text-foreground outline-none"
      />
      <button
        type="button"
        className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
        aria-label="One more"
        disabled={disabled || value >= MAX_QTY}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

function CapacityBar({ label, used, total, pct }: { label: string; used: string; total: string; pct: number }) {
  const over = pct > 100
  return (
    <div>
      <div className="flex justify-between gap-2 text-muted-foreground">
        <span>{label}</span>
        <span className={cn(over && "font-medium text-destructive")}>
          {used} of {total} · {formatPct(pct)}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full rounded-full", over ? "bg-destructive" : pct > 85 ? "bg-amber-500" : "bg-primary")}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  )
}
