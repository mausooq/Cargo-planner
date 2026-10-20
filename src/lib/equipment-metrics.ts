import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { uldContourVolumeM3 } from "@/lib/uld-contour"

export function equipmentVolumeM3(
  item: Pick<EquipmentListItem, "innerLengthCm" | "innerWidthCm" | "innerHeightCm" | "contour">,
): number {
  return uldContourVolumeM3(item.innerLengthCm, item.innerWidthCm, item.innerHeightCm, item.contour)
}
