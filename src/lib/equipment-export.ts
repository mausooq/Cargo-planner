import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { equipmentVolumeM3 } from "@/lib/equipment-metrics"

export async function downloadEquipmentFile(items: EquipmentListItem[], format: "csv" | "xlsx") {
  const XLSX = await import("xlsx")
  const rows = items.map((item) => ({
    Name: item.name,
    Mode: item.mode,
    Code: item.code,
    "Length (cm)": item.innerLengthCm,
    "Width (cm)": item.innerWidthCm,
    "Height (cm)": item.innerHeightCm,
    "Volume (m3)": Number(equipmentVolumeM3(item).toFixed(3)),
    "Payload (kg)": item.maxPayloadKg,
    "Tare (kg)": item.tareKg,
    "Door width (cm)": item.doorWidthCm ?? "",
    "Door height (cm)": item.doorHeightCm ?? "",
    "Height open": item.heightOpen ? "yes" : "",
    "Out of gauge": item.oogClass,
    Type: item.isCustom ? "Custom" : "System",
    Notes: item.notes ?? "",
  }))
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, "Equipment")
  XLSX.writeFile(book, format === "csv" ? "equipment.csv" : "equipment.xlsx")
}
