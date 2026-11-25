import type { CargoItemInput } from "@compass/domain"
import {
  importMappingSchema,
  missingRequiredFields,
  readOptionalFields,
  type CargoImportField,
  type ImportIssue,
  type ImportMapping,
  type ImportPreview,
  type TabularSheet,
} from "@/lib/cargo-import"
import { blankLine, evaluateLine, isImportable, type DocumentTotals, type ReviewLine } from "@/lib/import-review"
import { parseWeight, readNumber, splitCombinedSize } from "@/lib/import-units"

/**
 * From a spreadsheet table and the planner's column mapping to review lines. The mapping step is the
 * deterministic part of the import and needs no AI. Cells are carried through as text, so a size or
 * weight that cannot be read becomes a flagged line in the review table instead of stopping the import.
 */

export type SkippedRow = { rowNumber: number; text: string }

// "Total", "Sub total", "Grand total" and the same words in other languages.
const TOTAL_WORDS =
  /^\s*(?:grand\s+|sub[\s-]?|page\s+|net\s+|gross\s+)?totals?\b|^\s*sum\b|^\s*subtotal\b|^\s*gesamt|^\s*summe\b|^\s*total\s+g[ée]n[ée]ral|^\s*totaux\b|^\s*totales?\b|^\s*总计|^\s*合计|^\s*小计|^\s*المجموع|^\s*الإجمالي|^\s*الاجمالي/i

/** Rows that add up the rows above them are not cargo. */
export function isTotalText(text: string): boolean {
  return TOTAL_WORDS.test(text)
}

function columnLetter(index: number): string {
  let n = index
  let letters = ""
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return letters
}

export type TableLines = {
  lines: ReviewLine[]
  /** Total and subtotal rows left out of the lines, so they are not imported as cargo. */
  skipped: SkippedRow[]
  /** The pieces and weight a total row states, when there is one and it can be read. */
  documentTotals: DocumentTotals | null
}

export function tableToReviewLines(sheet: TabularSheet, mapping: ImportMapping): TableLines {
  const columnIndex = new Map<CargoImportField, number>()
  sheet.headers.forEach((header, index) => {
    const field = mapping.columns[header]
    if (field && !columnIndex.has(field)) columnIndex.set(field, index)
  })
  const weightHeader = sheet.headers[columnIndex.get("weight") ?? -1] ?? ""
  const netWeight = /\bnet\b/i.test(weightHeader) && !/gross/i.test(weightHeader)

  const lines: ReviewLine[] = []
  const skipped: SkippedRow[] = []
  const stated: { pieces: number[]; kg: number[] } = { pieces: [], kg: [] }

  sheet.rows.forEach((row, index) => {
    if (row.every((cell) => cell.trim() === "")) return
    const rowNumber = sheet.rowNumbers?.[index] ?? index + 2
    const cell = (field: CargoImportField) => {
      const position = columnIndex.get(field)
      return position === undefined ? "" : (row[position] ?? "")
    }

    // Total rows: a total word in the first filled cell or the description, or numbers with no description or size at all.
    const firstFilled = row.find((entry) => entry.trim() !== "") ?? ""
    const hasDescription = (cell("name") || cell("sku")).trim() !== ""
    const hasSize = [cell("length"), cell("width"), cell("height"), cell("dimensions")].some((entry) => entry.trim() !== "")
    const numbersOnly = !hasDescription && !hasSize && (cell("quantity").trim() !== "" || cell("weight").trim() !== "" || cell("lineWeight").trim() !== "")
    if (isTotalText(cell("name")) || isTotalText(cell("sku")) || isTotalText(firstFilled) || numbersOnly) {
      skipped.push({ rowNumber, text: row.filter((entry) => entry.trim() !== "").join(" | ") })
      const pieces = readNumber(cell("quantity"))
      if (pieces && Number.isInteger(pieces.value)) stated.pieces.push(pieces.value)
      const weight = parseWeight(cell("lineWeight") || cell("weight"), mapping.weightUnit)
      if (weight.ok) stated.kg.push(weight.kg)
      return
    }

    const issues: ImportIssue[] = []
    const optional = readOptionalFields(cell, rowNumber, mapping.weightUnit, issues)
    const line: ReviewLine = {
      ...blankLine(`row-${rowNumber}-${lines.length}`),
      sku: cell("sku").trim(),
      name: cell("name").trim(),
      sizeUnit: mapping.lengthUnit,
      weightUnit: mapping.weightUnit,
      weightKind: netWeight ? "net" : "unspecified",
      // Numbers in spreadsheet cells follow the English convention the importer has always used
      // (dot decimal, comma thousands), so they are not flagged as ambiguous the way free text is.
      confirmed: ["numbers"],
      // A blank quantity, or no quantity column, means one piece, as the importer has always read it.
      quantity: cell("quantity").trim() || "1",
      consignment: cell("consignmentId").trim(),
      hazard: cell("segregationClass").trim(),
      destination: cell("destinationStop").trim(),
      source: {
        ...(sheet.sheetName ? { sheet: sheet.sheetName } : {}),
        row: rowNumber,
        cells: rowRange(row, rowNumber, columnIndex, sheet),
      },
      rowIssues: issues.map(({ field, message }) => ({ field, message })),
    }

    // Sizes: separate columns, or one column written like 120 x 80 x 60 cm.
    line.length = cell("length").trim()
    line.width = cell("width").trim()
    line.height = cell("height").trim()
    const combined = cell("dimensions").trim()
    if (combined && !line.length && !line.width && !line.height) {
      const split = splitCombinedSize(combined)
      if (split) {
        ;[line.length, line.width, line.height] = split.parts
        // A unit written once in the cell overrides the mapping's unit for this line only.
        if (split.unit) line.sizeUnit = split.unit
      } else {
        line.checks = [...line.checks, `The size “${combined}” could not be split into length, width and height.`]
      }
    }

    // Weight: per piece when there is such a column, otherwise the line total (confirmed in review before it is divided).
    const perPiece = cell("weight").trim()
    const lineTotal = cell("lineWeight").trim()
    if (perPiece) {
      line.weight = perPiece
      line.weightScope = "piece"
    } else if (lineTotal) {
      line.weight = lineTotal
      line.weightScope = "line"
    }
    if (perPiece && lineTotal) {
      const each = parseWeight(perPiece, mapping.weightUnit)
      const whole = parseWeight(lineTotal, mapping.weightUnit)
      const count = readNumber(line.quantity)
      if (each.ok && whole.ok && count && Math.abs(each.kg * count.value - whole.kg) > Math.max(0.5, whole.kg * 0.01)) {
        line.checks = [...line.checks, `Quantity × weight per piece is ${Math.round(each.kg * count.value * 100) / 100} kg, but the line total says ${whole.kg} kg.`]
      }
    }

    if (optional) {
      line.shape = optional.shape
      line.stackable = optional.stackable
      line.floorOnly = optional.bottomOnly
      line.orientation = optional.orientation
      line.destination = line.destination || ""
      line.extras = {
        maxStackLoadKg: optional.maxStackLoadKg,
        maxStackLayers: optional.maxStackLayers,
        priority: optional.priority,
        color: optional.color,
        allowedRotations: optional.allowedRotations,
      }
    }
    lines.push(line)
  })

  const documentTotals =
    stated.pieces.length > 0 || stated.kg.length > 0
      ? // Several total rows (page subtotals, then a grand total): the largest figure is the whole document's.
        { pieces: stated.pieces.length ? Math.max(...stated.pieces) : null, weightKg: stated.kg.length ? Math.max(...stated.kg) : null }
      : null
  return { lines, skipped, documentTotals }
}

function rowRange(row: string[], rowNumber: number, columnIndex: Map<CargoImportField, number>, sheet: TabularSheet): string {
  const filled = row.map((entry, index) => (entry.trim() !== "" ? index : -1)).filter((index) => index >= 0)
  const first = (sheet.firstColumn ?? 0) + (filled[0] ?? 0)
  const last = (sheet.firstColumn ?? 0) + (filled[filled.length - 1] ?? columnIndex.size)
  return `${columnLetter(first)}${rowNumber}:${columnLetter(last)}${rowNumber}`
}

/**
 * The strict, all-or-nothing reading of a table: the lines that are complete and clear become cargo
 * lines, and everything else is reported as an issue against its row. The import dialog uses
 * `tableToReviewLines` so the planner can fix what is flagged; this is for callers that only want to
 * know what would import untouched.
 */
export function buildImportPreview(sheet: TabularSheet, mapping: ImportMapping): ImportPreview {
  const parsedMapping = importMappingSchema.parse(mapping)
  const missing = missingRequiredFields(parsedMapping.columns)
  if (missing.length > 0) {
    return {
      drafts: [],
      issues: [{ rowNumber: 1, field: missing.join(", "), message: `Map these columns before import: ${missing.join(", ")}.` }],
    }
  }
  const drafts: CargoItemInput[] = []
  const issues: ImportIssue[] = []
  for (const line of tableToReviewLines(sheet, parsedMapping).lines) {
    const evaluation = evaluateLine(line)
    if (isImportable(evaluation) && evaluation.input) {
      drafts.push(evaluation.input)
      continue
    }
    for (const issue of evaluation.issues) issues.push({ rowNumber: line.source.row ?? 0, field: issue.field, message: issue.message })
  }
  return { drafts, issues }
}
