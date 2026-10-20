"use client"

import { useId, useState, type FormEvent, type ReactNode } from "react"
import { EQUIPMENT_MODES, OOG_CLASSES, modeLabel, type EquipmentMode, type OogClass } from "@compass/domain"
import { toast } from "sonner"
import { createEquipment, deleteEquipment, updateEquipment } from "@/app/actions/equipment"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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

type FieldErrors = Record<string, string>

const CONTOUR_FIELDS: { key: keyof UldContour; label: string }[] = [
  { key: "bottomLeft", label: "Bottom left" },
  { key: "bottomRight", label: "Bottom right" },
  { key: "topLeft", label: "Top left" },
  { key: "topRight", label: "Top right" },
]

export function EquipmentForm({
  item,
  onClose,
  onSaved,
}: {
  item?: EquipmentListItem | null
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(item))
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [pending, setPending] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const savingCopy = Boolean(item && !item.isCustom)
  const openHeightId = useId()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setFieldErrors({})
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
      setFieldErrors(result.fieldErrors ?? {})
      setError(result.error)
      return
    }
    toast.success(savingCopy ? `Saved ${draft.name} as custom equipment.` : `Saved ${draft.name}.`)
    onSaved?.(result.id)
    onClose()
  }

  async function onDelete() {
    if (!item?.isCustom) return
    setConfirmDelete(false)
    setPending(true)
    setError(null)
    const result = await deleteEquipment(item.id)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast.success(`Removed ${item.name}.`)
    onClose()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border bg-card p-4" noValidate>
      <div>
        <h3 className="text-sm font-semibold">{item ? (savingCopy ? "Save as custom" : "Edit equipment") : "Add equipment"}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Length, width, height, payload, and contours are live planning values. 3D updates from these numbers.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={fieldErrors.name}>
          {(field) => (
            <Input
              {...field}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              required
            />
          )}
        </Field>
        <Field label="Mode" error={fieldErrors.mode}>
          {(field) => (
            <select
              {...field}
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
          )}
        </Field>
        <Field label="Length (cm)" error={fieldErrors.innerLengthCm}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min="0.1"
              step="0.1"
              value={draft.innerLengthCm}
              onChange={(event) => setDraft({ ...draft, innerLengthCm: event.target.value })}
              required
            />
          )}
        </Field>
        <Field label="Width (cm)" error={fieldErrors.innerWidthCm}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min="0.1"
              step="0.1"
              value={draft.innerWidthCm}
              onChange={(event) => setDraft({ ...draft, innerWidthCm: event.target.value })}
              required
            />
          )}
        </Field>
        <Field label="Height (cm)" error={fieldErrors.innerHeightCm}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min="0.1"
              step="0.1"
              value={draft.innerHeightCm}
              onChange={(event) => setDraft({ ...draft, innerHeightCm: event.target.value })}
              required
            />
          )}
        </Field>
        <Field label="Payload (kg)" error={fieldErrors.maxPayloadKg}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min="0.1"
              step="0.1"
              value={draft.maxPayloadKg}
              onChange={(event) => setDraft({ ...draft, maxPayloadKg: event.target.value })}
              required
            />
          )}
        </Field>
        <Field label="Tare (kg)" error={fieldErrors.tareKg}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min="0"
              step="0.1"
              value={draft.tareKg}
              onChange={(event) => setDraft({ ...draft, tareKg: event.target.value })}
            />
          )}
        </Field>
        <Field label="Door width (cm)" error={fieldErrors.doorWidthCm}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min="0.1"
              step="0.1"
              value={draft.doorWidthCm}
              onChange={(event) => setDraft({ ...draft, doorWidthCm: event.target.value })}
            />
          )}
        </Field>
        <Field label="Door height (cm)" error={fieldErrors.doorHeightCm}>
          {(field) => (
            <Input
              {...field}
              type="number"
              min="0.1"
              step="0.1"
              value={draft.doorHeightCm}
              onChange={(event) => setDraft({ ...draft, doorHeightCm: event.target.value })}
            />
          )}
        </Field>
        <Field label="Out of gauge" error={fieldErrors.oogClass}>
          {(field) => (
            <select
              {...field}
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
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2" htmlFor={openHeightId}>
          <input
            id={openHeightId}
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
          {CONTOUR_FIELDS.map((entry) => (
            <SideFields
              key={entry.key}
              label={entry.label}
              sideKey={entry.key}
              side={draft.contour[entry.key]}
              fieldErrors={fieldErrors}
              onChange={(side) => setDraft({ ...draft, contour: { ...draft.contour, [entry.key]: side } })}
            />
          ))}
        </div>
      </div>
      <Field label="Notes" error={fieldErrors.notes}>
        {(field) => (
          <textarea
            {...field}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        )}
      </Field>
      <div aria-live="assertive" role="alert">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {savingCopy ? "Save as custom" : item ? "Save dimensions" : "Add to library"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {item?.isCustom ? (
          <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)} disabled={pending}>
            Remove
          </Button>
        ) : null}
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {item?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This custom equipment will leave the library. Projects that already use it cannot be deleted until those units are removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={onDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}

function SideFields({
  label,
  sideKey,
  side,
  fieldErrors,
  onChange,
}: {
  label: string
  sideKey: keyof UldContour
  side: UldSideContour
  fieldErrors: FieldErrors
  onChange: (side: UldSideContour) => void
}) {
  const lengthId = useId()
  const heightId = useId()
  const lengthError = fieldErrors[`contour.${sideKey}.lengthMm`]
  const heightError = fieldErrors[`contour.${sideKey}.heightMm`]
  const lengthErrorId = `${lengthId}-error`
  const heightErrorId = `${heightId}-error`
  return (
    <fieldset className="grid grid-cols-2 gap-2 rounded-md border p-2">
      <legend className="px-1 text-xs text-muted-foreground">{label}</legend>
      <div className="space-y-1">
        <Label htmlFor={lengthId}>L (mm)</Label>
        <Input
          id={lengthId}
          type="number"
          min="0"
          step="1"
          value={side.lengthMm || ""}
          aria-invalid={lengthError ? true : undefined}
          aria-describedby={lengthError ? lengthErrorId : undefined}
          onChange={(event) => onChange({ ...side, lengthMm: Number(event.target.value || 0) })}
        />
        {lengthError ? (
          <p id={lengthErrorId} className="text-sm text-destructive">
            {lengthError}
          </p>
        ) : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor={heightId}>H (mm)</Label>
        <Input
          id={heightId}
          type="number"
          min="0"
          step="1"
          value={side.heightMm || ""}
          aria-invalid={heightError ? true : undefined}
          aria-describedby={heightError ? heightErrorId : undefined}
          onChange={(event) => onChange({ ...side, heightMm: Number(event.target.value || 0) })}
        />
        {heightError ? (
          <p id={heightErrorId} className="text-sm text-destructive">
            {heightError}
          </p>
        ) : null}
      </div>
    </fieldset>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: (field: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode
}) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId : undefined,
      })}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
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
