"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ClipboardCopy, Download, GitCompareArrows, LayoutList, Layers, Maximize2, Package, Pencil, Plane, Plus, Ruler, Search, Ship, Table2, Truck, Upload } from "lucide-react"
import { modeLabel, type EquipmentMode } from "@compass/domain"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { importEquipmentCsv } from "@/app/actions/equipment"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FOCUS_RING, IconTile, Segmented, StatusPill, TRANSPORT_ICON, TRANSPORT_TINT, type PastelTone } from "@/components/design-system"
import { EquipmentForm } from "@/components/equipment-form"
import { SelectMenu } from "@/components/ui/select-menu"
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
  // Keep the shared selection in step with what is shown. In an effect, not during render: the store is read by other
  // components, and updating it while this one renders is a React error. The page already shows `visibleId` meanwhile.
  useEffect(() => {
    if (visibleId !== selectedId) setSelectedId(visibleId)
  }, [visibleId, selectedId, setSelectedId])
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

  const categories: { mode: EquipmentMode | "ALL"; label: string; count: number; tone: PastelTone | "teal"; icon: typeof Ship }[] = [
    { mode: "ALL", label: "All equipment", count: items.length, tone: "mint", icon: Layers },
    { mode: "SEA", label: modeLabel("SEA"), count: counts.SEA, tone: "blue", icon: Ship },
    { mode: "AIR", label: modeLabel("AIR"), count: counts.AIR, tone: "lavender", icon: Plane },
    { mode: "ROAD", label: modeLabel("ROAD"), count: counts.ROAD, tone: "amber", icon: Truck },
    { mode: "PALLET", label: modeLabel("PALLET"), count: counts.PALLET, tone: "teal", icon: Package },
  ]
  const toneClass = { mint: "pastel-mint", blue: "pastel-blue", lavender: "pastel-lavender", amber: "pastel-amber", teal: "pastel-teal" } as const
  const actionButton = "press h-10 rounded-xl bg-card px-4 text-button shadow-soft"

  return (
    <div className="space-y-5">
      {/* Category cards: the same mode filter as before, one card per mode with its real count. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" role="group" aria-label="Filter by mode">
        {categories.map((category) => {
          const Icon = category.icon
          const on = filters.mode === category.mode
          return (
            <button
              key={category.mode}
              type="button"
              aria-pressed={on}
              onClick={() => patchFilters({ mode: category.mode })}
              className={cn(toneClass[category.tone], "pastel-surface lift flex min-w-0 items-center gap-3 p-4 text-left", FOCUS_RING, on && "border-[var(--pc-accent)] ring-2 ring-[var(--pc-accent)]/25")}
            >
              <span data-tile="" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/75 text-[var(--pc-accent)] shadow-soft dark:bg-white/10">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[26px] leading-8 font-extrabold tabular-nums">{category.count}</span>
                <span className="block truncate text-label text-[var(--pc-accent)]">{category.label}</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Search and filters on the Ocean Lavender band. */}
      <div className="bg-table-head space-y-3 rounded-[var(--radius-card)] border border-[var(--suggest-border)] p-4 shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Label htmlFor="equipment-search" className="sr-only">
              Search equipment
            </Label>
            <Input
              id="equipment-search"
              value={filters.query}
              onChange={(event) => patchFilters({ query: event.target.value })}
              placeholder="Search name, code, or workbook id (press / to search)"
              className="h-11 rounded-xl bg-card pl-10 text-[15px] shadow-soft"
            />
          </div>
          {canManage ? (
            <Button type="button" className="press h-11 rounded-xl px-5 text-button shadow-soft" onClick={() => setEditor("create")}>
              <Plus className="size-4" />
              Add Equipment
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <RangeField label="Length from (cm)" value={filters.lengthMin} onChange={(lengthMin) => patchFilters({ lengthMin })} />
          <RangeField label="Length to (cm)" value={filters.lengthMax} onChange={(lengthMax) => patchFilters({ lengthMax })} />
          <RangeField label="Payload from (kg)" value={filters.payloadMin} onChange={(payloadMin) => patchFilters({ payloadMin })} />
          <RangeField label="Payload to (kg)" value={filters.payloadMax} onChange={(payloadMax) => patchFilters({ payloadMax })} />
          <div className="flex h-10 items-center gap-4 px-1">
            <label className="flex items-center gap-2 text-detail text-[var(--table-head-fg)]">
              <Switch checked={filters.openOnly} onCheckedChange={(openOnly) => patchFilters({ openOnly })} id="open-height" />
              Open height
            </label>
            <label className="flex items-center gap-2 text-detail text-[var(--table-head-fg)]">
              <Switch checked={filters.oogOnly} onCheckedChange={(oogOnly) => patchFilters({ oogOnly })} id="oog-only" />
              Out of gauge
            </label>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Segmented
              label="List or table"
              value={filters.view}
              onChange={(view) => patchFilters({ view })}
              options={[
                { value: "list", label: "List", icon: LayoutList },
                { value: "table", label: "Table", icon: Table2 },
              ]}
            />
            <div className="flex items-center gap-2">
              <span className="text-meta text-[var(--table-head-fg)]">Sort by</span>
              <SelectMenu
                label="Sort equipment"
                value={filters.sort}
                onChange={(sort) => patchFilters({ sort, dir: defaultDir(sort) })}
                className="w-40"
                options={[
                  { value: "name", label: "Name" },
                  { value: "type", label: "Type" },
                  { value: "length", label: "Length" },
                  { value: "volume", label: "Volume" },
                  { value: "payload", label: "Payload" },
                  { value: "tare", label: "Tare" },
                  { value: "door", label: "Door" },
                ] as { value: LibrarySort; label: string }[]}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="press size-11 rounded-xl bg-card shadow-soft"
                onClick={() => patchFilters({ dir: filters.dir === "asc" ? "desc" : "asc" })}
                aria-label={filters.dir === "asc" ? "Ascending; switch to descending" : "Descending; switch to ascending"}
                title={filters.dir === "asc" ? "Ascending" : "Descending"}
              >
                {filters.dir === "asc" ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
        <ActiveFilters filters={filters} onPatch={patchFilters} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-4">
          <FitPanel onChange={setFit} />
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-meta text-muted-foreground">
              Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {items.length} units
            </p>
            <Button type="button" variant="outline" className={actionButton} onClick={() => downloadEquipmentFile(filtered, "csv")}>
              <Download className="size-4" />
              Export CSV
            </Button>
            <Button type="button" variant="outline" className={actionButton} onClick={() => downloadEquipmentFile(filtered, "xlsx")}>
              <Download className="size-4" />
              Export XLSX
            </Button>
            {canManage ? (
              <label className={cn("inline-flex cursor-pointer items-center gap-2 border font-semibold hover:bg-secondary", actionButton, importing && "opacity-60")}>
                <Upload className="size-4" />
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
                className="press inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-button text-primary-foreground shadow-soft hover:bg-primary/90"
              >
                <GitCompareArrows className="size-4" />
                Compare {compareIds.length}
              </Link>
            ) : null}
          </div>
          {importReport ? (
            <div className="rounded-xl border bg-card p-4 text-detail shadow-soft" aria-live="polite">
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
          {editor === "create" && canManage ? (
            <EquipmentForm key={equipmentFormKey(null)} onClose={() => setEditor(null)} onSaved={setSelectedId} />
          ) : null}

          {filtered.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-dashed bg-card px-4 py-10 text-center">
              <p className="text-detail font-semibold">Nothing matches</p>
              <p className="mt-1 text-meta text-muted-foreground">Clear a filter or search for another name.</p>
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
            <div className="space-y-4">
              {groups.map((group) => {
                const GroupIcon = TRANSPORT_ICON[group.mode]
                return (
                  <section key={group.mode} aria-labelledby={`mode-${group.mode}`} className="surface-card overflow-hidden">
                    <h2 id={`mode-${group.mode}`} className="bg-table-head flex items-center gap-2.5 border-b border-[var(--table-border)] px-4 py-2.5 text-[15px] font-bold text-[var(--table-head-fg)]">
                      <GroupIcon className="size-4" aria-hidden="true" />
                      {modeLabel(group.mode)}
                      <span className="rounded-full bg-white/70 px-2 text-xs font-semibold dark:bg-white/10">{group.items.length}</span>
                    </h2>
                    <ul className="divide-y divide-[var(--table-border)]">
                      {group.items.map((item, index) => {
                        const isSelected = item.id === visibleId
                        const fits = fit ? cargoFitsEquipment(fit, item) : false
                        return (
                          <li
                            key={item.id}
                            className={cn(
                              "flex items-stretch transition-colors duration-200",
                              index % 2 === 1 ? "bg-[var(--table-row-alt)]" : "bg-[var(--table-row)]",
                              "hover:bg-[var(--table-row-hover)]",
                              isSelected && "bg-[var(--pastel-mint-bg)] shadow-[inset_3px_0_0_var(--primary)] hover:bg-[var(--pastel-mint-bg)]",
                              fits && "ring-1 ring-primary/70 ring-inset",
                            )}
                          >
                            <label className="flex items-center px-3">
                              <input
                                type="checkbox"
                                className="accent-[var(--primary)]"
                                checked={compareIds.includes(item.id)}
                                onChange={() => toggleCompare(item.id)}
                                aria-label={`Compare ${item.name}`}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => setSelectedId(item.id)}
                              aria-pressed={isSelected}
                              className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 py-2.5 pr-4 text-left", FOCUS_RING)}
                            >
                              <IconTile icon={TRANSPORT_ICON[item.mode]} tint={TRANSPORT_TINT[item.mode]} size="sm" className="size-9 rounded-lg [&_svg]:size-[18px]" />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="text-[15px] leading-5 font-semibold" title={item.code ? `Code: ${item.code}` : undefined}>
                                    {item.name}
                                  </span>
                                  {fits ? <StatusPill tone="success">Fits</StatusPill> : null}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {modeLabel(item.mode)}
                                  {item.heightOpen ? " · open height" : ""}
                                  {item.axleGroups.length > 0 ? ` · ${item.axleGroups.length} axle groups` : ""}
                                </span>
                              </span>
                              <span className="text-detail whitespace-nowrap tabular-nums">{formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, unit)}</span>
                              <span className="w-28 text-right text-detail font-semibold whitespace-nowrap tabular-nums">{formatKg(item.maxPayloadKg)}</span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </section>

        <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
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
      </div>
      {selected ? <EquipmentStage item={selected} open={stageOpen} onClose={() => setStageOpen(false)} /> : null}
    </div>
  )
}

/** The 3D scene cannot read CSS variables: the same neutral as --viewer-bg, from the theme (canvas only; drawn in the browser). */
function useViewerBackground(): string {
  const { resolvedTheme } = useTheme()
  return resolvedTheme === "dark" ? "#1b2128" : "#edf2f4"
}

function EmptyDetail() {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--suggest-border)] p-5" style={{ background: "var(--util-bg)" }}>
      <p className="text-detail font-semibold">Select a type</p>
      <p className="mt-2 text-meta leading-6 text-muted-foreground">
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
  const background = useViewerBackground()
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="flex h-[min(90vh,56rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogDescription>{modeLabel(item.mode)}</DialogDescription>
          <DialogTitle>{item.name}</DialogTitle>
          <DimensionLegend lengthCm={item.innerLengthCm} widthCm={item.innerWidthCm} heightCm={item.innerHeightCm} />
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <EquipmentViewer item={item} background={background} className="h-full w-full" />
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
  const viewerBg = useViewerBackground()
  if (editing && canManage) {
    return <EquipmentForm key={equipmentFormKey(item)} item={item} onClose={onCloseEdit} onSaved={onSaved} />
  }
  const chip = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
  return (
    <article className="space-y-4 rounded-[var(--radius-card)] border border-[var(--suggest-border)] p-5 shadow-soft" style={{ background: "var(--util-bg)" }} aria-label={`${item.name} details`}>
      <div className="flex items-start gap-3.5">
        <IconTile icon={TRANSPORT_ICON[item.mode]} tint={TRANSPORT_TINT[item.mode]} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-meta text-[var(--table-head-fg)]/80">{modeLabel(item.mode)}</p>
          <h2 className="text-[22px] leading-7 font-extrabold tracking-tight break-words">{item.name}</h2>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{item.code}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canEditProjects ? (
          <AddToProjectDialog equipmentTypeId={item.id} equipmentName={item.name} projects={projects} triggerClassName="press h-9 rounded-xl border-primary bg-primary px-4 text-button text-primary-foreground shadow-soft hover:bg-primary/90 hover:text-primary-foreground" />
        ) : null}
        {canManage ? (
          <Button type="button" variant="outline" className="press h-9 rounded-xl bg-white/70 px-3.5 text-button dark:bg-white/5" onClick={onEdit}>
            <Pencil className="size-4" />
            Edit dimensions
          </Button>
        ) : null}
        <Button type="button" variant="outline" className="press h-9 rounded-xl bg-white/70 px-3.5 text-button dark:bg-white/5" onClick={() => copySpecs(item, unit)}>
          <ClipboardCopy className="size-4" />
          Copy specs
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {item.heightOpen ? <span className={cn(chip, "border-[var(--pastel-amber-border)] bg-[var(--pastel-amber-bg)] text-[var(--pastel-amber-accent)]")}>Open height</span> : <span className={cn(chip, "border-[var(--table-border)] bg-white/70 text-[var(--table-head-fg)] dark:bg-white/5")}>Rated height</span>}
        {item.oogClass !== "NONE" ? <span className={cn(chip, "border-[var(--pastel-amber-border)] bg-[var(--pastel-amber-bg)] text-[var(--pastel-amber-accent)]")}>{item.oogClass}</span> : null}
        {item.floors > 1 ? <span className={cn(chip, "border-[var(--table-border)] bg-white/70 text-[var(--table-head-fg)] dark:bg-white/5")}>{item.floors} floors</span> : null}
        {item.extendable ? <span className={cn(chip, "border-[var(--table-border)] bg-white/70 text-[var(--table-head-fg)] dark:bg-white/5")}>Extendable</span> : null}
        {item.isCustom ? <span className={cn(chip, "border-primary bg-primary text-primary-foreground")}>Custom</span> : <span className={cn(chip, "border-[var(--pastel-mint-border)] bg-[var(--pastel-mint-bg)] text-[var(--pastel-mint-accent)]")}>System</span>}
      </div>

      <DimensionLegend lengthCm={item.innerLengthCm} widthCm={item.innerWidthCm} heightCm={item.innerHeightCm} />
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/70 bg-white/70 dark:border-white/10 dark:bg-white/10">
        <Spec label="Payload" value={formatKg(item.maxPayloadKg)} />
        <Spec label="Tare" value={formatKg(item.tareKg)} />
        <Spec label="Reference gross" value={formatKg(item.grossKg)} />
        <Spec label="Planning cost" value={formatCost(item.costPerUnit)} />
        {item.doorWidthCm && item.doorHeightCm ? <Spec label="Door" value={`${formatCm(item.doorWidthCm, unit)} × ${formatCm(item.doorHeightCm, unit)}`} /> : null}
        <Spec label="Workbook id" value={item.externalId ?? "—"} />
        <Spec label="Used in" value={`${item.projectCount} ${item.projectCount === 1 ? "project" : "projects"}`} />
        <Spec label="Volume" value={formatM3(equipmentVolumeM3(item))} />
      </dl>
      {item.sizeLabel ? <p className="text-xs text-muted-foreground">Source size: {item.sizeLabel}</p> : null}
      {item.extendable && item.maxExtendedLengthCm ? <p className="text-detail">Extends to {formatCm(item.maxExtendedLengthCm, unit)}.</p> : null}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-label text-[var(--table-head-fg)]">3D shape</p>
          <Button type="button" variant="outline" className="press h-8 rounded-lg bg-white/70 px-3 text-[13px] font-semibold dark:bg-white/5" onClick={onOpen}>
            <Maximize2 className="size-3.5" />
            Open large view
          </Button>
        </div>
        {hidePreview ? (
          <div className="flex h-72 items-center justify-center rounded-xl border border-white/70 text-detail text-muted-foreground" style={{ background: "var(--viewer-bg)" }}>
            Large view is open
          </div>
        ) : (
          <EquipmentViewer item={item} background={viewerBg} className="h-80 w-full overflow-hidden rounded-xl border border-white/70 dark:border-white/10" />
        )}
        <p className="mt-2 text-xs text-muted-foreground">L, W and H badges name each dimension. Colour repeats the same labels in the 3D view.</p>
      </div>

      {item.axleGroups.length > 0 ? (
        <ul className="divide-y divide-white/70 rounded-xl bg-white/45 text-detail dark:divide-white/10 dark:bg-white/5">
          {item.axleGroups.map((axle) => (
            <li key={axle.name} className="flex items-baseline justify-between gap-3 px-3.5 py-2">
              <span>{axle.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatCm(axle.positionFromFrontCm, unit)} · {formatKg(axle.maxKg)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-muted-foreground">No axle groups on this type.</p>
      )}

      {item.notes ? <p className="text-meta leading-6 text-muted-foreground">{item.notes}</p> : null}
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
    <p className="flex flex-wrap gap-2 text-detail">
      <DimensionBadge letter="L" label="Length" value={formatCm(lengthCm, unit)} className="pastel-mint" />
      <DimensionBadge letter="W" label="Width" value={formatCm(widthCm, unit)} className="pastel-blue" />
      <DimensionBadge letter="H" label="Height" value={formatCm(heightCm, unit)} className="pastel-lavender" />
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
    <span className={cn("inline-flex items-center gap-2 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-bg)] px-2.5 py-1 text-[var(--pc-accent)]", className)}>
      <span className="rounded-md bg-white/85 px-1.5 text-[11px] font-extrabold dark:bg-white/15">{letter}</span>
      <span>
        {label} <span className="font-bold tabular-nums">{value}</span>
      </span>
    </span>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/70 px-3.5 py-2.5 dark:bg-card/60">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-detail font-bold tabular-nums">{value}</dd>
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
    <form className="pastel-mint grid gap-3 rounded-[var(--radius-card)] border border-[var(--pc-border)] bg-[var(--pc-bg)] p-4 shadow-soft sm:grid-cols-4" onSubmit={(event) => event.preventDefault()}>
      <p className="flex items-center gap-2.5 text-[16px] font-bold text-[var(--pc-accent)] sm:col-span-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-white/80 shadow-soft dark:bg-white/10">
          <Ruler className="size-4" aria-hidden="true" />
        </span>
        Will it fit?
      </p>
      <FitInput label="Cargo length (cm)" value={lengthCm} onChange={(lengthCm) => update({ lengthCm })} />
      <FitInput label="Cargo width (cm)" value={widthCm} onChange={(widthCm) => update({ widthCm })} />
      <FitInput label="Cargo height (cm)" value={heightCm} onChange={(heightCm) => update({ heightCm })} />
      <FitInput label="Cargo weight (kg)" value={weightKg} onChange={(weightKg) => update({ weightKg })} />
      <p className="text-meta text-muted-foreground sm:col-span-4">
        {cargo ? "Units that can take this cargo, including the door, are outlined in green and marked Fits." : "Enter length, width, height, and weight to highlight units that fit."}
      </p>
    </form>
  )
}

function FitInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-")
  return (
    <label className="space-y-1 text-xs font-semibold text-[var(--pc-accent)]" htmlFor={id}>
      <span className="block">{label}</span>
      <Input id={id} type="number" min="0.1" step="0.1" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 rounded-xl bg-card text-[15px] text-foreground shadow-soft" />
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
    <label className="space-y-1 text-xs font-semibold text-[var(--table-head-fg)]" htmlFor={id}>
      <span className="block">{label}</span>
      <Input
        id={id}
        type="number"
        min="0"
        step="0.1"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        className="h-10 w-32 rounded-xl bg-card text-[15px] text-foreground shadow-soft"
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
          className="press rounded-full border border-white/70 bg-white/75 px-3 py-1 text-xs font-semibold text-[var(--table-head-fg)] hover:border-primary dark:border-white/10 dark:bg-white/10"
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
        className="text-xs font-semibold text-primary hover:underline dark:text-[var(--step-done-fg)]"
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
    <div className="surface-card max-h-[75vh] overflow-auto">
      <table className="data-table w-full min-w-[760px] text-left text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="px-3">
              <span className="sr-only">Compare</span>
            </th>
            {columns.map((column) => (
              <th key={column.key} className={cn("px-3", NUMERIC.has(column.key) && "text-right")} aria-sort={sort === column.key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className={cn("inline-flex items-center gap-1 rounded-md hover:text-primary", FOCUS_RING)} onClick={() => onSort(column.key)}>
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
                className={cn("cursor-pointer border-t outline-none focus-visible:bg-[var(--table-row-hover)]", selected && "bg-[var(--pastel-mint-bg)] hover:bg-[var(--pastel-mint-bg)]", fits && "ring-1 ring-primary/70 ring-inset")}
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onSelect(item.id)
                  }
                }}
              >
                <td className={cn("px-3 py-2.5", selected && "shadow-[inset_3px_0_0_var(--primary)]")}>
                  <input
                    type="checkbox"
                    className="accent-[var(--primary)]"
                    checked={compareIds.includes(item.id)}
                    aria-label={`Compare ${item.name}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => onCompare(item.id)}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <IconTile icon={TRANSPORT_ICON[item.mode]} tint={TRANSPORT_TINT[item.mode]} size="sm" className="size-8 rounded-lg [&_svg]:size-4" />
                    <span className="text-[15px] font-semibold whitespace-nowrap" title={item.code ? `Code: ${item.code}` : undefined}>
                      {item.name}
                    </span>
                    {fits ? <StatusPill tone="success">Fits</StatusPill> : null}
                  </span>
                </td>
                <td className="px-3 py-2.5">{modeLabel(item.mode)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{formatEnvelope(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, unit)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{formatM3(equipmentVolumeM3(item))}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{formatKg(item.maxPayloadKg)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{formatKg(item.tareKg)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{formatDoor(item, unit)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Table columns whose values are numbers, right-aligned with their headings. */
const NUMERIC = new Set<LibrarySort>(["length", "volume", "payload", "tare", "door"])
