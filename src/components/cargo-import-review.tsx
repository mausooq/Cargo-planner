"use client"

import { AlertTriangle, ArrowLeft, Boxes, ChevronDown, ChevronRight, FileSearch, ListChecks, Loader2, Package, Plus, Scale, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { IconTile, SectionCard, StatusPill, SummaryCard } from "@/components/design-system"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DocumentPreview, sourceName, type SourceView } from "@/components/document-preview"
import { SelectMenu } from "@/components/ui/select-menu"
import { Input } from "@/components/ui/input"
import { LENGTH_UNIT_LABEL, LENGTH_UNITS, LENGTH_UNIT_SYMBOL, type LengthUnit } from "@/lib/cargo-units"
import type { ReviewDocument } from "@/lib/cargo-extract"
import { formatKg, formatM3 } from "@/lib/format"
import {
  acceptWeightEstimates,
  applyWeightEstimates,
  blankLine,
  clearWeightEstimates,
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
  suggestWeightDistribution,
  summarize,
  toDraft,
  withSuggestedEstimates,
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
import { applyEdit, applySizeUnit, applyWeightUnit, dimensionText, weightPatch } from "@/lib/import-edit"
import { IMPORT_WEIGHT_UNIT_LABEL, IMPORT_WEIGHT_UNITS, type ImportWeightUnit } from "@/lib/import-units"
import { useLengthUnit } from "@/lib/length-unit-pref"
import { cn } from "@/lib/utils"

/**
 * The review step of every import, in the same compact shape as the Cargo grid: one row per cargo
 * line, edited in place. Whatever the cargo was read from, the planner fixes what is flagged, sees one
 * consolidated "Please check" box instead of a warning on every row, and chooses what to add. Nothing
 * is saved from here; the parent receives the lines when the planner confirms.
 */

export type { SourceView } from "@/components/document-preview"

export type ImportChoice = { mode: "append" | "replace"; confirmReplace: boolean; suggest: boolean }

const STATUS_STYLE: Record<LineStatus, string> = {
  ready: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  corrected: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  estimated: "border border-dashed border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-300",
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
  const preferred = useLengthUnit()
  // The document's own size unit, when every line that states one agrees: the table starts in it, so the numbers look like
  // the paper. The planner can switch; that changes only how sizes are shown here, never what is stored.
  const documentUnit = useMemo(() => {
    const units = new Set(document.lines.map((line) => line.sizeUnit).filter((entry): entry is LengthUnit => entry !== null))
    return units.size === 1 ? [...units][0]! : null
  }, [document.lines])
  const [unit, setUnit] = useState<LengthUnit>(documentUnit ?? preferred)
  const [lines, setLines] = useState<ReviewLine[]>(() => withSuggestedEstimates(document.lines, document.documentTotals))
  const [activeId, setActiveId] = useState<string | null>(document.lines[0]?.id ?? null)
  const [note, setNote] = useState<string | null>(null)
  const [mode, setMode] = useState<"append" | "replace">("append")
  const [confirmReplace, setConfirmReplace] = useState(false)
  // The original document is docked beside the table while the import is open; the planner can hide it.
  const [previewOpen, setPreviewOpen] = useState(true)
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
  const totalGross = document.documentTotals?.weightKg ?? null
  const estimatedNow = lines.filter((line) => line.include && line.weight.trim() === "" && line.estimatedWeight && !line.confirmed.includes("estimate"))
  const suggestion = useMemo(() => suggestWeightDistribution(lines, evaluations, totalGross), [lines, evaluations, totalGross])

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

  const activeLine = lines.find((line) => line.id === activeId) ?? null
  const fromAi = document.reader.provider !== ""
  const status = document.partial
    ? { tone: "warning" as const, label: "Partly read" }
    : summary.needReview > 0
      ? { tone: "warning" as const, label: `${summary.needReview} to review` }
      : { tone: "success" as const, label: "Ready to add" }

  return (
    <section className="space-y-5" aria-label="Review imported cargo">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <IconTile icon={Package} tint="mint" size="lg" />
          <div className="min-w-0">
            <h2 className="text-[26px] leading-8 font-extrabold tracking-tight">Cargo Review</h2>
            <p className="mt-1 text-page-desc text-muted-foreground">
              {fromAi ? "Review the cargo read from your packing list and confirm it before it is added." : "Review the cargo read from your spreadsheet and confirm it before it is added."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {source && !previewOpen ? (
            <Button type="button" variant="outline" className="press h-10 rounded-xl" onClick={() => setPreviewOpen(true)}>
              <FileSearch className="size-4" />
              Show document
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="press h-10 rounded-xl" onClick={onBack} disabled={importing}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <Button type="button" variant="ghost" className="press h-10 rounded-xl" onClick={onCancel} disabled={importing}>
            Cancel
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {source && previewOpen ? <DocumentPreview source={source} line={activeLine} onClose={() => setPreviewOpen(false)} /> : null}

        <div className="min-w-0 flex-1 space-y-5">
          <ReviewFigures summary={summary} />

          <SectionCard
            banded
            icon={Sparkles}
            title={fromAi ? "AI extraction" : "Read from your spreadsheet"}
            description={
              <>
                {source ? sourceName(source) : "Your document"} · {summary.detected} line{summary.detected === 1 ? "" : "s"} found
                {document.language ? ` · ${document.language}` : ""}
                {fromAi ? ` · read by ${document.reader.provider}${document.reader.model ? ` (${document.reader.model})` : ""}` : " · no AI used"}
              </>
            }
            actions={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
          >
            <div className="space-y-3 px-5 pb-5">
              {document.summary ? <p className="text-detail">{document.summary}</p> : null}
              {fromAi ? <p className="text-meta text-muted-foreground">The reader can misread a number, so compare the lines with your document.</p> : null}
              {document.partial ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200" role="alert">
                  Only part of the document may have been read. Check that no lines are missing before adding.
                </p>
              ) : null}
              <DocumentFacts document={document} />
              <PleaseCheck groups={groups} documentNotes={[...document.notes, ...totalNotes]} lineCount={lines.length} />
              {suggestion && estimatedNow.length === 0 && suggestion.estimates.size > 0 ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed border-amber-500 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-500/10">
                  <span>
                    {suggestion.estimates.size === 1 ? "One line has" : `${suggestion.estimates.size} lines have`} no weight, but the document gives a total gross weight.
                    An {suggestion.basis} would be {[...suggestion.estimates.values()][0]} kg each.
                    {suggestion.sameSize ? "" : " The packages differ in size, so their real weights may differ a lot."}
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => setLines((current) => applyWeightEstimates(current, suggestion))}>
                    Use as estimates
                  </Button>
                </div>
              ) : null}
              {estimatedNow.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-dashed border-amber-500 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-500/10">
                  <span>
                    {estimatedNow.length} weight{estimatedNow.length === 1 ? " is an estimate" : "s are estimates"} (marked est.). They can be used for a provisional equipment
                    suggestion; confirm them before a load plan is calculated.
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => setLines((current) => acceptWeightEstimates(current))}>
                    Confirm the estimates
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLines((current) => clearWeightEstimates(current))}>
                    Remove estimates
                  </Button>
                </div>
              ) : null}
              {needSizeUnit.length > 0 || needWeightUnit.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-amber-500/50 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-500/10">
                  {needSizeUnit.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        {needSizeUnit.length} row{needSizeUnit.length === 1 ? " has" : "s have"} sizes with no unit stated. The numbers are kept as read.
                      </span>
                      <SelectMenu label="Unit of the sizes" value={pickedSizeUnit} onChange={setPickedSizeUnit} className="w-44" options={LENGTH_UNITS.map((entry) => ({ value: entry, label: LENGTH_UNIT_LABEL[entry] }))} />
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
                      <SelectMenu label="Unit of the weights" value={pickedWeightUnit} onChange={setPickedWeightUnit} className="w-44" options={IMPORT_WEIGHT_UNITS.map((entry) => ({ value: entry, label: IMPORT_WEIGHT_UNIT_LABEL[entry] }))} />
                      <Button type="button" size="sm" variant="outline" onClick={useWeightUnit}>
                        Use for {needWeightUnit.length === 1 ? "this row" : `these ${needWeightUnit.length} rows`}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <ValueLegend />
            </div>
          </SectionCard>

          <SectionCard
            banded
            icon={Boxes}
            title={`Extracted cargo lines (${lines.length})`}
            description={
              <span role="status" aria-live="polite">
                {note ?? "Click any cell to edit it. A highlighted cell says what needs attention when you select it."}
              </span>
            }
            actions={
              <div className="flex items-center gap-2">
                <span className="text-meta text-muted-foreground">Sizes in</span>
                <SelectMenu
                  label="Unit the sizes are shown in"
                  value={unit}
                  onChange={setUnit}
                  className="w-48"
                  options={LENGTH_UNITS.map((entry) => ({ value: entry, label: `${LENGTH_UNIT_LABEL[entry]}${entry === documentUnit ? " (document)" : ""}` }))}
                />
              </div>
            }
          >
            <div className="cargo-sheet max-h-[68vh] overflow-auto">
              <table className="data-table w-full min-w-[60rem] text-left text-sm">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="w-8 px-2 py-2.5">
                      <span className="sr-only">Add</span>
                    </th>
                    <th className="px-2 py-2.5 font-semibold">Mark</th>
                    <th className="px-2 py-2.5 font-semibold">Name</th>
                    <th className="px-2 py-2.5 text-right font-semibold" title={`Length in ${LENGTH_UNIT_LABEL[unit]}`}>
                      L ({LENGTH_UNIT_SYMBOL[unit]})
                    </th>
                    <th className="px-2 py-2.5 text-right font-semibold" title={`Width in ${LENGTH_UNIT_LABEL[unit]}`}>
                      W ({LENGTH_UNIT_SYMBOL[unit]})
                    </th>
                    <th className="px-2 py-2.5 text-right font-semibold" title={`Height in ${LENGTH_UNIT_LABEL[unit]}`}>
                      H ({LENGTH_UNIT_SYMBOL[unit]})
                    </th>
                    <th className="px-2 py-2.5 text-right font-semibold" title="Weight of one piece, in kilograms. The gross weight (with packaging) when the document gives one.">
                      kg / piece
                    </th>
                    <th className="px-2 py-2.5 text-right font-semibold">Qty</th>
                    <th className="px-2 py-2.5 font-semibold" title="Whether other cargo may be placed on top">
                      Stackable
                    </th>
                    <th className="px-2 py-2.5 font-semibold">Status</th>
                    <th className="w-24 px-2 py-2.5">
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
                            setPreviewOpen(true)
                          }}
                          onRemove={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}
                        />
                      ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--table-border)] bg-[var(--table-total-bg)] px-5 py-3">
              <Button type="button" variant="outline" size="sm" className="press rounded-lg" onClick={addLine}>
                <Plus className="size-4" />
                Add a cargo line
              </Button>
              <Totals summary={summary} />
            </div>
          </SectionCard>

          <div className="surface-card space-y-4 p-5">
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
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" className="press h-11 rounded-xl px-5 text-button shadow-soft" onClick={() => submit(true)} disabled={!canSuggest}>
                  {importing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Add {included.length} line{included.length === 1 ? "" : "s"} and suggest equipment
                </Button>
                <Button type="button" variant="outline" className="press h-11 rounded-xl px-5 text-button" onClick={() => submit(false)} disabled={!canAddOnly}>
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
          </div>
        </div>
      </div>

      <LineDetails
        line={detailsLine}
        evaluation={detailsLine ? evaluations[lines.indexOf(detailsLine)]! : null}
        duplicates={detailsLine ? (duplicates.get(detailsLine.id) ?? []) : []}
        onClose={() => setDetailsId(null)}
        onEdit={(patch, touched) => detailsLine && edit(detailsLine.id, patch, touched)}
        onConfirm={(what) => detailsLine && confirm(detailsLine.id, what)}
      />
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

/** The four review figures: packages, gross weight, volume and lines to review, from the lines as they stand. */
function ReviewFigures({ summary }: { summary: ReturnType<typeof summarize> }) {
  const lines = (count: number, what: string) => `${count} line${count === 1 ? "" : "s"} ${what}`
  return (
    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
      <SummaryCard
        icon={Package}
        tint="mint"
        label="Total packages"
        value={summary.pieces.toLocaleString("en-US")}
        hint={summary.piecesUnknownLines > 0 ? lines(summary.piecesUnknownLines, "without a quantity") : `${summary.included} of ${summary.detected} lines selected`}
        tone={summary.piecesUnknownLines > 0 ? "warning" : "neutral"}
      />
      <SummaryCard
        icon={Scale}
        tint="lavender"
        label="Gross weight"
        value={formatKg(summary.weightKg)}
        hint={
          summary.weightUnresolvedLines > 0
            ? lines(summary.weightUnresolvedLines, "without a settled weight")
            : summary.estimatedWeightLines > 0
              ? `Includes ${lines(summary.estimatedWeightLines, "estimated")}`
              : "From the lines' weights"
        }
        tone={summary.weightUnresolvedLines > 0 ? "danger" : summary.estimatedWeightLines > 0 ? "warning" : "neutral"}
      />
      <SummaryCard
        icon={Boxes}
        tint="blue"
        label="Cargo volume"
        value={formatM3(summary.volumeM3)}
        hint={summary.volumeUnresolvedLines > 0 ? lines(summary.volumeUnresolvedLines, "without a known size") : "From the lines' sizes"}
        tone={summary.volumeUnresolvedLines > 0 ? "warning" : "neutral"}
      />
      <SummaryCard
        icon={ListChecks}
        tint="amber"
        label="Lines to review"
        value={summary.needReview}
        hint={summary.needReview > 0 ? "Something to fix or confirm" : "Every selected line is clear"}
        tone={summary.needReview > 0 ? "warning" : "neutral"}
      />
    </div>
  )
}

/** How a value got into the table, so extracted, worked-out, estimated, missing and confirmed values are told apart. */
function ValueLegend() {
  const chip = "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium"
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className={cn(chip, "border-border bg-card text-foreground")}>123</span> as in the document
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn(chip, "border-sky-500 text-sky-700 dark:text-sky-300")}>calc</span> worked out
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn(chip, "border-dashed border-amber-500 bg-tint-amber text-tint-amber-foreground")}>est.</span> estimate to confirm
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn(chip, "border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300")}>missing</span> missing or invalid
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn(chip, "border-transparent", STATUS_STYLE.corrected)}>Edited</span> confirmed by you
      </span>
      <span>Stackable “Not stated” is planned as not stackable.</span>
    </p>
  )
}

function Totals({ summary }: { summary: ReturnType<typeof summarize> }) {
  const estimated = summary.estimatedWeightLines > 0 ? <span className="text-amber-700 dark:text-amber-400"> (incl. {summary.estimatedWeightLines} estimated)</span> : null
  const partial = (count: number, what: string) => (count > 0 ? <span className="text-amber-700 dark:text-amber-400"> (partial: {count} line{count === 1 ? "" : "s"} {what})</span> : null)
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      <span className="font-medium text-foreground">{summary.included}</span> line{summary.included === 1 ? "" : "s"} selected of {summary.detected} ·{" "}
      <span className="font-medium text-foreground">{summary.pieces.toLocaleString("en-US")}</span> piece{summary.pieces === 1 ? "" : "s"}
      {partial(summary.piecesUnknownLines, "without a quantity")} · <span className="font-medium text-foreground">{formatKg(summary.weightKg)}</span>
      {estimated}
      {partial(summary.weightUnresolvedLines, "without a settled weight")} · <span className="font-medium text-foreground">{formatM3(summary.volumeM3)}</span>
      {partial(summary.volumeUnresolvedLines, "without a known size")} ·{" "}
      <span className={cn(summary.needReview > 0 && "font-medium text-amber-700 dark:text-amber-400")}>
        {summary.needReview} line{summary.needReview === 1 ? "" : "s"} need{summary.needReview === 1 ? "s" : ""} review
      </span>
    </p>
  )
}

// ---- one row ------------------------------------------------------------------------------------------------

type Tone = "none" | "error" | "warn" | "estimate" | "calculated"

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
  estimate: "border-dashed border-amber-500 italic",
  calculated: "border-sky-500/70",
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
  const estimated = evaluation.weightEstimated
  const calculated = evaluation.origins.weight === "calculated"
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
          tone={weight.tone !== "none" ? weight.tone : estimated ? "estimate" : calculated ? "calculated" : "none"}
          message={weight.message ?? (estimated ? `Estimate: ${line.estimateBasis}. Confirm it before a load plan.` : null)}
          title={line.weightEvidence ? `${line.weightEvidence}` : evaluation.interpretation ?? undefined}
          onActive={onActive}
          onCommit={(text) => {
            // A weight typed here is the planning weight for one piece, in kilograms unless a unit is written.
            const change = weightPatch(text, line)
            onEdit(change.patch, change.touched)
          }}
        />
        {estimated ? <span className="mt-0.5 block text-right text-[11px] font-medium text-amber-700 dark:text-amber-400">est.</span> : calculated ? <span className="mt-0.5 block text-right text-[11px] text-sky-700 dark:text-sky-400">calc</span> : null}
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
      <td className="w-32 min-w-32 px-1 py-1">
        <select
          className={cn(select, "w-full")}
          aria-label={`Stackable, line ${number}`}
          value={line.stackable === null ? "" : line.stackable ? "yes" : "no"}
          onChange={(event) => onEdit({ stackable: event.target.value === "" ? null : event.target.value === "yes" }, ["stackable"])}
          title="Not stated in the document. It is never assumed: the line is planned as not stackable until you choose."
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
            {line.estimatedWeight && line.weight.trim() === "" ? ` Estimate: ${line.estimatedWeight} kg per piece, ${line.estimateBasis}.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {line.weightKind === "net" && !line.confirmed.includes("net") ? (
              <Button type="button" size="sm" variant="outline" onClick={() => onConfirm("net")}>
                Use the net weight anyway
              </Button>
            ) : null}
            {line.estimatedWeight && line.weight.trim() === "" && !line.confirmed.includes("estimate") ? (
              <Button type="button" size="sm" variant="outline" onClick={() => onConfirm("estimate")}>
                Confirm the estimate ({line.estimatedWeight} kg)
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
            {text("quantity", "Packages (quantity)")}
            {text("packageType", "Package type")}
            {text("contentsQuantity", "Products inside (not packages)")}
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

/** What the document itself states for the whole shipment, next to what the lines add up to. Shown only when it states something. */
function DocumentFacts({ document }: { document: ReviewDocument }) {
  const totals = document.documentTotals
  if (!totals) return null
  const facts = [
    totals.pieces !== null ? `${totals.pieces.toLocaleString("en-US")} package${totals.pieces === 1 ? "" : "s"}` : null,
    totals.productQuantity ? `${totals.productQuantity} (products)` : null,
    totals.netKg != null ? `net ${formatKg(totals.netKg)}` : null,
    totals.weightKg !== null ? `gross ${formatKg(totals.weightKg)}` : null,
    totals.volumeM3 != null ? formatM3(totals.volumeM3) : null,
  ].filter((entry): entry is string => entry !== null)
  if (facts.length === 0) return null
  return (
    <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <span className="font-medium">The document states:</span> {facts.join(" · ")}
    </p>
  )
}
