"use client"

import { AlertTriangle, ChevronDown, ChevronRight, FileSearch, Loader2, Plus, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LENGTH_UNIT_LABEL, LENGTH_UNITS, LENGTH_UNIT_SYMBOL, type LengthUnit } from "@/lib/cargo-units"
import type { ReviewDocument } from "@/lib/cargo-extract"
import { formatKg, formatM3 } from "@/lib/format"
import {
  blankLine,
  compareTotals,
  consolidateIssues,
  describeRows,
  describeSource,
  displayDimension,
  evaluateLine,
  findDuplicates,
  isImportable,
  STATUS_LABEL,
  STATUS_SHORT,
  summarize,
  toDraft,
  withOriginal,
  type Confirmation,
  type ExistingCargoSummary,
  type IssueGroup,
  type LineEval,
  type LineStatus,
  type ReviewLine,
  type WeightKind,
  type WeightScope,
} from "@/lib/import-review"
import { applyEdit, applySizeUnit, applyWeightUnit, dimensionText, sourceTarget, weightPatch } from "@/lib/import-edit"
import { IMPORT_WEIGHT_UNIT_LABEL, IMPORT_WEIGHT_UNITS, type ImportWeightUnit } from "@/lib/import-units"
import { useLengthUnit } from "@/lib/length-unit-pref"
import { cn } from "@/lib/utils"

/**
 * The review step of every import, in the same compact shape as the Cargo grid: one row per cargo
 * line, edited in place. Whatever the cargo was read from, the planner fixes what is flagged, sees one
 * consolidated "Please check" box instead of a warning on every row, and chooses what to add. Nothing
 * is saved from here; the parent receives the lines when the planner confirms.
 */

export type SourceView =
  | { kind: "image"; url: string; name: string }
  | { kind: "pdf"; url: string; name: string }
  | { kind: "text"; text: string }
  | { kind: "sheet"; name: string; headers: string[] | null; rows: { rowNumber: number; cells: string[] }[]; truncated: boolean }

export type ImportChoice = { mode: "append" | "replace"; confirmReplace: boolean; suggest: boolean }

const STATUS_STYLE: Record<LineStatus, string> = {
  ready: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  corrected: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  missing: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300",
  ambiguous: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  invalid: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300",
  excluded: "bg-muted text-muted-foreground",
}

const select = "h-8 rounded-md border bg-background px-1.5 text-sm"
const SCOPE_LABEL: Record<WeightScope, string> = { piece: "For each piece", line: "For the whole line", unclear: "Not stated" }
const KIND_LABEL: Record<WeightKind, string> = { unspecified: "Gross or net not stated", gross: "Gross (with packaging)", net: "Net (without packaging)" }

const trim4 = (value: number) => String(Math.round(value * 10000) / 10000)

export function CargoImportReview({
  document,
  source,
  existing,
  importing,
  onBack,
  onCancel,
  onImport,
}: {
  document: ReviewDocument
  /** The original document, when there is one to show. Null hides the View original buttons. */
  source: SourceView | null
  existing: ExistingCargoSummary[]
  importing: boolean
  onBack: () => void
  onCancel: () => void
  onImport: (lines: ReviewLine[], choice: ImportChoice) => void
}) {
  const unit = useLengthUnit()
  const [lines, setLines] = useState<ReviewLine[]>(document.lines)
  const [activeId, setActiveId] = useState<string | null>(document.lines[0]?.id ?? null)
  const [note, setNote] = useState<string | null>(null)
  const [mode, setMode] = useState<"append" | "replace">("append")
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [nextId, setNextId] = useState(1)
  const [pickedSizeUnit, setPickedSizeUnit] = useState<LengthUnit>("cm")
  const [pickedWeightUnit, setPickedWeightUnit] = useState<ImportWeightUnit>("kg")

  const evaluations = useMemo(() => lines.map(evaluateLine), [lines])
  const summary = useMemo(() => summarize(lines, evaluations), [lines, evaluations])
  const duplicates = useMemo(() => findDuplicates(lines, evaluations, existing), [lines, evaluations, existing])
  const groups = useMemo(() => consolidateIssues(lines, evaluations), [lines, evaluations])
  const totalNotes = useMemo(() => compareTotals(summary, document.documentTotals), [summary, document.documentTotals])
  const detailsLine = lines.find((line) => line.id === detailsId) ?? null

  const included = lines.map((line, index) => ({ line, evaluation: evaluations[index]!, number: index + 1 })).filter((entry) => entry.line.include)
  const needSizeUnit = included.filter((entry) => entry.evaluation.issues.some((issue) => issue.code === "size-unit"))
  const needWeightUnit = included.filter((entry) => entry.evaluation.issues.some((issue) => issue.code === "weight-unit"))

  const complete = included.filter((entry) => isImportable(entry.evaluation))
  const incompleteEntries = included.filter((entry) => !isImportable(entry.evaluation))
  const undraftable = incompleteEntries.filter((entry) => toDraft(entry.line, entry.evaluation) === null)
  const modeReady = mode === "append" || confirmReplace
  const canSuggest = !importing && included.length > 0 && incompleteEntries.length === 0 && modeReady
  const canAddOnly = !importing && included.length > 0 && undraftable.length === 0 && modeReady

  function edit(id: string, patch: Partial<ReviewLine>, touched: (keyof ReviewLine)[]) {
    setLines((current) => current.map((line) => (line.id === id ? applyEdit(line, patch, touched) : line)))
  }

  function confirm(id: string, what: Confirmation) {
    setLines((current) => current.map((line) => (line.id === id && !line.confirmed.includes(what) ? { ...line, confirmed: [...line.confirmed, what] } : line)))
  }

  function addLine() {
    const id = `manual-${nextId}`
    setNextId((value) => value + 1)
    setLines((current) => [...current, withOriginal({ ...blankLine(id), edited: ["added"], quantity: "1" })])
    setActiveId(id)
  }

  /** One choice of unit for every row that does not state one. The numbers stay as they were read. */
  function useSizeUnit() {
    setLines((current) => applySizeUnit(current, new Set(needSizeUnit.map((entry) => entry.line.id)), pickedSizeUnit))
  }
  function useWeightUnit() {
    setLines((current) => applyWeightUnit(current, new Set(needWeightUnit.map((entry) => entry.line.id)), pickedWeightUnit))
  }

  function submit(suggest: boolean) {
    onImport(
      included.map((entry) => entry.line),
      { mode, confirmReplace: mode === "replace" && confirmReplace, suggest },
    )
  }

  const blockers = incompleteEntries.flatMap((entry) => entry.evaluation.issues.slice(0, 1).map((issue) => `Row ${entry.number}: ${issue.message}`)).slice(0, 3)

  return (
    <section className="space-y-4 rounded-md border bg-card p-4" aria-label="Review imported cargo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className={cn("size-4 shrink-0 text-primary", document.reader.provider === "" && "hidden")} aria-hidden="true" />
            Review before adding
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {document.summary || "Check the lines against your document."}
            {document.language ? ` Language: ${document.language}.` : ""}
            {document.reader.provider === "" ? " Read from your spreadsheet columns; no AI was used." : ` Read by ${document.reader.provider}${document.reader.model ? ` (${document.reader.model})` : ""}. It can misread a number, so compare the lines with your document.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {source ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setSourceOpen(true)}>
              <FileSearch className="size-4" />
              View original
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={onBack} disabled={importing}>
            Back
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={importing}>
            Cancel
          </Button>
        </div>
      </div>

      {document.partial ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200" role="alert">
          Only part of the document may have been read. Check that no lines are missing before adding.
        </p>
      ) : null}

      <PleaseCheck groups={groups} documentNotes={[...document.notes, ...totalNotes]} lineCount={lines.length} />

      {needSizeUnit.length > 0 || needWeightUnit.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-amber-500/50 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-500/10">
          {needSizeUnit.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {needSizeUnit.length} row{needSizeUnit.length === 1 ? " has" : "s have"} sizes with no unit stated. The numbers are kept as read.
              </span>
              <select className={select} value={pickedSizeUnit} onChange={(event) => setPickedSizeUnit(event.target.value as LengthUnit)} aria-label="Unit of the sizes">
                {LENGTH_UNITS.map((entry) => (
                  <option key={entry} value={entry}>
                    {LENGTH_UNIT_LABEL[entry]}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" onClick={useSizeUnit}>
                Use for {needSizeUnit.length === 1 ? "this row" : `these ${needSizeUnit.length} rows`}
              </Button>
            </div>
          ) : null}
          {needWeightUnit.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {needWeightUnit.length} row{needWeightUnit.length === 1 ? " has" : "s have"} a weight with no unit stated.
              </span>
              <select className={select} value={pickedWeightUnit} onChange={(event) => setPickedWeightUnit(event.target.value as ImportWeightUnit)} aria-label="Unit of the weights">
                {IMPORT_WEIGHT_UNITS.map((entry) => (
                  <option key={entry} value={entry}>
                    {IMPORT_WEIGHT_UNIT_LABEL[entry]}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" onClick={useWeightUnit}>
                Use for {needWeightUnit.length === 1 ? "this row" : `these ${needWeightUnit.length} rows`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="min-h-5 text-xs text-muted-foreground" role="status" aria-live="polite">
        {note ?? "Click any cell to edit it. A highlighted cell says what needs attention when you select it."}
      </p>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[60rem] text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="w-8 px-2 py-2">
                <span className="sr-only">Add</span>
              </th>
              <th className="px-2 py-2 font-medium">Mark</th>
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 text-right font-medium" title={`Length in ${LENGTH_UNIT_LABEL[unit]}`}>
                L ({LENGTH_UNIT_SYMBOL[unit]})
              </th>
              <th className="px-2 py-2 text-right font-medium" title={`Width in ${LENGTH_UNIT_LABEL[unit]}`}>
                W ({LENGTH_UNIT_SYMBOL[unit]})
              </th>
              <th className="px-2 py-2 text-right font-medium" title={`Height in ${LENGTH_UNIT_LABEL[unit]}`}>
                H ({LENGTH_UNIT_SYMBOL[unit]})
              </th>
              <th className="px-2 py-2 text-right font-medium" title="Weight of one piece, in kilograms. The gross weight (with packaging) when the document gives one.">
                kg / piece
              </th>
              <th className="px-2 py-2 text-right font-medium">Qty</th>
              <th className="px-2 py-2 font-medium" title="Whether other cargo may be placed on top">
                Stackable
              </th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="w-24 px-2 py-2">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No cargo lines were found. Add one by hand, or go back and try another file.
                </td>
              </tr>
            ) : null}
            {lines.map((line, index) => (
              <ReviewRow
                key={line.id}
                number={index + 1}
                line={line}
                evaluation={evaluations[index]!}
                duplicates={duplicates.get(line.id) ?? []}
                unit={unit}
                active={line.id === activeId}
                hasSource={source !== null}
                onActive={(message) => {
                  setActiveId(line.id)
                  setNote(message ? `Row ${index + 1}: ${message}` : null)
                }}
                onEdit={(patch, touched) => edit(line.id, patch, touched)}
                onDetails={() => setDetailsId(line.id)}
                onSource={() => {
                  setActiveId(line.id)
                  setSourceOpen(true)
                }}
                onRemove={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          <Plus className="size-4" />
          Add a cargo line
        </Button>
        <Totals summary={summary} />
      </div>

      {existing.length > 0 ? (
        <fieldset className="space-y-2 text-sm">
          <legend className="font-medium">
            This project already has {existing.length} cargo line{existing.length === 1 ? "" : "s"}
          </legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="import-mode" checked={mode === "append"} onChange={() => setMode("append")} />
            Add these lines to the existing cargo
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="import-mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
            Replace the existing cargo with these lines
          </label>
          {mode === "replace" ? (
            <label className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-red-900 dark:bg-red-500/10 dark:text-red-200">
              <input type="checkbox" className="mt-1" checked={confirmReplace} onChange={(event) => setConfirmReplace(event.target.checked)} />
              <span>
                Remove the {existing.length} existing line{existing.length === 1 ? "" : "s"}. Their places in any saved load plan are removed too, and the plan will need calculating again. This cannot be undone.
              </span>
            </label>
          ) : null}
        </fieldset>
      ) : null}

      <div className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => submit(true)} disabled={!canSuggest}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Add {included.length} line{included.length === 1 ? "" : "s"} and suggest equipment
          </Button>
          <Button type="button" variant="outline" onClick={() => submit(false)} disabled={!canAddOnly}>
            Add lines only
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {included.length === 0
            ? "Select at least one line."
            : mode === "replace" && !confirmReplace
              ? "Confirm the replacement to continue."
              : undraftable.length > 0
                ? `${undraftable.length === 1 ? "A line needs" : `${undraftable.length} lines need`} a quantity and a description or mark before ${undraftable.length === 1 ? "it" : "they"} can be added, even as a draft (${describeRows(undraftable.map((entry) => entry.number))}).`
                : incompleteEntries.length > 0
                  ? `Equipment suggestions need every selected line complete. ${incompleteEntries.length} ${incompleteEntries.length === 1 ? "line is" : "lines are"} not (${describeRows(incompleteEntries.map((entry) => entry.number))}).${blockers.length > 0 ? ` ${blockers.join(" ")}` : ""} Fix ${incompleteEntries.length === 1 ? "it" : "them"} here, or use Add lines only: ${incompleteEntries.length === 1 ? "it is" : "they are"} added as ${incompleteEntries.length === 1 ? "a draft" : "drafts"} for you to finish in the Cargo grid, and left out of equipment suggestions and load plans until then.`
                  : `${complete.length} line${complete.length === 1 ? " is" : "s are"} complete. Nothing is added until you choose.`}
        </p>
      </div>

      <LineDetails
        line={detailsLine}
        evaluation={detailsLine ? evaluations[lines.indexOf(detailsLine)]! : null}
        duplicates={detailsLine ? (duplicates.get(detailsLine.id) ?? []) : []}
        onClose={() => setDetailsId(null)}
        onEdit={(patch, touched) => detailsLine && edit(detailsLine.id, patch, touched)}
        onConfirm={(what) => detailsLine && confirm(detailsLine.id, what)}
      />

      {source ? (
        <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
          <DialogContent className="flex h-[88vh] max-w-[min(64rem,95vw)] flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>Original document</DialogTitle>
              <DialogDescription>
                {lines.find((line) => line.id === activeId) && describeSource(lines.find((line) => line.id === activeId)!.source)
                  ? `Selected line: ${describeSource(lines.find((line) => line.id === activeId)!.source)}`
                  : "Closing this keeps everything you have edited."}
              </DialogDescription>
            </DialogHeader>
            <SourcePanel source={source} line={lines.find((line) => line.id === activeId) ?? null} />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  )
}

// ---- warnings --------------------------------------------------------------------------------------------

function PleaseCheck({ groups, documentNotes, lineCount }: { groups: { required: IssueGroup[]; confirm: IssueGroup[]; info: IssueGroup[] }; documentNotes: string[]; lineCount: number }) {
  const info = [...documentNotes.map((message) => ({ key: `doc:${message}`, message, rows: [] as number[] })), ...groups.info]
  const total = groups.required.length + groups.confirm.length + info.length
  // Short lists start open; a long document starts collapsed so the table is what you see first.
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? (total <= 4 && lineCount <= 12)
  if (total === 0) return null
  const section = (title: string, tone: string, list: IssueGroup[]) =>
    list.length === 0 ? null : (
      <div>
        <p className={cn("font-medium", tone)}>
          {title} ({list.length})
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-6">
          {list.map((group) => (
            <li key={group.key}>
              {group.message}
              {group.rows.length > 0 ? <span className="text-muted-foreground"> ({describeRows(group.rows)})</span> : null}
            </li>
          ))}
        </ul>
      </div>
    )
  return (
    <div className="rounded-md bg-amber-50 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left font-medium" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        Please check
        <span className="font-normal opacity-80">
          {groups.required.length > 0 ? `${groups.required.length} to fix` : ""}
          {groups.required.length > 0 && groups.confirm.length > 0 ? " · " : ""}
          {groups.confirm.length > 0 ? `${groups.confirm.length} to confirm` : ""}
          {(groups.required.length > 0 || groups.confirm.length > 0) && info.length > 0 ? " · " : ""}
          {info.length > 0 ? `${info.length} note${info.length === 1 ? "" : "s"}` : ""}
        </span>
        {expanded ? <ChevronDown className="ml-auto size-4" /> : <ChevronRight className="ml-auto size-4" />}
      </button>
      {expanded ? (
        <div className="space-y-3 px-3 pt-0 pb-3">
          {section("Missing or invalid: fix these", "text-red-800 dark:text-red-300", groups.required)}
          {section("Needs your confirmation", "", groups.confirm)}
          {section("For your information", "opacity-90", info)}
        </div>
      ) : null}
    </div>
  )
}

function Totals({ summary }: { summary: ReturnType<typeof summarize> }) {
  const partial = (count: number, what: string) => (count > 0 ? <span className="text-amber-700 dark:text-amber-400"> (partial: {count} line{count === 1 ? "" : "s"} {what})</span> : null)
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      <span className="font-medium text-foreground">{summary.included}</span> line{summary.included === 1 ? "" : "s"} selected of {summary.detected} ·{" "}
      <span className="font-medium text-foreground">{summary.pieces.toLocaleString("en-US")}</span> piece{summary.pieces === 1 ? "" : "s"}
      {partial(summary.piecesUnknownLines, "without a quantity")} · <span className="font-medium text-foreground">{formatKg(summary.weightKg)}</span>
      {partial(summary.weightUnresolvedLines, "without a settled weight")} · <span className="font-medium text-foreground">{formatM3(summary.volumeM3)}</span>
      {partial(summary.volumeUnresolvedLines, "without a known size")} ·{" "}
      <span className={cn(summary.needReview > 0 && "font-medium text-amber-700 dark:text-amber-400")}>
        {summary.needReview} line{summary.needReview === 1 ? "" : "s"} need{summary.needReview === 1 ? "s" : ""} review
      </span>
    </p>
  )
}

// ---- one row ------------------------------------------------------------------------------------------------

type Tone = "none" | "error" | "warn"

/** The worst problem on the given fields: what colours a cell and what it says when selected. */
function problemOn(evaluation: LineEval, fields: string[]): { tone: Tone; message: string | null } {
  const found = evaluation.issues.filter((issue) => fields.includes(issue.field))
  if (found.length === 0) return { tone: "none", message: null }
  const required = found.find((issue) => issue.kind === "missing" || issue.kind === "invalid")
  const first = required ?? found[0]!
  return { tone: required ? "error" : "warn", message: first.message }
}

const TONE_CLASS: Record<Tone, string> = {
  none: "",
  error: "border-red-500 bg-red-50/70 dark:bg-red-500/10",
  warn: "border-amber-500 bg-amber-50/70 dark:bg-amber-500/10",
}

function Cell({
  value,
  onCommit,
  tone = "none",
  message,
  onActive,
  label,
  align,
  placeholder,
  title,
}: {
  value: string
  onCommit: (text: string) => void
  tone?: Tone
  message?: string | null
  onActive: (message: string | null) => void
  label: string
  align?: "right"
  placeholder?: string
  title?: string
}) {
  // The text being typed is kept here and committed when the cell is left, so typing never fights a reformatted value.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      aria-label={label}
      aria-invalid={tone === "error"}
      title={message ?? title}
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => onActive(message ?? null)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft)
        setDraft(null)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
      className={cn("h-8 min-w-0 px-2", align === "right" && "text-right tabular-nums", TONE_CLASS[tone])}
    />
  )
}

function ReviewRow({
  number,
  line,
  evaluation,
  duplicates,
  unit,
  active,
  hasSource,
  onActive,
  onEdit,
  onDetails,
  onSource,
  onRemove,
}: {
  number: number
  line: ReviewLine
  evaluation: LineEval
  duplicates: string[]
  unit: LengthUnit
  active: boolean
  hasSource: boolean
  onActive: (message: string | null) => void
  onEdit: (patch: Partial<ReviewLine>, touched: (keyof ReviewLine)[]) => void
  onDetails: () => void
  onSource: () => void
  onRemove: () => void
}) {
  const sizeUnknown = evaluation.issues.some((issue) => issue.code === "size-unit")
  const scopeProblem = evaluation.issues.some((issue) => issue.code === "weight-scope")
  const weight = problemOn(evaluation, ["weight", "weightUnit", "weightScope"])
  const settled = evaluation.weightResolved && evaluation.perPieceKg !== null
  const weightText = settled ? trim4(evaluation.perPieceKg!) : line.weight.trim() ? `${line.weight.trim()}${line.weightUnit && !/[A-Za-z]/.test(line.weight) ? ` ${line.weightUnit}` : ""}` : ""
  const status = problemStatusTip(evaluation, duplicates)

  const dimension = (field: "length" | "width" | "height", label: string) => {
    const shown = displayDimension(line, field, unit)
    const own = problemOn(evaluation, [field])
    const problem = own.tone !== "none" ? own : sizeUnknown && !shown.converted ? { tone: "warn" as Tone, message: "The unit is not stated, so the number is shown as read. Choose the unit above or in the details." } : own
    return (
      <td className="w-20 px-1 py-1">
        <Cell
          label={`${label} of line ${number}`}
          value={shown.text}
          align="right"
          tone={problem.tone}
          message={problem.message}
          onActive={onActive}
          onCommit={(text) => {
            // A plain number is in the unit the column shows; anything with a unit of its own is read as written.
            onEdit({ [field]: dimensionText(text, unit) } as Partial<ReviewLine>, [field])
          }}
        />
      </td>
    )
  }

  return (
    <tr className={cn("border-b border-border/70 last:border-b-0", active && "bg-secondary/40", !line.include && "opacity-55")} onClick={() => onActive(null)} aria-label={`Cargo line ${number}`}>
      <td className="px-2 py-1">
        <input type="checkbox" checked={line.include} onChange={(event) => onEdit({ include: event.target.checked }, [])} aria-label={`Add line ${number}`} />
      </td>
      <td className="w-28 px-1 py-1">
        <Cell label={`Mark of line ${number}`} value={line.sku} onActive={onActive} onCommit={(text) => onEdit({ sku: text }, ["sku"])} placeholder="Mark" />
      </td>
      <td className="min-w-48 px-1 py-1">
        <Cell
          label={`Name of line ${number}`}
          value={line.name}
          tone={problemOn(evaluation, ["name"]).tone}
          message={problemOn(evaluation, ["name"]).message}
          title={line.translation ? `English: ${line.translation}` : undefined}
          onActive={onActive}
          onCommit={(text) => onEdit({ name: text }, ["name"])}
          placeholder="Description"
        />
      </td>
      {dimension("length", "Length")}
      {dimension("width", "Width")}
      {dimension("height", "Height")}
      <td className="w-28 px-1 py-1">
        <Cell
          label={`Weight per piece of line ${number}`}
          value={weightText}
          align="right"
          tone={weight.tone}
          message={weight.message}
          title={line.weightEvidence ? `${line.weightEvidence}` : undefined}
          onActive={onActive}
          onCommit={(text) => {
            // A weight typed here is the planning weight for one piece, in kilograms unless a unit is written.
            const change = weightPatch(text, line)
            onEdit(change.patch, change.touched)
          }}
        />
        {scopeProblem ? (
          <div className="mt-1 flex items-center gap-1 text-xs" role="group" aria-label={`What the weight of line ${number} is for`}>
            <button type="button" className="rounded border px-1.5 py-0.5 hover:bg-muted" onClick={() => onEdit({ weightScope: "piece" }, ["weightScope"])}>
              each
            </button>
            <button type="button" className="rounded border px-1.5 py-0.5 hover:bg-muted" onClick={() => onEdit({ weightScope: "line" }, ["weightScope"])}>
              total
            </button>
          </div>
        ) : null}
      </td>
      <td className="w-16 px-1 py-1">
        <Cell
          label={`Quantity of line ${number}`}
          value={line.quantity}
          align="right"
          tone={problemOn(evaluation, ["quantity"]).tone}
          message={problemOn(evaluation, ["quantity"]).message}
          onActive={onActive}
          onCommit={(text) => onEdit({ quantity: text.trim() }, ["quantity"])}
        />
      </td>
      <td className="w-24 px-1 py-1">
        <select
          className={cn(select, "w-full")}
          aria-label={`Stackable, line ${number}`}
          value={line.stackable === null ? "" : line.stackable ? "yes" : "no"}
          onChange={(event) => onEdit({ stackable: event.target.value === "" ? null : event.target.value === "yes" }, ["stackable"])}
          title="Not stated means the planner's normal default (stackable)."
        >
          <option value="">Not stated</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </td>
      <td className="px-1 py-1">
        <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[evaluation.status])} title={status}>
          {STATUS_SHORT[evaluation.status]}
        </span>
      </td>
      <td className="px-1 py-1">
        <div className="flex justify-end gap-0.5">
          <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onDetails} aria-label={`Details of line ${number}`} title="Details: original values, units, weight meaning, restrictions">
            <SlidersHorizontal className="size-4" />
          </Button>
          {hasSource ? (
            <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onSource} aria-label={`Show line ${number} in the original`} title={describeSource(line.source) ? `View original: ${describeSource(line.source)}` : "View original"}>
              <FileSearch className="size-4" />
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onRemove} aria-label={`Remove line ${number}`} title="Remove this line">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function problemStatusTip(evaluation: LineEval, duplicates: string[]): string {
  const parts = [STATUS_LABEL[evaluation.status], ...evaluation.issues.slice(0, 3).map((issue) => issue.message), ...duplicates.slice(0, 1)]
  return parts.join(" · ")
}

// ---- the details of one line ------------------------------------------------------------------------------------

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={cn("space-y-1 text-xs", wide ? "sm:col-span-2" : "")}>
      <span className="block text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function LineDetails({
  line,
  evaluation,
  duplicates,
  onClose,
  onEdit,
  onConfirm,
}: {
  line: ReviewLine | null
  evaluation: LineEval | null
  duplicates: string[]
  onClose: () => void
  onEdit: (patch: Partial<ReviewLine>, touched: (keyof ReviewLine)[]) => void
  onConfirm: (what: Confirmation) => void
}) {
  if (!line || !evaluation) return null
  const text = (field: keyof ReviewLine, label: string, wide?: boolean) => (
    <Field label={label} wide={wide}>
      <Input value={String(line[field] ?? "")} className="h-8" onChange={(event) => onEdit({ [field]: event.target.value } as Partial<ReviewLine>, [field])} />
    </Field>
  )
  const triState = (field: "stackable" | "floorOnly", label: string, unset: string) => (
    <Field label={label}>
      <select className={cn(select, "w-full")} value={line[field] === null ? "" : line[field] ? "yes" : "no"} onChange={(event) => onEdit({ [field]: event.target.value === "" ? null : event.target.value === "yes" } as Partial<ReviewLine>, [field])}>
        <option value="">{unset}</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </Field>
  )
  const original = line.original
  const originals = [
    ["Mark", original.sku],
    ["Name", original.name],
    ["Size as read", [original.length, original.width, original.height].filter((part) => part !== undefined && part !== "").join(" × ") + (original.sizeUnit ? ` ${original.sizeUnit}` : original.length ? " (unit not stated)" : "")],
    ["Quantity", original.quantity],
    ["Weight as read", `${original.weight ?? ""}${original.weightUnit ? ` ${original.weightUnit}` : ""}`.trim()],
    ["Net weight as read", original.netWeight],
  ].filter(([, value]) => value && String(value).trim() !== "")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-[min(48rem,95vw)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{line.name || line.sku || "Cargo line"}</DialogTitle>
          <DialogDescription>
            {STATUS_LABEL[evaluation.status]}
            {describeSource(line.source) ? ` · From ${describeSource(line.source)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {evaluation.issues.length > 0 ? (
          <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {evaluation.issues.map((issue) => (
              <li key={`${issue.field}-${issue.code}`}>{issue.message}</li>
            ))}
          </ul>
        ) : null}

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Sizes and units</h3>
          <div className="grid gap-2 sm:grid-cols-4">
            {text("length", "Length")}
            {text("width", "Width")}
            {text("height", "Height")}
            <Field label="Unit of the sizes">
              <select className={cn(select, "w-full")} value={line.sizeUnit ?? ""} onChange={(event) => onEdit({ sizeUnit: (event.target.value || null) as LengthUnit | null }, ["sizeUnit"])}>
                <option value="">Not stated</option>
                {LENGTH_UNITS.map((entry) => (
                  <option key={entry} value={entry}>
                    {LENGTH_UNIT_LABEL[entry]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Weight</h3>
          <div className="grid gap-2 sm:grid-cols-4">
            {text("weight", "Weight used for planning")}
            <Field label="Unit">
              <select className={cn(select, "w-full")} value={line.weightUnit ?? ""} onChange={(event) => onEdit({ weightUnit: (event.target.value || null) as ImportWeightUnit | null }, ["weightUnit"])}>
                <option value="">Not stated</option>
                {IMPORT_WEIGHT_UNITS.map((entry) => (
                  <option key={entry} value={entry}>
                    {IMPORT_WEIGHT_UNIT_LABEL[entry]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Is it gross or net?">
              <select className={cn(select, "w-full")} value={line.weightKind} onChange={(event) => onEdit({ weightKind: event.target.value as WeightKind }, ["weightKind"])}>
                {(Object.keys(KIND_LABEL) as WeightKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="What the weight is for">
              <select className={cn(select, "w-full")} value={line.weightScope} onChange={(event) => onEdit({ weightScope: event.target.value as WeightScope }, ["weightScope"])}>
                {(Object.keys(SCOPE_LABEL) as WeightScope[]).map((scope) => (
                  <option key={scope} value={scope}>
                    {SCOPE_LABEL[scope]}
                  </option>
                ))}
              </select>
            </Field>
            {text("netWeight", "Net weight (reference only)", true)}
          </div>
          <p className="text-xs text-muted-foreground">
            {evaluation.perPieceKg !== null ? `Used for planning: ${formatKg(evaluation.perPieceKg)} per piece. ` : "No weight per piece is settled yet. "}
            {evaluation.interpretation ? `${evaluation.interpretation}. ` : ""}
            {line.weightEvidence ? `The document says: ${line.weightEvidence}. ` : ""}
            With a quantity of 1 it makes no difference whether the weight is per piece or for the line.
          </p>
          <div className="flex flex-wrap gap-2">
            {line.weightKind === "net" && !line.confirmed.includes("net") ? (
              <Button type="button" size="sm" variant="outline" onClick={() => onConfirm("net")}>
                Use the net weight anyway
              </Button>
            ) : null}
            {evaluation.issues.some((issue) => issue.code === "number-format") ? (
              <Button type="button" size="sm" variant="outline" onClick={() => onConfirm("numbers")}>
                The numbers are right as written
              </Button>
            ) : null}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Cargo</h3>
          <div className="grid gap-2 sm:grid-cols-4">
            {text("sku", "Mark / SKU")}
            {text("name", "Description", true)}
            {text("quantity", "Quantity")}
            <Field label="Shape">
              <select className={cn(select, "w-full")} value={line.shape} onChange={(event) => onEdit({ shape: event.target.value as ReviewLine["shape"] }, ["shape"])}>
                <option value="BOX">Box or crate</option>
                <option value="CYLINDER_DRUM">Drum</option>
                <option value="PIPE">Pipe or roll</option>
              </select>
            </Field>
            {triState("stackable", "Stackable", "Not stated (default)")}
            {triState("floorOnly", "Floor only", "Not stated")}
            <Field label="Turning">
              <select className={cn(select, "w-full")} value={line.orientation ?? ""} onChange={(event) => onEdit({ orientation: (event.target.value || null) as ReviewLine["orientation"] }, ["orientation"])}>
                <option value="">Not stated (default)</option>
                <option value="ROTATE_90">This side up (may turn on the floor)</option>
                <option value="FIXED">Do not rotate</option>
              </select>
            </Field>
            {text("consignment", "Consignment")}
            {text("destination", "Unloading stop (number)")}
            {text("hazard", "Hazard class (only if stated)")}
            {text("handling", "Handling notes (not saved to the cargo line)", true)}
          </div>
        </section>

        {originals.length > 0 ? (
          <section className="space-y-1">
            <h3 className="text-sm font-medium">Original extracted values</h3>
            <dl className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
              {originals.map(([label, value]) => (
                <div key={String(label)} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {line.translation || line.modelNotes.length > 0 || line.checks.length > 0 || duplicates.length > 0 || line.source.quote ? (
          <section className="space-y-1 text-xs text-muted-foreground">
            {line.translation ? <p>English: {line.translation}</p> : null}
            {line.source.quote ? <p>Source text: “{line.source.quote}”</p> : null}
            {line.modelNotes.map((entry) => (
              <p key={entry}>The reader was unsure: {entry}</p>
            ))}
            {line.checks.map((entry) => (
              <p key={entry}>Check: {entry}</p>
            ))}
            {duplicates.map((entry) => (
              <p key={entry}>{entry}</p>
            ))}
          </section>
        ) : null}

        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---- the original ------------------------------------------------------------------------------------------------------

function SourcePanel({ source, line }: { source: SourceView; line: ReviewLine | null }) {
  const target = line ? sourceTarget(line.source) : { kind: "none" as const }
  const quote = target.kind === "quote" || line?.source.quote ? line?.source.quote : undefined
  const page = target.kind === "page" ? target.page : 1
  const row = target.kind === "row" ? target.row : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card">
      <div className="min-h-0 flex-1 overflow-auto">
        {source.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview of the planner's own file
          <img src={source.url} alt={`Preview of ${source.name}`} className="mx-auto max-w-full" />
        ) : source.kind === "pdf" ? (
          // The browser's own PDF viewer: zoom, page navigation and search work as they do everywhere.
          <iframe key={page} title={`Preview of ${source.name}`} src={`${source.url}#page=${page}`} className="h-full min-h-96 w-full" />
        ) : source.kind === "text" ? (
          <HighlightedText text={source.text} quote={quote} />
        ) : (
          <SheetPreview source={source} row={row} />
        )}
      </div>
      {quote && source.kind !== "text" ? (
        <p className="border-t px-3 py-2 text-xs">
          Text the reader used: <span className="italic">{quote}</span>
        </p>
      ) : null}
    </div>
  )
}

function HighlightedText({ text, quote }: { text: string; quote: string | undefined }) {
  const at = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1
  return (
    <pre className="p-3 text-xs break-words whitespace-pre-wrap">
      {at >= 0 && quote ? (
        <>
          {text.slice(0, at)}
          <mark className="rounded bg-amber-200 px-0.5 text-foreground dark:bg-amber-500/40">{text.slice(at, at + quote.length)}</mark>
          {text.slice(at + quote.length)}
        </>
      ) : (
        text
      )}
    </pre>
  )
}

function SheetPreview({ source, row }: { source: Extract<SourceView, { kind: "sheet" }>; row: number | undefined }) {
  return (
    <div className="text-xs">
      <table className="w-full border-collapse">
        {source.headers ? (
          <thead>
            <tr className="bg-muted/60">
              <th className="sticky top-0 border-b px-2 py-1 text-left font-medium text-muted-foreground">Row</th>
              {source.headers.map((header, index) => (
                <th key={`${header}-${index}`} className="sticky top-0 border-b bg-muted/60 px-2 py-1 text-left font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {source.rows.map((entry) => (
            <tr key={entry.rowNumber} className={cn("border-b border-border/60", entry.rowNumber === row && "bg-amber-100 dark:bg-amber-500/20")} aria-current={entry.rowNumber === row ? "true" : undefined}>
              <td className="px-2 py-1 text-muted-foreground tabular-nums">{entry.rowNumber}</td>
              {entry.cells.map((cell, index) => (
                <td key={index} className="max-w-48 truncate px-2 py-1" title={cell}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {source.truncated ? <p className="px-3 py-2 text-muted-foreground">Only the top of the sheet is shown here. All rows are read.</p> : null}
      {row !== undefined && !source.rows.some((entry) => entry.rowNumber === row) ? <p className="px-3 py-2 text-muted-foreground">Row {row} is below the part of the sheet shown here.</p> : null}
    </div>
  )
}
