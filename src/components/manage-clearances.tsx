"use client"

import { useMemo, useState } from "react"
import { Pencil } from "lucide-react"
import { describeSetting, describeSides, MAX_CLEARANCE_CM, sameSetting, type ClearanceSetting } from "@compass/physics"
import type { ClearanceInput } from "@/app/actions/clearance"
import type { CargoLine } from "@/components/cargo-grid"
import { ClearanceEditorDialog } from "@/components/clearance-editor"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CLEARANCE_HELP, countSettings, lineSetting, normaliseClearance } from "@/lib/clearance"
import { lengthCellText, LENGTH_UNIT_SYMBOL } from "@/lib/cargo-units"
import { useLengthUnit } from "@/lib/length-unit-pref"
import { cn } from "@/lib/utils"

const PAGE = 100

/**
 * One place to review and change every clearance in the project without going back to the Cargo
 * page: the project default and each cargo line's own setting. Edits are collected here and applied
 * together, so the load plan is recalculated once, not after every change.
 */
export function ManageClearancesDialog({
  open,
  onOpenChange,
  lines,
  projectDefault,
  hasPlan,
  busy,
  canEdit = true,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lines: CargoLine[]
  projectDefault: number
  hasPlan: boolean
  busy: boolean
  /** Viewers can read every setting but not change any. */
  canEdit?: boolean
  onApply: (change: ClearanceInput) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col gap-3">
        {open ? (
          <Body
            lines={lines}
            projectDefault={projectDefault}
            hasPlan={hasPlan}
            busy={busy}
            canEdit={canEdit}
            onCancel={() => onOpenChange(false)}
            // The caller closes this once it has acted: with a plan it first asks Keep or Recalculate, and Cancel there leaves these edits as they are.
            onApply={onApply}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Body({
  lines,
  projectDefault,
  hasPlan,
  busy,
  canEdit,
  onCancel,
  onApply,
}: {
  lines: CargoLine[]
  projectDefault: number
  hasPlan: boolean
  busy: boolean
  canEdit: boolean
  onCancel: () => void
  onApply: (change: ClearanceInput) => void
}) {
  const lengthUnit = useLengthUnit()
  const [defaultText, setDefaultText] = useState(String(projectDefault))
  const [edits, setEdits] = useState<Record<string, ClearanceSetting>>({})
  const [query, setQuery] = useState("")
  const [shown, setShown] = useState(PAGE)
  const [editingId, setEditingId] = useState<string | null>(null)

  const parsedDefault = Number(defaultText)
  const defaultValid = defaultText.trim() !== "" && Number.isFinite(parsedDefault) && parsedDefault >= 0 && parsedDefault <= MAX_CLEARANCE_CM
  const defaultNow = defaultValid ? normaliseClearance(parsedDefault) : projectDefault
  const defaultChanged = defaultValid && defaultNow !== projectDefault

  const settingOf = (line: CargoLine): ClearanceSetting => (line.id in edits ? (edits[line.id] ?? null) : lineSetting(line))
  const changedLines = useMemo(
    () => lines.filter((line) => line.id in edits && !sameSetting(edits[line.id] ?? null, lineSetting(line))),
    [edits, lines],
  )
  const counts = useMemo(() => countSettings(lines.map(settingOf)), [lines, edits]) // eslint-disable-line react-hooks/exhaustive-deps

  const needle = query.trim().toLowerCase()
  const matching = needle
    ? lines.filter((line) => `${line.sku ?? ""} ${line.name}`.toLowerCase().includes(needle))
    : lines
  const visible = matching.slice(0, shown)
  const editing = lines.find((line) => line.id === editingId) ?? null
  const changes = changedLines.length + (defaultChanged ? 1 : 0)

  function apply() {
    if (!defaultValid) return
    onApply({
      ...(defaultChanged ? { defaultCm: defaultNow } : {}),
      lines: changedLines.map((line) => ({ cargoId: line.id, setting: edits[line.id] ?? null })),
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Manage clearances</DialogTitle>
        <DialogDescription>
          Reserved handling space around cargo. Change the project default and any cargo line here, then apply everything at once.
        </DialogDescription>
      </DialogHeader>

      <section className="rounded-md border bg-card p-3" aria-label="Project default">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="manage-default" className="text-xs">
              Project default (cm per side)
            </Label>
            <Input
              id="manage-default"
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_CLEARANCE_CM}
              step={0.5}
              value={defaultText}
              aria-invalid={!defaultValid}
              disabled={!canEdit}
              onChange={(event) => setDefaultText(event.target.value)}
              className="h-8 w-28 px-2 tabular-nums"
            />
          </div>
          <p className="min-w-56 flex-1 text-xs text-muted-foreground">
            Lines set to “Default” follow this value automatically. A line with its own value, including 0, keeps it when the default changes.
            {!defaultValid ? <span className="ml-1 text-destructive">Enter 0 to {MAX_CLEARANCE_CM}.</span> : null}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Find a line by name or SKU"
          aria-label="Find a cargo line"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setShown(PAGE)
          }}
          className="h-8 max-w-64"
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {lines.length} line{lines.length === 1 ? "" : "s"}: {counts.inherited} use the default, {counts.custom} have their own
          {changes > 0 ? ` · ${changes} change${changes === 1 ? "" : "s"} not applied yet` : ""}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="sticky top-0 z-[1] bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="w-24 px-2 py-2">SKU</th>
              <th className="px-2 py-2">Cargo</th>
              <th className="w-14 px-2 py-2 text-right">Qty</th>
              <th className="w-40 px-2 py-2">L × W × H ({LENGTH_UNIT_SYMBOL[lengthUnit]})</th>
              <th className="w-48 px-2 py-2">Clearance</th>
              <th className="w-16 px-2 py-2">
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((line) => {
              const setting = settingOf(line)
              const changed = line.id in edits && !sameSetting(edits[line.id] ?? null, lineSetting(line))
              return (
                <tr key={line.id} className={cn("border-t", changed && "bg-amber-500/10")}>
                  <td className="truncate px-2 py-1.5 text-muted-foreground">{line.sku ?? "—"}</td>
                  <td className="truncate px-2 py-1.5 font-medium" title={line.name}>
                    {line.name || "Unnamed line"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{line.quantity}</td>
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                    {lengthCellText(line.lengthCm, lengthUnit)} × {lengthCellText(line.widthCm, lengthUnit)} × {lengthCellText(line.heightCm, lengthUnit)}
                  </td>
                  <td
                    className="truncate px-2 py-1.5 tabular-nums"
                    title={typeof setting === "object" && setting ? describeSides(setting) : undefined}
                  >
                    {describeSetting(setting, defaultNow)}
                    {changed ? <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-400">edited</span> : null}
                  </td>
                  <td className="px-2 py-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`${canEdit ? "Edit" : "View"} clearance for ${line.name || "this line"}`}
                      onClick={() => setEditingId(line.id)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {lines.length === 0 ? "There is no cargo in this project yet." : "No cargo line matches that search."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {matching.length > shown ? (
          <div className="border-t p-2 text-center">
            <Button type="button" size="sm" variant="outline" onClick={() => setShown((count) => count + PAGE)}>
              Show {Math.min(PAGE, matching.length - shown)} more of {matching.length - shown} remaining
            </Button>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">{CLEARANCE_HELP}</p>

      <DialogFooter className="gap-2 sm:justify-between">
        <p className="self-center text-xs text-muted-foreground">
          {hasPlan
            ? "Applying asks whether to keep your current layout or recalculate, once for all of these changes."
            : "Applying saves these settings. No load plan has been calculated yet."}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={apply} disabled={!canEdit || busy || !defaultValid || changes === 0}>
            {hasPlan ? "Apply changes…" : "Save"}
          </Button>
        </div>
      </DialogFooter>

      {editing ? (
        <ClearanceEditorDialog
          open
          onOpenChange={(next) => {
            if (!next) setEditingId(null)
          }}
          line={{
            id: editing.id,
            sku: editing.sku,
            name: editing.name,
            lengthCm: editing.lengthCm,
            widthCm: editing.widthCm,
            heightCm: editing.heightCm,
            weightKg: editing.weightKg,
            quantity: editing.quantity,
          }}
          setting={settingOf(editing)}
          projectDefault={defaultNow}
          applyLabel="Keep change"
          onApply={(setting) => setEdits((current) => ({ ...current, [editing.id]: setting }))}
        />
      ) : null}
    </>
  )
}

