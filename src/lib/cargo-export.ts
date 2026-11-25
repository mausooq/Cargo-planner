import type { CargoItemInput, CargoShape } from "@compass/domain"
import { LENGTH_UNIT_SYMBOL, toDisplayLength, type LengthUnit } from "@/lib/cargo-units"

/**
 * Column titles for the cargo export. Each one is recognised by the import wizard, so an exported
 * file can be edited in Excel and imported again without mapping columns by hand.
 */
export const CARGO_EXPORT_HEADERS = [
  "SKU",
  "Name",
  "Length (cm)",
  "Width (cm)",
  "Height (cm)",
  "Weight (kg)",
  "Quantity",
  "Shape",
  "Orientation",
  "Stackable",
  "Not stackable",
  "Bottom only",
  "Max stack load (kg)",
  "Max stack layers",
  "Priority",
  "Destination stop",
  "Consignment",
  "Segregation class",
  "Color",
] as const

/** The same titles with the size columns in another unit, written out: "Length (ft)". The importer reads the unit from them. */
export function cargoExportHeaders(unit: LengthUnit = "cm"): string[] {
  const symbol = LENGTH_UNIT_SYMBOL[unit]
  return CARGO_EXPORT_HEADERS.map((header) =>
    header === "Length (cm)" || header === "Width (cm)" || header === "Height (cm)" ? header.replace("(cm)", `(${symbol})`) : header,
  )
}

/** A stored size (cm) in the unit, kept to 12 significant digits so reading it back returns the same stored value. */
function exportLength(cm: number, unit: LengthUnit): number {
  return unit === "cm" ? cm : Number(toDisplayLength(cm, unit).toPrecision(12))
}

export type CargoExportCell = string | number

const SHAPE_LABEL: Record<CargoShape, string> = { BOX: "BOX", CYLINDER_DRUM: "DRUM", PIPE: "PIPE" }

const yesNo = (value: boolean) => (value ? "yes" : "no")

/** One row per cargo line, in the same order as CARGO_EXPORT_HEADERS. Sizes in `unit` (cm unless asked), weights in kg. */
export function cargoExportRows(lines: CargoItemInput[], unit: LengthUnit = "cm"): CargoExportCell[][] {
  return lines.map((line) => [
    line.sku ?? "",
    line.name,
    exportLength(line.lengthCm, unit),
    exportLength(line.widthCm, unit),
    exportLength(line.heightCm, unit),
    line.weightKg,
    line.quantity,
    SHAPE_LABEL[line.shape],
    line.orientation,
    yesNo(line.stackable),
    yesNo(!line.stackable),
    yesNo(line.bottomOnly),
    line.maxStackLoadKg ?? "",
    line.maxStackLayers ?? "",
    line.priority,
    line.destinationStop,
    line.consignmentId ?? "",
    line.segregationClass ?? "",
    line.color ?? "",
  ])
}

export function cargoExportFileName(projectName: string): string {
  const safe = projectName.trim().replace(/[^\p{L}\p{N}\-_ ]+/gu, "").trim().replace(/\s+/g, "-")
  return safe ? `${safe}-cargo.xlsx` : "cargo.xlsx"
}

/** Builds and downloads an .xlsx of the cargo list. */
export async function downloadCargoWorkbook(lines: CargoItemInput[], projectName: string, unit: LengthUnit = "cm"): Promise<void> {
  const XLSX = await import("xlsx")
  const headers = cargoExportHeaders(unit)
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...cargoExportRows(lines, unit)])
  sheet["!cols"] = headers.map((header, index) => ({ wch: index === 1 ? 32 : Math.max(10, header.length + 2) }))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, "Cargo")
  XLSX.writeFile(book, cargoExportFileName(projectName))
}
