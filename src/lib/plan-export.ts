import { ACTUAL_FLOOR_HELP, AXLE_ESTIMATE_NOTE, CLEARANCE_HELP, clearanceText, EFFECTIVE_FLOOR_HELP } from "@/lib/clearance"
import { describeRotation } from "@compass/physics"
import { LENGTH_UNIT_LABEL, LENGTH_UNIT_SYMBOL, roundDisplayLength, toDisplayLength, type LengthUnit } from "@/lib/cargo-units"
import type { PlanUnitView, PlanView } from "@/lib/plan-view"

/**
 * One row of the Summary sheet. The size column titles carry the unit they are written in, for
 * example "Used length (ft)", so the sheet is unambiguous. Weights are kg, volumes m³, and
 * clearance is always in cm.
 */
export type SummaryRow = Record<string, string | number>

/** One row of the Packing list sheet. Titles such as "Length (ft)" and "From front (ft)" name the unit; "Clearance" is text in cm. */
export type PackingRow = Record<string, string | number>

export type UnloadedRow = { Cargo: string; Reason: string }

const round1 = (value: number) => Math.round(value * 10) / 10

export function unitLabel(unit: PlanUnitView, index: number): string {
  return `${index + 1}. ${unit.equipmentName}`
}

/** Pieces in the order they go in: by sequence, then front to back, bottom to top. */
export function loadOrder(unit: PlanUnitView) {
  return unit.items.slice().sort((a, b) => a.sequence - b.sequence || a.x - b.x || a.z - b.z)
}

/** A stored size (cm) in the unit, rounded for reading. Centimetres keep the one decimal they always had. */
function sizeIn(cm: number, unit: LengthUnit): number {
  return unit === "cm" ? round1(cm) : roundDisplayLength(toDisplayLength(cm, unit), unit)
}

export function summaryRows(plan: PlanView, lengthUnit: LengthUnit = "cm"): SummaryRow[] {
  return plan.units.map((unit, index) => ({
    Unit: String(index + 1),
    Equipment: unit.equipmentName,
    Pieces: unit.pieces,
    "Net weight (kg)": Math.round(unit.netKg),
    "Payload used (%)": round1(unit.weightPct),
    "Cargo volume (m³)": Math.round(unit.volumeM3 * 100) / 100,
    "Volume used (%)": round1(unit.volumePct),
    "Actual floor utilization (%)": round1(unit.floorActualPct ?? unit.floorPct),
    "Effective floor utilization (%)": round1(unit.floorEffectivePct ?? unit.floorPct),
    "Remaining payload (kg)": Math.round(unit.remainingKg ?? unit.maxPayloadKg - unit.netKg),
    "Remaining volume (m³)": Math.round((unit.remainingM3 ?? 0) * 100) / 100,
    [`Used length (${LENGTH_UNIT_SYMBOL[lengthUnit]})`]: lengthUnit === "cm" ? Math.round(unit.usedLengthCm) : sizeIn(unit.usedLengthCm, lengthUnit),
  }))
}

export function packingRows(plan: PlanView, lengthUnit: LengthUnit = "cm"): PackingRow[] {
  const symbol = LENGTH_UNIT_SYMBOL[lengthUnit]
  return plan.units.flatMap((unit, index) =>
    loadOrder(unit).map((item, order) => ({
      Unit: unitLabel(unit, index),
      "Load order": order + 1,
      Cargo: item.name,
      [`Length (${symbol})`]: sizeIn(item.lengthCm, lengthUnit),
      [`Width (${symbol})`]: sizeIn(item.widthCm, lengthUnit),
      [`Height (${symbol})`]: sizeIn(item.heightCm, lengthUnit),
      "Weight (kg)": round1(item.weightKg),
      [`From front (${symbol})`]: sizeIn(item.x, lengthUnit),
      [`From left (${symbol})`]: sizeIn(item.y, lengthUnit),
      [`From floor (${symbol})`]: sizeIn(item.z, lengthUnit),
      Rotation: item.rotation,
      Facing: describeRotation(item.rotation),
      Clearance: clearanceText(item.clearanceSetting ?? null, plan.clearanceCm),
    })),
  )
}

/** What the numbers mean, for the Excel Notes sheet and the printed report. */
export function noteRows(plan: Pick<PlanView, "clearanceCm">, lengthUnit: LengthUnit = "cm"): { Topic: string; Note: string }[] {
  return [
    { Topic: "Actual floor utilization", Note: ACTUAL_FLOOR_HELP },
    { Topic: "Effective floor utilization", Note: EFFECTIVE_FLOOR_HELP },
    {
      Topic: "Handling allowance",
      Note: `${plan.clearanceCm > 0 ? `Project default ${plan.clearanceCm} cm per side. ` : "Project default none. "}${CLEARANCE_HELP}`,
    },
    { Topic: "Axle loads", Note: AXLE_ESTIMATE_NOTE },
    {
      Topic: "Units",
      Note: `Sizes and positions are in ${LENGTH_UNIT_LABEL[lengthUnit]} (${LENGTH_UNIT_SYMBOL[lengthUnit]}); the column titles say so. Handling clearance is always in centimetres (cm). Weights are in kg and volumes in m³. Sizes are stored in centimetres and converted for this file only.`,
    },
  ]
}

export function unloadedRows(plan: PlanView): UnloadedRow[] {
  return plan.unloaded.map((row) => ({ Cargo: row.name, Reason: row.detail }))
}

export function exportFileName(projectName: string, extension: string): string {
  const safe = projectName.trim().replace(/[^\p{L}\p{N}\-_ ]+/gu, "").trim().replace(/\s+/g, "-")
  return safe ? `${safe}-load-plan.${extension}` : `load-plan.${extension}`
}

/** Builds and downloads an .xlsx with Summary, Packing list, and (if any) Not loaded sheets. */
export async function downloadPlanWorkbook(plan: PlanView, projectName: string, lengthUnit: LengthUnit = "cm"): Promise<void> {
  const XLSX = await import("xlsx")
  const book = XLSX.utils.book_new()
  const summary = XLSX.utils.json_to_sheet(summaryRows(plan, lengthUnit))
  summary["!cols"] = [{ wch: 6 }, { wch: 28 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 26 }, { wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(book, summary, "Summary")
  const packing = XLSX.utils.json_to_sheet(packingRows(plan, lengthUnit))
  packing["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 28 }, ...Array.from({ length: 7 }, () => ({ wch: 14 })), { wch: 10 }]
  XLSX.utils.book_append_sheet(book, packing, "Packing list")
  const notes = XLSX.utils.json_to_sheet(noteRows(plan, lengthUnit))
  notes["!cols"] = [{ wch: 28 }, { wch: 110 }]
  XLSX.utils.book_append_sheet(book, notes, "Notes")
  const unloaded = unloadedRows(plan)
  if (unloaded.length > 0) {
    const sheet = XLSX.utils.json_to_sheet(unloaded)
    sheet["!cols"] = [{ wch: 28 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(book, sheet, "Not loaded")
  }
  XLSX.writeFile(book, exportFileName(projectName, "xlsx"))
}
