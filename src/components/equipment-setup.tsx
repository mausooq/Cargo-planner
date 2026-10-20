"use client"

import { forwardRef, useImperativeHandle, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import { modeLabel, type EquipmentMode } from "@compass/domain"
import { toast } from "sonner"
import { setProjectEquipment } from "@/app/actions/projects"
import { EquipmentViewer } from "@/components/equipment-viewer"
import { StepLoader } from "@/components/step-loader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MODE_ORDER, type EquipmentListItem } from "@/lib/equipment-catalog"
import { formatEnvelope, formatKg } from "@/lib/format"
import { cn } from "@/lib/utils"

export type EquipmentChoice = {
  equipmentTypeId: string
  role: "PRIMARY" | "SECONDARY"
  maxCount: number | null
}

export type EquipmentSetupHandle = {
  save: () => Promise<boolean>
  hasSelection: () => boolean
}

type SelectedUnit = { equipmentTypeId: string; quantity: number }

export const EquipmentSetup = forwardRef<
  EquipmentSetupHandle,
  {
    projectId: string
    items: EquipmentListItem[]
    initial: EquipmentChoice[]
    canEdit: boolean
    projectMode: EquipmentMode
  }
>(function EquipmentSetup({ projectId, items, initial, canEdit, projectMode }, ref) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<EquipmentMode | "ALL">(projectMode)
  const [units, setUnits] = useState<SelectedUnit[]>(
    initial.map((choice) => ({
      equipmentTypeId: choice.equipmentTypeId,
      quantity: choice.maxCount && choice.maxCount > 0 ? choice.maxCount : 1,
    })),
  )
  const [focusId, setFocusId] = useState<string | null>(units[0]?.equipmentTypeId ?? null)
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((item) => {
      if (mode !== "ALL" && item.mode !== mode) return false
      if (!needle) return true
      return [item.name, item.code, item.externalId ?? ""].join(" ").toLowerCase().includes(needle)
    })
  }, [items, mode, query])

  const selected = items.find((item) => item.id === focusId) ?? null

  function add(item: EquipmentListItem) {
    setUnits((current) => {
      if (current.some((unit) => unit.equipmentTypeId === item.id)) return current
      return [...current, { equipmentTypeId: item.id, quantity: 1 }]
    })
    setFocusId(item.id)
  }

  function remove(id: string) {
    setUnits((current) => current.filter((unit) => unit.equipmentTypeId !== id))
    setFocusId((current) => (current === id ? null : current))
  }

  function setQuantity(id: string, quantity: number) {
    setUnits((current) =>
      current.map((unit) => (unit.equipmentTypeId === id ? { ...unit, quantity: Math.max(1, quantity) } : unit)),
    )
  }

  async function save() {
    if (units.length === 0) {
      toast.error("Pick at least one container, ULD, or truck.")
      return false
    }
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
    toast.success("Equipment saved.")
    router.refresh()
    return true
  }

  useImperativeHandle(ref, () => ({
    save,
    hasSelection: () => units.length > 0,
  }))

  return (
    <div className="relative grid gap-6 lg:grid-cols-[1fr_28rem]">
      {saving ? <StepLoader label="Saving equipment…" /> : null}
      <section className="rounded-md border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          {(["ALL", ...MODE_ORDER] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setMode(entry)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                mode === entry ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {entry === "ALL" ? "All" : modeLabel(entry)}
            </button>
          ))}
          <div className="relative ml-auto min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search containers, ULDs, trucks"
              className="pl-9"
            />
          </div>
        </div>
        <ul className="max-h-[calc(100vh-16rem)] divide-y overflow-y-auto">
          {filtered.map((item) => {
            const chosen = units.some((unit) => unit.equipmentTypeId === item.id)
            return (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cn("size-2 rounded-full", chosen ? "bg-primary" : "bg-border")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm)} · {formatKg(item.maxPayloadKg)}
                  </span>
                </span>
                {canEdit ? (
                  <Button type="button" size="sm" variant={chosen ? "default" : "outline"} onClick={() => add(item)}>
                    {chosen ? "Added" : "Add"}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>

      <aside className="space-y-4">
        <section className="rounded-md border bg-card p-4">
          <h2 className="text-sm font-semibold">Project equipment</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Add each container type, then set how many. Use 4 or 5 for several of the same container.
          </p>
          {units.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nothing selected yet.</p>
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
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      Qty
                      <input
                        type="number"
                        min={1}
                        value={unit.quantity}
                        disabled={!canEdit}
                        onChange={(event) => setQuantity(unit.equipmentTypeId, Number(event.target.value) || 1)}
                        className="h-8 w-16 rounded-md border bg-background px-2 text-sm text-foreground"
                        aria-label={`How many ${item.name}`}
                      />
                    </label>
                    {canEdit ? (
                      <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${item.name}`} onClick={() => remove(unit.equipmentTypeId)}>
                        <X className="size-4" />
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {canEdit ? (
            <Button type="button" className="mt-4 w-full" size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save equipment"}
            </Button>
          ) : null}
        </section>
        {selected ? <EquipmentViewer item={selected} className="h-72 overflow-hidden rounded-md border bg-white" /> : null}
      </aside>
    </div>
  )
})
