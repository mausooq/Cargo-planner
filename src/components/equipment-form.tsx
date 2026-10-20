"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import { EQUIPMENT_MODES, OOG_CLASSES, modeLabel, type EquipmentMode, type OogClass } from "@compass/domain"
import { createEquipment, deleteEquipment, updateEquipment } from "@/app/actions/equipment"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { emptyContour, type UldContour, type UldSideContour } from "@/lib/uld-contour"

type Draft = {
  mode: EquipmentMode
  name: string
  innerLengthCm: string
  innerWidthCm: string
  innerHeightCm: string
  heightOpen: boolean
  maxPayloadKg: string
  tareKg: string
  doorWidthCm: string
  doorHeightCm: string
  oogClass: OogClass
  notes: string
  contour: UldContour
}

export function EquipmentForm({
  item,
  onClose,
}: {
  item?: EquipmentListItem | null
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(item))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const payload = {
      id: item?.id,
      mode: draft.mode,
      name: draft.name,
      innerLengthCm: numberOrNaN(draft.innerLengthCm),
      innerWidthCm: numberOrNaN(draft.innerWidthCm),
      innerHeightCm: numberOrNaN(draft.innerHeightCm),
      heightOpen: draft.heightOpen,
      maxPayloadKg: numberOrNaN(draft.maxPayloadKg),
      tareKg: numberOrNaN(draft.tareKg || "0"),
      doorWidthCm: optionalNumber(draft.doorWidthCm),
      doorHeightCm: optionalNumber(draft.doorHeightCm),
      oogClass: draft.oogClass,
      notes: draft.notes.trim() || null,
      contour: draft.contour,
    }
    const result = item ? await updateEquipment(payload) : await createEquipment(payload)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
  }

  async function onDelete() {
    if (!item?.isCustom) return
    if (!window.confirm(`Remove ${item.name}?`)) return
    setPending(true)
    const result = await deleteEquipment(item.id)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">{item ? "Edit equipment" : "Add equipment"}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Length, width, height, payload, and contours are live planning values. 3D updates from these numbers.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        </Field>
        <Field label="Mode">
          <select
            value={draft.mode}
            onChange={(event) => setDraft({ ...draft, mode: event.target.value as EquipmentMode })}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            disabled={Boolean(item) && !item?.isCustom}
          >
            {EQUIPMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {modeLabel(mode)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Length (cm)">
          <Input
            type="number"
            min="0.1"
            step="0.1"
            value={draft.innerLengthCm}
            onChange={(event) => setDraft({ ...draft, innerLengthCm: event.target.value })}
            required
          />
        </Field>
        <Field label="Width (cm)">
          <Input
            type="number"
            min="0.1"
            step="0.1"
            value={draft.innerWidthCm}
            onChange={(event) => setDraft({ ...draft, innerWidthCm: event.target.value })}
            required
          />
        </Field>
        <Field label="Height (cm)">
          <Input
            type="number"
            min="0.1"
            step="0.1"
            value={draft.innerHeightCm}
            onChange={(event) => setDraft({ ...draft, innerHeightCm: event.target.value })}
            required
          />
        </Field>
        <Field label="Payload (kg)">
          <Input
            type="number"
            min="0.1"
            step="0.1"
            value={draft.maxPayloadKg}
            onChange={(event) => setDraft({ ...draft, maxPayloadKg: event.target.value })}
            required
          />
        </Field>
        <Field label="Tare (kg)">
          <Input
            type="number"
            min="0"
            step="0.1"
            value={draft.tareKg}
            onChange={(event) => setDraft({ ...draft, tareKg: event.target.value })}
          />
        </Field>
        <Field label="Door width (cm)">
          <Input
            type="number"
            min="0.1"
            step="0.1"
            value={draft.doorWidthCm}
            onChange={(event) => setDraft({ ...draft, doorWidthCm: event.target.value })}
          />
        </Field>
        <Field label="Door height (cm)">
          <Input
            type="number"
            min="0.1"
            step="0.1"
            value={draft.doorHeightCm}
            onChange={(event) => setDraft({ ...draft, doorHeightCm: event.target.value })}
          />
        </Field>
        <Field label="Out of gauge">
          <select
            value={draft.oogClass}
            onChange={(event) => setDraft({ ...draft, oogClass: event.target.value as OogClass })}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            {OOG_CLASSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={draft.heightOpen}
            onChange={(event) => setDraft({ ...draft, heightOpen: event.target.checked })}
          />
          Open height (stack cap, not a roof)
        </label>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Contours (mm)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <SideFields
            label="Bottom left"
            side={draft.contour.bottomLeft}
            onChange={(side) => setDraft({ ...draft, contour: { ...draft.contour, bottomLeft: side } })}
          />
          <SideFields
            label="Bottom right"
            side={draft.contour.bottomRight}
            onChange={(side) => setDraft({ ...draft, contour: { ...draft.contour, bottomRight: side } })}
          />
          <SideFields
            label="Top left"
            side={draft.contour.topLeft}
            onChange={(side) => setDraft({ ...draft, contour: { ...draft.contour, topLeft: side } })}
          />
          <SideFields
            label="Top right"
            side={draft.contour.topRight}
            onChange={(side) => setDraft({ ...draft, contour: { ...draft.contour, topRight: side } })}
          />
        </div>
      </div>
      <Field label="Notes">
        <textarea
          value={draft.notes}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </Field>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {item ? "Save dimensions" : "Add to library"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {item?.isCustom ? (
          <Button type="button" variant="destructive" onClick={onDelete} disabled={pending}>
            Remove
          </Button>
        ) : null}
      </div>
    </form>
  )
}

function SideFields({
  label,
  side,
  onChange,
}: {
  label: string
  side: UldSideContour
  onChange: (side: UldSideContour) => void
}) {
  return (
    <fieldset className="grid grid-cols-2 gap-2 rounded-md border p-2">
      <legend className="px-1 text-xs text-muted-foreground">{label}</legend>
      <Input
        type="number"
        min="0"
        step="1"
        value={side.lengthMm || ""}
        placeholder="Length"
        onChange={(event) => onChange({ ...side, lengthMm: Number(event.target.value || 0) })}
      />
      <Input
        type="number"
        min="0"
        step="1"
        value={side.heightMm || ""}
        placeholder="Height"
        onChange={(event) => onChange({ ...side, heightMm: Number(event.target.value || 0) })}
      />
    </fieldset>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function toDraft(item?: EquipmentListItem | null): Draft {
  return {
    mode: item?.mode ?? "SEA",
    name: item?.name ?? "",
    innerLengthCm: item ? String(item.innerLengthCm) : "",
    innerWidthCm: item ? String(item.innerWidthCm) : "",
    innerHeightCm: item ? String(item.innerHeightCm) : "",
    heightOpen: item?.heightOpen ?? false,
    maxPayloadKg: item ? String(item.maxPayloadKg) : "",
    tareKg: item ? String(item.tareKg) : "0",
    doorWidthCm: item?.doorWidthCm ? String(item.doorWidthCm) : "",
    doorHeightCm: item?.doorHeightCm ? String(item.doorHeightCm) : "",
    oogClass: item?.oogClass ?? "NONE",
    notes: item?.notes ?? "",
    contour: item?.contour ?? emptyContour(),
  }
}

function numberOrNaN(value: string): number {
  return Number(value)
}

function optionalNumber(value: string): number | null {
  const next = Number(value)
  return value.trim() && Number.isFinite(next) && next > 0 ? next : null
}
