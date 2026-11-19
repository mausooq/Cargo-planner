import type { CargoItemInput } from "@compass/domain"

export type CargoField = "name" | "lengthCm" | "widthCm" | "heightCm" | "weightKg" | "quantity" | "priority" | "destinationStop"

export type CargoCheck = {
  /** Values the server will reject. The line cannot be saved until these are fixed. */
  errors: Partial<Record<CargoField, string>>
  /** Values that are allowed but leave the line out of the plan (blank name, zero size). */
  missing: Partial<Record<CargoField, string>>
}

type Checkable = Pick<CargoItemInput, CargoField>

export function checkCargoLine(line: Checkable): CargoCheck {
  const errors: CargoCheck["errors"] = {}
  const missing: CargoCheck["missing"] = {}

  for (const [field, label] of [
    ["lengthCm", "Length"],
    ["widthCm", "Width"],
    ["heightCm", "Height"],
    ["weightKg", "Weight"],
  ] as const) {
    const value = line[field]
    if (!Number.isFinite(value) || value < 0) errors[field] = `${label} cannot be negative.`
    else if (value === 0) missing[field] = `Enter the ${label.toLowerCase()}.`
  }

  if (!Number.isInteger(line.quantity) || line.quantity < 1) errors.quantity = "Quantity must be a whole number, 1 or more."
  if (!Number.isInteger(line.priority)) errors.priority = "Priority must be a whole number."
  if (!Number.isInteger(line.destinationStop) || line.destinationStop < 1) {
    errors.destinationStop = "Stop must be a whole number, 1 or more."
  }
  if (line.name.trim().length === 0) missing.name = "Give the item a name."
  if (line.name.trim().length > 120) errors.name = "Keep the name under 120 characters."

  return { errors, missing }
}

export function isPlannable(line: Checkable): boolean {
  const { errors, missing } = checkCargoLine(line)
  return Object.keys(errors).length === 0 && Object.keys(missing).length === 0
}

export function cargoTotals(lines: Pick<CargoItemInput, "lengthCm" | "widthCm" | "heightCm" | "weightKg" | "quantity">[]) {
  let pieces = 0
  let weightKg = 0
  let volumeM3 = 0
  for (const line of lines) {
    const quantity = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 0
    pieces += quantity
    weightKg += Math.max(0, line.weightKg) * quantity
    volumeM3 += ((Math.max(0, line.lengthCm) * Math.max(0, line.widthCm) * Math.max(0, line.heightCm)) / 1_000_000) * quantity
  }
  return { pieces, weightKg, volumeM3 }
}
