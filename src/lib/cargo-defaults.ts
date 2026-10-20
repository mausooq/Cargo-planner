import type { CargoItemInput, CargoShape } from "@compass/domain"

export const NEW_CARGO: CargoItemInput = {
  sku: null,
  name: "",
  lengthCm: 0,
  widthCm: 0,
  heightCm: 0,
  weightKg: 0,
  quantity: 1,
  shape: "BOX",
  orientation: "ROTATE_90",
  allowedRotations: null,
  stackable: true,
  bottomOnly: false,
  maxStackLoadKg: null,
  maxStackLayers: null,
  priority: 0,
  destinationStop: 1,
  consignmentId: null,
  segregationClass: null,
  color: null,
}

export function cargoPreset(shape: CargoShape | undefined): CargoItemInput {
  if (shape === "CYLINDER_DRUM") {
    return { ...NEW_CARGO, shape: "CYLINDER_DRUM", orientation: "FIXED" }
  }
  if (shape === "PIPE") {
    return { ...NEW_CARGO, shape: "PIPE", orientation: "ROTATE_90" }
  }
  return { ...NEW_CARGO }
}
