"use client"

import { useEffect, useState, type ReactNode } from "react"
import { cargoItemInputSchema, type AxisRotation, type CargoItemInput, type CargoShape } from "@compass/domain"
import { toast } from "sonner"
import {
  addCargoItem,
  bulkUpdateCargo,
  deleteCargoItems,
  duplicateCargoItem,
  updateCargoItem,
} from "@/app/actions/cargo"
import {
  activeRotations,
  AllowedOrientationsDialog,
  OrientationSelect,
  presetFor,
} from "@/components/allowed-orientations-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cargoColor } from "@/lib/format"
import {
  fromDisplayLength,
  LENGTH_UNIT_LABEL,
  LENGTH_UNITS,
  roundDisplayLength,
  toDisplayLength,
  type LengthUnit,
} from "@/lib/cargo-units"

export type CargoLine = CargoItemInput & {
  id: string
  updatedAt: string
}

const SHAPES: { value: CargoShape; label: string }[] = [
  { value: "BOX", label: "Box" },
  { value: "CYLINDER_DRUM", label: "Drum" },
  { value: "PIPE", label: "Pipe" },
]

const UNIT_STORAGE_KEY = "compass.cargo.lengthUnit"

export function CargoGrid({
  projectId,
  lines,
  canEdit,
}: {
  projectId: string
  lines: CargoLine[]
  canEdit: boolean
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [priority, setPriority] = useState("0")
  const [stop, setStop] = useState("1")
  const [shape, setShape] = useState<CargoShape>("BOX")
  const [notStackable, setNotStackable] = useState(false)
  const [unit, setUnit] = useState<LengthUnit>("cm")

  useEffect(() => {
    const stored = window.localStorage.getItem(UNIT_STORAGE_KEY)
    if (stored === "cm" || stored === "in" || stored === "m") setUnit(stored)
  }, [])

  function changeUnit(next: LengthUnit) {
    setUnit(next)
    window.localStorage.setItem(UNIT_STORAGE_KEY, next)
  }

  const allSelected = lines.length > 0 && selected.length === lines.length

  async function applyBulk() {
    const result = await bulkUpdateCargo(projectId, selected, {
      priority: Number(priority),
      destinationStop: Number(stop),
      shape,
      stackable: !notStackable,
    })
    if (!result.ok) toast.error(result.error)
    else toast.success("Updated the selected lines.")
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <Button type="button" onClick={() => addCargoItem(projectId).then(report)}>
            Add line
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">View only. Planners and admins can edit cargo.</p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Units</span>
          <select
            aria-label="Length unit"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={unit}
            onChange={(event) => changeUnit(event.target.value as LengthUnit)}
          >
            {LENGTH_UNITS.map((entry) => (
              <option key={entry} value={entry}>
                {LENGTH_UNIT_LABEL[entry]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          {lines.length} lines · L / W / H in {LENGTH_UNIT_LABEL[unit]} · weight in kg
        </p>
      </div>

      {canEdit && selected.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-3">
          <p className="w-full text-sm">{selected.length} selected</p>
          <BulkField label="Priority">
            <Input value={priority} onChange={(event) => setPriority(event.target.value)} className="w-20" />
          </BulkField>
          <BulkField label="Stop">
            <Input value={stop} onChange={(event) => setStop(event.target.value)} className="w-20" />
          </BulkField>
          <BulkField label="Shape">
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={shape}
              onChange={(event) => setShape(event.target.value as CargoShape)}
            >
              {SHAPES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </BulkField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notStackable} onChange={(event) => setNotStackable(event.target.checked)} />
            Not stackable
          </label>
          <Button type="button" size="sm" onClick={applyBulk}>
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => deleteCargoItems(projectId, selected).then(report)}
          >
            Delete
          </Button>
        </div>
      ) : null}

      {lines.length === 0 ? (
        <div className="rounded-md border border-dashed px-4 py-8 text-center">
          <p className="text-sm font-medium">No cargo yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add a line or import a spreadsheet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto overflow-y-clip rounded-md border bg-card">
          <table className="w-full min-w-[1100px] table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-8" />
              <col className="w-[9%]" />
              <col className="w-[12%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[5%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[7%]" />
              <col className="w-[5%]" />
              <col className="w-[5%]" />
              <col />
              <col className="w-14" />
            </colgroup>
            <thead className="cursor-default bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase select-none">
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
                <th className="px-1 py-2">SKU</th>
                <th className="px-1 py-2">Name</th>
                <th className="px-1 py-2">L</th>
                <th className="px-1 py-2">W</th>
                <th className="px-1 py-2">H</th>
                <th className="px-1 py-2">kg</th>
                <th className="px-1 py-2">Qty</th>
                <th className="px-1 py-2 whitespace-nowrap">Not stackable</th>
                <th className="px-1 py-2 whitespace-nowrap">Bottom only</th>
                <th className="px-1 py-2">Orientations</th>
                <th className="px-1 py-2">Shape</th>
                <th className="px-1 py-2">Pri</th>
                <th className="px-1 py-2">Stop</th>
                <th className="px-1 py-2">Consignment</th>
                <th className="px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <CargoRow
                  key={`${line.id}-${line.updatedAt}`}
                  projectId={projectId}
                  line={line}
                  canEdit={canEdit}
                  unit={unit}
                  selected={selected.includes(line.id)}
                  onSelected={(on) =>
                    setSelected((current) =>
                      on ? [...current, line.id] : current.filter((id) => id !== line.id),
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CargoRow({
  projectId,
  line,
  canEdit,
  unit,
  selected,
  onSelected,
}: {
  projectId: string
  line: CargoLine
  canEdit: boolean
  unit: LengthUnit
  selected: boolean
  onSelected: (on: boolean) => void
}) {
  const [draft, setDraft] = useState(line)
  const [customOpen, setCustomOpen] = useState(false)

  async function commit(next: CargoLine) {
    const parsed = cargoItemInputSchema.safeParse(toCargoInput(next))
    if (!parsed.success) {
      toast.error("Check the dimensions, weight, and quantity.")
      setDraft(line)
      return
    }
    const result = await updateCargoItem(projectId, line.id, parsed.data)
    if (!result.ok) {
      toast.error(result.error)
      setDraft(line)
    }
  }

  return (
    <tr className="border-t">
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
          placeholder="SKU"
          value={draft.sku ?? ""}
          disabled={!canEdit}
          onChange={(event) => setDraft({ ...draft, sku: event.target.value || null })}
          onBlur={() => commit(draft)}
          className="h-8 w-28 min-w-0 px-2"
        />
      </td>
      <td className="px-1 py-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-3 shrink-0 rounded-sm border"
            style={{ background: cargoColor(draft.name, draft.color) }}
            title="3D box color from this name"
          />
          <Input
            aria-label="Name"
            placeholder="Item name"
            value={draft.name}
            disabled={!canEdit}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            onBlur={() => commit(draft)}
            className="h-8 w-36 min-w-0 px-2"
          />
        </div>
      </td>
      <LengthCell
        label="Length"
        cm={draft.lengthCm}
        unit={unit}
        disabled={!canEdit}
        onChange={(lengthCm) => setDraft({ ...draft, lengthCm })}
        onBlur={() => commit({ ...draft })}
      />
      <LengthCell
        label="Width"
        cm={draft.widthCm}
        unit={unit}
        disabled={!canEdit}
        onChange={(widthCm) => setDraft({ ...draft, widthCm })}
        onBlur={() => commit({ ...draft })}
      />
      <LengthCell
        label="Height"
        cm={draft.heightCm}
        unit={unit}
        disabled={!canEdit}
        onChange={(heightCm) => setDraft({ ...draft, heightCm })}
        onBlur={() => commit({ ...draft })}
      />
      <NumberCell
        label="Weight"
        value={draft.weightKg}
        disabled={!canEdit}
        placeholder="kg"
        onChange={(weightKg) => setDraft({ ...draft, weightKg })}
        onBlur={() => commit({ ...draft })}
      />
      <NumberCell
        label="Quantity"
        value={draft.quantity}
        disabled={!canEdit}
        integer
        onChange={(quantity) => setDraft({ ...draft, quantity })}
        onBlur={() => commit({ ...draft })}
      />
      <td className="cursor-default px-1 py-1 text-center">
        <input
          type="checkbox"
          aria-label="Not stackable"
          checked={!draft.stackable}
          disabled={!canEdit}
          onChange={(event) => {
            const next = { ...draft, stackable: !event.target.checked }
            setDraft(next)
            void commit(next)
          }}
        />
      </td>
      <td className="cursor-default px-1 py-1 text-center">
        <input
          type="checkbox"
          aria-label="Bottom only"
          checked={draft.bottomOnly}
          disabled={!canEdit}
          onChange={(event) => {
            const next = { ...draft, bottomOnly: event.target.checked }
            setDraft(next)
            void commit(next)
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
            void commit(next)
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
              void commit(next)
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
            const shape = event.target.value as CargoShape
            const next = { ...draft, shape }
            setDraft(next)
            void commit(next)
          }}
        >
          {SHAPES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </td>
      <NumberCell
        label="Priority"
        value={draft.priority}
        disabled={!canEdit}
        integer
        onChange={(priority) => setDraft({ ...draft, priority })}
        onBlur={() => commit({ ...draft })}
      />
      <NumberCell
        label="Stop"
        value={draft.destinationStop}
        disabled={!canEdit}
        integer
        onChange={(destinationStop) => setDraft({ ...draft, destinationStop })}
        onBlur={() => commit({ ...draft })}
      />
      <td className="px-1 py-1">
        <Input
          aria-label="Consignment"
          placeholder="Optional"
          value={draft.consignmentId ?? ""}
          disabled={!canEdit}
          onChange={(event) => setDraft({ ...draft, consignmentId: event.target.value || null })}
          onBlur={() => commit(draft)}
          className="h-8 min-w-0 px-2"
        />
      </td>
      <td className="px-1 py-1">
        {canEdit ? (
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => duplicateCargoItem(projectId, line.id).then(report)}>
            Copy
          </Button>
        ) : null}
      </td>
    </tr>
  )
}

function LengthCell({
  label,
  cm,
  unit,
  disabled,
  onChange,
  onBlur,
}: {
  label: string
  cm: number
  unit: LengthUnit
  disabled: boolean
  onChange: (cm: number) => void
  onBlur: () => void
}) {
  const [text, setText] = useState(() => displayLength(cm, unit))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(displayLength(cm, unit))
  }, [cm, focused, unit])

  return (
    <td className="px-1 py-1">
      <Input
        aria-label={label}
        type="number"
        step="any"
        min={0}
        placeholder={LENGTH_UNIT_LABEL[unit]}
        value={text}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          if (raw.trim() === "") {
            onChange(0)
            return
          }
          const next = Number(raw)
          if (Number.isFinite(next) && next >= 0) onChange(fromDisplayLength(next, unit))
        }}
        onBlur={() => {
          setFocused(false)
          onBlur()
        }}
        className="h-8 min-w-0 px-1.5"
      />
    </td>
  )
}

function NumberCell({
  label,
  value,
  disabled,
  integer,
  placeholder,
  onChange,
  onBlur,
}: {
  label: string
  value: number
  disabled: boolean
  integer?: boolean
  placeholder?: string
  onChange: (value: number) => void
  onBlur: () => void
}) {
  return (
    <td className="px-1 py-1">
      <Input
        aria-label={label}
        type="number"
        step={integer ? 1 : "any"}
        placeholder={placeholder}
        value={value === 0 && !integer ? "" : Number.isFinite(value) ? value : ""}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value
          if (raw.trim() === "") {
            onChange(0)
            return
          }
          const next = Number(raw)
          if (Number.isFinite(next)) onChange(next)
        }}
        onBlur={onBlur}
        className="h-8 min-w-0 px-1.5"
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

function displayLength(cm: number, unit: LengthUnit): string {
  if (!Number.isFinite(cm) || cm <= 0) return ""
  return String(roundDisplayLength(toDisplayLength(cm, unit), unit))
}

function toCargoInput(line: CargoLine): CargoItemInput {
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

function report(result: { ok: boolean; error?: string }) {
  if (!result.ok && result.error) toast.error(result.error)
}
