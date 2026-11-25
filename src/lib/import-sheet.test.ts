import * as XLSX from "xlsx"
import { describe, expect, it } from "vitest"
import { suggestMapping } from "@/lib/cargo-import"
import { evaluateLine, isImportable } from "@/lib/import-review"
import { inspectZip, readWorkbook, SHEET_LIMITS, sheetToText, SheetError } from "@/lib/import-sheet"
import { tableToReviewLines } from "@/lib/import-table"

/** A synthetic workbook: sheet name → rows. Nothing here is a real customer document. */
function book(sheets: Record<string, unknown[][]>, merges: Record<string, XLSX.Range[]> = {}): Uint8Array {
  const workbook = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    if (merges[name]) sheet["!merges"] = merges[name]
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }
  return new Uint8Array(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer)
}

const csv = (text: string) => new TextEncoder().encode(text)

const customerList: unknown[][] = [
  ["ACME TRADING LLC", "", "", ""],
  ["PACKING LIST – shipment 4471", "", "", ""],
  [],
  ["Item no.", "Description", "Pcs", "Dimensions", "Gross weight (kg)"],
  ["A-1", "Steel drum", 4, "58 x 58 x 88 cm", 210],
  ["A-2", "Wooden crate", 2, "120 x 80 x 60 cm", 150],
  [],
  ["", "Sub total", 6, "", 1140],
  ["B-1", "Machine part", 1, "1.2 x 0.8 x 0.6 m", 300],
  ["", "TOTAL", 7, "", 1440],
]

describe("finding the cargo table in a customer's spreadsheet", () => {
  it("finds a header that appears after a title block, and keeps source row numbers", () => {
    const info = readWorkbook(book({ "Packing list": customerList }), "list.xlsx")
    expect(info.sheets).toHaveLength(1)
    const table = info.sheets[0]!.tables[0]!
    expect(table.headerRow).toBe(4)
    expect(table.headers).toEqual(["Item no.", "Description", "Pcs", "Dimensions", "Gross weight (kg)"])
    expect(table.rowNumbers).toEqual([5, 6, 8, 9, 10])
    expect(table.confident).toBe(true)
    expect(table.sheetName).toBe("Packing list")
  })

  it("maps customer-specific column names", () => {
    const mapping = suggestMapping(["Item no.", "Description", "Pcs", "Dimensions", "Gross weight (kg)"])
    expect(mapping).toEqual({ "Item no.": "sku", Description: "name", Pcs: "quantity", Dimensions: "dimensions", "Gross weight (kg)": "weight" })
  })

  it("splits combined sizes, leaves out subtotal and total rows, and notes them", () => {
    const table = readWorkbook(book({ "Packing list": customerList }), "list.xlsx").sheets[0]!.tables[0]!
    const { lines, skipped, documentTotals } = tableToReviewLines(table, { lengthUnit: "cm", weightUnit: "kg", columns: suggestMapping(table.headers) })
    expect(lines.map((line) => line.sku)).toEqual(["A-1", "A-2", "B-1"])
    expect(skipped.map((row) => row.rowNumber)).toEqual([8, 10])
    expect(documentTotals).toEqual({ pieces: 7, weightKg: 1440 })
    const evaluations = lines.map(evaluateLine)
    expect(evaluations.map((entry) => entry.status)).toEqual(["ready", "ready", "ready"])
    expect(evaluations[2]!.sizesCm).toEqual([120, 80, 60])
    expect(evaluations[0]!.input).toMatchObject({ lengthCm: 58, widthCm: 58, heightCm: 88, quantity: 4, weightKg: 210 })
    expect(lines[0]!.source).toMatchObject({ sheet: "Packing list", row: 5, cells: "A5:E5" })
  })

  it("finds several tables on one sheet and several sheets in a workbook", () => {
    const rows: unknown[][] = [
      ["Name", "Qty", "L", "W", "H", "Weight"],
      ["Box A", 1, 10, 10, 10, 1],
      [],
      ["Second shipment"],
      ["Name", "Qty", "L", "W", "H", "Weight"],
      ["Box B", 2, 20, 20, 20, 2],
    ]
    const info = readWorkbook(book({ First: rows, Notes: [["just a note"]], Second: rows.slice(0, 2) }), "multi.xlsx")
    expect(info.sheets.map((sheet) => sheet.name)).toEqual(["First", "Notes", "Second"])
    expect(info.sheets[0]!.tables).toHaveLength(2)
    expect(info.sheets[0]!.tables[1]!.rows).toEqual([["Box B", "2", "20", "20", "20", "2"]])
    expect(info.sheets[1]!.tables[0]!.confident).toBe(false)
  })

  it("repeats text from merged cells and ignores a merged title", () => {
    const rows: unknown[][] = [["PACKING LIST"], ["Consignment", "Name", "Qty", "L", "W", "H", "Weight"], ["PO-1", "Crate", 1, 1, 1, 1, 1], ["", "Crate 2", 1, 1, 1, 1, 1]]
    const info = readWorkbook(book({ S: rows }, { S: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }] }), "m.xlsx")
    const table = info.sheets[0]!.tables[0]!
    expect(table.headerRow).toBe(2)
    expect(table.rows.map((row) => row[0])).toEqual(["PO-1", "PO-1"])
  })

  it("treats an unstructured sheet as not confident", () => {
    const info = readWorkbook(book({ Free: [["Some notes about the shipment"], ["call the driver"]] }), "free.xlsx")
    expect(info.sheets[0]!.tables[0]!.confident).toBe(false)
  })

  it("does not take formulas as values it can run", () => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([["Name", "Qty", "L", "W", "H", "Weight"], ["Crate", 2, 10, 10, 10, 5]])
    sheet.G2 = { t: "n", v: 7, f: "HYPERLINK(\"http://example.invalid\")" }
    XLSX.utils.book_append_sheet(workbook, sheet, "F")
    const bytes = new Uint8Array(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer)
    const table = readWorkbook(bytes, "f.xlsx").sheets[0]!.tables[0]!
    expect(JSON.stringify(table)).not.toContain("HYPERLINK")
  })
})

describe("CSV", () => {
  it("reads UTF-8 text in several scripts", () => {
    const info = readWorkbook(csv("Name,Qty,L,W,H,Weight\nصندوق خشبي,2,100,50,40,30\n木箱,1,60,40,30,12\n"), "x.csv")
    expect(info.sheets[0]!.tables[0]!.rows.map((row) => row[0])).toEqual(["صندوق خشبي", "木箱"])
  })

  it("reads a semicolon-separated file and a byte order mark", () => {
    const info = readWorkbook(csv("﻿Name;Qty;L;W;H;Weight\nCrate;2;100;50;40;30\n"), "x.csv")
    expect(info.sheets[0]!.tables[0]!.headers).toEqual(["Name", "Qty", "L", "W", "H", "Weight"])
  })
})

describe("files that are refused", () => {
  const refused = (action: () => unknown, message: RegExp) => expect(action).toThrowError(expect.objectContaining({ message: expect.stringMatching(message) }))

  it("refuses empty, oversized and wrong files", () => {
    refused(() => readWorkbook(new Uint8Array(0), "a.xlsx"), /empty/)
    refused(() => readWorkbook(new Uint8Array(SHEET_LIMITS.maxBytes + 1), "a.xlsx"), /over 5 MB/)
    refused(() => readWorkbook(csv("this is not a workbook"), "a.xlsx"), /not an \.xlsx/)
    refused(() => readWorkbook(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), "a.xlsx"), /not a valid Excel/)
    refused(() => readWorkbook(new Uint8Array([1, 2, 3, 0, 5]), "a.csv"), /CSV text/)
  })

  it("refuses a sheet with more rows than the limit instead of cutting it short", () => {
    const rows: unknown[][] = [["Name", "Qty", "L", "W", "H", "Weight"]]
    for (let i = 0; i < SHEET_LIMITS.maxRows + 5; i++) rows.push([`Box ${i}`, 1, 1, 1, 1, 1])
    refused(() => readWorkbook(book({ Big: rows }), "big.xlsx"), /more than \d+ rows/)
  })

  it("refuses a workbook that would unpack far larger than it is", () => {
    refused(() => inspectZip(fakeZip([{ name: "xl/workbook.xml", packed: 1000, unpacked: 900 * 1024 * 1024 }])), /far larger/)
    refused(() => inspectZip(fakeZip([{ name: "xl/worksheets/sheet1.xml", packed: 100_000, unpacked: 60 * 1024 * 1024 }])), /far larger/)
  })

  it("refuses macros and runaway part counts, and accepts an ordinary directory", () => {
    refused(() => inspectZip(fakeZip([{ name: "xl/vbaProject.bin", packed: 10, unpacked: 10 }])), /macros/)
    refused(() => inspectZip(fakeZip(Array.from({ length: SHEET_LIMITS.maxZipEntries + 1 }, (_, i) => ({ name: `p${i}.xml`, packed: 1, unpacked: 1 })))), /too many parts/)
    expect(() => inspectZip(fakeZip([{ name: "xl/workbook.xml", packed: 500, unpacked: 1500 }]))).not.toThrow()
  })

  it("never lets a hostile sheet name reach a plain object", () => {
    const info = readWorkbook(book({ "Safe sheet": customerList }), "list.xlsx")
    expect(info.sheets.map((sheet) => sheet.name)).toEqual(["Safe sheet"])
    expect(SheetError).toBeDefined()
  })
})

describe("a sheet written out for the AI reader", () => {
  it("keeps the sheet name, row numbers and cell references", () => {
    const result = sheetToText(book({ "Packing list": customerList }), "list.xlsx", "Packing list")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toMatch(/^Sheet "Packing list"/)
    expect(result.text).toContain("Row 5 | A5: A-1 | B5: Steel drum | C5: 4 | D5: 58 x 58 x 88 cm | E5: 210")
  })

  it("refuses a sheet that is too long to send whole", () => {
    const rows: unknown[][] = []
    for (let i = 0; i < SHEET_LIMITS.maxAiRows + 5; i++) rows.push([`Box ${i}`, 1])
    const result = sheetToText(book({ Long: rows }), "long.xlsx", "Long")
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("column import") })
  })

  it("reports an unknown sheet", () => {
    expect(sheetToText(book({ A: [["x"]] }), "a.xlsx", "Nope")).toMatchObject({ ok: false })
  })
})

describe("a packing list with problems stays reviewable", () => {
  it("flags rows with missing sizes instead of dropping them", () => {
    const rows: unknown[][] = [["Description", "Qty", "L", "W", "H", "Weight"], ["Good", 1, 10, 10, 10, 1], ["No size", 1, "", "", "", 4]]
    const table = readWorkbook(book({ S: rows }), "s.xlsx").sheets[0]!.tables[0]!
    const { lines } = tableToReviewLines(table, { lengthUnit: "cm", weightUnit: "kg", columns: suggestMapping(table.headers) })
    const evaluations = lines.map(evaluateLine)
    expect(lines).toHaveLength(2)
    expect(isImportable(evaluations[0]!)).toBe(true)
    expect(evaluations[1]!.status).toBe("missing")
  })

  it("reads decimal feet and feet-and-inches in cells without confusing them", () => {
    const rows: unknown[][] = [["Description", "Qty", "L", "W", "H", "Weight"], ["Decimal", 1, "5.6 ft", "1 ft", "1 ft", 1], ["Feet-inches", 1, "5 ft 6 in", "1 ft", "1 ft", 1]]
    const table = readWorkbook(book({ S: rows }), "s.xlsx").sheets[0]!.tables[0]!
    const { lines } = tableToReviewLines(table, { lengthUnit: "cm", weightUnit: "kg", columns: suggestMapping(table.headers) })
    const sizes = lines.map((line) => evaluateLine(line).sizesCm![0])
    expect(sizes[0]).toBeCloseTo(170.688, 3)
    expect(sizes[1]).toBeCloseTo(167.64, 3)
  })

  it("reads a line total weight only after the planner confirms the division", () => {
    const rows: unknown[][] = [["Description", "Qty", "L", "W", "H", "Total weight"], ["Crates", 5, 10, 10, 10, 750]]
    const table = readWorkbook(book({ S: rows }), "s.xlsx").sheets[0]!.tables[0]!
    const { lines } = tableToReviewLines(table, { lengthUnit: "cm", weightUnit: "kg", columns: suggestMapping(table.headers) })
    const evaluation = evaluateLine(lines[0]!)
    expect(evaluation.perPieceKg).toBe(150)
    expect(evaluation.status).toBe("ambiguous")
    expect(evaluateLine({ ...lines[0]!, confirmed: [...lines[0]!.confirmed, "weight"] }).status).toBe("ready")
  })
})

/** A zip file with only a directory: enough for inspectZip, which never unpacks anything. */
function fakeZip(entries: { name: string; packed: number; unpacked: number }[]): Uint8Array {
  const parts: number[] = []
  const push32 = (value: number) => parts.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255)
  const push16 = (value: number) => parts.push(value & 255, (value >>> 8) & 255)
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    push32(0x02014b50)
    for (let i = 0; i < 3; i++) push32(0) // versions, flags, method, time, date (12 bytes)
    push32(0) // crc
    push32(entry.packed)
    push32(entry.unpacked)
    push16(name.length)
    push16(0)
    push16(0)
    push16(0) // disk
    push16(0) // internal attributes
    push32(0) // external attributes
    push32(0) // local header offset
    parts.push(...name)
  }
  const directoryLength = parts.length
  push32(0x06054b50)
  push16(0)
  push16(0)
  push16(entries.length)
  push16(entries.length)
  push32(directoryLength)
  push32(0)
  push16(0)
  return new Uint8Array(parts)
}
