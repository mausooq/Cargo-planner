"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Maximize2, Pencil, Plus, Search, X } from "lucide-react"
import { modeLabel, type EquipmentMode } from "@compass/domain"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EquipmentForm } from "@/components/equipment-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { MODE_ORDER, type EquipmentListItem } from "@/lib/equipment-catalog"
import { DIMENSION_COLORS, formatCm, formatCost, formatEnvelope, formatKg } from "@/lib/format"
import { cn } from "@/lib/utils"
import { AddToProjectDialog, type ProjectOption } from "@/components/add-to-project-dialog"
import { EquipmentViewer } from "@/components/equipment-viewer"
import { equipmentFormKey } from "@/lib/equipment-form-key"
import { useEquipmentLibrary, type LibrarySort } from "@/stores/equipment-library"

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
  const query = useEquipmentLibrary((state) => state.query)
  const mode = useEquipmentLibrary((state) => state.mode)
  const openOnly = useEquipmentLibrary((state) => state.openOnly)
  const oogOnly = useEquipmentLibrary((state) => state.oogOnly)
  const sort = useEquipmentLibrary((state) => state.sort)
  const selectedId = useEquipmentLibrary((state) => state.selectedId)
  const setQuery = useEquipmentLibrary((state) => state.setQuery)
  const setMode = useEquipmentLibrary((state) => state.setMode)
  const setOpenOnly = useEquipmentLibrary((state) => state.setOpenOnly)
  const setOogOnly = useEquipmentLibrary((state) => state.setOogOnly)
  const setSort = useEquipmentLibrary((state) => state.setSort)
  const setSelectedId = useEquipmentLibrary((state) => state.setSelectedId)

  const counts = useMemo(() => {
    const next: Record<EquipmentMode, number> = { SEA: 0, AIR: 0, ROAD: 0, PALLET: 0 }
    for (const item of items) next[item.mode] += 1
    return next
  }, [items])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const next = items.filter((item) => {
      if (mode !== "ALL" && item.mode !== mode) return false
      if (openOnly && !item.heightOpen) return false
      if (oogOnly && item.oogClass === "NONE") return false
      if (!needle) return true
      const haystack = [item.name, item.code, item.externalId ?? "", item.sizeLabel ?? "", item.mode]
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
    next.sort((left, right) => compareItems(left, right, sort))
    return next
  }, [items, mode, oogOnly, openOnly, query, sort])

  const [stageOpen, setStageOpen] = useState(false)
  const [editor, setEditor] = useState<"create" | "edit" | null>(null)
  const visibleId = filtered.some((item) => item.id === selectedId) ? selectedId : (filtered[0]?.id ?? null)
  if (visibleId !== selectedId) setSelectedId(visibleId)
  const [trackedSelection, setTrackedSelection] = useState(visibleId)
  if (trackedSelection !== visibleId) {
    setTrackedSelection(visibleId)
    setEditor(null)
  }
  const selected = filtered.find((item) => item.id === visibleId) ?? null

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (stageOpen) setStageOpen(false)
        return
      }
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault()
        document.getElementById("equipment-search")?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [stageOpen])

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
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, code, or workbook id"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by mode">
            <FilterChip on={mode === "ALL"} onClick={() => setMode("ALL")}>
              All {items.length}
            </FilterChip>
            {MODE_ORDER.map((entry) => (
              <FilterChip key={entry} on={mode === entry} onClick={() => setMode(entry)}>
                {modeLabel(entry)} {counts[entry]}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={openOnly} onCheckedChange={setOpenOnly} id="open-height" />
              Open height
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={oogOnly} onCheckedChange={setOogOnly} id="oog-only" />
              Out of gauge
            </label>
            {canManage ? (
              <Button type="button" size="sm" className="ml-auto" onClick={() => setEditor("create")}>
                <Plus className="size-3.5" />
                Add equipment
              </Button>
            ) : null}
            <label className={cn("flex items-center gap-2 text-sm", !canManage && "ml-auto")}>
              <span className="text-muted-foreground">Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as LibrarySort)}
                className="h-8 rounded-md border bg-background px-2 text-sm"
                aria-label="Sort equipment"
              >
                <option value="name">Name</option>
                <option value="length">Length</option>
                <option value="payload">Payload</option>
              </select>
            </label>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Showing {filtered.length} of {items.length} sea, air, road, and pallet units. Press / to search.
        </p>
        {editor === "create" && canManage ? (
          <EquipmentForm key={equipmentFormKey(null)} onClose={() => setEditor(null)} onSaved={setSelectedId} />
        ) : null}

        {groups.length === 0 ? (
          <div className="rounded-md border border-dashed bg-card px-4 py-8 text-center">
            <p className="text-sm font-medium">Nothing matches</p>
            <p className="mt-1 text-sm text-muted-foreground">Clear a filter or search for another name.</p>
          </div>
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
                    return (
                      <li key={item.id}>
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
                              {formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm)}
                              {item.heightOpen ? " · open height" : ""}
                            </span>
                          </span>
                          <span className="text-sm text-muted-foreground sm:text-right">
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
      {stageOpen && selected ? <EquipmentStage item={selected} onClose={() => setStageOpen(false)} /> : null}
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

function EquipmentStage({ item, onClose }: { item: EquipmentListItem; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 sm:p-8"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex h-[min(90vh,56rem)] w-full max-w-6xl flex-col overflow-hidden rounded-md border bg-card"
        role="dialog"
        aria-label={`3D view of ${item.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
          <div>
            <p className="text-xs text-muted-foreground">{modeLabel(item.mode)}</p>
            <h2 className="text-base font-semibold">{item.name}</h2>
            <DimensionLegend
              lengthCm={item.innerLengthCm}
              widthCm={item.innerWidthCm}
              heightCm={item.innerHeightCm}
            />
          </div>
          <ButtonClose onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1">
          <EquipmentViewer item={item} className="h-full w-full bg-white" />
        </div>
      </div>
    </div>
  )
}

function ButtonClose({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted"
      aria-label="Close 3D view"
    >
      <X className="size-5" />
    </button>
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
          <Spec label="Door" value={`${formatCm(item.doorWidthCm)} × ${formatCm(item.doorHeightCm)}`} />
        ) : null}
        <Spec label="Workbook id" value={item.externalId ?? "—"} />
      </dl>
      {item.sizeLabel ? <p className="text-xs text-muted-foreground">Source size: {item.sizeLabel}</p> : null}
      {item.extendable && item.maxExtendedLengthCm ? (
        <p className="text-sm">Extends to {formatCm(item.maxExtendedLengthCm)}.</p>
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
          Yellow is length, blue is width, purple is height, green is the cut or volume.
        </p>
      </div>

      {item.axleGroups.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {item.axleGroups.map((axle) => (
            <li key={axle.name} className="flex items-baseline justify-between gap-3">
              <span>{axle.name}</span>
              <span className="text-muted-foreground">
                {formatCm(axle.positionFromFrontCm)} · {formatKg(axle.maxKg)}
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
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
      <span style={{ color: DIMENSION_COLORS.length }}>Length = {formatCm(lengthCm)}</span>
      <span style={{ color: DIMENSION_COLORS.width }}>Width = {formatCm(widthCm)}</span>
      <span style={{ color: DIMENSION_COLORS.height }}>Height = {formatCm(heightCm)}</span>
    </p>
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

function compareItems(left: EquipmentListItem, right: EquipmentListItem, sort: LibrarySort): number {
  if (sort === "length" && left.innerLengthCm !== right.innerLengthCm) {
    return right.innerLengthCm - left.innerLengthCm
  }
  if (sort === "payload" && left.maxPayloadKg !== right.maxPayloadKg) {
    return right.maxPayloadKg - left.maxPayloadKg
  }
  return left.name.localeCompare(right.name)
}
