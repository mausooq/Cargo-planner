import fs from "node:fs"
import path from "node:path"
import * as XLSX from "xlsx"
import { isAirPalletName, normalizeUldName } from "./uld-kinds"

export { isAirContourName, isAirPalletName, normalizeUldName } from "@/lib/uld-kinds"

export const ULD_MASTER_FILES = [
  "ULD_All_48_Dimensions_Master (2).xlsx",
  "ULD_All_48_Dimensions_Master.xlsx",
] as const

export type UldMasterRow = {
  name: string
  status: string
  source: string | null
  workbookNotes: string | null
  externalLengthMm: number | null
  externalWidthMm: number | null
  externalHeightMm: number | null
  usableLengthMm: number | null
  usableWidthMm: number | null
  usableHeightMm: number | null
  volumeM3: number | null
  maxPayloadKg: number
  tareKg: number
  floorHeightMm: number | null
  innerLengthCm: number
  innerWidthCm: number
  innerHeightCm: number
  heightOpen: boolean
  sizeLabel: string
  notes: string
}

export function resolveUldMasterPath(cwd = process.cwd()): string {
  for (const file of ULD_MASTER_FILES) {
    const full = path.join(cwd, file)
    if (fs.existsSync(full)) return full
  }
  throw new Error(`ULD master workbook not found. Expected one of: ${ULD_MASTER_FILES.join(", ")}`)
}

export function readUldMaster(workbookPath = resolveUldMasterPath()): UldMasterRow[] {
  const workbook = XLSX.readFile(workbookPath)
  const sheet = workbook.Sheets["ULD Master"]
  if (!sheet) throw new Error("ULD master workbook is missing the ULD Master sheet.")
  const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true })
  const rows = table.map((row, index) => parseMasterRow(index + 2, row))
  if (rows.length !== 48) {
    throw new Error(`ULD master must have 48 equipment rows, found ${rows.length}.`)
  }
  return rows
}

export function indexUldByName(rows: UldMasterRow[]): Map<string, UldMasterRow> {
  const index = new Map<string, UldMasterRow>()
  for (const row of rows) {
    const key = normalizeUldName(row.name)
    if (index.has(key)) throw new Error(`Duplicate ULD master name: ${row.name}`)
    index.set(key, row)
  }
  return index
}

function parseMasterRow(excelRow: number, row: Record<string, unknown>): UldMasterRow {
  const name = asText(cell(row, "Equipment"))
  if (!name) throw new Error(`ULD Master row ${excelRow} is missing Equipment.`)

  const usableLengthMm = asNumber(cell(row, "Internal/Usable L (mm)"))
  const usableWidthMm = asNumber(cell(row, "Internal/Usable W (mm)"))
  const usableHeightMm = asNumber(cell(row, "Internal/Usable H (mm)"))
  const externalLengthMm = asNumber(cell(row, "External/Base L (mm)"))
  const externalWidthMm = asNumber(cell(row, "External/Base W (mm)"))
  const externalHeightMm = asNumber(cell(row, "External/Max H (mm)"))

  const { lengthMm, widthMm, heightMm } = planningEnvelope(name, {
    usableLengthMm,
    usableWidthMm,
    usableHeightMm,
    externalLengthMm,
    externalWidthMm,
    externalHeightMm,
  })
  if (lengthMm === null || widthMm === null || heightMm === null) {
    throw new Error(`ULD Master row ${excelRow} (${name}) is missing a usable or external envelope.`)
  }

  const maxPayloadKg = asNumber(cell(row, "Max Payload (kg)"))
  if (maxPayloadKg === null || maxPayloadKg <= 0) {
    throw new Error(`ULD Master row ${excelRow} (${name}) is missing Max Payload (kg).`)
  }

  const innerLengthCm = mmToCm(lengthMm)
  const innerWidthCm = mmToCm(widthMm)
  const innerHeightCm = mmToCm(heightMm)
  const heightOpen = isAirPalletName(name) || usableHeightMm === null
  const volumeM3 = asNumber(cell(row, "Volume (m³)")) ?? asNumber(cell(row, "Volume (m�)"))
  const source = asText(cell(row, "Source"))
  const workbookNotes = asText(cell(row, "Notes"))
  const status = asText(cell(row, "Dimension Status")) ?? "Exact public planning data"
  const tareKg = asNumber(cell(row, "Tare (kg)")) ?? 0
  const floorHeightMm = asNumber(cell(row, "Floor Height (mm)"))

  return {
    name,
    status,
    source,
    workbookNotes,
    externalLengthMm,
    externalWidthMm,
    externalHeightMm,
    usableLengthMm,
    usableWidthMm,
    usableHeightMm,
    volumeM3,
    maxPayloadKg,
    tareKg,
    floorHeightMm,
    innerLengthCm,
    innerWidthCm,
    innerHeightCm,
    heightOpen,
    sizeLabel: `${trimNumber(innerLengthCm)} x ${trimNumber(innerWidthCm)} x ${trimNumber(innerHeightCm)} CM`,
    notes: buildNotes({
      name,
      status,
      source,
      workbookNotes,
      volumeM3,
      floorHeightMm,
      heightOpen,
      usableLengthMm,
      externalLengthMm,
    }),
  }
}

function planningEnvelope(
  name: string,
  mm: {
    usableLengthMm: number | null
    usableWidthMm: number | null
    usableHeightMm: number | null
    externalLengthMm: number | null
    externalWidthMm: number | null
    externalHeightMm: number | null
  },
): { lengthMm: number | null; widthMm: number | null; heightMm: number | null } {
  const cargoPlannerInner = normalizeUldName(name) === "a2n"
  const lengthMm = cargoPlannerInner
    ? (mm.externalLengthMm ?? mm.usableLengthMm)
    : (mm.usableLengthMm ?? mm.externalLengthMm)
  const widthMm = cargoPlannerInner
    ? (mm.externalWidthMm ?? mm.usableWidthMm)
    : (mm.usableWidthMm ?? mm.externalWidthMm)
  const heightMm = cargoPlannerInner
    ? (mm.externalHeightMm ?? mm.usableHeightMm)
    : (mm.usableHeightMm ?? mm.externalHeightMm)
  return { lengthMm, widthMm, heightMm }
}

function buildNotes(input: {
  name: string
  status: string
  source: string | null
  workbookNotes: string | null
  volumeM3: number | null
  floorHeightMm: number | null
  heightOpen: boolean
  usableLengthMm: number | null
  externalLengthMm: number | null
}): string {
  const bits = [
    "Planning values from ULD_All_48_Dimensions_Master.",
    input.status,
  ]
  if (input.source) bits.push(`Source: ${input.source}.`)
  if (input.volumeM3 !== null) bits.push(`Published volume ${input.volumeM3} m³.`)
  if (input.floorHeightMm !== null) bits.push(`Floor height ${input.floorHeightMm} mm.`)
  if (input.heightOpen && input.usableLengthMm === null && input.externalLengthMm !== null) {
    bits.push("Open pallet: cargo height is the published max envelope.")
  }
  if (normalizeUldName(input.name) === "a2n") {
    bits.push("Planning envelope is the Cargo-Planner inner (external 3170 × 2230 × 2050 mm), not the FRAYTE wall-inset usable.")
  }
  if (input.workbookNotes) bits.push(input.workbookNotes)
  return bits.join(" ")
}

function cell(row: Record<string, unknown>, header: string): unknown {
  if (header in row) return row[header]
  const match = Object.keys(row).find((key) => key.replace(/�/g, "³") === header)
  return match ? row[match] : undefined
}

function mmToCm(mm: number): number {
  return Number((mm / 10).toFixed(2))
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}

function asText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string" && value.trim()) return value.trim()
  return null
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
