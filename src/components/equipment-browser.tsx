"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ClipboardCopy, Maximize2, Pencil, Plus, Search } from "lucide-react"
import { modeLabel, type EquipmentMode } from "@compass/domain"
import { toast } from "sonner"
import { importEquipmentCsv } from "@/app/actions/equipment"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EquipmentForm } from "@/components/equipment-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { MODE_ORDER, type EquipmentListItem } from "@/lib/equipment-catalog"
import {
  defaultDir,
  readEquipmentFilters,
  writeEquipmentFilters,
  type EquipmentFilters,
  type LibrarySort,
} from "@/lib/equipment-filters"
import { downloadEquipmentFile } from "@/lib/equipment-export"
import { cargoFitsEquipment, type FitCargo } from "@/lib/equipment-fit"
import { equipmentVolumeM3 } from "@/lib/equipment-metrics"
import type { LengthUnit } from "@/lib/cargo-units"
import { useLengthUnit } from "@/lib/length-unit-pref"
import { formatCm, formatCost, formatEnvelope, formatKg, formatM3 } from "@/lib/format"
import { cn } from "@/lib/utils"
import { AddToProjectDialog, type ProjectOption } from "@/components/add-to-project-dialog"
import { EquipmentViewer } from "@/components/equipment-viewer"
import { equipmentFormKey } from "@/lib/equipment-form-key"
import { useEquipmentLibrary } from "@/stores/equipment-library"

export function EquipmentBrowser({
  items,
  canManage,
  canEditProjects = false,
  projects = [],
}: {
  items: EquipmentListItem[]
  canManage: boolean
  canEditProjects?: boolean
  projects?: ProjectOption[]
}) {
  const unit = useLengthUnit()
  const selectedId = useEquipmentLibrary((state) => state.selectedId)
  const setSelectedId = useEquipmentLibrary((state) => state.setSelectedId)
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const filters = useMemo(() => readEquipmentFilters(searchParams), [searchParams])

  function patchFilters(next: Partial<EquipmentFilters>) {
    const params = new URLSearchParams(searchParams.toString())
    writeEquipmentFilters(params, { ...filters, ...next })
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const counts = useMemo(() => {
    const next: Record<EquipmentMode, number> = { SEA: 0, AIR: 0, ROAD: 0, PALLET: 0 }
    for (const item of items) next[item.mode] += 1
    return next
  }, [items])

  const filtered = useMemo(() => {
    const needle = filters.query.trim().toLowerCase()
    const next = items.filter((item) => {
      if (filters.mode !== "ALL" && item.mode !== filters.mode) return false
      if (filters.openOnly && !item.heightOpen) return false
      if (filters.oogOnly && item.oogClass === "NONE") return false
      if (filters.lengthMin != null && item.innerLengthCm < filters.lengthMin) return false
      if (filters.lengthMax != null && item.innerLengthCm > filters.lengthMax) return false
      if (filters.payloadMin != null && item.maxPayloadKg < filters.payloadMin) return false
      if (filters.payloadMax != null && item.maxPayloadKg > filters.payloadMax) return false
      if (!needle) return true
      const haystack = [item.name, item.code, item.externalId ?? "", item.sizeLabel ?? "", item.mode]
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
    next.sort((left, right) => compareItems(left, right, filters.sort, filters.dir))
    return next
  }, [filters, items])

  const [stageOpen, setStageOpen] = useState(false)
  const [editor, setEditor] = useState<"create" | "edit" | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [fit, setFit] = useState<FitCargo | null>(null)
  const [importReport, setImportReport] = useState<{ created: number; errors: { row: number; message: string }[] } | null>(null)
  const [importing, setImporting] = useState(false)
  const visibleId = filtered.some((item) => item.id === selectedId) ? selectedId : (filtered[0]?.id ?? null)
  if (visibleId !== selectedId) setSelectedId(visibleId)
  const [trackedSelection, setTrackedSelection] = useState(visibleId)
  if (trackedSelection !== visibleId) {
    setTrackedSelection(visibleId)
    setEditor(null)
  }
  const selected = filtered.find((item) => item.id === visibleId) ?? null

  function toggleCompare(id: string) {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id)
      if (current.length >= 4) {
        toast.error("Compare up to 4 units.")
        return current
      }
      return [...current, id]
    })
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      document.getElementById("equipment-search")?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const groups = MODE_ORDER.map((entry) => ({
    mode: entry,
    items: filtered.filter((item) => item.mode === entry),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_32rem]">
      <section className="space-y-4">
        <div className="flex flex-col gap-3 rounded-md border bg-card p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Label htmlFor="equipment-search" className="sr-only">
              Search equipment
            </Label>
            <Input
              id="equipment-search"
              value={filters.query}
              onChange={(event) => patchFilters({ query: event.target.value })}
              placeholder="Search name, code, or workbook id"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by mode">
            <FilterChip on={filters.mode === "ALL"} onClick={() => patchFilters({ mode: "ALL" })}>
              All {items.length}
            </FilterChip>
            {MODE_ORDER.map((entry) => (
              <FilterChip key={entry} on={filters.mode === entry} onClick={() => patchFilters({ mode: entry })}>
                {modeLabel(entry)} {counts[entry]}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <RangeField
              label="Length from (cm)"
              value={filters.lengthMin}
              onChange={(lengthMin) => patchFilters({ lengthMin })}
            />
            <RangeField
              label="Length to (cm)"
              value={filters.lengthMax}
              onChange={(lengthMax) => patchFilters({ lengthMax })}
            />
            <RangeField
              label="Payload from (kg)"
              value={filters.payloadMin}
              onChange={(payloadMin) => patchFilters({ payloadMin })}
            />
            <RangeField
              label="Payload to (kg)"
              value={filters.payloadMax}
              onChange={(payloadMax) => patchFilters({ payloadMax })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={filters.openOnly} onCheckedChange={(openOnly) => patchFilters({ openOnly })} id="open-height" />
              Open height
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={filters.oogOnly} onCheckedChange={(oogOnly) => patchFilters({ oogOnly })} id="oog-only" />
              Out of gauge
            </label>
            <div className="flex items-center gap-1" role="group" aria-label="List or table">
              <FilterChip on={filters.view === "list"} onClick={() => patchFilters({ view: "list" })}>
                List
              </FilterChip>
              <FilterChip on={filters.view === "table"} onClick={() => patchFilters({ view: "table" })}>
                Table
              </FilterChip>
            </div>
            {canManage ? (
              <Button type="button" size="sm" className="ml-auto" onClick={() => setEditor("create")}>
                <Plus className="size-3.5" />
                Add equipment
              </Button>
            ) : null}
            <label className={cn("flex items-center gap-2 text-sm", !canManage && "ml-auto")}>
              <span className="text-muted-foreground">Sort</span>
              <select
                value={filters.sort}
                onChange={(event) => {
                  const sort = event.target.value as LibrarySort
                  patchFilters({ sort, dir: defaultDir(sort) })
                }}
                className="h-8 rounded-md border bg-background px-2 text-sm"
                aria-label="Sort equipment"
              >
                <option value="name">Name</option>
                <option value="type">Type</option>
                <option value="length">Length</option>
                <option value="volume">Volume</option>
                <option value="payload">Payload</option>
                <option value="tare">Tare</option>
                <option value="door">Door</option>
              </select>
            </label>
          </div>
          <ActiveFilters filters={filters} onPatch={patchFilters} />
        </div>

        <FitPanel onChange={setFit} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => downloadEquipmentFile(filtered, "csv")}>
            Export CSV
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => downloadEquipmentFile(filtered, "xlsx")}>
            Export XLSX
          </Button>
          {canManage ? (
            <label className="inline-flex cursor-pointer items-center rounded-md border bg-background px-3 text-sm h-8">
              {importing ? "Importing…" : "Import CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={importing}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ""
                  if (file) void importCsv(file, setImporting, setImportReport)
                }}
              />
            </label>
          ) : null}
          {compareIds.length > 0 ? (
            <Link
              href={`/equipment/compare?ids=${compareIds.join(",")}`}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground"
            >
              Compare {compareIds.length}
            </Link>
          ) : null}
        </div>
        {importReport ? (
          <div className="rounded-md border bg-card p-3 text-sm" aria-live="polite">
            <p>
              Created {importReport.created}. {importReport.errors.length} {importReport.errors.length === 1 ? "row" : "rows"} failed.
            </p>
            {importReport.errors.length > 0 ? (
              <ul className="mt-2 space-y-1 text-destructive">
                {importReport.errors.map((issue) => (
                  <li key={`${issue.row}-${issue.message}`}>
                    Row {issue.row}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Showing {filtered.length} of {items.length} sea, air, road, and pallet units · press / to search.
        </p>
        {editor === "create" && canManage ? (
          <EquipmentForm key={equipmentFormKey(null)} onClose={() => setEditor(null)} onSaved={setSelectedId} />
        ) : null}

        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed bg-card px-4 py-8 text-center">
            <p className="text-sm font-medium">Nothing matches</p>
            <p className="mt-1 text-sm text-muted-foreground">Clear a filter or search for another name.</p>
          </div>
        ) : filters.view === "table" ? (
          <EquipmentTable
            items={filtered}
            selectedId={visibleId}
            sort={filters.sort}
            dir={filters.dir}
            compareIds={compareIds}
            fit={fit}
            onCompare={toggleCompare}
            onSelect={setSelectedId}
            onSort={(sort) => {
              if (filters.sort === sort) patchFilters({ dir: filters.dir === "asc" ? "desc" : "asc" })
              else patchFilters({ sort, dir: defaultDir(sort) })
            }}
          />
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.mode} aria-labelledby={`mode-${group.mode}`}>
                <h2 id={`mode-${group.mode}`} className="mb-2 text-sm font-semibold">
                  {modeLabel(group.mode)}
                </h2>
                <ul className="divide-y overflow-hidden rounded-md border bg-card">
                  {group.items.map((item) => {
                    const isSelected = item.id === visibleId
                    const fits = fit ? cargoFitsEquipment(fit, item) : false
                    return (
                      <li key={item.id} className={cn("flex items-stretch", fits && "bg-emerald-50 ring-2 ring-inset ring-emerald-800")}>
                        <label className="flex items-center px-3">
                          <input
                            type="checkbox"
                            checked={compareIds.includes(item.id)}
                            onChange={() => toggleCompare(item.id)}
                            aria-label={`Compare ${item.name}`}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setSelectedId(item.id)}
                          aria-pressed={isSelected}
                          className={cn(
                            "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/70 sm:flex-row sm:items-center sm:justify-between",
                            isSelected && "bg-muted",
                          )}
                        >
                          <span>
                            <span className="block font-medium">{item.name}</span>
                            <span className="text-sm text-muted-foreground">
                              {formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, unit)}
                              {item.heightOpen ? " · open height" : ""}
                            </span>
                          </span>
                          <span className="text-sm text-muted-foreground sm:text-right">
                            {fits ? <span className="mr-2 font-medium text-emerald-950">Fits</span> : null}
                            {formatKg(item.maxPayloadKg)} payload
                            {item.axleGroups.length > 0 ? ` · ${item.axleGroups.length} axle groups` : ""}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        {selected ? (
          <EquipmentDetail
            item={selected}
            onOpen={() => setStageOpen(true)}
            hidePreview={stageOpen}
            canManage={canManage}
            canEditProjects={canEditProjects}
            projects={projects}
            editing={editor === "edit"}
            onEdit={() => setEditor("edit")}
            onCloseEdit={() => setEditor(null)}
            onSaved={setSelectedId}
          />
        ) : (
          <EmptyDetail />
        )}
      </aside>
      {selected ? <EquipmentStage item={selected} open={stageOpen} onClose={() => setStageOpen(false)} /> : null}
    </div>
  )
}

function FilterChip({
  on,
  className,
  children,
  onClick,
}: {
  on: boolean
  className?: string
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-on={on}
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors data-[on=false]:bg-background data-[on=false]:hover:bg-muted data-[on=true]:border-transparent data-[on=true]:bg-primary data-[on=true]:text-primary-foreground",
        className,
      )}
    >
      {children}
    </button>
  )
}

function EmptyDetail() {
  return (
    <div className="rounded-md border border-dashed bg-card p-4">
      <p className="text-sm font-medium">Select a type</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Payload, tare, axle groups, and the planning envelope show up here. Length runs from the front bulkhead
        toward the doors.
      </p>
    </div>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return target.isContentEditable
}

function EquipmentStage({ item, open, onClose }: { item: EquipmentListItem; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="flex h-[min(90vh,56rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogDescription>{modeLabel(item.mode)}</DialogDescription>
          <DialogTitle>{item.name}</DialogTitle>
          <DimensionLegend lengthCm={item.innerLengthCm} widthCm={item.innerWidthCm} heightCm={item.innerHeightCm} />
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <EquipmentViewer item={item} className="h-full w-full bg-white" />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EquipmentDetail({
  item,
  onOpen,
  hidePreview,
  canManage,
  canEditProjects,
  projects,
  editing,
  onEdit,
  onCloseEdit,
  onSaved,
}: {
  item: EquipmentListItem
  onOpen: () => void
  hidePreview?: boolean
  canManage: boolean
  canEditProjects: boolean
  projects: ProjectOption[]
  editing: boolean
  onEdit: () => void
  onCloseEdit: () => void
  onSaved: (id: string) => void
}) {
  const unit = useLengthUnit()
  if (editing && canManage) {
    return <EquipmentForm key={equipmentFormKey(item)} item={item} onClose={onCloseEdit} onSaved={onSaved} />
  }
  return (
    <article className="space-y-3 rounded-md border bg-card p-4">
      <div>
        <p className="text-xs text-muted-foreground">{modeLabel(item.mode)}</p>
        <h2 className="mt-0.5 text-base font-semibold leading-tight">{item.name}</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{item.code}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canEditProjects ? (
            <AddToProjectDialog equipmentTypeId={item.id} equipmentName={item.name} projects={projects} />
          ) : null}
          {canManage ? (
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-xs text-primary">
              <Pencil className="size-3.5" />
              Edit dimensions
            </button>
          ) : null}
          <button type="button" onClick={() => copySpecs(item, unit)} className="inline-flex items-center gap-1 text-xs text-primary">
            <ClipboardCopy className="size-3.5" />
            Copy specs
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {item.heightOpen ? <Badge variant="secondary">Open height</Badge> : <Badge variant="outline">Rated height</Badge>}
        {item.oogClass !== "NONE" ? <Badge variant="outline">{item.oogClass}</Badge> : null}
        {item.floors > 1 ? <Badge variant="outline">{item.floors} floors</Badge> : null}
        {item.extendable ? <Badge variant="outline">Extendable</Badge> : null}
        {item.isCustom ? <Badge>Custom</Badge> : <Badge variant="secondary">System</Badge>}
      </div>

      <DimensionLegend lengthCm={item.innerLengthCm} widthCm={item.innerWidthCm} heightCm={item.innerHeightCm} />
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Spec label="Payload" value={formatKg(item.maxPayloadKg)} />
        <Spec label="Tare" value={formatKg(item.tareKg)} />
        <Spec label="Reference gross" value={formatKg(item.grossKg)} />
        <Spec label="Planning cost" value={formatCost(item.costPerUnit)} />
        {item.doorWidthCm && item.doorHeightCm ? (
          <Spec label="Door" value={`${formatCm(item.doorWidthCm, unit)} × ${formatCm(item.doorHeightCm, unit)}`} />
        ) : null}
        <Spec label="Workbook id" value={item.externalId ?? "—"} />
        <Spec label="Used in" value={`${item.projectCount} ${item.projectCount === 1 ? "project" : "projects"}`} />
      </dl>
      {item.sizeLabel ? <p className="text-xs text-muted-foreground">Source size: {item.sizeLabel}</p> : null}
      {item.extendable && item.maxExtendedLengthCm ? (
        <p className="text-sm">Extends to {formatCm(item.maxExtendedLengthCm, unit)}.</p>
      ) : null}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">3D shape</p>
          <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-xs text-primary">
            <Maximize2 className="size-3.5" />
            Open large view
          </button>
        </div>
        {hidePreview ? (
          <div className="flex h-64 items-center justify-center rounded-md border text-sm text-muted-foreground">
            Large view is open
          </div>
        ) : (
          <EquipmentViewer item={item} className="h-72 w-full overflow-hidden rounded-md border bg-white" />
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          L, W, and H badges name each dimension. Colour repeats the same labels in the 3D view.
        </p>
      </div>

      {item.axleGroups.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {item.axleGroups.map((axle) => (
            <li key={axle.name} className="flex items-baseline justify-between gap-3">
              <span>{axle.name}</span>
              <span className="text-muted-foreground">
                {formatCm(axle.positionFromFrontCm, unit)} · {formatKg(axle.maxKg)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No axle groups on this type.</p>
      )}

      {item.notes ? <p className="text-sm leading-6 text-muted-foreground">{item.notes}</p> : null}
    </article>
  )
}

function DimensionLegend({
  lengthCm,
  widthCm,
  heightCm,
}: {
  lengthCm: number
  widthCm: number
  heightCm: number
}) {
  const unit = useLengthUnit()
  return (
    <p className="flex flex-wrap gap-2 text-sm font-medium">
      <DimensionBadge letter="L" label="Length" value={formatCm(lengthCm, unit)} className="bg-amber-950 text-amber-50" />
      <DimensionBadge letter="W" label="Width" value={formatCm(widthCm, unit)} className="bg-blue-900 text-blue-50" />
      <DimensionBadge letter="H" label="Height" value={formatCm(heightCm, unit)} className="bg-violet-950 text-violet-50" />
    </p>
  )
}

function DimensionBadge({
  letter,
  label,
  value,
  className,
}: {
  letter: string
  label: string
  value: string
  className: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5", className)}>
      <span className="rounded bg-white px-1 text-[11px] font-bold text-neutral-950">{letter}</span>
      <span>
        {label} {value}
      </span>
    </span>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function compareItems(left: EquipmentListItem, right: EquipmentListItem, sort: LibrarySort, dir: "asc" | "desc"): number {
  const sign = dir === "asc" ? 1 : -1
  if (sort === "name") return left.name.localeCompare(right.name) * sign
  if (sort === "type") {
    const delta = MODE_ORDER.indexOf(left.mode) - MODE_ORDER.indexOf(right.mode)
    if (delta !== 0) return delta * sign
  } else {
    const delta = sortValue(left, sort) - sortValue(right, sort)
    if (delta !== 0) return delta * sign
  }
  return left.name.localeCompare(right.name)
}

function sortValue(item: EquipmentListItem, sort: LibrarySort): number {
  if (sort === "length") return item.innerLengthCm
  if (sort === "volume") return equipmentVolumeM3(item)
  if (sort === "payload") return item.maxPayloadKg
  if (sort === "tare") return item.tareKg
  if (sort === "door") return item.doorWidthCm ?? 0
  return 0
}

function formatDoor(item: EquipmentListItem, unit: LengthUnit): string {
  if (item.doorWidthCm && item.doorHeightCm) return `${formatCm(item.doorWidthCm, unit)} × ${formatCm(item.doorHeightCm, unit)}`
  return "—"
}

async function copySpecs(item: EquipmentListItem, unit: LengthUnit) {
  const lines = [
    item.name,
    item.code,
    `Type ${modeLabel(item.mode)}`,
    `L × W × H ${formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, unit)}`,
    `Volume ${formatM3(equipmentVolumeM3(item))}`,
    `Payload ${formatKg(item.maxPayloadKg)}`,
    `Tare ${formatKg(item.tareKg)}`,
    `Door ${formatDoor(item, unit)}`,
  ]
  try {
    await navigator.clipboard.writeText(lines.join("\n"))
    toast.success("Specs copied.")
  } catch {
    toast.error("Could not copy specs.")
  }
}

function FitPanel({ onChange }: { onChange: (cargo: FitCargo | null) => void }) {
  const [lengthCm, setLengthCm] = useState("")
  const [widthCm, setWidthCm] = useState("")
  const [heightCm, setHeightCm] = useState("")
  const [weightKg, setWeightKg] = useState("")
  const cargo = readFit(lengthCm, widthCm, heightCm, weightKg)
  function update(next: { lengthCm?: string; widthCm?: string; heightCm?: string; weightKg?: string }) {
    const length = next.lengthCm ?? lengthCm
    const width = next.widthCm ?? widthCm
    const height = next.heightCm ?? heightCm
    const weight = next.weightKg ?? weightKg
    if (next.lengthCm != null) setLengthCm(next.lengthCm)
    if (next.widthCm != null) setWidthCm(next.widthCm)
    if (next.heightCm != null) setHeightCm(next.heightCm)
    if (next.weightKg != null) setWeightKg(next.weightKg)
    onChange(readFit(length, width, height, weight))
  }
  return (
    <form className="grid gap-3 rounded-md border bg-card p-3 sm:grid-cols-4" onSubmit={(event) => event.preventDefault()}>
      <p className="text-sm font-medium sm:col-span-4">Will it fit?</p>
      <FitInput label="Cargo length (cm)" value={lengthCm} onChange={(lengthCm) => update({ lengthCm })} />
      <FitInput label="Cargo width (cm)" value={widthCm} onChange={(widthCm) => update({ widthCm })} />
      <FitInput label="Cargo height (cm)" value={heightCm} onChange={(heightCm) => update({ heightCm })} />
      <FitInput label="Cargo weight (kg)" value={weightKg} onChange={(weightKg) => update({ weightKg })} />
      <p className="text-xs text-muted-foreground sm:col-span-4">
        {cargo ? "Units that can take this cargo, including the door, are highlighted." : "Enter length, width, height, and weight to highlight units that fit."}
      </p>
    </form>
  )
}

function FitInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-")
  return (
    <label className="space-y-1 text-xs text-muted-foreground" htmlFor={id}>
      <span className="block">{label}</span>
      <Input id={id} type="number" min="0.1" step="0.1" value={value} onChange={(event) => onChange(event.target.value)} className="h-8" />
    </label>
  )
}

function readFit(lengthCm: string, widthCm: string, heightCm: string, weightKg: string): FitCargo | null {
  const cargo = {
    lengthCm: Number(lengthCm),
    widthCm: Number(widthCm),
    heightCm: Number(heightCm),
    weightKg: Number(weightKg),
  }
  if (Object.values(cargo).some((value) => !Number.isFinite(value) || value <= 0)) return null
  return cargo
}

async function importCsv(
  file: File,
  setImporting: (value: boolean) => void,
  setReport: (report: { created: number; errors: { row: number; message: string }[] } | null) => void,
) {
  setImporting(true)
  const text = await file.text()
  const result = await importEquipmentCsv(text)
  setImporting(false)
  if (!result.ok) {
    toast.error(result.error)
    return
  }
  setReport({ created: result.created, errors: result.errors })
  toast.success(result.created === 1 ? "Imported 1 unit." : `Imported ${result.created} units.`)
}

function RangeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-")
  return (
    <label className="space-y-1 text-xs text-muted-foreground" htmlFor={id}>
      <span className="block">{label}</span>
      <Input
        id={id}
        type="number"
        min="0"
        step="0.1"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        className="h-8 w-28"
      />
    </label>
  )
}

function ActiveFilters({
  filters,
  onPatch,
}: {
  filters: EquipmentFilters
  onPatch: (next: Partial<EquipmentFilters>) => void
}) {
  const chips: { key: string; label: string; clear: Partial<EquipmentFilters> }[] = []
  if (filters.query.trim()) chips.push({ key: "q", label: `Search · ${filters.query.trim()}`, clear: { query: "" } })
  if (filters.mode !== "ALL") chips.push({ key: "mode", label: modeLabel(filters.mode), clear: { mode: "ALL" } })
  if (filters.openOnly) chips.push({ key: "open", label: "Open height", clear: { openOnly: false } })
  if (filters.oogOnly) chips.push({ key: "oog", label: "Out of gauge", clear: { oogOnly: false } })
  if (filters.lengthMin != null || filters.lengthMax != null) {
    chips.push({
      key: "length",
      label: `Length ${filters.lengthMin ?? "—"}–${filters.lengthMax ?? "—"} cm`,
      clear: { lengthMin: null, lengthMax: null },
    })
  }
  if (filters.payloadMin != null || filters.payloadMax != null) {
    chips.push({
      key: "payload",
      label: `Payload ${filters.payloadMin ?? "—"}–${filters.payloadMax ?? "—"} kg`,
      clear: { payloadMin: null, payloadMax: null },
    })
  }
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onPatch(chip.clear)}
          className="rounded-md border bg-muted px-2 py-1 text-xs"
        >
          {chip.label} <span aria-hidden="true">×</span>
          <span className="sr-only">Remove {chip.label}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() =>
          onPatch({
            query: "",
            mode: "ALL",
            openOnly: false,
            oogOnly: false,
            lengthMin: null,
            lengthMax: null,
            payloadMin: null,
            payloadMax: null,
          })
        }
        className="text-xs font-medium text-primary"
      >
        Clear all
      </button>
    </div>
  )
}

function EquipmentTable({
  items,
  selectedId,
  sort,
  dir,
  compareIds,
  fit,
  onCompare,
  onSelect,
  onSort,
}: {
  items: EquipmentListItem[]
  selectedId: string | null
  sort: LibrarySort
  dir: "asc" | "desc"
  compareIds: string[]
  fit: FitCargo | null
  onCompare: (id: string) => void
  onSelect: (id: string) => void
  onSort: (sort: LibrarySort) => void
}) {
  const unit = useLengthUnit()
  const columns: { key: LibrarySort; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "length", label: "L × W × H" },
    { key: "volume", label: "Volume m³" },
    { key: "payload", label: "Payload" },
    { key: "tare", label: "Tare" },
    { key: "door", label: "Door" },
  ]
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-3 py-2 font-medium">
              <span className="sr-only">Compare</span>
            </th>
            {columns.map((column) => (
              <th key={column.key} className="px-3 py-2 font-medium" aria-sort={sort === column.key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="inline-flex items-center gap-1" onClick={() => onSort(column.key)}>
                  {column.label}
                  {sort === column.key ? <span aria-hidden="true">{dir === "asc" ? "↑" : "↓"}</span> : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const selected = item.id === selectedId
            const fits = fit ? cargoFitsEquipment(fit, item) : false
            return (
              <tr
                key={item.id}
                tabIndex={0}
                aria-selected={selected}
                className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/70", selected && "bg-muted", fits && "bg-emerald-50 ring-2 ring-inset ring-emerald-800")}
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onSelect(item.id)
                  }
                }}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={compareIds.includes(item.id)}
                    aria-label={`Compare ${item.name}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => onCompare(item.id)}
                  />
                </td>
                <td className="px-3 py-2 font-medium">
                  {item.name}
                  {fits ? <span className="ml-2 font-medium text-emerald-950">Fits</span> : null}
                </td>
                <td className="px-3 py-2">{modeLabel(item.mode)}</td>
                <td className="px-3 py-2">{formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, unit)}</td>
                <td className="px-3 py-2">{formatM3(equipmentVolumeM3(item))}</td>
                <td className="px-3 py-2">{formatKg(item.maxPayloadKg)}</td>
                <td className="px-3 py-2">{formatKg(item.tareKg)}</td>
                <td className="px-3 py-2">{formatDoor(item, unit)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
