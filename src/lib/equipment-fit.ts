import type { EquipmentListItem } from "@/lib/equipment-catalog"

export type FitCargo = {
  lengthCm: number
  widthCm: number
  heightCm: number
  weightKg: number
}

export function cargoFitsEquipment(
  cargo: FitCargo,
  item: Pick<
    EquipmentListItem,
    "innerLengthCm" | "innerWidthCm" | "innerHeightCm" | "maxPayloadKg" | "doorWidthCm" | "doorHeightCm"
  >,
): boolean {
  if (cargo.weightKg > item.maxPayloadKg) return false
  if (cargo.lengthCm > item.innerLengthCm) return false
  if (cargo.widthCm > item.innerWidthCm) return false
  if (cargo.heightCm > item.innerHeightCm) return false
  if (item.doorWidthCm != null && cargo.widthCm > item.doorWidthCm) return false
  if (item.doorHeightCm != null && cargo.heightCm > item.doorHeightCm) return false
  return true
}
