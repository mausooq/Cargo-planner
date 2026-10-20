import type { EquipmentMode, OogClass } from "@compass/domain"
import { isAirContourName, isAirPalletName } from "@/lib/uld-kinds"
import { hasContourCuts, type UldContour } from "@/lib/uld-contour"

export type VisualKind =
  | "CLOSED_BOX"
  | "OPEN_BOX"
  | "FLATBED"
  | "STEPDECK"
  | "LOWBOY"
  | "PALLET"
  | "BOLSTER"
  | "AIR_PALLET"
  | "AIR_CONTOUR"
  | "TRUCK"

export function visualKind(input: {
  mode: EquipmentMode
  name: string
  heightOpen: boolean
  oogClass: OogClass
  contour?: UldContour | null
}): VisualKind {
  if (hasContourCuts(input.contour)) return "AIR_CONTOUR"
  const name = input.name.toLowerCase()
  if (input.mode === "PALLET") {
    if (name.includes("bolster") || name.includes("decker")) return "BOLSTER"
    return "PALLET"
  }
  if (input.mode === "AIR") {
    if (isAirPalletName(name)) return "AIR_PALLET"
    if (isAirContourName(name)) return "AIR_CONTOUR"
    return "CLOSED_BOX"
  }
  if (isTruck(name)) return "TRUCK"
  if (input.oogClass === "LOWBOY" || name.includes("low boy") || name.includes("rgn")) return "LOWBOY"
  if (input.oogClass === "STEPDECK" || name.includes("step deck")) return "STEPDECK"
  if (
    input.oogClass === "FLATBED" ||
    name.includes("flatbed") ||
    name.includes("flat rack") ||
    name.includes("platform") ||
    name.includes("open trailer") ||
    name.includes("roll trailer") ||
    name.includes("chassis") ||
    /\bfr\b/.test(name) ||
    /\bpl\b/.test(name)
  ) {
    return "FLATBED"
  }
  if (input.oogClass === "OPEN_TOP" || name.includes("open top") || /\bot\b/.test(name) || name.includes("curtain")) {
    return "OPEN_BOX"
  }
  if (input.heightOpen) return "FLATBED"
  return "CLOSED_BOX"
}

function isTruck(name: string): boolean {
  if (name.includes("trailer") || name.includes("chassis")) return false
  return name.includes("truck") || name.includes("van")
}
