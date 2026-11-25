import * as XLSX from "xlsx"
import { missingRequiredFields, suggestMapping, MAX_IMPORT_ROWS, type CargoImportField, type TabularSheet } from "@/lib/cargo-import"

/**
 * Reads a customer's spreadsheet or CSV safely and finds the cargo tables in it. Server only.
 *
 * Spreadsheets are untrusted input. Nothing in a file is run: formulas are not read or evaluated
 * (only the values the file already holds), macros and external links are refused, and size,
 * sheet, row and column limits apply before and after parsing. The `xlsx` package is an old release
 * with published weaknesses in its parser, so the limits and the zip check below keep a hostile file
 * from reaching it. See docs/ASSUMPTIONS.md, "Packing-list import".
 */

export const SHEET_LIMITS = {
  /** Largest spreadsheet or CSV file accepted. */
  maxBytes: 5 * 1024 * 1024,
  maxSheets: 25,
  /** Most rows read from one sheet. Longer sheets are refused, never cut short. */
  maxRows: MAX_IMPORT_ROWS + 200,
  maxColumns: 120,
  /** Inside an .xlsx (a zip file): entries, total unpacked size and the squeeze ratio. */
  maxZipEntries: 400,
  maxUnpackedBytes: 80 * 1024 * 1024,
  maxZipRatio: 150,
  /** Most rows and characters sent to the AI reader for one sheet. */
  maxAiRows: 400,
  maxAiChars: 60_000,
} as const

export class SheetError extends Error {}

export type SheetTable = TabularSheet & {
  /** Spreadsheet row number of the header row. */
  headerRow: number
  /** True when the columns needed to import (name or mark, size, weight) were all recognised. */
  confident: boolean
}

export type SheetPreviewRow = { rowNumber: number; cells: string[] }

export type SheetInfo = {
  name: string
  /** Rows that hold something. */
  rowCount: number
  tables: SheetTable[]
  /** The top of the sheet exactly as it is, for the review panel. */
  preview: SheetPreviewRow[]
}

export type WorkbookInfo = { sheets: SheetInfo[] }

const PREVIEW_ROWS = 60
const PREVIEW_COLUMNS = 14
const FORBIDDEN_NAMES = new Set(["__proto__", "constructor", "prototype"])

// ---- the zip a .xlsx is ------------------------------------------------------------------------

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8)
}
function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24)) >>> 0
}

const isZip = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5)

/** Looks inside the zip's directory, without unpacking anything, and refuses compression bombs and macro files. */
export function inspectZip(bytes: Uint8Array): void {
  let eocd = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) {
    if (u32(bytes, at) === 0x06054b50) {
      eocd = at
      break
    }
  }
  if (eocd < 0) throw new SheetError("That file is not a valid Excel workbook.")
  const entries = u16(bytes, eocd + 10)
  const directoryAt = u32(bytes, eocd + 16)
  if (entries === 0xffff || directoryAt === 0xffffffff) throw new SheetError("That workbook is too large to import.")
  if (entries > SHEET_LIMITS.maxZipEntries) throw new SheetError("That workbook has too many parts to import safely.")

  let at = directoryAt
  let packed = 0
  let unpacked = 0
  for (let index = 0; index < entries; index++) {
    if (u32(bytes, at) !== 0x02014b50) throw new SheetError("That file is not a valid Excel workbook.")
    packed += u32(bytes, at + 20)
    unpacked += u32(bytes, at + 24)
    const nameLength = u16(bytes, at + 28)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)).toLowerCase()
    if (name.endsWith("vbaproject.bin") || name.startsWith("xl/macrosheets/")) {
      throw new SheetError("Workbooks with macros are not accepted. Save a copy as a normal .xlsx without macros.")
    }
    at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32)
  }
  if (unpacked > SHEET_LIMITS.maxUnpackedBytes || (unpacked > 4 * 1024 * 1024 && unpacked > packed * SHEET_LIMITS.maxZipRatio)) {
    throw new SheetError("That workbook is far larger than it looks once opened, so it was not read.")
  }
}

// ---- reading -----------------------------------------------------------------------------------

function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes)
  return new TextDecoder("utf-8").decode(bytes)
}

function openWorkbook(bytes: Uint8Array, fileName: string): XLSX.WorkBook {
  if (bytes.length === 0) throw new SheetError("That file is empty.")
  if (bytes.length > SHEET_LIMITS.maxBytes) throw new SheetError(`That file is over ${SHEET_LIMITS.maxBytes / 1024 / 1024} MB. Split the packing list or remove unused sheets.`)
  const options: XLSX.ParsingOptions = {
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    cellDates: false,
    sheetStubs: false,
    bookVBA: false,
    bookProps: false,
    sheetRows: SHEET_LIMITS.maxRows + 1,
  }
  const lower = fileName.toLowerCase()
  try {
    if (lower.endsWith(".csv")) {
      if (bytes.subarray(0, 4096).includes(0)) throw new SheetError("That does not look like a CSV text file.")
      return XLSX.read(decodeCsv(bytes), { ...options, type: "string", raw: true })
    }
    if (!isZip(bytes)) throw new SheetError("That is not an .xlsx workbook. Save it as .xlsx or .csv and try again.")
    inspectZip(bytes)
    return XLSX.read(bytes, { ...options, type: "array" })
  } catch (error) {
    if (error instanceof SheetError) throw error
    throw new SheetError("The spreadsheet could not be read. Check that it is a normal .xlsx or .csv file.")
  }
}

const own = <T extends object>(target: T, key: string): boolean => Object.prototype.hasOwnProperty.call(target, key)

/** The cell text of a sheet as rows of strings, with merged cells filled in, together with the first row number and column. */
export function sheetGrid(sheet: XLSX.WorkSheet): { rows: string[][]; firstRow: number; firstColumn: number } {
  const ref = (sheet as { "!fullref"?: string })["!fullref"] ?? sheet["!ref"]
  if (!ref) return { rows: [], firstRow: 1, firstColumn: 0 }
  const range = XLSX.utils.decode_range(ref)
  const rowCount = range.e.r - range.s.r + 1
  const columnCount = range.e.c - range.s.c + 1
  if (rowCount > SHEET_LIMITS.maxRows) {
    throw new SheetError(`A sheet has more than ${SHEET_LIMITS.maxRows} rows. Split the packing list; nothing was cut off silently.`)
  }
  if (columnCount > SHEET_LIMITS.maxColumns) throw new SheetError(`A sheet has more than ${SHEET_LIMITS.maxColumns} columns.`)

  const rows: string[][] = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""))
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < columnCount; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c })]
      if (!cell || cell.t === "e") continue
      const text = cell.w ?? (cell.v === undefined || cell.v === null ? "" : String(cell.v))
      rows[r]![c] = text.trim()
    }
  }
  // A merged block keeps its text in the top-left cell only; repeat it across the block (up to a sensible size).
  for (const merge of sheet["!merges"] ?? []) {
    const top = merge.s.r - range.s.r
    const left = merge.s.c - range.s.c
    const text = rows[top]?.[left]
    if (!text || (merge.e.r - merge.s.r + 1) * (merge.e.c - merge.s.c + 1) > 10_000) continue
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        const row = rows[r - range.s.r]
        if (row && c - range.s.c < columnCount && row[c - range.s.c] === "") row[c - range.s.c] = text
      }
    }
  }
  return { rows, firstRow: range.s.r + 1, firstColumn: range.s.c }
}

// ---- finding the tables ------------------------------------------------------------------------

const HEADER_GROUPS = {
  describes: new Set<CargoImportField>(["name", "sku"]),
  sizes: new Set<CargoImportField>(["length", "width", "height", "dimensions"]),
  weights: new Set<CargoImportField>(["weight", "lineWeight"]),
}

/** A row is a header row when it names a description or mark, a size and a weight (or at least three known fields with those). */
function recognisedFields(cells: string[]): Set<CargoImportField> {
  const text = cells.filter((cell) => cell !== "")
  if (text.length < 3) return new Set()
  return new Set(Object.values(suggestMapping(text)))
}

function isHeaderRow(cells: string[]): boolean {
  const fields = recognisedFields(cells)
  if (fields.size < 3) return false
  const has = (group: Set<CargoImportField>) => [...fields].some((field) => group.has(field))
  return has(HEADER_GROUPS.describes) && (has(HEADER_GROUPS.sizes) || has(HEADER_GROUPS.weights))
}

function uniqueHeaders(cells: string[]): string[] {
  const seen = new Map<string, number>()
  return cells.map((cell, index) => {
    const text = cell || `Column ${index + 1}`
    const count = seen.get(text) ?? 0
    seen.set(text, count + 1)
    return count === 0 ? text : `${text} (${count + 1})`
  })
}

function tableFrom(rows: string[][], headerIndex: number, endIndex: number, firstRow: number, firstColumn: number, sheetName: string): SheetTable {
  const headerCells = rows[headerIndex]!
  const first = headerCells.findIndex((cell) => cell !== "")
  let last = headerCells.length - 1
  while (last > first && headerCells[last] === "") last--
  const headers = uniqueHeaders(headerCells.slice(first, last + 1))
  const body: string[][] = []
  const rowNumbers: number[] = []
  for (let index = headerIndex + 1; index < endIndex; index++) {
    const cells = rows[index]!.slice(first, last + 1)
    if (cells.every((cell) => cell === "")) continue
    body.push(cells)
    rowNumbers.push(firstRow + index)
  }
  if (body.length > MAX_IMPORT_ROWS) throw new SheetError(`Import is limited to ${MAX_IMPORT_ROWS} cargo rows per table.`)
  const confident = missingRequiredFields(suggestMapping(headers)).length === 0
  return { headers, rows: body, sheetName, rowNumbers, headerRow: firstRow + headerIndex, firstColumn: firstColumn + first, confident }
}

/** The cargo tables on a sheet: every header row found starts one that runs to the next header row or the end. */
export function findTables(rows: string[][], firstRow: number, firstColumn: number, sheetName: string): SheetTable[] {
  const headerRows: number[] = []
  rows.forEach((cells, index) => {
    if (isHeaderRow(cells)) headerRows.push(index)
  })
  if (headerRows.length === 0) {
    // Nothing recognisable: offer the first filled row as the header, as a plain list would have one.
    const index = rows.findIndex((cells) => cells.some((cell) => cell !== ""))
    return index < 0 ? [] : [tableFrom(rows, index, rows.length, firstRow, firstColumn, sheetName)]
  }
  return headerRows.map((headerIndex, position) => tableFrom(rows, headerIndex, headerRows[position + 1] ?? rows.length, firstRow, firstColumn, sheetName))
}

export function readWorkbook(bytes: Uint8Array, fileName: string): WorkbookInfo {
  const workbook = openWorkbook(bytes, fileName)
  if (workbook.SheetNames.length === 0) throw new SheetError("The file has no sheets.")
  if (workbook.SheetNames.length > SHEET_LIMITS.maxSheets) throw new SheetError(`The workbook has more than ${SHEET_LIMITS.maxSheets} sheets.`)
  const sheets: SheetInfo[] = []
  for (const name of workbook.SheetNames) {
    if (FORBIDDEN_NAMES.has(name) || !own(workbook.Sheets, name)) continue
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const { rows, firstRow, firstColumn } = sheetGrid(sheet)
    const filled = rows.filter((cells) => cells.some((cell) => cell !== ""))
    if (filled.length === 0) continue
    sheets.push({
      name,
      rowCount: filled.length,
      tables: findTables(rows, firstRow, firstColumn, name),
      preview: rows.slice(0, PREVIEW_ROWS).map((cells, index) => ({ rowNumber: firstRow + index, cells: cells.slice(0, PREVIEW_COLUMNS) })),
    })
  }
  if (sheets.length === 0) throw new SheetError("The file has no data.")
  return { sheets }
}

// ---- text for the AI reader --------------------------------------------------------------------

export type SheetText = { ok: true; text: string; rows: number } | { ok: false; error: string }

/**
 * One sheet written out as plain text for Claude, with the sheet name and each row's number and cell
 * references kept so a reading can point back to the source. Only values are included: no formulas,
 * links or macros. A sheet too long to send whole is refused rather than cut short.
 */
export function sheetToText(bytes: Uint8Array, fileName: string, sheetName: string): SheetText {
  const workbook = openWorkbook(bytes, fileName)
  if (FORBIDDEN_NAMES.has(sheetName) || !own(workbook.Sheets, sheetName)) return { ok: false, error: "That sheet is not in the file." }
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return { ok: false, error: "That sheet is not in the file." }
  const { rows, firstRow, firstColumn } = sheetGrid(sheet)
  const lines: string[] = []
  let used = 0
  rows.forEach((cells, index) => {
    const parts = cells.map((cell, column) => (cell === "" ? "" : `${XLSX.utils.encode_col(firstColumn + column)}${firstRow + index}: ${cell}`)).filter(Boolean)
    if (parts.length === 0) return
    used += 1
    lines.push(`Row ${firstRow + index} | ${parts.join(" | ")}`)
  })
  const text = `Sheet "${sheetName}"\n${lines.join("\n")}`
  if (used > SHEET_LIMITS.maxAiRows || text.length > SHEET_LIMITS.maxAiChars) {
    return { ok: false, error: `This sheet has ${used} rows, more than the ${SHEET_LIMITS.maxAiRows} that can be read by Claude in one go. Use the column import, or split the sheet.` }
  }
  return { ok: true, text, rows: used }
}
