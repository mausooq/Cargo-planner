import {
  AXIS_ROTATIONS,
  type CargoItemInput,
  type CargoShape,
  type Orientation,
} from "@compass/domain"
import { z } from "zod"
import { IMPORT_WEIGHT_UNITS, KG_PER_WEIGHT_UNIT } from "@/lib/import-units"
import { fromDisplayLength, LENGTH_UNITS, lengthUnitFromWord, roundStoredCm, type LengthUnit } from "@/lib/cargo-units"

// Length units and conversion live in cargo-units.ts, shared with the Cargo grid and the exports.
export { LENGTH_UNITS }
export type { LengthUnit }
export const WEIGHT_UNITS = IMPORT_WEIGHT_UNITS
export const lengthUnitSchema = z.enum(LENGTH_UNITS)
export const weightUnitSchema = z.enum(WEIGHT_UNITS)
export type WeightUnit = z.infer<typeof weightUnitSchema>

export const CARGO_IMPORT_FIELDS = [
  "sku",
  "name",
  "length",
  "width",
  "height",
  "dimensions",
  "weight",
  "lineWeight",
  "netWeight",
  "quantity",
  "shape",
  "orientation",
  "stackable",
  "notStackable",
  "bottomOnly",
  "maxStackLoadKg",
  "maxStackLayers",
  "priority",
  "destinationStop",
  "consignmentId",
  "segregationClass",
  "color",
] as const

export const cargoImportFieldSchema = z.enum(CARGO_IMPORT_FIELDS)
export type CargoImportField = z.infer<typeof cargoImportFieldSchema>

export const REQUIRED_IMPORT_FIELDS: CargoImportField[] = ["name", "length", "width", "height", "weight"]

export const importMappingSchema = z.object({
  lengthUnit: lengthUnitSchema,
  weightUnit: weightUnitSchema,
  columns: z.record(z.string(), cargoImportFieldSchema),
})
export type ImportMapping = z.infer<typeof importMappingSchema>

export const CARGO_TEMPLATE_HEADERS = [
  "SKU",
  "Name",
  "Length",
  "Width",
  "Height",
  "Weight",
  "Quantity",
  "Shape",
  "Orientation",
  "Stackable",
  "Not stackable",
  "Bottom only",
  "Max stack load",
  "Max stack layers",
  "Priority",
  "Destination stop",
  "Consignment",
  "Segregation class",
  "Color",
] as const

export const CARGO_TEMPLATE_SAMPLE = [
  "BOX-1",
  "Sample carton",
  "120",
  "80",
  "60",
  "18",
  "1",
  "BOX",
  "ROTATE_90",
  "yes",
  "no",
  "no",
  "",
  "",
  "0",
  "1",
  "CONS-1",
  "",
  "#c4622d",
] as const

export const CARGO_TEMPLATE_ROWS = [
  [...CARGO_TEMPLATE_SAMPLE],
  ["DRM-1", "Sample drum", "58", "58", "88", "25", "1", "DRUM", "FIXED", "yes", "no", "yes", "", "", "0", "1", "CONS-2", "", ""],
  ["PIPE-1", "Sample pipe", "300", "20", "20", "15", "1", "PIPE", "ROTATE_90", "yes", "no", "no", "", "", "0", "1", "CONS-3", "", ""],
] as const

export const MAX_IMPORT_ROWS = 5000

const FIELD_ALIASES: Record<string, CargoImportField> = {
  sku: "sku",
  "sku code": "sku",
  "item code": "sku",
  "product code": "sku",
  article: "sku",
  name: "name",
  item: "name",
  description: "name",
  "item name": "name",
  length: "length",
  l: "length",
  len: "length",
  "length cm": "length",
  "length mm": "length",
  width: "width",
  w: "width",
  "width cm": "width",
  height: "height",
  h: "height",
  "height cm": "height",
  weight: "weight",
  wt: "weight",
  mass: "weight",
  kg: "weight",
  "weight kg": "weight",
  quantity: "quantity",
  qty: "quantity",
  count: "quantity",
  shape: "shape",
  type: "shape",
  orientation: "orientation",
  rotation: "orientation",
  stackable: "stackable",
  stack: "stackable",
  "not stackable": "notStackable",
  notstackable: "notStackable",
  "bottom only": "bottomOnly",
  bottomonly: "bottomOnly",
  "bottom-only": "bottomOnly",
  "max stack load": "maxStackLoadKg",
  "max stack load kg": "maxStackLoadKg",
  "stack load": "maxStackLoadKg",
  "max stack layers": "maxStackLayers",
  layers: "maxStackLayers",
  priority: "priority",
  "destination stop": "destinationStop",
  stop: "destinationStop",
  destination: "destinationStop",
  consignment: "consignmentId",
  "consignment id": "consignmentId",
  shipment: "consignmentId",
  "segregation class": "segregationClass",
  class: "segregationClass",
  segregation: "segregationClass",
  color: "color",
  colour: "color",
  // Customer packing lists: other titles, and other languages.
  dimensions: "dimensions",
  dimension: "dimensions",
  dims: "dimensions",
  size: "dimensions",
  measurement: "dimensions",
  measurements: "dimensions",
  "size cm": "dimensions",
  "dimensions cm": "dimensions",
  "l x w x h": "dimensions",
  "lxwxh": "dimensions",
  "l*w*h": "dimensions",
  "l×w×h": "dimensions",
  abmessungen: "dimensions",
  dimensiones: "dimensions",
  tamaño: "dimensions",
  尺寸: "dimensions",
  الأبعاد: "dimensions",
  المقاس: "dimensions",
  "gross weight": "weight",
  "gross wt": "weight",
  "g w": "weight",
  "gw": "weight",
  "unit weight": "weight",
  "weight per piece": "weight",
  "weight each": "weight",
  "weight per package": "weight",
  "weight per pkg": "weight",
  "gross weight per package": "weight",
  "gross weight per piece": "weight",
  "gross weight per unit": "weight",
  "gross weight each": "weight",
  "gross weight per pc": "weight",
  "weight per unit": "weight",
  "poids brut": "weight",
  poids: "weight",
  gewicht: "weight",
  bruttogewicht: "weight",
  peso: "weight",
  "peso bruto": "weight",
  毛重: "weight",
  重量: "weight",
  الوزن: "weight",
  "net weight": "netWeight",
  "net wt": "netWeight",
  "n w": "netWeight",
  nw: "netWeight",
  "poids net": "netWeight",
  nettogewicht: "netWeight",
  "peso neto": "netWeight",
  净重: "netWeight",
  "total weight": "lineWeight",
  "line weight": "lineWeight",
  "total gross weight": "lineWeight",
  "total gw": "lineWeight",
  "poids total": "lineWeight",
  gesamtgewicht: "lineWeight",
  "peso total": "lineWeight",
  总重: "lineWeight",
  "الوزن الإجمالي": "lineWeight",
  pcs: "quantity",
  pieces: "quantity",
  packages: "quantity",
  "no of packages": "quantity",
  "no of pcs": "quantity",
  quantité: "quantity",
  menge: "quantity",
  anzahl: "quantity",
  cantidad: "quantity",
  数量: "quantity",
  الكمية: "quantity",
  "goods description": "name",
  "description of goods": "name",
  "cargo description": "name",
  "commodity": "name",
  désignation: "name",
  bezeichnung: "name",
  descripción: "name",
  品名: "name",
  货物名称: "name",
  البيان: "name",
  "package no": "sku",
  "package number": "sku",
  "package id": "sku",
  "case no": "sku",
  "marks": "sku",
  "marks and numbers": "sku",
  reference: "sku",
  ref: "sku",
  "part no": "sku",
  "part number": "sku",
  "item no": "sku",
}

export type TabularSheet = {
  headers: string[]
  rows: string[][]
  /** The worksheet the table was read from, when the file has several. */
  sheetName?: string
  /** The spreadsheet row number of each entry in `rows` (header row 5 means the first entry is row 6). */
  rowNumbers?: number[]
  /** Zero-based spreadsheet column of the first header (3 means the table starts in column D). */
  firstColumn?: number
}

export type ImportIssue = {
  rowNumber: number
  field: string
  message: string
}

export type ImportPreview = {
  drafts: CargoItemInput[]
  issues: ImportIssue[]
}

export function toCentimetres(value: number, unit: LengthUnit): number {
  return roundStoredCm(fromDisplayLength(value, unit))
}

export function toKilograms(value: number, unit: WeightUnit): number {
  return round4(value * KG_PER_WEIGHT_UNIT[unit])
}

export function suggestMapping(headers: string[]): Record<string, CargoImportField> {
  const used = new Set<CargoImportField>()
  const columns: Record<string, CargoImportField> = {}
  for (const header of headers) {
    const alias = aliasFor(header) ?? readDimensionHeader(header)?.field
    if (!alias || used.has(alias)) continue
    used.add(alias)
    columns[header] = alias
  }
  return columns
}

/**
 * The field a column title stands for. Full stops are ignored ("Item no."), and a weight unit
 * written after the words ("Gross weight kg", "Total weight (lb)") is read as the unit, not part of the name.
 */
function aliasFor(header: string): CargoImportField | undefined {
  const title = normalizeHeader(header).replace(/\./g, "").replace(/\s+/g, " ").trim()
  const direct = FIELD_ALIASES[title]
  if (direct) return direct
  const withoutUnit = title.replace(/\s+(?:kg|kgs|g|lb|lbs|t|mt|tonnes?)$/, "")
  return withoutUnit !== title ? FIELD_ALIASES[withoutUnit] : undefined
}

type DimensionField = "length" | "width" | "height"

const DIMENSION_HEADER = /^(length|len|l|width|w|height|h)(?: (mm|millimet(?:re|er)s?|cm|centimet(?:re|er)s?|m|met(?:re|er)s?|in|inch|inches|ft|feet|foot))?$/
const DIMENSION_OF: Record<string, DimensionField> = { length: "length", len: "length", l: "length", width: "width", w: "width", height: "height", h: "height" }

/** A size column title such as "Length (mm)", "W ft" or "Height - inches": which size it is and the unit it names, if it names one. */
export function readDimensionHeader(header: string): { field: DimensionField; unit: LengthUnit | null } | null {
  const match = DIMENSION_HEADER.exec(normalizeHeader(header).replace(/[-–:]/g, " ").replace(/\s+/g, " ").trim())
  if (!match) return null
  const field = DIMENSION_OF[match[1]!]
  if (!field) return null
  return { field, unit: match[2] ? lengthUnitFromWord(match[2]) : null }
}

/**
 * The unit the size columns say they are in. Only a unit written in the titles counts: when none
 * says one nothing is assumed (the planner chooses), and when they disagree nothing is chosen for them.
 */
export function suggestLengthUnit(
  headers: string[],
  columns: Record<string, CargoImportField>,
): { unit: LengthUnit | null; source: "titles" | "none" | "conflict" } {
  const found = new Set<LengthUnit>()
  for (const header of headers) {
    const field = columns[header]
    if (field !== "length" && field !== "width" && field !== "height") continue
    const unit = readDimensionHeader(header)?.unit
    if (unit) found.add(unit)
  }
  if (found.size === 0) return { unit: null, source: "none" }
  if (found.size > 1) return { unit: null, source: "conflict" }
  return { unit: [...found][0]!, source: "titles" }
}

export function missingRequiredFields(columns: Record<string, CargoImportField>): CargoImportField[] {
  const chosen = new Set(Object.values(columns))
  // One combined size column stands in for length, width and height; a line total can stand in for a per-piece weight.
  const hasDimensions = chosen.has("dimensions")
  return REQUIRED_IMPORT_FIELDS.filter((field) => {
    if (chosen.has(field)) return false
    if ((field === "length" || field === "width" || field === "height") && hasDimensions) return false
    if (field === "weight" && chosen.has("lineWeight")) return false
    return true
  })
}

export type OptionalFields = {
  quantity: string
  shape: CargoShape
  orientation: Orientation
  stackable: boolean
  bottomOnly: boolean
  maxStackLoadKg: number | null
  maxStackLayers: number | null
  priority: number
  destinationStop: number
  consignmentId: string | null
  segregationClass: string | null
  color: string | null
  allowedRotations: CargoItemInput["allowedRotations"]
}

/**
 * The columns beyond name, size, weight and quantity, read the way the importer always has: blank
 * cells take the planner's defaults, and anything unreadable is reported against the row.
 */
export function readOptionalFields(
  cell: (field: CargoImportField) => string,
  rowNumber: number,
  weightUnit: WeightUnit,
  issues: ImportIssue[],
): OptionalFields | null {
  const before = issues.length
  const priority = optionalInt(cell("priority"), rowNumber, "priority", issues, 0)
  const destinationStop = optionalInt(cell("destinationStop"), rowNumber, "destinationStop", issues, 1)
  const maxStackLoad = optionalNumber(cell("maxStackLoadKg"), rowNumber, "maxStackLoadKg", issues)
  const maxStackLayers = optionalIntOrNull(cell("maxStackLayers"), rowNumber, "maxStackLayers", issues)
  const shape = parseShape(cell("shape"), rowNumber, issues)
  const orientation = parseOrientation(cell("orientation"), rowNumber, issues)
  const stackable = parseStackFlag(cell("stackable"), cell("notStackable"), rowNumber, issues)
  const bottomOnly = parseBottomOnly(cell("bottomOnly"), rowNumber, issues)
  if (
    issues.length !== before ||
    priority === null ||
    destinationStop === null ||
    shape === null ||
    orientation === null ||
    stackable === null ||
    bottomOnly === null
  ) {
    return null
  }
  return {
    quantity: cell("quantity"),
    shape,
    orientation,
    stackable,
    bottomOnly,
    maxStackLoadKg: maxStackLoad === null ? null : toKilograms(maxStackLoad, weightUnit),
    maxStackLayers,
    priority,
    destinationStop,
    consignmentId: emptyToNull(cell("consignmentId")),
    segregationClass: emptyToNull(cell("segregationClass")),
    color: emptyToNull(cell("color")),
    allowedRotations: orientation === "CUSTOM" ? [...AXIS_ROTATIONS] : null,
  }
}

function optionalNumber(raw: string, rowNumber: number, field: string, issues: ImportIssue[]): number | null {
  if (raw.trim() === "") return null
  const parsed = parseNumber(raw)
  if (parsed === null || parsed < 0) {
    issues.push({ rowNumber, field, message: "Enter a number, or leave the cell blank." })
    return null
  }
  return parsed
}

function optionalInt(
  raw: string,
  rowNumber: number,
  field: string,
  issues: ImportIssue[],
  fallback: number,
): number | null {
  if (raw.trim() === "") return fallback
  const parsed = parseNumber(raw)
  if (parsed === null || !Number.isInteger(parsed)) {
    issues.push({ rowNumber, field, message: "Enter a whole number." })
    return null
  }
  return parsed
}

function optionalIntOrNull(raw: string, rowNumber: number, field: string, issues: ImportIssue[]): number | null {
  if (raw.trim() === "") return null
  const parsed = parseNumber(raw)
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    issues.push({ rowNumber, field, message: "Enter a whole number greater than zero, or leave the cell blank." })
    return null
  }
  return parsed
}

function parseShape(raw: string, rowNumber: number, issues: ImportIssue[]): CargoShape | null {
  const value = raw.trim().toLowerCase()
  if (!value || value === "box") return "BOX"
  if (value === "drum" || value === "cylinder" || value === "cylinder_drum") return "CYLINDER_DRUM"
  if (value === "pipe") return "PIPE"
  issues.push({ rowNumber, field: "shape", message: "Use BOX, DRUM, or PIPE." })
  return null
}

function parseOrientation(raw: string, rowNumber: number, issues: ImportIssue[]): Orientation | null {
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (!value || value === "any") return "ANY"
  if (value === "fixed") return "FIXED"
  if (value === "longship") return "LONGSHIP"
  if (value === "rotate_90" || value === "rotate90" || value === "rotate" || value === "rotatable") return "ROTATE_90"
  if (value === "tiltable") return "TILTABLE"
  if (value === "custom") return "CUSTOM"
  issues.push({ rowNumber, field: "orientation", message: "Use ROTATABLE, LONGSHIP, TILTABLE, FIXED, or ANY." })
  return null
}

function parseStackFlag(
  stackableRaw: string,
  notStackableRaw: string,
  rowNumber: number,
  issues: ImportIssue[],
): boolean | null {
  if (notStackableRaw.trim()) {
    const flagged = parseYesNo(notStackableRaw, rowNumber, "notStackable", issues)
    return flagged === null ? null : !flagged
  }
  return parseStackable(stackableRaw, rowNumber, issues)
}

function parseBottomOnly(raw: string, rowNumber: number, issues: ImportIssue[]): boolean | null {
  if (!raw.trim()) return false
  return parseYesNo(raw, rowNumber, "bottomOnly", issues)
}

function parseYesNo(raw: string, rowNumber: number, field: string, issues: ImportIssue[]): boolean | null {
  const value = raw.trim().toLowerCase()
  if (value === "yes" || value === "y" || value === "true" || value === "1") return true
  if (value === "no" || value === "n" || value === "false" || value === "0") return false
  issues.push({ rowNumber, field, message: "Use yes or no." })
  return null
}

function parseStackable(raw: string, rowNumber: number, issues: ImportIssue[]): boolean | null {
  const value = raw.trim().toLowerCase()
  if (!value || value === "yes" || value === "y" || value === "true" || value === "1") return true
  if (value === "no" || value === "n" || value === "false" || value === "0") return false
  issues.push({ rowNumber, field: "stackable", message: "Use yes or no." })
  return null
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "")
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function emptyToNull(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[()[\]]/g, " ")
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
