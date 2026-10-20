import { emptyContour } from "@/lib/uld-contour"

export type EquipmentImportRow = {
  row: number
  input: Record<string, unknown>
}

export type EquipmentImportIssue = {
  row: number
  message: string
}

export function parseEquipmentCsv(text: string): { rows: EquipmentImportRow[]; error?: string } {
  const table = parseCsv(text.replace(/^\uFEFF/, ""))
  const header = table[0]
  if (!header || header.every((cell) => cell.trim() === "")) return { rows: [], error: "The file has no header row." }
  const keys = header.map(headerKey)
  if (!keys.includes("name") || !keys.includes("mode")) {
    return { rows: [], error: "The file needs Name and Mode columns." }
  }
  const rows: EquipmentImportRow[] = []
  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index] ?? []
    if (cells.every((cell) => cell.trim() === "")) continue
    const record: Record<string, string> = {}
    keys.forEach((key, cellIndex) => {
      if (key) record[key] = cells[cellIndex]?.trim() ?? ""
    })
    rows.push({
      row: index + 1,
      input: {
        mode: record.mode?.toUpperCase(),
        name: record.name ?? "",
        innerLengthCm: numberOrNull(record.length),
        innerWidthCm: numberOrNull(record.width),
        innerHeightCm: numberOrNull(record.height),
        heightOpen: /^(1|true|yes|open)$/i.test(record.heightOpen ?? ""),
        maxPayloadKg: numberOrNull(record.payload),
        tareKg: record.tare?.trim() ? numberOrNull(record.tare) : 0,
        doorWidthCm: optionalPositive(record.doorWidth),
        doorHeightCm: optionalPositive(record.doorHeight),
        oogClass: record.oog?.trim() ? record.oog.trim().toUpperCase() : "NONE",
        notes: record.notes?.trim() ? record.notes.trim() : null,
        contour: emptyContour(),
      },
    })
  }
  if (rows.length === 0) return { rows: [], error: "The file has no equipment rows." }
  return { rows }
}

function headerKey(header: string): string {
  const key = header.trim().toLowerCase()
  if (key === "name") return "name"
  if (key === "mode" || key === "type") return "mode"
  if (key.includes("door") && key.includes("width")) return "doorWidth"
  if (key.includes("door") && key.includes("height")) return "doorHeight"
  if (key.includes("length")) return "length"
  if (key.includes("width")) return "width"
  if (key.includes("height") && key.includes("open")) return "heightOpen"
  if (key === "height open" || key === "open height") return "heightOpen"
  if (key.includes("height")) return "height"
  if (key.includes("payload")) return "payload"
  if (key.includes("tare")) return "tare"
  if (key.includes("oog") || key.includes("gauge")) return "oog"
  if (key.includes("note")) return "notes"
  return ""
}

function numberOrNull(value: string | undefined): number | null {
  if (!value || !value.trim()) return null
  const next = Number(value)
  return Number.isFinite(next) ? next : Number.NaN
}

function optionalPositive(value: string | undefined): number | null {
  if (!value || !value.trim()) return null
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : Number.NaN
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ",") {
      row.push(cell)
      cell = ""
      continue
    }
    if (char === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      continue
    }
    if (char !== "\r") cell += char
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
