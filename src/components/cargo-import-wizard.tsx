"use client"

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import type { EquipmentMode } from "@compass/domain"
import { AlertTriangle, FileUp, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { extractCargoFromDocument, importCargoRows, previewCargoFile, saveImportTemplate } from "@/app/actions/cargo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { documentKind, isSpreadsheetFile, MAX_DOCUMENT_BYTES, type ExtractedCargo } from "@/lib/cargo-extract"
import {
  buildImportPreview,
  CARGO_IMPORT_FIELDS,
  LENGTH_UNITS,
  missingRequiredFields,
  suggestMapping,
  WEIGHT_UNITS,
  type CargoImportField,
  type ImportMapping,
  type LengthUnit,
  type TabularSheet,
  type WeightUnit,
} from "@/lib/cargo-import"
import { formatKg, formatM3 } from "@/lib/format"
import { shrinkImage } from "@/lib/shrink-image"
import { cn } from "@/lib/utils"

export type SavedMapping = {
  id: string
  name: string
  mapping: ImportMapping
}

const FIELD_LABEL: Record<CargoImportField, string> = {
  sku: "SKU",
  name: "Name",
  length: "Length",
  width: "Width",
  height: "Height",
  weight: "Weight",
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

const UNSUPPORTED_FILE = "Use a photo or PDF of the packing list, or an Excel (.xlsx) or CSV file."

export function CargoImportWizard({
  projectId,
  projectMode,
  templates,
  onImported,
}: {
  projectId: string
  projectMode: EquipmentMode
  templates: SavedMapping[]
  /** Called after lines were added. `suggest` is true when the planner asked to go on to the best-fit equipment. */
  onImported?: (result: { suggest: boolean }) => void
}) {
  const [sheet, setSheet] = useState<TabularSheet | null>(null)
  const [extracted, setExtracted] = useState<ExtractedCargo | null>(null)
  const [columns, setColumns] = useState<Record<string, CargoImportField>>({})
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>("cm")
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg")
  const [templateName, setTemplateName] = useState("")
  const [reading, setReading] = useState<"sheet" | "document" | null>(null)
  const [importing, setImporting] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Bring the review step into view as soon as a file has been read.
  useEffect(() => {
    if (sheet || extracted) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [sheet, extracted])

  function reset() {
    setSheet(null)
    setExtracted(null)
    setFileName(null)
    // Clear the input so picking the same file again still triggers a change.
    if (inputRef.current) inputRef.current.value = ""
  }

  const mapping = useMemo<ImportMapping>(
    () => ({ lengthUnit, weightUnit, columns }),
    [columns, lengthUnit, weightUnit],
  )
  const preview = useMemo(() => (sheet ? buildImportPreview(sheet, mapping) : null), [mapping, sheet])
  const missing = missingRequiredFields(columns)
  const busy = reading !== null || importing

  async function readSheet(file: File) {
    setReading("sheet")
    try {
      const body = new FormData()
      body.set("file", file)
      const result = await previewCargoFile(body)
      if ("error" in result) {
        toast.error(result.error)
        reset()
        return
      }
      setSheet(result.sheet)
      setColumns(suggestMapping(result.sheet.headers))
    } catch {
      toast.error("Could not read the file. Check your connection and try again.")
      reset()
    } finally {
      setReading(null)
    }
  }

  async function readDocument(file: File, isImage: boolean) {
    setReading("document")
    try {
      // Phone photos are far larger than needed to read a table; shrinking keeps the upload quick.
      const upload = isImage ? await shrinkImage(file) : file
      if (upload.size > MAX_DOCUMENT_BYTES) {
        toast.error("That file is over 10 MB. Use a smaller scan or fewer pages.")
        reset()
        return
      }
      const body = new FormData()
      body.set("file", upload)
      body.set("mode", projectMode)
      const result = await extractCargoFromDocument(body)
      if ("error" in result) {
        toast.error(result.error)
        reset()
        return
      }
      if (result.cargo.drafts.length === 0) {
        toast.error(result.cargo.notes[0] ?? "No packages were found in that document.")
        reset()
        return
      }
      setExtracted(result.cargo)
    } catch {
      toast.error("Could not read the document. Check your connection and try again.")
      reset()
    } finally {
      setReading(null)
    }
  }

  async function onFile(file: File | null) {
    if (!file || busy) return
    const document = documentKind(file.name, file.type)
    if (!isSpreadsheetFile(file.name) && !document) {
      toast.error(UNSUPPORTED_FILE)
      return
    }
    setSheet(null)
    setExtracted(null)
    setFileName(file.name || "pasted image")
    if (isSpreadsheetFile(file.name)) await readSheet(file)
    else if (document) await readDocument(file, document.kind === "image")
  }

  // Drop a file anywhere on the Cargo step, or paste a screenshot, instead of using the file picker.
  const takeFile = useEffectEvent((file: File) => void onFile(file))
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
      takeFile(file)
    }
    window.addEventListener("dragenter", onDragEnter)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("drop", onDrop)
    window.addEventListener("paste", onPaste)
    return () => {
      window.removeEventListener("dragenter", onDragEnter)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("drop", onDrop)
      window.removeEventListener("paste", onPaste)
    }
  }, [])

  function applyTemplate(templateId: string) {
    const template = templates.find((entry) => entry.id === templateId)
    if (!template || !sheet) return
    setLengthUnit(template.mapping.lengthUnit)
    setWeightUnit(template.mapping.weightUnit)
    setColumns((current) => {
      const next = { ...current }
      for (const [header, field] of Object.entries(template.mapping.columns)) {
        if (sheet.headers.includes(header)) next[header] = field
      }
      return next
    })
  }

  async function onSaveTemplate() {
    const result = await saveImportTemplate(templateName, mapping)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success("Mapping template saved.")
    setTemplateName("")
  }

  async function onImport() {
    if (!preview || preview.drafts.length === 0 || preview.issues.length > 0) return
    setImporting(true)
    const result = await importCargoRows(projectId, preview.drafts)
    setImporting(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`Imported ${result.count} cargo line${result.count === 1 ? "" : "s"}.`)
    reset()
    onImported?.({ suggest: false })
  }

  async function addExtracted(suggest: boolean) {
    if (!extracted || extracted.drafts.length === 0) return
    const ready = extracted.drafts.length - extracted.incomplete
    setImporting(true)
    try {
      const result = await importCargoRows(projectId, extracted.drafts)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (extracted.incomplete > 0) {
        toast.warning(
          `Added ${result.count} line${result.count === 1 ? "" : "s"}. ${extracted.incomplete} still need a size or weight; they are marked in the table.`,
        )
      } else {
        toast.success(`Added ${result.count} cargo line${result.count === 1 ? "" : "s"}.`)
      }
      reset()
      onImported?.({ suggest: suggest && ready > 0 })
    } catch {
      toast.error("Could not add the lines. Check your connection and try again.")
    } finally {
      setImporting(false)
    }
  }

  const extractedTotals = useMemo(() => {
    if (!extracted) return null
    return extracted.drafts.reduce(
      (sum, draft) => ({
        pieces: sum.pieces + draft.quantity,
        kg: sum.kg + draft.weightKg * draft.quantity,
        m3: sum.m3 + (draft.lengthCm * draft.widthCm * draft.heightCm * draft.quantity) / 1_000_000,
      }),
      { pieces: 0, kg: 0, m3: 0 },
    )
  }, [extracted])

  return (
    <>
      {/* The one file picker. The import button above the cargo table opens it. */}
      <input
        ref={inputRef}
        id={CARGO_FILE_INPUT_ID}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Packing list to import: photo, PDF, Excel or CSV"
        accept=".xlsx,.csv,.pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
      />

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm" aria-hidden="true">
          <div className="flex max-w-md flex-col items-center rounded-xl border-2 border-dashed border-primary bg-card px-10 py-12 text-center shadow-raised">
            <FileUp className="size-9 text-primary" />
            <p className="mt-4 text-base font-semibold">Drop your packing list</p>
            <p className="mt-1 text-sm text-muted-foreground">
              A photo, screenshot or PDF is read for you. Excel and CSV files are imported by column.
            </p>
          </div>
        </div>
      ) : null}

      {reading || sheet || extracted ? (
        <section ref={panelRef} className="scroll-mt-20 rounded-md border bg-card p-4" aria-label="Import cargo">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 truncate text-sm font-semibold">
                {reading === "document" || extracted ? <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                <span className="truncate">
                  {extracted ? "Read from" : "Import"} {fileName ?? "file"}
                </span>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground" role="status" aria-live="polite">
                {reading === "document" ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" />
                    Reading the document. This usually takes 10 to 30 seconds…
                  </span>
                ) : reading === "sheet" ? (
                  "Reading the file…"
                ) : extracted ? (
                  extracted.summary || "Check the lines below against your document, then add them."
                ) : (
                  "Check that each column matches the right field and the units are right, then import."
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
                Choose another file
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>

          {extracted && extractedTotals ? (
            <div className="mt-5 space-y-4">
              {extracted.notes.length > 0 ? (
                <div className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                  <p className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    Please check
                  </p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-6">
                    {extracted.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Mark</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 text-right font-medium">L (cm)</th>
                      <th className="px-3 py-2 text-right font-medium">W (cm)</th>
                      <th className="px-3 py-2 text-right font-medium">H (cm)</th>
                      <th className="px-3 py-2 text-right font-medium">kg / piece</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 font-medium">Stack</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extracted.drafts.map((draft, index) => (
                      <tr key={`${draft.sku ?? ""}-${draft.name}-${index}`} className="border-b border-border/70 last:border-b-0">
                        <td className="px-3 py-2 whitespace-nowrap">{draft.sku ?? "—"}</td>
                        <td className="max-w-[22rem] truncate px-3 py-2" title={draft.name}>
                          {draft.name}
                        </td>
                        <NumberCell value={draft.lengthCm} />
                        <NumberCell value={draft.widthCm} />
                        <NumberCell value={draft.heightCm} />
                        <NumberCell value={draft.weightKg} />
                        <td className="px-3 py-2 text-right tabular-nums">{draft.quantity}</td>
                        <td className="px-3 py-2 text-muted-foreground">{draft.stackable ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-sm text-muted-foreground">
                {extracted.drafts.length} line{extracted.drafts.length === 1 ? "" : "s"} · {extractedTotals.pieces} piece
                {extractedTotals.pieces === 1 ? "" : "s"} · {formatKg(extractedTotals.kg)} · {formatM3(extractedTotals.m3)}
                {extracted.incomplete > 0 ? (
                  <span className="text-amber-700 dark:text-amber-400">
                    {" "}
                    · {extracted.incomplete} line{extracted.incomplete === 1 ? " is" : "s are"} missing a size or weight (shown as
                    —). You can fill them in after adding.
                  </span>
                ) : null}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => void addExtracted(true)} disabled={importing}>
                  {importing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Add {extracted.drafts.length} line{extracted.drafts.length === 1 ? "" : "s"} and suggest equipment
                </Button>
                <Button type="button" variant="outline" onClick={() => void addExtracted(false)} disabled={importing}>
                  Add lines only
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The document was read by Claude (Anthropic). It can misread a number, so compare the lines with your document. Sizes
                are converted to cm and weights to kg.
              </p>
            </div>
          ) : null}

          {sheet && preview ? (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap gap-3">
                <label className="space-y-1 text-sm">
                  <span className="block text-muted-foreground">Length unit</span>
                  <select
                    className="h-9 rounded-md border bg-background px-2"
                    value={lengthUnit}
                    onChange={(event) => setLengthUnit(event.target.value as LengthUnit)}
                  >
                    {LENGTH_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit === "in" ? "inch" : unit === "m" ? "meter" : unit}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block text-muted-foreground">Weight unit</span>
                  <select
                    className="h-9 rounded-md border bg-background px-2"
                    value={weightUnit}
                    onChange={(event) => setWeightUnit(event.target.value as WeightUnit)}
                  >
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
                    <select
                      className="h-9 rounded-md border bg-background px-2"
                      defaultValue=""
                      onChange={(event) => applyTemplate(event.target.value)}
                    >
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

              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Column</th>
                      <th className="py-2 pr-3 font-medium">Maps to</th>
                      <th className="py-2 font-medium">First value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.headers.map((header) => (
                      <tr key={header} className="border-b border-border/70">
                        <td className="py-2 pr-3">{header}</td>
                        <td className="py-2 pr-3">
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
                        <td className="py-2 text-muted-foreground">{sheet.rows[0]?.[sheet.headers.indexOf(header)] || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {missing.length > 0 ? (
                <p className="text-sm text-destructive">Still need: {missing.join(", ")}.</p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                {preview.drafts.length} valid rows, {preview.issues.length} issues.
              </p>
              {preview.issues.length > 0 ? (
                <ul className="max-h-40 space-y-1 overflow-auto text-sm text-destructive">
                  {preview.issues.slice(0, 20).map((issue) => (
                    <li key={`${issue.rowNumber}-${issue.field}-${issue.message}`}>
                      Row {issue.rowNumber} · {issue.field}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="template-name">Save this mapping</Label>
                  <Input
                    id="template-name"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder="Warehouse export"
                  />
                </div>
                <Button type="button" variant="outline" onClick={onSaveTemplate} disabled={templateName.trim() === ""}>
                  Save template
                </Button>
                <Button
                  type="button"
                  onClick={onImport}
                  disabled={importing || preview.drafts.length === 0 || preview.issues.length > 0}
                >
                  {importing ? "Importing…" : `Import ${preview.drafts.length} row${preview.drafts.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  )
}

/** A size or weight read from the document; a dash in amber when the document did not give it. */
function NumberCell({ value }: { value: number }) {
  return (
    <td className={cn("px-3 py-2 text-right tabular-nums", value === 0 && "font-medium text-amber-700 dark:text-amber-400")}>
      {value === 0 ? "—" : value}
    </td>
  )
}

/** Id of the hidden file input; the cargo table's import button clicks it. */
export const CARGO_FILE_INPUT_ID = "cargo-file"

export function openCargoFilePicker() {
  document.getElementById(CARGO_FILE_INPUT_ID)?.click()
}
