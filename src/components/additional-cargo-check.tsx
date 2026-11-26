"use client"

import { useState } from "react"
import type { CargoItemInput } from "@compass/domain"
import { toast } from "sonner"
import { importCargoRows } from "@/app/actions/cargo"
import type { CargoLine } from "@/components/cargo-grid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LENGTH_UNIT_SYMBOL, parseLength } from "@/lib/cargo-units"
import { useLengthUnit } from "@/lib/length-unit-pref"
import type { PlanView } from "@/lib/plan-view"
import { cargoToAdd, checkExtraCargo, describeStop, extraCargoProblems, type ExtraCargo, type ExtraFitResult } from "@/lib/remaining-capacity"
import { cn } from "@/lib/utils"

type CargoOrientation = CargoItemInput["orientation"]

const ORIENTATIONS: { value: CargoOrientation; label: string }[] = [
  { value: "FIXED", label: "Do not turn" },
  { value: "ROTATE_90", label: "May turn on the floor" },
  { value: "ANY", label: "May turn any way" },
]

const select = "h-9 rounded-md border border-input bg-background px-2 text-sm"

type Form = { name: string; length: string; width: string; height: string; weight: string; quantity: string; stackable: boolean; bottomOnly: boolean; orientation: CargoOrientation }

const EMPTY: Form = { name: "", length: "", width: "", height: "", weight: "", quantity: "1", stackable: false, bottomOnly: false, orientation: "FIXED" }

export type FitResult = ExtraFitResult

/**
 * "Would this extra cargo fit?" The cargo entered is tried around the plan's pieces with the packer's own rules.
 * Nothing is saved: the plan and the cargo list stay as they are unless the planner chooses Add to cargo list.
 * Changing any input drops the previous result, so it can never be used for different values.
 */
export function AdditionalCargoCheck({
  plan,
  cargo,
  minSupportPct,
  onResult,
}: {
  plan: PlanView
  cargo: CargoLine[]
  minSupportPct: number | null
  /** The latest check, or null when it was cleared or an input changed. */
  onResult?: (result: FitResult | null) => void
}) {
  const unit = useLengthUnit()
  const [form, setForm] = useState<Form>(EMPTY)
  const [hasResult, setHasResult] = useState(false)
  const [problems, setProblems] = useState<string[]>([])

  const show = (next: FitResult | null) => {
    setHasResult(next !== null)
    onResult?.(next)
  }

  /** Any edit makes the last result stale: it is dropped at once. */
  const update = (next: Form) => {
    setForm(next)
    if (hasResult) show(null)
  }

  function read(): ExtraCargo | null {
    const found: string[] = []
    const size = (text: string, label: string) => {
      const parsed = parseLength(text, unit)
      if (!parsed.ok) found.push(`${label}: ${parsed.reason}`)
      return parsed.ok ? parsed.cm : 0
    }
    const extra: ExtraCargo = {
      name: form.name,
      lengthCm: size(form.length, "Length"),
      widthCm: size(form.width, "Width"),
      heightCm: size(form.height, "Height"),
      weightKg: Number(form.weight.replace(",", ".")),
      quantity: Number(form.quantity),
      stackable: form.stackable,
      bottomOnly: form.bottomOnly,
      orientation: form.orientation,
    }
    if (!Number.isFinite(extra.weightKg)) found.push("Weight: enter a number in kg.")
    found.push(...extraCargoProblems(extra))
    setProblems(found)
    return found.length === 0 ? extra : null
  }

  function check() {
    const extra = read()
    if (!extra) {
      show(null)
      return
    }
    show(checkExtraCargo(plan, cargo, extra, { minSupportPct }))
  }

  const field = (key: "length" | "width" | "height" | "weight" | "quantity", label: string, suffix: string) => (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <span className="flex items-center gap-1">
        <Input
          inputMode="decimal"
          value={form[key]}
          onChange={(event) => update({ ...form, [key]: event.target.value })}
          className="h-9 w-24 tabular-nums"
          aria-label={`${label} (${suffix})`}
        />
        <span className="text-xs">{suffix}</span>
      </span>
    </label>
  )

  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <h3 className="text-sm font-semibold" title="Tries the cargo around the planned pieces with the same packing rules. Nothing is saved.">
        Check additional cargo fit
      </h3>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          check()
        }}
      >
        <label className="grid gap-1 text-xs text-muted-foreground">
          Name (optional)
          <Input value={form.name} onChange={(event) => update({ ...form, name: event.target.value })} className="h-9 w-40" />
        </label>
        {field("length", "Length", LENGTH_UNIT_SYMBOL[unit])}
        {field("width", "Width", LENGTH_UNIT_SYMBOL[unit])}
        {field("height", "Height", LENGTH_UNIT_SYMBOL[unit])}
        {field("weight", "Weight per piece", "kg")}
        {field("quantity", "Quantity", "pcs")}
        <label className="grid gap-1 text-xs text-muted-foreground">
          Orientation
          <select className={select} value={form.orientation} onChange={(event) => update({ ...form, orientation: event.target.value as CargoOrientation })}>
            {ORIENTATIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 text-sm" title="Off unless you know other cargo may stand on it.">
          <input type="checkbox" checked={form.stackable} onChange={(event) => update({ ...form, stackable: event.target.checked })} />
          Stackable
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={form.bottomOnly} onChange={(event) => update({ ...form, bottomOnly: event.target.checked })} />
          Floor only
        </label>
        <Button type="submit" size="sm">
          Check fit
        </Button>
        {hasResult || problems.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setForm(EMPTY)
              setProblems([])
              show(null)
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>

      {problems.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-red-700 dark:text-red-400" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The outcome of the latest fit check, shown on its own below the form. Add to cargo list saves only the pieces
 * that fit, only on this click, and only while the result is current, through the existing cargo import action
 * and its validation. Give it a new `key` for each new check.
 */
export function AdditionalCargoResult({
  projectId,
  result,
  canEdit,
  current,
}: {
  projectId: string
  result: FitResult
  canEdit: boolean
  /** False once the plan or the cargo changed after the check: the result may then not be used. */
  current: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const stop = describeStop(result.stop)
  const toAdd = cargoToAdd(result)
  // A provisional or unvalidated result is only added once the planner says they understand it.
  const caveat = result.context.provisional || !result.validated
  const canAdd = canEdit && current && toAdd !== null && (!caveat || acknowledged)

  async function addToCargo() {
    if (adding || !canAdd || !toAdd) return
    setAdding(true)
    // The same server action and validation the cargo import uses. Saving a new line makes the plan out of
    // date (its cargo signature changes), which the page shows as usual; the plan itself is not touched.
    const outcome = await importCargoRows(projectId, [toAdd])
    setAdding(false)
    if (!outcome.ok) {
      toast.error(outcome.error)
      return
    }
    setAdded(true)
    toast.success(`Added ${toAdd.quantity} to the cargo list. Recalculate to include ${toAdd.quantity === 1 ? "it" : "them"} in the load plan.`)
  }

  if (!current) {
    return (
      <p className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground" role="status">
        The plan or the cargo changed after this check. Check again before adding anything.
      </p>
    )
  }

  return (
    <div className="space-y-2 rounded-md border bg-card p-4 text-sm" role="status">
      <h3 className="text-sm font-semibold">Additional cargo simulation result</h3>
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        <div>
          <dt className="text-xs text-muted-foreground">Requested</dt>
          <dd className="font-semibold tabular-nums">{result.requested}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Fit</dt>
          <dd className={cn("font-semibold tabular-nums", result.placed > 0 && "text-emerald-700 dark:text-emerald-400")}>{result.placed}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Do not fit</dt>
          <dd className={cn("font-semibold tabular-nums", result.notPlaced > 0 && "text-amber-800 dark:text-amber-300")}>{result.notPlaced}</dd>
        </div>
      </dl>
      {result.placed > 0 ? <p className="text-xs text-muted-foreground">The pieces that fit are shown dashed in the views below.</p> : null}
      {!result.allFit ? (
        <p>
          <span className="font-medium">{stop.physical ? "Limited by" : "Stopped by"}:</span> {stop.label}
          {!stop.physical ? " (simulation limit, more may fit)" : ""}
        </p>
      ) : null}
      {result.units.length > 1 ? (
        <p className="text-xs text-muted-foreground">{result.units.map((entry) => `Unit ${entry.unitIndex + 1}: ${entry.pieces}`).join(" · ")}</p>
      ) : null}
      {result.units.flatMap((entry) => entry.newWarnings.map((warning) => `Unit ${entry.unitIndex + 1}: ${warning}`)).map((warning) => (
        <p key={warning} className="text-amber-800 dark:text-amber-300">
          {warning}.
        </p>
      ))}
      {!result.validated ? <p className="text-amber-800 dark:text-amber-300">Not validated: the plan breaks a rule (see above).</p> : null}
      {result.context.provisional ? (
        <p className="rounded-md border border-dashed border-amber-500 bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-medium">Provisional:</span> {result.context.provisionalReasons.join(" ")}
        </p>
      ) : null}
      {canEdit && toAdd ? (
        <div className="flex flex-wrap items-center gap-3">
          {caveat && !added ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              I understand this result is {result.context.provisional ? "provisional" : "not validated"}
            </label>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => void addToCargo()} disabled={adding || added || !canAdd} title="Adds a cargo line with the pieces that fit. The plan then needs a recalculation.">
            {added ? `Added ${toAdd.quantity} to cargo list` : adding ? "Adding…" : `Add ${toAdd.quantity} to cargo list`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
