"use client"

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import type { EquipmentMode } from "@compass/domain"
import { AlertTriangle, Check, ClipboardPaste, FileText, FileUp, Image as ImageIcon, Loader2, Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import {
  extractCargoFromDocument,
  extractCargoFromSheet,
  extractCargoFromText,
  getImportCapabilities,
  importReviewedCargo,
  readSpreadsheetFile,
  saveImportTemplate,
} from "@/app/actions/cargo"
import { CargoImportReview, type ImportChoice, type SourceView } from "@/components/cargo-import-review"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { documentKind, isSpreadsheetFile, MAX_DOCUMENT_BYTES, MAX_PASTE_CHARS, type ReviewDocument } from "@/lib/cargo-extract"
import {
  CARGO_IMPORT_FIELDS,
  LENGTH_UNITS,
  missingRequiredFields,
  suggestLengthUnit,
  suggestMapping,
  WEIGHT_UNITS,
  type CargoImportField,
  type ImportMapping,
  type LengthUnit,
  type WeightUnit,
} from "@/lib/cargo-import"
import { LENGTH_UNIT_LABEL } from "@/lib/cargo-units"
import { evaluateLine, toDraft, type ExistingCargoSummary, type ReviewLine } from "@/lib/import-review"
import type { SheetInfo, SheetTable, WorkbookInfo } from "@/lib/import-sheet"
import { tableToReviewLines } from "@/lib/import-table"
import { shrinkImage } from "@/lib/shrink-image"
import { cn } from "@/lib/utils"

export type SavedMapping = {
  id: string
  name: string
  mapping: ImportMapping
}

const FIELD_LABEL: Record<CargoImportField, string> = {
  sku: "SKU / mark",
  name: "Description",
  length: "Length",
  width: "Width",
  height: "Height",
  dimensions: "Size in one cell (L x W x H)",
  weight: "Weight per piece",
  lineWeight: "Line total weight",
  netWeight: "Net weight (reference only)",
  quantity: "Quantity",
  shape: "Shape",
  orientation: "Orientation",
  stackable: "Stackable",
  notStackable: "Not stackable",
  bottomOnly: "Bottom only",
  maxStackLoadKg: "Max stack load",
  maxStackLayers: "Max stack layers",
  priority: "Priority",
  destinationStop: "Destination stop",
  consignmentId: "Consignment",
  segregationClass: "Segregation class",
  color: "Color",
}

const ACCEPT =
  ".xlsx,.csv,.pdf,.jpg,.jpeg,.png,.webp,.gif,image/*,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const OPEN_EVENT = "compass:open-import"
const UNSUPPORTED_FILE = "Use an Excel (.xlsx) or CSV file, a PDF, or a JPG, PNG or WebP image."

type Tab = "file" | "image" | "text"
type Stage = "choose" | "mapping" | "review"
type Picked = { file: File; url: string | null; kind: "sheet" | "pdf" | "image" }

/** Opens the import dialog. The Cargo table's buttons call this. */
export function openCargoImport() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function CargoImportWizard({
  projectId,
  projectMode,
  templates,
  existing,
  onImported,
}: {
  projectId: string
  projectMode: EquipmentMode
  templates: SavedMapping[]
  /** The cargo already in the project, so a repeat can be pointed out and replacing can be offered. */
  existing: ExistingCargoSummary[]
  /** Called after lines were added. `suggest` is true when the planner asked to go on to the best-fit equipment. */
  onImported?: (result: { suggest: boolean }) => void
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>("file")
  const [stage, setStage] = useState<Stage>("choose")
  const [picked, setPicked] = useState<Picked | null>(null)
  const [pastedImage, setPastedImage] = useState<Picked | null>(null)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [capabilities, setCapabilities] = useState<{ aiConfigured: boolean; aiLabel: string; model: string } | null>(null)

  // Spreadsheet mapping step.
  const [workbook, setWorkbook] = useState<WorkbookInfo | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [tableIndex, setTableIndex] = useState(0)
  const [columns, setColumns] = useState<Record<string, CargoImportField>>({})
  const [lengthUnit, setLengthUnit] = useState<LengthUnit | null>(null)
  const [unitSource, setUnitSource] = useState<"titles" | "none" | "conflict" | "chosen">("none")
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg")
  const [templateName, setTemplateName] = useState("")

  // Review step.
  const [review, setReview] = useState<{ document: ReviewDocument; source: SourceView; back: Stage } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  // Answers that arrive after Cancel (or after a newer request started) are ignored.
  const requestRef = useRef(0)
  const lockRef = useRef(false)
  const urlsRef = useRef<string[]>([])
  const reviewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const urls = urlsRef
    return () => urls.current.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  function makePicked(file: File): Picked | null {
    if (isSpreadsheetFile(file.name)) return { file, url: null, kind: "sheet" }
    const kind = documentKind(file.name, file.type)
    if (!kind) return null
    const url = URL.createObjectURL(file)
    urlsRef.current.push(url)
    return { file, url, kind: kind.kind === "pdf" ? "pdf" : "image" }
  }

  function dropPicked(item: Picked | null) {
    if (item?.url) URL.revokeObjectURL(item.url)
  }

  function resetAll() {
    requestRef.current += 1
    lockRef.current = false
    dropPicked(picked)
    dropPicked(pastedImage)
    setPicked(null)
    setPastedImage(null)
    setText("")
    setWorkbook(null)
    setReview(null)
    setColumns({})
    setLengthUnit(null)
    setUnitSource("none")
    setStage("choose")
    setBusy(null)
    setImporting(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  function close() {
    setOpen(false)
    resetAll()
  }

  // Load what the server can do (is AI set up?) the first time the dialog opens.
  useEffect(() => {
    if (!open || capabilities) return
    void getImportCapabilities().then((result) => {
      if (!("error" in result)) setCapabilities(result)
    })
  }, [open, capabilities])

  async function choose(file: File | null) {
    if (!file || busy) return
    const item = makePicked(file)
    if (!item) {
      toast.error(UNSUPPORTED_FILE)
      return
    }
    dropPicked(picked)
    setPicked(item)
    setTab("file")
    setOpen(true)
    // Spreadsheets are read here, on the server, with no AI: nothing leaves the planner's own system.
    if (item.kind === "sheet") await readSheetFile(item)
  }

  async function chooseImage(file: File) {
    if (busy) return
    if (!file.type.startsWith("image/") || !documentKind(file.name || "pasted.png", file.type)) {
      toast.error("That is not an image Compass can read. Use a PNG, JPG or WebP picture.")
      return
    }
    const item = makePicked(file.name ? file : new File([file], "pasted-image.png", { type: file.type }))
    if (!item) return
    dropPicked(pastedImage)
    setPastedImage(item)
    setTab("image")
    setOpen(true)
  }

  // A button on the Cargo table opens the dialog; a file dropped anywhere, or an image pasted anywhere, opens it with that file.
  const takeFile = useEffectEvent((file: File) => void choose(file))
  const takeImage = useEffectEvent((file: File) => void chooseImage(file))
  const openFromButton = useEffectEvent(() => setOpen(true))
  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files")
    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return
      depth += 1
      setDragging(true)
    }
    function onDragOver(event: DragEvent) {
      // Without this the browser opens the file instead of handing it to the page.
      if (hasFiles(event)) event.preventDefault()
    }
    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      const file = event.dataTransfer?.files[0]
      if (file) takeFile(file)
    }
    function onPaste(event: ClipboardEvent) {
      const file = Array.from(event.clipboardData?.files ?? []).find((entry) => entry.type.startsWith("image/"))
      if (!file) return
      event.preventDefault()
      takeImage(file)
    }
    const onOpen = () => openFromButton()
    window.addEventListener("dragenter", onDragEnter)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("drop", onDrop)
    window.addEventListener("paste", onPaste)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener("dragenter", onDragEnter)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("drop", onDrop)
      window.removeEventListener("paste", onPaste)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  async function pasteFromClipboard() {
    try {
      const entries = await navigator.clipboard.read()
      for (const entry of entries) {
        const type = entry.types.find((candidate) => candidate.startsWith("image/"))
        if (type) {
          const blob = await entry.getType(type)
          await chooseImage(new File([blob], "pasted-image.png", { type }))
          return
        }
      }
      toast.error("There is no image on the clipboard. Copy a screenshot first.")
    } catch {
      toast.error("The browser did not allow reading the clipboard. Press Ctrl+V (⌘V on a Mac) instead.")
    }
  }

  // ---- reading -------------------------------------------------------------------------------

  /** Runs one request at a time. A second click while one is running does nothing. */
  async function guarded(phase: string, work: (current: number) => Promise<void>) {
    if (lockRef.current) return
    lockRef.current = true
    const current = ++requestRef.current
    setBusy(phase)
    try {
      await work(current)
    } finally {
      if (current === requestRef.current) {
        lockRef.current = false
        setBusy(null)
      }
    }
  }

  const stillCurrent = (current: number) => current === requestRef.current

  async function readSheetFile(item: Picked) {
    await guarded("Reading spreadsheet", async (current) => {
      const body = new FormData()
      body.set("file", item.file)
      try {
        const result = await readSpreadsheetFile(body)
        if (!stillCurrent(current)) return
        if ("error" in result) {
          toast.error(result.error)
          dropPicked(item)
          setPicked(null)
          return
        }
        setWorkbook(result.workbook)
        // Start on the first sheet that has a table the importer is sure about.
        const sheet = Math.max(0, result.workbook.sheets.findIndex((entry) => entry.tables.some((table) => table.confident)))
        applyTable(result.workbook.sheets[sheet]!, sheet, 0)
        setStage("mapping")
      } catch {
        if (stillCurrent(current)) toast.error("Could not read the file. Check your connection and try again.")
      }
    })
  }

  function applyTable(sheet: SheetInfo, sheetPosition: number, tablePosition: number) {
    const table = sheet.tables[tablePosition]
    setSheetIndex(sheetPosition)
    setTableIndex(tablePosition)
    if (!table) return
    const suggested = suggestMapping(table.headers)
    setColumns(suggested)
    // A unit written in the size column titles ("Length (ft)") is evidence; nothing else is guessed.
    const hint = suggestLengthUnit(table.headers, suggested)
    setUnitSource(hint.source)
    setLengthUnit(hint.unit)
  }

  function showReview(document: ReviewDocument, source: SourceView, back: Stage) {
    setReview({ document, source, back })
    setStage("review")
    // The review is on the page, under the Cargo grid: bring it into view.
    window.setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50)
  }

  async function readDocument(item: Picked) {
    await guarded("Preparing document", async (current) => {
      try {
        // Phone photos are far larger than needed to read a table; shrinking keeps the upload quick.
        const upload = item.kind === "image" ? await shrinkImage(item.file) : item.file
        if (!stillCurrent(current)) return
        if (upload.size > MAX_DOCUMENT_BYTES) {
          toast.error("That file is over 10 MB. Use a smaller scan or fewer pages.")
          return
        }
        const body = new FormData()
        body.set("file", upload)
        body.set("mode", projectMode)
        setBusy("Extracting cargo information")
        const result = await extractCargoFromDocument(body)
        if (!stillCurrent(current)) return
        if ("error" in result) {
          toast.error(result.error)
          return
        }
        setBusy("Validating extracted values")
        showReview(
          result.document,
          item.kind === "pdf" ? { kind: "pdf", url: item.url!, name: item.file.name } : { kind: "image", url: item.url!, name: item.file.name || "Pasted image" },
          "choose",
        )
      } catch {
        if (stillCurrent(current)) toast.error("Could not read the document. Check your connection and try again.")
      }
    })
  }

  async function readText() {
    await guarded("Extracting cargo information", async (current) => {
      try {
        const result = await extractCargoFromText(text, projectMode)
        if (!stillCurrent(current)) return
        if ("error" in result) {
          toast.error(result.error)
          return
        }
        showReview(result.document, { kind: "text", text }, "choose")
      } catch {
        if (stillCurrent(current)) toast.error("Could not read the text. Check your connection and try again.")
      }
    })
  }

  const sheet = workbook?.sheets[sheetIndex] ?? null
  const table: SheetTable | null = sheet?.tables[tableIndex] ?? null

  async function readSheetWithAi() {
    if (!picked || !sheet) return
    const file = picked.file
    const sheetName = sheet.name
    const preview = sheet
    await guarded("Extracting cargo information", async (current) => {
      try {
        const body = new FormData()
        body.set("file", file)
        body.set("sheet", sheetName)
        body.set("mode", projectMode)
        const result = await extractCargoFromSheet(body)
        if (!stillCurrent(current)) return
        if ("error" in result) {
          toast.error(result.error)
          return
        }
        showReview(result.document, { kind: "sheet", name: sheetName, headers: null, rows: preview.preview, truncated: preview.rowCount > preview.preview.length }, "mapping")
      } catch {
        if (stillCurrent(current)) toast.error("Could not read the sheet. Check your connection and try again.")
      }
    })
  }

  const mapping = useMemo<ImportMapping | null>(() => (lengthUnit ? { lengthUnit, weightUnit, columns } : null), [columns, lengthUnit, weightUnit])
  const missing = missingRequiredFields(columns)

  function continueFromMapping() {
    if (!table || !mapping || missing.length > 0) return
    const { lines, skipped, documentTotals } = tableToReviewLines(table, mapping)
    const notes: string[] = []
    if (skipped.length > 0) {
      notes.push(
        `Left out ${skipped.length} total or subtotal row${skipped.length === 1 ? "" : "s"} (row${skipped.length === 1 ? "" : "s"} ${skipped.map((row) => row.rowNumber).join(", ")}): they add up other rows and are not cargo.`,
      )
    }
    const document: ReviewDocument = {
      origin: "spreadsheet",
      lines,
      summary: `${table.sheetName ? `Sheet “${table.sheetName}”` : "Spreadsheet"}, table starting at row ${table.headerRow}.`,
      language: null,
      notes,
      documentTotals,
      partial: false,
      reader: { provider: "", model: "" },
    }
    const rows = table.rows.slice(0, 500).map((cells, index) => ({ rowNumber: table.rowNumbers?.[index] ?? index + 2, cells }))
    showReview(document, { kind: "sheet", name: table.sheetName ?? "Sheet", headers: table.headers, rows, truncated: table.rows.length > rows.length }, "mapping")
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((entry) => entry.id === templateId)
    if (!template || !table) return
    setLengthUnit(template.mapping.lengthUnit)
    setUnitSource("chosen")
    setWeightUnit(template.mapping.weightUnit)
    setColumns((current) => {
      const next = { ...current }
      for (const [header, field] of Object.entries(template.mapping.columns)) {
        if (table.headers.includes(header)) next[header] = field
      }
      return next
    })
  }

  async function onSaveTemplate() {
    if (!mapping) return
    const result = await saveImportTemplate(templateName, mapping)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success("Mapping template saved.")
    setTemplateName("")
  }

  // ---- saving --------------------------------------------------------------------------------

  async function importLines(lines: ReviewLine[], choice: ImportChoice) {
    if (importing || lockRef.current) return
    const evaluations = lines.map(evaluateLine)
    const rows = lines.map((line, index) => {
      const evaluation = evaluations[index]!
      // Flags that travel with the line: stacking the document did not state, and a weight that is only an estimate.
      const flags = (row: { stackable: boolean; weightKg: number }) => ({
        stackableNotStated: evaluation.stackableNotStated && row.stackable === false ? true : undefined,
        weightEstimate:
          evaluation.weightEstimated && evaluation.perPieceKg !== null && Math.abs(evaluation.perPieceKg - row.weightKg) < 0.0001
            ? { perPieceKg: evaluation.perPieceKg, basis: line.estimateBasis || "estimated at import" }
            : undefined,
      })
      if (evaluation.input) return { ...evaluation.input, ...flags(evaluation.input) }
      const draft = toDraft(line, evaluation)
      return draft ? { ...draft.input, importNotes: draft.notes, ...flags(draft.input) } : null
    })
    const drafts = evaluations.filter((evaluation) => evaluation.input === null).length
    if (rows.length === 0 || rows.some((row) => row === null)) {
      toast.error("Some selected lines need a quantity and a description or mark before they can be added, even as drafts.")
      return
    }
    if (choice.suggest && drafts > 0) {
      toast.error("Equipment suggestions need every selected line to be complete. Fix the lines, or use Add lines only.")
      return
    }
    lockRef.current = true
    setImporting(true)
    try {
      const result = await importReviewedCargo(projectId, rows as NonNullable<(typeof rows)[number]>[], { mode: choice.mode, confirmReplace: choice.confirmReplace, allowIncomplete: drafts > 0 })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const summary =
        result.removed > 0
          ? `Replaced ${result.removed} line${result.removed === 1 ? "" : "s"} with ${result.count} new one${result.count === 1 ? "" : "s"}. Calculate the load plan again.`
          : `Added ${result.count} cargo line${result.count === 1 ? "" : "s"}.`
      if (result.drafts > 0) {
        toast.warning(`${summary} ${result.drafts} ${result.drafts === 1 ? "is a draft" : "are drafts"}: finish ${result.drafts === 1 ? "it" : "them"} in the table. Incomplete lines are left out of equipment suggestions and load plans.`)
      } else {
        toast.success(summary)
      }
      close()
      onImported?.({ suggest: choice.suggest })
    } catch {
      toast.error("Could not add the lines, and nothing was changed. Check your connection and try again.")
    } finally {
      lockRef.current = false
      setImporting(false)
    }
  }

  const aiReady = capabilities?.aiConfigured === true
  const aiName = capabilities?.aiLabel ?? "Claude (Anthropic)"
  const wide = stage === "mapping"

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        accept={ACCEPT}
        aria-label="Packing list to import"
        onChange={(event) => void choose(event.target.files?.[0] ?? null)}
      />

      {dragging && !open ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm" aria-hidden="true">
          <div className="flex max-w-md flex-col items-center rounded-xl border-2 border-dashed border-primary bg-card px-10 py-12 text-center shadow-raised">
            <FileUp className="size-9 text-primary" />
            <p className="mt-4 text-base font-semibold">Drop your packing list</p>
            <p className="mt-1 text-sm text-muted-foreground">Excel and CSV files are read here. A photo, screenshot or PDF is read by AI once you confirm.</p>
          </div>
        </div>
      ) : null}

      <Dialog open={open && stage !== "review"} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent
          className={cn("flex max-h-[92vh] flex-col overflow-hidden", wide ? "h-[92vh] max-w-[min(64rem,96vw)]" : "max-w-2xl")}
          onInteractOutside={(event) => {
            // A reviewed import is work in progress: only Cancel or the close button leaves it.
            if (stage !== "choose" || busy) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>Import packing list</DialogTitle>
            <DialogDescription>
              {stage === "choose"
                ? "Upload a file, paste a picture, or paste text. You review every line before anything is saved."
                : stage === "mapping"
                  ? "Check that each column matches the right field and the units are right."
                  : "Check the lines against the original. Nothing is saved until you import."}
            </DialogDescription>
          </DialogHeader>

          {busy ? <Progress phase={busy} onCancel={() => { requestRef.current += 1; lockRef.current = false; setBusy(null) }} /> : null}

          {stage === "choose" ? (
            <div className={cn("min-h-0 space-y-4 overflow-y-auto", busy && "pointer-events-none opacity-50")}>
              <div role="tablist" aria-label="Import method" className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1 text-sm">
                {(
                  [
                    ["file", "Upload file", FileUp],
                    ["image", "Paste image", ImageIcon],
                    ["text", "Paste text", FileText],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    className={cn("flex items-center justify-center gap-2 rounded px-3 py-2 font-medium", tab === id ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
                    onClick={() => setTab(id)}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>

              {tab === "file" ? (
                <UploadTab
                  picked={picked}
                  dragging={dragging}
                  aiReady={aiReady}
                  aiName={aiName}
                  capabilitiesKnown={capabilities !== null}
                  onBrowse={() => inputRef.current?.click()}
                  onRemove={() => {
                    dropPicked(picked)
                    setPicked(null)
                    setWorkbook(null)
                    if (inputRef.current) inputRef.current.value = ""
                  }}
                  onRead={() => picked && void readDocument(picked)}
                />
              ) : null}

              {tab === "image" ? (
                <PasteImageTab
                  picked={pastedImage}
                  aiReady={aiReady}
                  aiName={aiName}
                  capabilitiesKnown={capabilities !== null}
                  onPasteClick={() => void pasteFromClipboard()}
                  onRemove={() => {
                    dropPicked(pastedImage)
                    setPastedImage(null)
                  }}
                  onRead={() => pastedImage && void readDocument(pastedImage)}
                />
              ) : null}

              {tab === "text" ? (
                <div className="space-y-3">
                  <Label htmlFor="import-text">Paste cargo details from an email, quotation, chat message or shipment instruction</Label>
                  <textarea
                    id="import-text"
                    className="min-h-48 w-full rounded-md border bg-background p-3 text-sm"
                    placeholder="10 wooden crates, each measuring 120 x 80 x 60 cm and weighing 150 kg per crate, and 5 steel drums weighing 200 kg each."
                    value={text}
                    maxLength={MAX_PASTE_CHARS + 1000}
                    onChange={(event) => setText(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {text.length.toLocaleString("en-US")} / {MAX_PASTE_CHARS.toLocaleString("en-US")} characters. Missing sizes, weights or quantities are flagged, never guessed.
                  </p>
                  <AiNotice aiReady={aiReady} aiName={aiName} capabilitiesKnown={capabilities !== null} />
                  <Button type="button" onClick={() => void readText()} disabled={!aiReady || text.trim() === "" || text.length > MAX_PASTE_CHARS || busy !== null}>
                    <Sparkles className="size-4" />
                    Extract cargo from text
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {stage === "mapping" && workbook && sheet && table ? (
            <div className={cn("min-h-0 space-y-4 overflow-y-auto", busy && "pointer-events-none opacity-50")}>
              <MappingStep
                fileName={picked?.file.name ?? "file"}
                workbook={workbook}
                sheetIndex={sheetIndex}
                tableIndex={tableIndex}
                table={table}
                columns={columns}
                setColumns={setColumns}
                lengthUnit={lengthUnit}
                setLengthUnit={(unit) => {
                  setLengthUnit(unit)
                  setUnitSource("chosen")
                }}
                unitSource={unitSource}
                weightUnit={weightUnit}
                setWeightUnit={setWeightUnit}
                templates={templates}
                onApplyTemplate={applyTemplate}
                templateName={templateName}
                setTemplateName={setTemplateName}
                onSaveTemplate={() => void onSaveTemplate()}
                onSelectTable={(sheetPosition, tablePosition) => applyTable(workbook.sheets[sheetPosition]!, sheetPosition, tablePosition)}
                missing={missing}
                aiReady={aiReady}
                aiName={aiName}
                capabilitiesKnown={capabilities !== null}
                onReadWithAi={() => void readSheetWithAi()}
                onContinue={continueFromMapping}
                onBack={() => {
                  setStage("choose")
                  setWorkbook(null)
                }}
                onCancel={close}
              />
            </div>
          ) : null}

        </DialogContent>
      </Dialog>
      {open && stage === "review" && review ? (
        <div ref={reviewRef} className="scroll-mt-20">
          <CargoImportReview
            document={review.document}
            source={review.source}
            existing={existing}
            importing={importing}
            onBack={() => {
              setStage(review.back)
              setReview(null)
            }}
            onCancel={close}
            onImport={(lines, choice) => void importLines(lines, choice)}
          />
        </div>
      ) : null}
    </>
  )
}

// ---- pieces ----------------------------------------------------------------------------------------

function Progress({ phase, onCancel }: { phase: string; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm" role="status" aria-live="polite">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      <span>{phase}…</span>
      <span className="text-xs text-muted-foreground">Reading by AI can take 10 to 30 seconds. Cancel stops waiting; a request already sent may still finish on the server.</span>
      <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

function AiNotice({ aiReady, aiName, capabilitiesKnown }: { aiReady: boolean; aiName: string; capabilitiesKnown: boolean }) {
  if (!capabilitiesKnown) return <p className="text-xs text-muted-foreground">Checking whether AI reading is set up…</p>
  return aiReady ? (
    <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>This is read by an external AI service, {aiName}. Only send documents your company allows to leave this system. Excel and CSV files are read here and are not sent anywhere.</span>
    </p>
  ) : (
    <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
      AI reading is not set up on this server (ANTHROPIC_API_KEY). Excel and CSV packing lists still import by column.
    </p>
  )
}

function UploadTab({
  picked,
  dragging,
  aiReady,
  aiName,
  capabilitiesKnown,
  onBrowse,
  onRemove,
  onRead,
}: {
  picked: Picked | null
  dragging: boolean
  aiReady: boolean
  aiName: string
  capabilitiesKnown: boolean
  onBrowse: () => void
  onRemove: () => void
  onRead: () => void
}) {
  if (!picked) {
    return (
      <div className={cn("flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center", dragging && "border-primary bg-primary/5")}>
        <FileUp className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">Drag a file here, or</p>
        <Button type="button" onClick={onBrowse}>
          Browse files
        </Button>
        <p className="max-w-md text-xs text-muted-foreground">
          Excel (.xlsx), CSV, PDF, and JPG, PNG, WebP or GIF images. PDFs and images up to 10 MB (images over 5 MB are shrunk first); spreadsheets up to 5 MB.
        </p>
      </div>
    )
  }
  const needsAi = picked.kind !== "sheet"
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-md border bg-card p-3">
        <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{picked.file.name || "Pasted image"}</p>
          <p className="text-xs text-muted-foreground">{formatBytes(picked.file.size)}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBrowse}>
          Replace
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Remove file">
          <X className="size-4" />
        </Button>
      </div>
      <FilePreview picked={picked} />
      {needsAi ? (
        <>
          <AiNotice aiReady={aiReady} aiName={aiName} capabilitiesKnown={capabilitiesKnown} />
          <Button type="button" onClick={onRead} disabled={!aiReady}>
            <Sparkles className="size-4" />
            Extract cargo from this {picked.kind === "pdf" ? "PDF" : "image"}
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Reading the spreadsheet…</p>
      )}
    </div>
  )
}

function FilePreview({ picked }: { picked: Picked }) {
  if (picked.kind === "image" && picked.url) {
    // eslint-disable-next-line @next/next/no-img-element -- a local preview of the planner's own file
    return <img src={picked.url} alt={`Preview of ${picked.file.name}`} className="max-h-72 w-full rounded-md border object-contain" />
  }
  if (picked.kind === "pdf" && picked.url) {
    return <iframe title={`Preview of ${picked.file.name}`} src={picked.url} className="h-72 w-full rounded-md border" />
  }
  return null
}

function PasteImageTab({
  picked,
  aiReady,
  aiName,
  capabilitiesKnown,
  onPasteClick,
  onRemove,
  onRead,
}: {
  picked: Picked | null
  aiReady: boolean
  aiName: string
  capabilitiesKnown: boolean
  onPasteClick: () => void
  onRemove: () => void
  onRead: () => void
}) {
  return (
    <div className="space-y-3">
      {!picked ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center">
          <ClipboardPaste className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">Press Ctrl+V (⌘V on a Mac) to paste a screenshot or a copied image</p>
          <Button type="button" variant="outline" onClick={onPasteClick}>
            Paste from clipboard
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-md border bg-card p-3">
            <ImageIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">Pasted image</p>
              <p className="text-xs text-muted-foreground">{formatBytes(picked.file.size)}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onPasteClick}>
              Replace
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Remove image">
              <X className="size-4" />
            </Button>
          </div>
          <FilePreview picked={picked} />
          <AiNotice aiReady={aiReady} aiName={aiName} capabilitiesKnown={capabilitiesKnown} />
          <Button type="button" onClick={onRead} disabled={!aiReady}>
            <Sparkles className="size-4" />
            Extract cargo from this image
          </Button>
        </>
      )}
    </div>
  )
}

function MappingStep({
  fileName,
  workbook,
  sheetIndex,
  tableIndex,
  table,
  columns,
  setColumns,
  lengthUnit,
  setLengthUnit,
  unitSource,
  weightUnit,
  setWeightUnit,
  templates,
  onApplyTemplate,
  templateName,
  setTemplateName,
  onSaveTemplate,
  onSelectTable,
  missing,
  aiReady,
  aiName,
  capabilitiesKnown,
  onReadWithAi,
  onContinue,
  onBack,
  onCancel,
}: {
  fileName: string
  workbook: WorkbookInfo
  sheetIndex: number
  tableIndex: number
  table: SheetTable
  columns: Record<string, CargoImportField>
  setColumns: (update: (current: Record<string, CargoImportField>) => Record<string, CargoImportField>) => void
  lengthUnit: LengthUnit | null
  setLengthUnit: (unit: LengthUnit | null) => void
  unitSource: "titles" | "none" | "conflict" | "chosen"
  weightUnit: WeightUnit
  setWeightUnit: (unit: WeightUnit) => void
  templates: SavedMapping[]
  onApplyTemplate: (id: string) => void
  templateName: string
  setTemplateName: (name: string) => void
  onSaveTemplate: () => void
  onSelectTable: (sheet: number, table: number) => void
  missing: CargoImportField[]
  aiReady: boolean
  aiName: string
  capabilitiesKnown: boolean
  onReadWithAi: () => void
  onContinue: () => void
  onBack: () => void
  onCancel: () => void
}) {
  const sheet = workbook.sheets[sheetIndex]!
  const select = "h-9 rounded-md border bg-background px-2"
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {fileName}: {workbook.sheets.length} sheet{workbook.sheets.length === 1 ? "" : "s"}. The cargo table starts at row {table.headerRow}.
      </p>

      <div className="flex flex-wrap gap-3">
        {workbook.sheets.length > 1 ? (
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Worksheet</span>
            <select className={select} value={sheetIndex} onChange={(event) => onSelectTable(Number(event.target.value), 0)}>
              {workbook.sheets.map((entry, index) => (
                <option key={entry.name} value={index}>
                  {entry.name} ({entry.rowCount} rows)
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sheet.tables.length > 1 ? (
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Table on this sheet</span>
            <select className={select} value={tableIndex} onChange={(event) => onSelectTable(sheetIndex, Number(event.target.value))}>
              {sheet.tables.map((entry, index) => (
                <option key={entry.headerRow} value={index}>
                  Starting at row {entry.headerRow} ({entry.rows.length} rows)
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Size unit</span>
          <select className={cn(select, lengthUnit === null && "border-amber-500")} value={lengthUnit ?? ""} onChange={(event) => setLengthUnit((event.target.value || null) as LengthUnit | null)}>
            <option value="">Choose the unit…</option>
            {LENGTH_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {LENGTH_UNIT_LABEL[unit]}
              </option>
            ))}
          </select>
          <span className="block max-w-64 text-xs text-muted-foreground">
            {unitSource === "titles"
              ? "Read from the size column titles."
              : unitSource === "conflict"
                ? "The size columns name different units, so none was chosen for you."
                : unitSource === "chosen"
                  ? "A unit written in a cell (4 ft, 1200 mm, 5'6\") is read as written."
                  : "No unit was found in the column titles. Choose the unit the numbers are in."}
          </span>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Weight unit</span>
          <select className={select} value={weightUnit} onChange={(event) => setWeightUnit(event.target.value as WeightUnit)}>
            {WEIGHT_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>
        {templates.length > 0 ? (
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Saved mapping</span>
            <select className={select} defaultValue="" onChange={(event) => onApplyTemplate(event.target.value)}>
              <option value="">Apply a template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {!table.confident ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Compass could not find all the columns it needs (a description or mark, the size and the weight) in this table. Choose them below, or let AI read the sheet.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-muted-foreground">
              <th className="px-3 py-2 font-medium">Column</th>
              <th className="px-3 py-2 font-medium">Maps to</th>
              <th className="px-3 py-2 font-medium">First value</th>
            </tr>
          </thead>
          <tbody>
            {table.headers.map((header, position) => (
              <tr key={`${header}-${position}`} className="border-b border-border/70">
                <td className="px-3 py-2">{header}</td>
                <td className="px-3 py-2">
                  <select
                    aria-label={`Map ${header}`}
                    className="h-8 rounded-md border bg-background px-2"
                    value={columns[header] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value
                      setColumns((current) => {
                        const next = { ...current }
                        if (!value) delete next[header]
                        else next[header] = value as CargoImportField
                        return next
                      })
                    }}
                  >
                    <option value="">Ignore</option>
                    {CARGO_IMPORT_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {FIELD_LABEL[field]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="max-w-64 truncate px-3 py-2 text-muted-foreground" title={table.rows[0]?.[position]}>
                  {table.rows[0]?.[position] || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {missing.length > 0 ? <p className="text-sm text-destructive">Still need: {missing.map((field) => FIELD_LABEL[field]).join(", ")}.</p> : null}
      <p className="text-xs text-muted-foreground">
        With no Quantity column, each row is one piece. Rows that add up other rows (Total, Subtotal) are left out. Weights are kept per piece; a line total is divided only after you confirm it in the review.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="template-name">Save this mapping</Label>
          <Input id="template-name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Warehouse export" />
        </div>
        <Button type="button" variant="outline" onClick={onSaveTemplate} disabled={templateName.trim() === "" || missing.length > 0 || lengthUnit === null}>
          Save template
        </Button>
      </div>

      <div className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={onContinue} disabled={missing.length > 0 || lengthUnit === null}>
            <Check className="size-4" />
            Continue to review
          </Button>
          <Button type="button" variant="outline" onClick={onReadWithAi} disabled={!aiReady} title={aiReady ? undefined : "AI reading is not set up on this server"}>
            <Sparkles className="size-4" />
            Read this sheet with AI instead
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <AiNotice aiReady={aiReady} aiName={aiName} capabilitiesKnown={capabilitiesKnown} />
      </div>
    </div>
  )
}
