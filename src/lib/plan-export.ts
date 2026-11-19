import type { PlanUnitView, PlanView } from "@/lib/plan-view"

export type SummaryRow = {
  Unit: string
  Equipment: string
  Pieces: number
  "Net weight (kg)": number
  "Payload used (%)": number
  "Cargo volume (m³)": number
  "Volume used (%)": number
  "Floor used (%)": number
  "Used length (cm)": number
}

export type PackingRow = {
  Unit: string
  "Load order": number
  Cargo: string
  "Length (cm)": number
  "Width (cm)": number
  "Height (cm)": number
  "Weight (kg)": number
  "From front (cm)": number
  "From left (cm)": number
  "From floor (cm)": number
  Rotation: string
}

export type UnloadedRow = { Cargo: string; Reason: string }

const round1 = (value: number) => Math.round(value * 10) / 10

export function unitLabel(unit: PlanUnitView, index: number): string {
  return `${index + 1}. ${unit.equipmentName}`
}

/** Pieces in the order they go in: by sequence, then front to back, bottom to top. */
export function loadOrder(unit: PlanUnitView) {
  return unit.items.slice().sort((a, b) => a.sequence - b.sequence || a.x - b.x || a.z - b.z)
}

export function summaryRows(plan: PlanView): SummaryRow[] {
  return plan.units.map((unit, index) => ({
    Unit: String(index + 1),
    Equipment: unit.equipmentName,
    Pieces: unit.pieces,
    "Net weight (kg)": Math.round(unit.netKg),
    "Payload used (%)": round1(unit.weightPct),
    "Cargo volume (m³)": Math.round(unit.volumeM3 * 100) / 100,
    "Volume used (%)": round1(unit.volumePct),
    "Floor used (%)": round1(unit.floorPct),
    "Used length (cm)": Math.round(unit.usedLengthCm),
  }))
}

export function packingRows(plan: PlanView): PackingRow[] {
  return plan.units.flatMap((unit, index) =>
    loadOrder(unit).map((item, order) => ({
      Unit: unitLabel(unit, index),
      "Load order": order + 1,
      Cargo: item.name,
      "Length (cm)": round1(item.lengthCm),
      "Width (cm)": round1(item.widthCm),
      "Height (cm)": round1(item.heightCm),
      "Weight (kg)": round1(item.weightKg),
      "From front (cm)": round1(item.x),
      "From left (cm)": round1(item.y),
      "From floor (cm)": round1(item.z),
      Rotation: item.rotation,
    })),
  )
}

export function unloadedRows(plan: PlanView): UnloadedRow[] {
  return plan.unloaded.map((row) => ({ Cargo: row.name, Reason: row.detail }))
}

export function exportFileName(projectName: string, extension: string): string {
  const safe = projectName.trim().replace(/[^\p{L}\p{N}\-_ ]+/gu, "").trim().replace(/\s+/g, "-")
  return safe ? `${safe}-load-plan.${extension}` : `load-plan.${extension}`
}

/** Builds and downloads an .xlsx with Summary, Packing list, and (if any) Not loaded sheets. */
export async function downloadPlanWorkbook(plan: PlanView, projectName: string): Promise<void> {
  const XLSX = await import("xlsx")
  const book = XLSX.utils.book_new()
  const summary = XLSX.utils.json_to_sheet(summaryRows(plan))
  summary["!cols"] = [{ wch: 6 }, { wch: 28 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(book, summary, "Summary")
  const packing = XLSX.utils.json_to_sheet(packingRows(plan))
  packing["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 28 }, ...Array.from({ length: 7 }, () => ({ wch: 14 })), { wch: 10 }]
  XLSX.utils.book_append_sheet(book, packing, "Packing list")
  const unloaded = unloadedRows(plan)
  if (unloaded.length > 0) {
    const sheet = XLSX.utils.json_to_sheet(unloaded)
    sheet["!cols"] = [{ wch: 28 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(book, sheet, "Not loaded")
  }
  XLSX.writeFile(book, exportFileName(projectName, "xlsx"))
}
