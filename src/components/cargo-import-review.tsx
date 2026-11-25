"use client"

import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Plus, Sparkles, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LENGTH_UNIT_LABEL, LENGTH_UNITS, type LengthUnit } from "@/lib/cargo-units"
import type { ReviewDocument } from "@/lib/cargo-extract"
import { formatKg, formatM3 } from "@/lib/format"
import {
  blankLine,
  compareTotals,
  describeSource,
  evaluateLine,
  findDuplicates,
  isImportable,
  STATUS_LABEL,
  summarize,
  type Confirmation,
  type ExistingCargoSummary,
  type LineEval,
  type LineStatus,
  type ReviewLine,
  type WeightKind,
  type WeightScope,
} from "@/lib/import-review"
import { IMPORT_WEIGHT_UNIT_LABEL, IMPORT_WEIGHT_UNITS, type ImportWeightUnit } from "@/lib/import-units"
import { cn } from "@/lib/utils"

/**
 * The review step of every import: whatever the cargo was read from, the planner sees the original
 * on the left and the cargo lines on the right, fixes what is flagged, and chooses what to save.
 * Nothing is saved from here; the parent receives the validated lines when the planner confirms.
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
  missing: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  ambiguous: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  invalid: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300",
  excluded: "bg-muted text-muted-foreground",
}

const FIELD_ORIGIN_TEXT = { source: "from the document", calculated: "calculated by Compass", user: "typed by you" } as const

const select = "h-9 rounded-md border bg-background px-2 text-sm"

const SCOPE_LABEL: Record<WeightScope, string> = { piece: "Per piece", line: "Line total", unclear: "Not clear" }
const KIND_LABEL: Record<WeightKind, string> = { unspecified: "Gross or net not stated", gross: "Gross", net: "Net" }

/** Which fields a change counts as editing, so the line can say "User corrected" and drop confirmations that no longer apply. */
const WEIGHT_FIELDS = ["weight", "weightScope", "weightUnit", "weightKind", "quantity"]
const NUMBER_FIELDS = ["length", "width", "height", "quantity", "weight"]

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
  source: SourceView
  existing: ExistingCargoSummary[]
  importing: boolean
  onBack: () => void
  onCancel: () => void
  onImport: (lines: ReviewLine[], choice: ImportChoice) => void
}) {
  const [lines, setLines] = useState<ReviewLine[]>(document.lines)
  const [activeId, setActiveId] = useState<string | null>(document.lines[0]?.id ?? null)
  const [mode, setMode] = useState<"append" | "replace">("append")
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [nextId, setNextId] = useState(1)

  const evaluations = useMemo(() => lines.map(evaluateLine), [lines])
  const summary = useMemo(() => summarize(lines, evaluations), [lines, evaluations])
  const duplicates = useMemo(() => findDuplicates(lines, evaluations, existing), [lines, evaluations, existing])
  const totalNotes = useMemo(() => compareTotals(summary, document.documentTotals), [summary, document.documentTotals])
  const active = lines.find((line) => line.id === activeId) ?? null

  function edit(id: string, patch: Partial<ReviewLine>, touched: (keyof ReviewLine)[]) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== id) return line
        const edited = [...new Set([...line.edited, ...touched.map(String)])]
        let confirmed: Confirmation[] = line.confirmed
        if (touched.some((field) => WEIGHT_FIELDS.includes(field))) confirmed = confirmed.filter((entry) => entry !== "weight" && entry !== "net")
        if (touched.some((field) => NUMBER_FIELDS.includes(field))) confirmed = confirmed.filter((entry) => entry !== "numbers")
        return { ...line, ...patch, edited, confirmed }
      }),
    )
  }

  function confirm(id: string, what: Confirmation) {
    setLines((current) => current.map((line) => (line.id === id && !line.confirmed.includes(what) ? { ...line, confirmed: [...line.confirmed, what] } : line)))
  }

  function addLine() {
    const id = `manual-${nextId}`
    setNextId((value) => value + 1)
    setLines((current) => [...current, { ...blankLine(id), edited: ["added"], sizeUnit: null }])
    setActiveId(id)
  }

  const blocked = summary.needReview
  const canImport = summary.importable > 0 && blocked === 0 && !importing && (mode === "append" || confirmReplace)

  function submit(suggest: boolean) {
    const ready = lines.filter((line, index) => line.include && isImportable(evaluations[index]!))
    onImport(ready, { mode, confirmReplace: mode === "replace" && confirmReplace, suggest })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Import summary">
        <Stat label="Cargo lines detected" value={String(summary.detected)} />
        <Stat label="Selected for import" value={String(summary.included)} />
        <Stat label="Need review" value={String(summary.needReview)} tone={summary.needReview > 0 ? "warn" : "ok"} />
        <Stat label="Total pieces" value={summary.pieces.toLocaleString("en-US")} partial={summary.incomplete} />
        <Stat label="Total weight" value={formatKg(summary.weightKg)} partial={summary.incomplete} />
        <Stat label="Total volume" value={formatM3(summary.volumeM3)} partial={summary.incomplete} />
      </div>

      {summary.incomplete ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="status">
          Totals are incomplete: lines with a missing quantity, size or weight are left out of the pieces, weight and volume above.
        </p>
      ) : null}

      <DocumentNotes document={document} totalNotes={totalNotes} />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <SourcePanel source={source} line={active} />

        <div className="flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-label="Cargo lines to review">
            {lines.length === 0 ? <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No cargo lines were found. Add one by hand, or go back and try another file.</p> : null}
            {lines.map((line, index) => (
              <LineCard
                key={line.id}
                index={index}
                line={line}
                evaluation={evaluations[index]!}
                notes={duplicates.get(line.id) ?? []}
                active={line.id === activeId}
                onActivate={() => setActiveId(line.id)}
                onEdit={(patch, touched) => edit(line.id, patch, touched)}
                onConfirm={(what) => confirm(line.id, what)}
                onRemove={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}
              />
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={addLine}>
            <Plus className="size-4" />
            Add a cargo line
          </Button>
        </div>
      </div>

      <div className="space-y-3 border-t pt-3">
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

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => submit(true)} disabled={!canImport}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Import {summary.importable} line{summary.importable === 1 ? "" : "s"} and suggest equipment
          </Button>
          <Button type="button" variant="outline" onClick={() => submit(false)} disabled={!canImport}>
            Import lines only
          </Button>
          <Button type="button" variant="ghost" onClick={onBack} disabled={importing}>
            Back
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={importing}>
            Cancel
          </Button>
          <p className="text-sm text-muted-foreground" role="status">
            {blocked > 0
              ? `${blocked} selected line${blocked === 1 ? " needs" : "s need"} fixing, or exclude ${blocked === 1 ? "it" : "them"}, before importing.`
              : summary.importable === 0
                ? "Select at least one line to import."
                : mode === "replace" && !confirmReplace
                  ? "Confirm the replacement to continue."
                  : "Nothing is saved until you import."}
          </p>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone, partial }: { label: string; value: string; tone?: "ok" | "warn"; partial?: boolean }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-base font-semibold tabular-nums", tone === "warn" && "text-amber-700 dark:text-amber-400")}>
        {value}
        {partial ? <span className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-400" title="Some lines are missing values, so this is not the full total.">(incomplete)</span> : null}
      </p>
    </div>
  )
}

function DocumentNotes({ document, totalNotes }: { document: ReviewDocument; totalNotes: string[] }) {
  const notes = [...document.notes, ...totalNotes]
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        {document.summary || "Check the lines against your document."}
        {document.language ? ` Language: ${document.language}.` : ""}
        {document.reader.provider === "" ? " Read from your spreadsheet columns; no AI was used." : ` Read by ${document.reader.provider}${document.reader.model ? ` (${document.reader.model})` : ""}.`}
      </p>
      {document.partial ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-red-900 dark:bg-red-500/10 dark:text-red-200" role="alert">
          Only part of the document may have been read. Check that no lines are missing before importing.
        </p>
      ) : null}
      {notes.length > 0 ? (
        <div className="rounded-md bg-amber-50 px-3 py-2.5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            Please check
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-6">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

// ---- the original ------------------------------------------------------------------------------

function SourcePanel({ source, line }: { source: SourceView; line: ReviewLine | null }) {
  const quote = line?.source.quote
  return (
    <section className="flex max-h-[60vh] min-h-64 flex-col overflow-hidden rounded-md border bg-card lg:max-h-none" aria-label="Original document">
      <header className="border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Original{source.kind === "image" || source.kind === "pdf" ? `: ${source.name}` : source.kind === "sheet" ? `: sheet “${source.name}”` : " text"}
        {line && describeSource(line.source) ? <span className="ml-2 font-medium text-foreground">Selected line: {describeSource(line.source)}</span> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {source.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview of the planner's own file
          <img src={source.url} alt={`Preview of ${source.name}`} className="mx-auto max-w-full" />
        ) : source.kind === "pdf" ? (
          <iframe key={line?.source.page ?? 0} title={`Preview of ${source.name}`} src={`${source.url}#page=${line?.source.page ?? 1}`} className="h-full min-h-96 w-full" />
        ) : source.kind === "text" ? (
          <HighlightedText text={source.text} quote={quote} />
        ) : (
          <SheetPreview source={source} row={line?.source.row} />
        )}
      </div>
      {quote && source.kind !== "text" ? <p className="border-t px-3 py-2 text-xs">Text the reader used: <span className="italic">{quote}</span></p> : null}
    </section>
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

// ---- one line ------------------------------------------------------------------------------------

function LineCard({
  index,
  line,
  evaluation,
  notes,
  active,
  onActivate,
  onEdit,
  onConfirm,
  onRemove,
}: {
  index: number
  line: ReviewLine
  evaluation: LineEval
  notes: string[]
  active: boolean
  onActivate: () => void
  onEdit: (patch: Partial<ReviewLine>, touched: (keyof ReviewLine)[]) => void
  onConfirm: (what: Confirmation) => void
  onRemove: () => void
}) {
  const [more, setMore] = useState(false)
  const bad = (field: string) => evaluation.issues.some((issue) => issue.field === field && issue.kind !== "confirm")
  const input = (field: keyof ReviewLine, label: string, className?: string, placeholder?: string) => (
    <label className={cn("space-y-1 text-xs", className)}>
      <span className="block text-muted-foreground">{label}</span>
      <Input
        value={String(line[field] ?? "")}
        placeholder={placeholder}
        aria-invalid={bad(String(field))}
        className={cn("h-9", bad(String(field)) && "border-red-500", line.edited.includes(String(field)) && !bad(String(field)) && "border-sky-500")}
        onChange={(event) => onEdit({ [field]: event.target.value } as Partial<ReviewLine>, [field])}
        onFocus={onActivate}
      />
    </label>
  )
  const confirmable = evaluation.issues.filter((issue) => issue.kind === "confirm" || (issue.kind === "ambiguous" && /separator/.test(issue.message)))

  return (
    <article
      className={cn("rounded-md border bg-card p-3", active && "ring-2 ring-primary/60", !line.include && "opacity-60")}
      onClick={onActivate}
      aria-label={`Cargo line ${index + 1}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={line.include} onChange={(event) => onEdit({ include: event.target.checked }, [])} aria-label={`Import line ${index + 1}`} />
          Line {index + 1}
        </label>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[evaluation.status])}>{STATUS_LABEL[evaluation.status]}</span>
        {describeSource(line.source) ? <span className="text-xs text-muted-foreground">{describeSource(line.source)}</span> : null}
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2" onClick={onRemove} aria-label={`Remove line ${index + 1}`}>
          <Trash2 className="size-4" />
        </Button>
      </header>

      <div className="mt-2 grid gap-2 sm:grid-cols-6">
        {input("sku", "Mark / SKU", "sm:col-span-2")}
        {input("name", "Description", "sm:col-span-4")}
      </div>
      {line.translation ? <p className="mt-1 text-xs text-muted-foreground">English: {line.translation}</p> : null}

      <div className="mt-2 grid gap-2 sm:grid-cols-6">
        {input("length", "Length", "sm:col-span-1")}
        {input("width", "Width", "sm:col-span-1")}
        {input("height", "Height", "sm:col-span-1")}
        <label className="space-y-1 text-xs sm:col-span-2">
          <span className="block text-muted-foreground">Size unit</span>
          <select
            className={cn(select, "w-full", bad("sizeUnit") && "border-red-500")}
            value={line.sizeUnit ?? ""}
            onChange={(event) => onEdit({ sizeUnit: (event.target.value || null) as LengthUnit | null }, ["sizeUnit"])}
            aria-invalid={bad("sizeUnit")}
          >
            <option value="">Not stated: choose</option>
            {LENGTH_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {LENGTH_UNIT_LABEL[unit]}
              </option>
            ))}
          </select>
        </label>
        {input("quantity", "Quantity", "sm:col-span-1")}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-6">
        {input("weight", "Weight", "sm:col-span-1")}
        <label className="space-y-1 text-xs sm:col-span-2">
          <span className="block text-muted-foreground">The weight is</span>
          <select className={cn(select, "w-full", bad("weightScope") && "border-red-500")} value={line.weightScope} onChange={(event) => onEdit({ weightScope: event.target.value as WeightScope }, ["weightScope"])}>
            {(Object.keys(SCOPE_LABEL) as WeightScope[]).map((scope) => (
              <option key={scope} value={scope}>
                {SCOPE_LABEL[scope]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs sm:col-span-2">
          <span className="block text-muted-foreground">Weight unit</span>
          <select className={cn(select, "w-full", bad("weightUnit") && "border-red-500")} value={line.weightUnit ?? ""} onChange={(event) => onEdit({ weightUnit: (event.target.value || null) as ImportWeightUnit | null }, ["weightUnit"])}>
            <option value="">Not stated: choose</option>
            {IMPORT_WEIGHT_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {IMPORT_WEIGHT_UNIT_LABEL[unit]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs sm:col-span-1">
          <span className="block text-muted-foreground">Kind</span>
          <select className={cn(select, "w-full")} value={line.weightKind} onChange={(event) => onEdit({ weightKind: event.target.value as WeightKind }, ["weightKind"])}>
            {(Object.keys(KIND_LABEL) as WeightKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {evaluation.perPieceKg !== null ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Weight per piece: <span className="font-medium text-foreground">{formatKg(evaluation.perPieceKg)}</span> ({FIELD_ORIGIN_TEXT[evaluation.origins.weight ?? "source"]}).
          {evaluation.interpretation ? <> {evaluation.interpretation}.</> : null}
        </p>
      ) : null}

      {evaluation.issues.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {evaluation.issues.map((issue) => (
            <li key={`${issue.field}-${issue.message}`} className={cn("flex flex-wrap items-center gap-2", issue.kind === "invalid" ? "text-red-700 dark:text-red-400" : "text-amber-800 dark:text-amber-300")}>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {confirmable.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {evaluation.issues.some((issue) => issue.field === "weight" && issue.kind === "confirm" && evaluation.interpretation) ? (
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onConfirm("weight")}>
              Confirm {evaluation.perPieceKg !== null ? `${formatKg(evaluation.perPieceKg)} per piece` : "this weight"}
            </Button>
          ) : null}
          {line.weightKind === "net" && !line.confirmed.includes("net") ? (
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onConfirm("net")}>
              Use the net weight anyway
            </Button>
          ) : null}
          {evaluation.issues.some((issue) => issue.kind === "ambiguous" && /separator/.test(issue.message)) ? (
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onConfirm("numbers")}>
              The numbers are right as written
            </Button>
          ) : null}
        </div>
      ) : null}

      {line.checks.length > 0 || line.modelNotes.length > 0 || notes.length > 0 ? (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {line.checks.map((note) => (
            <p key={note}>Check: {note}</p>
          ))}
          {line.modelNotes.map((note) => (
            <p key={note}>The reader was unsure: {note}</p>
          ))}
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}

      <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setMore((value) => !value)} aria-expanded={more}>
        {more ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Shape, handling and other details
      </button>
      {more ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-6">
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block text-muted-foreground">Shape</span>
            <select className={cn(select, "w-full")} value={line.shape} onChange={(event) => onEdit({ shape: event.target.value as ReviewLine["shape"] }, ["shape"])}>
              <option value="BOX">Box or crate</option>
              <option value="CYLINDER_DRUM">Drum</option>
              <option value="PIPE">Pipe or roll</option>
            </select>
          </label>
          <TriState label="Stackable" value={line.stackable} onChange={(value) => onEdit({ stackable: value }, ["stackable"])} unset="Not stated (normal default)" />
          <TriState label="Floor only" value={line.floorOnly} onChange={(value) => onEdit({ floorOnly: value }, ["floorOnly"])} unset="Not stated" />
          <label className="space-y-1 text-xs sm:col-span-2">
            <span className="block text-muted-foreground">Turning</span>
            <select
              className={cn(select, "w-full")}
              value={line.orientation ?? ""}
              onChange={(event) => onEdit({ orientation: (event.target.value || null) as ReviewLine["orientation"] }, ["orientation"])}
            >
              <option value="">Not stated (normal default)</option>
              <option value="ROTATE_90">This side up (may turn on the floor)</option>
              <option value="FIXED">Do not rotate</option>
            </select>
          </label>
          {input("consignment", "Consignment", "sm:col-span-2")}
          {input("destination", "Unloading stop (number)", "sm:col-span-2", "1")}
          {input("hazard", "Hazard class (only if stated)", "sm:col-span-2")}
          {input("clearance", "Clearance override (cm, blank = project default)", "sm:col-span-3")}
          {input("handling", "Handling notes (not saved to the cargo line)", "sm:col-span-3")}
        </div>
      ) : null}
    </article>
  )
}

function TriState({ label, value, onChange, unset }: { label: string; value: boolean | null; onChange: (value: boolean | null) => void; unset: string }) {
  return (
    <label className="space-y-1 text-xs sm:col-span-1">
      <span className="block text-muted-foreground">{label}</span>
      <select
        className={cn(select, "w-full")}
        value={value === null ? "" : value ? "yes" : "no"}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "yes")}
      >
        <option value="">{unset}</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  )
}
