import * as XLSX from "xlsx"
import { MAX_IMPORT_ROWS, type TabularSheet } from "@/lib/cargo-import"

export function readTabularFile(data: Uint8Array): TabularSheet {
  const workbook = XLSX.read(data, { type: "array" })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error("The file has no sheets.")
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error("The first sheet is empty.")

  const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  })
  const headerRow = table[0]
  if (!headerRow || headerRow.every((cell) => cellToString(cell) === "")) {
    throw new Error("The file has no header row.")
  }

  const seen = new Map<string, number>()
  const headers = headerRow.map((cell, index) => {
    const text = cellToString(cell) || `Column ${index + 1}`
    const count = seen.get(text) ?? 0
    seen.set(text, count + 1)
    return count === 0 ? text : `${text} (${count + 1})`
  })

  const rows = table
    .slice(1)
    .map((row) => headers.map((_, index) => cellToString(row?.[index])))
    .filter((row) => row.some((cell) => cell !== ""))

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import is limited to ${MAX_IMPORT_ROWS} cargo rows.`)
  }

  return { headers, rows }
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}
