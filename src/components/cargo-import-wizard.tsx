"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { importCargoRows, previewCargoFile, saveImportTemplate } from "@/app/actions/cargo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

export function CargoImportWizard({
  projectId,
  templates,
}: {
  projectId: string
  templates: SavedMapping[]
}) {
  const [sheet, setSheet] = useState<TabularSheet | null>(null)
  const [columns, setColumns] = useState<Record<string, CargoImportField>>({})
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>("cm")
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg")
  const [templateName, setTemplateName] = useState("")
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Bring the matching step into view as soon as a file has been read.
  useEffect(() => {
    if (sheet) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [sheet])

  function reset() {
    setSheet(null)
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

  async function onFile(file: File | null) {
    if (!file) return
    setFileName(file.name)
    setReading(true)
    const body = new FormData()
    body.set("file", file)
    const result = await previewCargoFile(body)
    setReading(false)
    if ("error" in result) {
      toast.error(result.error)
      reset()
      return
    }
    setSheet(result.sheet)
    setColumns(suggestMapping(result.sheet.headers))
  }

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
  }

  return (
    <>
      {/* The one file picker. The "Import from Excel" button above the cargo table opens it. */}
      <input
        ref={inputRef}
        id={CARGO_FILE_INPUT_ID}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Excel or CSV file to import"
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
      {reading || sheet ? (
    <section ref={panelRef} className="scroll-mt-20 rounded-md border bg-card p-4" aria-label="Import cargo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Import {fileName ?? "file"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {reading ? "Reading the file…" : "Check that each column matches the right field and the units are right, then import."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={reading || importing}>
            Choose another file
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={importing}>
            Cancel
          </Button>
        </div>
      </div>

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

/** Id of the hidden file input; the cargo table's "Import from Excel" button clicks it. */
export const CARGO_FILE_INPUT_ID = "cargo-file"

export function openCargoFilePicker() {
  document.getElementById(CARGO_FILE_INPUT_ID)?.click()
}
