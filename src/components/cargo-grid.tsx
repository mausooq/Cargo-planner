"use client"

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react"
import { cargoItemInputSchema, type AxisRotation, type CargoItemInput, type CargoShape } from "@compass/domain"
import { AlertCircle, Check, Copy, Download, FileDown, FileUp, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  addCargoItem,
  bulkUpdateCargo,
  deleteCargoItems,
  duplicateCargoItem,
  importCargoRows,
  updateCargoItem,
} from "@/app/actions/cargo"
import {
  activeRotations,
  AllowedOrientationsDialog,
  OrientationSelect,
  presetFor,
} from "@/components/allowed-orientations-dialog"
import { openCargoImport } from "@/components/cargo-import-wizard"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { downloadCargoWorkbook } from "@/lib/cargo-export"
import { columnsAfter, tableMinWidthRem, visibleColumns } from "@/lib/cargo-grid-columns"
import {
  displayLengthText,
  feetAndInches,
  interpretLengthEdit,
  LENGTH_UNIT_LABEL,
  LENGTH_UNIT_SYMBOL,
  LENGTH_UNITS,
  type LengthUnit,
} from "@/lib/cargo-units"
import { useLengthUnit, writeLengthUnit } from "@/lib/length-unit-pref"
import { cargoTotals, checkCargoLine, isPlannable, type CargoField } from "@/lib/cargo-validation"
import { cargoColor, formatKg, formatM3 } from "@/lib/format"
import { cn } from "@/lib/utils"

export type CargoLine = CargoItemInput & {
  id: string
  updatedAt: string
  /** What an import could not settle for this line (a size with no unit, a weight that could mean two things). Shown until the line is complete. */
  importNotes?: string[]
}

const SHAPES: { value: CargoShape; label: string }[] = [
  { value: "BOX", label: "Box" },
  { value: "CYLINDER_DRUM", label: "Drum" },
  { value: "PIPE", label: "Pipe" },
]

const ADVANCED_STORAGE_KEY = "compass.cargo.showAdvanced"

function readShowAdvanced(): boolean {
  try {
    return window.localStorage.getItem(ADVANCED_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function writeAdvanced(show: boolean) {
  try {
    window.localStorage.setItem(ADVANCED_STORAGE_KEY, show ? "1" : "0")
  } catch {
    // Ignore: the choice just won't persist.
  }
  window.dispatchEvent(new Event("compass-cargo-unit"))
}

function subscribeAdvanced(onStoreChange: () => void) {
  window.addEventListener("compass-cargo-unit", onStoreChange)
  window.addEventListener("storage", onStoreChange)
  return () => {
    window.removeEventListener("compass-cargo-unit", onStoreChange)
    window.removeEventListener("storage", onStoreChange)
  }
}

type SaveState = "idle" | "saving" | "saved" | "error"

type BulkPatch = { priority: string; stop: string; shape: "" | CargoShape; stackable: "" | "yes" | "no" }
const EMPTY_BULK: BulkPatch = { priority: "", stop: "", shape: "", stackable: "" }

export function CargoGrid({
  projectId,
  projectName,
  lines,
  canEdit,
}: {
  projectId: string
  projectName: string
  lines: CargoLine[]
  canEdit: boolean
}) {
  const [exporting, setExporting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [bulk, setBulk] = useState<BulkPatch>(EMPTY_BULK)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, setPending] = useState(0)
  const [lastSave, setLastSave] = useState<SaveState>("idle")
  const [adding, setAdding] = useState(false)
  const focusNewRow = useRef<number | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const unit = useLengthUnit()
  const showAdvanced = useSyncExternalStore(subscribeAdvanced, readShowAdvanced, () => false)

  // Drop ids that no longer exist (deleted elsewhere or by a bulk delete).
  const selectedIds = selected.filter((id) => lines.some((line) => line.id === id))
  const allSelected = lines.length > 0 && selectedIds.length === lines.length
  const totals = cargoTotals(lines)
  const incomplete = lines.filter((line) => !isPlannable(line)).length
  const advancedInUse = lines.filter(
    (line) => line.bottomOnly || line.priority !== 0 || line.destinationStop !== 1,
  ).length

  // After "Add line", put the cursor in the new row's name cell.
  useEffect(() => {
    if (focusNewRow.current === null || lines.length <= focusNewRow.current) return
    focusNewRow.current = null
    const inputs = tableRef.current?.querySelectorAll<HTMLInputElement>('input[data-col="name"]')
    inputs?.[inputs.length - 1]?.focus()
  }, [lines.length])

  function trackSave<T extends { ok: boolean; error?: string }>(promise: Promise<T>): Promise<T> {
    setPending((count) => count + 1)
    setLastSave("saving")
    return promise
      .then((result) => {
        setLastSave(result.ok ? "saved" : "error")
        if (!result.ok && result.error) toast.error(result.error)
        return result
      })
      .catch((error: unknown) => {
        setLastSave("error")
        toast.error("Could not save. Check your connection and try again.")
        throw error
      })
      .finally(() => setPending((count) => count - 1))
  }

  async function addLine() {
    setAdding(true)
    focusNewRow.current = lines.length
    const result = await trackSave(addCargoItem(projectId))
    if (!result.ok) focusNewRow.current = null
    setAdding(false)
  }

  async function exportExcel() {
    setExporting(true)
    try {
      await downloadCargoWorkbook(lines.map(toCargoInput), projectName, unit)
    } catch {
      toast.error("Could not build the Excel file.")
    } finally {
      setExporting(false)
    }
  }

  async function applyBulk() {
    const patch: Parameters<typeof bulkUpdateCargo>[2] = {}
    if (bulk.priority.trim()) {
      const value = Number(bulk.priority)
      if (!Number.isInteger(value)) return toast.error("Priority must be a whole number.")
      patch.priority = value
    }
    if (bulk.stop.trim()) {
      const value = Number(bulk.stop)
      if (!Number.isInteger(value) || value < 1) return toast.error("Stop must be a whole number, 1 or more.")
      patch.destinationStop = value
    }
    if (bulk.shape) patch.shape = bulk.shape
    if (bulk.stackable) patch.stackable = bulk.stackable === "yes"
    if (Object.keys(patch).length === 0) return toast.error("Set at least one value to change.")
    const result = await trackSave(bulkUpdateCargo(projectId, selectedIds, patch))
    if (result.ok) {
      toast.success(`Updated ${selectedIds.length} line${selectedIds.length === 1 ? "" : "s"}.`)
      setBulk(EMPTY_BULK)
    }
  }

  async function deleteLines(ids: string[]) {
    const removed = lines.filter((line) => ids.includes(line.id))
    const result = await trackSave(deleteCargoItems(projectId, ids))
    if (!result.ok) return false
    setSelected((current) => current.filter((id) => !ids.includes(id)))
    toast.success(`Deleted ${removed.length} line${removed.length === 1 ? "" : "s"}.`, {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          void trackSave(importCargoRows(projectId, removed.map(toCargoInput))).then((restored) => {
            if (restored.ok) toast.success("Restored.")
          })
        },
      },
    })
    return true
  }

  function moveFocus(event: KeyboardEvent<HTMLElement>, rowIndex: number) {
    if (event.key !== "Enter") return
    const target = event.currentTarget as HTMLElement
    const column = target.dataset.col
    if (!column) return
    event.preventDefault()
    const nextRow = rowIndex + (event.shiftKey ? -1 : 1)
    const next = tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${nextRow}"][data-col="${column}"]`)
    if (next) {
      next.focus()
      next.select?.()
    } else {
      target.blur()
    }
  }

  const saveLabel =
    pending > 0 || lastSave === "saving" ? (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Saving…
      </span>
    ) : lastSave === "error" ? (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <AlertCircle className="size-3.5" />
        Some changes were not saved
      </span>
    ) : lastSave === "saved" ? (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Check className="size-3.5 text-primary" />
        All changes saved
      </span>
    ) : null

  return (
    <section className="space-y-3" aria-label="Cargo lines">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <>
            <Button type="button" onClick={() => void addLine()} disabled={adding}>
              <Plus className="size-4" />
              {adding ? "Adding…" : "Add line"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={openCargoImport}
              title="Upload an Excel, CSV, PDF or image file, paste a screenshot, or paste text. You review every line before it is added. You can also drop a file anywhere on this page."
            >
              <FileUp className="size-4" />
              Import packing list
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">View only. Planners and admins can edit cargo.</p>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => void exportExcel()}
          disabled={exporting || lines.length === 0}
          title={lines.length === 0 ? "Add cargo first" : "Download this cargo list as an Excel file"}
        >
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
          Export to Excel
        </Button>
        {canEdit ? (
          <Button asChild variant="link" className="px-1">
            <a href="/api/cargo-template" download title="An empty Excel sheet with the right columns to fill in">
              <Download className="size-4" />
              Template
            </a>
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          <span aria-live="polite">{saveLabel}</span>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Sizes in</span>
            <select
              aria-label="Length unit"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={unit}
              onChange={(event) => writeLengthUnit(event.target.value as LengthUnit)}
            >
              {LENGTH_UNITS.map((entry) => (
                <option key={entry} value={entry}>
                  {LENGTH_UNIT_LABEL[entry]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(event) => writeAdvanced(event.target.checked)}
            />
            <span>
              More columns
              {!showAdvanced && advancedInUse > 0 ? (
                <span className="text-muted-foreground"> ({advancedInUse} in use)</span>
              ) : null}
            </span>
          </label>
        </div>
      </div>

      {canEdit && selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/40 p-3" aria-label="Change selected lines">
          <div className="w-full flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {selectedIds.length} line{selectedIds.length === 1 ? "" : "s"} selected
            </p>
            <p className="text-xs text-muted-foreground">Fields left blank stay as they are.</p>
          </div>
          <BulkField label="Priority">
            <Input
              value={bulk.priority}
              inputMode="numeric"
              placeholder="Keep"
              onChange={(event) => setBulk({ ...bulk, priority: event.target.value })}
              className="w-20"
            />
          </BulkField>
          <BulkField label="Stop">
            <Input
              value={bulk.stop}
              inputMode="numeric"
              placeholder="Keep"
              onChange={(event) => setBulk({ ...bulk, stop: event.target.value })}
              className="w-20"
            />
          </BulkField>
          <BulkField label="Shape">
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={bulk.shape}
              onChange={(event) => setBulk({ ...bulk, shape: event.target.value as BulkPatch["shape"] })}
            >
              <option value="">Keep</option>
              {SHAPES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </BulkField>
          <BulkField label="Stacking">
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={bulk.stackable}
              onChange={(event) => setBulk({ ...bulk, stackable: event.target.value as BulkPatch["stackable"] })}
            >
              <option value="">Keep</option>
              <option value="yes">Can stack</option>
              <option value="no">Do not stack</option>
            </select>
          </BulkField>
          <Button type="button" size="sm" onClick={() => void applyBulk()}>
            Apply to selected
          </Button>
          <div className="ml-auto flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear selection
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title={`Delete ${selectedIds.length} cargo line${selectedIds.length === 1 ? "" : "s"}?`}
        description="You can undo this for a few seconds afterwards."
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        onConfirm={() => deleteLines(selectedIds)}
      />

      {lines.length === 0 ? (
        <div className="rounded-md border border-dashed bg-card px-4 py-10 text-center">
          <p className="text-sm font-medium">No cargo yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {canEdit
              ? "Import a packing list (Excel, CSV, PDF, a photo or screenshot, or pasted text), drop a file anywhere on this page, or add lines one by one. You review every line before it is added."
              : "A planner has not added cargo to this project yet."}
          </p>
          {canEdit ? (
            <div className="mt-4 flex justify-center gap-2">
              <Button type="button" onClick={() => void addLine()} disabled={adding}>
                <Plus className="size-4" />
                Add first line
              </Button>
              <Button type="button" variant="outline" onClick={openCargoImport}>
                <FileUp className="size-4" />
                Import packing list
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto overflow-y-clip rounded-md border bg-card">
            <table
              ref={tableRef}
              className="w-full table-fixed border-collapse text-left text-sm"
              style={{ minWidth: `${tableMinWidthRem(showAdvanced)}rem` }}
            >
              <colgroup>
                {visibleColumns(showAdvanced).map((column) => (
                  <col key={column.key} className={column.width} />
                ))}
              </colgroup>
              <thead className="cursor-default bg-muted/50 text-xs text-muted-foreground select-none">
                <tr>
                  <th className="px-1 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all cargo"
                      checked={allSelected}
                      onChange={(event) => setSelected(event.target.checked ? lines.map((line) => line.id) : [])}
                      disabled={!canEdit}
                    />
                  </th>
                  <Th>SKU</Th>
                  <Th>Name</Th>
                  <Th title={`Length in ${LENGTH_UNIT_LABEL[unit]}`}>L ({LENGTH_UNIT_SYMBOL[unit]})</Th>
                  <Th title={`Width in ${LENGTH_UNIT_LABEL[unit]}`}>W ({LENGTH_UNIT_SYMBOL[unit]})</Th>
                  <Th title={`Height in ${LENGTH_UNIT_LABEL[unit]}`}>H ({LENGTH_UNIT_SYMBOL[unit]})</Th>
                  <Th title="Weight of one piece, in kilograms">kg / piece</Th>
                  <Th title="Number of identical pieces">Qty</Th>
                  <Th title="Tick if nothing may be placed on top of this item">No stack</Th>
                  <Th title="Which ways the item may be turned">Turning</Th>
                  <Th>Shape</Th>
                  {showAdvanced ? (
                    <>
                      <Th title="Tick if the item must stand on the floor">Floor only</Th>
                      <Th title="Higher priority loads first">Priority</Th>
                      <Th title="Delivery stop number; stop 1 is unloaded first">Stop</Th>
                    </>
                  ) : null}
                  <th className="sticky right-0 z-[1] border-l bg-muted px-1 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <CargoRow
                    key={line.id}
                    rowIndex={index}
                    projectId={projectId}
                    line={line}
                    canEdit={canEdit}
                    unit={unit}
                    showAdvanced={showAdvanced}
                    selected={selectedIds.includes(line.id)}
                    onSelected={(on) =>
                      setSelected((current) => (on ? [...current, line.id] : current.filter((id) => id !== line.id)))
                    }
                    onKeyNav={moveFocus}
                    trackSave={trackSave}
                    onDelete={() => deleteLines([line.id])}
                  />
                ))}
              </tbody>
              <tfoot className="border-t-2 bg-muted/30 text-sm font-medium">
                <tr>
                  <td />
                  <td className="px-2 py-2" colSpan={2}>
                    Total · {lines.length} line{lines.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground" colSpan={3}>
                    {formatM3(totals.volumeM3)}
                  </td>
                  <td className="px-2 py-2" colSpan={1}>
                    {formatKg(totals.weightKg)}
                  </td>
                  <td className="px-2 py-2">{totals.pieces}</td>
                  <td colSpan={columnsAfter(showAdvanced, "quantity")} className="px-2 py-2 text-right text-xs font-normal text-muted-foreground">
                    Weight and volume are totals across all pieces.
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>
              {incomplete > 0 ? (
                <span className="text-amber-700 dark:text-amber-400">
                  {incomplete} line{incomplete === 1 ? " is" : "s are"} missing a name, size, or weight and will be left out of
                  the plan.
                </span>
              ) : (
                "Every line is ready to plan."
              )}
            </p>
            {canEdit ? <p>Changes save when you leave a cell. Enter moves down, Shift+Enter moves up, Esc undoes the cell.</p> : null}
          </div>
        </>
      )}
    </section>
  )
}

function Th({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <th className="px-1 py-2 font-medium whitespace-nowrap" title={title}>
      {title ? <span className="cursor-help border-b border-dotted border-muted-foreground/50">{children}</span> : children}
    </th>
  )
}

function CargoRow({
  rowIndex,
  projectId,
  line,
  canEdit,
  unit,
  showAdvanced,
  selected,
  onSelected,
  onKeyNav,
  trackSave,
  onDelete,
}: {
  rowIndex: number
  projectId: string
  line: CargoLine
  canEdit: boolean
  unit: LengthUnit
  showAdvanced: boolean
  selected: boolean
  onSelected: (on: boolean) => void
  onKeyNav: (event: KeyboardEvent<HTMLElement>, rowIndex: number) => void
  trackSave: <T extends { ok: boolean; error?: string }>(promise: Promise<T>) => Promise<T>
  onDelete: () => Promise<boolean>
}) {
  const [draft, setDraft] = useState(line)
  const [customOpen, setCustomOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [focused, setFocused] = useState(false)
  const [syncedAt, setSyncedAt] = useState(line.updatedAt)
  // Set by Esc so the blur that follows doesn't save the value being undone.
  const reverting = useRef(false)
  // Take fresh server values only while the user is not typing in this row.
  if (syncedAt !== line.updatedAt && !focused) {
    setSyncedAt(line.updatedAt)
    setDraft(line)
  }

  const check = checkCargoLine(draft)
  const hasErrors = Object.keys(check.errors).length > 0
  const touched = draft.name.trim() !== "" || draft.lengthCm > 0 || draft.weightKg > 0
  const problem = (field: CargoField) => check.errors[field] ?? (touched ? check.missing[field] : undefined)
  const severity = (field: CargoField): "error" | "missing" | null =>
    check.errors[field] ? "error" : touched && check.missing[field] ? "missing" : null

  function commit(next: CargoLine) {
    if (reverting.current) {
      reverting.current = false
      return
    }
    const input = toCargoInput(next)
    if (JSON.stringify(input) === JSON.stringify(toCargoInput(line))) return
    const nextCheck = checkCargoLine(input)
    const firstError = Object.values(nextCheck.errors)[0]
    if (firstError) {
      // Keep what the user typed so they can fix it; the cell is marked red.
      toast.error(firstError)
      return
    }
    const parsed = cargoItemInputSchema.safeParse(input)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check this line.")
      return
    }
    void trackSave(updateCargoItem(projectId, line.id, parsed.data))
  }

  const cellProps = (column: string) => ({
    "data-row": rowIndex,
    "data-col": column,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        reverting.current = true
        setDraft(line)
        event.currentTarget.blur()
        return
      }
      onKeyNav(event, rowIndex)
    },
  })

  return (
    <tr
      className={cn("border-t", selected && "bg-primary/5", hasErrors && "bg-destructive/5")}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <td className="px-1 py-1">
        <input
          type="checkbox"
          aria-label={`Select ${line.name || "cargo line"}`}
          checked={selected}
          onChange={(event) => onSelected(event.target.checked)}
          disabled={!canEdit}
        />
      </td>
      <td className="px-1 py-1">
        <Input
          aria-label="SKU"
          placeholder="Optional"
          value={draft.sku ?? ""}
          disabled={!canEdit}
          onChange={(event) => setDraft({ ...draft, sku: event.target.value || null })}
          onBlur={() => commit(draft)}
          className="h-8 min-w-0 px-2"
          {...cellProps("sku")}
        />
      </td>
      <td className="px-1 py-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-3 shrink-0 rounded-sm border"
            style={{ background: cargoColor(draft.name, draft.color) }}
            title="Colour used for this item in the 3D view"
          />
          {line.importNotes && line.importNotes.length > 0 && !isPlannable(draft) ? (
            <span title={`From the import: ${line.importNotes.join(" ")}`} aria-label={`Import notes: ${line.importNotes.join(" ")}`}>
              <AlertCircle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            </span>
          ) : null}
          <Input
            aria-label="Name"
            placeholder="Item name"
            value={draft.name}
            disabled={!canEdit}
            aria-invalid={severity("name") === "error"}
            title={problem("name")}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            onBlur={() => commit(draft)}
            className={cn("h-8 min-w-0 px-2", cellTone(severity("name")))}
            {...cellProps("name")}
          />
        </div>
      </td>
      {(["lengthCm", "widthCm", "heightCm"] as const).map((field) => (
        <LengthCell
          key={field}
          label={field === "lengthCm" ? "Length" : field === "widthCm" ? "Width" : "Height"}
          cm={draft[field]}
          unit={unit}
          disabled={!canEdit}
          tone={severity(field)}
          problem={problem(field)}
          onChange={(value) => setDraft((current) => ({ ...current, [field]: value }))}
          onBlur={() => commit(draft)}
          inputProps={cellProps(field)}
        />
      ))}
      <NumberCell
        label="Weight per piece"
        value={draft.weightKg}
        disabled={!canEdit}
        placeholder="kg"
        tone={severity("weightKg")}
        problem={problem("weightKg")}
        onChange={(weightKg) => setDraft({ ...draft, weightKg })}
        onBlur={() => commit(draft)}
        inputProps={cellProps("weightKg")}
      />
      <NumberCell
        label="Quantity"
        value={draft.quantity}
        disabled={!canEdit}
        integer
        tone={severity("quantity")}
        problem={problem("quantity")}
        onChange={(quantity) => setDraft({ ...draft, quantity })}
        onBlur={() => commit(draft)}
        inputProps={cellProps("quantity")}
      />
      <td className="cursor-default px-1 py-1 text-center">
        <input
          type="checkbox"
          aria-label="Do not stack on top"
          checked={!draft.stackable}
          disabled={!canEdit}
          onChange={(event) => {
            const next = { ...draft, stackable: !event.target.checked }
            setDraft(next)
            commit(next)
          }}
        />
      </td>
      <td className="px-1 py-1">
        <OrientationSelect
          orientation={draft.orientation}
          disabled={!canEdit}
          onPreset={(orientation) => {
            const next = { ...draft, orientation, allowedRotations: null }
            setDraft(next)
            commit(next)
          }}
          onCustom={() => setCustomOpen(true)}
        />
        {customOpen ? (
          <AllowedOrientationsDialog
            name={draft.name || draft.sku || "BOX"}
            initial={activeRotations(draft.orientation, draft.allowedRotations)}
            onCancel={() => setCustomOpen(false)}
            onSave={(codes: AxisRotation[]) => {
              const preset = presetFor(codes)
              const next = preset
                ? { ...draft, orientation: preset, allowedRotations: null }
                : { ...draft, orientation: "CUSTOM" as const, allowedRotations: codes }
              setDraft(next)
              setCustomOpen(false)
              commit(next)
            }}
          />
        ) : null}
      </td>
      <td className="px-1 py-1">
        <select
          aria-label="Shape"
          className="h-8 w-full min-w-0 rounded-md border bg-background px-1 text-xs"
          value={draft.shape}
          disabled={!canEdit}
          onChange={(event) => {
            const next = { ...draft, shape: event.target.value as CargoShape }
            setDraft(next)
            commit(next)
          }}
        >
          {SHAPES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </td>
      {showAdvanced ? (
        <>
          <td className="cursor-default px-1 py-1 text-center">
            <input
              type="checkbox"
              aria-label="Floor only"
              checked={draft.bottomOnly}
              disabled={!canEdit}
              onChange={(event) => {
                const next = { ...draft, bottomOnly: event.target.checked }
                setDraft(next)
                commit(next)
              }}
            />
          </td>
          <NumberCell
            label="Priority"
            value={draft.priority}
            disabled={!canEdit}
            integer
            allowZero
            tone={severity("priority")}
            problem={problem("priority")}
            onChange={(priority) => setDraft({ ...draft, priority })}
            onBlur={() => commit(draft)}
            inputProps={cellProps("priority")}
          />
          <NumberCell
            label="Stop"
            value={draft.destinationStop}
            disabled={!canEdit}
            integer
            tone={severity("destinationStop")}
            problem={problem("destinationStop")}
            onChange={(destinationStop) => setDraft({ ...draft, destinationStop })}
            onBlur={() => commit(draft)}
            inputProps={cellProps("destinationStop")}
          />
        </>
      ) : null}
      <td className="sticky right-0 z-[1] border-l bg-card px-1 py-1">
        {canEdit ? (
          <div className="flex justify-end gap-0.5">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Duplicate ${line.name || "line"}`}
              title="Duplicate line"
              onClick={() => void trackSave(duplicateCargoItem(projectId, line.id))}
            >
              <Copy className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 hover:text-destructive"
              aria-label={`Delete ${line.name || "line"}`}
              title="Delete line"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <ConfirmDialog
              open={confirmDelete}
              onOpenChange={setConfirmDelete}
              destructive
              title={`Delete “${line.name || "this line"}”?`}
              description="You can undo this for a few seconds afterwards."
              confirmLabel="Delete"
              pendingLabel="Deleting…"
              onConfirm={onDelete}
            />
          </div>
        ) : null}
      </td>
    </tr>
  )
}

function cellTone(tone: "error" | "missing" | null): string {
  if (tone === "error") return "border-destructive ring-1 ring-destructive/40 focus-visible:border-destructive"
  if (tone === "missing") return "border-amber-500/70 bg-amber-50/60 dark:bg-amber-500/10"
  return ""
}

type CellInputProps = {
  "data-row": number
  "data-col": string
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

function LengthCell({
  label,
  cm,
  unit,
  disabled,
  tone,
  problem,
  onChange,
  onBlur,
  inputProps,
}: {
  label: string
  cm: number
  unit: LengthUnit
  disabled: boolean
  tone: "error" | "missing" | null
  problem?: string
  onChange: (cm: number) => void
  onBlur: () => void
  inputProps: CellInputProps
}) {
  const [text, setText] = useState(() => displayLengthText(cm, unit))
  const [focused, setFocused] = useState(false)
  // What the box holds could not be read as a size; it is not applied, and is put back when the box is left.
  const [unreadable, setUnreadable] = useState<string | null>(null)
  const [source, setSource] = useState({ cm, unit })
  if (!focused && (source.cm !== cm || source.unit !== unit)) {
    setSource({ cm, unit })
    setText(displayLengthText(cm, unit))
  }
  const hint = problem ?? unreadable ?? (cm > 0 && unit === "ft" ? `= ${feetAndInches(cm)}` : undefined)

  return (
    <td className="px-1 py-1">
      <Input
        aria-label={`${label} (${LENGTH_UNIT_LABEL[unit]})`}
        type="text"
        // Feet and inches are typed with letters and marks (5 ft 6 in, 5'6"), so this is not a number box.
        inputMode={unit === "ft" || unit === "in" ? "text" : "decimal"}
        autoComplete="off"
        placeholder={LENGTH_UNIT_SYMBOL[unit]}
        value={text}
        disabled={disabled}
        aria-invalid={tone === "error" || unreadable !== null}
        title={hint}
        onFocus={(event) => {
          setFocused(true)
          event.currentTarget.select()
        }}
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          const edit = interpretLengthEdit(raw, unit, cm)
          // Switching the unit or clicking in and out never reaches here, so a stored size only changes when a new one is typed.
          if (edit.kind === "blank") {
            setUnreadable(null)
            onChange(0)
          } else if (edit.kind === "changed") {
            setUnreadable(null)
            onChange(edit.cm)
          } else if (edit.kind === "invalid") {
            setUnreadable(edit.reason)
          } else {
            setUnreadable(null)
          }
        }}
        onBlur={() => {
          setFocused(false)
          if (unreadable !== null) {
            toast.error(`Could not read “${text}” as a size. ${unreadable}`)
            setUnreadable(null)
            setText(displayLengthText(cm, unit))
          }
          onBlur()
        }}
        className={cn("h-8 min-w-0 px-1.5", cellTone(tone))}
        {...inputProps}
      />
    </td>
  )
}

function NumberCell({
  label,
  value,
  disabled,
  integer,
  allowZero,
  placeholder,
  tone,
  problem,
  onChange,
  onBlur,
  inputProps,
}: {
  label: string
  value: number
  disabled: boolean
  integer?: boolean
  allowZero?: boolean
  placeholder?: string
  tone: "error" | "missing" | null
  problem?: string
  onChange: (value: number) => void
  onBlur: () => void
  inputProps: CellInputProps
}) {
  // Local text so a cell can be cleared while typing without snapping to 0.
  const [text, setText] = useState(() => numberText(value, allowZero))
  const [focused, setFocused] = useState(false)
  const [source, setSource] = useState(value)
  if (!focused && source !== value) {
    setSource(value)
    setText(numberText(value, allowZero))
  }

  return (
    <td className="px-1 py-1">
      <Input
        aria-label={label}
        type="number"
        step={integer ? 1 : "any"}
        inputMode={integer ? "numeric" : "decimal"}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        aria-invalid={tone === "error"}
        title={problem}
        onFocus={(event) => {
          setFocused(true)
          event.currentTarget.select()
        }}
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          if (raw.trim() === "") {
            onChange(0)
            return
          }
          const next = Number(raw)
          if (Number.isFinite(next)) onChange(next)
        }}
        onBlur={() => {
          setFocused(false)
          onBlur()
        }}
        className={cn("h-8 min-w-0 px-1.5", cellTone(tone))}
        {...inputProps}
      />
    </td>
  )
}

function BulkField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span className="block">{label}</span>
      {children}
    </label>
  )
}

function numberText(value: number, allowZero?: boolean): string {
  if (!Number.isFinite(value)) return ""
  if (value === 0 && !allowZero) return ""
  return String(value)
}

function toCargoInput(line: CargoItemInput): CargoItemInput {
  return {
    sku: line.sku,
    name: line.name,
    lengthCm: line.lengthCm,
    widthCm: line.widthCm,
    heightCm: line.heightCm,
    weightKg: line.weightKg,
    quantity: line.quantity,
    shape: line.shape,
    orientation: line.orientation,
    allowedRotations: line.allowedRotations,
    stackable: line.stackable,
    bottomOnly: line.bottomOnly,
    maxStackLoadKg: line.maxStackLoadKg,
    maxStackLayers: line.maxStackLayers,
    priority: line.priority,
    destinationStop: line.destinationStop,
    consignmentId: line.consignmentId,
    segregationClass: line.segregationClass,
    color: line.color,
  }
}
