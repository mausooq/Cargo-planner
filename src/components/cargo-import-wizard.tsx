"use client"

import { useMemo, useState } from "react"
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

  const mapping = useMemo<ImportMapping>(
    () => ({ lengthUnit, weightUnit, columns }),
    [columns, lengthUnit, weightUnit],
  )
  const preview = useMemo(() => (sheet ? buildImportPreview(sheet, mapping) : null), [mapping, sheet])
  const missing = missingRequiredFields(columns)

  async function onFile(file: File | null) {
    if (!file) return
    setReading(true)
    const body = new FormData()
    body.set("file", file)
    const result = await previewCargoFile(body)
    setReading(false)
    if ("error" in result) {
      toast.error(result.error)
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
    toast.success(`Imported ${result.count} cargo lines.`)
    setSheet(null)
  }

  return (
    <section className="rounded-md border bg-card p-4">
      <h2 className="text-sm font-semibold">Import cargo</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Excel or CSV. Map columns, pick units, then import. Stored values are centimetres and kilograms.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="cargo-file">File</Label>
          <Input
            id="cargo-file"
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
          />
        </div>
        <p className="text-sm text-muted-foreground">{reading ? "Reading file…" : null}</p>
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
              {importing ? "Importing…" : `Import ${preview.drafts.length} rows`}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
