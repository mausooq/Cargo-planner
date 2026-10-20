import type { SolverCargo, SolverContour, SolverEquipment, SolverInput } from "@compass/solver"
import type { CargoLine } from "@/components/cargo-grid"
import type { EquipmentListItem } from "@/lib/equipment-catalog"
import { hasContourCuts, resolveEquipmentContour, type UldContour } from "@/lib/uld-contour"

export function buildSolverInput(input: {
  cargo: CargoLine[]
  equipment: EquipmentListItem[]
  objective: "FEWEST_UNITS" | "LOWEST_COST"
  seed?: number
}): SolverInput {
  const equipment: SolverEquipment[] = input.equipment.map((item) => ({
    id: item.id,
    name: item.name,
    lengthCm: item.innerLengthCm,
    widthCm: item.innerWidthCm,
    heightCm: item.innerHeightCm,
    maxPayloadKg: item.maxPayloadKg,
    tareKg: item.tareKg,
    axleGroups: item.axleGroups,
    costPerUnit: item.costPerUnit,
    maxCount: item.maxCount && item.maxCount > 0 ? item.maxCount : 1,
    contour: toSolverContour(resolveEquipmentContour(item.name, item.contour)),
  }))

  const cargo: SolverCargo[] = input.cargo.map((item) => ({
    id: item.id,
    name: item.name,
    lengthCm: item.lengthCm,
    widthCm: item.widthCm,
    heightCm: item.heightCm,
    weightKg: item.weightKg,
    quantity: item.quantity,
    shape: item.shape,
    orientation: item.orientation,
    allowedRotations: item.orientation === "CUSTOM" ? item.allowedRotations : null,
    stackable: item.stackable,
    bottomOnly: item.bottomOnly,
    maxStackLoadKg: item.maxStackLoadKg,
    maxStackLayers: item.maxStackLayers,
    priority: item.priority,
    destinationStop: item.destinationStop,
    consignmentId: item.consignmentId,
    segregationClass: item.segregationClass,
    color: item.color,
  }))

  return {
    equipment,
    cargo,
    settings: {
      seed: input.seed ?? 1,
      objective: input.objective,
      timeLimitMs: 4000,
      restarts: 16,
    },
  }
}

function toSolverContour(contour: UldContour | null): SolverContour | null {
  if (!contour || !hasContourCuts(contour)) return null
  return {
    bottomLeft: mmToCm(contour.bottomLeft),
    bottomRight: mmToCm(contour.bottomRight),
    topLeft: mmToCm(contour.topLeft),
    topRight: mmToCm(contour.topRight),
  }
}

function mmToCm(side: { lengthMm: number; heightMm: number }) {
  return { lengthCm: side.lengthMm / 10, heightCm: side.heightMm / 10 }
}
