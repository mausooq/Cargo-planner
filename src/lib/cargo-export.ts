import type { CargoItemInput, CargoShape } from "@compass/domain"

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

export type CargoExportCell = string | number

const SHAPE_LABEL: Record<CargoShape, string> = { BOX: "BOX", CYLINDER_DRUM: "DRUM", PIPE: "PIPE" }

const yesNo = (value: boolean) => (value ? "yes" : "no")

/** One row per cargo line, in the same order as CARGO_EXPORT_HEADERS. Sizes in cm, weights in kg. */
export function cargoExportRows(lines: CargoItemInput[]): CargoExportCell[][] {
  return lines.map((line) => [
    line.sku ?? "",
    line.name,
    line.lengthCm,
    line.widthCm,
    line.heightCm,
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
export async function downloadCargoWorkbook(lines: CargoItemInput[], projectName: string): Promise<void> {
  const XLSX = await import("xlsx")
  const sheet = XLSX.utils.aoa_to_sheet([[...CARGO_EXPORT_HEADERS], ...cargoExportRows(lines)])
  sheet["!cols"] = CARGO_EXPORT_HEADERS.map((header, index) => ({ wch: index === 1 ? 32 : Math.max(10, header.length + 2) }))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, "Cargo")
  XLSX.writeFile(book, cargoExportFileName(projectName))
}
